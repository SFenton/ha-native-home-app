import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, rigSettled, seed } from './workspace2-helpers';

/**
 * Sections on the two sides of the hinge (`sh.fold-sides@1`, `studio-duo-sim` L3): the Duo partly folded sideways lays a page whose switch is on in the app's
 * three tracks (leading side, the band, trailing side), the status strip across the top, one scroll; a fold moves frames on `fold-pose` and re-creates nothing; text is never
 * drawn scaled; and no two sections overlap at rest. The same Home document with the switch off is what main drew (the "before" stills).
 */
const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: { pages: { id: string; layout: Record<string, unknown>; components: { id: string; layout: Record<string, unknown> }[] }[] } };

/** The fixture's Home page with the switch on (`auto`) or off, and any section pinned to a side. */
function homeDocument(switchOn: boolean, pins: Record<string, string> = {}) {
  const document = structuredClone(fixture.document);
  const home = document.pages.find(page => page.id === 'page-home')!;
  if (switchOn) home.layout.foldSides = 'auto'; else delete home.layout.foldSides;
  for (const node of home.components) if (pins[node.id]) node.layout.foldSide = pins[node.id];
  return document;
}

const evidence = process.env.STUDIO_EVIDENCE_DIR;
/** Saves a still under the evidence folder (`before/` and `after/` inside it) when one is configured. */
async function still(page: Page, name: string) {
  if (!evidence) return;
  const file = path.join(evidence, `${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.mouse.move(5, 5);
  writeFileSync(file, await page.screenshot({ animations: 'disabled' }));
}
const numbersFile = 'test-results/fold-sides-numbers.json';
const note = (key: string, value: unknown) => {
  mkdirSync('test-results', { recursive: true });
  const held = existsSync(numbersFile) ? JSON.parse(readFileSync(numbersFile, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(numbersFile, JSON.stringify({ ...held, [key]: value }, null, 2));
};

async function startDuo(page: Page) {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
}
const rail = (page: Page) => page.getByTestId('simulator-rail');
const press = async (page: Page, name: string) => { await rail(page).getByRole('button', { name, exact: true }).click(); await rigSettled(page); };

/** The frames of the page's top-level sections in the first copy of the screen, in window points, from layout offsets (no tilt, no zoom, no translate in them). */
const FRAMES = `(() => {
  const screen = document.querySelector('[data-preview-root] .sh-rig:not([data-frozen]) .sh-screen');
  if (!screen) return null;
  const frame = (element) => {
    let x = 0, y = 0, at = element;
    while (at && at !== screen) { x += at.offsetLeft; y += at.offsetTop; at = at.offsetParent; if (at && at !== screen) { x += at.clientLeft; y += at.clientTop; } }
    return { x, y, w: element.offsetWidth, h: element.offsetHeight };
  };
  const column = screen.querySelector('.sh-page[data-current] .sh-column');
  const out = {};
  for (const element of column.querySelectorAll('.sh-node')) {
    if (element.parentElement.closest('.sh-node')) continue;
    out[element.getAttribute('data-sel').slice(5)] = frame(element);
  }
  return { frames: out, sides: column.getAttribute('data-sides'), scrollers: screen.querySelectorAll('.sh-page[data-current] .sh-scroll').length,
    band: [...screen.querySelectorAll('.sh-crease')].map(item => ({ left: item.offsetLeft, width: item.offsetWidth }))[0] ?? null };
})()`;
type Frames = { frames: Record<string, { x: number; y: number; w: number; h: number }>; sides: string | null; scrollers: number; band: { left: number; width: number } | null };
const framesOf = (page: Page) => page.evaluate(FRAMES) as Promise<Frames>;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
const noOverlaps = (frames: Frames['frames']) => {
  const ids = Object.keys(frames), clashes: string[] = [];
  for (const [at, a] of ids.entries()) for (const b of ids.slice(at + 1)) if (overlap(frames[a], frames[b])) clashes.push(`${a} x ${b}`);
  return clashes;
};

test.describe('Home on two sides', () => {
  test.beforeEach(async ({ request }) => { await seed(request, homeDocument(true)); });

  test('partly folded sideways: the strip spans, each section is wholly on one side of the band, in the app\'s widths, on one scroll, with no overlap', async ({ page }) => {
    await startDuo(page);
    await press(page, 'Partly Folded');
    const read = await framesOf(page);
    const { frames, band } = read;
    expect(read.sides).toBe('top');
    expect(read.scrollers).toBe(1);
    const lower = band!.left, upper = band!.left + band!.width;
    expect(Math.abs(lower - 455.3)).toBeLessThan(1);
    expect(Math.abs(upper - 495.7)).toBeLessThan(1.5); // offsets are whole points
    // The strip is across the top and crosses the band; every other section ends before it or starts after it.
    const strip = frames['hc-status-rail'];
    expect(strip.x).toBeLessThan(lower); expect(strip.x + strip.w).toBeGreaterThan(upper);
    for (const id of ['hc-weather-summary', 'hc-home-cameras']) { expect(frames[id].x + frames[id].w, id).toBeLessThanOrEqual(lower); expect(frames[id].x, id).toBeGreaterThanOrEqual(0); }
    expect(frames['hc-home-guests-visible'].x).toBeGreaterThanOrEqual(upper);
    // Native widths (`FoldColumns.layout` with the page's 16 pt inset at both edges of each side): 455.3 less 32 and 372.3 less 32.
    expect(Math.abs(frames['hc-weather-summary'].w - (455.3 - 32))).toBeLessThan(1);
    expect(Math.abs(frames['hc-home-guests-visible'].w - (868 - 495.7 - 32))).toBeLessThan(1);
    // Each side starts level, under the strip, and stacks in turn; the trailing side ends early.
    expect(frames['hc-weather-summary'].y).toBeCloseTo(frames['hc-home-guests-visible'].y, 0);
    expect(frames['hc-weather-summary'].y).toBeGreaterThan(strip.y + strip.h - 1);
    expect(frames['hc-home-cameras'].y).toBeGreaterThan(frames['hc-weather-summary'].y + frames['hc-weather-summary'].h - 1);
    expect(noOverlaps(frames)).toEqual([]);
    note('sides-partly-sideways', { lower, upper, ...Object.fromEntries(Object.entries(frames).map(([id, frame]) => [id, { x: Math.round(frame.x * 10) / 10, y: Math.round(frame.y), w: Math.round(frame.w * 10) / 10 }])) });
  });

  test('every other pose is one column: unfolded flat, partly folded upright, folded, in document order and with no overlap', async ({ page }) => {
    await startDuo(page);
    const order = ['hc-status-rail', 'hc-weather-summary', 'hc-home-guests-visible', 'hc-home-cameras'];
    for (const name of ['Unfolded', 'Partly Folded', 'Folded']) {
      if (name === 'Partly Folded') { await press(page, 'Rotate Right'); }
      await press(page, name);
      const read = await framesOf(page);
      expect(read.sides, name).toBeNull();
      const ys = order.map(id => read.frames[id].y);
      expect(ys, `${name}: document order, top to bottom`).toEqual([...ys].sort((a, b) => a - b));
      expect(new Set(order.map(id => Math.round(read.frames[id].x))).size, `${name}: one column`).toBe(1);
      expect(noOverlaps(read.frames), name).toEqual([]);
    }
  });

  test('unfolded to partly folded: frames glide on fold-pose, nothing is re-created, no text is ever scaled, and a section crossing to the other side travels in a straight line', async ({ page }) => {
    await startDuo(page);
    await press(page, 'Unfolded');
    const flatFrames = (await framesOf(page)).frames;
    await page.evaluate(() => { for (const element of document.querySelectorAll('[data-preview-root] .sh-rig:not([data-frozen]) [data-copy="0"] .sh-node')) element.setAttribute('data-probe', '1'); });
    const run = await page.evaluate(async () => {
      type Sample = { t: number; guests: [number, number]; scaled: string[]; faded: string[] };
      const samples: Sample[] = [];
      const scope = () => document.querySelector('[data-preview-root] .sh-rig:not([data-frozen]) [data-copy="0"]');
      const guests = () => scope()?.querySelector('[data-sel="node:hc-home-guests-visible"]') as HTMLElement | null;
      const translate = (element: HTMLElement | null): [number, number] => {
        const parts = element ? getComputedStyle(element).translate : 'none';
        if (!parts || parts === 'none') return [0, 0];
        const [x, y] = parts.split(' ').map(part => parseFloat(part));
        return [x || 0, y || 0];
      };
      const violations = () => {
        const scaled: string[] = [], faded: string[] = [];
        const host = scope();
        if (!host) return { scaled, faded };
        for (const element of host.querySelectorAll<HTMLElement>('.sh-column, .sh-column *')) {
          const style = getComputedStyle(element);
          if (style.scale !== 'none' && style.scale !== '1') scaled.push(`${element.className}:${style.scale}`);
          if (style.transform !== 'none') { const m = new DOMMatrixReadOnly(style.transform); if (Math.abs(m.a - 1) > 1e-3 || Math.abs(m.d - 1) > 1e-3) scaled.push(`${element.className}:${style.transform}`); }
        }
        for (const element of host.querySelectorAll<HTMLElement>('.sh-fold-strip > .sh-node, .sh-fold-side > .sh-node')) if (getComputedStyle(element).opacity !== '1') faded.push(element.getAttribute('data-sel') ?? '');
        return { scaled, faded };
      };
      const start = performance.now();
      document.querySelector<HTMLButtonElement>('[data-testid=simulator-rail] button[aria-label="Partly Folded"]')!.click();
      await new Promise<void>(resolve => {
        const tick = (now: number) => {
          const found = violations();
          samples.push({ t: now - start, guests: translate(guests()), scaled: found.scaled, faded: found.faded });
          if (now - start < 700) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      const marked = [...(scope()?.querySelectorAll('[data-probe]') ?? [])].length;
      return { samples, marked, after: document.querySelectorAll('[data-preview-root] .sh-rig:not([data-frozen]) [data-copy="0"] [data-probe]').length };
    });
    // The elements are the ones that were there: marked before the fold, still there after it.
    expect(run.after).toBe(run.marked);
    expect(run.marked).toBeGreaterThan(3);
    expect(run.samples.flatMap(sample => sample.scaled), 'no frame draws scaled text').toEqual([]);
    expect(run.samples.flatMap(sample => sample.faded), 'no frame fades a section').toEqual([]);
    const moving = run.samples.filter(sample => Math.abs(sample.guests[0]) > 0.5 || Math.abs(sample.guests[1]) > 0.5);
    expect(new Set(moving.map(sample => sample.guests.map(value => value.toFixed(1)).join(','))).size, 'distinct frames of the move').toBeGreaterThanOrEqual(5); // a glide, not a jump: a loaded runner draws fewer frames of the 317 ms move
    // One straight line: the translation keeps its direction (dx and dy shrink together).
    const first = moving[0].guests;
    for (const sample of moving.slice(0, -1)) {
      const along = (sample.guests[0] * first[0] + sample.guests[1] * first[1]) / Math.hypot(...first) / Math.hypot(...sample.guests);
      expect(along, `direction at ${Math.round(sample.t)} ms`).toBeGreaterThan(0.999);
    }
    // It arrives within the token: 99% by 317 ms (plus a frame or two of slack for a render in slices).
    const startAt = moving[0].t, size = Math.hypot(...first);
    const done = run.samples.find(sample => sample.t >= startAt && Math.hypot(...sample.guests) <= size * 0.01);
    note('reflow', { frames: moving.length, travel: first.map(value => Math.round(value)), settledMsAfterFirstMove: done ? Math.round(done.t - startAt) : null });
    expect(done, 'the move ends').toBeDefined();
    expect(done!.t - startAt).toBeLessThan(317 + 300);
    // At rest the sections are where the page says, and the page was one column a moment before.
    await rigSettled(page);
    const rest = await framesOf(page);
    expect(rest.sides).toBe('top');
    expect(noOverlaps(rest.frames)).toEqual([]);
    expect(flatFrames['hc-home-guests-visible'].x).toBeLessThan(rest.frames['hc-home-guests-visible'].x);
  });

  test('unfold, fold and partly fold again: the page comes back to the same frames each time', async ({ page }) => {
    await startDuo(page);
    await press(page, 'Partly Folded');
    const first = (await framesOf(page)).frames;
    for (const name of ['Unfolded', 'Folded', 'Partly Folded']) await press(page, name);
    const again = (await framesOf(page)).frames;
    expect(again).toEqual(first);
    await press(page, 'Unfolded');
    await press(page, 'Partly Folded');
    expect((await framesOf(page)).frames).toEqual(first);
  });

  test('a section pinned to the trailing side moves there, and the sections after it keep their turns', async ({ page, request }) => {
    await seed(request, homeDocument(true, { 'hc-home-cameras': 'trailing' }));
    await startDuo(page);
    await press(page, 'Partly Folded');
    const { frames, band } = await framesOf(page);
    const upper = band!.left + band!.width;
    expect(frames['hc-home-cameras'].x).toBeGreaterThanOrEqual(upper);
    expect(frames['hc-home-guests-visible'].x).toBeGreaterThanOrEqual(upper);
    expect(frames['hc-weather-summary'].x + frames['hc-weather-summary'].w).toBeLessThanOrEqual(band!.left);
    expect(noOverlaps(frames)).toEqual([]);
  });

  test('at the largest text size the strip heads the leading side and the trailing side starts at the top', async ({ page }) => {
    await startDuo(page);
    await press(page, 'Partly Folded');
    const larger = rail(page).getByRole('button', { name: 'Larger Text', exact: true });
    while (await larger.isEnabled()) await larger.click();
    await rigSettled(page);
    const { frames, sides, band } = await framesOf(page);
    expect(sides).toBe('head');
    expect(frames['hc-status-rail'].x + frames['hc-status-rail'].w).toBeLessThanOrEqual(band!.left);
    expect(frames['hc-home-guests-visible'].x).toBeGreaterThanOrEqual(band!.left + band!.width);
    expect(frames['hc-home-guests-visible'].y).toBeLessThanOrEqual(frames['hc-status-rail'].y + 1);
    expect(noOverlaps(frames)).toEqual([]);
  });

  test('Reduce Motion: the page lands on its sides on the first frame, nothing translates on the way', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDuo(page);
    await press(page, 'Unfolded');
    const run = await page.evaluate(async () => {
      const scope = () => document.querySelector('[data-preview-root] .sh-rig:not([data-frozen]) .sh-screen');
      const samples: { sides: string | null; moving: number }[] = [];
      const start = performance.now();
      document.querySelector<HTMLButtonElement>('[data-testid=simulator-rail] button[aria-label="Partly Folded"]')!.click();
      await new Promise<void>(resolve => {
        const tick = (now: number) => {
          const host = scope();
          samples.push({
            sides: host?.querySelector('.sh-page[data-current] .sh-column')?.getAttribute('data-sides') ?? null,
            moving: [...(host?.querySelectorAll('.sh-node') ?? [])].filter(element => getComputedStyle(element).translate !== 'none' && getComputedStyle(element).translate !== '0px 0px').length,
          });
          if (now - start < 600) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });
    expect(run.reduce((most, sample) => Math.max(most, sample.moving), 0), 'nothing translates in any frame').toBe(0);
    expect(run.at(-1)!.sides).toBe('top');
    // The sides are there as soon as the fold has settled in the DOM: no frame shows the flat page after one that shows the sides.
    const firstSides = run.findIndex(sample => sample.sides === 'top');
    expect(firstSides).toBeGreaterThanOrEqual(0);
    expect(run.slice(firstSides).every(sample => sample.sides === 'top')).toBe(true);
    expect(noOverlaps((await framesOf(page)).frames)).toEqual([]);
  });
});

// The stills: Home partly folded sideways, what main drew (the switch off) and what this change draws (Two Sides), in the dark and light Studio. The document is dark in both.
for (const scheme of ['dark', 'light'] as const) {
  for (const [label, switchOn] of [['before', false], ['after', true]] as const) {
    test(`still: Home partly folded sideways, ${label}, ${scheme}`, async ({ page, request }) => {
      await seed(request, homeDocument(switchOn, switchOn ? { 'hc-home-cameras': 'trailing' } : {}));
      await page.emulateMedia({ colorScheme: scheme });
      await startDuo(page);
      await press(page, 'Partly Folded');
      const read = await framesOf(page);
      expect(read.sides).toBe(switchOn ? 'top' : null);
      expect(previewRoot(page)).toBeTruthy();
      await still(page, `${label}/home-partly-folded-sideways-${scheme}`);
    });
  }
}
