import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { closePagesList, isPhone, openChecksFromBar, openPagesList, openWorkspace, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The Partly Folded rows (`sh.fold-sides@1`, `studio-duo-sim` L3): the page's Two Sides / One Column switch, a section's own side, the dimmed row of a nested
 * component, Reset Sides, the link that shows the pose, and the one-time offer for every page. Both projects: on a phone the rows are in the properties sheet.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

type Draft = { pages: { id: string; layout: { foldSides?: string }; components: { id: string; layout: { foldSide?: string } }[] }[] };
const draft = async (request: APIRequestContext) => (await (await request.get('/native/api/draft')).json()).document as Draft;
const home = (document: Draft) => document.pages.find(page => page.id === 'page-home')!;

/** Opens Home's Page Settings in the inspector. */
async function openHomeSettings(page: Page) {
  const list = await openPagesList(page, 'Home');
  await list.getByRole('button', { name: 'More for Home' }).first().click();
  await page.getByRole('menuitem', { name: 'Page Settings' }).click();
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  // On a phone the properties open as a sheet over the list; the desk closes the list beside it.
  if (!isPhone(page)) await closePagesList(page);
  return panel;
}
/** Puts the preview on iPhone Duo: the Window menu on the desk, Project then Window on a phone (a sheet each). */
async function chooseDuo(page: Page) {
  if (isPhone(page)) {
    await page.getByTestId('workspace2').getByRole('button', { name: 'Project' }).click();
    await page.getByRole('button', { name: 'Window', exact: true }).click();
    await page.getByRole('button', { name: 'iPhone Duo', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('simulator-rail')).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
}

/** Selects a top-level section by clicking the bare edge of its frame in the preview (its title would select the grid inside it). */
async function selectSection(page: Page, id: string, title: string) {
  await page.locator(`[data-preview-root] [data-sel="node:${id}"]`).first().click({ position: { x: 2, y: 2 } });
  const panel = page.getByLabel('Properties');
  await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return panel;
}
const row = (panel: ReturnType<Page['getByLabel']>) => panel.locator('.w2-fold-sides');

test('the page row: Two Sides turns the switch on, One Column takes it off, and Reset Sides waits for a section of its own', async ({ page, request }) => {
  await openWorkspace(page);
  const panel = await openHomeSettings(page);
  const sides = row(panel);
  await expect(sides.getByText('Partly Folded', { exact: true })).toBeVisible();
  await expect(sides.getByText('Sections take a side of the fold when iPhone Duo is partly folded sideways.')).toBeVisible();
  await expect(sides.getByRole('button', { name: 'One Column', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sides.getByRole('button', { name: 'Reset Sides' })).toBeDisabled();
  await sides.getByRole('button', { name: 'Two Sides', exact: true }).click();
  await expect(sides.getByRole('button', { name: 'Two Sides', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => home(await draft(request)).layout.foldSides).toBe('auto');
  await snap(page, 'fold-sides-page-row');
  await sides.getByRole('button', { name: 'One Column', exact: true }).click();
  await expect.poll(async () => home(await draft(request)).layout.foldSides).toBeUndefined();
});

test('a section\'s row names the side Automatic gives, takes a side of its own, and Reset Sides clears it in one undo step', async ({ page, request }) => {
  await openWorkspace(page);
  const settings = await openHomeSettings(page);
  await row(settings).getByRole('button', { name: 'Two Sides', exact: true }).click();
  const panel = await selectSection(page, 'hc-home-cameras', 'Cameras');
  const field = panel.locator('.w2-fold-side');
  await expect(field.getByText('Where this section sits when iPhone Duo is partly folded sideways. Other windows are unchanged.')).toBeVisible();
  const select = field.getByRole('combobox', { name: 'Partly Folded' });
  await expect(select).toBeEnabled();
  await expect(select).toHaveText(/^Automatic \((Leading|Trailing)\)$/);
  await select.click();
  await expect(page.getByRole('option')).toHaveText([/^Automatic/, 'Across the Top', 'Leading Side', 'Trailing Side']);
  await page.getByRole('option', { name: 'Trailing Side', exact: true }).click();
  await expect.poll(async () => home(await draft(request)).components.find(item => item.id === 'hc-home-cameras')?.layout.foldSide).toBe('trailing');
  await snap(page, 'fold-sides-section-row');
  // Reset Sides is on the page's own settings.
  const again = await openHomeSettings(page);
  const reset = row(again).getByRole('button', { name: 'Reset Sides' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect.poll(async () => home(await draft(request)).components.some(item => item.layout.foldSide)).toBe(false);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => home(await draft(request)).components.find(item => item.id === 'hc-home-cameras')?.layout.foldSide).toBe('trailing');
});

test('a nested component\'s row is dimmed and says why', async ({ page, request }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Lights');
  const field = panel.locator('.w2-fold-side');
  await expect(field.getByRole('combobox', { name: 'Partly Folded' })).toBeDisabled();
  await expect(field.getByText('Only a page’s top-level sections take a side.')).toBeVisible();
  expect(home(await draft(request)).components.some(item => item.layout.foldSide)).toBe(false);
});

test('Show Partly Folded: the caption offers the pose while the simulator is in another, and takes it', async ({ page }) => {
  await openWorkspace(page);
  // On the desk the section is picked first, while the preview is still flat and holds still; a phone's Project sheet covers the properties, so it picks the window first.
  if (isPhone(page)) await chooseDuo(page);
  const panel = await selectSection(page, 'hc-home-cameras', 'Cameras');
  if (!isPhone(page)) await chooseDuo(page);
  const link = panel.getByRole('button', { name: 'Show Partly Folded' });
  await expect(link).toBeVisible();
  await link.click();
  // The phone's properties sheet covers the rail, so the move is read from the row: the caption stops offering the pose once the simulator shows it.
  if (!isPhone(page)) await expect(page.getByTestId('simulator-rail').getByRole('button', { name: 'Partly Folded', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(link).toHaveCount(0);
});

test('the app lists the id: the rows do not say it waits for an app update, and a page that uses it is not warned about in Checks or in Publish', async ({ page, request }) => {
  await openWorkspace(page);
  const panel = await openHomeSettings(page);
  await expect(row(panel).getByText('The app can’t show this yet. Publishing it waits for an app update.')).toHaveCount(0);
  await row(panel).getByRole('button', { name: 'Two Sides', exact: true }).click();
  await expect.poll(async () => home(await draft(request)).layout.foldSides).toBe('auto');
  // On a phone the properties are a sheet over the page: it closes first, and Checks is Project's first row.
  if (isPhone(page)) { await page.keyboard.press('Escape'); await expect(page.getByLabel('Properties')).toHaveCount(0); }
  // Checks carries no pending warning (the desk's status tag opens it only for a problem; a suggestion is reached through the Checks pill).
  if (isPhone(page)) await openChecksFromBar(page); else await page.getByTestId('checks-pill').click();
  // Wait for the panel itself first, so the absence below is not read before Checks has opened.
  await expect(page.locator('.w2-checks')).toBeVisible();
  await expect(page.getByText(/Partly Folded, which the app does not have yet/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  if (isPhone(page)) { await page.keyboard.press('Escape'); await expect(page.locator('.w2-project-sheet')).toHaveCount(0); }
  // Publish does not repeat a pending warning in its dialog.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('[data-pending-warning]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
});

/** The centre of a control once it has stopped moving (the preview reflows when the Properties card opens beside it). */
const settledCentre = async (locator: ReturnType<Page['locator']>) => {
  let last = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const box = (await locator.boundingBox())!, now = JSON.stringify(box);
    if (now === last) return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };
    last = now;
    await locator.page().waitForTimeout(100);
  }
  throw new Error('The control kept moving');
};
const orderOf = async (request: APIRequestContext) => home(await draft(request)).components.map(item => item.id);
const frame = (page: Page, id: string) => page.locator(`[data-preview-root] .sh-screen [data-sel="node:${id}"]`).first();

/** Drags the selected section's grip to `to` and drops it. */
async function dragGrip(page: Page, grip: ReturnType<Page['locator']>, to: { x: number; y: number }) {
  const from = await settledCentre(grip);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await page.mouse.up();
}

test.describe('Edit drag and drop on a page on two sides', () => {
  test.beforeEach(async ({ request, page }) => {
    test.skip(isPhone(page), 'The grip is the wide layout; a phone drags by long press');
    const document = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')).document as Draft;
    home(document).layout.foldSides = 'auto';
    await seed(request, document);
  });

  test('flat: a section dropped in the gap above another lands there, not at the end of the page, and one undo puts it back', async ({ page, request }) => {
    test.skip(isPhone(page), 'The grip is the wide layout; a phone drags by long press');
    await openWorkspace(page);
    await selectSection(page, 'hc-weather-summary', 'Weather');
    const before = await orderOf(request);
    const cameras = await settledCentre(frame(page, 'hc-home-cameras')), guests = await settledCentre(frame(page, 'hc-home-guests-visible'));
    await dragGrip(page, page.getByTestId('node-handle').getByRole('button', { name: 'Move' }), { x: cameras.x, y: (guests.bottom + cameras.top) / 2 });
    await expect.poll(() => orderOf(request)).toEqual(['hc-status-rail', 'hc-home-guests-visible', 'hc-weather-summary', 'hc-home-cameras']);
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => orderOf(request)).toEqual(before);
  });

  test('flat: the status strip dropped in the gap above Guests lands at Guests\' place in the list, not before Cameras', async ({ page, request }) => {
    test.skip(isPhone(page), 'The grip is the wide layout; a phone drags by long press');
    await openWorkspace(page);
    // The strip's bare edge is its first chip, so the strip itself is reached the way a person does: choose a chip, then Escape for the strip around it.
    await page.locator('[data-preview-root] [data-sel="node:hc-chip-0"]').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Properties').getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
    const weather = await settledCentre(frame(page, 'hc-weather-summary')), guests = await settledCentre(frame(page, 'hc-home-guests-visible'));
    await dragGrip(page, page.getByTestId('node-handle').getByRole('button', { name: 'Move' }), { x: weather.x, y: (weather.bottom + guests.top) / 2 });
    await expect.poll(() => orderOf(request)).toEqual(['hc-weather-summary', 'hc-status-rail', 'hc-home-guests-visible', 'hc-home-cameras']);
  });

  test('partly folded sideways: a section dropped above another in the same side lands there', async ({ page, request }) => {
    test.skip(isPhone(page), 'The grip is the wide layout; a phone drags by long press');
    await openWorkspace(page);
    await selectSection(page, 'hc-home-cameras', 'Cameras');
    await chooseDuo(page);
    await page.getByTestId('simulator-rail').getByRole('button', { name: 'Partly Folded', exact: true }).click();
    const strip = await settledCentre(frame(page, 'hc-status-rail')), weather = await settledCentre(frame(page, 'hc-weather-summary'));
    await dragGrip(page, page.getByTestId('node-handle').getByRole('button', { name: 'Move' }), { x: weather.x, y: (strip.bottom + weather.top) / 2 });
    await expect.poll(() => orderOf(request)).toEqual(['hc-status-rail', 'hc-home-cameras', 'hc-weather-summary', 'hc-home-guests-visible']);
  });
});
