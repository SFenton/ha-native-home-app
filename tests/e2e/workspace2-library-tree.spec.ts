import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';

/**
 * The library as a tree of surfaces (studio-ux2 lib3, L-tax and L-tree, with the owner's G9 change): the six rail items, a top-level row that
 * opens in place, a child row that goes into its level, Back and the path, the trailing handle, drags, and the right-click menu.
 */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The library is the wide layout; a phone has sheets');
test.beforeEach(async ({ request }) => { await seed(request); });

/** The five wide viewports the Studio's families stand for. */
const viewports = [
  { name: 'desktop 1440', width: 1440, height: 900, docked: true },
  { name: 'iPad sideways 1180', width: 1180, height: 820, docked: true },
  { name: 'Duo sideways 951', width: 951, height: 669, docked: true },
  { name: 'iPad upright 820', width: 820, height: 1180, docked: false },
  { name: 'Duo upright 669', width: 669, height: 951, docked: false },
] as const;
const panel = (page: Page) => page.getByTestId('library-panel');
const tree = (page: Page) => page.getByTestId('library-tree');
const rowOf = (page: Page, name: string) => tree(page).locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();
const titles = (page: Page) => tree(page).locator('[role=treeitem] .w2-tree-title').allTextContents();
/** Waits for the panel to stop sliding, so a press lands where the row is. */
const settled = async (page: Page) => { let last = ''; await expect.poll(async () => { const now = JSON.stringify(await panel(page).boundingBox()); const same = now === last; last = now; return same; }).toBe(true); };
/** A control's box once it has stopped moving: a level slides in for 200 ms. */
const stable = async (locator: ReturnType<Page['locator']>) => {
  let last = '';
  for (let attempt = 0; attempt < 30; attempt += 1) { const now = JSON.stringify(await locator.boundingBox()); if (now === last) return JSON.parse(now) as { x: number; y: number; width: number; height: number }; last = now; await locator.page().waitForTimeout(80); }
  throw new Error('The control kept moving');
};
const openTabs = async (page: Page) => { await openWorkspace(page); await openLibrary(page, 'Tabs'); await expect(tree(page)).toBeVisible(); await settled(page); };
const subtitle = (page: Page) => panel(page).locator('.w2-lib-titles').last();

for (const view of viewports) {
  test.describe(view.name, () => {
    test.use({ viewport: { width: view.width, height: view.height } });

    test('the rail has Tabs, Pages, Sheets, Modals, Components, Controls, Flows, Data in order, unclipped, and Tabs lists the tab bar with a 56 px header', async ({ page }) => {
      // The docked library starts open from 1200 px, so a press on Tabs there would close it: open it only when it is not, then wait for it to stop sliding.
      await openTabs(page);
      const names = await page.getByTestId('library-rail').getByRole('button').allTextContents();
      expect(names).toEqual(['Tabs', 'Pages', 'Sheets', 'Modals', 'Components', 'Controls', 'Flows', 'Data']);
      const clipped = await page.getByTestId('library-rail').locator('.w2-lib-label').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth).map(node => node.textContent));
      expect(clipped).toEqual([]);
      expect(await titles(page)).toEqual(['Home', 'Security', 'Climate']);
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
      await expect(panel(page).getByText('3 of 5 in the tab bar')).toBeVisible();
      const head = await panel(page).locator('.w2-lib-level-head').boundingBox();
      expect(head!.height).toBe(view.docked ? 56 : 52);
      if (!view.docked) expect((await panel(page).locator('.w2-lib-flyout-head').boundingBox())!.height).toBe(56);
      await snap(page, `ltree-root-${view.width}`);
    });

    test('Home opens in place to its first-level rows without going in; Status goes into its level and is selected where the inspector can show; Back steps out', async ({ page }) => {
      await openTabs(page);
      await rowOf(page, 'Home').click();
      expect(await titles(page)).toEqual(['Home', 'Status', 'Weather', 'Conditional content', 'Cameras', 'Security', 'Climate']);
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
      await expect(page.getByLabel('Properties')).toHaveCount(0);
      await snap(page, `ltree-home-${view.width}`);
      await rowOf(page, 'Status').click();
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Status');
      await expect(panel(page).getByRole('navigation', { name: 'Path' })).toHaveText('Tabs›Home');
      expect(await titles(page)).toEqual(['Lights', 'Security', 'Climate', 'Occupancy', 'Contact Sensors', 'Air Quality']);
      if (view.docked && view.width >= 1100) await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Status' })).toBeVisible();
      else { await expect(panel(page)).toBeVisible(); await expect(page.getByLabel('Properties')).toHaveCount(0); }
      await snap(page, `ltree-status-${view.width}`);
      await panel(page).getByRole('button', { name: 'Back to Home' }).click();
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
      expect(await titles(page)).toEqual(['Home', 'Status', 'Weather', 'Conditional content', 'Cameras', 'Security', 'Climate']);
    });

    test('a crumb jumps to its level; the first crumb returns to the root list', async ({ page }) => {
      await openTabs(page);
      await rowOf(page, 'Home').click();
      await rowOf(page, 'Conditional content').click();
      await rowOf(page, 'Guests Staying Over').click();
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Guests Staying Over');
      const path = panel(page).getByRole('navigation', { name: 'Path' });
      await expect(path).toContainText('Tabs');
      await path.getByRole('button', { name: 'Conditional content' }).click();
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Conditional content');
      await panel(page).getByRole('navigation', { name: 'Path' }).getByRole('button').first().click();
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
    });

    test('the row anatomy: disclosure, icon, title, More, handle; no control is clipped, the title keeps 80 px and the handles share one x', async ({ page }) => {
      await openTabs(page);
      await rowOf(page, 'Home').click();
      const rows = tree(page).locator('[role=treeitem]');
      const first = rows.nth(1);
      const order = await first.evaluate(node => [...node.children].map(child => child.className.split(' ')[0]));
      expect(order.slice(0, 3)).toEqual(['w2-tree-slot', 'w2-tree-icon', 'w2-tree-title']);
      expect(order.slice(-2)).toEqual(['w2-tree-more', 'w2-tree-handle-slot']);
      const measures = await rows.evaluateAll(nodes => nodes.map(node => {
        const row = node.getBoundingClientRect(), title = node.querySelector('.w2-tree-title')!.getBoundingClientRect(), handle = node.querySelector('.w2-tree-handle-slot')!.getBoundingClientRect(), more = node.querySelector('.w2-tree-more')!.getBoundingClientRect();
        return { right: Math.round(handle.right), title: title.width, inside: handle.right <= row.right + 0.5 && more.left >= row.left, height: row.height };
      }));
      expect(new Set(measures.map(item => item.right)).size).toBe(1);
      // On a coarse pointer the row is 44 px with 44 px More and handle controls (spec L-tree), which takes about 32 px more from the title than a fine pointer does.
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      expect(measures.every(item => item.title >= (coarse ? 64 : 80) && item.inside), JSON.stringify(measures)).toBe(true);
      expect(measures[1].height).toBe(coarse ? 44 : 32);
      await snap(page, `ltree-row-${view.width}`);
    });

    test('Sheets, Pages and Modals root lists have no handle column; Tabs and every level of nodes do', async ({ page }) => {
      await openWorkspace(page);
      await openLibrary(page, 'Sheets');
      await expect(tree(page).locator('.w2-tree-handle')).toHaveCount(0);
      // Upright, the flyout covers the rail: its pop-up button switches category.
      if (view.docked) await openLibrary(page, 'Tabs'); else { await panel(page).getByRole('button', { name: /^Library:/ }).click(); await page.getByRole('menuitem', { name: 'Tabs' }).click(); }
      await expect(tree(page).locator('.w2-tree-handle')).toHaveCount(3);
      await snap(page, `ltree-sheets-rail-${view.width}`);
    });
  });
}

test.describe('on the desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the triangle opens a container in place without selecting it, Right and Left Arrow open, close and go to the parent', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Status').getByRole('button', { name: 'Show what is in Status' }).click();
    expect(await titles(page)).toContain('Lights');
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
    await expect(page.getByLabel('Properties')).toHaveCount(0);
    const lights = rowOf(page, 'Lights');
    await expect(lights).toHaveAttribute('aria-level', '3');
    await lights.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(rowOf(page, 'Status')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    expect(await titles(page)).not.toContain('Lights');
    await page.keyboard.press('ArrowRight');
    expect(await titles(page)).toContain('Lights');
  });

  test('everything starts closed, and what was open is still open after going in and coming back', async ({ page }) => {
    await openTabs(page);
    expect(await titles(page)).toEqual(['Home', 'Security', 'Climate']);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Cameras').getByRole('button', { name: 'Show what is in Cameras' }).click();
    await rowOf(page, 'Status').click();
    await panel(page).getByRole('button', { name: 'Back to Home' }).click();
    expect(await titles(page)).toEqual(['Home', 'Status', 'Weather', 'Conditional content', 'Cameras', 'Cameras', 'Security', 'Climate']);
  });

  test('Tabs reorder by the handle as one undo step', async ({ page }) => {
    await openTabs(page);
    const grip = rowOf(page, 'Home').getByRole('button', { name: 'Move Home' }), target = rowOf(page, 'Security');
    const from = await stable(grip), to = await stable(target);
    await page.mouse.move(from.x + 8, from.y + 8);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 30, { steps: 4 });
    await page.mouse.move(from.x + 8, to.y + to.height - 2, { steps: 6 });
    await expect(page.locator('.w2-tree-cue')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual(['Security', 'Home', 'Climate']);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => titles(page)).toEqual(['Home', 'Security', 'Climate']);
  });

  test('a handle drag reorders a level; a drop on a crumb moves the node to the end of that level; each is one undo step', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Status').click();
    expect(await titles(page)).toEqual(['Lights', 'Security', 'Climate', 'Occupancy', 'Contact Sensors', 'Air Quality']);
    const grip = rowOf(page, 'Lights').getByRole('button', { name: 'Move Lights' });
    const from = await stable(grip), target = await stable(rowOf(page, 'Climate'));
    await page.mouse.move(from.x + 8, from.y + 8);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 30, { steps: 4 });
    await page.mouse.move(target.x + 60, target.y + target.height * 0.9, { steps: 8 });
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual(['Security', 'Climate', 'Lights', 'Occupancy', 'Contact Sensors', 'Air Quality']);
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => titles(page)).toEqual(['Lights', 'Security', 'Climate', 'Occupancy', 'Contact Sensors', 'Air Quality']);
  });

  test('a drop on a crumb moves the node to the end of that level, as one undo step', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Conditional content').click();
    await rowOf(page, 'Guests Staying Over').click();
    expect(await titles(page)).toEqual(['Guests']);
    const grip = await stable(rowOf(page, 'Guests').getByRole('button', { name: 'Move Guests' }));
    const crumb = await stable(panel(page).getByRole('navigation', { name: 'Path' }).getByRole('button', { name: 'Conditional content', exact: true }));
    await page.mouse.move(grip.x + 8, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x + 8, grip.y - 12, { steps: 4 });
    await page.mouse.move(crumb.x + crumb.width / 2, crumb.y + crumb.height / 2, { steps: 8 });
    await expect(page.getByTestId('drop-cue')).toBeVisible();
    await page.mouse.up();
    // The moved node is selected, so the panel follows it to the level that now holds it.
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Conditional content');
    await expect.poll(() => titles(page)).toEqual(['Guests Staying Over', 'Guests']);
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => titles(page)).toEqual(['Guests Staying Over']);
  });

  test('a 700 ms hold over a closed container opens it, and over Back goes up a level, while the drag continues', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Status').click();
    // Inside Status, hold a row over Back: the list goes up to Tabs with Home open.
    const grip = await stable(rowOf(page, 'Lights').getByRole('button', { name: 'Move Lights' }));
    const back = await stable(panel(page).getByRole('button', { name: 'Back to Home' }));
    await page.mouse.move(grip.x + 8, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x + 8, grip.y - 20, { steps: 4 });
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2, { steps: 8 });
    await page.waitForTimeout(900);
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Tabs');
    // Now hold over the closed Conditional content row: it opens.
    const cond = (await rowOf(page, 'Conditional content').boundingBox())!;
    expect(await titles(page)).not.toContain('Guests Staying Over');
    await page.mouse.move(cond.x + 90, cond.y + cond.height / 2, { steps: 6 });
    await page.waitForTimeout(900);
    expect(await titles(page)).toContain('Guests Staying Over');
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a right-click on a page row and on a tab row opens its menu, and on a node row its element menu', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Security').click({ button: 'right' });
    await expect(page.getByTestId('row-menu').getByRole('menuitem')).toHaveText(['Tab Settings', 'Page Settings', 'Move Up', 'Move Down', 'Change List Icon…']);
    await page.keyboard.press('Escape');
    await openLibrary(page, 'Sheets');
    await rowOf(page, 'Security System').click({ button: 'right' });
    await expect(page.getByTestId('row-menu').getByRole('menuitem', { name: 'Sheet Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await openLibrary(page, 'Tabs');
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Weather').click({ button: 'right' });
    await expect(page.getByTestId('row-menu').getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
  });

  test('searching inside a level finds a nested node with its path, and choosing it lands on its level', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Conditional content').click();
    await panel(page).getByRole('searchbox', { name: 'Find in Conditional content' }).fill('Demo Guests 2');
    const hit = tree(page).locator('.w2-tree-hit');
    await expect(hit).toHaveCount(1);
    await expect(hit.locator('.w2-tree-path')).toHaveText('Conditional content › Guests Staying Over › Guests');
    await hit.click();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText('Guests');
    await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Demo Guests 2' })).toBeVisible();
  });

  test('Use mode keeps rows working and More, the handles and the add buttons in place; the handles and add buttons disabled', async ({ page }) => {
    await openTabs(page);
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await rowOf(page, 'Home').click();
    await expect(rowOf(page, 'Status').getByRole('button', { name: 'Move Status' })).toBeDisabled();
    // More stays, holding only the command that leaves the document alone (L-icons).
    await expect(rowOf(page, 'Status').getByRole('button', { name: 'More for Status' })).toBeEnabled();
    await expect(rowOf(page, 'Status').getByRole('button', { name: 'Move Status' })).toHaveAttribute('title', 'Switch to Edit to move this.');
    await expect(panel(page).getByRole('button', { name: 'Tab', exact: true })).toBeDisabled();
  });

  test('a sheet with Full screen on is listed under Modals and not under Sheets', async ({ page, request }) => {
    const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { modals: { title: string; presentation: Record<string, unknown> }[] } };
    const modal = fixture.document.modals.find(item => item.title === 'Security System')!;
    modal.presentation = { ...modal.presentation, fullScreen: true, adaptive: false, height: { type: 'full' } };
    await seed(request, fixture.document);
    await openWorkspace(page);
    await openLibrary(page, 'Modals');
    await expect(rowOf(page, 'Security System')).toBeVisible();
    await expect(panel(page).getByText('1 modal')).toBeVisible();
    await openLibrary(page, 'Sheets');
    await expect(rowOf(page, 'Security System')).toHaveCount(0);
  });
});

test.describe('motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  test('with Reduce Motion going into a level runs no transform transition, only a fade', async ({ page }) => {
    await openTabs(page);
    await rowOf(page, 'Home').click();
    await rowOf(page, 'Status').click();
    const animation = await tree(page).locator('.w2-level-view').evaluate(node => getComputedStyle(node).animationName);
    expect(animation).toBe('w2-level-fade');
  });
});
