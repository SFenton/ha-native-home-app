import { expect, test, type Page } from '@playwright/test';
import { openLibrary, openWorkspace, seed, snap } from './workspace2-helpers';

/** Row icons are the Studio's own (studio-ux2 lib3, L-icons): chosen in a row's More menu, kept beside the draft, never in the document. */
test.beforeEach(async ({ request }, testInfo) => {
  testInfo.skip(testInfo.project.name === 'phone', 'The library is the wide layout; a phone has sheets');
  await seed(request);
  await request.put('/native/api/studio-notes', { data: { listIcons: {} } });
});

const viewports = [{ name: 'desktop 1440', width: 1440, height: 900 }, { name: 'iPad upright 820', width: 820, height: 1180 }, { name: 'Duo upright 669', width: 669, height: 951 }] as const;
const tree = (page: Page) => page.getByTestId('library-tree');
const rowOf = (page: Page, name: string) => tree(page).locator('[role=treeitem]').filter({ has: page.locator('.w2-tree-title', { hasText: new RegExp(`^${name}$`) }) }).first();

for (const view of viewports) {
  test.describe(view.name, () => {
    test.use({ viewport: { width: view.width, height: view.height } });

    test('a chosen icon survives a reload, the popover stays inside the window, and the document is byte-identical', async ({ page, request }) => {
      const before = await (await request.get('/native/api/export?source=draft')).text();
      const revision = (await (await request.get('/native/api/draft')).json()).revision;
      await openWorkspace(page);
      await openLibrary(page, 'Tabs');
      await rowOf(page, 'Security').getByRole('button', { name: 'More for Security' }).click();
      await page.getByRole('menuitem', { name: 'Change List Icon…' }).click();
      const popover = page.getByTestId('list-icon-popover');
      await expect(popover).toBeVisible();
      const box = (await popover.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(view.width); expect(box.y + box.height).toBeLessThanOrEqual(view.height);
      expect(box.width).toBe(260);
      await snap(page, `licons-popover-${view.width}`);
      const cell = popover.locator('[data-symbol]').nth(3);
      const symbol = await cell.getAttribute('data-symbol');
      await cell.click();
      await expect(popover).toHaveCount(0);
      await expect(rowOf(page, 'Security').locator('.w2-tree-icon[data-chosen]')).toHaveCount(1);
      await expect.poll(async () => (await (await request.get('/native/api/studio-notes')).json()).listIcons).toMatchObject({ [`tab:${(await (await request.get('/native/api/draft')).json()).document.navigation.tabs.find((tab: { label: string }) => tab.label === 'Security').id}`]: symbol });
      // Not a draft edit: no new revision, and Publish and Export see the same bytes.
      expect((await (await request.get('/native/api/draft')).json()).revision).toBe(revision);
      expect(await (await request.get('/native/api/export?source=draft')).text()).toBe(before);
      await page.reload();
      await openLibrary(page, 'Tabs');
      await expect(rowOf(page, 'Security').locator('.w2-tree-icon[data-chosen]')).toHaveCount(1);
      await snap(page, `licons-row-${view.width}`);
    });

    test('Use Default takes the icon back', async ({ page }) => {
      await openWorkspace(page);
      await openLibrary(page, 'Tabs');
      const more = () => rowOf(page, 'Climate').getByRole('button', { name: 'More for Climate' }).click();
      await more();
      await page.getByRole('menuitem', { name: 'Change List Icon…' }).click();
      await page.getByTestId('list-icon-popover').locator('[data-symbol]').nth(1).click();
      await expect(rowOf(page, 'Climate').locator('.w2-tree-icon[data-chosen]')).toHaveCount(1);
      await more();
      await page.getByRole('menuitem', { name: 'Change List Icon…' }).click();
      await page.getByTestId('list-icon-popover').getByRole('button', { name: 'Use Default' }).click();
      await expect(rowOf(page, 'Climate').locator('.w2-tree-icon[data-chosen]')).toHaveCount(0);
    });
  });
}
