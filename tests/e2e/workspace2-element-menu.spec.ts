import { expect, test } from '@playwright/test';
import { isPhone, openWorkspace, previewTile, seed } from './workspace2-helpers';

/** G14: a right-click on an element in the simulator, in Edit, opens that element's More menu. */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'A right-click needs a mouse; the phone project is touch');
test.beforeEach(async ({ request }) => { await seed(request); });

test('right-click in Edit selects the element and opens its More menu at the pointer; Duplicate works from it', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  const tile = previewTile(page, 'Demo Guests 1');
  const box = (await tile.boundingBox())!, at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByTestId('element-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Demo Guests 1', exact: true })).toBeVisible();
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['Add After…', 'Duplicate', 'Move Up', 'Move Down', 'Save as Template…', 'Delete']);
  // It opens at the pointer, not on a corner of the window.
  const popup = (await menu.boundingBox())!;
  expect(Math.abs(popup.x - at.x)).toBeLessThan(24);
  // A tall menu near the bottom of the window opens upward, so the pointer is at its top or its bottom edge, or inside it.
  expect(at.y).toBeGreaterThanOrEqual(popup.y - 24);
  expect(at.y).toBeLessThanOrEqual(popup.y + popup.height + 24);
  const before = await page.locator('[data-preview-root] [data-sel^="node:"]').count();
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.locator('[data-preview-root] [data-sel^="node:"]').count()).toBeGreaterThan(before);
});

test('right-click in Use opens nothing of the Studio\'s', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const box = (await previewTile(page, 'Demo Guests 1').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByTestId('element-menu')).toHaveCount(0);
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Demo Guests 1', exact: true })).toHaveCount(0);
});

test('Escape closes the menu and Shift+F10 opens it again for the selection', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  const box = (await previewTile(page, 'Demo Guests 1').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.getByTestId('element-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('element-menu')).toHaveCount(0);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('element-menu')).toBeVisible();
});
