import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, snap } from './workspace2-helpers';
import { documentWithPush, PUSH_TARGET } from '../support/push-document';
import { documentWithLevels } from '../support/levels-document';

test.beforeEach(async ({ request }) => { await seed(request, documentWithPush()); });

/** What one tap did, read from inside the page so the numbers carry no test-runner latency. */
interface Move { firstMs: number; goneMs: number; offsetAtFirst: number; animations: string[]; maxPages: number }

/** Turns the preview to Use and waits for the Home page. */
async function startUse(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await expect(page.locator('.sh-page[data-current]')).toHaveAttribute('data-page', 'page-home');
}
/** Arms the probe: from the next pointer press, when the page `id` is first drawn, how far it sits from the screen's edge then, and when it is the only page. */
async function arm(page: Page, id: string) {
  await page.evaluate(id => {
    const w = window as unknown as { __move: Promise<Move> };
    w.__move = new Promise<Move>(resolve => {
      let t0 = 0, firstMs = -1, offset = 0, animations: string[] = [], maxPages = 0;
      const pages = () => [...document.querySelectorAll<HTMLElement>('.sh-page')];
      const look = () => {
        const all = pages(), mine = all.find(item => item.dataset.page === id);
        maxPages = Math.max(maxPages, all.length);
        if (mine && firstMs < 0) {
          firstMs = performance.now() - t0;
          offset = Math.abs(mine.getBoundingClientRect().left - document.querySelector('.sh-screen')!.getBoundingClientRect().left);
          animations = mine.getAnimations().map(animation => (animation as CSSAnimation).animationName);
        }
        if (mine && all.length === 1 && firstMs >= 0) { observer.disconnect(); resolve({ firstMs, goneMs: performance.now() - t0, offsetAtFirst: offset, animations, maxPages }); }
      };
      const observer = new MutationObserver(look);
      document.addEventListener('pointerdown', () => { t0 = performance.now(); observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); }, { once: true, capture: true });
    });
  }, id);
}
const read = (page: Page) => page.evaluate(() => (window as unknown as { __move: Promise<Move> }).__move);

test('a push starts moving within a frame or so of the tap and the old page is gone when it ends', async ({ page }) => {
  await startUse(page);
  await arm(page, PUSH_TARGET.pageId);
  await page.locator('.sh-page[data-current]').getByRole('button', { name: new RegExp(PUSH_TARGET.tile) }).first().click();
  const move = await read(page);
  expect(move.firstMs, 'the new page is drawn within ~100 ms of the tap').toBeLessThan(100);
  expect(move.offsetAtFirst, 'it starts off the leading edge, sliding in').toBeGreaterThan(20);
  expect(move.animations).toContain('sh-in-push');
  expect(move.maxPages).toBe(2);
  expect(move.goneMs, 'the old page leaves with the slide (about 300 ms), never lingering').toBeLessThan(600);
  await expect(page.locator('.sh-page')).toHaveCount(1);
  await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText(PUSH_TARGET.title);
});

test('Back pops with the mirrored slide, and the tab switch is a cut', async ({ page }) => {
  await startUse(page);
  await page.locator('.sh-page[data-current]').getByRole('button', { name: new RegExp(PUSH_TARGET.tile) }).first().click();
  await expect(page.locator('.sh-page')).toHaveCount(1);
  await arm(page, 'page-home');
  await page.locator('.sh-page[data-current]').getByRole('button', { name: 'Back', exact: true }).click();
  const move = await read(page);
  expect(move.firstMs).toBeLessThan(100);
  expect(move.animations).toContain('sh-in-pop');
  expect(move.goneMs).toBeLessThan(600);
  await expect(page.locator('.sh-page')).toHaveCount(1);
  // A tab switch has no motion: one page at once, and nothing animating.
  await page.locator('.sh-tabbar, .sh-flyout').getByRole('button', { name: 'Security', exact: true }).first().click();
  await expect(page.locator('.sh-page[data-current]')).toHaveAttribute('data-page', 'page-security');
  await expect(page.locator('.sh-page')).toHaveCount(1);
  expect(await page.locator('.sh-page').evaluate(item => item.getAnimations().length)).toBe(0);
});

test('Reduce Motion cross-fades in place and still leaves one page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startUse(page);
  await arm(page, PUSH_TARGET.pageId);
  await page.locator('.sh-page[data-current]').getByRole('button', { name: new RegExp(PUSH_TARGET.tile) }).first().click();
  const move = await read(page);
  expect(move.animations).toContain('sh-fade');
  expect(move.offsetAtFirst, 'no slide: the page is in place').toBeLessThan(2);
  expect(move.goneMs).toBeLessThan(600);
  await expect(page.locator('.sh-page')).toHaveCount(1);
});

/**
 * A level is a surface the Studio shows and edits (`sh.sheet-levels@1`, `sl-surface`). The document is the global-chrome demo: a sheet with two levels beneath
 * it and one level nothing opens. Nothing here reads a font metric: every check is a key, an attribute or a count.
 */
test.describe('a level in the Studio', () => {
  test.beforeEach(async ({ request }) => { await seed(request, documentWithLevels()); });
  const sheet = (page: Page) => page.locator('.sh-sheet');
  const tile = (page: Page, id: string) => page.locator(`.sh-sheet [data-sel="node:${id}"]`);

  /** Use: open the sheet and its first level, then Edit, which keeps the level on show. */
  async function editInLevel(page: Page, level: 'a' | 'b' = 'a') {
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Use', exact: true }).first().click();
    await page.locator('[data-sel="node:demo_home_to_sheet"]').first().click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Sheet');
    await page.locator('.sh-sheet [data-sel="node:demo_sheet_to_demo_level_a"]').first().click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level A');
    if (level === 'b') {
      await page.locator('.sh-sheet [data-sel="node:demo_level_a_to_demo_level_b"]').first().click();
      await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level B');
    }
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await expect(page.locator('[data-preview-root][data-mode="edit"]')).toHaveCount(1);
    await expect(sheet(page)).toHaveAttribute('aria-label', level === 'a' ? 'Demo Level A' : 'Demo Level B');
  }
  /** The "+ Add" button of the level on show: the slot's button on a wide window, the bottom bar's on the phone. It must be the button, not the empty slot behind it. */
  const addButton = (page: Page) => isPhone(page) ? page.locator('.w2-bottom-add') : page.locator('.sh-sheet .w2-add-slot');

  for (const scheme of ['light', 'dark'] as const) test(`a node inside a level selects, shows its inspector, and Back is live in Edit while Close is not (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await editInLevel(page);
    const shot = (state: string) => snap(page, `level-${state}-${info.project.name}-${scheme}`);
    const node = tile(page, 'demo_level_a_to_demo_level_b');
    await node.click();
    await expect(node).toHaveAttribute('data-selected', '');
    await expect(page.getByLabel('Properties')).toBeVisible();
    // The inspector names the node's surface: the level, not an empty place.
    await expect(page.getByLabel('Properties')).toContainText('Demo Level A');
    // The Add slot of the level is drawn, as on any surface.
    await expect(page.locator('.sh-sheet .sh-add-slot[data-add-for="level:demo_level_a"]')).toHaveCount(1);
    await shot('1-node-selected');
    // Close stays inert in Edit; Back steps out one step and the title says where it goes.
    await sheet(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level A');
    const back = sheet(page).getByRole('button', { name: 'Back', exact: true });
    await expect(back).toHaveAttribute('title', 'Back to Demo Sheet');
    await back.click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Sheet');
    await expect(sheet(page).getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await shot('2-back-to-sheet');
  });

  test('a tile inside a level is duplicated and deleted from its menu, and Undo brings it back', async ({ page }) => {
    await editInLevel(page);
    const nodes = page.locator('.sh-sheet [data-sel^="node:"]');
    const before = await nodes.count();
    const menu = page.getByTestId('element-menu');
    await tile(page, 'demo_level_a_to_demo_level_b').click({ button: 'right' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(nodes).toHaveCount(before + 1);
    await tile(page, 'demo_level_a_to_demo_level_b').first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(nodes).toHaveCount(before);
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect(nodes).toHaveCount(before + 1);
  });

  for (const scheme of ['light', 'dark'] as const) test(`Back with a tile selected leaves nothing selected and the inspector closed (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await editInLevel(page);
    const node = tile(page, 'demo_level_a_to_demo_level_b');
    await node.click();
    await expect(page.getByLabel('Properties')).toBeVisible();
    // No click on Close first: Back alone.
    await sheet(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Sheet');
    await expect(page.locator('[data-preview-root] [data-selected]')).toHaveCount(0);
    await expect(page.getByLabel('Properties')).toHaveCount(0);
    await snap(page, `level-3-back-with-selection-${info.project.name}-${scheme}`);
  });

  for (const level of ['a', 'b'] as const) for (const scheme of ['light', 'dark'] as const) test(`"+ Add" is drawn in ${level === 'a' ? 'a level' : 'an empty level'} and adds a tile to it (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await editInLevel(page, level);
    const nodes = page.locator('.sh-sheet [data-sel^="node:"]');
    const before = await nodes.count();
    expect(before).toBe(level === 'a' ? 1 : 0);
    await expect(addButton(page)).toBeVisible();
    await snap(page, `level-4-add-${level === 'a' ? 'in-level' : 'in-empty-level'}-${info.project.name}-${scheme}`);
    await addButton(page).click();
    await page.getByTestId('add-picker').getByRole('listitem').filter({ hasText: 'Button' }).first().click();
    await expect(nodes).toHaveCount(before + 1);
    await expect(page.getByLabel('Properties').getByRole('heading', { name: 'New button' })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) test(`a level no sheet opens is shown alone in the workspace, and a click on it opens no empty inspector (${scheme})`, async ({ page, request }, info) => {
    await seed(request, documentWithLevels());
    await page.emulateMedia({ colorScheme: scheme });
    await openWorkspace(page);
    // The one way the Studio reaches a level no sheet opens before the library does: its "has no way in" suggestion goes to it.
    if (isPhone(page)) { await page.getByRole('button', { name: 'Project' }).click(); await page.getByRole('button', { name: 'Checks', exact: true }).click(); }
    else await page.getByTestId('checks-pill').click();
    await page.getByRole('button', { name: /Demo Level Alone has no way in/ }).first().click();
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Demo Level Alone');
    await expect(sheet(page).getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await expect(sheet(page).getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);
    await expect(page.locator('.sh-page')).toHaveCount(0);
    await snap(page, `level-5-alone-${info.project.name}-${scheme}`);
    // A click on the level's own bar: the level is selected, and the inspector stays shut rather than opening empty.
    await expect(addButton(page)).toBeVisible();
    await sheet(page).locator('.sh-sheet-title').click();
    await expect(page.getByLabel('Properties')).toHaveCount(0);
    await snap(page, `level-6-alone-clicked-${info.project.name}-${scheme}`);
  });
});
