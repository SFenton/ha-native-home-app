import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';
import type { CompositionDocument } from '../../src/shared/composition/schema';
import { buildDocumentIndex } from '../../src/preview2/model';
import { replaceAt, valueAt } from '../../src/composition-editor';
import { ensureSource } from '../../src/workspace2/add/sources';
import type { Predicate } from '../../src/shared/composition/expression';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
/** The fixture opened on its Climate tab, where a navigation tile holds a text slot. */
const climate = { ...fixture.document, navigation: { ...fixture.document.navigation, initialTabId: 'hc-tab-climate', initialPageId: 'page-climate' } };
test.beforeEach(async ({ request }) => { await seed(request); });

/** A house with a guest switch, a lamp, a sensor and the two occupancy entities behind the fixture's Guests section, so the entity picker has real rows and the result line has live states. */
async function stubHouse(page: Page) {
  const states = [
    { entityId: 'input_boolean.demo_guests', name: 'Guest Mode', state: 'on' },
    { entityId: 'light.demo_lamp', name: 'Hall Lamp', state: 'off' },
    { entityId: 'sensor.demo_count', name: 'Lights On', state: '18' },
    // The fixture's Guests section shows only while its occupancy source reads active, as the app does; without these two it is hidden by its own rule.
    { entityId: 'input_boolean.demo_entity_122', name: 'Spare Room Occupied', state: 'on' },
    { entityId: 'input_boolean.demo_entity_123', name: 'Attic Occupied', state: 'on' },
  ];
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}
const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();

async function openOnlyShowWhen(page: Page) {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1');
  await full(page);
  await panel.getByRole('button', { name: /^Only show when/ }).click();
  return panel;
}

const result = (page: Page) => page.getByRole('status').filter({ hasText: /right now|now\.|tell yet|Waiting|Not connected|Now: |Shows / }).first();
async function chooseState(page: Page, panel: Locator, state: string) {
  await panel.getByRole('button', { name: 'Value', exact: true }).click();
  await page.getByRole('button', { name: state, exact: true }).click();
}
/** Selects a node the preview draws without its title (a status chip) by its id. */
async function selectNode(page: Page, id: string, title: string) {
  await previewRoot(page).locator(`[data-sel="node:${id}"]`).first().click({ position: { x: 4, y: 4 } });
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}
const done = (page: Page) => page.getByRole('button', { name: 'Done', exact: true });
const undoButton = (page: Page) => page.getByRole('button', { name: /^Undo/ }).first();

test('Only show when: compact pickers build one check, reopening keeps it, and Done is one step', async ({ page }) => {
  const panel = await openOnlyShowWhen(page);
  await expect(panel.getByRole('radiogroup', { name: 'Condition view' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  await expect(result(page)).toContainText('Yes · Guest Mode is On right now');
  await snap(page, `${prefix(page)}-x-simple`);
  // Is off: the tile goes, and the result line says why.
  await chooseState(page, panel, 'Off');
  await expect(result(page)).toContainText('No · Guest Mode is On right now');
  await done(page).click();
  // The editing view keeps a hidden tile in place, marked; Use mode drops it.
  await expect(previewRoot(page).locator('[data-hidden]').filter({ hasText: 'Demo Guests 1' })).toHaveCount(1);
  await panel.getByRole('button', { name: /^Only show when/ }).click();
  await chooseState(page, panel, 'On');
  await panel.getByRole('button', { name: 'Value', exact: true }).click();
  await expect(page.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (isPhone(page)) await page.locator('.w2-back').click(); else await page.keyboard.press('Escape');
  await snap(page, `${prefix(page)}-x-logic`);
  await done(page).click();
  const field = panel.getByRole('button', { name: /^Only show when: Guest Mode is on\./ });
  await expect(field).toBeVisible();
  await expect(field).toContainText('Guest Mode is on');
  // Each Done is one step: one Undo takes the last edit back, a second takes the first.
  if (!isPhone(page)) {
    await undoButton(page).click();
    await expect(panel.getByRole('button', { name: /^Only show when/ })).toContainText('Guest Mode is off');
    await undoButton(page).click();
    await expect(panel.getByRole('button', { name: /^Only show when/ })).toContainText('Always');
  }
});

test('Compound checks: the canvas keeps three levels, one true answer, and an atomic Apply', async ({ page, request }) => {
  let document = fixture.document;
  const ids: string[] = [];
  for (const entityId of ['input_boolean.demo_guests', 'light.demo_lamp', 'sensor.demo_count']) {
    const made = ensureSource(document, entityId); document = made.document; ids.push(made.sourceId);
  }
  const check = (sourceId: string): Predicate => ({ type: 'state', sourceId, path: ['state'], in: ['on'] });
  const predicate: Predicate = { type: 'all', of: [check(ids[0]), { type: 'all', of: [check(ids[1]), { type: 'all', of: [check(ids[2])] }] }] };
  const tile = [...buildDocumentIndex(document).entries.values()].find(entry => entry.node?.title === 'Demo Guests 1')!;
  await seed(request, replaceAt(document, [...tile.path, 'visibleWhen'], predicate));
  await stubHouse(page); await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1'); await full(page);
  await expect(panel.getByTestId('logic-field-summary')).toContainText(/Guest Mode.*Hall Lamp.*Lights On/);
  await snap(page, `${prefix(page)}-x-nest`);
  const canvas = page.locator('.w2-logic-overlay .w2-canvas[data-panel]');
  async function openGraph() {
    await panel.getByRole('button', { name: 'Edit in Canvas', exact: true }).click();
    const palette = page.getByRole('button', { name: 'Close block palette', exact: true });
    if (await palette.isVisible()) await palette.click();
    await canvas.getByRole('button', { name: 'More canvas controls', exact: true }).click();
    await canvas.getByRole('button', { name: 'Fit all', exact: true }).click();
    await expect(canvas.getByRole('button', { name: /^Select All Of/ })).toHaveCount(3);
    await expect(canvas.getByRole('button', { name: /^Entity State, .*output.*known, live, value Yes$/ })).toHaveCount(1);
    await expect(canvas.getByRole('button', { name: /^Entity State, .*output.*known, live, value No$/ })).toHaveCount(2);
  }
  await openGraph();
  await snap(page, `${prefix(page)}-x-nest-page`);
  await canvas.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await openGraph();
  await canvas.getByRole('button', { name: /^Select All Of/ }).first().click();
  // A header click opens the data peek (a sheet on a phone); the inspector opens from the selected block's Inspect action.
  if (isPhone(page)) await page.getByRole('button', { name: 'Close Data peek: All Of', exact: true }).click();
  await canvas.getByRole('button', { name: /^Inspect All Of/ }).first().click();
  const inspector = isPhone(page) ? page.getByRole('dialog', { name: 'Block inspector', exact: true }) : canvas;
  await inspector.getByText('Position', { exact: true }).click();
  const x = inspector.getByRole('spinbutton', { name: 'X', exact: true });
  await x.fill(String(Number(await x.inputValue()) + 32));
  await inspector.getByRole('button', { name: 'Set position', exact: true }).click();
  if (isPhone(page)) await inspector.getByRole('button', { name: 'Close block inspector', exact: true }).click();
  await canvas.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(canvas.locator('.w2-canvas-footer [role=status]')).toContainText('Edits applied to the draft');
  await canvas.getByRole('button', { name: 'Close canvas', exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(async () => (await (await request.get('/native/api/draft')).json()).document.studioCanvas).toBeDefined();
  if (!isPhone(page)) {
    await undoButton(page).click();
    await expect.poll(async () => (await (await request.get('/native/api/draft')).json()).document.studioCanvas).toBeUndefined();
  }
  const saved = (await (await request.get('/native/api/draft')).json()).document;
  const savedTile = [...buildDocumentIndex(saved).entries.values()].find(entry => entry.node?.title === 'Demo Guests 1')!;
  expect(valueAt(saved, [...savedTile.path, 'visibleWhen'])).toEqual(predicate);
});

/** Opens a chip's Fill as Rules and builds Rule 1: "Lights On is above 10, then Orange". */
async function buildFillRule(page: Page) {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectNode(page, 'hc-chip-0', 'Lights');
  await full(page);
  await panel.getByRole('button', { name: 'Fill value: Fixed' }).click();
  await page.getByRole('menuitemradio', { name: /Rules/ }).click();
  await expect(done(page)).toBeDisabled();
  await panel.getByRole('button', { name: /^Rule 1 of 1: if / }).click();
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  await panel.getByRole('combobox', { name: 'Comparison' }).click();
  await page.getByRole('option', { name: 'is above' }).click();
  await panel.getByRole('spinbutton', { name: 'Number' }).fill('10');
  await panel.getByRole('button', { name: 'Fill', exact: true }).last().click();
  await page.getByRole('radio', { name: 'Orange', exact: true }).click();
  // A popover closes on Escape; on a phone the picker is a page and Back returns to the rule.
  if (isPhone(page)) await page.getByRole('button', { name: 'Rule 1', exact: true }).click(); else await page.keyboard.press('Escape');
  return panel;
}

test('Rules: a rule, Otherwise, Used Now, the result line, Preview, and Done as one step', async ({ page }) => {
  const panel = await buildFillRule(page);
  await snap(page, `${prefix(page)}-x-rule-page`);
  await page.getByRole('button', { name: 'Fill', exact: true }).first().click();
  const row = panel.getByRole('button', { name: /^Rule 1 of 1: if Lights On is above 10, then Orange\. Used now\.$/ });
  await expect(row).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Otherwise: then Standard\.$/ })).toBeVisible();
  await expect(result(page)).toBeVisible();
  await expect(panel.getByText('Used Now')).toHaveCount(1);
  await expect(done(page)).toBeEnabled();
  await snap(page, `${prefix(page)}-x-rules`);
  // A second rule starts empty: Done waits for it.
  await panel.getByRole('button', { name: 'Add Rule' }).click();
  // Adding a rule opens its page; Back leaves it empty and Done waits for it.
  await expect(panel.getByRole('heading', { name: 'Rule 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Fill', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: /^Rule 2 of 2: if no condition yet/ })).toBeVisible();
  await expect(done(page)).toBeDisabled();
  await panel.getByRole('button', { name: /^Rule 2 of 2: if no condition yet/ }).click();
  await panel.getByRole('button', { name: 'Remove Rule' }).click();
  await expect(panel.getByRole('button', { name: /^Rule 2 of 2/ })).toHaveCount(0);
  // Preview a rule: the result line is tagged Test and nothing is written.
  await panel.getByRole('combobox', { name: 'Preview' }).click();
  await page.getByRole('option', { name: 'Otherwise' }).click();
  await expect(panel.getByText('Test', { exact: true }).first()).toBeVisible();
  await panel.getByRole('combobox', { name: 'Preview' }).click();
  await page.getByRole('option', { name: 'Live' }).click();
  await done(page).click();
  await expect(panel.getByRole('button', { name: /^Fill: 1 rule\./ })).toBeVisible();
  if (!isPhone(page)) {
    await undoButton(page).click();
    await expect(panel.getByRole('button', { name: 'Fill value: Fixed' })).toBeVisible();
  }
});

/** Opens a navigation tile's Subtitle as From Entity: the token line. */
async function openSubtitleLine(page: Page, request: Parameters<typeof seed>[0]) {
  await seed(request, climate);
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Room Thermostats');
  await full(page);
  await panel.getByRole('button', { name: 'Subtitle value: Fixed' }).click();
  await page.getByRole('menuitemradio', { name: /From Entity/ }).click();
  const line = panel.getByRole('textbox', { name: /Subtitle/ });
  await line.click();
  await line.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  return { panel, line };
}

test('Tokens: { asks for a value, the line shows it as a token, the result line says what it shows, and the keyboard removes it', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  await page.keyboard.type('Lights: {');
  await page.getByRole('option', { name: /Lights On/ }).click();
  await expect(line).toContainText('Lights On');
  await page.keyboard.type(' on');
  await expect(result(page)).toContainText('Shows Lights: 18 on');
  await snap(page, `${prefix(page)}-x-tokens`);
  // A token is read in place, and Backspace selects it before removing it.
  await expect(line.locator('.w2-token').first()).toHaveAccessibleName(/value: Lights On/);
  for (let at = 0; at < 3; at += 1) await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(line.locator('.w2-token[data-selected]')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(line.locator('.w2-token')).toHaveCount(0);
  // Braces are refused, with the reason.
  await page.keyboard.type('}');
  await expect(panel.getByText("Text can't contain { or }.")).toBeVisible();
});

test('Tokens: Insert a Value opens the picker, a token opens its settings, and Done is one step', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  await expect(line.locator('.w2-token')).toHaveCount(1);
  await line.locator('.w2-token').first().click();
  // Wide: a popover over the line; narrow: a pushed page. Either way the settings are the last on screen.
  const settings = page.getByTestId('token-settings').last();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Remove Value' })).toBeVisible();
  await snap(page, `${prefix(page)}-x-token-settings`);
  await settings.getByRole('button', { name: 'Remove Value' }).click();
  await expect(line.locator('.w2-token')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  await done(page).click();
  await expect(panel.getByRole('button', { name: /^Subtitle: Lights On\./ })).toBeVisible();
  if (!isPhone(page)) {
    await undoButton(page).click();
    await expect(panel.getByRole('button', { name: 'Subtitle value: Fixed' })).toBeVisible();
  }
});

test('While unavailable preserves Keep last and fallback through text and token edits', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  const fallback = panel.getByRole('textbox', { name: 'If unavailable', exact: true });
  await fallback.fill('No reading');
  const policy = panel.getByRole('combobox', { name: 'While unavailable' });
  await expect(policy).toHaveText('Show fallback');
  await policy.click();
  await page.getByRole('option', { name: 'Keep last', exact: true }).click();
  await expect(panel.getByText('Until the first answer, the fallback is shown.')).toBeVisible();
  await line.click();
  await line.press('End');
  await page.keyboard.type(' now');
  await expect(fallback).toHaveValue('No reading');
  await expect(policy).toHaveText('Keep last');
  const showAs = panel.getByRole('combobox', { name: 'Show as', exact: true });
  const changeTo = (await showAs.textContent())?.includes('Number') ? 'Text' : 'Number';
  await showAs.click();
  await page.getByRole('option', { name: changeTo, exact: true }).click();
  await expect(fallback).toHaveValue('No reading');
  await expect(policy).toHaveText('Keep last');
  await expect(done(page)).toBeEnabled();
  await done(page).click();
  await panel.getByRole('button', { name: /^Subtitle:/ }).click();
  await expect(panel.getByRole('textbox', { name: 'If unavailable', exact: true })).toHaveValue('No reading');
  await expect(panel.getByRole('combobox', { name: 'While unavailable' })).toHaveText('Keep last');
  await panel.getByRole('combobox', { name: 'While unavailable' }).click();
  await page.getByRole('option', { name: 'Show fallback', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'While unavailable' })).toHaveText('Show fallback');
  await done(page).click();
});

test('While unavailable works in Rules and survives rule edits, mode changes and template save', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  await panel.getByRole('combobox', { name: 'Show as', exact: true }).click();
  await page.getByRole('option', { name: 'Text', exact: true }).click();
  await panel.getByRole('radio', { name: 'Rules', exact: true }).click();
  const fallback = panel.getByRole('textbox', { name: 'If unavailable', exact: true });
  const policy = panel.getByRole('combobox', { name: 'While unavailable' });
  await expect(policy).toHaveText('Show fallback');
  await fallback.fill('No reading');
  await policy.click();
  await page.getByRole('option', { name: 'Keep last', exact: true }).click();
  await panel.getByRole('button', { name: /^Rule 1 of 1: if no condition yet/ }).click();
  await panel.getByRole('button', { name: 'Entity', exact: true }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  const then = panel.getByRole('textbox', { name: 'Subtitle, Rule 1', exact: true });
  await then.click();
  await then.press('End');
  await page.keyboard.type(' guests');
  await panel.getByRole('button', { name: 'Subtitle', exact: true }).first().click();
  await panel.getByRole('radio', { name: 'Rules', exact: true }).click();
  await panel.getByRole('button', { name: 'More for Rule 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(panel.getByRole('button', { name: /^Rule 2 of 2: if/ })).toBeVisible();
  await expect(policy).toHaveText('Keep last');
  await expect(fallback).toHaveValue('No reading');
  await panel.getByRole('radio', { name: 'From Entity', exact: true }).click();
  await expect(line.locator('.w2-token')).toHaveCount(1);
  await expect(policy).toHaveText('Keep last');
  await panel.getByRole('radio', { name: 'Rules', exact: true }).click();
  await expect(policy).toHaveText('Keep last');
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save as Logic Template…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as Logic Template', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Retained Reading');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(policy).toHaveText('Keep last');
  await expect(fallback).toHaveValue('No reading');
  await expect(line.locator('.w2-token')).toContainText('Retained Reading');
  await expect(done(page)).toBeEnabled();
  await done(page).click();
  await panel.getByRole('button', { name: /^Subtitle:/ }).click();
  await expect(panel.getByRole('combobox', { name: 'While unavailable' })).toHaveText('Keep last');
  await expect(panel.getByRole('textbox', { name: 'If unavailable', exact: true })).toHaveValue('No reading');
  await done(page).click();
});

test('While unavailable survives Rules to Fixed, apply, and inline editing', async ({ page, request }) => {
  const tile = [...buildDocumentIndex(climate).entries.values()].find(entry => entry.node?.title === 'Room Thermostats');
  expect(tile).toBeDefined();
  const document = replaceAt(climate, [...tile!.path, 'props', 'subtitle'], {
    type: 'expr', value: { type: 'choose', cases: [{ when: { type: 'viewer', isAdmin: true }, then: { type: 'literal', value: 'Administrator' } }],
      otherwise: { type: 'literal', value: 'Guest' } },
    fallback: 'No reading', whenUnavailable: 'keep',
  });
  await seed(request, document);
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Room Thermostats');
  await full(page);
  await panel.getByRole('button', { name: /^Subtitle: 1 rule/ }).click();
  await expect(panel.getByRole('combobox', { name: 'While unavailable' })).toHaveText('Keep last');
  await panel.getByRole('radio', { name: 'Fixed', exact: true }).click();
  await done(page).click();
  const inline = panel.getByRole('textbox', { name: 'Subtitle', exact: true });
  await expect(inline).toHaveValue('Guest');
  await inline.fill('Guest updated inline');
  await panel.getByRole('button', { name: 'Subtitle value: Fixed', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /From Entity/ }).click();
  await expect(panel.getByRole('combobox', { name: 'While unavailable' })).toHaveText('Keep last');
  await expect(panel.getByRole('textbox', { name: 'If unavailable', exact: true })).toHaveValue('No reading');
  await expect(panel.getByRole('textbox', { name: 'Subtitle', exact: true })).toHaveText('Guest updated inline');
  await done(page).click();
});

test('Try Values: an override changes the result line and tags it Test, Reset to Live undoes it, and closing the page clears it', async ({ page }) => {
  const panel = await openOnlyShowWhen(page);
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  await expect(result(page)).toContainText('Yes · Guest Mode is On right now');
  await panel.getByRole('button', { name: 'Try Values' }).click();
  await panel.getByRole('combobox', { name: 'Guest Mode for Try Values' }).click();
  await page.getByRole('option', { name: 'Unavailable' }).click();
  await expect(result(page)).toContainText('Waiting for Home Assistant');
  await expect(page.getByTestId('result-line').getByText('Test', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Nothing is saved or sent to Home Assistant/)).toBeVisible();
  await snap(page, `${prefix(page)}-x-preview`);
  await panel.getByRole('button', { name: 'Reset to Live' }).click();
  await expect(result(page)).toContainText('Yes · Guest Mode is On right now');
  await panel.getByRole('combobox', { name: 'Guest Mode for Try Values' }).click();
  await page.getByRole('option', { name: 'Unavailable' }).click();
  // Closing the page ends the test values and writes nothing.
  // The wide inspector has Cancel; the phone sheet has Back.
  await (isPhone(page) ? page.locator('.w2-back') : page.getByRole('button', { name: 'Cancel', exact: true })).click();
  await page.getByRole('button', { name: 'Discard Changes' }).click({ timeout: 2000 }).catch(() => {});
  await expect(panel.getByRole('button', { name: /^Only show when: Always/ })).toBeVisible();
  await panel.getByRole('button', { name: /^Only show when/ }).click();
  await expect(page.getByRole('combobox', { name: /for Try Values/ })).toHaveCount(0);
});

test('Undo inside the editor steps the draft, never the document, and Done is one document step', async ({ page }) => {
  test.skip(isPhone(page), 'The full-height sheet covers the top bar on a phone; Back and Discard changes? are tested instead');
  const panel = await openOnlyShowWhen(page);
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  await chooseState(page, panel, 'Off');
  await expect(result(page)).toContainText('No · Guest Mode is On right now');
  // Undo while the editor is open goes back in the editor.
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(result(page)).toContainText('Yes · Guest Mode is On right now');
  await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeEnabled();
  await page.getByRole('button', { name: /^Redo/ }).first().click();
  await expect(result(page)).toContainText('No · Guest Mode is On right now');
  await done(page).click();
  // The editor is closed: Undo is the document's, and one press removes the whole condition.
  await expect(panel.getByRole('button', { name: /^Only show when: Guest Mode is off/ })).toBeVisible();
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect(panel.getByRole('button', { name: /^Only show when/ })).toContainText('Always');
});

test('Discard changes? appears when leaving a page with changes, and Keep Editing stays', async ({ page }) => {
  const panel = await openOnlyShowWhen(page);
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  await (isPhone(page) ? page.locator('.w2-back') : page.getByRole('button', { name: 'Cancel', exact: true })).click();
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(panel.getByTestId('simple-condition')).toBeVisible();
  await (isPhone(page) ? page.locator('.w2-back') : page.getByRole('button', { name: 'Cancel', exact: true })).click();
  await page.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(panel.getByRole('button', { name: /^Only show when: Always/ })).toBeVisible();
});

const families = [
  { name: 'iPhone', width: 390, height: 844 }, { name: 'Duo folded', width: 669, height: 951 }, { name: 'Duo wide', width: 951, height: 669 },
  { name: 'iPad portrait', width: 820, height: 1180 }, { name: 'iPad landscape', width: 1180, height: 820 }, { name: 'Desktop', width: 1440, height: 900 },
];

/** Every control inside `root` that is on screen and has no accessible name. */
const unnamed = (root: Locator) => root.evaluate(element => {
  const out: string[] = [];
  for (const control of element.querySelectorAll<HTMLElement>('button, [role=radio], [role=combobox], [role=textbox], input, [role=switch]')) {
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height || control.closest('[hidden], [inert], [aria-hidden=true]') || control.getAttribute('aria-hidden') === 'true') continue;
    const name = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim() || (control as HTMLInputElement).placeholder;
    if (!name) out.push(control.outerHTML.slice(0, 80));
  }
  return out;
});

for (const family of families) {
  test(`${family.name} ${family.width}x${family.height}: the condition editor has names, roles and no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: family.width, height: family.height });
    const panel = await openOnlyShowWhen(page);
    await panel.getByRole('button', { name: 'Entity', exact: true }).click();
    await page.getByRole('option', { name: /Guest Mode/ }).click();
    await expect(panel.getByRole('button', { name: 'Entity', exact: true })).toHaveText('Guest Mode');
    await expect(panel.getByRole('combobox', { name: 'Comparison', exact: true })).toHaveText('is');
    await expect(panel.getByRole('button', { name: 'Value', exact: true })).toHaveText('On');
    await expect(panel.getByRole('radiogroup', { name: 'Condition view' })).toHaveCount(0);
    await expect(page.getByTestId('result-line')).toHaveAttribute('role', 'status');
    expect(await unnamed(panel)).toEqual([]);
    // No horizontal scroll in the inspector, and no control cut off at its right edge.
    const overflow = await panel.evaluate(element => { const scroller = element.closest<HTMLElement>('.w2-sheet-content, .w2-inspector, [role=complementary]') ?? element; return Math.max(element.scrollWidth - element.clientWidth, scroller.scrollWidth - scroller.clientWidth); });
    expect(overflow).toBeLessThanOrEqual(1);
    // Under a coarse pointer every row, chip, segment and menu button is 44 px.
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const small = await panel.evaluate(element => [...element.querySelectorAll<HTMLElement>('button, [role=radio], [role=combobox]')].filter(control => { const box = control.getBoundingClientRect(); return box.width > 0 && (box.height < 43.5 || box.width < 43.5); }).map(control => `${control.getAttribute('aria-label') ?? control.textContent?.trim()} ${Math.round(control.getBoundingClientRect().width)}x${Math.round(control.getBoundingClientRect().height)}`));
      expect(small).toEqual([]);
    }
    await snap(page, `x-viewport-${family.width}x${family.height}`);
    await panel.getByRole('button', { name: '+ And…', exact: true }).click();
    const canvas = page.locator('.w2-logic-overlay .w2-canvas[data-panel]');
    const palette = page.getByRole('button', { name: 'Close block palette', exact: true });
    if (await palette.isVisible()) await palette.click();
    await expect(canvas.getByRole('button', { name: /^Select Entity State/ })).toHaveCount(2);
    await expect(canvas.getByRole('button', { name: /^Select All Of/ })).toHaveCount(1);
    expect(await unnamed(canvas)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('with reduced motion no transform transition runs on a row, a fold or the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openOnlyShowWhen(page);
  await panel.getByRole('button', { name: 'Entity', exact: true }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).click();
  await panel.getByRole('button', { name: 'Try Values', exact: true }).click();
  await expect(panel.getByTestId('simple-condition')).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Guest Mode for Try Values' })).toBeVisible();
  const moving = await panel.evaluate(element => [...element.querySelectorAll<HTMLElement>('.w2-picker-row, .w2-expr-chev, .w2-expr-try')]
    .filter(item => /transform/.test(getComputedStyle(item).transitionProperty) && parseFloat(getComputedStyle(item).transitionDuration) > 0).map(item => item.className));
  expect(moving).toEqual([]);
});

test('a tab offers Only show when and Badge with names a screen reader can say', async ({ page }) => {
  await openWorkspace(page);
  await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
  await page.getByRole(isPhone(page) ? 'button' : 'menuitem', { name: 'Tabs', exact: true }).click();
  const panel = page.getByLabel('Properties');
  await panel.locator('.w2-tab-open').first().click();
  await expect(panel.getByRole('button', { name: /^Only show when/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Badge/ }).or(panel.getByRole('group', { name: /^Badge/ })).first()).toBeVisible();
  const box = await panel.getByRole('button', { name: /^Only show when/ }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(isPhone(page) ? 44 : 24);
  await snap(page, `${prefix(page)}-x-places-tab`);
});
