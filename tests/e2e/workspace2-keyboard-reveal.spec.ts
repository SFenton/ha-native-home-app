import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isPhone, openLibrary, openWorkspace, previewRoot, seed, selectTile } from './workspace2-helpers';

/**
 * A keyboard step in a drag scrolls the scrollers that contain the slot, only as far as needed to put its bar inside the band a person can see, and no other
 * scroller (HIG Scroll views, Drag and drop). Checked on the preview (down the page and along a status rail), the library's tree and the phone's level list.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

/** Where the drop cue is against a scroller's visible band: its box without the padding that bars drawn over it cover, along both axes. */
async function cueInside(page: Page, scroller: Locator, along: 'y' | 'both' = 'both'): Promise<{ inside: boolean; detail: string }> {
  const cue = await page.getByTestId('drop-cue').boundingBox();
  const band = await scroller.evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element), scale = box.height / element.clientHeight;
    return { top: box.top + parseFloat(style.paddingTop) * scale, bottom: box.bottom - parseFloat(style.paddingBottom) * scale, left: box.left, right: box.right };
  });
  const inside = Boolean(cue) && cue!.y >= band.top - 1 && cue!.y + cue!.height <= band.bottom + 1 && (along === 'y' || (cue!.x >= band.left - 1 && cue!.x + cue!.width <= band.right + 1));
  return { inside, detail: JSON.stringify({ cue, band }) };
}
const scrollOffsets = (root: Locator, selector: string) => root.locator(selector).evaluateAll(elements => elements.map(element => [element.scrollTop, element.scrollLeft]));

test('on the preview each step shows its slot, down the page and along the status rail', async ({ page }) => {
  test.skip(isPhone(page), 'The preview sits behind the sheets on a phone');
  await openWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 620 });
  const scroller = previewRoot(page).locator('.sh-scroll').first();
  const rail = previewRoot(page).locator('.sh-rail').first();
  const lift = async (title: string) => {
    await selectTile(page, title);
    await page.getByTestId('node-handle').locator('[aria-label="Move"]').focus();
    await page.keyboard.press('Space');
  };
  const shown = async (step: string) => {
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await expect.poll(async () => (await cueInside(page, scroller, 'y')).inside, { message: `${step}: the slot's bar is shown inside the page's visible band` }).toBe(true);
  };
  // A tile steps down the page and back up.
  await lift('Weather');
  for (const [step, key] of [...Array(6).fill('ArrowDown'), ...Array(6).fill('ArrowUp')].entries()) { await page.keyboard.press(key); await shown(`${key} ${step + 1}`); }
  await page.keyboard.press('Escape');
  // A chip steps along its rail: each slot's bar ends inside the rail's own box, the rail scrolling sideways for the ones past its edge.
  await lift('Climate');
  let farthest = 0, slotsOfRail = 0;
  for (const [step, key] of [...Array(7).fill('ArrowDown'), ...Array(7).fill('ArrowUp')].entries()) {
    await page.keyboard.press(key);
    await shown(`${key} ${step + 1} along the rail`);
    // A vertical bar is a slot of the rail; the walk goes on to the slots of the page's containers after the rail's last.
    if ((await steadyCue(page)).width <= 3) {
      slotsOfRail += 1;
      await expect.poll(() => railHolds(page, rail), { message: `${key} ${step + 1}: the slot's bar is inside the rail's box` }).toBe(true);
    }
    farthest = Math.max(farthest, await rail.evaluate(element => element.scrollLeft));
  }
  expect(slotsOfRail, 'the walk reached slots of the rail').toBeGreaterThan(2);
  expect(farthest, 'the rail scrolled sideways to show a slot past its edge').toBeGreaterThan(0);
  await page.keyboard.press('Escape');
});
/** The cue's box once it has stopped changing: the step's scroll and the cue's redraw land a frame or two after the key. */
async function steadyCue(page: Page) {
  const cue = page.getByTestId('drop-cue');
  await expect(cue).toBeVisible();
  let last = '';
  await expect.poll(async () => { const now = JSON.stringify(await cue.boundingBox()); const same = now === last; last = now; return same; }, { intervals: [120] }).toBe(true);
  return (await cue.boundingBox())!;
}
/** Whether the cue is a bar of the rail's own slot, shown inside the rail's box. */
async function railHolds(page: Page, rail: Locator, slack = 1): Promise<boolean> {
  const cue = await page.getByTestId('drop-cue').boundingBox(), box = await rail.boundingBox();
  if (!cue || !box) return false;
  const inRow = cue.y + cue.height / 2 >= box.y && cue.y + cue.height / 2 <= box.y + box.height;
  return inRow && cue.x >= box.x - slack && cue.x + cue.width <= box.x + box.width + slack;
}

test('in the library tree each step shows its row and the preview does not move', async ({ page }) => {
  test.skip(isPhone(page), 'The library tree is the wide layout');
  await openWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 560 });
  await openLibrary(page, 'Tabs');
  const tree = page.getByTestId('library-tree');
  await expect(tree).toBeVisible();
  const row = (name: string) => tree.locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
  await row('Home').click();
  await row('Status').click();
  const scroller = page.locator('.w2-lib-scroll').first();
  const before = await scrollOffsets(previewRoot(page), '.sh-scroll');
  await row('Lights').getByRole('button', { name: 'Move Lights' }).focus();
  await page.keyboard.press('Space');
  // Lights is the first of six rows: the five slots after its own are in this level; the next step goes on to a container the list does not show, which has no row to draw a bar on.
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await expect.poll(async () => (await cueInside(page, scroller)).inside, { message: `step ${step + 1}: the target row is shown` }).toBe(true);
  }
  expect(await scrollOffsets(previewRoot(page), '.sh-scroll'), 'the preview is not scrolled for a slot that is not in it').toEqual(before);
  await page.keyboard.press('Escape');
});

test('in the phone level list each step shows its row and the preview does not move', async ({ page }) => {
  test.skip(!isPhone(page), 'The level list is the phone sheet');
  await openWorkspace(page);
  await page.getByRole('button', { name: 'This Page', exact: true }).click();
  const list = page.getByTestId('level-list');
  await expect(list).toBeVisible();
  const scroller = page.locator('.w2-level-scroll').first();
  const grips = list.getByRole('button', { name: /^Move / });
  const rows = await grips.count();
  expect(rows).toBeGreaterThan(2);
  const before = await scrollOffsets(previewRoot(page), '.sh-scroll');
  await grips.first().focus();
  await page.keyboard.press('Space');
  // The sheet settles (it slides) before a person steps; the cue is measured against rows that have stopped.
  let last = '';
  await expect.poll(async () => { const now = JSON.stringify(await list.boundingBox()); const same = now === last; last = now; return same; }, { intervals: [120] }).toBe(true);
  for (let step = 0; step < rows; step += 1) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await expect.poll(async () => (await cueInside(page, scroller)).inside, { message: `step ${step + 1}: the target row is shown` }).toBe(true);
  }
  expect(await scrollOffsets(previewRoot(page), '.sh-scroll'), 'the preview is not scrolled for a slot that is not in it').toEqual(before);
  await page.keyboard.press('Escape');
});

type Node = { id: string; title: string; type: string; children?: Node[]; [key: string]: unknown };
/** The home-domains fixture with a paged row of four tiles (two to a page) added to the first page, so the page has a track that snaps. */
function withPagedRow() {
  const { document } = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { components: Node[] }[] } };
  const find = (nodes: Node[]): Node | undefined => { for (const node of nodes) { if (node.type.endsWith('-tile') && !node.children?.length) return node; const inner = find(node.children ?? []); if (inner) return inner; } return undefined; };
  const tile = find(document.pages[0].components)!;
  const children = ['One', 'Two', 'Three', 'Four'].map(name => ({ ...structuredClone(tile), id: `demo_paged_${name.toLowerCase()}`, title: `Paged ${name}` }));
  document.pages[0].components.splice(2, 0, { id: 'demo_paged_row', title: 'Paged Row', type: 'paged-row', layout: { span: 1 }, props: { perPage: 2, pageLabel: 'Page', showsIndicator: true }, children });
  return document;
}

test('in a paged row a step shows its slot inside the track and the track rests on a page', async ({ page, request }) => {
  test.skip(isPhone(page), 'The preview sits behind the sheets on a phone');
  await seed(request, withPagedRow());
  await openWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 760 });
  const track = previewRoot(page).locator('.sh-paged-track').first();
  await expect(track).toBeVisible();
  await selectTile(page, 'Paged Four');
  // The preview reflows when the Properties card opens beside it: step once its boxes have stopped moving.
  let held = '';
  await expect.poll(async () => { const now = JSON.stringify(await track.boundingBox()); const same = now === held; held = now; return same; }, { intervals: [150] }).toBe(true);
  await page.getByTestId('node-handle').locator('[aria-label="Move"]').focus();
  await page.keyboard.press('Space');
  /** Whether scrollLeft sits on a snap point: a child's left edge, to a pixel, or the end of the track. */
  const onSnapPoint = () => track.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.scrollLeft + 1 >= element.scrollWidth - element.clientWidth || [...element.children].some(child => Math.abs(child.getBoundingClientRect().left - box.left) <= 1);
  });
  const settledTrack = async () => { let last = -1; await expect.poll(async () => { const now = await track.evaluate(element => element.scrollLeft); const same = now === last; last = now; return same; }, { intervals: [120] }).toBe(true); };
  let scrolledTo = 0;
  // Up from the last tile to the slot between the pages and on to the first page's slots, then back down to the second page.
  for (const [step, key] of ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowDown'].entries()) {
    await page.keyboard.press(key);
    await settledTrack();
    // The cue's slot is drawn (a vertical bar) inside the track, or the walk has moved on to the page's other containers.
    if ((await steadyCue(page)).width <= 3) {
      // A bar between two pages sits in the gap between them, so the track's own gap is the most it may stand outside the box.
      const gap = await track.evaluate(element => parseFloat(getComputedStyle(element).columnGap) * element.getBoundingClientRect().width / element.clientWidth);
      await expect.poll(() => railHolds(page, track, gap + 1), { message: `${key} ${step + 1}: the slot's bar is inside the track's box` }).toBe(true);
      expect(await onSnapPoint(), `${key} ${step + 1}: the track rests on a page`).toBe(true);
    }
    scrolledTo = Math.max(scrolledTo, await track.evaluate(element => element.scrollLeft));
  }
  expect(scrolledTo, 'the track moved to a later page').toBeGreaterThan(0);
  await page.keyboard.press('Escape');
});
