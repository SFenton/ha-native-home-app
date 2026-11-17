import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The data parts in the preview (lane `wg-s3`), on the invented `wgchart` story at the iPhone, Duo and iPad windows, on a dark ground (the page) and a light
 * one (the same body in a system sheet under a light color scheme). `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-wgchart');
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const pages = ['bars', 'lines', 'gauge', 'card'] as const;
const first = { bars: 'wc-bars', lines: 'wc-line', gauge: 'wc-scale', card: 'wc-card' } as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], key: string, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  const surface = scheme === 'dark' ? `page:page-wc-${key}` : `modal:modal-wc-${key}`;
  await page.goto(`/?preview2=1&panel=0&bezel=0&mode=use&fixture=wgchart&window=${encodeURIComponent(view.window)}&surface=${surface}`);
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

test('a bar chart draws a bar for each point, thins its labels, and speaks its series', async ({ page }) => {
  await open(page, views[0], 'bars', 'dark');
  const bars = page.locator('[data-sel="node:wc-bars"]');
  await expect(bars.locator('.sh-chart-bar')).toHaveCount(6);
  await expect(bars.locator('.sh-chart-ylabel')).toHaveText(['100%', '50%', '0%']);
  await expect(bars.locator('.sh-chart-series')).toHaveText('Now 94%, 1 AM 40%, 2 AM 20%, 3 AM 10%, 4 AM 0%, 5 AM 5%');
  const day = page.locator('[data-sel="node:wc-bars24"]');
  await expect(day.locator('.sh-chart-bar')).toHaveCount(24);
  const shown = await day.locator('.sh-chart-xlabel[data-shown]').count();
  expect(shown).toBeGreaterThan(1);
  expect(shown).toBeLessThan(24);
});

test('a wider window shows more of the labels under the same chart', async ({ page }) => {
  const count = async (view: typeof views[number]) => { await open(page, view, 'bars', 'dark'); return page.locator('[data-sel="node:wc-bars24"] .sh-chart-xlabel[data-shown]').count(); };
  const narrow = await count(views[0]);
  const wide = await count(views[2]);
  expect(wide).toBeGreaterThan(narrow);
});

test('a line breaks at an unknown value and an unknown bar is a stub', async ({ page }) => {
  await open(page, views[0], 'lines', 'dark');
  await expect(page.locator('[data-sel="node:wc-area"] .sh-chart-line')).toHaveCount(2);
  await expect(page.locator('[data-sel="node:wc-area"] .sh-chart-dot')).toHaveCount(7);
  await expect(page.locator('[data-sel="node:wc-empty"] .sh-chart-empty-text')).toHaveText('Unavailable');
});

test('a gauge puts its marker where the value says and hides it with no value', async ({ page }) => {
  await open(page, views[0], 'gauge', 'dark');
  const scale = page.locator('[data-sel="node:wc-scale"]');
  const track = await scale.locator('.sh-gauge').boundingBox();
  const marker = await scale.locator('.sh-gauge-marker').boundingBox();
  const centre = (marker!.x + marker!.width / 2 - track!.x) / track!.width;
  expect(centre).toBeGreaterThan(0.70);
  expect(centre).toBeLessThan(0.74);
  await expect(page.locator('[data-sel="node:wc-nomarker"] .sh-gauge-marker')).toHaveCount(0);
  await expect(scale.getByRole('meter', { name: 'Level' })).toHaveAttribute('aria-valuetext', '72, moderate');
});
