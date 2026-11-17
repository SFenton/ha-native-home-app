import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openPagesList, openWorkspace, previewRoot, previewTile, railButton, seed } from './workspace2-helpers';

/** The library on a wide window: the palettes add by click and by drag, the tree selects, and Use disables what edits. */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The library is the wide layout; a phone has sheets');
test.beforeEach(async ({ request }) => { await seed(request); });

const undo = (page: Page) => page.getByRole('button', { name: 'Undo' }).click();
const newText = (page: Page) => previewRoot(page).getByText('New text', { exact: true });
const centre = async (locator: ReturnType<Page['locator']>) => { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

test('a click on a Components cell adds it, selects it and opens its properties; Undo takes it back', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  await expect(newText(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New text' })).toBeVisible();
  await expect(newText(page)).toHaveCount(1);
  await undo(page);
  await expect(newText(page)).toHaveCount(0);
});

test('a drag from a Components cell onto the simulator shows the drop cue and adds at the drop, as one undo step', async ({ page }) => {
  test.skip(isPhone(page), 'The mouse route is wide');
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  // The palette grew (Stack, Repeat, ...), so the Text cell may sit below the fold of the panel.
  await page.getByRole('button', { name: 'Text', exact: true }).scrollIntoViewIfNeeded();
  const from = await centre(page.getByRole('button', { name: 'Text', exact: true })), to = await centre(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 8, { steps: 3 });
  await page.mouse.move(to.x, to.y + 8, { steps: 10 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await page.mouse.up();
  await expect(newText(page)).toHaveCount(1);
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New text' })).toBeVisible();
  await page.waitForTimeout(120);
  await undo(page);
  await expect(newText(page)).toHaveCount(0);
});

test('a drag that ends off the simulator adds nothing', async ({ page }) => {
  test.skip(isPhone(page), 'The mouse route is wide');
  await openWorkspace(page);
  await openLibrary(page, 'Controls');
  const from = await centre(page.getByRole('button', { name: 'Button', exact: true }));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Properties')).toHaveCount(0);
});

test('a type that needs an entity opens the Add picker on its entities instead', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Controls');
  await page.getByRole('button', { name: 'Toggle', exact: true }).click();
  await expect(page.getByTestId('add-picker')).toBeVisible();
  await expect(page.getByText('Choose an entity for the Toggle.')).toBeVisible();
});

test('in Use the palette cells and the grips stay in place, disabled', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Section', exact: true })).toBeDisabled();
  await expect(railButton(page, 'Controls')).toBeEnabled();
});

test('in Use each palette says how to add and its button switches to Edit, with the cells dimmed and described by it', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  for (const [name, line] of [['Components', 'Switch to Edit to add components.'], ['Controls', 'Switch to Edit to add controls.']]) {
    await openLibrary(page, name);
    const notice = page.getByTestId('library-notice');
    await expect(notice.getByText(line)).toBeVisible();
    await expect(page.getByText('Drag onto the page, or click to add after the selection.')).toHaveCount(0);
    const cell = page.locator('.w2-palette-cell').first();
    await expect(cell).toHaveAttribute('aria-disabled', 'true');
    await expect(cell).toHaveAttribute('aria-describedby', (await notice.getAttribute('id'))!);
    expect(await cell.evaluate(element => getComputedStyle(element).opacity)).toBe('0.4');
  }
  await page.getByTestId('library-notice').getByRole('button', { name: 'Switch to Edit' }).click();
  await expect(page.getByTestId('library-notice')).toHaveCount(0);
  await expect(page.locator('.w2-palette-cell').first()).toBeFocused();
  await expect(page.getByText('Drag onto the page, or click to add after the selection.')).toBeVisible();
});

test('the Tabs list opens a tab in place to its first-level rows; a child row selects, and another tab row shows that page', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Tabs');
  const tree = page.getByTestId('library-tree');
  const row = (name: string) => tree.locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row('Home').click();
  await expect(row('Weather')).toBeVisible();
  await row('Weather').click();
  await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Weather' })).toBeVisible();
  await row('Security').click();
  await expect(row('Security')).toHaveAttribute('aria-current', 'page');
});

test('Sheets lists the sheets in groups by how they open; Modals says what it holds when none cover the screen', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Sheets');
  const panel = page.getByRole('complementary', { name: 'Sheets' });
  await expect(panel.getByRole('button', { name: /^Opened From a Tile/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sheet', exact: true })).toBeVisible();
  await openLibrary(page, 'Modals');
  await expect(page.getByRole('complementary', { name: 'Modals' }).getByText('No modals yet. A modal covers the whole screen.')).toBeVisible();
});

test('a press on the active rail button closes the panel and a press on another switches category; the choice is remembered', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Pages');
  await railButton(page, 'Controls').click();
  await expect(page.getByRole('complementary', { name: 'Controls' })).toBeVisible();
  await railButton(page, 'Controls').click();
  await expect(page.getByTestId('library-panel')).toHaveCount(0);
  await page.reload();
  await expect(previewRoot(page)).toBeVisible();
  await expect(page.getByTestId('library-panel')).toHaveCount(0);
  await expect(railButton(page, 'Controls')).toHaveAttribute('aria-pressed', 'false');
  await railButton(page, 'Controls').click();
  await expect(page.getByRole('complementary', { name: 'Controls' })).toBeVisible();
});

test('the Templates group heads the Components list with its count, says how to make one when empty, and folds', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Components');
  const group = page.locator('[data-group="saved"]');
  const head = group.getByRole('button', { name: /^Templates/ });
  await expect(head).toContainText('0');
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(group.getByTestId('saved-empty')).toHaveText('No templates yet. Choose Save as Template from a component’s More menu.');
  await expect(page.locator('.w2-palette-group').first()).toHaveAttribute('data-group', 'saved');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(group.getByTestId('saved-empty')).toHaveCount(0);
});
