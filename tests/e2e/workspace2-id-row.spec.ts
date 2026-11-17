import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile } from './workspace2-helpers';

const fixture = readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8');
/** The fixture with one tile's ID made 20 characters long, the length the spec measures. */
const LONG = 'tile-guests-7f3a-abc';
const document = () => JSON.parse(fixture.replaceAll('"hc-home-guest-0"', `"${LONG}"`)).document;
test.beforeEach(async ({ request }) => { await seed(request, document()); });

/** Opens the Advanced fold of the tile titled Demo Guests 1 and returns its ID row's measurements. */
async function measure(page: Page) {
  const panel = await selectTile(page, 'Demo Guests 1');
  const fold = panel.getByRole('button', { name: 'Advanced' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.dispatchEvent('click');
  const row = panel.locator('.w2-id-row');
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  const box = async (selector: string) => (await row.locator(selector).boundingBox())!;
  const label = await box('.w2-row-label'), field = await box('.w2-id-field'), copy = await box('.w2-id-copy'), code = await box('code');
  // The first ordinary field above it: its label and its value set the columns every row shares.
  const other = panel.locator('.w2-scope .field, .field').first();
  const otherLabel = (await other.locator('> span:first-child').boundingBox())!, otherValue = (await other.locator('input, select, button').first().boundingBox())!;
  const text = (await row.locator('code').textContent())!;
  const clipped = await row.locator('code').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  return { label, field, copy, code, otherLabel, otherValue, text, clipped, coarse, panelWidth: (await panel.boundingBox())!.width };
}

for (const [width, inspector, whole] of [[1440, 344, true], [1100, 320, false], [700, 288, false]] as const) {
  test(`the ID row is one row on the standard grid at an inspector ${inspector} px wide`, async ({ page }) => {
    test.skip(isPhone(page), 'The wide layout');
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page);
    const m = await measure(page);
    expect(Math.round(m.panelWidth)).toBe(inspector);
    // One line: the label, the field and the button share a centre line.
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(Math.abs(middle(m.label) - middle(m.field))).toBeLessThan(2);
    expect(Math.abs(middle(m.copy) - middle(m.field))).toBeLessThan(2);
    // The columns of the rows above.
    expect(Math.abs(m.label.x - m.otherLabel.x)).toBeLessThan(1);
    expect(Math.abs(m.field.x - m.otherValue.x)).toBeLessThan(1);
    expect(m.field.height).toBe(m.coarse ? 44 : 36);
    expect(m.copy.height).toBeGreaterThanOrEqual((m.coarse ? 44 : 36) - 2);
    // Nothing is clipped: the text sits inside the field and left of the button.
    expect(m.code.x + m.code.width).toBeLessThanOrEqual(m.copy.x + 1);
    expect(m.clipped).toBe(false);
    if (whole) expect(m.text).toBe(LONG); else { expect(m.text).toContain('…'); expect(m.text.length).toBeLessThan(LONG.length); expect(m.text.startsWith('tile-')).toBe(true); expect(m.text.endsWith('abc')).toBe(true); }
  });
}

test('the ID row in the phone sheet at 390 is one row with a 44 px field', async ({ page }) => {
  test.skip(!isPhone(page), 'The phone sheet');
  await openWorkspace(page);
  const m = await measure(page);
  expect(Math.abs((m.label.y + m.label.height / 2) - (m.field.y + m.field.height / 2))).toBeLessThan(2);
  expect(Math.abs(m.label.x - m.otherLabel.x)).toBeLessThan(1);
  expect(Math.abs(m.field.x - m.otherValue.x)).toBeLessThan(1);
  expect(m.field.height).toBe(m.coarse ? 44 : 36);
  expect(m.clipped).toBe(false);
  expect(m.code.x + m.code.width).toBeLessThanOrEqual(m.copy.x + 1);
});

test('Copy ID raises the Copied toast', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1');
  const fold = panel.getByRole('button', { name: 'Advanced' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.dispatchEvent('click');
  await panel.getByRole('button', { name: 'Copy ID' }).dispatchEvent('click');
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
});
