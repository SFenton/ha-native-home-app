import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The panels the simulator draws as the app does (lane `fidpanels`, `build/research/sim-fidelity-classify.md` items 5, 9, 12, 13 and 16): the alarm panel's chosen
 * mode without a selection ring, a thermostat hero with no card and no step buttons and with its range handles, a hub menu that shows its glyph and value and
 * keeps its label for VoiceOver, a door tile drawn as the state tile it lowers to, and settings rows that never paint under one another in a grid. It runs on the
 * invented `fidpanels` story at the iPhone, Duo and iPad windows, light and dark. `FIDPANELS_PHASE=before` only takes the screenshots (to compare an older build);
 * `STUDIO_EVIDENCE_DIR` says where they go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-fidpanels');
const phase = process.env.FIDPANELS_PHASE ?? 'after';
const checks = phase !== 'before';
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone', points: 402 },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright', points: 669 },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright', points: 834 },
] as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], scheme: 'light' | 'dark', surface: string, extra = '') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&fixture=fidpanels&window=${encodeURIComponent(view.window)}&surface=${surface}${extra}`);
  await expect(page.getByTestId('preview2-host')).toBeVisible(patient);
  await expect(page.locator('[data-sel]').first()).toBeVisible(patient);
  await expect(page.locator('.sh-placeholder')).toHaveCount(0, patient);
  await page.waitForTimeout(700);
}
const shot = async (page: Page, name: string) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${phase}-${name}.png`, animations: 'disabled' });
};
const rect = async (locator: Locator) => (await locator.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
/** The `::after` box of an element, as the browser computes it: `none` when nothing is drawn. */
const afterContent = (locator: Locator) => locator.evaluate(node => getComputedStyle(node, '::after').content);

for (const view of views) for (const scheme of ['light', 'dark'] as const) {
  const tag = `${scheme}-${view.name}`;

  test(`item 5 the chosen alarm mode has no selection ring (${tag})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-security', '&mode=use');
    await shot(page, `5-alarm-${tag}`);
    if (!checks) return;
    const chosen = page.locator('.sh-alarm-mode[data-chosen]');
    await expect(chosen).toHaveCount(1);
    await expect(chosen).toContainText('Home');
    expect(await afterContent(chosen)).toBe('none');
    await expect(page.locator('.sh-alarm-mode[data-selected]')).toHaveCount(0);
    // Its own look is a filled mode: the mode's colour, not the page's.
    expect(await chosen.evaluate(node => getComputedStyle(node).backgroundImage)).toContain('gradient');
  });

  test(`item 5 an alarm panel selected in Edit keeps its own ring and the chosen mode none (${tag})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-security', '&mode=edit&select=node:fid-alarm');
    await shot(page, `5-alarm-edit-${tag}`);
    if (!checks) return;
    await expect(page.locator('[data-selected]')).toHaveCount(1);
    expect(await afterContent(page.locator('[data-selected]'))).not.toBe('none');
    expect(await afterContent(page.locator('.sh-alarm-mode[data-chosen]'))).toBe('none');
  });

  test(`item 12 the thermostat hero has no card and no step buttons, and draws its range handles (${tag})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-thermostat', '&mode=use');
    await shot(page, `12-hero-${tag}`);
    if (!checks) return;
    const dials = page.locator('.sh-dv-dial');
    await expect(dials).toHaveCount(2);
    await expect(page.locator('.sh-dv-dial-steps, .sh-dv-round')).toHaveCount(0);
    for (const dial of await dials.all()) {
      const style = await dial.evaluate(node => { const css = getComputedStyle(node); return { image: css.backgroundImage, colour: css.backgroundColor }; });
      expect(style.image).toBe('none');
      expect(style.colour).toBe('rgba(0, 0, 0, 0)');
    }
    // The range hero has two handles (heat and cool), the single-target hero one; both mark the current temperature.
    await expect(dials.nth(0).locator('.sh-dv-handle')).toHaveCount(1);
    await expect(dials.nth(1).locator('.sh-dv-handle')).toHaveCount(2);
    await expect(dials.nth(1).locator('.sh-dv-handle[data-handle=low]')).toHaveCount(1);
    await expect(dials.nth(1).locator('.sh-dv-handle[data-handle=high]')).toHaveCount(1);
    await expect(dials.nth(0).locator('.sh-dv-marker')).toHaveCount(1);
  });

  test(`item 13 the hub menu shows its glyph and value, and its label is for VoiceOver (${tag})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-thermostat', '&mode=use');
    await page.locator('.sh-dv-hub').scrollIntoViewIfNeeded();
    await shot(page, `13-hub-${tag}`);
    if (!checks) return;
    const menus = page.locator('.sh-dv-hub .sh-dv-menu');
    await expect(menus).toHaveCount(2);
    for (const [at, label] of ['Mode', 'Fan'].entries()) {
      const menu = menus.nth(at);
      await expect(menu).toHaveAttribute('aria-label', label);
      await expect(menu.locator('small')).toHaveCount(0);
      await expect(menu.locator('svg').first()).toBeVisible();
      expect(((await menu.textContent()) ?? '').includes(label)).toBe(false);
      // The preview scales its window to fit the viewport: a menu is at least 44 window points tall (HIG: Pop-up buttons).
      const zoom = (await rect(page.locator('.sh-screen'))).width / view.points;
      expect((await rect(menu)).height / zoom).toBeGreaterThanOrEqual(43.5);
    }
    await expect(menus.nth(0)).toContainText('Heat');
    await expect(menus.nth(1)).toContainText('Auto');
  });

  test(`item 9 a door tile draws as the state tile it lowers to (${tag})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-security', '&mode=use');
    await shot(page, `9-door-${tag}`);
    if (!checks) return;
    const locked = page.locator('[data-sel="node:fid-door-front"] .sh-state-tile'), unlocked = page.locator('[data-sel="node:fid-door-back"] .sh-state-tile');
    await expect(locked).toBeVisible();
    await expect(locked).toContainText('Locked');
    // On a fill the title and the icon keep white ink, light sheet or dark.
    expect(await locked.locator('.sh-tile-title').evaluate(node => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)');
    await expect(unlocked).toContainText('Unlocked');
    await expect(unlocked).toHaveClass(/sh-lit|sh-filled|sh-class-active|sh-fill-ink/);
  });
}

for (const view of views) for (const scheme of ['light', 'dark'] as const) {
  test(`item 16 the Car rows never paint a name under a state (${scheme}-${view.name})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-car', '&mode=use');
    await shot(page, `16-car-${scheme}-${view.name}`);
    if (!checks) return;
    const rows = page.locator('[data-type=settings-control] .sh-row');
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) {
      const box = await rect(row), copy = row.locator('.sh-row-copy'), value = row.locator('.sh-row-value');
      expect(overlap(await rect(copy), await rect(value)), 'the name and the state share no pixels').toBe(false);
      // Nothing spills out of its row.
      expect(await row.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThan(100);
      // The name is whole: it never wraps inside a word, so the copy is at least as wide as its longest word.
      expect(await copy.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    }
  });
}

// MARK: Item 11: the Studio's Appearance setting lights the preview's `system` sheets

const LIGHT_GROUND = 'rgb(242, 242, 247)', DARK_GROUND = 'rgb(28, 28, 30)';
const ground = (page: Page) => page.locator('.sh-sheet').evaluate(node => getComputedStyle(node).backgroundColor);

/** Opens a sheet of the story with the Studio's Appearance setting stored as `studio`, under the browser's scheme `browser`. */
async function openWith(page: Page, view: typeof views[number], studio: 'light' | 'dark' | 'follow', browser: 'light' | 'dark', modal: string) {
  await page.addInitScript(value => localStorage.setItem('sh-studio.appearance', value), studio);
  await open(page, view, browser, `modal:${modal}`, '&mode=use');
}

for (const view of views) {
  for (const [studio, browser, system, dark] of [
    ['light', 'dark', LIGHT_GROUND, DARK_GROUND], ['dark', 'light', DARK_GROUND, DARK_GROUND],
    ['follow', 'light', LIGHT_GROUND, DARK_GROUND], ['follow', 'dark', DARK_GROUND, DARK_GROUND],
  ] as const) {
    test(`item 11 Studio ${studio} under a ${browser} browser: a system sheet is ${system === LIGHT_GROUND ? 'light' : 'dark'}, a dark sheet is dark (${view.name})`, async ({ page }) => {
      await openWith(page, view, studio, browser, 'modal-fid-security');
      await shot(page, `11-system-sheet-studio-${studio}-browser-${browser}-${view.name}`);
      if (checks) expect(await ground(page)).toBe(system);
      await openWith(page, view, studio, browser, 'modal-fid-dark');
      await shot(page, `11-dark-sheet-studio-${studio}-browser-${browser}-${view.name}`);
      if (checks) expect(await ground(page)).toBe(dark);
    });
  }
}
