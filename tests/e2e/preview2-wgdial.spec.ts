import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The gauge parts in the preview (lane `wg-s4`), on the invented `wgdial` story at the iPhone, Duo and iPad windows, on a dark ground (the page) and a light
 * one (the same body in a system sheet under a light color scheme). `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-wgdial');
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const pages = ['ticks', 'needle', 'arc', 'card'] as const;
const first = { ticks: 'wd-tick-0', needle: 'wd-needle-0', arc: 'wd-arc-0', card: 'wd-card' } as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], key: string, scheme: 'light' | 'dark', extra = '') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  const surface = scheme === 'dark' ? `page:page-wd-${key}` : `modal:modal-wd-${key}`;
  await page.goto(`/?preview2=1&panel=0&bezel=0&mode=use&fixture=wgdial&window=${encodeURIComponent(view.window)}&surface=${surface}${extra}`);
  await expect(page.getByTestId('preview2-host')).toBeVisible(patient);
  await expect(page.locator('[data-sel]').first()).toBeVisible(patient);
  await page.waitForTimeout(700);
}
const shot = async (page: Page, name: string) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
};

for (const view of views) for (const scheme of ['light', 'dark'] as const) for (const key of pages) {
  test(`${key} draws on ${scheme} at ${view.name}`, async ({ page }) => {
    await open(page, view, key, scheme);
    const suffix = scheme === 'light' ? '-l' : '';
    await expect(page.locator(`[data-sel="node:${first[key]}${suffix}"]`)).toBeVisible(patient);
    await shot(page, `${key}-${scheme}-${view.name}`);
  });
}

test('a lit tick moves round the sweep with its value, and a value past the end or none is held or hidden', async ({ page }) => {
  await open(page, views[0], 'ticks', 'dark');
  const lit = async (id: string) => {
    const dial = page.locator(`[data-sel="node:${id}"] .sh-dial`);
    const box = { width: await dial.evaluate(e => (e as HTMLElement).offsetWidth), height: await dial.evaluate(e => (e as HTMLElement).offsetHeight) };
    const line = page.locator(`[data-sel="node:${id}"] .sh-dial-lit`);
    const path = (await line.getAttribute('d'))!;
    const [x, y] = path.slice(1).split('L')[0].split(' ').map(Number);
    return { x: x / box.width, y: y / box.height };
  };
  const start = await lit('wd-tick-0'), half = await lit('wd-tick-50'), end = await lit('wd-tick-100');
  // The sweep runs from the lower left, over the top, to the lower right.
  expect(start.x).toBeLessThan(0.3);
  expect(end.x).toBeGreaterThan(0.7);
  expect(half.x).toBeGreaterThan(0.45);
  expect(half.x).toBeLessThan(0.55);
  expect(half.y).toBeLessThan(start.y);
  expect(await lit('wd-tick-held')).toEqual(end);
  await expect(page.locator('[data-sel="node:wd-tick-none"] .sh-dial-lit')).toHaveCount(0);
  await expect(page.locator('[data-sel="node:wd-tick-none"] .sh-dial-ticks')).toHaveCount(1);
});

test('a dial reads as one meter with its name and says nothing of the text in its middle', async ({ page }) => {
  await open(page, views[0], 'ticks', 'dark');
  const meter = page.locator('[data-sel="node:wd-tick-50"]').getByRole('meter', { name: 'Reading at 50 percent' });
  await expect(meter).toHaveAttribute('aria-valuenow', '50');
  await expect(meter.locator('.sh-dial-center')).toHaveAttribute('aria-hidden', 'true');
  await expect(meter.locator('.sh-dial-center')).toContainText('1013');
});

test('the needle turns to its heading, with four letters, and none with no heading', async ({ page }) => {
  await open(page, views[0], 'needle', 'dark');
  for (const [name, degrees] of [['0', 0], ['90', 90], ['200', 200], ['350', 350]] as const) {
    await expect(page.locator(`[data-sel="node:wd-needle-${name}"] .sh-dial-needle`)).toHaveAttribute('data-rotation', String(degrees));
    await expect(page.locator(`[data-sel="node:wd-needle-${name}"] .sh-dial-letter`)).toHaveText(['N', 'E', 'S', 'W']);
  }
  await expect(page.locator('[data-sel="node:wd-needle-read"] .sh-dial-needle')).toHaveAttribute('data-rotation', '245');
  await expect(page.locator('[data-sel="node:wd-needle-none"] .sh-dial-needle')).toHaveCount(0);
  await expect(page.locator('[data-sel="node:wd-needle-none"] .sh-dial-letter')).toHaveText(['N', 'S']);
});

test('the needle glides under the default motion setting and stands still under Reduce Motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, views[0], 'needle', 'dark');
  const duration = () => page.locator('[data-sel="node:wd-needle-90"] .sh-dial-needle').evaluate(element => getComputedStyle(element).transitionDuration);
  expect(await duration()).toBe('0.3s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toBe('0s');
});

test('the marker of an arc stands on its curve at its progress', async ({ page }) => {
  await open(page, views[0], 'arc', 'dark');
  for (const [name, t] of [['0', 0], ['25', 0.25], ['50', 0.5], ['75', 0.75], ['100', 1]] as const) {
    const svg = page.locator(`[data-sel="node:wd-arc-${name}"] svg`);
    const box = { width: Number(await svg.getAttribute('width')), height: Number(await svg.getAttribute('height')) };
    const marker = page.locator(`[data-sel="node:wd-arc-${name}"] .sh-arc-marker`);
    const [cx, cy] = [Number(await marker.getAttribute('cx')), Number(await marker.getAttribute('cy'))];
    const scale = box.width / 100;
    expect(cx).toBeCloseTo((8 + 84 * t) * scale, 1);
    expect(cy).toBeCloseTo((40 - 72 * t * (1 - t)) * scale, 1);
    expect(box.height).toBeCloseTo(48 * scale, 1);
  }
  await expect(page.locator('[data-sel="node:wd-arc-none"] .sh-arc-marker')).toHaveCount(0);
  await expect(page.locator('[data-sel="node:wd-arc-none"] .sh-arc-curve')).toHaveCount(1);
});

test('an arc is never wider than 200 points, even in the widest window', async ({ page }) => {
  await open(page, views[2], 'arc', 'dark');
  const box = (await page.locator('[data-sel="node:wd-arc-50"] svg').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(200.5);
});

test('in a right-to-left layout an arc runs from the right and a dial keeps its place', async ({ page }) => {
  await page.addInitScript(() => { const set = () => { if (document.documentElement) document.documentElement.dir = 'rtl'; }; set(); document.addEventListener('readystatechange', set); });
  const rtl = async () => {};
  await open(page, views[0], 'arc', 'dark');
  await rtl();
  const svg = page.locator('[data-sel="node:wd-arc-0"] svg');
  const box = { width: Number(await svg.getAttribute('width')) };
  const marker = page.locator('[data-sel="node:wd-arc-0"] .sh-arc-marker');
  expect(Number(await marker.getAttribute('cx')) / box.width).toBeGreaterThan(0.85);
  await open(page, views[0], 'ticks', 'dark');
  await rtl();
  const dial = page.locator('[data-sel="node:wd-tick-0"] .sh-dial');
  const path = (await page.locator('[data-sel="node:wd-tick-0"] .sh-dial-lit').getAttribute('d'))!;
  expect(Number(path.slice(1).split(' ')[0]) / await dial.evaluate(e => (e as HTMLElement).offsetWidth)).toBeLessThan(0.3);
});
