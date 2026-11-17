import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The simulator draws the production tiles (lane `fidtiles`, task `sim-fidelity`, items 1, 2, 3, 6, 7 and 10b): a room overview tile lit by
 * its family while its rooms are active, with the words the app computes; a room card with its state; a light tile with its band, percent and
 * disc; a Custom Lights tile that asks the grid for the width it needs; the Security System tile in its alarm colour. It runs on the invented
 * `fidtiles` story, whose house has lights on in some rooms, at the iPhone, the Duo and the iPad, in light and dark.
 * `FID_PHASE=before` only takes the screenshots (to compare an older build); `STUDIO_EVIDENCE_DIR` says where they go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-fidtiles');
const phase = process.env.FID_PHASE ?? 'after';
const checks = phase !== 'before';
const patient = { timeout: 20_000 };

const viewports = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
const schemes = ['dark', 'light'] as const;

test.beforeEach(() => { test.slow(); });

async function open(page: Page, view: typeof viewports[number], scheme: typeof schemes[number], surface: string) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: view.width, height: view.height });
  await page.goto(`/?preview2=1&panel=0&bezel=0&window=${encodeURIComponent(view.window)}&fixture=fidtiles&mode=use&surface=${surface}`);
  await expect(page.locator('.sh-tile, .sh-dv-lighttile').first()).toBeVisible(patient);
  await expect(page.locator('.sh-placeholder')).toHaveCount(0, patient);
  await page.waitForTimeout(400);
}
const shot = async (page: Page, item: string, scheme: string, view: typeof viewports[number]) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${phase}-${item}-${scheme}-${view.name}.png`, animations: 'disabled' });
};
const tile = (page: Page | Locator, id: string): Locator => page.locator(`[data-sel="node:${id}"]`);
const face = (page: Page | Locator, id: string): Locator => tile(page, id).locator('.sh-tile').first();
const background = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).backgroundImage);

for (const view of viewports) for (const scheme of schemes) {
  test(`items 1 and 2: the Lights sheet lights the rooms that have lights on, with their words (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'modal:modal-fid-lights');
    await shot(page, 'item1-lights-sheet', scheme, view);
    if (!checks) return;
    const sheet = page.getByRole('dialog');
    const words = { 'fid-sheet-living': '1 On', 'fid-sheet-bed': '2 On', 'fid-sheet-kitchen': 'On', 'fid-sheet-office': 'Off', 'fid-sheet-hall': 'Unavailable' };
    for (const [id, line] of Object.entries(words)) await expect(face(sheet, id).locator('.sh-tile-line')).toHaveText(line);
    for (const id of ['fid-sheet-living', 'fid-sheet-bed', 'fid-sheet-kitchen']) {
      await expect(face(sheet, id)).toHaveClass(/sh-lit-warm/);
      expect(await background(face(sheet, id))).toContain('rgb(255, 243, 222)');
    }
    for (const id of ['fid-sheet-office', 'fid-sheet-hall']) {
      await expect(face(sheet, id)).not.toHaveClass(/sh-lit/);
      expect(await background(face(sheet, id))).not.toContain('rgb(255, 243, 222)');
    }
  });

  test(`item 3: the Custom Lights tiles give their names the room they need (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-custom-lights');
    await shot(page, 'item3-custom-lights', scheme, view);
    if (!checks) return;
    const names = page.locator('.sh-dv-lighttile .sh-row-copy strong');
    await expect(names).toHaveCount(4);
    for (const name of await names.all()) {
      const box = (await name.boundingBox())!;
      // One 17 point line: the name neither wraps nor clips.
      expect(box.height, `${await name.textContent()} is on one line`).toBeLessThan(26);
      expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    for (const tileBox of await page.locator('.sh-dv-lighttile').all()) {
      const power = (await tileBox.locator('.sh-dv-disc').boundingBox())!, copy = (await tileBox.locator('.sh-row-copy').boundingBox())!;
      expect(power.x).toBeGreaterThanOrEqual(copy.x + copy.width - 1);
    }
  });

  test(`items 3 and 6: a room page draws light tiles with band, percent and disc, and its vent and contact cards with their state (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-room');
    await shot(page, 'item6-room-page', scheme, view);
    if (!checks) return;
    const dim = tile(page, 'fid-room-dim');
    await expect(dim.locator('.sh-dv-lighttile-band')).toHaveCount(1);
    await expect(dim.locator('.sh-row-copy span')).toHaveText('50%');
    await expect(dim.locator('.sh-dv-disc')).toHaveCount(1);
    await expect(tile(page, 'fid-room-plain').locator('.sh-tile-line')).toHaveText('On');
    await expect(tile(page, 'fid-room-plain').locator('.sh-tile-disc')).toHaveCount(1);
    await expect(tile(page, 'fid-room-off').locator('.sh-row-copy span')).toHaveText('Off');
    await expect(tile(page, 'fid-room-dead').locator('.sh-tile-line')).toHaveText('Unavailable');
    await expect(tile(page, 'fid-vent-open').locator('.sh-tile-line')).toHaveText('Open · 60%');
    await expect(tile(page, 'fid-vent-closed').locator('.sh-tile-line')).toHaveText('Closed');
    await expect(tile(page, 'fid-contact-plain').locator('.sh-tile-line')).toHaveCount(0);
    await expect(tile(page, 'fid-contact-state').locator('.sh-tile-line')).toHaveText('Open');
    await expect(tile(page, 'fid-contact-closed').locator('.sh-tile-line')).toHaveText('Closed');
  });

  test(`item 7: occupancy, contact, air quality and climate tiles carry their family and words (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-overview');
    await shot(page, 'item7-overviews', scheme, view);
    if (!checks) return;
    await expect(face(page, 'fid-ov-occ-a').locator('.sh-tile-line')).toHaveText('Occupied');
    await expect(face(page, 'fid-ov-occ-b').locator('.sh-tile-line')).toHaveText('Not Occupied');
    await expect(face(page, 'fid-ov-occ-a')).toHaveClass(/sh-lit/);
    await expect(face(page, 'fid-ov-occ-b')).not.toHaveClass(/sh-lit/);
    await expect(face(page, 'fid-ov-contact').locator('.sh-tile-line')).toHaveCount(0);
    await expect(face(page, 'fid-ov-contact-shown').locator('.sh-tile-line')).toHaveText('Window Open');
    await expect(face(page, 'fid-ov-air').locator('.sh-tile-line')).toHaveText('42 • 9.5 µg/m³');
    await expect(face(page, 'fid-ov-range').locator('.sh-tile-line')).toHaveText('70.0°F - 72.9°F');
    await expect(face(page, 'fid-ov-sensors').locator('.sh-tile-line')).toHaveText('70.2°F - 72.1°F');
    // With a colour helper the air tile is active: the air family's fill and white ink, as the app draws it.
    await expect(face(page, 'fid-ov-air')).toHaveClass(/sh-lit-filled/);
    expect(await face(page, 'fid-ov-air').evaluate(element => element.style.getPropertyValue('--fill'))).toBe('#006E62');
    await expect(face(page, 'fid-ov-contact')).toHaveClass(/sh-lit-filled/);
    await expect(face(page, 'fid-ov-range')).not.toHaveClass(/sh-lit/);
  });

  test(`item 10b: the Security System tile draws its alarm colour, icon and words (${view.name}, ${scheme})`, async ({ page }) => {
    await open(page, view, scheme, 'page:page-fid-quick');
    await shot(page, 'item10b-quick-links', scheme, view);
    if (!checks) return;
    const security = face(page, 'fid-quick-security');
    await expect(security.locator('.sh-tile-line')).toHaveText('Armed Away');
    expect(await security.evaluate(element => element.style.getPropertyValue('--fill'))).toBe('rgb(229 57 53)');
    await expect(security).toHaveClass(/sh-lit/);
    expect(await security.locator('.sh-tile-glyph').evaluate(element => getComputedStyle(element).color)).toBe('rgb(255, 255, 255)');
    await expect(face(page, 'fid-quick-chores')).not.toHaveClass(/sh-lit/);
  });
}
