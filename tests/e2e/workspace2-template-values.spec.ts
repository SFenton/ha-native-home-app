import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * Templates, any field (templates spec "any field", `sh.component-values@1`): Choose Fields, its boxes, the one edit question, the tick menu, and a
 * place filling its own value in the field's own editor. The fixture is home-domains with a template of two state tiles ("Lamp Pair") used in two places.
 * Every entity is invented. The value settings written here are read back from the draft, since the preview does not show them.
 */
const lamps = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps.json', import.meta.url), 'utf8')) as { document: object };

const panel = (page: Page) => page.getByLabel('Properties');
const bar = (page: Page) => panel(page).getByTestId('choose-bar');
const question = (page: Page) => page.getByTestId('linked-question');
const fullSheet = async (page: Page) => { if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))); };
const clearSheet = async (page: Page) => { if (isPhone(page) && await panel(page).count()) { await panel(page).getByRole('button', { name: 'Close' }).first().click(); await expect(panel(page)).toHaveCount(0); } };
/** Selects a tile inside a place, which shows its own fields under the template's banner. */
async function selectInner(page: Page, title: string, at = 0) {
  await clearSheet(page);
  await previewRoot(page).getByText(title, { exact: true }).nth(at).click();
  await expect(panel(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
  await fullSheet(page);
}
async function selectPlace(page: Page, at = 0) {
  await clearSheet(page);
  await previewRoot(page).getByText('Demo Lamps', { exact: true }).nth(at).click();
  await expect(panel(page).getByRole('heading', { name: 'Lamp Pair', exact: true })).toBeVisible();
  await fullSheet(page);
}
const start = (page: Page) => panel(page).getByRole('button', { name: 'Choose Fields…' });
/** A row's box: a checkbox, or (when the row could share a setting) the button that opens the tick menu drawn as the same box. */
const box = (page: Page, field: string) => panel(page).locator(`[data-tick][aria-label="Set ${field} per place"]`);
async function update(page: Page) {
  await expect(question(page)).toBeVisible();
  await question(page).getByRole('button', { name: 'Update Template' }).click();
  await expect(question(page)).toHaveCount(0);
}
/** The draft as the server holds it once the autosave has landed. */
type Draft = { componentLibrary: { params?: { name: string; kind: string; label?: string }[]; bindings?: { param: string; nodeId?: string; field: string }[] }[];
  pages: { components: { id: string; type: string; values?: Record<string, unknown>; args?: Record<string, string> }[] }[] };
const draft = async (request: APIRequestContext) => ((await (await request.get('/native/api/draft')).json()) as { document: Draft }).document;
const places = (document: Draft) => document.pages.flatMap(page => page.components).filter(node => node.type === 'component-ref');
const tag = (page: Page) => (isPhone(page) ? 'phone' : 'desktop');

test('Choose Fields… puts a box on every row of a state tile; Done and Escape return focus to the button', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await expect(bar(page)).toHaveCount(0);
  await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
  await start(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('aria-label', 'Choose fields');
  await expect(bar(page)).toContainText('Select the fields each place sets.');
  for (const field of ['Title', 'Subtitle', 'Icon', 'Entity', 'Icon color', 'Badge', 'Progress']) await expect(box(page, field), field).toBeVisible();
  expect(await panel(page).getByRole('checkbox').count()).toBeGreaterThanOrEqual(12);
  await expect(box(page, 'Title')).toBeFocused();
  await expect(panel(page).getByRole('group', { name: 'Fields each place sets' }).first()).toBeVisible();
  // The Advanced rows are in the group too.
  await panel(page).getByRole('button', { name: /^Advanced/ }).click();
  await expect(panel(page).getByRole('group', { name: 'Fields each place sets' }).last().getByRole('checkbox').first()).toBeVisible();
  await panel(page).getByRole('button', { name: /^Advanced/ }).click();
  // the row itself is held inert while its box is the control, and no box is ticked yet
  await expect(panel(page).locator('[data-choose] [inert]').first()).toBeAttached();
  await expect(panel(page).getByRole('checkbox', { checked: true })).toHaveCount(0);
  await snap(page, `${tag(page)}-template-choose`);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(start(page)).toBeFocused();
  await start(page).click();
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(start(page)).toBeFocused();
});

test('the first tick asks once, later ticks do not, and the line and the list say what each place sets', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, 'Icon color').click();
  await expect(question(page).getByRole('heading', { name: 'Update “Lamp Pair” everywhere?' })).toBeVisible();
  await update(page);
  await expect(box(page, 'Icon color')).toBeChecked();
  await expect(panel(page).getByTestId('per-place-line')).toHaveText(/Set per place as Icon color\./);
  await box(page, 'Subtitle').click();
  await expect(question(page)).toHaveCount(0);
  await expect(box(page, 'Subtitle')).toBeChecked();
  await expect(panel(page).getByTestId('component-parameters')).toContainText('Each place sets (2)');
  await expect(panel(page).getByTestId('component-parameters')).toContainText('Icon color of Demo Lamp');
  // unticking is Same Everywhere: the setting goes with its last field
  await box(page, 'Icon color').click();
  await expect(box(page, 'Icon color')).not.toBeChecked();
  await expect(panel(page).getByTestId('component-parameters')).toContainText('Each place sets (1)');
  await snap(page, `${tag(page)}-template-choose-set`);
  await expect.poll(async () => (await draft(request)).componentLibrary[0].params?.map(param => `${param.kind}:${param.label}`)).toEqual(['value:Subtitle']);
});

test('Escape closes the edit question and leaves Choose Fields open; the change is not made', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, 'Icon color').click();
  await expect(question(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(question(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(box(page, 'Icon color')).not.toBeChecked();
  await expect(page.getByTestId('linked-status')).not.toHaveText('Icon color is set per place.');
  expect((await draft(request)).componentLibrary[0].params).toBeUndefined();
});

test('Escape closes the Publish question and leaves Choose Fields open', async ({ page, request }) => {
  test.skip(isPhone(page), 'Publish is in the top bar, which the open sheet covers on a phone; the unit test renders the same Modal');
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await expect(bar(page)).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: /Publish/ });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
});

test('ticking and unticking are spoken in the polite line', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  // The first tick asks, and the answer says what it did; the ticks after it speak for themselves.
  await box(page, 'Title').click();
  await update(page);
  await box(page, 'Subtitle').click();
  await expect(page.getByTestId('linked-status')).toHaveText('Subtitle is set per place.');
  await box(page, 'Subtitle').click();
  await expect(page.getByTestId('linked-status')).toHaveText('Subtitle is the same everywhere.');
});

test('the tick menu offers only the settings a row can share, and Use fills a second field from one setting', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, 'Subtitle').click();
  await update(page);
  await box(page, 'Icon color').click();
  await expect(box(page, 'Icon color')).toBeChecked();
  // another tile of the template: its Subtitle has the same shape as the first setting, its Icon color does not share a setting of another shape
  await selectInner(page, 'Demo Fan');
  await expect(bar(page)).toBeVisible();
  await box(page, 'Subtitle').click();
  const menu = page.getByTestId('tick-menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Use Subtitle', 'New Setting']);
  await snap(page, `${tag(page)}-template-tick-menu`);
  await menu.getByRole('menuitem', { name: 'Use Subtitle' }).click();
  // The box turns from the menu button into a checkbox, and focus goes with it.
  if (!isPhone(page)) await expect(box(page, 'Subtitle')).toBeFocused();
  // On a phone, closing the sheet to reach the next tile ended the edit session, so the change asks again.
  if (isPhone(page)) await update(page);
  await expect(box(page, 'Subtitle')).toBeChecked();
  await expect.poll(async () => (await draft(request)).componentLibrary[0].bindings?.filter(binding => binding.field === 'props/subtitle').length).toBe(2);
  expect((await draft(request)).componentLibrary[0].params).toHaveLength(2);
});

test('a place sets its own value in the field\'s editor, Reset returns the template\'s, and a template change reaches only the places that follow it', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, 'Subtitle').click();
  await update(page);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await selectPlace(page, 1);
  const row = panel(page).getByTestId('place-value');
  await expect(row).toHaveAttribute('aria-label', 'Subtitle');
  await expect(row.getByText('Differs from the template.')).toHaveCount(0);
  await snap(page, `${tag(page)}-template-place-value`);
  await row.getByRole('button', { name: 'Add Subtitle' }).click();
  await expect(row.getByText('Differs from the template.')).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  await expect.poll(async () => places(await draft(request)).map(node => Object.keys(node.values ?? {}).length)).toEqual([0, 1]);
  await snap(page, `${tag(page)}-template-place-value-own`);
  await row.getByRole('button', { name: 'Use the template’s Subtitle' }).click();
  await expect(row.getByText('Differs from the template.')).toHaveCount(0);
  await expect.poll(async () => places(await draft(request)).map(node => node.values)).toEqual([undefined, undefined]);
  // set it again, then change the template's own Subtitle: the place that follows it takes the change, the one that chose its own keeps its own
  await row.getByRole('button', { name: 'Add Subtitle' }).click();
  await selectInner(page, 'Demo Lamp');
  await panel(page).getByRole('button', { name: 'Add Subtitle' }).click();
  await update(page);
  await expect.poll(async () => {
    const document = await draft(request);
    const [first, second] = places(document);
    return { library: JSON.stringify(document.componentLibrary[0]).includes('"subtitle"'), first: first.values, second: Object.keys(second.values ?? {}).length };
  }).toEqual({ library: true, first: undefined, second: 1 });
});

test('Use mode shows no button, no boxes and no Same Everywhere, and the lines stay as captions', async ({ page, request }) => {
  test.skip(isPhone(page), 'In Use a tap on a phone operates the simulated tile and opens no inspector; the unit test covers the same rows');
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, 'Subtitle').click();
  await update(page);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await expect(panel(page).getByRole('button', { name: 'Same Everywhere: Subtitle' })).toBeVisible();
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await expect(start(page)).toHaveCount(0);
  await expect(panel(page).getByRole('checkbox')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Same Everywhere: Subtitle' })).toHaveCount(0);
  await expect(panel(page).getByTestId('per-place-line')).toContainText('Set per place as Subtitle.');
});

test('choosing stays across the nodes of the template and ends when something else is selected', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await expect(bar(page)).toBeVisible();
  // another node of the same template keeps the mode
  await selectInner(page, 'Demo Fan');
  await expect(bar(page)).toBeVisible();
  // a node that is not in the template ends it, and it stays ended
  await clearSheet(page);
  await previewRoot(page).getByText('Lights', { exact: true }).first().click();
  await expect(panel(page).getByTestId('choose-bar')).toHaveCount(0);
  await selectInner(page, 'Demo Fan');
  await expect(bar(page)).toHaveCount(0);
});

/** Sets one field of the first tile per place, then opens the second place on that setting's row. */
async function setThenOpenSecondPlace(page: Page, field: string) {
  await selectInner(page, 'Demo Lamp');
  await start(page).click();
  await box(page, field).click();
  await update(page);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await selectPlace(page, 1);
  return panel(page).getByTestId('place-value');
}
const back = async (page: Page) => { if (isPhone(page)) await page.locator('.w2-back').last().click(); else await page.keyboard.press('Escape'); };

test('a place sets its own color in the color picker; the other place keeps the template\'s', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  const row = await setThenOpenSecondPlace(page, 'Icon color');
  await expect(row).toHaveAttribute('aria-label', 'Icon color');
  await row.getByRole('button', { name: 'Add Icon color' }).click();
  await row.getByRole('button', { name: 'Icon color', exact: true }).click();
  await page.getByRole('radio', { name: 'Indigo' }).click();
  await back(page);
  await expect(row.getByText('Differs from the template.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Use the template’s Icon color' })).toBeVisible();
  await expect.poll(async () => places(await draft(request)).map(node => JSON.stringify(node.values ?? null).includes('"red":88'))).toEqual([false, true]);
  expect(places(await draft(request))[0].values).toBeUndefined();
  await snap(page, `${tag(page)}-template-place-color`);
  await row.getByRole('button', { name: 'Use the template’s Icon color' }).click();
  await expect.poll(async () => places(await draft(request)).map(node => node.values)).toEqual([undefined, undefined]);
  await expect(page.getByTestId('linked-status')).toHaveText('Icon color uses the template’s value.');
});

test('a place sets its own rule in the rule page, and Done writes it to that place alone', async ({ page, request }) => {
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states: [
    { entityId: 'input_boolean.demo_guests', name: 'Guest Mode', state: 'on' }, { entityId: 'light.demo_lamp', name: 'Hall Lamp', state: 'off' },
  ] } }));
  await seed(request, lamps.document);
  await openWorkspace(page);
  const row = await setThenOpenSecondPlace(page, 'Only show when');
  await expect(row).toHaveAttribute('aria-label', 'Only show when');
  await row.getByRole('button', { name: /^Only show when/ }).click();
  await panel(page).getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Guest Mode/ }).first().click();
  await panel(page).getByRole('button', { name: 'on', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(row.getByText('Differs from the template.')).toBeVisible();
  await expect.poll(async () => places(await draft(request)).map(node => Object.keys(node.values ?? {}).length)).toEqual([0, 1]);
  // The rule reads the entity through a data source of the document, which came with it.
  expect(JSON.stringify(await draft(request))).toContain('input_boolean.demo_guests');
  await snap(page, `${tag(page)}-template-place-rule`);
});
