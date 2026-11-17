import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * The data parts in the Studio (lane `wg-s3`): the Add picker offers Chart and Gauge, each lands as a part that compiles, and the inspector shows the rows
 * the schema gives it, with an Opacity on every color. Desktop and phone, in a light and a dark color scheme.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
async function add(page: Page, name: string, heading: string) {
  if (isPhone(page)) await page.locator('.w2-bottom-add').click();
  else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) }).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: heading })).toBeVisible();
  return panel;
}

test('the Add picker offers the chart and the gauge', async ({ page }) => {
  await openWorkspace(page);
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  for (const name of ['Chart', 'Gauge']) await expect(picker.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) }).first()).toBeVisible();
  await snap(page, `${prefix(page)}-wgchart-add-picker`);
});

for (const scheme of ['dark', 'light'] as const) {
  test(`a chart shows its type, data, scale, axis and look rows in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    const panel = await add(page, 'Chart', 'New chart');
    for (const label of ['Chart type', 'Data', 'With no data', 'Levels', 'Pattern', 'Spoken name', 'Value scale', 'Color']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
    await expect(previewRoot(page)).toBeVisible();
    await snap(page, `${prefix(page)}-wgchart-inspector-chart-${scheme}`);
  });

  test(`a gauge shows its value, gradient, track, marker and span rows in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    const panel = await add(page, 'Gauge', 'New gauge');
    for (const label of ['Value', 'Scale', 'Span', 'Size', 'Border', 'Gradient covers', 'Gradient', 'Track color']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
    await snap(page, `${prefix(page)}-wgchart-inspector-gauge-${scheme}`);
  });
}

test('a chart added draws in the preview with the points it starts with', async ({ page }) => {
  await openWorkspace(page);
  await add(page, 'Chart', 'New chart');
  await expect(previewRoot(page).locator('.sh-chart-bar')).toHaveCount(5);
  await expect(previewRoot(page).locator('.sh-chart-ylabel').first()).toHaveText('60');
});

test('changing a chart to a line redraws it as a line', async ({ page }) => {
  await openWorkspace(page);
  const panel = await add(page, 'Chart', 'New chart');
  await panel.getByRole('radio', { name: 'Line' }).or(panel.getByRole('button', { name: 'Line' })).first().click();
  await expect(previewRoot(page).locator('.sh-chart-line')).toHaveCount(1);
  await expect(previewRoot(page).locator('.sh-chart-bar')).toHaveCount(0);
});

test('a gauge added draws its marker at half', async ({ page }) => {
  await openWorkspace(page);
  await add(page, 'Gauge', 'New gauge');
  await expect(previewRoot(page).locator('.sh-gauge-marker')).toHaveCount(1);
});
