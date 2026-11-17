import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The simulator draws the layout the way the app does (lane `lsimfix`, `build/research/studio-parity4.md` H2, H5b, H5c, H5e, H5h, H8, H9):
 * status chips with their titles, vacuum tiles that never paint text under their discs and take the tracks their content needs, one
 * automatic-cleaning switch, a map only where the document puts one, a thermostat readout centred on its ring, vents filled in their
 * colour family, room visibility, and option rows without a heading. It runs on the invented `simfix` story at each Studio viewport.
 * `SIMFIX_PHASE=before` only takes the screenshots (to compare an older build); `STUDIO_EVIDENCE_DIR` says where they go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-simfix');
const phase = process.env.SIMFIX_PHASE ?? 'after';
const checks = phase !== 'before';
const patient = { timeout: 20_000 };

/** The Studio viewports and the device window each one draws (the preview scales the window to fit). */
const viewports = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone', points: 402 },
  { name: 'duo-upright', width: 669, height: 951, window: 'Duo open, upright', points: 669 },
  { name: 'duo-sideways', width: 951, height: 669, window: 'Duo open, sideways', points: 951 },
  { name: 'ipad-upright', width: 820, height: 1180, window: 'iPad upright', points: 834 },
  { name: 'ipad-sideways', width: 1180, height: 820, window: 'iPad sideways', points: 1194 },
] as const;

test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof viewports[number], query: string) {
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&window=${encodeURIComponent(view.window)}&${query}`);
  await expect(page.locator('.sh-page[data-current]')).toBeVisible(patient);
  await expect(page.locator('.sh-placeholder')).toHaveCount(0, patient);
  await page.waitForTimeout(500);
}
const shot = async (page: Page, fix: string, view: typeof viewports[number]) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${phase}-${fix}-${view.name}.png`, animations: 'disabled' });
};
const rect = async (locator: Locator) => (await locator.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

for (const view of viewports) {
  test(`H2 a status chip shows its title over its state (${view.name})`, async ({ page }) => {
    await open(page, view, 'fixture=simfix&mode=use&surface=page:page-sim-chips');
    await shot(page, 'h2-chips', view);
    if (!checks) return;
    const chip = page.locator('[data-sel="node:sim-chip-lights"] .sh-chip');
    const title = chip.locator('.sh-chip-text strong'), summary = chip.locator('.sh-chip-text span');
    await expect(title).toHaveText('Lights');
    await expect(summary).not.toHaveText('');
    expect((await rect(title)).y).toBeLessThan((await rect(summary)).y);
    // The preview scales its window to fit the viewport: a capsule is at least 48 window points tall.
    const zoom = (await rect(page.locator('.sh-screen'))).width / view.points;
    expect((await rect(chip)).height / zoom).toBeGreaterThanOrEqual(47.5);
  });

  test(`H5b H5c a vacuum tile never paints text under its discs and the grid gives it the tracks it needs (${view.name})`, async ({ page }) => {
    await open(page, view, 'fixture=simfix&mode=use&surface=page:page-sim-vacuums');
    await shot(page, 'h5b-vacuums', view);
    if (!checks) return;
    const tiles = page.locator('.sh-dv-card-tile');
    await expect(tiles).toHaveCount(3);
    for (let at = 0; at < 3; at += 1) {
      const tile = tiles.nth(at), fit = await tile.getAttribute('data-fit');
      const face = await rect(tile.locator('.sh-dv-card-face'));
      for (const disc of await tile.locator('.sh-dv-disc').all()) expect(overlap(face, await rect(disc)), `tile ${at} (${fit}) face and disc`).toBe(false);
      const text = await rect(tile.locator('.sh-row-copy'));
      expect(text.width, `tile ${at} (${fit}) keeps room for its title`).toBeGreaterThan(60);
    }
    const first = await rect(page.locator('[data-sel="node:sim-robot-1"]')), second = await rect(page.locator('[data-sel="node:sim-robot-2"]'));
    // A tile that needs 300 points is one per row where two columns are narrower than that.
    const sceneWidth = await page.locator('.sh-page[data-current] .sh-grid').first().evaluate(grid => grid.clientWidth);
    const columns = Number(await page.locator('[data-sel="node:sim-robots"] .sh-grid').getAttribute('data-columns'));
    if (sceneWidth < 2 * 300) expect(second.y).toBeGreaterThan(first.y + first.height - 1); else expect(Math.abs(second.y - first.y)).toBeLessThan(2);
    expect(columns).toBeGreaterThanOrEqual(1);
    // The third robot has a span of 2 set on it: the author's span wins over the grid's choice.
    const third = page.locator('[data-sel="node:sim-robot-3"]');
    expect((await third.evaluate(node => (node as HTMLElement).style.gridColumn))).toMatch(/span (2|1)/);
    // H5c: one switch for the automation, not one per room.
    await expect(page.locator('[data-sel="node:sim-auto"] [role=switch]')).toHaveCount(1);
    await expect(page.locator('[data-sel="node:sim-auto"]')).toContainText('Enabled');
  });

  test(`H5e H5h the map draws on the tabs the document puts it on, as a labelled schematic without a connection (${view.name})`, async ({ page }) => {
    await open(page, view, 'fixture=simfix&mode=use&surface=page:page-sim-sheet');
    await shot(page, 'h5h-sheet-tab-controls', view);
    if (!checks) return;
    const maps = page.locator('.sh-dv-map');
    await expect(maps).toHaveCount(1);
    await expect(maps.first().locator('.sh-dv-map-tag')).toHaveText('Schematic');
    await page.getByRole('tab', { name: 'Rooms' }).click();
    await expect(maps).toHaveCount(0);
    await shot(page, 'h5h-sheet-tab-rooms', view);
    await page.getByRole('tab', { name: 'To Clean' }).click();
    await expect(maps).toHaveCount(1);
  });

  test(`H8 E12 a vent fills in its family while open, a hidden room card and section are not drawn in Use (${view.name})`, async ({ page }) => {
    await open(page, view, 'fixture=simfix&mode=use&surface=page:page-sim-rooms');
    await shot(page, 'h8-rooms', view);
    if (!checks) return;
    const fill = (id: string) => page.locator(`[data-sel="node:${id}"] .sh-tile`).evaluate(node => getComputedStyle(node).getPropertyValue('--fill').trim());
    expect(await fill('sim-vent-open')).toBe('#3B58B8');
    expect(await fill('sim-vent-closed')).toBe('');
    await expect(page.locator('[data-sel="node:sim-guest"]')).toBeVisible();
    await expect(page.locator('[data-sel="node:sim-party"]')).toHaveCount(0);
    await expect(page.locator('[data-sel="node:sim-section-hidden"]')).toHaveCount(0);
  });

  test(`H8 the thermostat readout is centred on its ring (${view.name})`, async ({ page }) => {
    await open(page, view, 'fixture=devices&surface=page:page-climate');
    await shot(page, 'h8-thermostat', view);
    if (!checks) return;
    const dial = page.locator('.sh-dv-dial').first();
    const ring = await rect(dial.locator('> svg')), face = await rect(dial.locator('.sh-dv-dial-face'));
    expect(Math.abs((face.y + face.height / 2) - (ring.y + ring.height / 2))).toBeLessThan(1);
    expect(Math.abs((face.x + face.width / 2) - (ring.x + ring.width / 2))).toBeLessThan(1);
    // The app's dial has no step buttons.
    await expect(dial.locator('button')).toHaveCount(0);
  });

  test(`H8 option rows have no heading over them (${view.name})`, async ({ page }) => {
    await open(page, view, 'surface=page:hc-eco-critical-detail');
    await shot(page, 'h8-options', view);
    if (!checks) return;
    const card = page.locator('[data-type=climate-control] .sh-dv-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator('> .sh-row-primary')).toHaveCount(0);
    await expect(card.locator('.sh-dv-option').first()).toBeVisible();
  });
}

for (const view of viewports) {
  test(`accessibility: chips, discs and switches are named and reach 44 points (${view.name})`, async ({ page }) => {
    test.skip(!checks);
    await open(page, view, 'fixture=simfix&mode=use&surface=page:page-sim-vacuums');
    const zoom = (await rect(page.locator('.sh-screen'))).width / view.points;
    for (const name of ['Start Main Floor', 'Dock Main Floor', 'Open Main Floor']) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toBeVisible();
      const box = await rect(control);
      expect(box.height / zoom, name).toBeGreaterThanOrEqual(43.5);
      expect(box.width / zoom, name).toBeGreaterThanOrEqual(23.5);
    }
    const toggle = page.locator('[data-sel="node:sim-auto"]').getByRole('switch', { name: 'Main Floor' });
    expect(await toggle.getAttribute('aria-checked')).toBe('true');
    await page.goto(`/?preview2=1&panel=0&bezel=0&window=${encodeURIComponent(view.window)}&fixture=simfix&mode=use&surface=page:page-sim-chips`);
    await expect(page.locator('[data-sel="node:sim-chip-lights"]')).toContainText('Lights');
    const link = page.locator('[data-sel="node:sim-link"] button');
    expect(await link.getAttribute('aria-describedby')).toBe('sim-link-hint');
  });
}

test('the preview at desktop width draws the same chip, tile and map facts (1440)', async ({ page }) => {
  test.skip(!checks);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?preview2=1&panel=0&bezel=0&fixture=simfix&mode=use&surface=page:page-sim-vacuums');
  await expect(page.locator('.sh-dv-card-tile')).toHaveCount(3, patient);
  for (const tile of await page.locator('.sh-dv-card-tile').all()) {
    const face = await rect(tile.locator('.sh-dv-card-face'));
    for (const disc of await tile.locator('.sh-dv-disc').all()) expect(overlap(face, await rect(disc))).toBe(false);
  }
});
