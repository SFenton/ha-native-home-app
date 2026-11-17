import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seed } from './workspace2-helpers';
import { documentWithPush, PUSH_TARGET } from '../support/push-document';

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
