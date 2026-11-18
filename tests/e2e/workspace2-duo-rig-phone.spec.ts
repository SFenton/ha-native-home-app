import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';

/**
 * The Duo rig on a phone-sized Studio (390 x 844, touch): the simulator rail is a row under the preview, and it holds both Rotate
 * buttons and the three postures. A phone reaches every pose the desk does: Folded, Partly Folded, Unfolded, and a closed turn.
 */
test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 700, 'The phone layout');
test.beforeEach(async ({ request }) => { await seed(request); });

/** Opens the preview on iPhone Duo through Project > Window, the way a person on a phone does. */
async function startDuoOnPhone(page: Page) {
  await openWorkspace(page);
  await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('button', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('simulator-rail')).toBeVisible();
  await rigSettled(page);
}
const screen = (page: Page) => previewRoot(page).locator('.sh-screen');
const press = async (page: Page, name: string) => { await page.getByTestId('simulator-rail').getByRole('button', { name, exact: true }).tap(); await expect(page.getByTestId('simulator-rail')).toBeVisible(); await page.waitForTimeout(300); };

test('the rail under the preview reaches Folded, Partly Folded from Folded, closed turns on the camera\'s edge and Unfolded', async ({ page }) => {
  test.skip(!isPhone(page), 'Phone only');
  await startDuoOnPhone(page);
  // Rotate Left and Rotate Right are both there, with the three postures, in one row.
  const rail = page.getByTestId('simulator-rail');
  for (const name of ['Rotate Left', 'Rotate Right', 'Folded', 'Partly Folded', 'Unfolded']) await expect(rail.getByRole('button', { name, exact: true })).toBeEnabled();
  await expect(rail).toHaveAttribute('data-orientation', 'horizontal');
  // The phone draws the window flat, with no body around it and so no 3D rig: the same poses, as the window's own layout.
  await expect(previewRoot(page).locator('.sh-rig')).toHaveCount(0);
  await expect(screen(page)).toHaveCount(1);
  await press(page, 'Folded');
  await expect(screen(page)).toHaveAttribute('data-rail', '');
  await expect(screen(page)).toHaveAttribute('data-rail-side', 'trailing');
  // The closed Duo has no status bar across the top: the time and the connection stack on the rail, under the camera.
  await expect(previewRoot(page).locator('.sh-rail-status')).toHaveCount(1);
  await expect(previewRoot(page).locator('.sh-status')).toHaveCount(0);
  await snap(page, 'phone-duo-closed');
  await press(page, 'Partly Folded');
  await expect(previewRoot(page).locator('.sh-crease[data-on][data-axis=vertical]')).toHaveCount(1);
  await snap(page, 'phone-duo-partly-from-closed');
  await press(page, 'Folded');
  // Two turns carry the camera to the other side and the rail with it.
  await press(page, 'Rotate Right');
  await expect(screen(page)).toHaveAttribute('data-rail-side', 'trailing');
  await press(page, 'Rotate Right');
  await expect(screen(page)).toHaveAttribute('data-rail-side', 'leading');
  await expect(previewRoot(page).locator('.sh-rail-status[data-camera-v=bottom]')).toHaveCount(1);
  await snap(page, 'phone-duo-closed-turn-180');
  await press(page, 'Rotate Left');
  await press(page, 'Rotate Left');
  await expect(screen(page)).toHaveAttribute('data-rail-side', 'trailing');
  await press(page, 'Unfolded');
  await expect(previewRoot(page).locator('.sh-rail-status')).toHaveCount(0);
  await expect(previewRoot(page).locator('.sh-crease[data-on]')).toHaveCount(0);
});
