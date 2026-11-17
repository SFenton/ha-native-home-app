import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, previewTile, seed, snap } from './workspace2-helpers';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: object };
const sizes = [[390, 844], [669, 951], [951, 669], [820, 1180], [1180, 820], [1440, 900]] as const;

/** Right-clicks a tile and chooses a menu item (a wide window; a phone has no right-click, so its More button is not used here). */
async function chooseFromMenu(page: Page, tile: string, item: string) {
  const box = (await previewTile(page, tile).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByTestId('element-menu').getByRole('menuitem', { name: item }).click();
}

test.beforeEach(async ({ request }) => { await seed(request, fixture.document); });

test('Save as Template links the tile, shows the badge, and lists it in Templates with one use', async ({ page }) => {
  test.skip(isPhone(page), 'A right-click needs a mouse');
  await openWorkspace(page);
  await chooseFromMenu(page, 'Demo Guests 1', 'Save as Template…');
  const dialog = page.getByTestId('save-component');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Guest Tile');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(previewRoot(page).locator('.sh-link-badge')).toHaveCount(1);
  await expect(page.getByTestId('linked-status')).toHaveText(/Saved Guest Tile as a template/);
  await openLibrary(page, 'Components');
  const row = page.getByTestId('saved-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Guest Tile');
  await expect(row).toContainText('1 place');
  await snap(page, 'linked-saved');
});

test('adding a second place, then changing the component asks before it writes', async ({ page }) => {
  test.skip(isPhone(page), 'A right-click needs a mouse');
  await openWorkspace(page);
  await chooseFromMenu(page, 'Demo Guests 1', 'Save as Template…');
  await page.getByTestId('save-component').getByRole('button', { name: 'Save', exact: true }).click();
  await openLibrary(page, 'Components');
  await page.getByTestId('saved-row').getByRole('button').first().click();
  await expect(previewRoot(page).locator('.sh-link-badge')).toHaveCount(2);
  await expect(page.getByTestId('saved-row')).toContainText('2 places');
  // Rename is not an edit of the component, so it asks nothing.
  await page.getByRole('button', { name: /^More for / }).click();
  await page.getByRole('menuitem', { name: 'Show Uses' }).click();
  await expect(page.getByTestId('saved-uses')).toContainText('Used in 2 Places');
  await snap(page, 'linked-uses');
  await page.keyboard.press('Escape');
  // Unlink is on the place's menu and leaves one use.
  await chooseFromMenu(page, 'Demo Guests 1', 'Unlink From Template');
  await expect(previewRoot(page).locator('.sh-link-badge')).toHaveCount(1);
});

test('the Templates group, the badge and the dialogs fit at every size', async ({ page }) => {
  await openWorkspace(page);
  if (!isPhone(page)) {
    await chooseFromMenu(page, 'Demo Guests 1', 'Save as Template…');
    await expect(page.getByTestId('save-component')).toBeVisible();
  }
  for (const [width, height] of sizes) {
    if (isPhone(page) && width !== 390) continue;
    await page.setViewportSize({ width, height });
    const dialog = page.getByTestId('save-component');
    if (await dialog.count()) {
      const box = (await dialog.boundingBox())!;
      expect(box.x, `${width}: dialog left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${width}: dialog right`).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height, `${width}: dialog bottom`).toBeLessThanOrEqual(height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: no horizontal overflow`).toBe(true);
  }
});

test('the question and the dialog are named for assistive technology', async ({ page }) => {
  test.skip(isPhone(page), 'A right-click needs a mouse');
  await openWorkspace(page);
  await chooseFromMenu(page, 'Demo Guests 1', 'Save as Template…');
  const dialog = page.getByRole('dialog', { name: 'Save as Template' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('linked-status')).toHaveAttribute('role', 'status');
});

test('a parameter is marked in the component and set at one place without changing the other', async ({ page }) => {
  test.skip(isPhone(page), 'A right-click needs a mouse');
  await openWorkspace(page);
  await chooseFromMenu(page, 'Demo Guests 1', 'Save as Template…');
  await page.getByTestId('save-component').getByRole('button', { name: 'Save', exact: true }).click();
  await openLibrary(page, 'Components');
  await page.getByTestId('saved-row').getByRole('button').first().click();
  await expect(previewRoot(page).locator('.sh-link-badge')).toHaveCount(2);
  const panel = page.getByLabel('Properties');
  const parameters = panel.getByTestId('component-parameters');
  await parameters.getByRole('button', { name: 'Add Parameter…' }).click();
  await parameters.getByLabel('Field').selectOption({ label: 'Title · Text' });
  await parameters.getByLabel('Name').fill('label');
  await parameters.getByRole('button', { name: 'Add', exact: true }).click();
  // The change is to a component two places use, so it asks first.
  const question = page.getByTestId('linked-question');
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Update Template' }).click();
  await expect(question).toHaveCount(0);
  const settings = panel.getByTestId('component-settings');
  await expect(settings.getByRole('textbox', { name: 'Label' })).toBeVisible();
  await settings.getByRole('textbox', { name: 'Label' }).fill('Side Door');
  await expect(previewRoot(page).getByText('Side Door', { exact: true })).toHaveCount(1);
  await snap(page, 'linked-parameter');
});
