import { expect, test, type Page } from '@playwright/test';
import { isPhone, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

test.beforeEach(async ({ request }) => { await seed(request); });
test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 700, 'These are the 390 px phone layout');

/** The top of the properties sheet, in CSS pixels. */
const sheetTop = (page: Page) => page.evaluate(() => Math.round(document.querySelector('.w2-props-sheet')!.getBoundingClientRect().top));

test('the page name has room at 390 px: Security is not cut to "Secu…", and the status tag gives way first', async ({ page }) => {
  expect(isPhone(page)).toBe(true);
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).first().click();
  await page.locator('.w2-pages').getByRole('button', { name: /^Security$/ }).first().click();
  const name = page.locator('.w2-page-button span');
  await expect(name).toHaveText('Security');
  const fits = await name.evaluate(span => ({ clipped: span.scrollWidth > span.clientWidth, drawn: span.clientWidth }));
  expect(fits.clipped).toBe(false);
  // Every control in the bar is still on screen.
  const bar = await page.evaluate(() => [...document.querySelectorAll('.w2-topbar button, .w2-topbar [data-testid=status-tag]')].map(element => { const box = element.getBoundingClientRect(); return { right: box.right, left: box.left }; }));
  for (const box of bar) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(390.5); }
  await snap(page, 'phone-top-bar-security');
});

test('the note a Use tap leaves clears the status bar and the Dynamic Island', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.locator('[data-preview-root] .sh-tab', { hasText: 'Security' }).click();
  await page.locator('[data-preview-root] .sh-page[data-current] .sh-node[data-type="action-tile"]').first().click();
  const note = page.getByTestId('checks-pill');
  await expect(note).toBeVisible();
  const [noteBox, stageBox] = await Promise.all([note.boundingBox(), page.locator('.w2-stage').boundingBox()]);
  // The iPhone window's safe area is 62 px tall (scaled to the 390 px stage).
  expect(noteBox!.y - stageBox!.y).toBeGreaterThanOrEqual(60);
  await snap(page, 'phone-use-note-below-island');
});

test('Undo keeps the properties sheet at the snap point it had', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Weather');
  await page.waitForTimeout(500);
  const half = await sheetTop(page);
  const title = panel.getByLabel('Title', { exact: true });
  await title.fill('Weather X');
  await title.blur();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(title).toHaveValue('Weather');
  await page.waitForTimeout(600);
  expect(await sheetTop(page)).toBe(half);
  expect(844 - half).toBeGreaterThan(300);
});
