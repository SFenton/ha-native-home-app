import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';

/**
 * Repeated Pieces (templates spec 5, option B, SA3): the Find Repeated Pieces row, the level, the proposal with the piece marked on the canvas, Save as
 * Template for a class, and on a phone Project > Repeated Pieces. The fixture repeats one tile grid three times (one of them with 3 columns, which a
 * template cannot set) and one section twice. Every entity is invented.
 */
const repeats = JSON.parse(readFileSync(new URL('../fixtures/templates-repeats.json', import.meta.url), 'utf8')) as { document: { pages: { components: unknown[] }[] } };
const lamps = JSON.parse(readFileSync(new URL('../fixtures/templates-lamps.json', import.meta.url), 'utf8')) as { document: object };
const bare = { document: { ...repeats.document, pages: repeats.document.pages.map(page => ({ ...page, components: [] })) } };

const panel = (page: Page) => page.getByLabel('Properties');
const find = (page: Page) => page.getByTestId('find-repeats');
/** The surface that lists the pieces: the library level on a wide window, the sheet on a phone. */
const level = (page: Page) => page.getByTestId(isPhone(page) ? 'repeats-sheet' : 'repeats-level');
/** The proposal: in the inspector on a wide window, pushed in the sheet on a phone. */
const proposal = (page: Page) => page.getByTestId('repeat-proposal');
const mark = (page: Page) => previewRoot(page).locator('[data-repeat-mark]');

/** What the preview draws, as text, without the tag the Repeated Pieces mark adds. */
const drawn = (page: Page) => previewRoot(page).evaluate(element => { const copy = element.cloneNode(true) as HTMLElement; copy.querySelectorAll('.sh-repeat-tag').forEach(tag => tag.remove()); return copy.textContent ?? ''; });

/** Opens the list of pieces: Find Repeated Pieces in the Templates group, or Project > Repeated Pieces on a phone. */
async function openLevel(page: Page) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByTestId('repeated-pieces-row').click();
  } else {
    await openLibrary(page, 'Components');
    await find(page).click();
  }
}
async function openList(page: Page) {
  await openLevel(page);
  await expect(level(page).getByTestId('repeats-list')).toBeVisible();
}
const row = (page: Page, name: RegExp) => level(page).getByTestId('repeats-list').getByRole('button', { name });
const gridRow = (page: Page) => row(page, /^Tile grid, 3 tiles/);
async function openGrid(page: Page) {
  await seed(page.request, repeats.document);
  await openWorkspace(page);
  await openList(page);
  await gridRow(page).click();
  await expect(proposal(page)).toBeVisible();
}

test('Find Repeated Pieces opens the level with both pieces and their place counts', async ({ page, request }) => {
  test.skip(isPhone(page), 'The library is the wide layout; a phone opens the list from Project');
  await seed(request, repeats.document);
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  await expect(find(page)).toHaveText('Find Repeated Pieces');
  await snap(page, 'desktop-repeats-row');
  await find(page).click();
  const here = level(page);
  await expect(here.getByRole('heading', { name: 'Repeated Pieces' })).toBeVisible();
  await expect(here.getByTestId('repeats-summary')).toHaveText('2 found in 5 places');
  const rows = here.getByTestId('repeats-list').getByRole('button');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Tile grid, 3 tiles');
  await expect(rows.nth(0)).toContainText('3 places');
  await expect(rows.nth(1)).toContainText('Section, 3 tiles');
  await expect(rows.nth(1)).toContainText('2 places');
  await snap(page, 'desktop-repeats-level');
  await here.getByRole('button', { name: 'Back to Components' }).click();
  await expect(find(page)).toBeFocused();
  await expect(page.getByTestId('find-repeats-count')).toHaveText('2');
  await snap(page, 'desktop-repeats-row-count');
});

test('a row marks the first place on the canvas and shows the proposal with the differing fields checked', async ({ page }) => {
  await openGrid(page);
  const boxes = proposal(page).getByRole('checkbox');
  await expect(boxes).toHaveCount(7);
  for (let at = 0; at < 7; at++) await expect(boxes.nth(at)).toBeChecked();
  await expect(proposal(page).getByLabel('Name', { exact: true })).toHaveValue('Tile grid');
  await expect(mark(page)).toHaveCount(1);
  await expect(mark(page)).toHaveAttribute('data-sel', 'node:rep-grid-kitchen');
  await expect(mark(page).locator('.sh-repeat-tag')).toHaveText('1 of 2');
  await expect(mark(page)).toBeInViewport();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-repeats-proposal`);
});

test('a place row shows that place and moves the mark', async ({ page }) => {
  await openGrid(page);
  await expect(mark(page)).toHaveAttribute('data-sel', 'node:rep-grid-kitchen');
  const places = proposal(page).getByRole('list', { name: 'Places' });
  await expect(places.getByRole('button')).toHaveCount(2);
  await expect(places.getByRole('button').nth(0)).toContainText('Shown');
  await places.getByRole('button').nth(1).click();
  await expect(mark(page)).toHaveAttribute('data-sel', 'node:rep-grid-hall');
  await expect(mark(page).locator('.sh-repeat-tag')).toHaveText('2 of 2');
  await expect(places.getByRole('button').nth(1)).toContainText('Shown');
  await expect(mark(page)).toHaveCount(1);
});

test('unchecking a field lowers the count and the foot names the field', async ({ page }) => {
  await openGrid(page);
  const foot = proposal(page).getByTestId('repeat-foot');
  await expect(foot).toHaveText('Replaces 2 of 3 places. 1 differs in Columns, which a template cannot set.');
  await expect(proposal(page).getByRole('heading', { name: 'Places (2 of 3)' })).toBeVisible();
  await proposal(page).getByRole('checkbox', { name: 'Entity 1' }).uncheck();
  await expect(proposal(page).getByRole('heading', { name: 'Places (1 of 3)' })).toBeVisible();
  await expect(foot).toContainText('1 uses another Entity 1 and stays as it is.');
  await expect(proposal(page).getByRole('button', { name: 'Save as Template' })).toHaveAttribute('aria-disabled', 'true');
  await expect(proposal(page)).toContainText('Fewer than 2 places are left.');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-repeats-partial`);
  await proposal(page).getByRole('checkbox', { name: 'Entity 1' }).check();
  await expect(proposal(page).getByRole('heading', { name: 'Places (2 of 3)' })).toBeVisible();
});

test('Save as Template adds the template with its use count, removes the row, draws the same, and one Undo restores every place', async ({ page }) => {
  await openGrid(page);
  const before = await drawn(page);
  await proposal(page).getByLabel('Name', { exact: true }).fill('Lamp Grid');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-repeats-save`);
  await proposal(page).getByRole('button', { name: 'Save as Template' }).click();
  await expect(page.getByTestId('linked-status')).toHaveText('Saved Lamp Grid. 2 places use it.');
  await expect(level(page).getByTestId('repeats-note')).toHaveText('Saved Lamp Grid. 2 places use it.');
  // The piece leaves the list: one grid is left on its own, which is not a repeat. The section stays.
  await expect(row(page, /^Tile grid/)).toHaveCount(0);
  await expect(row(page, /^Section/)).toHaveCount(1);
  expect(await drawn(page)).toBe(before);
  if (isPhone(page)) {
    await level(page).getByRole('button', { name: 'Done' }).click();
    await page.locator('.w2-bottom-add').click();
    await page.getByTestId('add-picker').getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Templates' }).click();
  } else {
    await level(page).getByRole('button', { name: 'Back to Components' }).click();
  }
  const saved = page.getByTestId('saved-row');
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText('Lamp Grid');
  await expect(saved).toContainText('Used in 2 places');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo' }).click();
  if (!isPhone(page)) await expect(page.getByTestId('saved-empty')).toBeVisible();
  expect(await drawn(page)).toBe(before);
  await openList(page);
  await expect(gridRow(page)).toContainText('3 places');
});

test('with nothing repeated the level shows the empty line', async ({ page, request }) => {
  await seed(request, bare.document);
  await openWorkspace(page);
  await openLevel(page);
  await expect(level(page).getByTestId('repeats-empty')).toBeVisible();
  await expect(level(page).getByTestId('repeats-empty')).toContainText('Nothing found');
  await expect(level(page).getByTestId('repeats-empty')).toContainText('Nothing repeats yet. A piece of 3 or more parts that appears twice shows here.');
  await expect(level(page).getByTestId('repeats-summary')).toHaveText('0 found in 0 places');
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-repeats-empty`);
});

test('on a phone, Project > Repeated Pieces opens the list, and a row pushes the proposal with the page visible above the sheet', async ({ page, request }) => {
  test.skip(!isPhone(page), 'The Project sheet is the phone layout');
  await seed(request, repeats.document);
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByTestId('repeated-pieces-row')).toHaveText('Repeated Pieces');
  await snap(page, 'phone-repeats-project');
  await page.getByTestId('repeated-pieces-row').click();
  const sheet = level(page);
  await expect(sheet.getByTestId('repeats-summary')).toHaveText('2 found in 5 places');
  await expect(sheet.getByTestId('repeats-list').getByRole('button')).toHaveCount(2);
  await snap(page, 'phone-repeats-level');
  await gridRow(page).click();
  await expect(sheet.getByRole('heading', { name: 'Tile grid, 3 tiles' })).toBeVisible();
  await expect(proposal(page)).toBeVisible();
  const top = (await sheet.boundingBox())!.y;
  // The canvas scrolls to the piece smoothly: wait for it to come to rest above the sheet.
  await expect.poll(async () => { const box = (await mark(page).boundingBox())!; return box.y + box.height <= top + 1; }, { message: 'the marked piece is above the sheet' }).toBe(true);
  expect(top, 'the sheet leaves the page showing').toBeGreaterThan(300);
  await snap(page, 'phone-repeats-proposal-sheet');
  // Back returns to the list and closes the mark.
  await sheet.getByRole('button', { name: /^Repeated Pieces$/ }).first().click();
  await expect(proposal(page)).toHaveCount(0);
  await expect(mark(page)).toHaveCount(0);
});

test('the level, the checkboxes and the foot are named for assistive technology, and the level takes the arrow keys', async ({ page }) => {
  await seed(page.request, repeats.document);
  await openWorkspace(page);
  await openList(page);
  await expect(page.getByRole(isPhone(page) ? 'dialog' : 'region', { name: 'Repeated Pieces' })).toBeVisible();
  const list = level(page).getByRole('list', { name: 'Repeated pieces' });
  await expect(list).toBeVisible();
  const first = list.getByRole('button').nth(0), second = list.getByRole('button').nth(1);
  await expect(first).toHaveAttribute('aria-label', 'Tile grid, 3 tiles. 3 places');
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(proposal(page)).toBeVisible();
  const box = proposal(page).getByRole('checkbox', { name: 'Entity 1' });
  const described = await box.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${described}"]`)).toHaveText('Entity · 3 different · fills 1 field');
  await expect(proposal(page).getByTestId('repeat-foot')).toHaveAttribute('aria-live', 'polite');
  await expect(proposal(page).getByRole('textbox', { name: 'Name' })).toBeVisible();
});

test('Choose Fields… on a template\'s field opens the bar and a box on every row', async ({ page, request }) => {
  await seed(request, lamps.document);
  await openWorkspace(page);
  await previewRoot(page).getByText('Demo Lamps', { exact: true }).first().click();
  await expect(panel(page).getByRole('heading', { name: 'Lamp Pair', exact: true })).toBeVisible();
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  // A template with no settings has its row open already.
  const templateRow = panel(page).getByRole('button', { name: /^Lamp Pair, template, used in 2 places$/ });
  if ((await templateRow.getAttribute('aria-expanded')) !== 'true') await templateRow.click();
  await panel(page).getByRole('button', { name: 'Choose Fields…' }).click();
  await expect(panel(page).getByTestId('choose-bar')).toBeVisible();
  await expect(panel(page).getByRole('checkbox', { name: 'Set Title per place' })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-choose-fields`);
});
