import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { closePagesList, expectOnPage, isPhone, openPagesList, openWorkspace, previewRoot, railButton, rigSettled, seed, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });

const tag = (page: Page) => isPhone(page) ? 'phone' : 'desktop';
const openPages = openPagesList;
/** The title of a row of the library's lists, or of the phone's Pages sheet. */
const rowTitle = (page: Page, title: RegExp | string) => page.locator('.w2-pages [role=treeitem][aria-level="1"], .w2-pages .w2-page-row').filter({ has: page.locator('.w2-tree-title, .w2-page-title', { hasText: title }) });
const dialog = (page: Page) => page.getByRole('dialog');
const closePages = closePagesList;

/** Adds a page from the Pages overlay's footer, linked from the page being edited unless `from` says otherwise. */
async function addPage(page: Page, name: string, from?: string) {
  const pages = await openPages(page, 'Pages');
  await pages.getByRole('button', { name: 'Page', exact: true }).click();
  const box = dialog(page);
  await expect(box.getByText('New Page')).toBeVisible();
  if (from) await box.getByLabel('Link from').selectOption({ label: from });
  await box.getByLabel('Name').fill(name);
  return box;
}
/** Opens Project > Window on a phone, or the Window menu on a desk. */
async function openWindow(page: Page) {
  if (isPhone(page)) {
        // Wait out a sheet that is still sliding away from the last Escape.
    await expect(page.locator('.w2-back', { hasText: 'Project' })).toHaveCount(0);
    await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
    await page.getByRole('button', { name: 'Window', exact: true }).click();
  }
  else await page.getByRole('button', { name: 'Window' }).click();
}
/**
 * Puts the preview in a window by the old names: the device menu picks the device, and the simulator rail (Rotate, the Duo's
 * postures) takes it from there, beside the device on a desk and under the preview on a phone.
 */
async function chooseWindow(page: Page, label: string) {
  const device = label.startsWith('iPad') ? 'iPad' : label.startsWith('Duo') ? 'iPhone Duo' : 'iPhone';
  await openWindow(page);
  if (isPhone(page)) { await page.getByRole('button', { name: device, exact: true }).click(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
  else await page.getByRole('menuitemradio', { name: device, exact: true }).click();
  const rail = page.getByTestId('simulator-rail');
  if (label === 'iPad sideways') await rail.getByRole('button', { name: 'Rotate Right' }).click();
  if (label === 'Duo folded') await rail.getByRole('button', { name: 'Folded', exact: true }).click();
}
/** The split read-out line, read from the Window menu (or the Project sheet's Window page) and closed again. */
async function readout(page: Page): Promise<string> {
  await openWindow(page);
  const text = (await page.getByTestId('split-readout').textContent()) ?? '';
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  return text;
}

test('every list shows its add buttons at the bottom: Page, Sheet and Tab on a phone; Tab and Edit Tabs, Page, Sheet and Modal in the library', async ({ page }) => {
  await openWorkspace(page);
  const pages = await openPages(page);
  const foot = pages.locator(isPhone(page) ? '.w2-pages-foot' : '.w2-lib-foot');
  for (const name of isPhone(page) ? ['Page', 'Sheet', 'Tab'] : ['Tab', 'Edit Tabs']) await expect(foot.getByRole('button', { name, exact: true })).toBeVisible();
  if (!isPhone(page)) {
    for (const [rail, button] of [['Pages', 'Page'], ['Sheets', 'Sheet'], ['Modals', 'Modal']]) {
      await railButton(page, rail).click();
      await expect(page.locator('.w2-lib-foot').getByRole('button', { name: button, exact: true })).toBeVisible();
    }
    await railButton(page, 'Tabs').click();
  }
  // A narrow sheet slides in, so wait for it to settle before asking where the footer is.
  const view = page.viewportSize()!;
  await expect.poll(async () => { const box = await foot.boundingBox(); return box ? box.y + box.height <= view.height + 1 : false; }, { message: 'the footer sits inside the viewport' }).toBe(true);
  if (isPhone(page)) await expect(pages.getByRole('heading', { name: 'Tabs · 3 of 5' })).toBeVisible(); else await expect(page.getByText('3 of 5 in the tab bar')).toBeVisible();
  await snap(page, `${tag(page)}-pages-footer`);
});

test('New Page makes the page and its tile in one undo step and lists it under its parent', async ({ page }) => {
  await openWorkspace(page);
  const box = await addPage(page, 'Garage');
  await snap(page, `${tag(page)}-new-page`);
  await box.getByRole('button', { name: 'Create' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectOnPage(page, 'Garage');
  // The Pages list (the library's, and the phone sheet's Pages part) holds it under "From Home".
  const pages = await openPages(page, 'Pages');
  await expect(pages.getByRole('region', { name: 'From Home' }).locator('.w2-tree-title, .w2-page-title', { hasText: /^Garage$/ })).toBeVisible();
  await closePages(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  const after = await openPages(page, 'Pages');
  await expect(rowTitle(page, /^Garage/)).toHaveCount(0);
  void after;
  await closePages(page);
  await expectOnPage(page, 'Home');
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
  if (isPhone(page)) await expect(pages.getByRole('heading', { name: 'Tabs · 5 of 5' })).toBeVisible(); else await expect(page.getByText('5 of 5 in the tab bar')).toBeVisible();
  // At the cap the Tab button is disabled and the reason sits beside it before anyone taps.
  await expect(pages.getByRole('button', { name: 'Tab', exact: true })).toBeDisabled();
  await expect(pages.getByLabel('Add').getByText('The tab bar holds 5.')).toBeVisible();
  await expect(pages.getByRole('button', { name: 'Tab', exact: true })).toHaveAccessibleDescription('The tab bar holds 5.');
  await snap(page, `${tag(page)}-tab-cap-dialog`);
  await closePages(page);
  // The Tabs panel, from the "Tabs" header.
  const again = await openPages(page);
  if (isPhone(page)) await again.getByRole('button', { name: 'Tabs · 5 of 5' }).click(); else await again.getByRole('button', { name: 'Edit Tabs' }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByText('Tab bar · 5 of 5')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add Tab' })).toBeDisabled();
  await expect(panel.getByText('The tab bar holds 5.')).toBeVisible();
  await snap(page, `${tag(page)}-tabs-at-cap`);
});

async function openPageSettings(page: Page, title: string) {
  const pages = await openPages(page, title);
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
  // On a phone the sheet opens at half height, so the Advanced row can sit below the screen: activate it without scrolling the page.
  await panel.getByRole('button', { name: 'Advanced' }).dispatchEvent('click');
  await expect(panel.getByText('Start with one pane')).toBeVisible();
  await expect(panel.getByText('Start a new column set here')).toBeVisible();
  // iPad sideways: two panes and the read-out says on.
  await chooseWindow(page, 'iPad sideways');
  await expect(previewRoot(page).locator('.sh-pane')).toHaveCount(2);
  expect(await readout(page)).toBe('Split view: on, 596 and 597 pt');
  await snap(page, `${tag(page)}-ipad-sideways-two-panes`);
  // iPhone: one pane and off.
  await chooseWindow(page, 'iPhone');
  await expect(previewRoot(page).locator('.sh-pane')).toHaveCount(0);
  expect(await readout(page)).toBe('Split view: off');
});

test('the Window menu lists the devices by name, and the rail turns and folds them: a flyout at iPad, the hinge on a Duo', async ({ page }) => {
  test.skip(isPhone(page), 'The narrow list is covered by the split test');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Window' }).click();
  const devices = ['iPhone', 'iPhone Duo', 'iPad'];
  for (const label of devices) await expect(page.getByRole('menuitemradio', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitemradio')).toHaveCount(3);
  // Posture and text size left the menu; the rail has them.
  await expect(page.getByRole('menuitemradio', { name: 'Book' })).toHaveCount(0);
  await page.getByRole('menuitemradio', { name: 'iPad', exact: true }).click();
  const rail = page.getByTestId('simulator-rail');
  await expect(rail.getByRole('button', { name: 'Folded', exact: true })).toHaveCount(0);
  await rail.getByRole('button', { name: 'Rotate Right' }).click();
  await expect(previewRoot(page).locator('.sh-tabbar')).toHaveCount(0);
  await expect(previewRoot(page).locator('.sh-flyout-layer')).toHaveCount(1);
  await page.getByRole('button', { name: 'Window' }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  // Opened the Duo is flat and sideways with no band; Partly Folded draws one down the page, and turning it keeps the pose as a book.
  await rigSettled(page);
  await expect(previewRoot(page).locator('.sh-crease[data-on]')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Partly Folded' }).click();
  await rigSettled(page);
  await expect(previewRoot(page).locator('.sh-crease[data-on][data-axis=vertical]').first()).toBeAttached();
  await page.getByRole('button', { name: 'Window' }).click();
  await expect(page.getByTestId('split-readout')).toHaveText('Split view: on, 455 and 372 pt');
  await page.keyboard.press('Escape');
  await rail.getByRole('button', { name: 'Rotate Right' }).click();
  await rigSettled(page);
  await expect(previewRoot(page).locator('.sh-rig[data-fold=partly][data-turn="90"]')).toHaveCount(1);
  await expect(previewRoot(page).locator('.sh-crease[data-on][data-axis=horizontal]').first()).toBeAttached();
});

test('the rail steps the preview text size, and dims what the device cannot do where it stands', async ({ page }) => {
  test.skip(isPhone(page), 'The rail sits beside the device on a desk');
  await openWorkspace(page);
  const rail = page.getByTestId('simulator-rail');
  await expect(rail.getByRole('button', { name: 'Rotate Left' })).toBeDisabled();
  await expect(rail.getByRole('button', { name: 'Rotate Right' })).toBeDisabled();
  const title = previewRoot(page).locator('.sh-tile-title').first();
  const before = await title.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await rail.getByRole('button', { name: 'Larger Text' }).click();
  await expect.poll(() => title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(before);
  await rail.getByRole('button', { name: 'Smaller Text' }).click();
  await rail.getByRole('button', { name: 'Smaller Text' }).click();
  await expect.poll(() => title.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(before);
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
  await panel.getByRole('combobox', { name: 'Who can see it' }).click();
  await page.getByRole('option', { name: 'An admin' }).click();
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
  await expectOnPage(page, 'Island');
  const pages = await openPages(page, 'Home');
  if (isPhone(page)) await pages.getByRole('button', { name: /^Home/ }).first().click(); else await rowTitle(page, /^Home$/).first().click();
  await expectOnPage(page, 'Home');
  if (isPhone(page)) { await page.getByRole('button', { name: 'Project' }).click(); await page.getByRole('button', { name: 'Checks', exact: true }).click(); }
  else await page.getByTestId('checks-pill').click();
  await page.getByRole('button', { name: 'Island has no way in.' }).click();
  await expectOnPage(page, 'Island');
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Island', exact: true })).toBeVisible();
});

test('Delete asks first and removes the page with its tile', async ({ page }) => {
  await openWorkspace(page);
  const box = await addPage(page, 'Garage', 'Home');
  await box.getByRole('button', { name: 'Create' }).click();
  const pages = await openPages(page, 'Garage');
  await pages.getByRole('button', { name: 'More for Garage' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dialog(page).getByText('Delete “Garage”?')).toBeVisible();
  await expect(dialog(page).getByText('1 tile opens this page. Its action is removed.')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Delete' }).click();
  await openPages(page, isPhone(page) ? undefined : 'Pages');
  await expect(rowTitle(page, /^Garage/)).toHaveCount(0);
});

test('the iPhone header menu button opens the navigation flyout in Use, and a tab pick closes it', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const layer = previewRoot(page).locator('.sh-flyout-layer');
  await expect(layer).toHaveCount(0);
  await previewRoot(page).getByRole('button', { name: 'Sections' }).click();
  await expect(layer).toHaveAttribute('data-open', '');
  await expect(previewRoot(page).locator('.sh-tabbar')).toHaveCount(1);
  await layer.getByRole('button', { name: 'Security' }).click();
  await expect(layer).toHaveCount(0);
});

/** The home-domains fixture with the owner's shape of header: the menu leads, Quick Links and Profile trail. */
function withHeader(): object {
  const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { navigation: { chrome: { groups: object[] }; }; modals: { id: string }[] } };
  const present = { type: 'present', modalId: fixture.document.modals[0].id, arguments: {}, ifPresented: 'reject' };
  const document = fixture.document;
  return { ...document, navigation: { ...document.navigation, chrome: { groups: [...document.navigation.chrome.groups,
    { id: 'demo_utilities', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [{ id: 'demo_header', type: 'shell-header', visibility: 'always', quickLinksAction: present, profileAction: present }] }] } } };
}

/** The poses of the Duo, each taken through the simulator rail the way a person does: Folded, Unfolded, Rotate Left and Right, Partly Folded. */
const poses = [
  { name: 'folded upright', rail: true, steps: ['Folded'] },
  { name: 'unfolded upright', rail: false, steps: ['Rotate Right'] },
  { name: 'unfolded sideways', rail: true, steps: [] },
  { name: 'partly folded', rail: true, steps: ['Partly Folded'] },
] as const;

for (const pose of poses) {
  test(`the Duo ${pose.name}: ${pose.rail ? 'Quick Links and Profile above the tabs pill in the trailing rail, no hamburger' : 'the iPhone chrome, hamburger leading, no rail'}`, async ({ page, request }) => {
    test.skip(isPhone(page), 'The simulator rail sits beside the device on a desk');
    await seed(request, withHeader());
    await openWorkspace(page);
    await openWindow(page);
    await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
    const controls = page.getByTestId('simulator-rail');
    for (const step of pose.steps) await controls.getByRole('button', { name: step, exact: true }).click();
    await rigSettled(page);
    const root = previewRoot(page);
    const screen = (await root.locator('.sh-screen').first().boundingBox())!;
    if (!pose.rail) {
      await expect(root.locator('.sh-rail-bar')).toHaveCount(0);
      await expect(root.getByRole('button', { name: 'Sections' })).toBeVisible();
      await expect(root.locator('.sh-page[data-current] .sh-large-title')).toBeVisible();
      return;
    }
    if (pose.name === 'partly folded') {
      // Two live halves: the page's chrome is checked in the flat pose; here the band is down the page at the hinge.
      await expect(root.locator('.sh-rig[data-fold=partly][data-turn="0"]')).toHaveCount(1);
      const fold = (await root.locator('.sh-crease[data-on][data-axis=vertical]').first().boundingBox())!;
      // The halves are tilted 18 degrees toward the viewer, so the band's place in the first half's own box is foreshortened a few percent.
      expect(Math.abs((fold.x - screen.x) / screen.width - 455.3 / 951)).toBeLessThan(0.06);
      // The page's chrome in the partly folded pose: the rail's Quick Links and Profile are reachable once, in the copy that shows the rail.
      await expect(root.locator('.sh-rail-group button:not([aria-hidden=true])')).toHaveCount(2);
      expect(await root.locator('.sh-rail-group button:not([aria-hidden=true])').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(['Quick Links', 'Profile']);
      await expect(root.locator('.sh-rail-bar').first()).toBeAttached();
      await snap(page, 'duo-partly-folded');
      return;
    }
    await expect(root.getByRole('button', { name: 'Sections' })).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Menu' })).toHaveCount(0);
    await expect(root.locator('.sh-page[data-current] .sh-large-title')).toHaveCount(0);
    await expect(root.locator('.sh-page[data-current] .sh-inline-title')).toBeVisible();
    // The rail ends at the window's trailing edge, 83 pt wide, from the status strip down; the group is over the tabs pill, which has rounded ends.
    const bar = (await root.locator('.sh-rail-bar').boundingBox())!;
    expect(Math.abs((bar.x + bar.width) - (screen.x + screen.width))).toBeLessThan(1.5);
    // The rail is one 48.5 pt pill column (the bar itself is the screen-sized layer it is drawn in): its width against the window's, the closed portrait 466 pt, the open Duo 951.
    const column = (await root.locator('.sh-tabbar').boundingBox())!;
    expect(Math.abs(column.width / screen.width - 48.5 / (pose.name === 'folded upright' ? 466 : 951))).toBeLessThan(0.004);
    const group = (await root.locator('.sh-rail-group').boundingBox())!;
    const pill = (await root.locator('.sh-tabbar').boundingBox())!;
    expect(group.y + group.height).toBeLessThan(pill.y);
    expect(await root.locator('.sh-tabbar').evaluate(item => parseFloat(getComputedStyle(item).borderTopLeftRadius))).toBeGreaterThanOrEqual(24);
    await expect(root.locator('.sh-rail-group').getByRole('button')).toHaveText(['', '']);
    expect(await root.locator('.sh-rail-group button').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(['Quick Links', 'Profile']);
    await snap(page, `duo-${pose.name.replace(' ', '-')}`);
  });
}

test('the iPad flyout is a full-height drawer flush to the leading edge, with the dim over the status strip', async ({ page }) => {
  test.skip(isPhone(page), 'The window menu is a desk control');
  await openWorkspace(page);
  await chooseWindow(page, 'iPad sideways');
  await previewRoot(page).getByRole('button', { name: 'Menu' }).click();
  await expect(previewRoot(page).locator('.sh-flyout-layer')).toHaveAttribute('data-open', '');
  await page.waitForTimeout(500);
  const screen = (await previewRoot(page).locator('.sh-screen').boundingBox())!;
  const drawer = (await previewRoot(page).locator('.sh-flyout').boundingBox())!;
  expect(Math.abs(drawer.x - screen.x)).toBeLessThan(1.5);
  expect(Math.abs(drawer.y - screen.y)).toBeLessThan(1.5);
  expect(Math.abs(drawer.height - screen.height)).toBeLessThan(1.5);
  const scrim = (await previewRoot(page).locator('.sh-flyout-scrim').boundingBox())!;
  expect(Math.abs(scrim.height - screen.height)).toBeLessThan(1.5);
  await expect(previewRoot(page).getByRole('heading', { name: 'Navigation' })).toBeVisible();
});
