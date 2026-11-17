import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); await request.get('/'); });
test.use({ actionTimeout: 8000 });

/** Selects the status chip "Lights" and returns the properties panel; its "Fill" row is the color field. */
async function openFill(page: Page) {
  await openWorkspace(page);
  await page.evaluate(() => localStorage.removeItem('sh-studio.saved-colours'));
  const panel = await selectTile(page, 'Lights');
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  return panel;
}
const well = (page: Page) => page.getByLabel('Custom Color…');
const chipFill = (page: Page) => previewRoot(page).locator('.sh-node[data-type="status-chip"]').first().locator('.sh-chip').first();

test('setting the system color input changes the simulator at once and makes one undo step', async ({ page }) => {
  await openFill(page);
  await expect(page.getByRole('radiogroup', { name: 'Colors', exact: true })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-color-field`);
  // Drag: several input events, then the closing change event.
  await well(page).evaluate((input: HTMLInputElement) => {
    for (const value of ['#102030', '#305070', '#7040A0']) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(112, 64, 160)');
  await well(page).evaluate((input: HTMLInputElement) => { input.value = '#E8A33D'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(232, 163, 61)');
  if (!isPhone(page)) await expect(page.getByLabel('Properties').getByRole('button', { name: 'Fill', exact: true })).toContainText('#E8A33D');
  else await expect(page.locator('.w2-color-custom code')).toHaveText('#E8A33D');
  // One undo step takes the whole drag back.
  const undo = page.getByRole('button', { name: 'Undo' });
  await undo.click();
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(232, 163, 61)');
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(112, 64, 160)');
});

test('a saved color is kept across a reload, and a preset applies at once', async ({ page }) => {
  await openFill(page);
  await page.getByRole('radio', { name: 'Teal' }).click();
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(48, 176, 199)');
  await page.getByRole('button', { name: 'Save Color' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Saved Colors' }).getByRole('radio', { name: '#30B0C7' })).toBeVisible();
  // The fill is autosaved before the page goes away.
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/native/api/draft') && response.request().method() === 'PUT'), page.keyboard.press('Control+s')]);
  await page.reload();
  await expect(previewRoot(page)).toBeVisible();
  const panel = await selectTile(page, 'Lights');
  await panel.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Saved Colors' }).getByRole('radio', { name: '#30B0C7' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove From Saved' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Saved Colors' }).getByRole('radio')).toHaveCount(0);
  // Removing a saved color never changes the fill that used it.
  await expect.poll(async () => chipFill(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(48, 176, 199)');
});
