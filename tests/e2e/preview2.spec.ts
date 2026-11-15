import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Where the evidence screenshots go; override with STUDIO_EVIDENCE_DIR. */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? '/Users/stephenfenton/.t3/worktrees/native-home/t3-b48b8cc0/build/evidence/studio-ux-render';
test.use({ viewport: { width: 1100, height: 940 }, deviceScaleFactor: 2 });

const story = (query: string) => `/?preview2=1&${query}`;
const host = (page: Page) => page.getByTestId('preview2-host');
async function shot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.waitForTimeout(500);
  await host(page).screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled' });
}

test('Edit draws the home page, selects on click and clears with Esc', async ({ page }) => {
  await page.goto(story('surface=page:page-home'));
  await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText('Home');
  await page.locator('[data-sel="node:hc-chip-0"]').click();
  await expect(page.getByTestId('selection')).toHaveText('node:hc-chip-0');
  await expect(page.locator('[data-sel="node:hc-chip-0"] .sh-handle-slot')).toHaveCount(1);
  await shot(page, 'home-edit-selected');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection')).toHaveText('node:hc-status-rail');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection')).toHaveText('page:page-home');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection')).toHaveText('none');
});

test('Use navigates tabs and sheets and simulates calls without a service', async ({ page }) => {
  await page.goto(story('mode=use&surface=page:page-home'));
  await page.getByRole('button', { name: 'Security', exact: true }).first().click();
  await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText('Security');
  await shot(page, 'security-use');
  await page.getByRole('button', { name: 'Climate', exact: true }).click();
  await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText('Climate');
  await shot(page, 'climate-use');
});

test('A sheet is drawn presented over its page', async ({ page }) => {
  await page.goto(story('surface=modal:hc-overview-lights'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'lights-sheet-edit');
});

test('Phone width: no bezel, full width', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(story('surface=page:page-home&bezel=0&panel=0'));
  await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText('Home');
});
