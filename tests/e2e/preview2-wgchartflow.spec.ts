import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The data parts over a records flow in the preview (lane `integ10`), on the invented `wgchartflow` story at the iPhone, Duo and iPad windows on a dark
 * ground: a chart fed by the records of a flow, a gauge in each cell of a repeat, and a chart that reads the list of its repeat.
 * `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-wgchartflow');
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const pages = { chart: 'wx-bars', gauge: 'wx-cells', inside: 'wx-list' } as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], key: keyof typeof pages) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&mode=use&fixture=wgchartflow&window=${encodeURIComponent(view.window)}&surface=page:page-wx-${key}`);
  await expect(page.getByTestId('preview2-host')).toBeVisible(patient);
  await expect(page.locator(`[data-sel="node:${pages[key]}"]`)).toBeVisible(patient);
  await page.waitForTimeout(700);
}
const shot = async (page: Page, name: string) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
};

for (const view of views) for (const key of Object.keys(pages) as (keyof typeof pages)[]) {
  test(`${key} draws on dark at ${view.name}`, async ({ page }) => {
    await open(page, view, key);
    await shot(page, `${key}-dark-${view.name}`);
  });
}

test('a chart over a records flow draws a bar for each record and speaks its series', async ({ page }) => {
  await open(page, views[0], 'chart');
  const bars = page.locator('[data-sel="node:wx-bars"]');
  await expect(bars.locator('.sh-chart-bar')).toHaveCount(12);
  await expect(bars.locator('.sh-chart-series')).toContainText('Now 70°');
  await expect(page.locator('[data-sel="node:wx-area"] .sh-chart-dot')).toHaveCount(12);
  await expect(page.locator('[data-sel="node:wx-slow"] .sh-chart-empty-text')).toHaveText('Unavailable');
});

test('a gauge in each cell of a repeat puts its marker by its own record', async ({ page }) => {
  await open(page, views[0], 'gauge');
  const cells = page.locator('.sh-repeat-cell');
  await expect(cells).toHaveCount(4);
  const centres: number[] = [];
  for (let at = 0; at < 4; at++) {
    const track = await cells.nth(at).locator('.sh-gauge').boundingBox();
    const marker = await cells.nth(at).locator('.sh-gauge-marker').boundingBox();
    centres.push((marker!.x + marker!.width / 2 - track!.x) / track!.width);
  }
  expect(centres[0]).toBeGreaterThan(centres[3]);
  expect(new Set(centres.map(value => value.toFixed(3))).size).toBe(4);
});

test('a chart inside a repeat reads the list of the repeat', async ({ page }) => {
  await open(page, views[0], 'inside');
  const charts = page.locator('.sh-repeat-cell .sh-chart');
  await expect(charts).toHaveCount(3);
  await expect(charts.first().locator('.sh-chart-bar')).toHaveCount(3);
});
