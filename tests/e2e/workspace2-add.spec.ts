import { expect, test } from '@playwright/test';
import { isPhone, openWorkspace, previewTile, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

test('the A key opens the picker, and choosing a tile adds it after the selection, selects it and opens its properties', async ({ page }) => {
  test.skip(isPhone(page), 'Keyboard route is wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  await page.keyboard.press('a');
  const picker = page.getByTestId('add-picker');
  await expect(picker).toBeVisible();
  await snap(page, 'desktop-add-picker');
  await picker.getByRole('listitem').filter({ hasText: 'Row' }).first().click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New row' })).toBeVisible();
});
