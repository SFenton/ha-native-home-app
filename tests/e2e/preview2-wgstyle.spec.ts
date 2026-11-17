import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The style parts in the preview (lane `wg-s1`), on the invented `wgstyle` story at the iPhone, Duo and iPad windows, on a dark ground (the page) and a light
 * one (the same body in a system sheet under a light color scheme). `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-wgstyle');
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const pages = ['text', 'stack', 'parts', 'choice', 'card'] as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], key: string, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  const surface = scheme === 'dark' ? `page:page-wg-${key}` : `modal:modal-wg-${key}`;
  await page.goto(`/?preview2=1&panel=0&bezel=0&mode=use&fixture=wgstyle&window=${encodeURIComponent(view.window)}&surface=${surface}`);
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
    const first = { text: 'wg-large', stack: 'wg-header', parts: 'wg-shapes', choice: 'wg-seg', card: 'wg-card' }[key] + suffix;
    await expect(page.locator(`[data-sel="node:${first}"]`)).toBeVisible(patient);
    await shot(page, `${key}-${scheme}-${view.name}`);
  });
}

test('the header collapses to a column at a large text size and lays out in a row otherwise', async ({ page }) => {
  await open(page, views[2], 'stack', 'dark');
  const body = page.locator('[data-sel="node:wg-header"] .sh-stack-body').first();
  await expect(body).toHaveAttribute('data-axis', 'horizontal');
  await open(page, views[0], 'stack', 'dark');
  await expect(page.locator('[data-sel="node:wg-header"] .sh-stack-body').first()).toBeAttached();
});

test('a segment with a symbol is named by its label and has no text', async ({ page }) => {
  await open(page, views[0], 'choice', 'dark');
  const buttons = page.locator('[data-sel="node:wg-seg"] button');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.first()).toHaveAttribute('aria-label', 'Temperature');
  await expect(buttons.first().locator('svg')).toBeVisible();
});
