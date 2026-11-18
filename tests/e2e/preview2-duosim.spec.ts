import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed, snap } from './workspace2-helpers';

/**
 * The Duo simulator's parity with the app (`build/research/studio-duosim.md`, S1 to S6): the navigation tile's chevron, the
 * floating action bar pinned over the bottom edge, no hinge band and no island on the unfolded portrait Duo, the portrait
 * sheet from the bottom, and the folded Duo's own body outline. Screenshots go to `STUDIO_EVIDENCE_DIR` when it is set.
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: Record<string, any> };

/** The home fixture opening on Climate (its navigation tiles open a sheet), with the page made long and a floating action bar added. */
function duosimDocument() {
  const document = structuredClone(fixture.document);
  const climate = document.pages.find((page: { id: string }) => page.id === 'page-climate');
  const copies = [1, 2, 3].map(at => JSON.parse(JSON.stringify(climate.components[0]).replace(/"id":"([^"]+)"/g, `"id":"$1-copy${at}"`)));
  const present = { type: 'present', modalId: 'hc-climate-sheet', arguments: {}, ifPresented: 'reject' };
  climate.components = [...climate.components, ...copies, {
    id: 'duosim-actions', title: 'Actions', layout: { span: 1 }, type: 'pinned-actions',
    props: { searchProviderId: 'duosim-search', searchPrompt: 'Search Tasks', items: [
      { id: 'duosim-add', title: 'Add Task', icon: { type: 'sf-symbol', name: 'plus', rendering: 'canonical', unavailable: 'fallback' }, prominent: true, showsTitle: true, action: present },
    ] },
  }];
  document.navigation.initialPageId = 'page-climate';
  document.navigation.initialTabId = 'hc-tab-climate';
  return document;
}
test.beforeEach(async ({ request }) => { await seed(request, duosimDocument()); });

type Choice = 'iPhone' | 'Duo folded' | 'Duo upright' | 'Duo sideways' | 'iPad';
/** Opens the workspace in Use on the given window, through the Window menu and the simulator rail the way a person does. */
async function start(page: Page, choice: Choice) {
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
}
const root = (page: Page) => previewRoot(page);
const box = async (locator: Locator) => (await locator.boundingBox())!;
/** Window points per CSS pixel on the page: the preview scales the window to fit. */
const zoomOf = async (page: Page, width: number) => (await box(root(page).locator('.sh-screen'))).width / width;

test('S1 a navigation tile draws a chevron centred on its trailing edge; an action tile draws none', async ({ page }) => {
  await start(page, 'iPhone');
  await snap(page, 'g17-chevron');
  const tile = root(page).locator('[data-sel="node:hc-open-rooms"]');
  const chevron = tile.locator('.sh-tile-chevron');
  await expect(chevron).toHaveCount(1);
  await expect(chevron).not.toHaveAttribute('aria-label', /.+/);
  const [t, c] = [await box(tile), await box(chevron)];
  expect(Math.abs((c.y + c.height / 2) - (t.y + t.height / 2))).toBeLessThan(1.5);
  const zoom = await zoomOf(page, 402);
  expect(Math.abs((t.x + t.width - (c.x + c.width)) - 12 * zoom)).toBeLessThan(2.5 * zoom);
  const navigation = root(page).locator('[data-type=navigation-tile]');
  expect(await navigation.count()).toBeGreaterThan(0);
  await expect(navigation.locator('.sh-tile-chevron')).toHaveCount(await navigation.count());
  await expect(root(page).locator('[data-type=action-tile] .sh-tile-chevron')).toHaveCount(0);
});

const windows: { choice: Choice; width: number; tabBar: boolean }[] = [
  { choice: 'iPhone', width: 402, tabBar: true }, { choice: 'Duo folded', width: 466, tabBar: false },
  { choice: 'Duo upright', width: 669, tabBar: true }, { choice: 'Duo sideways', width: 951, tabBar: false }, { choice: 'iPad', width: 834, tabBar: false },
];
for (const { choice, width, tabBar } of windows) {
  test(`S2 the floating bar is pinned over the bottom of the ${choice} and the last row scrolls clear of it`, async ({ page }) => {
    await start(page, choice);
    const dock = root(page).locator('.sh-dock');
    const scroller = root(page).locator('.sh-page[data-current] .sh-scroll');
    await snap(page, `g19-dock-${choice.replace(/ /g, '-')}-top`);
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(250);
    await snap(page, `g19-dock-${choice.replace(/ /g, '-')}-scrolled`);
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await expect(dock).toHaveCount(1);
    await expect(dock.locator('.sh-fab-search')).toBeVisible();
    // It is the page's child, not the scroller's.
    expect(await dock.evaluate(element => element.closest('.sh-scroll'))).toBeNull();
    const before = await box(dock);
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(250);
    const after = await box(dock);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    const zoom = await zoomOf(page, width);
    if (tabBar) {
      const bar = await box(root(page).locator('.sh-tabbar'));
      expect(bar.y - (after.y + after.height)).toBeGreaterThanOrEqual(6 * zoom - 1);
    }
    // The last row can be scrolled above the bar's top.
    const last = await box(root(page).locator('.sh-page[data-current] .sh-column > *').last());
    expect(last.y + last.height).toBeLessThanOrEqual(after.y + 1);
  });
}

test('S5 the unfolded portrait Duo is flat with no hinge band, and Partly Folded draws one across the page without moving a grid', async ({ page }) => {
  await start(page, 'Duo upright');
  const rail = page.getByTestId('simulator-rail');
  await snap(page, 'g7-duo-upright-flat');
  await expect(root(page).locator('.sh-crease[data-on]')).toHaveCount(0);
  await expect(rail.getByRole('button', { name: 'Partly Folded' })).toBeEnabled();
  // The band's place (455.3 pt from the top, 40.4 pt tall): the hinge is the tilt's axis, so it sits where it does flat, whatever the tilt.
  const flatScreen = await box(root(page).locator('.sh-screen').first());
  const zoom = flatScreen.width / 669;
  const grid = root(page).locator('[data-sel="node:hc-climate-openers"] .sh-grid').first();
  const flat = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns);
  await rail.getByRole('button', { name: 'Partly Folded' }).click();
  await rigSettled(page);
  await expect(root(page).locator('.sh-rig[data-fold=partly][data-turn="90"]')).toHaveCount(1);
  await expect(root(page).locator('.sh-crease[data-on][data-axis=horizontal]').first()).toBeAttached();
  await expect(root(page).locator('.sh-crease[data-on][data-axis=vertical]')).toHaveCount(0);
  await snap(page, 'g7-duo-upright-partly-folded');
  const crease = await box(root(page).locator('.sh-crease[data-on][data-axis=horizontal]').first());
  expect(Math.abs((crease.y + crease.height / 2 - flatScreen.y) / zoom - (455.3 + 20.2))).toBeLessThan(4);
  // Upright partly folded leaves the page as it was (D2): the same tracks in the same copy.
  expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns)).toBe(flat);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await expect(page.getByTestId('fold-readout')).toHaveText('Fold: hinge across the page, layout unchanged');
  await page.keyboard.press('Escape');
  await rail.getByRole('button', { name: 'Unfolded' }).click();
  await rigSettled(page);
  await expect(root(page).locator('.sh-crease[data-on]')).toHaveCount(0);
});

test('S3 the iPhone draws its Dynamic Island and no Duo window does', async ({ page }) => {
  await start(page, 'iPhone');
  await snap(page, 'g6-iphone-island');
  await expect(root(page).locator('.sh-island')).toHaveCount(1);
  for (const choice of ['Duo upright', 'Duo sideways', 'Duo folded'] as const) {
    await start(page, choice);
    if (choice === 'Duo upright') await snap(page, 'g6-duo-upright-no-island');
    await expect(root(page).locator('.sh-island')).toHaveCount(0);
  }
});

test('S4 the Duo opened upright presents a sheet from the bottom edge, full width until measured; an iPad centres it', async ({ page }) => {
  await start(page, 'Duo upright');
  await root(page).locator('[data-sel="node:hc-open-rooms"]').click();
  const layer = root(page).locator('.sh-sheet-layer');
  await expect(layer).toHaveCount(1);
  await page.waitForTimeout(600);
  await snap(page, 'g18-duo-upright-sheet');
  await expect(layer).toHaveAttribute('data-placement', 'bottom');
  const [screen, sheet] = [await box(root(page).locator('.sh-screen')), await box(layer.locator('.sh-sheet'))];
  expect(Math.abs((sheet.y + sheet.height) - (screen.y + screen.height))).toBeLessThan(1.5);
  expect(Math.abs(sheet.width - screen.width)).toBeLessThan(1.5);
  await start(page, 'iPad');
  await root(page).locator('[data-sel="node:hc-open-rooms"]').click();
  await expect(root(page).locator('.sh-sheet-layer')).toHaveCount(1);
  await page.waitForTimeout(600);
  await snap(page, 'g18-ipad-sheet-unchanged');
  await expect(root(page).locator('.sh-sheet-layer')).toHaveAttribute('data-placement', 'center');
});

test('S6 the folded Duo has its own body: tight corners on the hinge side, wide on the free side, and a hinge strip', async ({ page }) => {
  await start(page, 'Duo folded');
  await snap(page, 'g5-duo-folded-body');
  const face = root(page).locator('.sh-outer');
  const radii = await face.evaluate(element => {
    const clip = getComputedStyle(element.querySelector('.sh-clip')!), body = getComputedStyle(element.querySelector('.sh-body')!), strip = getComputedStyle(element.querySelector('.sh-strip')!);
    const corners = (style: CSSStyleDeclaration) => [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    return { screen: corners(clip), body: corners(body), strip: strip.width };
  });
  expect(radii.screen).toEqual(['8px', '59px', '59px', '8px']);
  expect(radii.body).toEqual(['1px', '69px', '69px', '1px']);
  expect(radii.strip).toBe('14px');
  // The pixels agree: a point just inside the top-left corner of the screen is screen, the same point at the top-right is the body.
  const tone = await face.evaluate(element => {
    const rect = element.getBoundingClientRect(), clip = element.querySelector('.sh-clip')!.getBoundingClientRect();
    return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, layer: { x: clip.x, y: clip.y, w: clip.width } };
  });
  const png = await page.screenshot({ clip: { x: tone.rect.x, y: tone.rect.y, width: tone.rect.w, height: tone.rect.h } });
  const zoom = tone.layer.w / 466, probe = 12 * zoom;
  const lum = await page.evaluate(async ({ data, points }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    return points.map(([x, y]) => { const [r, g, b] = context.getImageData(Math.round(x), Math.round(y), 1, 1).data; return r + g + b; });
  }, { data: png.toString('base64'), points: [[tone.layer.x - tone.rect.x + probe, tone.layer.y - tone.rect.y + probe], [tone.layer.x - tone.rect.x + tone.layer.w - probe, tone.layer.y - tone.rect.y + probe], [tone.rect.w / 2, 4]] });
  const [leftTop, rightTop, body] = lum;
  expect(Math.abs(rightTop - body)).toBeLessThan(12);
  expect(Math.abs(leftTop - body)).toBeGreaterThan(24);
  await start(page, 'iPhone');
  await snap(page, 'g5-iphone-body-unchanged');
  expect(await root(page).locator('.sh-bezel').evaluate(element => getComputedStyle(element.querySelector('.sh-layer')!).borderTopLeftRadius)).toBe('55px');
  await start(page, 'Duo upright');
  await snap(page, 'g5-duo-open-body');
});
