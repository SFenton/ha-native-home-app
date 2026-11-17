import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The repeat in the preview (lane `wg-s2`), on the invented `wgflow` story at the iPhone, Duo and iPad windows: a paged row of cells over a records flow, a column,
 * the placeholder while a flow has not answered, and a saved component that owns its flow, used twice. `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-wgflow');
const patient = { timeout: 20_000 };
const views = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof views[number], key: string, mode: 'use' | 'edit' = 'use') {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&mode=${mode}&fixture=wgflow&window=${encodeURIComponent(view.window)}&surface=page:page-wf-${key}`);
  await expect(page.getByTestId('preview2-host')).toBeVisible(patient);
  await expect(page.locator('.sh-repeat').first()).toBeVisible(patient);
  await page.waitForTimeout(500);
}
const shot = async (page: Page, name: string) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
};

for (const view of views) {
  test(`a row of cells over a records flow, paged, at ${view.name}`, async ({ page }) => {
    await open(page, view, 'row');
    await expect(page.locator('.sh-repeat-cell')).toHaveCount(12);
    await expect(page.locator('.sh-repeat-cell').first()).toContainText('Now');
    await expect(page.locator('.sh-repeat-cell').nth(1)).toContainText('7 PM');
    const regular = view.width >= 600;
    await expect(page.locator('.sh-repeat-page').first().locator('> *')).toHaveCount(regular ? 8 : 5);
    await expect(page.getByTestId('repeat-dots')).toHaveAttribute('aria-label', regular ? 'Page 1 of 2' : 'Page 1 of 3');
    if (regular) {
      await page.getByLabel('Next page').click();
      await expect(page.getByTestId('repeat-dots')).toHaveAttribute('aria-label', 'Page 2 of 2');
    } else await expect(page.getByLabel('Next page')).toHaveCount(0);
    await shot(page, `repeat-row-${view.name}`);
  });

  test(`a column of cells, at most four, at ${view.name}`, async ({ page }) => {
    await open(page, view, 'column');
    await expect(page.locator('.sh-repeat-cell')).toHaveCount(4);
    await expect(page.locator('.sh-repeat-paged')).toHaveCount(0);
    await shot(page, `repeat-column-${view.name}`);
  });

  test(`six placeholder cells while the flow has not answered, at ${view.name}`, async ({ page }) => {
    await open(page, view, 'loading');
    await expect(page.locator('.sh-repeat-cell')).toHaveCount(6);
    await expect(page.getByTestId('repeat-word')).toHaveText('Loading');
    await shot(page, `repeat-placeholder-${view.name}`);
  });

  test(`a template that owns its flow, used twice, at ${view.name}`, async ({ page }) => {
    await open(page, view, 'template');
    await expect(page.locator('.sh-repeat')).toHaveCount(2);
    await expect(page.locator('.sh-repeat-cell')).toHaveCount(24);
    await shot(page, `repeat-template-${view.name}`);
  });
}

test('Edit selects the first copy of a cell and leaves the others inert', async ({ page }) => {
  await open(page, views[0], 'column', 'edit');
  await expect(page.locator('[data-sel="node:wf-col-cell"]')).toHaveCount(1);
  // A click lands on the innermost node, the cell's label; only the first copy of it can be selected.
  await expect(page.locator('[data-sel="node:wf-col-cell-label"]')).toHaveCount(1);
  await page.locator('[data-sel="node:wf-col-cell-label"]').first().click();
  await expect(page.locator('[data-sel="node:wf-col-cell-label"][data-selected]')).toHaveCount(1);
  await expect(page.locator('.sh-repeat-cell[data-index="2"] [data-copy][inert]').first()).toBeAttached();
  await shot(page, 'repeat-edit-iphone');
});
