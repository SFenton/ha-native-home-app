import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The editors for the edge-logic ids (lane `ne-operands`): a condition reads when an entity Last Changed (`sh.entity-time@1`), the value picker offers
 * Now to the second and an entity read as Last Changed, Seconds Until or Seconds Since (`sh.countdown@1`), a number token is shown as a duration
 * (`sh.duration-format@1`) and can cut off its decimals instead of rounding (`sh.math-truncate@1`).
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { navigation: Record<string, unknown> } };
const climate = { ...fixture.document, navigation: { ...fixture.document.navigation, initialTabId: 'hc-tab-climate', initialPageId: 'page-climate' } };
test.beforeEach(async ({ request }) => { await seed(request); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const full = (page: Page) => isPhone(page) ? page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' }))) : Promise.resolve();
/** The wall time `seconds` from now, as the timer attribute holds it: no zone, on this machine's own clock (the preview's clock is the browser's). */
function finishesIn(seconds: number) {
  const at = new Date(Date.now() + seconds * 1000), pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
async function stubHouse(page: Page) {
  const states = [
    { entityId: 'sensor.demo_count', name: 'Lights On', state: '18.46', lastChanged: '2026-11-15T21:30:00.000Z' },
    { entityId: 'fan.demo_bath_fan', name: 'Bath Fan', state: 'on', lastChanged: '2026-11-15T21:30:00.000Z', presetModes: ['auto', 'sleep'], finishesAt: finishesIn(300) },
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

test('Conditions: Read offers Last Changed, compared before or after a moment and never equal to it', async ({ page }) => {
  const panel = await openCondition(page);
  await panel.getByRole('button', { name: 'Entity', exact: true }).click();
  await page.getByRole('combobox', { name: 'Read', exact: true }).click();
  // The time of last change is its own choice, not an attribute the phone cannot read.
  await expect(page.getByRole('option', { name: /last_changed/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Last Changed' }).click();
  await expect(page.getByRole('combobox', { name: 'Read', exact: true })).toContainText('Last Changed');
  await expect(page.getByText(/never equal to a date/)).toBeVisible();
  if (isPhone(page)) await page.locator('.w2-back').click(); else await page.keyboard.press('Escape');
  const comparison = panel.getByRole('combobox', { name: 'Comparison' });
  await expect(comparison).toContainText('is before');
  await comparison.click();
  await expect(page.getByRole('option')).toHaveText(['is before', 'is after']);
  await snap(page, `${prefix(page)}-x-last-changed`);
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

test('The value picker builds Now to the second and an entity read as Last Changed, Seconds Until or Seconds Since', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = () => line.locator('.w2-token').first();
  const settings = () => page.getByTestId('token-settings').last();
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('button', { name: 'Now, to the second' }).click();
  await expect(token()).toContainText('Now, to the second');
  await token().click();
  await expect(settings().getByRole('combobox', { name: 'Style' })).toBeVisible();
  await settings().getByRole('button', { name: 'Remove Value' }).click();
  for (const [mode, name] of [['Last Changed', 'last changed'], ['Seconds Until', 'Seconds until Bath Fan'], ['Seconds Since It Changed', 'Seconds since Bath Fan changed']] as const) {
    await panel.getByRole('button', { name: 'Insert a Value' }).click();
    await page.getByRole('combobox', { name: 'Read as' }).click();
    await page.getByRole('option', { name: mode, exact: true }).click();
    await page.getByRole('option', { name: /Bath Fan/ }).first().click();
    await expect(token()).toContainText(name);
    await token().click();
    await settings().getByRole('button', { name: 'Remove Value' }).click();
  }
  await snap(page, `${prefix(page)}-x-edge-picker`);
});

test('Tokens: a number is shown as a duration, counts in minutes, and cuts off its decimals instead of rounding', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = () => line.locator('.w2-token').first();
  const settings = () => page.getByTestId('token-settings').last();
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
  await shows('Shows 18.5');
  await settings().getByRole('switch', { name: 'Cut off, do not round' }).check();
  await shows('Shows 18.4', '18.5');
  await snap(page, `${prefix(page)}-x-truncate`);
  await settings().getByRole('switch', { name: 'Cut off, do not round' }).uncheck();
  // Shown as a length of time: the number counts seconds, or minutes once the short style is chosen.
  const show = settings().getByRole('combobox', { name: 'As a length of time' });
  await show.click();
  await page.getByRole('option', { name: 'Short (1h 30m)' }).click();
  await expect(settings().getByRole('combobox', { name: 'Counts in' })).toBeVisible();
  await expect(settings().getByText(/A number of seconds/)).toBeVisible();
  await settings().getByRole('combobox', { name: 'Counts in' }).click();
  await page.getByRole('option', { name: 'Minutes' }).click();
  await expect(settings().getByText(/A number of minutes/)).toBeVisible();
  await shows('Shows 18m');
  await show.click();
  await page.getByRole('option', { name: 'Clock (05:00)' }).click();
  await expect(settings().getByRole('combobox', { name: 'Counts in' })).toHaveCount(0);
  await shows('Shows 00:18');
  await snap(page, `${prefix(page)}-x-duration`);
});

test('The Since line and the fan countdown can be built: a Last Changed time is drawn as a time, and Seconds Until counts to an attribute', async ({ page, request }) => {
  const { panel, line } = await openSubtitleLine(page, request);
  const token = (index: number) => line.locator('.w2-token').nth(index);
  const settings = () => page.getByTestId('token-settings').last();
  async function shows(text: RegExp) {
    if (isPhone(page)) await page.locator('.w2-back').click();
    await expect(result(page)).toContainText(text);
    if (isPhone(page)) await token(0).click();
  }
  // "Since {Last Changed}": it starts drawn as a time, not as the raw time stamp, and keeps a Style choice.
  await line.pressSequentially('Since ');
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('combobox', { name: 'Read as' }).click();
  await page.getByRole('option', { name: 'Last Changed', exact: true }).click();
  await page.getByRole('option', { name: /Bath Fan/ }).first().click();
  await token(0).click();
  await expect(settings().getByRole('combobox', { name: 'Style' })).toContainText('Time');
  await shows(/Shows Since \d{1,2}:\d{2}/);
  await snap(page, `${prefix(page)}-x-since`);
  await settings().getByRole('button', { name: 'Remove Value' }).click();
  // The fan's countdown: Seconds Until its finishes_at attribute, drawn as a clock.
  await panel.getByRole('button', { name: 'Insert a Value' }).click();
  await page.getByRole('combobox', { name: 'Read as' }).click();
  await page.getByRole('option', { name: 'Seconds Until', exact: true }).click();
  const attribute = page.getByRole('textbox', { name: 'Time attribute' });
  await attribute.fill('finishes_at');
  await attribute.press('Enter');
  await page.getByRole('option', { name: /Bath Fan/ }).first().click();
  await token(0).click();
  await settings().getByRole('combobox', { name: 'As a length of time' }).click();
  await page.getByRole('option', { name: 'Clock (05:00)' }).click();
  await shows(/(0[3-5]):\d{2}/);
  await snap(page, `${prefix(page)}-x-countdown`);
});
