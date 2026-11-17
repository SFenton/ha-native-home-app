import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { addStateTile, duplicateStyle, newStateTile } from '../../src/shared/composition/state-style-library';
import { builtInStyle } from '../../src/shared/composition/state-styles';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

/**
 * TC4 and TC4c in the inspector: a text value's "Capital letters" choice gains "Capitalize each word" (`words`, `sh.text-case-words@1`), and a color field
 * can differ in dark mode, a Light and a Dark color of the same field (`solid-appearance`, `sh.solid-appearance@1`), drawn by the preview with the
 * preview's own appearance.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { navigation: Record<string, unknown> } };
const climate = { ...fixture.document, navigation: { ...fixture.document.navigation, initialTabId: 'hc-tab-climate', initialPageId: 'page-climate' } };
test.beforeEach(async ({ request }) => { await seed(request); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
async function stubHouse(page: Page) {
  const states = [
    { entityId: 'sensor.demo_issue', name: 'Vacuum Issue', state: 'wheel stuck' },
    { entityId: 'sensor.demo_mode', name: 'Climate Mode', state: 'heat_cool' },
    { entityId: 'light.demo_study', name: 'Study Light', state: 'on' },
  ];
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}
const result = (page: Page) => page.getByRole('status').filter({ hasText: /now\.|tell yet|Waiting|Not connected|Now: |Shows / }).first();

async function openSubtitleLine(page: Page, request: APIRequestContext) {
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

test('Tokens: Capital letters offers each word, and a space or an underscore ends a word', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = () => line.locator('.w2-token').first();
  const settings = () => page.getByTestId('token-settings').last();
  async function shows(text: string, not?: string) {
    if (isPhone(page)) await page.locator('.w2-back').click();
    await expect(result(page)).toContainText(text);
    if (not) await expect(result(page)).not.toContainText(not);
    if (isPhone(page)) await token().click();
  }
  const choose = async (name: string) => { await settings().getByRole('combobox', { name: 'Capital letters' }).click(); await page.getByRole('option', { name }).click(); };
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Vacuum Issue/ }).click();
  await token().click();
  await shows('Shows wheel stuck');
  await expect(settings().getByRole('combobox', { name: 'Capital letters' })).toContainText('As written');
  await choose('Capitalize each word');
  await shows('Shows Wheel Stuck');
  await expect(settings().getByText('A space or an underscore ends a word: wheel stuck reads Wheel Stuck.')).toBeVisible();
  await snap(page, `${prefix(page)}-words-case`);
  await choose('Capitalize after underscores');
  await shows('Shows Wheel stuck');
  await expect(settings().getByText(/Only an underscore ends a word/)).toBeVisible();
  await snap(page, `${prefix(page)}-title-case`);
  await choose('As written');
  await shows('Shows wheel stuck');
  await choose('Capitalize each word');
  await shows('Shows Wheel Stuck');
  // The choice is saved in the text: the preview draws it.
  await settings().getByRole('button', { name: 'Remove Value' }).click();
});

test('Tokens: the choice follows a text value only, and is the same for an underscore state', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = () => line.locator('.w2-token').first();
  const settings = () => page.getByTestId('token-settings').last();
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Climate Mode/ }).click();
  await token().click();
  await settings().getByRole('combobox', { name: 'Capital letters' }).click();
  await expect(page.getByRole('option')).toHaveText(['As written', 'Capitalize each word', 'Capitalize after underscores']);
  await page.getByRole('option', { name: 'Capitalize each word' }).click();
  if (isPhone(page)) await page.locator('.w2-back').click();
  await expect(result(page)).toContainText('Shows Heat Cool');
});

/** The chip "Lights": its fill is the standard one until a color is chosen, and the preview chip is that fill's tile. */
async function openChipFill(page: Page) {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  await full(page);
  return panel;
}
const chip = (page: Page) => previewRoot(page).locator('.sh-chip').first();
const backgroundOf = (page: Page, scheme?: 'light' | 'dark') => chip(page).evaluate((element, forced) => {
  if (forced) (element as HTMLElement).style.colorScheme = forced;
  const color = getComputedStyle(element).backgroundColor;
  (element as HTMLElement).style.colorScheme = '';
  return color;
}, scheme);
/** On a phone the color picker is a page pushed over the inspector: go back to the fields. */
const back = async (page: Page) => { if (isPhone(page)) await page.locator('.w2-back').last().click(); else await page.keyboard.press('Escape'); };

test('Colors: a fill can differ in dark mode, with a Light and a Dark color of the same field', async ({ page }) => {
  const panel = await openChipFill(page);
  await panel.getByRole('button', { name: /^Fill/ }).first().click();
  await page.getByRole('radio', { name: 'Orange' }).click();
  await back(page);
  const sw = panel.getByRole('switch', { name: 'Fill differs in dark mode' });
  await expect(sw).not.toBeChecked();
  await expect.poll(() => backgroundOf(page)).toBe('rgb(255, 149, 0)');
  await sw.check();
  await expect(panel.getByRole('group', { name: 'Fill' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Fill in light mode' })).toContainText('Orange');
  await expect(panel.getByRole('button', { name: 'Fill in dark mode' })).toContainText('Orange');
  await panel.getByRole('button', { name: 'Fill in dark mode' }).click();
  await page.getByRole('radio', { name: 'Indigo' }).click();
  await back(page);
  await expect(panel.getByRole('button', { name: 'Fill in dark mode' })).toContainText('Indigo');
  await expect(panel.getByRole('button', { name: 'Fill in light mode' })).toContainText('Orange');
  await snap(page, `${prefix(page)}-color-pair`);
  // The preview is dark, so it draws the Dark color; the same chip under a light color-scheme draws the Light one.
  await expect.poll(() => backgroundOf(page)).toBe('rgb(88, 86, 214)');
  expect(await backgroundOf(page, 'light')).toBe('rgb(255, 149, 0)');
  // Turning the switch off keeps the Light color.
  await sw.uncheck();
  await expect(panel.getByRole('button', { name: 'Fill', exact: true })).toContainText('Orange');
  await expect.poll(() => backgroundOf(page)).toBe('rgb(255, 149, 0)');
});

test('Colors: a state style fill can be a pair, and the tile draws the one for the preview\'s appearance', async ({ page, request }) => {
  const home = fixture.document as unknown as { pages: { id: string }[] };
  const copy = duplicateStyle(undefined, builtInStyle('garage-door')!, 'Garage look');
  const garage = { ...newStateTile('cover.demo_garage', 'Demo Garage', 'garage', undefined)!, id: 'demo-garage', binding: { entityId: 'cover.demo_garage', styleId: copy.id, builtIn: 'garage-door' as const } };
  await seed(request, { ...(addStateTile(home as never, home.pages[0].id, garage as never) as object), stateStyles: copy.library });
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} },
    states: [{ entityId: 'cover.demo_garage', name: 'Demo Garage', state: 'closed', deviceClass: 'garage' }] } }));
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'State Styles' }).or(page.getByRole('button', { name: 'State Styles' })).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /^Garage look/ }).click();
  await panel.getByRole('button', { name: /^Closed/ }).click();
  const tile = previewRoot(page).locator('[data-sel="node:demo-garage"] .sh-state-tile, [data-sel="node:demo-garage"].sh-state-tile').first();
  const paint = (scheme?: 'light') => tile.evaluate((element, forced) => {
    if (forced) (element as HTMLElement).style.colorScheme = forced;
    const color = getComputedStyle(element).backgroundColor;
    (element as HTMLElement).style.colorScheme = '';
    return color;
  }, scheme);
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByRole('radio', { name: 'Teal' }).click();
  await back(page);
  await panel.getByRole('switch', { name: 'Fill differs in dark mode' }).check();
  await panel.getByRole('button', { name: 'Fill in dark mode' }).click();
  await page.getByRole('radio', { name: 'Pink' }).click();
  await back(page);
  await snap(page, `${prefix(page)}-state-style-pair`);
  await expect.poll(() => paint()).toBe('rgb(255, 45, 85)');
  expect(await paint('light')).toBe('rgb(48, 176, 199)');
});
