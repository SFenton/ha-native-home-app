import { expect, test, type Page } from '@playwright/test';
import { openLibrary, openWorkspace, previewRoot, seed, snap } from './workspace2-helpers';
import { documentWithTabs } from '../support/layout-fixture';

/** Tabs, shared areas and the tab bar (studio-ux2, L-layout): the simulator draws them and the inspector edits them. */
test.beforeEach(async ({ request }) => { await seed(request, documentWithTabs()); });

// The phone project runs the phone size; the desktop project runs the others.
const sizes = [[390, 844], [669, 951], [951, 669], [820, 1180], [1180, 820], [1440, 900]] as const;

for (const [width, height] of sizes) {
  test.describe(`at ${width} x ${height}`, () => {
    test.use({ viewport: { width, height } });
    test.skip(({ hasTouch }) => Boolean(hasTouch) !== (width === 390), 'Each project runs its own sizes');

    const tab = (page: Page, name: string) => previewRoot(page).getByRole('tab', { name });

    test('UX: a shared area is one node that stays put while the tab changes, and the bottom bar sits under the body', async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole('button', { name: 'Use', exact: true }).first().click();
      const shared = previewRoot(page).getByText('Shared across every tab');
      await expect(shared).toBeVisible();
      await shared.evaluate(element => { element.setAttribute('data-probe', 'kept'); });
      await expect(previewRoot(page).getByText('Only on Lights')).toBeVisible();
      await tab(page, 'Rooms').click();
      await expect(previewRoot(page).getByText('Only on Rooms')).toBeVisible();
      await expect(previewRoot(page).getByText('Only on Lights')).toHaveCount(0);
      await expect(previewRoot(page).getByText('Shared across every tab')).toHaveAttribute('data-probe', 'kept');
      await snap(page, `areas-use-${width}x${height}`);
      const bar = previewRoot(page).getByRole('tablist');
      await expect(bar).toHaveAttribute('data-placement', 'bottom');
      const barBox = (await bar.boundingBox())!, bodyBox = (await previewRoot(page).getByRole('tabpanel').boundingBox())!;
      expect(barBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height - 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('A11y: the bar is a tab list, the selected tab says so, and every control is a 44 point target in the bar', async ({ page }) => {
      await openWorkspace(page);
      await page.getByRole('button', { name: 'Use', exact: true }).first().click();
      const bar = previewRoot(page).getByRole('tablist');
      await expect(bar.getByRole('tab')).toHaveCount(3);
      await expect(tab(page, 'Lights')).toHaveAttribute('aria-selected', 'true');
      await tab(page, 'Info').press('Enter');
      await expect(tab(page, 'Info')).toHaveAttribute('aria-selected', 'true');
      // The simulator is drawn scaled; the layout height is in device points.
      for (const control of await bar.getByRole('tab').all()) expect(await control.evaluate(element => (element as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    });

    test('UX: the tree level of a tab container lists its areas and ends in Shared Area, Tab Area and Tabs Settings (the phone level sheet has the two buttons)', async ({ page }) => {
      const phone = width === 390;
      await openWorkspace(page);
      if (phone) await page.getByRole('button', { name: 'This Page', exact: true }).click(); else await openLibrary(page, 'Tabs');
      const list = phone ? page.getByTestId('level-list') : page.locator('.w2-pages');
      await expect(list).toBeVisible();
      if (!phone) await list.locator('[role=treeitem][aria-level="1"][aria-current=page]').first().click();
      await list.getByText('Area tabs', { exact: true }).first().click();
      const foot = phone ? page.locator('.w2-level-foot') : page.getByRole('contentinfo', { name: 'Add Area' }).or(page.locator('footer[aria-label="Add Area"]'));
      await expect(foot.getByRole('button', { name: /Shared Area/ })).toBeVisible();
      await expect(foot.getByRole('button', { name: /Tab Area/ })).toBeVisible();
      if (!phone) await expect(foot.getByRole('button', { name: 'Tabs Settings' })).toBeVisible();
      for (const button of await foot.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32);
      const before = await (phone ? list.getByRole('listitem') : list.locator('[role=treeitem]')).count();
      await foot.getByRole('button', { name: /Shared Area/ }).click();
      await expect.poll(async () => (phone ? list.getByRole('listitem') : list.locator('[role=treeitem]')).count()).toBe(before + 1);
      await snap(page, `areas-tree-${width}x${height}`);
    });

    test('UX: Remove Tab on a tab page says what went with it and Undo brings it back', async ({ page }) => {
      await openWorkspace(page);
      await previewRoot(page).getByRole('tablist').click({ position: { x: 1, y: 1 }, force: true });
      const panel = page.getByLabel('Properties');
      await expect(panel.getByRole('heading', { name: 'Area tabs', exact: true })).toBeVisible();
      await panel.getByRole('button', { name: /^Rooms/ }).first().click();
      await expect(panel.getByText(/of its own\./)).toBeVisible();
      await panel.getByRole('button', { name: 'Remove Tab' }).click();
      await expect(page.getByText(/^Removed Rooms/)).toBeVisible();
      await expect(previewRoot(page).getByRole('tab')).toHaveCount(2);
      await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
      await expect(previewRoot(page).getByRole('tab')).toHaveCount(3);
    });

    test('UX: the Tab Bar group of the container edits the bar in the simulator', async ({ page }) => {
      await openWorkspace(page);
      // The container is chosen by its bar's edge: a tab itself switches tabs.
      await previewRoot(page).getByRole('tablist').click({ position: { x: 1, y: 1 }, force: true });
      const panel = page.getByLabel('Properties');
      await expect(panel.getByRole('heading', { name: 'Area tabs', exact: true })).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Tab Bar' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Bottom', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await panel.getByRole('button', { name: 'Top', exact: true }).click();
      await expect(previewRoot(page).getByRole('tablist')).toHaveAttribute('data-placement', 'top');
      await panel.getByRole('button', { name: 'Add Shared Area' }).click();
      await expect(previewRoot(page).getByText('Empty area')).toBeVisible();
      await snap(page, `areas-inspector-${width}x${height}`);
    });
  });
}
