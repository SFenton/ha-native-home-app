import { expect, test, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, previewTile, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The drag grips in Edit mode: the grip on the selected tile's handle and the grip on each row of the Pages tree both pick a
 * node up with a press and a pull, through the one drag layer the library uses.
 */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The grips are the wide layout; a phone drags by long press');
test.beforeEach(async ({ request }) => { await seed(request); });

const order = (page: Page) => page.locator('[data-preview-root] .sh-placeholder-title, [data-preview-root] .sh-tile-title, [data-preview-root] section.sh-wx[aria-label]')
  .evaluateAll(nodes => nodes.map(node => (node.matches('section.sh-wx') ? node.getAttribute('aria-label') : node.textContent)?.trim() ?? ''));
/** The centre of a control once it has stopped moving: the preview reflows when the Properties card opens beside it. */
const centre = async (locator: ReturnType<Page['locator']>) => {
  let last = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const box = (await locator.boundingBox())!;
    const now = JSON.stringify(box);
    if (now === last) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    last = now;
    await locator.page().waitForTimeout(100);
  }
  throw new Error('The control kept moving');
};
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' }).click();

test('press and pull on the selected tile\'s grip lifts it, shows the cue, and a drop moves it as one undo step', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const before = await order(page);
  const grip = page.getByTestId('node-handle').getByRole('button', { name: 'Move' });
  await expect(grip).toBeVisible();
  const from = await centre(grip), to = await centre(previewTile(page, 'Demo Guests 2'));
  await snap(page, 'drag-handle-before-press');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y + 8, { steps: 8 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await expect(page.getByTestId('drag-announcement')).toContainText('Picked up Weather');
  await snap(page, 'drag-handle-in-progress');
  await page.mouse.up();
  await expect.poll(() => order(page)).not.toEqual(before);
  expect((await order(page)).indexOf('Weather')).toBeGreaterThan((await order(page)).indexOf('Demo Guests 2'));
  await expect(page.getByTestId('drag-announcement')).toContainText('Moved');
  await page.waitForTimeout(120);
  await undo(page);
  expect(await order(page)).toEqual(before);
});

test('a press on the grip that never moves does not lift the tile and Escape cancels a lift', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const before = await order(page);
  const grip = page.getByTestId('node-handle').getByRole('button', { name: 'Move' });
  const from = await centre(grip), to = await centre(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId('drop-cue')).toHaveCount(0);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y + 8, { steps: 8 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drop-cue')).toHaveCount(0);
  expect(await order(page)).toEqual(before);
});

test('the grip lifts with Space, arrows step the slots, Space drops, and the moves are announced', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const before = await order(page);
  await page.getByTestId('node-handle').getByRole('button', { name: 'Move' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Picked up Weather');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('drag-announcement')).not.toHaveText('');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Moved');
  await expect.poll(() => order(page)).not.toEqual(before);
});

test('a library row\'s grip lifts the row with a press and a pull and a drop reorders the element', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await openLibrary(page, 'Tabs');
  const tree = page.getByTestId('library-tree');
  const row = (name: string) => tree.locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row('Home').click();
  const before = await order(page);
  const grip = tree.getByRole('button', { name: 'Move Weather' });
  const target = row('Cameras');
  await expect(grip).toBeVisible();
  const from = await centre(grip), box = (await target.boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 6, { steps: 3 });
  await page.mouse.move(box.x + 80, box.y + box.height * 0.9, { steps: 8 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await snap(page, 'library-tree-drag-in-progress');
  await page.mouse.up();
  await expect.poll(() => order(page)).not.toEqual(before);
  expect((await order(page)).indexOf('Weather')).toBeGreaterThan((await order(page)).indexOf('Cameras'));
  await expect(previewRoot(page)).toBeVisible();
});

test('a drop on the grip route makes no long task', async ({ page }) => {
  test.skip(isPhone(page), 'Wide');
  await openWorkspace(page);
  await selectTile(page, 'Weather');
  const before = await order(page);
  await page.evaluate(() => {
    const tasks: number[] = []; (window as unknown as { __long: number[] }).__long = tasks;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) tasks.push(entry.duration); }).observe({ type: 'longtask', buffered: false });
  });
  const grip = page.getByTestId('node-handle').getByRole('button', { name: 'Move' });
  const from = await centre(grip), to = await centre(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y + 8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order(page)).not.toEqual(before);
  await page.waitForTimeout(400);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  expect(long.filter(duration => duration > 200)).toEqual([]);
});

test.describe('an iPad-width window with a touch pointer', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  test('a finger pressed on the grip and pulled lifts the tile and a release drops it where it lands', async ({ page }) => {
    test.skip(test.info().project.name === 'phone', 'The wide touch family runs once');
    await openWorkspace(page);
    // A locator click re-scrolls the tile into view each time the preview moves under it (opening the inspector narrows the stage), with
    // a new alignment on every retry, and that leaves the preview scrolled so the finger lands on the grip under the bar; the app scrolls
    // nothing here. So the tile is pressed where it stands, as a person would, and the test waits for the properties.
    const box = (await previewTile(page, 'Weather').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Weather', exact: true })).toBeVisible();
    const before = await order(page);
    const from = await centre(page.getByTestId('node-handle').getByRole('button', { name: 'Move' })), to = await centre(previewTile(page, 'Demo Guests 2'));
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: y!, id: 1 }] });
    await touch('touchStart', from.x, from.y);
    for (let step = 1; step <= 10; step += 1) await touch('touchMove', from.x + (to.x - from.x) * step / 10, from.y + (to.y + 8 - from.y) * step / 10);
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await touch('touchEnd');
    await expect.poll(() => order(page)).not.toEqual(before);
    await expect(page.getByTestId('drag-announcement')).toContainText('Moved');
  });
});
