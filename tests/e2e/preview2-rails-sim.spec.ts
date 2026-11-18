import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';
import { documentWith, literalBadge } from './rails-fixture';

/**
 * The Duo simulator's rails (`studio-sim-rails`): S2, the control rail is pinned to the canvas and does not move with the pose; S6, press and hold
 * on the tab bar shows labels and a lens, follows the pointer and selects only on release. Mouse and touch both. Screenshots go to `STUDIO_EVIDENCE_DIR`.
 */
test.beforeEach(async ({ request }) => { await seed(request); });
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The rail is a desktop control; the phone project draws it under the preview');

async function startDuo(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
}
const sim = (page: Page) => page.getByTestId('simulator-rail');
const press = async (page: Page, name: string) => { await sim(page).getByRole('button', { name, exact: true }).click(); await rigSettled(page); };
const railBox = (page: Page) => page.locator('.w2-rail-slot').evaluate(element => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width, height: box.height }; });

for (const [width, height] of [[1440, 900], [820, 1180]] as const) {
  test(`S2: the control rail stays put across rotate, fold and unfold at ${width} x ${height}, and moves when the viewport resizes`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await startDuo(page);
    const first = await railBox(page);
    for (const step of ['Folded', 'Rotate Right', 'Partly Folded', 'Rotate Right', 'Unfolded', 'Rotate Left', 'Folded', 'Unfolded']) {
      await press(page, step);
      const now = await railBox(page);
      for (const key of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(now[key] - first[key]), `${step}: rail ${key}`).toBeLessThanOrEqual(0.5);
    }
    await page.setViewportSize({ width: width - 120, height: height - 80 });
    await expect.poll(async () => { const now = await railBox(page); return Math.abs(now.left - first.left) + Math.abs(now.top - first.top); }, { timeout: 5000 }).toBeGreaterThan(20);
  });
}

/** The folded Duo's tab pill and its tabs. */
const bar = (page: Page) => previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer .sh-tabbar');
const tabs = (page: Page) => bar(page).locator('.sh-tab');
const current = async (page: Page) => bar(page).locator('.sh-tab[aria-current=page]').innerText();

/**
 * The live outer face at rest: its screen, tab pill and profile button keep the same boxes for two reads 150 ms apart. `rigSettled` reads the first
 * screen it finds, and on a slower runner the folded face can still be turning when it returns, so a box read next (or a press at a place read a
 * moment before) lands on a face that has moved.
 */
async function faceSettled(page: Page) {
  let last = '';
  await expect.poll(async () => {
    const now = await page.evaluate(() => {
      const face = document.querySelector('[data-preview-root] .sh-rig:not([data-frozen]) .sh-outer');
      if (!face) return '';
      return [face, face.querySelector('.sh-screen'), face.querySelector('.sh-tabbar'), face.querySelector('.sh-profile')].map(item => { const box = item?.getBoundingClientRect(); return box ? [box.x, box.y, box.width, box.height].map(value => value.toFixed(2)).join(',') : '-'; }).join('|');
    });
    const steady = now !== '' && now === last;
    last = now;
    return steady;
  }, { intervals: [150], timeout: 10_000 }).toBe(true);
}

async function foldedDuo(page: Page) {
  await startDuo(page);
  await press(page, 'Folded');
  await expect(bar(page)).toHaveCount(1);
  await faceSettled(page);
}
const centreOf = async (page: Page, index: number) => { const box = (await tabs(page).nth(index).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };

test.describe('S6: press and hold on the tab bar (mouse)', () => {
  test('hold shows labels and the lens, a drag moves it, and only the release selects', async ({ page }) => {
    await foldedDuo(page);
    const before = await current(page);
    const start = await centreOf(page, 0);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    await page.waitForTimeout(600);
    await snap(page, 'duo-hold-labels');
    const target = await centreOf(page, 2);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(tabs(page).nth(2)).toHaveAttribute('data-lit', '');
    // Nothing is selected until the release.
    expect(await current(page)).toBe(before);
    await snap(page, 'duo-hold-drag');
    await page.mouse.up();
    await expect(bar(page)).not.toHaveAttribute('data-hold');
    await expect.poll(() => current(page)).toBe(await tabs(page).nth(2).innerText());
  });

  test('the held pill stays inside the screen, its bottom 14 pt above the screen bottom', async ({ page }) => {
    await foldedDuo(page);
    const screen = previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer .sh-screen');
    const start = await centreOf(page, 0);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    // The pill grows with the hold: wait for its transition to end, then measure it.
    await expect.poll(async () => (await bar(page).boundingBox())!.height, { timeout: 3000 }).toBeGreaterThan((await tabs(page).count()) * 55);
    await page.waitForTimeout(500);
    const pill = (await bar(page).boundingBox())!, face = (await screen.boundingBox())!;
    expect(pill.y, 'top inside the screen').toBeGreaterThanOrEqual(face.y);
    // The rig scales the screen, so the gap is read in the screen's own points.
    const scale = face.height / await screen.evaluate(item => (item as HTMLElement).offsetHeight);
    expect((face.y + face.height - (pill.y + pill.height)) / scale, 'bottom clearance in points').toBeCloseTo(14, 0);
    await page.mouse.up();
  });

  test('releasing outside the bar selects the last tab under the pointer, as native does', async ({ page }) => {
    await foldedDuo(page);
    const before = await current(page);
    const start = await centreOf(page, 2), box = (await bar(page).boundingBox())!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    await page.mouse.move(box.x - 150, start.y, { steps: 6 });
    await page.mouse.up();
    await expect(bar(page)).not.toHaveAttribute('data-hold');
    // Native commits the item last under the finger: the pointer left the bar level with the third tab.
    expect(before).not.toBe(await tabs(page).nth(2).innerText());
    await expect.poll(() => current(page)).toBe(await tabs(page).nth(2).innerText());
  });

  test('Escape during a hold selects nothing', async ({ page }) => {
    await foldedDuo(page);
    const before = await current(page);
    const start = await centreOf(page, 0), target = await centreOf(page, 2);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await current(page)).toBe(before);
  });

  test('a plain click still selects, and a keyboard activation too', async ({ page }) => {
    await foldedDuo(page);
    await tabs(page).nth(2).click();
    await expect.poll(() => current(page)).toBe(await tabs(page).nth(2).innerText());
    await tabs(page).nth(1).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => current(page)).toBe(await tabs(page).nth(1).innerText());
  });
});

test.describe('S6: press and hold on the tab bar (touch)', () => {
  test.use({ hasTouch: true });
  test('hold, drag and release with a finger selects the tab under it', async ({ page }) => {
    await foldedDuo(page);
    const before = await current(page);
    const start = await centreOf(page, 0), target = await centreOf(page, 2);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
    await touch('touchStart', start);
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    expect(await current(page)).toBe(before);
    for (let step = 1; step <= 6; step += 1) await touch('touchMove', { x: start.x + (target.x - start.x) * step / 6, y: start.y + (target.y - start.y) * step / 6 });
    await expect(tabs(page).nth(2)).toHaveAttribute('data-lit', '');
    await touch('touchEnd');
    await expect(bar(page)).not.toHaveAttribute('data-hold');
    await expect.poll(() => current(page)).toBe(await tabs(page).nth(2).innerText());
  });
});

/** The folded Duo's live outer face, for the badge and More checks. */
const outer = (page: Page) => previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer');

test.describe('A7: the profile badge on the rail', () => {
  for (const [label, badge, width] of [['3', literalBadge(3), 18], ['9+', literalBadge('9+'), 24]] as const) {
    test(`a "${label}" badge's centre is (+9.8, -15.3) pt from the disc's centre and the badge lies inside the header pill`, async ({ page, request }) => {
      await seed(request, documentWith(3, badge));
      await startDuo(page);
      await press(page, 'Folded');
      await faceSettled(page);
      const disc = (await outer(page).locator('.sh-profile .sh-avatar-disc').boundingBox())!, mark = (await outer(page).locator('[data-testid=badge]').boundingBox())!;
      const pill = (await outer(page).locator('.sh-rail-group').boundingBox())!;
      // The rig scales the screen: a point is the disc's 30 pt over its width.
      const point = disc.width / 30;
      expect(((mark.x + mark.width / 2) - (disc.x + disc.width / 2)) / point, 'x offset in pt').toBeCloseTo(9.8, 0);
      expect(((mark.y + mark.height / 2) - (disc.y + disc.height / 2)) / point, 'y offset in pt').toBeCloseTo(-15.3, 0);
      expect(mark.height / point, 'height in pt').toBeCloseTo(18, 0);
      expect(Math.abs(mark.width / point - width), 'width in pt').toBeLessThan(1.5);
      const slack = 0.5;
      expect(mark.x, 'inside the pill, left').toBeGreaterThanOrEqual(pill.x - slack);
      expect(mark.x + mark.width, 'inside the pill, right').toBeLessThanOrEqual(pill.x + pill.width + slack);
      expect(mark.y, 'inside the pill, top').toBeGreaterThanOrEqual(pill.y - slack);
      expect(mark.y + mark.height, 'inside the pill, bottom').toBeLessThanOrEqual(pill.y + pill.height + slack);
    });
  }
});

/** Records the names of animations that really start: a name in a computed style is reported even where its keyframes do not exist, but `animationstart` fires only for a running animation. */
const recordAnimations = (page: Page) => page.evaluate(() => {
  const seen: string[] = [];
  (window as unknown as { __animations: string[] }).__animations = seen;
  document.addEventListener('animationstart', event => seen.push((event as AnimationEvent).animationName), true);
});
const started = (page: Page) => page.evaluate(() => [...(window as unknown as { __animations: string[] }).__animations]);

test.describe('S6: Reduce Motion hold', () => {
  test('the lens cross-fades without scaling, the glyph stays its size, and the lens follows the pointer', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await foldedDuo(page);
    await recordAnimations(page);
    const lens = bar(page).locator('.sh-tab-lens');
    const idle = await lens.evaluate(item => getComputedStyle(item).opacity);
    expect(idle).toBe('0');
    const start = await centreOf(page, 0);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect(bar(page)).toHaveAttribute('data-hold', '');
    // A fade: opacity is the only property that transitions on the lens, and it carries no scale (translate only) while shown.
    const style = await lens.evaluate(item => { const css = getComputedStyle(item); const matrix = new DOMMatrix(css.transform); return { property: css.transitionProperty, scale: [matrix.a, matrix.d] }; });
    expect(style.property).toBe('opacity');
    expect(style.scale).toEqual([1, 1]);
    await expect.poll(() => lens.evaluate(item => getComputedStyle(item).opacity)).toBe('1');
    // The pill cross-fades to its held size: it does not grow (no size transition) and the new size fades in.
    const pill = await bar(page).evaluate(item => { const css = getComputedStyle(item); return { animation: css.animationName, transition: css.transitionProperty }; });
    expect(pill).toEqual({ animation: 'sh-fade', transition: 'none' });
    // And it really runs: the animation started, which it does only where its keyframes exist.
    await expect.poll(() => started(page)).toContain('sh-fade');
    const glyph = bar(page).locator('.sh-tab[data-lit] .sh-tab-glyph');
    expect(await glyph.evaluate(item => getComputedStyle(item).transform)).toBe('none');
    // It follows the pointer: its centre goes to the tab under it, a pitch at a time.
    const centreY = async () => { const box = (await lens.boundingBox())!; return box.y + box.height / 2; };
    for (const index of [1, 2]) {
      const target = await centreOf(page, index);
      await page.mouse.move(target.x, target.y, { steps: 6 });
      await expect(tabs(page).nth(index)).toHaveAttribute('data-lit', '');
      await expect.poll(async () => Math.abs((await centreY()) - target.y)).toBeLessThan(6);
    }
    // The log is cleared first: only a fade that starts on release counts.
    await page.evaluate(() => { (window as unknown as { __animations: string[] }).__animations.length = 0; });
    await page.mouse.up();
    await expect(bar(page)).not.toHaveAttribute('data-hold');
    // On release the pill fades back to its resting size by its own keyframes (top level: nested ones are ignored).
    await expect.poll(async () => (await started(page)).join()).toContain('sh-rail-fade-rest');
  });
});
