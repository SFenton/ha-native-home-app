import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { isPhone, openPagesList, openWorkspace, seed } from './workspace2-helpers';

/**
 * The editor half of global chrome (`gc-studio-edit`): the app panel "Tabs and header buttons", "Hide on this page", "In a wide window", the link results, the library tag and
 * the checks. Documents are the made-up `home-domains` project with a header the test adds (`demo_` ids). Screenshots, light and dark, go to `STUDIO_EVIDENCE_DIR` when it is set.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR;
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')).document;
test.use({ actionTimeout: 10_000 });

const symbol = { type: 'sf-symbol', name: 'bell', rendering: 'canonical', unavailable: 'fallback' };
const present = (modalId: string) => ({ type: 'present', modalId, arguments: {}, ifPresented: 'reject' });

/** The project with a header of Alerts (first page only) and Quick Links and Profile, Security hiding two things, and Home a level inside its Lights sheet. */
function project() {
  const document = structuredClone(fixture);
  document.navigation.chrome.groups = [
    { id: 'demo_lead', placement: 'leading', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [
      ...document.navigation.chrome.groups[0].items,
      { id: 'demo_alerts', type: 'button', label: 'Alerts', menuLabel: 'Alerts', icon: symbol, visibility: 'root-only', priority: 'normal', rail: 'eligible', badge: { type: 'none' }, action: present('hc-overview-lights') },
      { id: 'demo_more', type: 'button', label: 'Lamps', menuLabel: 'Lamps', icon: symbol, visibility: 'always', priority: 'normal', rail: 'eligible', badge: { type: 'none' }, action: present('hc-overview-lights') },
    ] },
    { id: 'demo_trail', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [
      { id: 'demo_quick', type: 'shell-header', visibility: 'always', quickLinksAction: present('hc-overview-lights'), profileAction: present('hc-overview-lights') },
    ] },
  ];
  const security = document.pages.find((item: { id: string }) => item.id === 'page-security');
  security.hides = { tabs: true, items: ['demo_quick'] };
  // A page that is no tab's first page, with the app's header: the one where a First page only row is disabled, and where Custom drops hidden items.
  const detail = document.pages.find((item: { id: string }) => item.id === 'page-security-system');
  detail.toolbar = { type: 'inherit' };
  detail.hides = { tabs: true, items: ['demo_more'] };
  const climate = document.pages.find((item: { id: string }) => item.id === 'page-climate');
  climate.wideOpen = 'beside';
  document.pages.find((item: { id: string }) => item.id === 'page-home').navigation = { type: 'navigation-columns', placeholder: 'Select an item', standalone: false };
  // A level of the Lights sheet: a copy of the second room's page (ids suffixed), reached by that room's tile.
  const room = document.pages.find((item: { id: string }) => item.id === 'hc-lights-demo-room-2-detail');
  const { navigation: _navigation, ...surface } = JSON.parse(JSON.stringify(room).replace(/"id":"([^"]+)"/g, '"id":"$1_lv"'));
  document.levels = [{ ...surface, id: 'demo_level', title: 'Demo Room 2 Level' }];
  const sheet = document.modals.find((item: { id: string }) => item.id === 'hc-overview-lights');
  const tiles: { id: string; action?: { pageId?: string } }[] = [];
  const find = (node: { id: string; action?: { pageId?: string }; components?: unknown[]; children?: unknown[] }) => { if (node.action) tiles.push(node); (node.components ?? node.children ?? []).forEach(child => find(child as typeof node)); };
  sheet.components.forEach(find);
  tiles[1].action!.pageId = 'demo_level';
  return document;
}

test.beforeEach(async ({ request }) => { await seed(request, project()); });

/** A screenshot in each scheme, `<name>-light.png` and `<name>-dark.png`. */
async function shoot(page: Page, name: string) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${evidence}/${name}-${scheme}.png`, animations: 'disabled' });
  }
}

async function openPageSettings(page: Page, title: string) {
  const pages = await openPagesList(page, title);
  await pages.getByRole('button', { name: `More for ${title}` }).first().click();
  await page.getByRole('menuitem', { name: 'Page Settings' }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}

test.describe('desktop panels', () => {
  test.beforeEach(async ({ page }) => { test.skip(isPhone(page), 'The phone has its own states below'); });

test('the app panel: Show rows, the changed footer and the result line; the count opens the pages', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('menuitem', { name: 'Tabs and Header Buttons', exact: true }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'Tabs and header buttons', exact: true })).toBeVisible();
  await expect(panel.getByText('Show on pages')).toBeVisible();
  await expect(panel.getByText('Every page: a page shows this however it is opened, at any depth. Sheets and modals never show it. A page can hide it for itself.')).toBeVisible();
  await expect(panel.locator('[data-result-line]')).toHaveText('3 shown on every page · 1 on the first page only · Hidden on 2 pages');
  await expect(panel.getByText('Needs a newer app. Publishing it waits for an app update.')).toBeVisible();
  await shoot(page, 'app-panel');
  await panel.getByRole('button', { name: 'Hidden on 2 pages' }).click();
  await expect(panel.getByRole('list', { name: 'Hidden on 2 pages' })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: /^Security/ }).first().getByText('Hides 2')).toBeVisible();
  await shoot(page, 'app-panel-pages-that-hide');
});

test('Hide on this page: Same as app on a tab first page, Quick Links and Profile first, every switch usable', async ({ page }) => {
  await openWorkspace(page);
  const panel = await openPageSettings(page, 'Climate');
  const group = panel.getByRole('region', { name: 'Hide on this page' });
  await expect(group.getByRole('switch')).toHaveCount(4);
  await expect(group.getByRole('switch', { name: 'Alerts (button)' })).toBeEnabled();
  await group.getByRole('switch', { name: 'Lamps (button)' }).check();
  await expect(group.getByText('Hidden on this page only. Other pages follow the app.')).toBeVisible();
  await shoot(page, 'hide-same-as-app');
});

test('Hide on this page: Custom leaves only the Tabs switch, and a sheet has no group', async ({ page }) => {
  await openWorkspace(page);
  const panel = await openPageSettings(page, 'Security System');
  await expect(panel.getByRole('region', { name: 'Hide on this page' }).getByRole('switch')).toHaveCount(4);
  await panel.getByRole('button', { name: 'Custom' }).click();
  const group = panel.getByRole('region', { name: 'Hide on this page' });
  await expect(group.getByRole('switch')).toHaveCount(1);
  await expect(group.getByRole('switch', { name: 'Tabs' })).toBeChecked();
  await shoot(page, 'hide-custom');
  await expect(page.getByRole('button', { name: 'No Problems' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  const pages = await openPagesList(page, 'Sheets');
  await pages.getByRole('button', { name: 'More for Lights' }).first().click();
  await page.getByRole('menuitem', { name: /Sheet Settings|Page Settings/ }).click();
  const sheet = page.getByLabel('Properties');
  await expect(sheet.getByRole('heading', { name: 'Lights', exact: true })).toBeVisible();
  await expect(sheet.getByText('Hide on this page')).toHaveCount(0);
  await shoot(page, 'hide-sheet-no-group');
});

test('In a wide window: Opens with Automatic, Full width and Beside, and the footer of the choice', async ({ page }) => {
  await openWorkspace(page);
  const panel = await openPageSettings(page, 'Home');
  const box = panel.getByRole('region', { name: 'In a wide window' });
  await expect(box.getByRole('switch', { name: 'Open pages beside this one' })).toBeChecked();
  await expect(panel.getByText('Start a new column set here')).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true');
  await box.getByText(/^Beside the page it came from when/).scrollIntoViewIfNeeded();
  await shoot(page, 'wide-automatic');
  await box.getByRole('button', { name: 'Full width' }).click();
  await expect(box.getByText('Always the whole window. Back returns to the page it came from.')).toBeVisible();
  await box.getByText('Always the whole window.').scrollIntoViewIfNeeded();
  await shoot(page, 'wide-full-width');
  await box.getByRole('button', { name: 'Beside' }).click();
  await expect(box.getByText('Always beside the page it came from. That page takes the left half.')).toBeVisible();
  await box.getByText('Always beside the page').scrollIntoViewIfNeeded();
  await shoot(page, 'wide-beside');
});

test('the library tags a page "Hides 2"', async ({ page }) => {
  await openWorkspace(page);
  const pages = await openPagesList(page, 'Tabs');
  await expect(pages.getByText('Hides 2')).toBeVisible();
  await shoot(page, 'library-hides-tag');
});

/** Selects the sheet "Lights" and one of its tiles, and opens the tile's action. */
async function openSheetTile(page: Page, tile: string) {
  const pages = await openPagesList(page, 'Sheets');
  await pages.locator('[role=treeitem]').filter({ hasText: /^Lights/ }).first().click();
  await page.locator('[data-preview-root]').first().getByText(tile, { exact: true }).first().click();
  const panel = page.getByLabel('Properties');
  await panel.getByRole('button', { name: /^(Opens|When tapped)/ }).first().click();
  return page.getByRole('dialog').or(panel);
}

test('link result: a tile in a sheet to a page closes the sheet first', async ({ page }) => {
  await openWorkspace(page);
  const page_ = await openSheetTile(page, 'Demo Room 1');
  await expect(page_.getByText('Opens the Demo Room 1 Lights page.')).toBeVisible();
  await expect(page_.getByText('The sheet closes first. Back returns to the page under the sheet.')).toBeVisible();
  await shoot(page, 'link-result-page');
});

test('link result: a tile in a sheet to a level stays in the sheet', async ({ page }) => {
  await openWorkspace(page);
  const box = await openSheetTile(page, 'Demo Room 2');
  await expect(box.getByText('Stays in this sheet.')).toBeVisible();
  await expect(box.getByText('Demo Room 2 Level is a level of Lights.')).toBeVisible();
  await shoot(page, 'link-result-level');
});

test('checks: a tab\'s first page that hides Tabs, and Custom without Quick Links and Profile', async ({ page, request }) => {
  const document = project();
  const security = document.pages.find((item: { id: string }) => item.id === 'page-security');
  security.components = security.components.filter((node: { type: string }) => node.type === 'text').slice(0, 1);
  await seed(request, document);
  await openWorkspace(page);
  await page.getByRole('button', { name: /^(No Problems|\d+ Problems?)$/ }).first().click();
  const checks = page.getByRole('region', { name: 'Suggestions' });
  await expect(checks.getByText(/Tabs are hidden on Security, the first page of a tab, so nothing on it leads to another tab\. Show Tabs there, or add a button that goes to another page\./)).toBeVisible();
  await expect(checks.getByText(/Custom has no Quick Links and Profile, so this page will not show them\. Add them, or choose Same as app\./).first()).toBeVisible();
  await shoot(page, 'checks');
});

test('Hide on this page: on a pushed page the First page only rows are off, disabled and captioned', async ({ page, request }) => {
  const document = project();
  document.navigation.tabsVisibility = 'root-only';
  await seed(request, document);
  await openWorkspace(page);
  const panel = await openPageSettings(page, 'Security System');
  const group = panel.getByRole('region', { name: 'Hide on this page' });
  await expect(group.getByRole('switch', { name: 'Tabs' })).toBeDisabled();
  await expect(group.getByRole('switch', { name: 'Tabs' })).not.toBeChecked();
  await expect(group.getByText('First page only')).toHaveCount(2);
  await group.scrollIntoViewIfNeeded();
  await shoot(page, 'hide-first-page-only');
  // On a tab's first page the same rows are ordinary switches.
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  const root = await openPageSettings(page, 'Climate');
  await expect(root.getByRole('region', { name: 'Hide on this page' }).getByRole('switch', { name: 'Tabs' })).toBeEnabled();
  await expect(root.getByRole('region', { name: 'Hide on this page' }).getByRole('switch', { name: 'Alerts (button)' })).toBeEnabled();
});
});

test.describe('phone panels', () => {
  test.beforeEach(async ({ page }) => { test.skip(!isPhone(page), 'The desktop has its own states above'); });

  test('page settings: the Hide on this page and In a wide window groups', async ({ page }) => {
    await openWorkspace(page);
    const panel = await openPageSettings(page, 'Climate');
    const hide = panel.getByRole('region', { name: 'Hide on this page' });
    await hide.scrollIntoViewIfNeeded();
    await expect(hide.getByRole('switch', { name: 'Tabs' })).toBeVisible();
    await shoot(page, 'phone-hide');
    const wide = panel.getByRole('region', { name: 'In a wide window' });
    await wide.locator('[data-wide-footer]').scrollIntoViewIfNeeded();
    for (const name of ['Automatic', 'Full width', 'Beside']) {
      const box = await wide.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.height, `${name} on one line`).toBeLessThan(48);
    }
    await shoot(page, 'phone-wide');
  });

  test('the app panel', async ({ page }) => {
    await openWorkspace(page);
    await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
    await page.getByRole('button', { name: 'Tabs and Header Buttons', exact: true }).click();
    const panel = page.getByLabel('Properties');
    await expect(panel.getByText('Show on pages')).toBeVisible();
    await shoot(page, 'phone-app-panel');
  });
});
