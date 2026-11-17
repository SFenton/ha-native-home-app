import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The condition and value editors for the four grammar additions the climate controls need (CT1): Read offers Raw State (A2) and, for a list attribute,
 * its count and "includes" (A1); a number token can keep its trailing zeros (N1) and a text token capitalize each word (T1).
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { navigation: Record<string, unknown> } };
const climate = { ...fixture.document, navigation: { ...fixture.document.navigation, initialTabId: 'hc-tab-climate', initialPageId: 'page-climate' } };
test.beforeEach(async ({ request }) => { await seed(request); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
async function stubHouse(page: Page) {
  const states = [
    { entityId: 'input_boolean.demo_guests', name: 'Guest Mode', state: 'on' },
    { entityId: 'sensor.demo_count', name: 'Lights On', state: '18' },
    { entityId: 'sensor.demo_mode', name: 'Climate Mode', state: 'heat_cool' },
    { entityId: 'fan.demo_bath_fan', name: 'Bath Fan', state: 'on', presetModes: ['auto', 'sleep'] },
    { entityId: 'input_boolean.demo_entity_122', name: 'Spare Room Occupied', state: 'on' },
    { entityId: 'input_boolean.demo_entity_123', name: 'Attic Occupied', state: 'on' },
  ];
  await page.route('**/api/native-home', route => route.fulfill({ json: { mode: 'live', houseConfig: { schema: 2, hash: 'a'.repeat(64), config: {} }, states } }));
}
const result = (page: Page) => page.getByRole('status').filter({ hasText: /now\.|tell yet|Waiting|Not connected|Now: |Shows / }).first();

async function openCondition(page: Page) {
  await stubHouse(page);
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1');
  await full(page);
  await panel.getByRole('button', { name: /^Only show when/ }).click();
  await panel.getByRole('button', { name: 'Entity' }).click();
  await page.getByRole('option', { name: /Bath Fan/ }).first().click();
  return panel;
}
async function chooseRead(page: Page, panel: ReturnType<Page['getByLabel']>, name: string | RegExp) {
  await panel.getByRole('combobox', { name: 'Read', exact: true }).click();
  await page.getByRole('option', { name }).click();
}

test('Conditions: Read offers Raw State, which tells Unavailable from not being able to tell', async ({ page }) => {
  const panel = await openCondition(page);
  await chooseRead(page, panel, 'Raw State');
  await expect(panel.getByText(/Says Unknown or Unavailable/)).toBeVisible();
  // Raw State starts at "unknown"; the fan is on, so the condition is not true.
  await expect(panel.getByRole('button', { name: 'unknown', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(result(page)).toContainText('Hidden now.');
  await panel.getByRole('button', { name: 'unavailable', exact: true }).click();
  await expect(result(page)).toContainText('Hidden now.');
  await panel.getByRole('button', { name: 'Try Values' }).click();
  await panel.getByRole('combobox', { name: 'Bath Fan for Try Values' }).click();
  await page.getByRole('option', { name: 'Unavailable' }).click();
  // The plain read cannot tell here; the raw read can, and says the fan is unavailable.
  await expect(result(page)).toContainText('Shown now.');
  await snap(page, `${prefix(page)}-x-raw-state`);
});

test('Conditions: a list attribute offers its count and "includes", and the result line follows', async ({ page }) => {
  const panel = await openCondition(page);
  await panel.getByRole('combobox', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('option', { name: 'preset_modes · Number of Items' })).toBeVisible();
  await page.getByRole('option', { name: 'preset_modes · Includes…' }).click();
  const item = panel.getByRole('textbox', { name: 'Item' });
  await item.fill('sleep');
  await item.press('Enter');
  await expect(result(page)).toContainText('Shown now.');
  await item.fill('turbo');
  await item.press('Enter');
  await expect(result(page)).toContainText('Hidden now.');
  await snap(page, `${prefix(page)}-x-list-includes`);
  await chooseRead(page, panel, 'preset_modes · Number of Items');
  // A count starts as "is above 0": the fan offers two modes.
  await expect(result(page)).toContainText('Shown now.');
  await expect(panel.getByRole('combobox', { name: 'Comparison' })).toContainText('is above');
});

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

test('Tokens: a number keeps its trailing zeros, and a text capitalizes each word', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = () => line.locator('.w2-token').first();
  const settings = () => page.getByTestId('token-settings').last();
  /** Wide, the result line stays beside the settings; on a phone the settings are a pushed page, so go back to read it and open them again. */
  async function shows(text: string, not?: string) {
    if (isPhone(page)) await page.locator('.w2-back').click();
    await expect(result(page)).toContainText(text);
    if (not) await expect(result(page)).not.toContainText(not);
    if (isPhone(page)) await token().click();
  }
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Lights On/ }).click();
  await token().click();
  await settings().getByRole('combobox', { name: 'Show as' }).click();
  await page.getByRole('option', { name: 'Number' }).click();
  await settings().getByRole('button', { name: 'More decimals' }).click();
  await settings().getByRole('button', { name: 'More decimals' }).click();
  await shows('Shows 18', '18.0');
  await settings().getByRole('switch', { name: 'Keep trailing zeros' }).check();
  await shows('Shows 18.0');
  await snap(page, `${prefix(page)}-x-keep-zeros`);
  // A text value: the state heat_cool reads as words.
  await settings().getByRole('button', { name: 'Remove Value' }).click();
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('option', { name: /Climate Mode/ }).click();
  await token().click();
  await shows('Shows heat_cool');
  await settings().getByRole('combobox', { name: 'Capital letters' }).click();
  await page.getByRole('option', { name: 'Capitalize after underscores' }).click();
  await shows('Shows Heat Cool');
  await snap(page, `${prefix(page)}-x-capitalize`);
});
