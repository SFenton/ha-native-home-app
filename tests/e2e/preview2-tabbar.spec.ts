import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';

/**
 * Where a sheet's `local-tabs` control is drawn (`vacuum-map-ctl`, `tabbar-fix`). Native decides by `pinned` alone: absent, the
 * segmented control heads the content; `pinned`, the glass capsule sits on the sheet's bottom safe edge (`UKPagePinnedBar`), outside
 * the scrolling content, whose last row scrolls clear of it. The sim draws the same in every window. Screenshots go to
 * `STUDIO_EVIDENCE_DIR` when it is set.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: Record<string, any> };
const icons: Record<string, string> = { rooms: 'house', automation: 'gearshape', tracking: 'chart.bar' };

/** The home fixture opening on Climate, whose "Advanced Controls" sheet holds a `local-tabs`; `pinned` puts its bar at the bottom. */
function tabsDocument(pinned: boolean) {
  const document = structuredClone(fixture.document);
  const sheet = document.modals.find((modal: { id: string }) => modal.id === 'hc-climate-sheet');
  const tabs = sheet.components.find((node: { type: string }) => node.type === 'local-tabs');
  if (pinned) {
    tabs.props.pinned = true;
    for (const tab of tabs.tabs) tab.icon = { type: 'sf-symbol', name: icons[tab.id] ?? 'circle', rendering: 'canonical', unavailable: 'fallback' };
  }
  document.navigation.initialPageId = 'page-climate';
  document.navigation.initialTabId = 'hc-tab-climate';
  return document;
}

type Choice = 'iPhone' | 'Duo folded' | 'Duo upright' | 'Duo sideways' | 'iPad';
/** The window's width and the bottom safe inset the sheet sees: only a sheet that reaches the bottom edge has the home indicator. */
const windows: { choice: Choice; width: number; sheetSafe: number }[] = [
  { choice: 'iPhone', width: 402, sheetSafe: 34 }, { choice: 'Duo folded', width: 466, sheetSafe: 34 },
  { choice: 'Duo upright', width: 669, sheetSafe: 34 }, { choice: 'Duo sideways', width: 951, sheetSafe: 0 }, { choice: 'iPad', width: 834, sheetSafe: 0 },
];

/** Opens the workspace in Use on the given window and presents the Advanced Controls sheet, the way a person does. */
async function openSheet(page: Page, choice: Choice) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  const device = choice === 'iPhone' ? 'iPhone' : choice === 'iPad' ? 'iPad' : 'iPhone Duo';
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: device, exact: true }).click();
  await page.keyboard.press('Escape');
  const rail = page.getByTestId('simulator-rail');
  if (choice === 'Duo folded') await rail.getByRole('button', { name: 'Folded', exact: true }).click();
  // Choosing iPhone Duo opens it flat and sideways; one Rotate Right stands it upright.
  if (choice === 'Duo upright') await rail.getByRole('button', { name: 'Rotate Right' }).click();
  await expect(previewRoot(page).locator('.sh-page[data-current] .sh-large-title, .sh-page[data-current] .sh-inline-title').first()).toBeVisible();
  await rigSettled(page);
  await previewRoot(page).locator('[data-sel="node:hc-open-rooms"]').click();
  await expect(previewRoot(page).locator('.sh-sheet-layer')).toHaveCount(1);
  await page.waitForTimeout(600);
}
const box = async (locator: Locator) => (await locator.boundingBox())!;

for (const { choice, width, sheetSafe } of windows) {
  const slug = choice.replace(/ /g, '-').toLowerCase();

  test(`${choice}: with no pinned the sheet's tab control heads the content and is not in the bottom slot`, async ({ page, request }) => {
    await seed(request, tabsDocument(false));
    await openSheet(page, choice);
    await snap(page, `tabfix-${slug}-default`);
    const sheet = previewRoot(page).locator('.sh-sheet');
    const bar = sheet.locator('.sh-local-tabs > .sh-tab-bar');
    await expect(bar).toHaveAttribute('data-placement', 'top');
    await expect(sheet.locator('.sh-tab-dock .sh-tab-bar')).toHaveCount(0);
    const [s, b, body] = [await box(sheet), await box(bar), await box(sheet.locator('.sh-local-tab-body'))];
    expect(b.y).toBeLessThan(body.y);
    expect(b.y).toBeLessThan(s.y + s.height / 2);
  });

  test(`${choice}: with pinned the capsule sits on the sheet's bottom safe edge and the content scrolls clear of it`, async ({ page, request }) => {
    await seed(request, tabsDocument(true));
    await openSheet(page, choice);
    await snap(page, `tabfix-${slug}-pinned`);
    const root = previewRoot(page);
    const sheet = root.locator('.sh-sheet');
    const bar = sheet.locator('.sh-tab-dock .sh-tab-bar');
    await expect(bar).toHaveAttribute('data-placement', 'bottom');
    await expect(sheet.locator('.sh-local-tabs .sh-tab-bar')).toHaveCount(0);
    const zoom = (await box(root.locator('.sh-screen'))).width / width;
    const [s, b] = [await box(sheet), await box(bar)];
    // The capsule's bottom is 8 pt above the sheet's bottom safe edge (the bar's own padding), whatever the window.
    expect(Math.abs((s.y + s.height) - (b.y + b.height) - (8 + sheetSafe) * zoom)).toBeLessThan(1.5 * zoom);
    // The capsule is 16 pt in from each side of the sheet.
    expect(Math.abs((b.x - s.x) - 16 * zoom)).toBeLessThan(1.5 * zoom);
    expect(Math.abs((s.x + s.width) - (b.x + b.width) - 16 * zoom)).toBeLessThan(1.5 * zoom);
    // It does not move with the content, and the last row scrolls clear of it.
    const scroller = sheet.locator('.sh-scroll');
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(250);
    await snap(page, `tabfix-${slug}-pinned-scrolled`);
    const after = await box(bar);
    expect(Math.abs(after.y - b.y)).toBeLessThan(1);
    const rows = sheet.locator('.sh-local-tab-body > *');
    const last = await box(rows.last());
    expect(last.y + last.height).toBeLessThanOrEqual(after.y + 1);
    await expect(scroller).toHaveAttribute('data-tabs-docked', '');
  });
}
