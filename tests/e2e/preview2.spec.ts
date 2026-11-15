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
  await page.locator('.sh-rail').evaluate(rail => { rail.scrollLeft = 0; });
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

test('Use keeps the wheel inside the device and pans with the mouse', async ({ page }) => {
  await page.goto(story('mode=use&surface=page:page-security'));
  const scroller = page.locator('.sh-page[data-current] .sh-scroll');
  await expect(scroller).toBeVisible();
  const box = (await scroller.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const before = await scroller.evaluate(element => element.scrollTop);
  await page.mouse.move(x, y + 120);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(x, y + 120 - step * 10);
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
});

test.describe('iPhone size, no bezel', () => {
  test.use({ viewport: { width: 402, height: 874 } });
  for (const [name, surface] of [['home', 'page:page-home'], ['security', 'page:page-security'], ['climate', 'page:page-climate']]) {
    test(`draws ${name} at 402 by 874`, async ({ page }) => {
      await page.goto(story(`surface=${surface}&bezel=0&panel=0`));
      await expect(page.locator('.sh-page[data-current] .sh-large-title')).toHaveText(name[0].toUpperCase() + name.slice(1));
      const frame = (await host(page).boundingBox())!;
      expect(Math.round(frame.width)).toBe(402);
      await shot(page, `iphone-${name}`);
    });
  }
});
