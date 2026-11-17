import { expect, test } from '@playwright/test';
import { isPhone, openPagesList, openWorkspace, seed, snap } from './workspace2-helpers';

/** The phone's Pages sheet (studio-ux2 lib3, L-tax): a four-part segment under the search that lists what the library's rail items list. Phone project only. */
test.skip(({ hasTouch }) => !hasTouch, 'The phone sheet is the phone project');
test.beforeEach(async ({ request }) => { await seed(request); });

for (const width of [390, 320]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('the segment has Tabs, Pages, Sheets and Modals, 44 px high with equal widths, and nothing is cut off', async ({ page }) => {
      expect(isPhone(page)).toBe(true);
      await openWorkspace(page);
      const pages = await openPagesList(page);
      const buttons = pages.locator('.w2-pages-scope button');
      await expect(buttons).toHaveText(['Tabs', 'Pages', 'Sheets', 'Modals']);
      const boxes = await buttons.evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { width: Math.round(box.width), height: Math.round(box.height), clipped: item.scrollWidth > item.clientWidth }; }));
      expect(boxes.every(box => box.height === 44 && !box.clipped)).toBe(true);
      expect(new Set(boxes.map(box => box.width)).size).toBe(1);
      expect(boxes[0].width).toBeGreaterThanOrEqual(71 - 1);
      // It opens on the list that holds the page on show, with that page marked.
      await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(pages.locator('.w2-page-row[aria-current=page]')).toHaveCount(1);
      await snap(page, `phone-pages-segment-${width}`);
    });

    test('a press on a part switches the list, and a row of the Sheets list shows that sheet', async ({ page }) => {
      await openWorkspace(page);
      const pages = await openPagesList(page);
      const titles = () => pages.locator('.w2-page-row .w2-page-title').allTextContents();
      expect(await titles()).toEqual(['Home', 'Security', 'Climate']);
      await pages.getByRole('button', { name: 'Pages', exact: true }).click();
      const loose = await titles();
      expect(loose.length).toBeGreaterThan(3);
      expect(loose).not.toContain('Home');
      await pages.getByRole('button', { name: 'Sheets', exact: true }).click();
      expect(await titles()).toContain('Weather');
      await expect(pages.getByRole('button', { name: 'Sheets', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await pages.getByRole('button', { name: 'Modals', exact: true }).click();
      await expect(pages.locator('.w2-empty')).toHaveText('No modals yet.');
      await pages.getByRole('button', { name: 'Sheets', exact: true }).click();
      await pages.locator('.w2-page-row').filter({ has: page.locator('.w2-page-title', { hasText: /^Weather$/ }) }).first().click();
      await expect(page.locator('[data-preview-root] .sh-sheet[data-sel="modal:hc-weather-sheet"]')).toBeVisible();
    });
  });
}
