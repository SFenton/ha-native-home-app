import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });
test.use({ actionTimeout: 8000 });

const alert = (page: Page) => previewRoot(page).getByTestId('sim-alert');

/** Selects the action tile "Demo Guests 1", opens When Tapped and then the Ask First page with the alert turned on. */
async function openAskFirst(page: Page) {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await page.locator('[data-disclosure="ask-first"]').click();
  await expect(page.getByRole('heading', { name: 'Ask First' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Ask first' });
  if (!(await toggle.isChecked())) await toggle.check();
  return panel;
}

test('the editors open inside the inspector: no dialog, no backdrop, and the simulator stays usable', async ({ page }) => {
  test.skip(isPhone(page), 'The wide inspector');
  await openWorkspace(page);
  const panel = await selectTile(page, 'Demo Guests 1');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await expect(page.getByTestId('action-editor')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.w2-backdrop')).toHaveCount(0);
  expect(await panel.evaluate(element => element.contains(document.querySelector('[data-testid=action-editor]')))).toBe(true);
  // Nothing covers the simulator: its centre is still the simulator.
  expect(await previewRoot(page).evaluate(root => { const box = root.getBoundingClientRect(); return root.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); })).toBe(true);
  // Visible When is the same: a page pushed inside the inspector.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await panel.getByRole('button', { name: /Only show when/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.w2-backdrop')).toHaveCount(0);
});

test('the simulator shows the alert while a field of the page has focus, and 150 ms after, not once focus leaves', async ({ page }) => {
  test.skip(isPhone(page), 'The simulator is under the sheet on a phone; the picture covers it there');
  const panel = await openAskFirst(page);
  await expect(alert(page)).toHaveCount(0);
  await page.getByLabel('Title', { exact: true }).focus();
  await expect(alert(page)).toBeVisible();
  await expect(alert(page)).toContainText('Turn Off Demo Guests 1?');
  await expect(alert(page)).toHaveAttribute('aria-hidden', 'true');
  await page.getByLabel('Title', { exact: true }).fill('Switch off the guests?');
  await expect(alert(page)).toContainText('Switch off the guests?');
  // Moving between fields does not blink.
  await page.getByLabel('Button', { exact: true }).focus();
  await page.waitForTimeout(400);
  await expect(alert(page)).toBeVisible();
  await page.getByRole('switch', { name: 'Red button' }).check();
  await expect(alert(page).locator('[data-destructive]')).toBeVisible();
  await snap(page, 'desktop-ask-first-alert');
  // Focus leaves the page's fields: the alert is still there for a moment, then gone.
  await panel.getByRole('heading', { name: 'Ask First' }).click();
  await page.waitForTimeout(60);
  await expect(alert(page)).toBeVisible();
  await expect(alert(page)).toHaveCount(0, { timeout: 1500 });
  // Cancel is the contract literal and cannot be edited.
  await expect(page.getByTestId('ask-cancel')).toHaveText('Cancel');
});

test('the page draws a picture of the alert wherever the simulator is hidden, and it follows typing', async ({ page }) => {
  await openAskFirst(page);
  const picture = page.getByRole('figure', { name: 'A picture of the alert' });
  await expect(picture).toBeVisible();
  expect((await picture.boundingBox())!.height).toBeLessThanOrEqual(200);
  await page.getByLabel('Message', { exact: true }).fill('Everyone in the room will notice.');
  await expect(picture).toContainText('Everyone in the room will notice.');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-ask-first-page`);
});

test('in Use, a tap asks first: Cancel closes it and nothing runs, the button closes it and the call is noted', async ({ page }) => {
  const panel = await openAskFirst(page);
  await page.getByLabel('Title', { exact: true }).fill('Turn off the guests?');
  await page.getByRole('button', { name: /When tapped/ }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(panel.getByRole('button', { name: /When tapped/ })).toContainText('Turn On or Off');
  if (isPhone(page)) await panel.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const tile = () => previewRoot(page).locator('.sh-node[data-type="action-tile"]').first();
  await tile().click();
  const dialog = previewRoot(page).getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Turn off the guests?');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-use-alert`);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await tile().click();
  await dialog.getByRole('button', { name: 'Turn Off' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('checks-pill')).toContainText(/turn|toggle/i);
});
