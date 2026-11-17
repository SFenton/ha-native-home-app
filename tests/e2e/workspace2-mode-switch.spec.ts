import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, seed } from './workspace2-helpers';
import { documentWithPush, PUSH_TARGET } from '../support/push-document';

test.beforeEach(async ({ request }) => { await seed(request); });

/**
 * Switches the mode with `click` and watches the open sheet frame by frame for `ms`: its element, where it sits, and whether any
 * present or dismiss animation runs on it. A sheet that closes and opens again shows as a new element, a moving top or a running
 * `sh-sheet-in`.
 */
async function watchSheet(page: Page, click: () => Promise<void>, ms = 700) {
  await page.evaluate(ms => {
    const w = window as unknown as { __sheet: Promise<{ same: boolean; tops: number[]; animations: string[]; count: number }> };
    const first = document.querySelector('.sh-sheet');
    w.__sheet = new Promise(resolve => {
      const tops: number[] = [], animations = new Set<string>(); let same = true, count = 0;
      const start = performance.now();
      const tick = () => {
        const sheets = [...document.querySelectorAll('.sh-sheet')];
        count = Math.max(count, sheets.length);
        if (sheets[0] !== first) same = false;
        if (sheets[0]) tops.push(Math.round(sheets[0].getBoundingClientRect().top));
        for (const animation of document.getAnimations()) { const target = (animation.effect as KeyframeEffect | null)?.target; if (animation.playState === 'running' && target instanceof Element && target.closest('.sh-sheet-layer') && !target.classList.contains('sh-dim')) animations.add((animation as CSSAnimation).animationName); }
        if (performance.now() - start < ms) requestAnimationFrame(tick); else resolve({ same, tops, animations: [...animations], count });
      };
      requestAnimationFrame(tick);
    });
  }, ms);
  await click();
  return page.evaluate(() => (window as unknown as { __sheet: Promise<{ same: boolean; tops: number[]; animations: string[]; count: number }> }).__sheet);
}
const mode = (page: Page, name: 'Edit' | 'Use') => () => page.getByRole('button', { name, exact: true }).first().click();

test('a sheet opened in Use stays open and still when the mode goes to Edit and back', async ({ page }) => {
  await openWorkspace(page);
  await mode(page, 'Use')();
  await page.locator('.sh-page[data-current]').getByRole('button', { name: /Lights/ }).first().click();
  await expect(page.locator('.sh-sheet')).toHaveCount(1);
  await page.waitForTimeout(700);
  for (const to of ['Edit', 'Use', 'Edit'] as const) {
    const seen = await watchSheet(page, mode(page, to));
    expect(seen.same, `the same sheet element survives the switch to ${to}`).toBe(true);
    expect(seen.count).toBe(1);
    expect(new Set(seen.tops).size, `the sheet never moves (switch to ${to})`).toBe(1);
    expect(seen.animations, `no present or dismiss animation (switch to ${to})`).toEqual([]);
  }
});

test('a sheet that is open in Edit does not slide in again when the mode goes to Use', async ({ page }) => {
  await page.goto('/?preview2=1&surface=modal:hc-overview-lights&bezel=0');
  await expect(page.locator('.sh-sheet')).toHaveCount(1);
  await page.waitForTimeout(700);
  for (const label of ['Mode: edit', 'Mode: use', 'Mode: edit']) {
    const seen = await watchSheet(page, () => page.getByRole('button', { name: label }).click());
    expect(seen.same, label).toBe(true);
    expect(new Set(seen.tops).size, `the sheet never moves (${label})`).toBe(1);
    expect(seen.animations, label).toEqual([]);
  }
});

test('a page pushed in Use is still the page after Edit and back, and is not drawn twice', async ({ page, request }) => {
  await seed(request, documentWithPush());
  await openWorkspace(page);
  await mode(page, 'Use')();
  await page.locator('.sh-page[data-current]').getByRole('button', { name: new RegExp(PUSH_TARGET.tile) }).first().click();
  await expect(page.locator('.sh-page[data-current]')).toHaveAttribute('data-page', PUSH_TARGET.pageId);
  await expect(page.locator('.sh-page')).toHaveCount(1);
  const current = page.locator('.sh-page[data-current]');
  const handle = await current.elementHandle();
  for (const to of ['Edit', 'Use'] as const) {
    await mode(page, to)();
    await expect(current).toHaveAttribute('data-page', PUSH_TARGET.pageId);
    await expect(page.locator('.sh-page')).toHaveCount(1);
    expect(await handle!.evaluate(element => element.isConnected), `the pushed page element survives the switch to ${to}`).toBe(true);
    expect(await current.evaluate(element => element.getAnimations().length), `no slide runs on it (${to})`).toBe(0);
  }
});
