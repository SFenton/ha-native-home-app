import { expect, test, type Page } from '@playwright/test';
import { openLibrary, openWorkspace, previewTile, railButton, seed, selectTile } from './workspace2-helpers';

/** The wide layout (studio-ux2, L-wide): the library rail and panel, the inspector column and the device between them. */
test.skip(({ viewport }) => (viewport?.width ?? 1440) < 700, 'The tiers are checked at the sizes below, set by each test; the phone project runs the phone layout elsewhere');
test.beforeEach(async ({ request }) => { await seed(request); });

type Box = { left: number; right: number; top: number; bottom: number };
const sizes = [[1440, 900], [1180, 820], [951, 669], [820, 1180], [669, 951], [600, 900]] as const;

/** The boxes of the canvas, the device, the simulator's rail slot (it glides on a 0.2 s transition), the library rail and panel and the inspector, in px; a missing one is undefined. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const read = (selector: string, open = false) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || (open && !element.hasAttribute('data-open'))) return undefined;
      const box = element.getBoundingClientRect();
      return box.width > 0 ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : undefined;
    };
    return { canvas: read('.w2-canvas'), device: read('.device-model'), slot: read('.w2-rail-slot'), rail: read('.w2-lib-rail'), panel: read('.w2-lib-panel', true), inspector: read('.w2-inspector', true) };
  });
}
const apart = (a: Box, b: Box) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;

/** Waits until the device and its rail slot hold still: the panel slid, the preview re-fitted once and both glides ended. */
async function settled(page: Page) {
  let last = '';
  await expect.poll(async () => {
    const now = JSON.stringify(await boxes(page));
    const same = now === last; last = now;
    return same;
  }, { intervals: [250, 250, 250], timeout: 8000 }).toBe(true);
}

/** Puts the library in a known state: closed, or open on Tabs (the rail's first item, the one it opens on). */
async function library(page: Page, open: boolean) {
  const pressed = (await railButton(page, 'Tabs').getAttribute('aria-pressed')) === 'true';
  if (open) await openLibrary(page, 'Tabs'); else if (pressed) await railButton(page, 'Tabs').click();
  await settled(page);
}

for (const [width, height] of sizes) {
  test.describe(`at ${width} x ${height}`, () => {
    test.use({ viewport: { width, height } });
    const flyout = width < 871, exclusive = width < 1100;

    for (const state of ['idle', 'panel', 'inspector', 'both'] as const) {
      test(`${state}: the device is inside the canvas and clear of the panel and the inspector`, async ({ page }) => {
        test.skip(state === 'both' && exclusive, 'The panel and the inspector are exclusive here');
        await openWorkspace(page);
        await library(page, false);
        if (state === 'inspector' || state === 'both') await selectTile(page, 'Lights');
        if (state === 'panel' || state === 'both') await library(page, true);
        await settled(page);
        const { canvas, device, panel, inspector } = await boxes(page);
        expect(canvas && device).toBeTruthy();
        expect(device!.left, 'inside the canvas, left').toBeGreaterThanOrEqual(canvas!.left - 0.5);
        expect(device!.right, 'inside the canvas, right').toBeLessThanOrEqual(canvas!.right + 0.5);
        expect(device!.top).toBeGreaterThanOrEqual(canvas!.top - 0.5);
        if (state === 'panel' || state === 'both') { expect(panel, 'the panel is open').toBeTruthy(); expect(apart(device!, panel!)).toBe(true); } else expect(panel).toBeUndefined();
        if (state === 'inspector' || state === 'both') { expect(inspector, 'the inspector is open').toBeTruthy(); expect(apart(device!, inspector!)).toBe(true); } else expect(inspector).toBeUndefined();
      });
    }

    if (flyout) {
      test('the flyout is 300 px from the leading edge, covers the rail, and the canvas starts at its trailing edge', async ({ page }) => {
        await openWorkspace(page);
        await library(page, true);
        const { canvas, panel, rail } = await boxes(page);
        expect(panel!.left).toBe(0);
        expect(panel!.right - panel!.left).toBe(300);
        expect(panel!.left).toBeLessThanOrEqual(rail!.left);
        expect(panel!.right).toBeGreaterThanOrEqual(rail!.right);
        expect(Math.abs(canvas!.left - panel!.right)).toBeLessThan(0.5);
      });

      test('a tile in the simulator takes a click while the flyout is open; the selection opens the inspector and closes the flyout', async ({ page }) => {
        await openWorkspace(page);
        await library(page, true);
        await previewTile(page, 'Lights').click();
        await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
        await expect(railButton(page, 'Pages')).toHaveAttribute('aria-pressed', 'false');
        await settled(page);
        expect((await boxes(page)).panel).toBeUndefined();
      });
    } else {
      test('a tile in the simulator takes a click while the panel is open', async ({ page }) => {
        await openWorkspace(page);
        await library(page, true);
        await previewTile(page, 'Lights').click();
        await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
      });
    }

    test('opening the panel changes the device zoom at most once, and exactly once where the canvas width decides it', async ({ page }) => {
      await openWorkspace(page);
      await library(page, false);
      await page.evaluate(() => {
        const model = document.querySelector<HTMLElement>('.device-model')!;
        const seen: string[] = [model.style.transform];
        new MutationObserver(() => { if (seen.at(-1) !== model.style.transform) seen.push(model.style.transform); }).observe(model, { attributes: true, attributeFilter: ['style'] });
        (window as unknown as { __zoom: string[] }).__zoom = seen;
      });
      await railButton(page, 'Pages').click();
      await settled(page);
      const seen = await page.evaluate(() => (window as unknown as { __zoom: string[] }).__zoom);
      expect(seen.length - 1, `zoom values ${seen.join(' | ')}`).toBeLessThanOrEqual(1);
      if (width <= 820) expect(seen.length - 1).toBe(1); // 951 x 669 and 1180 x 820 fit by height, so the canvas width does not change the zoom
    });

    test('the simulator rail stays inside the canvas, beside the device, or under it on a canvas under 420 px', async ({ page }) => {
      await openWorkspace(page);
      await library(page, flyout);
      const data = await page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>('.w2-rail-slot .w2-rail')!.getBoundingClientRect(), device = document.querySelector('.device-model')!.getBoundingClientRect(), canvas = document.querySelector('.w2-canvas')!.getBoundingClientRect();
        return { rail: { left: rail.left, right: rail.right, top: rail.top, bottom: rail.bottom }, device: { left: device.left, right: device.right, top: device.top, bottom: device.bottom }, canvas: { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom },
          orientation: document.querySelector('.w2-rail-slot .w2-rail')!.getAttribute('data-orientation') };
      });
      expect(data.rail.left).toBeGreaterThanOrEqual(data.canvas.left - 0.5);
      expect(data.rail.right).toBeLessThanOrEqual(data.canvas.right + 0.5);
      expect(data.rail.bottom).toBeLessThanOrEqual(data.canvas.bottom + 0.5);
      const under = data.canvas.right - data.canvas.left < 420;
      expect(data.orientation).toBe(under ? 'horizontal' : 'vertical');
      if (under) { expect(data.rail.top).toBeGreaterThanOrEqual(data.device.bottom); expect(data.rail.top - data.device.bottom).toBeLessThan(40); } else expect(data.rail.left).toBeGreaterThanOrEqual(data.device.right);
    });

    test('no rail label is clipped and each rail button is 58 px wide', async ({ page }) => {
      await openWorkspace(page);
      const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.w2-lib-label')].filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent));
      expect(clipped).toEqual([]);
      const widths = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.w2-lib-rail-button')].map(button => Math.round(button.getBoundingClientRect().width)));
      expect(widths).toEqual([58, 58, 58, 58, 58, 58, 58]);
    });
  });
}

test.describe('the continuous surface', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('the rail and the panel have one background, no border and no gap between them', async ({ page }) => {
    await openWorkspace(page);
    await library(page, true);
    const facts = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.w2-lib-rail')!, panel = document.querySelector<HTMLElement>('.w2-lib-panel')!;
      return { railBg: getComputedStyle(rail).backgroundColor, panelBg: getComputedStyle(panel).backgroundColor, railBorder: getComputedStyle(rail).borderInlineEndWidth,
        panelBorder: getComputedStyle(panel).borderInlineStartWidth, railRight: rail.getBoundingClientRect().right, panelLeft: panel.getBoundingClientRect().left };
    });
    expect(facts.panelBg).toBe(facts.railBg);
    expect(facts.railBorder).toBe('0px');
    expect(facts.panelBorder).toBe('0px');
    expect(facts.panelLeft).toBe(facts.railRight);
  });
});

for (const [width, height] of [[1440, 900], [820, 1180]] as const) {
  test.describe(`motion at ${width} x ${height}`, () => {
    test.use({ viewport: { width, height } });
    test('the panel slides on transform with the sheet curve, and the device glides on transform', async ({ page }) => {
      await openWorkspace(page);
      await library(page, false);
      await page.evaluate(() => {
        let most = 0;
        const watch = () => { most = Math.max(most, document.querySelector('.device-stage')?.getAnimations().length ?? 0); (window as unknown as { __glide: number }).__glide = most; requestAnimationFrame(watch); };
        watch();
      });
      await railButton(page, 'Pages').click();
      await expect(page.locator('.w2-lib-panel')).toBeVisible();
      await settled(page);
      // Where the device moves it glides on transform (a Web Animation), never by animating its width.
      if (width < 871) expect(await page.evaluate(() => (window as unknown as { __glide: number }).__glide)).toBeGreaterThan(0);
      const css = await page.evaluate(() => { const panel = getComputedStyle(document.querySelector('.w2-lib-panel')!); return { property: panel.transitionProperty, duration: panel.transitionDuration, easing: panel.transitionTimingFunction }; });
      expect(css.property).toContain('transform');
      expect(css.duration).toBe(width < 871 ? '0.25s' : '0.2s');
      expect(css.easing).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    });

    test('with Reduce Motion no transform transition runs on the panel, the inspector or the device, and the fade is 120 ms', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openWorkspace(page);
      await library(page, false);
      await page.evaluate(() => {
        let most = 0;
        const watch = () => { most = Math.max(most, ...[...document.querySelectorAll('.w2-lib-panel, .w2-inspector, .device-stage')].flatMap(element => element.getAnimations().map(animation => ((animation as CSSTransition).transitionProperty ?? 'animation') === 'transform' || (animation as CSSAnimation).animationName ? 1 : 0)), 0); (window as unknown as { __transform: number }).__transform = most; requestAnimationFrame(watch); };
        watch();
      });
      await railButton(page, 'Pages').click();
      await expect(page.locator('.w2-lib-panel')).toBeVisible();
      await selectTile(page, 'Lights');
      await settled(page);
      const result = await page.evaluate(() => {
        const read = (selector: string) => { const element = document.querySelector(selector); if (!element) return undefined; const style = getComputedStyle(element); return { property: style.transitionProperty, duration: style.transitionDuration, transform: style.transform }; };
        return { panel: read('.w2-lib-panel'), inspector: read('.w2-inspector'), transform: (window as unknown as { __transform: number }).__transform };
      });
      expect(result.transform).toBe(0);
      expect(result.inspector).toMatchObject({ property: 'opacity', duration: '0.12s' });
      if (result.panel) expect(result.panel).toMatchObject({ property: 'opacity', duration: '0.12s' });
    });
  });
}

/** Accessibility per tier: names, roles and a 44 px target under a coarse pointer for every rail button, tab and row (a disclosure triangle is 32 wide, spec lib3). */
for (const [width, height] of [[1440, 900], [820, 1180], [669, 951]] as const) {
  test.describe(`accessibility at ${width} x ${height} with touch`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });
    test('the rail is a vertical toolbar of named buttons, and every button, tab and row is 44 px under a coarse pointer', async ({ page }) => {
      await openWorkspace(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const rail = page.getByRole('toolbar', { name: 'Library' });
      await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
      await expect(rail.getByRole('button')).toHaveText(['Tabs', 'Pages', 'Sheets', 'Modals', 'Components', 'Controls', 'Data']);
      await library(page, true);
      const panel = page.getByRole('complementary', { name: 'Tabs' });
      await expect(panel).toBeVisible();
      if (width < 871) await expect(panel.getByRole('button', { name: 'Library: Tabs' })).toHaveAttribute('aria-haspopup', 'menu');
      const small = async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.w2-lib button, .w2-lib [role=tab], .w2-lib [role=treeitem], .w2-lib .w2-search input')]
        .filter(element => !element.closest('[inert]') && element.getBoundingClientRect().width > 0)
        .map(element => ({ name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 24) ?? '', height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, disclosure: element.classList.contains('w2-tree-disclosure') }))
        .filter(item => item.height < 43.5 || item.width < (item.disclosure ? 31.5 : 43.5)).map(item => `${item.name} ${Math.round(item.width)}x${Math.round(item.height)}`));
      expect(await small(), 'Tabs').toEqual([]);
      for (const category of ['Pages', 'Sheets', 'Modals', 'Components', 'Controls', 'Data']) {
        if (width < 871) { await page.getByTestId('library-panel').getByRole('button', { name: /^Library:/ }).click(); await page.getByRole('menuitem', { name: category }).click(); } else await railButton(page, category).click();
        await expect(page.getByRole('complementary', { name: category })).toBeVisible();
        expect(await small(), category).toEqual([]);
      }
    });
  });
}
