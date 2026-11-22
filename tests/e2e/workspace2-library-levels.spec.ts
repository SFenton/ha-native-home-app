import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { closePagesList, isPhone, openPagesList, openWorkspace, previewTile, seed } from './workspace2-helpers';

/**
 * The library half of the sheet levels (`gc-studio-library`): levels beneath their sheet, + Level, Move to Pages and Move to Sheets with the refusals, the "Goes to" groups and the
 * refusal of Move to Pages for a level that opens a level, and the question before the first level. Documents are the made-up `home-domains` project (`demo_` ids). Screenshots, light and dark, go to `STUDIO_EVIDENCE_DIR` when it is set.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR;
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')).document;
test.use({ actionTimeout: 10_000 });

type Node = { id: string; title?: string; action?: { pageId?: string }; components?: unknown[]; children?: unknown[] };
const push = (pageId: string) => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, title: string, action: unknown) => ({
  id, type: 'navigation-tile', title, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
/** A level made from a page of the project: its ids suffixed, its page-only navigation left off. */
function levelFrom(document: { pages: { id: string }[] }, pageId: string, id: string, title: string) {
  const source = document.pages.find(item => item.id === pageId)!;
  const { navigation: _navigation, ...surface } = JSON.parse(JSON.stringify(source).replace(/"id":"([^"]+)"/g, `"id":"$1_${id}"`));
  return { ...surface, id, title };
}

/**
 * The project with the Lights sheet's two room tiles opening two levels of that sheet, a third level no sheet reaches, and Climate's page opening Demo Room 1 (a page that opens a page,
 * so it cannot become a level). The first level opens the second, so moving it to Pages leaves a page that links to a level, which the checks name (the server refuses to save a document
 * that starts that way, so the error comes from the move).
 */
function project() {
  const document = structuredClone(fixture);
  document.levels = [levelFrom(document, 'hc-lights-demo-room-1-detail', 'demo_level_1', 'Demo Room 1 Level'), levelFrom(document, 'hc-lights-demo-room-2-detail', 'demo_level_2', 'Demo Room 2 Level'), levelFrom(document, 'hc-climate-demo-room-1-detail', 'demo_level_3', 'Demo Spare Level')];
  document.pages = document.pages.filter((item: { id: string }) => !['hc-lights-demo-room-1-detail', 'hc-lights-demo-room-2-detail'].includes(item.id));
  const sheet = document.modals.find((item: { id: string }) => item.id === 'hc-overview-lights');
  const tiles: Node[] = [];
  const find = (node: Node) => { if (node.action) tiles.push(node); (node.components ?? node.children ?? []).forEach(child => find(child as Node)); };
  sheet.components.forEach(find);
  tiles[0].action!.pageId = 'demo_level_1'; tiles[1].action!.pageId = 'demo_level_2';
  const climate = document.pages.find((item: { id: string }) => item.id === 'page-climate');
  climate.components.push(tile('demo_open_room', 'Open Demo Room 1', push('hc-climate-room-demo-room-1-detail')));
  // Climate hides the tab bar: a hide in force, so its row says "Hides 1".
  climate.hides = { tabs: true };
  document.levels[0].components.push(tile('demo_open_next', 'Next Level', push('demo_level_2')));
  return document;
}

test.beforeEach(async ({ request }) => { await seed(request, project()); });

/** A screenshot in each scheme, `<name>-light.png` and `<name>-dark.png`, named for the device family too. */
async function shoot(page: Page, name: string) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  const family = isPhone(page) ? 'phone' : 'desktop';
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${evidence}/${family}-${name}-${scheme}.png`, animations: 'disabled' });
  }
}

/** The list of Sheets with the Lights sheet on show (a click on a row of the library, a pick in the phone's Pages sheet). */
async function openSheets(page: Page, show = 'Lights') {
  const list = await openPagesList(page, 'Sheets');
  if (isPhone(page)) await list.locator('.w2-page-row').filter({ has: page.locator('.w2-page-title', { hasText: new RegExp(`^${show}$`) }) }).click();
  else await list.locator('[role=treeitem][aria-level="1"]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${show}$`) }) }).click();
  return isPhone(page) ? openPagesList(page, 'Sheets') : list;
}
/** The titles of the rows the list draws, in order. */
const titles = (page: Page) => isPhone(page) ? page.locator('.w2-pages .w2-page-title').allTextContents() : page.locator('.w2-pages [role=treeitem] .w2-tree-title').allTextContents();
/** A row's More menu items. */
async function menuOf(page: Page, title: string) {
  await page.getByRole('button', { name: `More for ${title}`, exact: true }).first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('the Sheets list draws a sheet\'s levels beneath it, tagged Level, with "Needs a newer app", and a level no sheet reaches under Not Linked', async ({ page }) => {
  await openWorkspace(page);
  const list = await openSheets(page);
  const before = await titles(page);
  // The levels come straight under their sheet, before whatever the open sheet holds.
  expect(before.slice(before.indexOf('Lights'), before.indexOf('Lights') + 3)).toEqual(['Lights', 'Demo Room 1 Level', 'Demo Room 2 Level']);
  await expect(list.getByText('Level', { exact: true }).first()).toBeVisible();
  await expect(list.getByText('Needs a newer app').first()).toBeVisible();
  await expect(list.getByText('Demo Spare Level').first()).toBeVisible();
  await expect(list.getByText('No Way In').first()).toBeVisible();
  await expect(page.getByText('A level opens inside its sheet, with Back and Close. Move it to Pages and it opens as a page, with the tabs and header buttons.')).toBeVisible();
  await shoot(page, 'sheets-levels');
  // The level no sheet reaches, in the phone's list too: scrolled to the end of the list, inside the list, so the sheet's title stays.
  if (isPhone(page)) {
    // The sheet's body scrolls under its sticky footer: scroll only as far as clears the row of the footer, so the title stays as much in view as it can.
    await page.locator('.w2-page-row').filter({ hasText: 'Demo Spare Level' }).evaluate(element => {
      let scroller: HTMLElement | null = element.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      const footer = document.querySelector('.w2-pages-foot')!.getBoundingClientRect().top;
      scroller!.scrollTop += Math.max(0, element.getBoundingClientRect().bottom - footer + 12);
    });
    await expect(page.locator('.w2-page-row').filter({ hasText: 'Demo Spare Level' })).toBeInViewport();
    await shoot(page, 'not-linked-level');
  }
});

test('on a desktop a closed sheet lists neither its levels nor its rows; opening it brings them back', async ({ page }) => {
  test.skip(isPhone(page), 'The phone list has no triangles.');
  await openWorkspace(page);
  const list = await openSheets(page);
  expect(await titles(page)).toContain('Demo Room 1 Level');
  await list.getByRole('button', { name: 'Hide what is in Lights' }).click();
  const closed = await titles(page);
  expect(closed).toContain('Lights');
  expect(closed).not.toContain('Demo Room 1 Level');
  expect(closed).toContain('Demo Spare Level');
  await shoot(page, 'sheet-closed');
  await list.getByRole('button', { name: 'Show what is in Lights' }).click();
  expect(await titles(page)).toContain('Demo Room 1 Level');
});

test('a level row gives its title the first line, whole: the tag and the note follow below', async ({ page }) => {
  test.skip(isPhone(page), 'Desktop rows.');
  await openWorkspace(page);
  const list = await openSheets(page);
  for (const name of ['Demo Room 1 Level', 'Demo Room 2 Level']) {
    const title = list.locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).locator('.w2-tree-title');
    await expect(title).toHaveText(name);
    // It has the first line to itself, across the whole text column, with the tag and the note below it. (Whether a long name still fits depends on the font, so the width of the line is what is asserted, not the font's measure of the text.)
    const [titleBox, columnBox, subBox] = await Promise.all([title.boundingBox(), title.locator('xpath=..').boundingBox(), title.locator('xpath=following-sibling::*[1]').boundingBox()]);
    expect(Math.abs(titleBox!.width - columnBox!.width)).toBeLessThanOrEqual(1);
    expect(subBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 1);
  }
});

test('+ Level is disabled with its reason beside it while no sheet is on show', async ({ page }) => {
  await openWorkspace(page);
  await openPagesList(page, 'Sheets');
  await expect(page.getByRole('button', { name: 'Level', exact: true })).toBeDisabled();
  await expect(page.getByText('Choose a sheet first')).toBeVisible();
  await shoot(page, 'level-disabled');
});

test('a page that hides something in force carries Hides N in the list', async ({ page }) => {
  await openWorkspace(page);
  const list = await openPagesList(page, 'Tabs');
  await expect(list.getByText('Hides 1').first()).toBeVisible();
  await shoot(page, 'hides-n');
});

test('a level\'s menu is Rename, Move to Pages and Delete; Move to Pages makes it a page with the tabs and header buttons', async ({ page }) => {
  await openWorkspace(page);
  await openSheets(page);
  const menu = await menuOf(page, 'Demo Room 2 Level');
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Move to Pages', 'Delete']);
  await shoot(page, 'level-menu');
  await menu.getByRole('menuitem', { name: 'Move to Pages' }).click();
  await expect.poll(() => titles(page)).not.toContain('Demo Room 2 Level');
  const pages = await openPagesList(page, 'Pages');
  await expect(pages.getByText('Demo Room 2 Level').first()).toBeVisible();
  await shoot(page, 'moved-to-pages');
});

test('Move to Sheets turns a page only a sheet opens into a level of that sheet; a page a page opens, and a tab\'s page, are refused in the proposal\'s words', async ({ page }) => {
  await openWorkspace(page);
  let pages = await openPagesList(page, 'Pages');
  // Demo Room 1 is opened by the Climate page: refused.
  let menu = await menuOf(page, 'Demo Room 1');
  await expect(menu.getByRole('menuitem', { name: 'Move to Sheets' })).toBeVisible();
  await shoot(page, 'page-menu');
  await menu.getByRole('menuitem', { name: 'Move to Sheets' }).click();
  await expect(page.getByText('Demo Room 1 is opened from Climate, a page. Only a sheet can open a level. Remove that link first.').first()).toBeVisible();
  await shoot(page, 'move-refused-page');
  // It stays: a line that goes by itself leaves slower readers behind. On a phone the Pages sheet stays open with it.
  await page.waitForTimeout(5500);
  const line = page.getByText('Demo Room 1 is opened from Climate, a page. Only a sheet can open a level. Remove that link first.').first();
  await expect(line).toBeVisible();
  await shoot(page, 'move-refused-after-5s');
  if (isPhone(page)) await closePagesList(page);
  // A tab's page is refused too.
  pages = await openPagesList(page, 'Tabs');
  menu = await menuOf(page, 'Security');
  await menu.getByRole('menuitem', { name: 'Page Settings' }).waitFor();
  await page.keyboard.press('Escape');
  // A page only a sheet opens moves: Demo Room 1 Climate, opened by the Climate sheet, becomes a level of it.
  pages = await openPagesList(page, 'Pages');
  menu = await menuOf(page, 'Demo Room 1 Climate');
  await menu.getByRole('menuitem', { name: 'Move to Sheets' }).click();
  await expect(pages.getByText('Demo Room 1 Climate')).toHaveCount(0);
  await openSheets(page, 'Climate');
  const rows = await titles(page);
  expect(rows.slice(rows.indexOf('Climate'), rows.indexOf('Climate') + 2)).toEqual(['Climate', 'Demo Room 1 Climate']);
  await shoot(page, 'moved-to-sheets');
});

test('the Goes to row groups Pages, Levels and Sheets for a tile in a sheet', async ({ page }) => {
  await openWorkspace(page);
  await openSheets(page);
  if (isPhone(page)) await closePagesList(page);
  await previewTile(page, 'Demo Room 1').click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  const editor = page.getByTestId('action-editor');
  await editor.getByRole('button', { name: 'Goes to' }).click();
  const groups = page.getByRole('listbox', { name: 'Goes to' }).getByRole('group');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute('aria-label', 'Pages');
  await expect(groups.nth(1)).toHaveAttribute('aria-label', 'Levels');
  await expect(groups.nth(2)).toHaveAttribute('aria-label', 'Sheets');
  await expect(groups.nth(1).getByRole('option')).toHaveText(['Demo Room 1 Level', 'Demo Room 2 Level', 'Demo Spare Level']);
  await groups.nth(1).scrollIntoViewIfNeeded();
  await shoot(page, 'goes-to-sheet');
  await page.getByRole('option', { name: 'Demo Room 2 Level' }).click();
  await expect(page.getByText('Stays in this sheet.')).toBeVisible();
  await expect(page.getByText('Demo Room 2 Level is a level of Lights.')).toBeVisible();
  await shoot(page, 'goes-to-level-result');
});

test('the Goes to row has no Levels for a tile on a page', async ({ page }) => {
  await openWorkspace(page);
  await previewTile(page, 'Weather').click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /When tapped/ }).click();
  await page.getByTestId('action-editor').getByRole('button', { name: 'Goes to' }).click();
  const groups = page.getByRole('listbox', { name: 'Goes to' }).getByRole('group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('aria-label', 'Pages');
  await expect(groups.nth(1)).toHaveAttribute('aria-label', 'Sheets');
  await expect(page.getByRole('option', { name: 'Demo Room 1 Level' })).toHaveCount(0);
  await shoot(page, 'goes-to-page');
});

test('+ Level adds a level to the sheet on show, through one dialog', async ({ page }) => {
  await openWorkspace(page);
  const list = await openSheets(page);
  const add = page.getByRole('button', { name: 'Level', exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'New Level' });
  await expect(dialog.getByText('A level of Lights.')).toBeVisible();
  await dialog.getByLabel('Name').fill('Demo Dimmer');
  await shoot(page, 'new-level');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  // The phone's Pages sheet closed to give the dialog the screen: open it again.
  await openPagesList(page, 'Sheets');
  const rows = await titles(page);
  expect(rows.slice(rows.indexOf('Lights'), rows.indexOf('Lights') + 4)).toEqual(['Lights', 'Demo Room 1 Level', 'Demo Room 2 Level', 'Demo Dimmer']);
  await expect(list).toBeVisible();
});

test('Move to Pages is refused for a level that opens another level, in the Move to Sheets form, and the line stays', async ({ page }) => {
  await openWorkspace(page);
  await openSheets(page);
  const menu = await menuOf(page, 'Demo Room 1 Level');
  await menu.getByRole('menuitem', { name: 'Move to Pages' }).click();
  const line = page.getByText('Demo Room 1 Level opens Demo Room 2 Level, a level, so it stays in Sheets. Move Demo Room 2 Level to Pages first.').first();
  await expect(line).toBeVisible();
  await shoot(page, 'move-to-pages-refused');
  // Nothing moved: the level is still in the Sheets list.
  expect(await titles(page)).toContain('Demo Room 1 Level');
});

test('the first Move to Sheets on a document without levels asks first: Cancel changes nothing, the move by name goes on', async ({ page, request }) => {
  // The made-up project as it comes: no `levels` key, so a sheet's push stays inside the sheet until one level is made.
  await seed(request, fixture);
  await openWorkspace(page);
  const pages = await openPagesList(page, 'Pages');
  let menu = await menuOf(page, 'Demo Room 1 Climate');
  await menu.getByRole('menuitem', { name: 'Move to Sheets' }).click();
  const question = page.getByRole('alertdialog');
  await expect(question.getByText('Move Demo Room 1 Climate to Sheets?')).toBeVisible();
  await expect(question.getByText('This will be the first level. After it, a page opened from any sheet closes that sheet first; today it opens inside the sheet.')).toBeVisible();
  await shoot(page, 'levels-notice');
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(question).toHaveCount(0);
  // Cancel changed nothing and left no line: the page is still in Pages.
  await expect(pages.getByText('Demo Room 1 Climate').first()).toBeVisible();
  await shoot(page, 'levels-notice-cancelled');
  menu = await menuOf(page, 'Demo Room 1 Climate');
  await menu.getByRole('menuitem', { name: 'Move to Sheets' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Sheets' }).click();
  await expect(pages.getByText('Demo Room 1 Climate')).toHaveCount(0);
});

test('New Level on a document without levels carries the first-level sentence in its caption', async ({ page, request }) => {
  await seed(request, fixture);
  await openWorkspace(page);
  await openSheets(page);
  await page.getByRole('button', { name: 'Level', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Level' });
  await expect(dialog.getByText('This will be the first level. After it, a page opened from any sheet closes that sheet first; today it opens inside the sheet.')).toBeVisible();
  await dialog.getByLabel('Name').fill('Demo Dimmer');
  await shoot(page, 'new-level-first');
});
