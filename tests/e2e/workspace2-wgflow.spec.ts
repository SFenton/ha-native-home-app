import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, snap } from './workspace2-helpers';

/**
 * The repeat in the Studio (lane `wg-s2`): the Add picker offers Repeat, a new one compiles and reads a records flow, and the inspector shows the rows its schema gives it:
 * Repeat over, Direction, Spacing, Paging, Placeholder and the five words. The Data tab's Output offers Records.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

const prefix = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
async function openAdd(page: Page) {
  if (isPhone(page)) await page.locator('.w2-bottom-add').click(); else await page.locator('.w2-add-slot').last().click();
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  return picker;
}
async function addRepeat(page: Page) {
  const picker = await openAdd(page);
  await picker.getByRole('listitem').filter({ hasText: /^Repeat/ }).first().click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'New repeat' })).toBeVisible();
  return panel;
}

test('the Add picker offers Repeat', async ({ page }) => {
  await openWorkspace(page);
  const picker = await openAdd(page);
  await expect(picker.getByRole('listitem').filter({ hasText: /^Repeat/ }).first()).toBeVisible();
  await snap(page, `${prefix(page)}-wgflow-add-picker`);
});

test('a new repeat reads a records flow and shows its inspector rows', async ({ page }) => {
  await openWorkspace(page);
  const panel = await addRepeat(page);
  for (const label of ['Repeat over', 'Direction', 'Spacing', 'Paging', 'Loading text', 'Empty text', 'Error text']) await expect(panel.getByText(label, { exact: true }).first()).toBeAttached();
  await expect(panel.getByText('Records', { exact: true }).first()).toBeAttached();
  await snap(page, `${prefix(page)}-wgflow-inspector-repeat`);
});

test('a new repeat draws a cell for its record in the preview', async ({ page }) => {
  await openWorkspace(page);
  await addRepeat(page);
  await expect(page.locator('[data-preview-root] .sh-repeat').first()).toBeVisible();
  await expect(page.locator('[data-preview-root] .sh-repeat-cell').first()).toBeVisible();
  await snap(page, `${prefix(page)}-wgflow-repeat-in-preview`);
});
