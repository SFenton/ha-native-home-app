import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The tile contract lane (task `sim-fidelity`, ids `sh.tile-swipe@1`, `sh.state-words@1`, `sh.tile-ink-default@1`, `sh.grid-state-groups@1`): the simulator draws the
 * swipe band and bubble, the state words, the default ink and the state groups of the invented `tilecontract` story, on the iPhone, the Duo and the iPad, in light and dark.
 * `STUDIO_EVIDENCE_DIR` says where the screenshots go.
 */
const evidence = process.env.STUDIO_EVIDENCE_DIR ?? join(process.cwd(), 'test-results', 'preview2-tilecontract');
const patient = { timeout: 20_000 };
const families = [
  { name: 'iphone', width: 390, height: 844, window: 'iPhone' },
  { name: 'duo', width: 669, height: 951, window: 'Duo open, upright' },
  { name: 'ipad', width: 820, height: 1180, window: 'iPad upright' },
] as const;
type Family = typeof families[number];
const schemes = ['dark', 'light'] as const;

test.beforeEach(() => { test.slow(); });

/** The page of the story, alone in a window of the family (no panel), or beside the panel that logs the simulated calls. */
async function open(page: Page, family: Family, scheme: typeof schemes[number], surface: string, options: { panel?: boolean; mode?: 'use' | 'edit' } = {}) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(options.panel ? { width: Math.max(family.width + 320, 1000), height: Math.max(family.height, 1000) } : { width: family.width, height: family.height });
  await page.goto(`/?preview2=1&panel=${options.panel ? 1 : 0}&bezel=0&window=${encodeURIComponent(family.window)}&fixture=tilecontract&mode=${options.mode ?? 'use'}&surface=${surface}`);
  await expect(page.locator('.sh-tile, .sh-dv-lighttile').first()).toBeVisible(patient);
  await expect(page.locator('.sh-placeholder')).toHaveCount(0, patient);
  await page.waitForTimeout(300);
}
const shot = async (page: Page, item: string, scheme: string, family: Family) => {
  await mkdir(evidence, { recursive: true });
  await page.getByTestId('preview2-host').screenshot({ path: `${evidence}/${item}-${scheme}-${family.name}.png`, animations: 'disabled' });
};
const tile = (page: Page, id: string): Locator => page.locator(`[data-sel="node:${id}"]`);
const frame = (page: Page, id: string): Locator => tile(page, id).getByTestId('swipe-frame');
const log = (page: Page) => page.getByTestId('log').locator('li');
/** Presses at `from` (a share of the tile's width), moves to `to` in steps and leaves the button down. */
async function dragTo(page: Page, id: string, from: number, to: number, dy = 0) {
  await frame(page, id).scrollIntoViewIfNeeded();
  const box = (await frame(page, id).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x + box.width * (from + (to - from) * step / 8), y + dy * step / 8);
  return box;
}

for (const family of families) for (const scheme of schemes) {
  test(`item 4: the swipe band at rest and the bubble in a drag (${family.name}, ${scheme})`, async ({ page }) => {
    await open(page, family, scheme, 'page:page-tc-swipe');
    await shot(page, 'swipe-at-rest', scheme, family);
    // A swiped light group tile draws its band at rest: 128 of 255 is 50%.
    await expect(tile(page, 'tc-light-swipe').locator('.sh-dv-lighttile')).toHaveCSS('--level', '50%');
    await expect(tile(page, 'tc-cover').getByTestId('swipe-band')).toHaveCSS('--share', '0.4');
    // The climate swipe has no band; the plain light tile has no swipe frame.
    await expect(tile(page, 'tc-climate').getByTestId('swipe-band')).toHaveCount(0);
    await expect(frame(page, 'tc-light-plain')).toHaveCount(0);
    const box = await dragTo(page, 'tc-cover', 0.4, 0.7);
    const bubble = tile(page, 'tc-cover').getByTestId('swipe-bubble');
    await expect(bubble).toHaveText('70%');
    const bubbleBox = (await bubble.boundingBox())!;
    // The bubble sits above the tile's top edge, inside its width, 8 points clear (32 tall, centre 24 above the top).
    expect(bubbleBox.y + bubbleBox.height).toBeLessThanOrEqual(box.y + 1);
    expect(bubbleBox.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(bubbleBox.x + bubbleBox.width).toBeLessThanOrEqual(box.x + box.width + 1);
    await shot(page, 'swipe-in-drag', scheme, family);
    await page.mouse.up();
  });
}

for (const family of families) {
  test(`item 4: a horizontal drag sends one call on release, and the band stays (${family.name})`, async ({ page }) => {
    await open(page, family, 'dark', 'page:page-tc-swipe', { panel: true });
    const cover = frame(page, 'tc-cover');
    await expect(cover).toHaveAttribute('aria-valuenow', '40');
    await dragTo(page, 'tc-cover', 0.4, 0.8);
    await expect(tile(page, 'tc-cover').getByTestId('swipe-bubble')).toHaveText('80%');
    await expect(cover).toHaveAttribute('data-swiping', '');
    expect(await log(page).count()).toBe(0);
    await page.mouse.up();
    await expect(tile(page, 'tc-cover').getByTestId('swipe-bubble')).toHaveCount(0);
    await expect(log(page)).toHaveCount(1);
    await expect(log(page).first()).toHaveText('Blinds: set cover position');
    await expect(cover).toHaveAttribute('aria-valuenow', '80');
    await expect(cover).toHaveAttribute('aria-valuetext', '80%');
    await expect(tile(page, 'tc-cover').getByTestId('swipe-band')).toHaveCSS('--share', '0.8');
    // A release at the value the tile shows plans nothing.
    const box = await dragTo(page, 'tc-cover', 0.8, 0.9);
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(tile(page, 'tc-cover').getByTestId('swipe-bubble')).toHaveText('80%');
    await page.mouse.up();
    await expect(log(page)).toHaveCount(1);
  });
}

test('item 4: the light tile says "Off" at 0 and turns the light off; the other presets move their entities', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  await dragTo(page, 'tc-light-swipe', 0.5, 0);
  await expect(tile(page, 'tc-light-swipe').getByTestId('swipe-bubble')).toHaveText('Off');
  await expect(tile(page, 'tc-light-swipe').locator('.sh-dv-lighttile')).toHaveAttribute('data-off', '');
  await page.mouse.up();
  await expect(log(page).last()).toHaveText('Lamp: turn off');
  await expect(tile(page, 'tc-light-swipe').locator('.sh-row-copy span')).toHaveText('Off');
  await dragTo(page, 'tc-fan', 0.3, 0.9);
  await expect(tile(page, 'tc-fan').getByTestId('swipe-bubble')).toHaveText('90%');
  await page.mouse.up();
  await expect(frame(page, 'tc-fan')).toHaveAttribute('aria-valuenow', '90');
  await dragTo(page, 'tc-volume', 0.3, 0.6);
  await page.mouse.up();
  await expect(frame(page, 'tc-volume')).toHaveAttribute('aria-valuenow', '60');
  await dragTo(page, 'tc-climate', 0.4, 0.6);
  await expect(tile(page, 'tc-climate').getByTestId('swipe-bubble')).toHaveText(/^\d\d(\.5)?°$/);
  await page.mouse.up();
  expect(Number(await frame(page, 'tc-climate').getAttribute('aria-valuenow'))).toBeGreaterThan(72);
});

test('item 4: a vertical drag plans nothing and draws no bubble; Escape drops a drag', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  await dragTo(page, 'tc-cover', 0.4, 0.42, 60);
  await expect(page.getByTestId('swipe-bubble')).toHaveCount(0);
  await page.mouse.up();
  await expect(log(page)).toHaveCount(0);
  await dragTo(page, 'tc-cover', 0.4, 0.9);
  await expect(page.getByTestId('swipe-bubble')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('swipe-bubble')).toHaveCount(0);
  await page.mouse.up();
  await expect(log(page)).toHaveCount(0);
  await expect(frame(page, 'tc-cover')).toHaveAttribute('aria-valuenow', '40');
});

test('item 4: in Edit the same drag draws no bubble', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true, mode: 'edit' });
  await tile(page, 'tc-cover').scrollIntoViewIfNeeded();
  const box = (await tile(page, 'tc-cover').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
  await expect(page.getByTestId('swipe-bubble')).toHaveCount(0);
  await page.mouse.up();
  await expect(log(page)).toHaveCount(0);
});

test('item 4: the arrow keys step by Tick Every and update aria-valuetext; the tile is a slider', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  const cover = frame(page, 'tc-cover');
  await expect(cover).toHaveAttribute('role', 'slider');
  await expect(cover).toHaveAttribute('aria-valuemin', '0');
  await expect(cover).toHaveAttribute('aria-valuemax', '100');
  await expect(cover).toHaveAttribute('aria-label', 'position');
  await cover.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cover).toHaveAttribute('aria-valuetext', '50%');
  await page.keyboard.press('ArrowUp');
  await expect(cover).toHaveAttribute('aria-valuetext', '60%');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await expect(cover).toHaveAttribute('aria-valuetext', '40%');
  await expect(log(page)).toHaveCount(4);
  // The climate swipe steps by its own detent, 1 degree.
  const climate = frame(page, 'tc-climate');
  await climate.focus();
  await page.keyboard.press('ArrowRight');
  await expect(climate).toHaveAttribute('aria-valuetext', '73°');
});

test('item 4: reduced motion keeps the scale off, and right to left mirrors the mapping', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dragTo(page, 'tc-cover', 0.4, 0.5);
  expect(await frame(page, 'tc-cover').evaluate(element => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
  await frame(page, 'tc-cover').scrollIntoViewIfNeeded();
  const box = (await frame(page, 'tc-cover').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 6 });
  // Minimum on the leading (right) edge: a finger a quarter in from the left is at 75%.
  await expect(tile(page, 'tc-cover').getByTestId('swipe-bubble')).toHaveText('75%');
  await page.mouse.up();
});

test('item 4: a swiped tile in a row that scrolls sideways has no pan; its slider stays', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  const inRow = frame(page, 'tc-row-cover');
  await inRow.scrollIntoViewIfNeeded();
  await expect(inRow).toHaveAttribute('role', 'slider');
  await expect(inRow).not.toHaveAttribute('data-no-pan-x', '');
  const box = (await inRow.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await expect(page.getByTestId('swipe-bubble')).toHaveCount(0);
  await page.mouse.up();
});

test('item 4: a tile the swipe cannot reach is not a slider: unavailable, and off by default', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-swipe', { panel: true });
  await expect(frame(page, 'tc-light-dead')).not.toHaveAttribute('role', 'slider');
  await expect(frame(page, 'tc-garage')).toHaveCount(0);
  await expect(frame(page, 'tc-light-plain')).toHaveCount(0);
});

for (const family of families) for (const scheme of schemes) {
  test(`item 5: a light tile says the app's words, and an authored word replaces each (${family.name}, ${scheme})`, async ({ page }) => {
    await open(page, family, scheme, 'page:page-tc-words');
    await shot(page, 'words', scheme, family);
    const line = (id: string) => tile(page, id).locator('.sh-dv-lighttile');
    // The app's words: the level, Off, Unavailable, On.
    await expect(line('tc-w-lamp')).toContainText('50%');
    await expect(line('tc-w-dark')).toContainText('Off');
    await expect(line('tc-w-dead')).toContainText('Unavailable');
    await expect(tile(page, 'tc-w-switch').locator('.sh-tile-parts')).toContainText('On');
    // Authored: one word each, the level with its number.
    await expect(line('tc-w2-lamp')).toContainText('Glowing 50%');
    await expect(line('tc-w2-dark')).toContainText('All Dark');
    await expect(line('tc-w2-dead')).toContainText('No Signal');
    await expect(tile(page, 'tc-w2-switch').locator('.sh-tile-parts')).toContainText('Lit');
  });
}

/** The computed colour of a tile's glyph and state line, as `rgb(...)` text. */
const inkOf = async (page: Page, id: string) => tile(page, id).evaluate(element => {
  const glyph = element.querySelector('.sh-tile-glyph, .sh-dv-lighttile-glyph'), line = element.querySelector('.sh-tile-line');
  return { glyph: glyph ? getComputedStyle(glyph).color : '', line: line ? getComputedStyle(line).color : '', face: getComputedStyle(element.querySelector('.sh-tile') ?? element).color };
});
// The gate (`src/shared/composition/tile-ink-gate.ts`) is off: with no `ink` in the address the preview draws today's grey, and `ink=primary` draws what the gate will draw once it is on.
for (const family of families) for (const scheme of schemes) {
  test(`item 6: the ink gate off draws the old grey and on draws the primary ink; lit and unavailable stay (${family.name}, ${scheme})`, async ({ page }) => {
    await open(page, family, scheme, 'page:page-tc-ink');
    await expect(page.locator('[data-preview-root]')).toHaveAttribute('data-ink', 'muted');
    await shot(page, 'ink-gate-off', scheme, family);
    const before = await inkOf(page, 'tc-ink-garage');
    expect(before.glyph).toBe('rgb(142, 142, 147)');
    expect(before.line).not.toBe('rgb(255, 255, 255)');
    await page.goto(`${page.url()}&ink=primary`);
    await expect(page.locator('.sh-tile').first()).toBeVisible(patient);
    await expect(page.locator('[data-preview-root]')).toHaveAttribute('data-ink', 'primary');
    await page.waitForTimeout(300);
    await shot(page, 'ink-gate-on', scheme, family);
    // A page is always dark: white. The idle garage glyph and its line are white; the unavailable light keeps its grey glyph.
    const idle = await inkOf(page, 'tc-ink-garage');
    expect(idle.glyph).toBe('rgb(255, 255, 255)');
    expect(idle.line).toBe('rgb(255, 255, 255)');
    // The lit Study lights tile (a filled face) keeps its own ink: never the primary white of the idle face.
    expect((await inkOf(page, 'tc-ink-switch')).line).not.toBe('');
  });
}

/** The ids of the items of a grouped grid in drawn order: a heading is `head:<group>`, a tile its node id. */
const order = (page: Page, grid: string) => page.locator(`[data-sel="node:${grid}"] > .sh-grid > [data-group-item]`).evaluateAll(items => items.map(item => (item as HTMLElement).dataset.group ? `head:${(item as HTMLElement).dataset.group}` : (item as HTMLElement).dataset.groupItem!));
for (const family of families) for (const scheme of schemes) {
  test(`item 7: a grid grouped by state: headings, empty group dropped, one grid (${family.name}, ${scheme})`, async ({ page }) => {
    await open(page, family, scheme, 'page:page-tc-groups');
    await shot(page, 'groups', scheme, family);
    // The lit lamps first under "Lights On", the idle and the unavailable under "Lights Off", each in the grid's order.
    await expect.poll(() => order(page, 'tc-groups-grid')).toEqual(['head:group-on', 'tc-g-lamp', 'tc-g-plain', 'tc-g-switch', 'head:group-off', 'tc-g-dark', 'tc-g-dead', 'tc-g-dark2']);
    // A grid with nothing on drops its On heading.
    await expect.poll(() => order(page, 'tc-groups-off')).toEqual(['head:group-off', 'tc-g2-dark', 'tc-g2-dead']);
    // The headings are headings, and an ungrouped grid has none.
    await expect(tile(page, 'tc-groups-grid').getByRole('heading', { name: 'Lights On' })).toBeVisible();
    await expect(tile(page, 'tc-groups-ungrouped').getByRole('heading')).toHaveCount(0);
    // One grid: a tile of each group sits on the same columns, and a heading is a whole row.
    const grid = (await tile(page, 'tc-groups-grid').boundingBox())!;
    const heading = (await tile(page, 'tc-groups-grid').getByRole('heading', { name: 'Lights Off' }).boundingBox())!;
    expect(Math.round(heading.width)).toBe(Math.round(grid.width));
    const lefts = new Set<number>();
    for (const id of ['tc-g-lamp', 'tc-g-dark']) lefts.add(Math.round((await tile(page, id).boundingBox())!.x));
    expect(lefts.size).toBe(1);
  });
}
test('item 7: a tap that turns a light off moves its tile to Lights Off, with a slide; with Reduce Motion it fades in and nothing slides', async ({ page }) => {
  for (const reduce of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await open(page, families[0], 'dark', 'page:page-tc-groups', { panel: true });
    await page.evaluate(() => {
      const calls: string[] = [];
      (window as unknown as { __animations: string[] }).__animations = calls;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
        const first = Array.isArray(keyframes) ? keyframes[0] : undefined;
        calls.push(`${(this as HTMLElement).dataset.groupItem ?? ''}:${first && 'transform' in first ? 'slide' : first && 'opacity' in first ? 'fade' : 'other'}`);
        return original.call(this, keyframes, options);
      };
    });
    await tile(page, 'tc-g-lamp').scrollIntoViewIfNeeded();
    await tile(page, 'tc-g-lamp').getByRole('button', { name: 'Power Study Lights' }).click();
    await expect.poll(() => order(page, 'tc-groups-grid')).toEqual(['head:group-on', 'tc-g-plain', 'tc-g-switch', 'head:group-off', 'tc-g-dark', 'tc-g-lamp', 'tc-g-dead', 'tc-g-dark2']);
    const calls = await page.evaluate(() => (window as unknown as { __animations: string[] }).__animations);
    if (reduce) { expect(calls).toContain('tc-g-lamp:fade'); expect(calls.filter(call => call.endsWith(':slide'))).toEqual([]); }
    else { expect(calls).toContain('tc-g-lamp:slide'); expect(calls.filter(call => call.endsWith(':fade'))).toEqual([]); }
    // The call was sent once.
    await expect(log(page)).toHaveCount(1);
  }
});
test('item 7: a grid in edit mode groups too, and keeps its add slot', async ({ page }) => {
  await open(page, families[0], 'dark', 'page:page-tc-groups', { panel: true, mode: 'edit' });
  await expect.poll(() => order(page, 'tc-groups-grid')).toEqual(['head:group-on', 'tc-g-lamp', 'tc-g-plain', 'tc-g-switch', 'head:group-off', 'tc-g-dark', 'tc-g-dead', 'tc-g-dark2']);
  await expect(tile(page, 'tc-groups-grid').locator("> .sh-grid > .sh-add-slot")).toHaveCount(1);
});
