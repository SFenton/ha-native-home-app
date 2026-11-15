import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

const tag = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
/** The top bar's page button; the narrow bottom bar has a second "Pages" button that opens the same overlay. */
const pagesButton = (page: Page) => page.getByRole('button', { name: 'Pages', exact: true }).first();
const openPages = async (page: Page) => { await pagesButton(page).click(); await expect(page.locator('.w2-pages')).toBeVisible(); return page.locator('.w2-pages'); };
const dialog = (page: Page) => page.getByRole('dialog');

/** Adds a page from the Pages overlay's footer, linked from the page being edited unless `from` says otherwise. */
async function addPage(page: Page, name: string, from?: string) {
  const pages = await openPages(page);
  await pages.getByRole('button', { name: 'Page', exact: true }).click();
  const box = dialog(page);
  await expect(box.getByText('New Page')).toBeVisible();
  if (from) await box.getByLabel('Link from').selectOption({ label: from });
  await box.getByLabel('Name').fill(name);
  return box;
}
/** Opens Project > Window on a phone, or the Window menu on a desk. */
async function openWindow(page: Page) {
  if (isPhone(page)) { await page.getByRole('button', { name: 'Project' }).click(); await page.getByRole('button', { name: 'Window', exact: true }).click(); }
  else await page.getByRole('button', { name: 'Window' }).click();
}
async function chooseWindow(page: Page, label: string) {
  await openWindow(page);
  if (isPhone(page)) { await page.getByRole('button', { name: label }).click(); await page.keyboard.press('Escape'); }
  else await page.getByRole('menuitemradio', { name: label }).click();
}
/** The split read-out line, read from the Window menu (or the Project sheet's Window page) and closed again. */
async function readout(page: Page): Promise<string> {
  await openWindow(page);
  const text = (await page.getByTestId('split-readout').textContent()) ?? '';
  await page.keyboard.press('Escape');
  return text;
}

test('the Pages overlay shows Page, Sheet and Tab at the bottom, wide and narrow', async ({ page }) => {
  await openWorkspace(page);
  const pages = await openPages(page);
  const foot = pages.locator('.w2-pages-foot');
  for (const name of ['Page', 'Sheet', 'Tab']) await expect(foot.getByRole('button', { name, exact: true })).toBeVisible();
  const box = await foot.boundingBox(), view = page.viewportSize()!;
  expect(box && box.y + box.height <= view.height + 1, `the footer sits inside the viewport: ${JSON.stringify(box)}`).toBeTruthy();
  await expect(pages.getByRole('heading', { name: 'Tabs · 3 of 5' })).toBeVisible();
  await snap(page, `${tag(page)}-pages-footer`);
});

test('New Page makes the page and its tile in one undo step and lists it under its parent', async ({ page }) => {
  await openWorkspace(page);
  const box = await addPage(page, 'Garage');
  await snap(page, `${tag(page)}-new-page`);
  await box.getByRole('button', { name: 'Create' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(pagesButton(page)).toContainText('Garage');
  const pages = await openPages(page);
  const parent = pages.locator('li', { has: page.getByRole('button', { name: /^Home/ }) }).first();
  await expect(parent.locator('ul').getByRole('button', { name: /^Garage/ })).toBeVisible();
  await page.keyboard.press('Escape');
  if (await page.locator('.w2-pages').count()) await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  const after = await openPages(page);
  await expect(after.getByRole('button', { name: /^Garage/ })).toHaveCount(0);
  await expect(pagesButton(page)).toContainText('Home');
});

test('the sixth tab cannot be added and the bar says why', async ({ page }) => {
  await openWorkspace(page);
  for (const label of ['Garden', 'Study']) {
    const pages = await openPages(page);
    await pages.getByRole('button', { name: 'Tab', exact: true }).click();
    await dialog(page).getByLabel('Label').fill(label);
    await dialog(page).getByRole('button', { name: 'Create' }).click();
    await expect(dialog(page)).toHaveCount(0);
  }
  const pages = await openPages(page);
  await expect(pages.getByRole('heading', { name: 'Tabs · 5 of 5' })).toBeVisible();
  await pages.getByRole('button', { name: 'Tab', exact: true }).click();
  await expect(dialog(page).getByText('The tab bar holds 5.')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Create' })).toBeDisabled();
  await snap(page, `${tag(page)}-tab-cap-dialog`);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  // The Tabs panel, from the "Tabs" header.
  const again = await openPages(page);
  await again.getByRole('button', { name: 'Tabs · 5 of 5' }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByText('Tab bar · 5 of 5')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add Tab' })).toBeDisabled();
  await expect(panel.getByText('The tab bar holds 5.')).toBeVisible();
  await snap(page, `${tag(page)}-tabs-at-cap`);
});

async function openPageSettings(page: Page, title: string) {
  const pages = await openPages(page);
  await pages.getByRole('button', { name: `More for ${title}` }).first().click();
  await page.getByRole('menuitem', { name: 'Page Settings' }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}

test('Page settings: the split switch turns two panes on at iPad sideways and off at iPhone', async ({ page }) => {
  await openWorkspace(page);
  // A page to open beside Home.
  const box = await addPage(page, 'Room Detail', 'Home');
  await box.getByRole('button', { name: 'Create' }).click();
  const panel = await openPageSettings(page, 'Home');
  await expect(panel.getByText('Open pages beside this one')).toBeVisible();
  await panel.getByRole('switch', { name: 'Open pages beside this one' }).check();
  await expect(panel.getByText('Used when the window is wide enough for two.')).toBeVisible();
  await expect(panel.getByLabel('Empty side text')).toBeVisible();
  await snap(page, `${tag(page)}-page-settings-split`);
  await panel.getByRole('button', { name: 'Advanced' }).click();
  await expect(panel.getByText('Start with one pane')).toBeVisible();
  await expect(panel.getByText('Start a new column set here')).toBeVisible();
  // iPad sideways: two panes and the read-out says on.
  await chooseWindow(page, 'iPad sideways · 1194 × 834');
  await expect(previewRoot(page).locator('.sh-pane')).toHaveCount(2);
  expect(await readout(page)).toBe('Split view: on, 596 and 597 pt');
  await snap(page, `${tag(page)}-ipad-sideways-two-panes`);
  // iPhone: one pane and off.
  await chooseWindow(page, 'iPhone · 402 × 874');
  await expect(previewRoot(page).locator('.sh-pane')).toHaveCount(0);
  expect(await readout(page)).toBe('Split view: off');
});

test('the Window menu lists every window by size, with the flyout at iPad and the hinge on a Duo', async ({ page }) => {
  test.skip(isPhone(page), 'The narrow list is covered by the split test');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Window' }).click();
  const labels = ['iPhone · 402 × 874', 'Duo folded · 466 × 678', 'Duo open, upright · 669 × 951', 'Duo open, sideways · 951 × 669', 'iPad upright · 834 × 1194', 'iPad sideways · 1194 × 834'];
  for (const label of labels) await expect(page.getByRole('menuitemradio', { name: label })).toBeVisible();
  await page.getByRole('menuitemradio', { name: labels[5] }).click();
  await expect(previewRoot(page).locator('.sh-tabbar')).toHaveCount(0);
  await expect(previewRoot(page).locator('.sh-flyout-layer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Window' }).click();
  await page.getByRole('menuitemradio', { name: labels[3] }).click();
  await page.getByRole('button', { name: 'Window' }).click();
  await page.getByRole('menuitemradio', { name: 'Book' }).click();
  await expect(previewRoot(page).locator('.sh-fold[data-axis=vertical]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Window' }).click();
  await expect(page.getByTestId('split-readout')).toHaveText('Split view: on, 455 and 372 pt');
});

test('Links: add one from Page settings, edit it, and see it in Project > Links', async ({ page }) => {
  await openWorkspace(page);
  const panel = await openPageSettings(page, 'Home');
  await panel.getByRole('button', { name: /Opens from outside the app/ }).click();
  await expect(panel.getByText('No links. Add one from a page’s settings.')).toBeVisible();
  await panel.getByRole('button', { name: 'Add Link' }).click();
  await panel.getByLabel('Path').fill('start');
  await expect(panel.getByRole('switch', { name: 'Siri phrase' })).toBeVisible();
  await panel.getByRole('switch', { name: 'Siri phrase' }).check();
  await panel.getByLabel('Aliases').fill('begin, first');
  await panel.getByLabel('Keywords').fill('home page');
  await panel.getByLabel('Who can see it').selectOption('admin');
  await expect(panel.getByLabel('Tab')).toBeVisible();
  await expect(panel.getByText('Sheets opened first')).toBeVisible();
  await snap(page, `${tag(page)}-links-editor`);
  await panel.getByRole('button', { name: 'Links', exact: true }).click();
  await expect(panel.getByRole('button', { name: '/start' })).toBeVisible();
  // Project > Links lists it.
  await page.getByRole('button', { name: 'Project' }).click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Links', exact: true }).last().click();
  else await page.getByRole('menuitem', { name: 'Links' }).click();
  await expect(page.getByRole('button', { name: /\/start/ }).last()).toBeVisible();
});

test('a lint row goes to its place', async ({ page }) => {
  await openWorkspace(page);
  const box = await addPage(page, 'Island', 'Nothing yet');
  await box.getByRole('button', { name: 'Create' }).click();
  await expect(pagesButton(page)).toContainText('Island');
  await pagesButton(page).click();
  await page.getByRole('button', { name: 'Home' }).first().click().catch(() => {});
  await expect(pagesButton(page)).toContainText('Home');
  if (isPhone(page)) { await page.getByRole('button', { name: 'Project' }).click(); await page.getByRole('button', { name: 'Checks', exact: true }).click(); }
  else await page.getByTestId('checks-pill').click();
  await page.getByRole('button', { name: 'Island has no way in.' }).click();
  await expect(pagesButton(page)).toContainText('Island');
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Island', exact: true })).toBeVisible();
});

test('Delete asks first and removes the page with its tile', async ({ page }) => {
  await openWorkspace(page);
  const box = await addPage(page, 'Garage', 'Home');
  await box.getByRole('button', { name: 'Create' }).click();
  const pages = await openPages(page);
  await pages.getByRole('button', { name: 'More for Garage' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dialog(page).getByText('Delete “Garage”?')).toBeVisible();
  await expect(dialog(page).getByText('1 tile opens this page. Its action is removed.')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  const after = await openPages(page);
  await expect(after.getByRole('button', { name: /^Garage/ })).toHaveCount(0);
});
