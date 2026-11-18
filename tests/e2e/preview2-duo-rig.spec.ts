import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openWorkspace, previewRoot, previewTile, rigSettled, seed, selectTile, snap } from './workspace2-helpers';

/**
 * The Duo preview's 3D rig (`studio-duo-sim`, L2): every transition between poses, the closed Duo turning four ways with its rail on the
 * camera's edge, Reduce Motion's cross-fade, the acceptance numbers of the two motion tokens, frame pacing on the sample document, and
 * Edit mode flattening only while a drag runs. Numbers go to `test-results/duo-rig-numbers.json` for the pull request.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

type Mode = 'Use' | 'Edit';
/** Opens the workspace on iPhone Duo (which opens flat and sideways, turn 0) and waits for the rig to rest. */
async function startDuo(page: Page, mode: Mode = 'Use') {
  await openWorkspace(page);
  if (mode === 'Use') await page.getByRole('button', { name: 'Use', exact: true }).first().click();
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'iPhone Duo', exact: true }).click();
  await page.keyboard.press('Escape');
  await rigSettled(page);
}
const rail = (page: Page) => page.getByTestId('simulator-rail');
const press = async (page: Page, name: string) => { await rail(page).getByRole('button', { name, exact: true }).click(); await rigSettled(page); };
const rig = (page: Page) => previewRoot(page).locator('.sh-rig:not([data-frozen])');
const expectPose = async (page: Page, fold: string, turn: number) => {
  await expect(rig(page)).toHaveAttribute('data-fold', fold);
  await expect(rig(page)).toHaveAttribute('data-turn', String(turn));
};

/** The luma (0 to 255) of the page's pixels at the given viewport points, from one screenshot decoded in the page. */
async function lumaAt(page: Page, points: { x: number; y: number }[]) {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ png, points }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const scale = image.width / window.innerWidth;
    return points.map(point => { const [r, g, b] = context.getImageData(Math.round(point.x * scale), Math.round(point.y * scale), 1, 1).data; return 0.2126 * r + 0.7152 * g + 0.0722 * b; });
  }, { png, points });
}

/** Records numbers for the pull request. */
const numbersFile = 'test-results/duo-rig-numbers.json';
const note = (key: string, value: unknown) => {
  mkdirSync('test-results', { recursive: true });
  const held = existsSync(numbersFile) ? JSON.parse(readFileSync(numbersFile, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(numbersFile, JSON.stringify({ ...held, [key]: value }, null, 2));
};

/**
 * Starts a recording, in the page, of a half's angle and the rig's slots on every animation frame, then runs `act` in the same task, so the
 * first sample is the frame the click caused. Returns the samples: time since the click, the half's angle in degrees, the slot count.
 */
async function record(page: Page, half: 'first' | 'second', button: string, ms: number) {
  await page.evaluate(({ half, ms, button }) => {
    const samples: { t: number; angle: number; slots: number; copies: number }[] = [];
    const w = window as unknown as { __rec: typeof samples; __t0: number; __done: boolean };
    w.__rec = samples; w.__done = false;
    const read = () => {
      const element = document.querySelector(`[data-preview-root] .sh-rig:not([data-frozen]) .sh-half[data-half=${half}]`);
      const matrix = element ? new DOMMatrixReadOnly(getComputedStyle(element).transform === 'none' ? 'matrix(1,0,0,1,0,0)' : getComputedStyle(element).transform) : undefined;
      return matrix ? Math.acos(Math.max(-1, Math.min(1, matrix.m11))) * 180 / Math.PI : NaN;
    };
    const tick = (now: number) => {
      samples.push({ t: now - w.__t0, angle: read(), slots: document.querySelectorAll('[data-preview-root] .sh-rig-slot').length, copies: document.querySelectorAll('[data-preview-root] .sh-screen').length });
      if (now - w.__t0 < ms) requestAnimationFrame(tick); else w.__done = true;
    };
    // Time zero is the click, made here in the page so no round trip sits between the two.
    w.__t0 = performance.now();
    document.querySelector<HTMLButtonElement>(`[data-testid=simulator-rail] button[aria-label="${button}"]`)!.click();
    requestAnimationFrame(tick);
  }, { half, ms, button });
  await page.waitForFunction(() => (window as unknown as { __done: boolean }).__done, undefined, { timeout: ms + 4000 });
  return page.evaluate(() => (window as unknown as { __rec: { t: number; angle: number; slots: number; copies: number }[] }).__rec);
}

/** The time at which a series first stays within 1% of its end. */
const settleTime = (samples: { t: number; angle: number }[], from: number, to: number) => {
  const progress = samples.map(sample => ({ t: sample.t, p: (sample.angle - from) / (to - from) }));
  // The clock starts when the motion does (the first frame that moved), not at the click: a render in slices sits between the two.
  const start = progress.find(sample => sample.p > 0.002)?.t ?? 0;
  const at = progress.find((sample, index) => progress.slice(index).every(next => next.p >= 0.99));
  return (at?.t ?? Infinity) - start;
};

test('closed to partly folded: the cover swings up from the base and the second display is there when it lands', async ({ page }) => {
  await startDuo(page);
  await press(page, 'Folded');
  await expectPose(page, 'closed', 0);
  await expect(previewRoot(page).locator('.sh-screen')).toHaveCount(1);
  await snap(page, 'rig-closed');
  await rail(page).getByRole('button', { name: 'Partly Folded', exact: true }).click();
  await rigSettled(page);
  await expectPose(page, 'partly', 0);
  await expect(previewRoot(page).locator('.sh-screen')).toHaveCount(2);
  await expect(previewRoot(page).locator('.sh-crease[data-on][data-axis=vertical]').first()).toBeAttached();
  // The first half's tilt is +18 degrees, the second's -18 (toward the viewer).
  const tilt = (half: string) => previewRoot(page).locator(`.sh-rig .sh-half[data-half=${half}]`).evaluate(element => Math.round(Math.acos(new DOMMatrixReadOnly(getComputedStyle(element).transform).m11) * 180 / Math.PI));
  expect([await tilt('first'), await tilt('second')]).toEqual([18, 18]);
  await snap(page, 'rig-partly-from-closed');
  // And every other pose is one click from here.
  await press(page, 'Unfolded');
  await snap(page, 'rig-open-flat');
  for (const name of ['Folded', 'Partly Folded']) { await press(page, name); }
  await expectPose(page, 'partly', 0);
});

test('closed to partly folded never shows a frame whose inner layout differs from the final one', async ({ page }) => {
  await startDuo(page);
  await press(page, 'Folded');
  // Read once per animation frame, in the callback that runs just before that frame paints: a sample is a painted frame. (Sampling from the test's own
  // timer reads between tasks, and under load it can land after a commit that a later task replaces before any frame is drawn: such a state is never seen.)
  const frames = await page.evaluate(async () => {
    const out: { t: number; tracks: string }[] = [];
    const read = () => [...document.querySelectorAll('[data-preview-root] .sh-rig:not([data-frozen]) .sh-half[data-half=first] .sh-inner .sh-clip[data-ready] [data-sel] .sh-grid')].slice(0, 3).map(grid => getComputedStyle(grid).gridTemplateColumns).join('|');
    const start = performance.now();
    document.querySelector<HTMLButtonElement>('[data-testid=simulator-rail] button[aria-label="Partly Folded"]')!.click();
    await new Promise<void>(resolve => { const tick = (now: number) => { out.push({ t: Math.round(now - start), tracks: read() }); if (now - start < 900) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
    return out;
  });
  // The inner display is drawn from the frame its layout is final: every painted frame it is visible in reads the same tracks.
  const seen = [...new Set(frames.map(frame => frame.tracks).filter(Boolean))];
  expect(seen, `layouts by frame: ${JSON.stringify(frames.filter(frame => frame.tracks).map(frame => [frame.t, frame.tracks]))}`).toHaveLength(1);
  expect(frames.filter(frame => frame.tracks).length, 'the display is visible in some frames').toBeGreaterThan(10);
});

for (const direction of ['Right', 'Left'] as const) {
  test(`a closed Duo rotates ${direction.toLowerCase()} four ways with its rail on the camera's edge`, async ({ page }) => {
    await startDuo(page);
    await press(page, 'Folded');
    const turns = direction === 'Right' ? [0, 90, 180, 270, 0] : [0, 270, 180, 90, 0];
    const railLeft: boolean[] = [];
    for (const [index, turn] of turns.entries()) {
      if (index) await press(page, `Rotate ${direction}`);
      await expectPose(page, 'closed', turn);
      const screen = (await previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-outer .sh-screen').boundingBox())!, bar = (await previewRoot(page).locator('.sh-rail-bar').boundingBox())!;
      const camera = (await previewRoot(page).locator('.sh-camera').boundingBox())!;
      // The window is portrait at 0 and 180, landscape at 90 and 270.
      expect(screen.height > screen.width).toBe(turn % 180 === 0);
      // The rail is on the vertical edge the camera is on: trailing at 0 and 90, leading at 180 and 270.
      const leading = turn >= 180;
      railLeft.push(bar.x < screen.x + screen.width / 2);
      expect(bar.x < screen.x + screen.width / 2).toBe(leading);
      expect(camera.x + camera.width / 2 < screen.x + screen.width / 2).toBe(leading);
      expect(Math.abs((leading ? bar.x - screen.x : screen.x + screen.width - bar.x - bar.width))).toBeLessThan(2);
      // The status items stay in the rail column past the camera: nothing in that box is content, and the box is inside the rail's width.
      const status = (await previewRoot(page).locator('.sh-rail-status').boundingBox())!;
      // The rail's inset is 84 pt and its bar 69 pt (R1): the status column is the inset, no wider.
      expect(Math.abs(status.width - bar.width * 84 / 69), 'as wide as the rail inset').toBeLessThanOrEqual(2);
      const onContent = await page.evaluate(({ x, y, width, height }) => {
        const hits: string[] = [];
        for (let column = 0; column <= 4; column += 1) for (let row = 0; row <= 8; row += 1) {
          const at = document.elementsFromPoint(x + 1 + (width - 2) * column / 4, y + 1 + (height - 2) * row / 8);
          const node = at.find(element => element.closest('.sh-node'));
          if (node) hits.push(node.closest('.sh-node')!.getAttribute('data-sel') ?? 'node');
        }
        return hits;
      }, status);
      expect(onContent, `turn ${turn}: the status box covers no content`).toEqual([]);
      // The camera is drawn in front of the screen: its centre is black and darker than the wallpaper just outside its ring.
      const [centre, outside] = await lumaAt(page, [
        { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 },
        { x: camera.x + camera.width / 2 + (leading ? 1 : -1) * (camera.width / 2 + 8), y: camera.y + camera.height / 2 },
      ]);
      note(`camera-turn-${turn}-${direction.toLowerCase()}`, { centreLuma: Math.round(centre), outsideLuma: Math.round(outside) });
      expect(outside - centre, `turn ${turn}: the camera is drawn over the screen`).toBeGreaterThanOrEqual(4);
      await snap(page, `rig-closed-turn-${turn}-${direction.toLowerCase()}`);
    }
    expect(railLeft).toEqual(turns.map(turn => turn >= 180));
  });
}

test('a turn keeps the fold: every pose turns, and unfold and fold keep the turn', async ({ page }) => {
  await startDuo(page);
  await press(page, 'Rotate Right');
  await expectPose(page, 'open', 90);
  await expect(previewRoot(page).locator('.sh-crease[data-on]')).toHaveCount(0);
  await press(page, 'Partly Folded');
  await expectPose(page, 'partly', 90);
  await expect(previewRoot(page).locator('.sh-crease[data-on][data-axis=horizontal]').first()).toBeAttached();
  await snap(page, 'rig-partly-upright-horizontal-hinge');
  await press(page, 'Rotate Right');
  await expectPose(page, 'partly', 180);
  await press(page, 'Folded');
  await expectPose(page, 'closed', 180);
  await press(page, 'Unfolded');
  await expectPose(page, 'open', 180);
  await press(page, 'Rotate Left');
  await expectPose(page, 'open', 90);
  await snap(page, 'rig-open-turn-90');
});

test('Reduce Motion: no tilt and no swing, the new pose fades in over the old and the old goes after 200 ms', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDuo(page);
  const samples = await record(page, 'first', 'Partly Folded', 700);
  // The halves are at their final tilt on the first frame with the new pose: nothing moves between them.
  const angles = [...new Set(samples.filter(sample => !Number.isNaN(sample.angle)).map(sample => Math.round(sample.angle)))];
  expect(angles.length).toBeLessThanOrEqual(2);
  expect(angles.at(-1)).toBe(18);
  // Two rigs for a moment (the old beneath, the new fading in), then one.
  expect(Math.max(...samples.map(sample => sample.slots))).toBe(2);
  const gone = samples.find((sample, index) => sample.slots === 1 && samples.slice(index).every(next => next.slots === 1))!;
  expect(gone.t).toBeLessThan(600);
  note('reducedMotion', { slotsMax: 2, oldRemovedAtMs: Math.round(gone.t) });
  await rigSettled(page);
  await expectPose(page, 'partly', 0);
  await expect(previewRoot(page).locator('.sh-rig-slot')).toHaveCount(1);
  // Reduce Motion turns the closed Duo too: no rotation of the slot, the fade only.
  await press(page, 'Folded');
  await press(page, 'Rotate Right');
  await expectPose(page, 'closed', 90);
  await snap(page, 'rig-reduce-motion-turned');
});

test('the rig: fold-pose reaches 99% of its travel at 317 ms and fold-swing at 528 ms, in at least 10 distinct frames', async ({ page }) => {
  await startDuo(page);
  // fold-pose: open to partly folded, the first half's angle 0 to 18.
  const pose = await record(page, 'first', 'Partly Folded', 900);
  const poseSettle = settleTime(pose, 0, 18);
  const poseDistinct = new Set(pose.map(sample => sample.angle.toFixed(2))).size;
  await rigSettled(page);
  await press(page, 'Unfolded');
  // fold-swing: open to closed, the cover half's angle 0 to 180.
  const swing = await record(page, 'first', 'Folded', 1200);
  const swingSettle = settleTime(swing, 0, 180);
  const swingDistinct = new Set(swing.map(sample => sample.angle.toFixed(2))).size;
  note('foldPose', { settleMs: Math.round(poseSettle), distinctFrames: poseDistinct, target: '317 +- 40' });
  note('foldSwing', { settleMs: Math.round(swingSettle), distinctFrames: swingDistinct, target: '528 +- 60' });
  expect(poseDistinct).toBeGreaterThanOrEqual(10);
  expect(swingDistinct).toBeGreaterThanOrEqual(10);
  // A settle time is read from drawn frames, so its resolution is the frame gap: a software renderer that draws every third frame can read two gaps late. The allowance is the median gap's excess over 60 Hz, twice; on a 60 Hz renderer it is nothing.
  const median = (samples: { t: number }[]) => { const gaps = samples.slice(1).map((sample, at) => sample.t - samples[at].t).sort((a, b) => a - b); return gaps[Math.floor(gaps.length / 2)]; };
  const slack = (samples: { t: number }[]) => 2 * Math.max(0, median(samples) - 16.8);
  note('settleSlackMs', { pose: Math.round(slack(pose)), swing: Math.round(slack(swing)) });
  expect(Math.abs(poseSettle - 317)).toBeLessThanOrEqual(40 + slack(pose));
  expect(Math.abs(swingSettle - 528)).toBeLessThanOrEqual(60 + slack(swing));
});

test('frame pacing: every transition keeps its glass live; a hardware renderer holds a 16.8 ms median and at most two gaps over 25 ms inside the token, a software one a p90 gap of 84 ms and no gap over 250 ms', async ({ page }) => {
  await startDuo(page);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const software = /swiftshader|software|llvmpipe|unknown/i.test(renderer);
  /** The class names of the preview's elements that blur what is behind them. */
  const glassNow = () => page.evaluate(() => {
    const blurred = (element: Element) => { const style = getComputedStyle(element); return (style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') || 'none') !== 'none'; };
    return [...new Set([...document.querySelectorAll('[data-preview-root] *')].filter(blurred).map(element => element.className.toString()))];
  });
  /** Clicks a rail button, waits into the motion, and checks every element that blurs at rest still blurs. */
  const midGlass = async (button: string, atRest: string[]) => {
    await rail(page).getByRole('button', { name: button, exact: true }).click();
    await page.waitForTimeout(120);
    const now = await glassNow();
    expect(atRest.filter(name => !now.includes(name)), `${button}: glass lost mid-motion`).toEqual([]);
    await rigSettled(page);
  };
  type Stat = { medianMs: number; p90Ms: number; over25: number; over33: number; worstMs: number; frames: number; clickToFirstFrameMs: number; movedAtMs: number };
  const stats: Record<string, Stat> = {};
  const pooled: number[] = [];
  /** Records a transition and keeps only its own window: from the first frame that moved to the token's duration after it. */
  const run = async (name: string, button: string, recordMs: number, tokenMs: number) => {
    const frames = await record(page, 'first', button, recordMs);
    const first = frames[0];
    // A turn is under way in its first frame (the old rig is already leaving beside the new one): it moves from the start.
    const movedAt = first.slots > 1 ? 0 : Math.max(0, frames.findIndex(frame => Math.abs(frame.angle - first.angle) > 0.01 || frame.slots !== first.slots || frame.copies !== first.copies));
    const start = frames[movedAt].t, inside = frames.filter((frame, index) => index >= movedAt && frame.t - start <= tokenMs);
    const times = inside.map(frame => frame.t), gaps = times.slice(1).map((time, index) => time - times[index]);
    pooled.push(...gaps);
    const sorted = [...gaps].sort((a, b) => a - b), at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
    // The first sample's time is its frame's start, which can fall just before the click when the frame was already under way: latency is floored at 0.
    stats[name] = { medianMs: Number(at(0.5).toFixed(1)), p90Ms: Number(at(0.9).toFixed(1)), over25: gaps.filter(gap => gap > 25).length, over33: gaps.filter(gap => gap > 33.5).length, worstMs: Number(Math.max(...gaps).toFixed(1)), frames: inside.length, clickToFirstFrameMs: Number(Math.max(0, start).toFixed(1)), movedAtMs: Number(start.toFixed(1)) };
    await rigSettled(page);
  };
  const atRest = await glassNow();
  expect(atRest.length, 'the sample document has glass at rest').toBeGreaterThan(0);
  await midGlass('Partly Folded', atRest);
  await midGlass('Unfolded', atRest);
  await run('fold', 'Partly Folded', 700, 450);
  await run('unfold', 'Unfolded', 700, 450);
  await run('swingToClosed', 'Folded', 1000, 750);
  await run('swingToPartly', 'Partly Folded', 1000, 750);
  await run('rotateRight', 'Rotate Right', 900, 450);
  await run('rotateLeft', 'Rotate Left', 900, 450);
  // A turn of a closed Duo, mid-motion: its glass is live too.
  await press(page, 'Folded');
  await midGlass('Rotate Right', await glassNow());
  note('framePacing', { renderer, software, transitions: stats });
  // The 90th percentile is taken over every gap of the six transitions: one transition has too few frames on a software renderer for its own p90 to be more than its worst gap.
  const poolSorted = [...pooled].sort((a, b) => a - b), pooledP90 = poolSorted[Math.floor(poolSorted.length * 0.9)];
  note('framePacingPooled', { gaps: pooled.length, p90Ms: Number(pooledP90.toFixed(1)) });
  // 84 ms is five 60 Hz frames. Measured software runs sit at 66.7 (four frames), so the gate has one frame of margin on a loaded shared runner; 250 ms is a hang.
  if (software) expect(pooledP90, `p90 gap on ${renderer}`).toBeLessThanOrEqual(84);
  for (const [name, value] of Object.entries(stats)) {
    // A software renderer re-blurs on the CPU, so its numbers are recorded and only a robust tripwire gates: a slow tail, and no hang.
    if (software) { expect(value.worstMs, `${name} worst gap on ${renderer}`).toBeLessThanOrEqual(250); }
    // A hardware renderer holds the frame rate: a 60 Hz median, and at most two frames more than one missed frame long (a 30 fps motion fails both).
    else { expect(value.frames, `${name}: frames inside the token`).toBeGreaterThanOrEqual(20); expect(value.medianMs, `${name} median on ${renderer}`).toBeLessThanOrEqual(16.8); expect(value.over25, `${name} gaps over 25 ms on ${renderer}`).toBeLessThanOrEqual(2); }
  }
  // The second live copy: from the click that opens the fold on an open Duo to the frame its screen is mounted and ready (its grids have measured), and what the commit cost the main thread.
  await press(page, 'Unfolded');
  const twin = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid=simulator-rail] button[aria-label="Partly Folded"]')!;
    const start = performance.now();
    let mountedAt = -1, readyAt = -1, longest = 0;
    const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration); });
    try { observer.observe({ entryTypes: ['longtask'] }); } catch { /* long tasks are not reported here */ }
    button.click();
    await new Promise<void>(resolve => {
      const tick = () => {
        const clips = document.querySelectorAll('[data-preview-root] .sh-rig:not([data-frozen]) .sh-clip');
        if (mountedAt < 0 && clips.length === 2) mountedAt = performance.now() - start;
        if (readyAt < 0 && clips.length === 2 && [...clips].every(clip => clip.hasAttribute('data-ready'))) { readyAt = performance.now() - start; resolve(); return; }
        if (performance.now() - start > 3000) { resolve(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    return { mountedMs: Math.round(mountedAt), readyMs: Math.round(readyAt), longestTaskMs: Math.round(longest) };
  });
  note('twinCopy', twin);
  expect(twin.mountedMs, 'the second copy mounts').toBeGreaterThanOrEqual(0);
  expect(twin.readyMs, 'and is ready').toBeGreaterThan(0);
  await rigSettled(page);
});

test('Edit mode keeps the tilt and flattens only while a drag runs; Use mode never flattens', async ({ page }) => {
  await startDuo(page, 'Edit');
  await press(page, 'Partly Folded');
  const flat = () => previewRoot(page).locator('.sh-rig:not([data-frozen]) .sh-half[data-half=first]').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m11);
  await expect.poll(flat).toBeLessThan(0.96);
  await selectTile(page, 'Weather');
  // The handle may sit in the second copy (aria-hidden), so it is found by its label, not its role.
  const grip = page.getByTestId('node-handle').locator('[aria-label="Move"]');
  await expect(grip).toBeVisible();
  // The preview reflows when the Properties card opens beside it: take the boxes once they have stopped moving.
  const settled = async (target: ReturnType<Page['locator']>) => {
    let last = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const now = JSON.stringify(await target.boundingBox());
      if (now === last) return JSON.parse(now) as { x: number; y: number; width: number; height: number };
      last = now;
      await page.waitForTimeout(100);
    }
    throw new Error('The control kept moving');
  };
  const from = await settled(grip), to = await settled(previewTile(page, 'Demo Guests 2'));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 24, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.getByTestId('drop-cue')).toBeVisible();
  await expect.poll(flat).toBeGreaterThan(0.9999);
  await snap(page, 'rig-drag-flattened');
  await page.mouse.up();
  await expect.poll(flat).toBeLessThan(0.96);
  await snap(page, 'rig-drag-restored');
});

test('a tap in each half of a partly folded Duo reaches its tile in Use: one in the first half and one in the second', async ({ page }) => {
  await startDuo(page);
  await press(page, 'Partly Folded');
  // For each half: a tile whose centre that half's clip shows, and what a pointer finds at its centre through the tilt.
  const hits = await page.evaluate(() => [...document.querySelectorAll('[data-preview-root] .sh-rig [data-copy]')].map(host => {
    const clip = host.closest('.sh-clip')!.getBoundingClientRect();
    const tile = [...host.querySelectorAll('.sh-node[data-type$="-tile"], .sh-node[data-type="status-chip"]')].find(node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.left + box.width / 2 >= clip.left && box.left + box.width / 2 <= clip.right && box.top >= clip.top && box.bottom <= clip.bottom;
    });
    if (!tile) return { half: host.getAttribute('data-copy'), found: false, hit: false };
    const box = tile.getBoundingClientRect(), at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { half: host.getAttribute('data-copy'), found: true, hit: Boolean(at && tile.contains(at)) };
  }));
  expect(hits).toEqual([{ half: '0', found: true, hit: true }, { half: '1', found: true, hit: true }]);
  // A real tap in the second half lands: it selects nothing in Use and opens what the tile opens (a sheet here), or at least reaches the tile's own handler.
  const second = previewRoot(page).locator('.sh-rig [data-copy="1"] .sh-node[data-type="navigation-tile"]').first();
  if (await second.count()) {
    const box = (await second.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
});

test('the Edit handle of a tile partly folded is in the copy the keyboard and a screen reader reach: focus it, move the tile and open Add', async ({ page }) => {
  await startDuo(page, 'Edit');
  await press(page, 'Partly Folded');
  await selectTile(page, 'Weather');
  const handle = page.getByTestId('node-handle');
  // Found by role: it is not inside an aria-hidden subtree, wherever the tile sits.
  const grip = handle.getByRole('button', { name: 'Move' });
  await expect(grip).toBeVisible();
  expect(await handle.evaluate(element => !element.closest('[aria-hidden=true]'))).toBe(true);
  // It is in the copy whose clip shows it.
  expect(await handle.evaluate(element => { const clip = element.closest('.sh-clip')!.getBoundingClientRect(), box = element.getBoundingClientRect(); return box.left + box.width / 2 >= clip.left && box.left + box.width / 2 <= clip.right; })).toBe(true);
  // The selected node is exposed where its handle is drawn; its duplicate in the other copy is hidden from a screen reader.
  await expect(previewRoot(page).locator('[data-sel="node:hc-weather"][aria-hidden=true], [data-selected][aria-hidden=true]').first()).toBeAttached();
  await grip.focus();
  await expect(grip).toBeFocused();
  // Space on the grip picks the tile up (the keyboard's drag); Escape puts it back.
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-announcement')).toContainText('Picked up Weather');
  await snap(page, 'rig-handle-keyboard-picked-up');
  await page.keyboard.press('Escape');
  const add = handle.getByRole('button', { name: /^Add after/ });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').or(page.getByRole('menu')).first()).toBeVisible();
});

for (const mode of ['Use', 'Edit'] as const) {
  test(`${mode}: tabbing through a partly folded page visits each control once, in the copy that shows it, and never scrolls a clip`, async ({ page }) => {
    await startDuo(page, mode);
    await press(page, 'Partly Folded');
    // Every control that can take a tab stop in the preview: none is aria-hidden, none is clipped out of its half.
    const stops = await page.evaluate(() => [...document.querySelectorAll('[data-preview-root] .sh-rig [data-copy] button, [data-preview-root] .sh-rig [data-copy] a[href], [data-preview-root] .sh-rig [data-copy] input, [data-preview-root] .sh-rig [data-copy] [tabindex]')]
      .filter(element => (element as HTMLElement).tabIndex >= 0).map(element => {
        const clip = element.closest('.sh-clip')!.getBoundingClientRect(), box = element.getBoundingClientRect(), x = box.left + box.width / 2;
        return { hidden: Boolean(element.closest('[aria-hidden=true]')), inClip: x >= clip.left && x <= clip.right, label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 24) };
      }));
    expect(stops.length).toBeGreaterThan(3);
    expect(stops.filter(stop => stop.hidden || !stop.inClip)).toEqual([]);
    // And a person tabbing: focus never falls to the body inside the preview, stays inside its half, and no clip scrolls.
    await page.locator('[data-preview-root]').first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => undefined);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const visited: string[] = [];
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const inRig = Boolean(active?.closest('[data-preview-root] .sh-rig'));
        const clip = active?.closest('.sh-clip');
        const box = active?.getBoundingClientRect(), view = clip?.getBoundingClientRect();
        const x = box ? box.left + box.width / 2 : 0;
        return {
          body: active === document.body, inRig, hidden: Boolean(active?.closest('[aria-hidden=true]')),
          inClip: inRig && Boolean(view) && x >= view!.left - 1 && x <= view!.right + 1,
          scrolled: [...document.querySelectorAll('[data-preview-root] .sh-clip')].some(element => element.scrollTop !== 0 || element.scrollLeft !== 0),
          key: active ? `${active.closest('[data-copy]')?.getAttribute('data-copy')}:${active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 20)}` : '',
        };
      });
      expect(state.scrolled, `step ${step}`).toBe(false);
      // Leaving the preview (to the rest of the page, or past the end of it) ends the walk; falling to the body between two stops would show as too few stops.
      if (!state.inRig && visited.length) break;
      if (state.inRig) { expect(state.hidden, `step ${step} ${state.key}`).toBe(false); expect(state.inClip, `step ${step} ${state.key}`).toBe(true); visited.push(state.key); }
    }
    // Each control once, none skipped: as many stops as controls that can take one, and a copy's duplicate is never a second stop.
    expect(visited.length).toBe(stops.length);
  });
}

/**
 * Owner feedback on PR #11: partly folded, the Duo is one display bent at the fold. A strip of pixels across the hinge, over the wide
 * Weather tile (which crosses it, as the chip row does), shows no line darker than the crease's falloff and no offset in the tile's
 * divider on either side. Decoded in the page, so no image library is needed.
 */
/** The one-surface check at the page's device scale: stills and numbers under `label`. */
async function oneSurface(page: Page, label: string) {
  await startDuo(page);
  await press(page, 'Folded');
  await press(page, 'Partly Folded');
  await page.mouse.move(5, 5);
  await snap(page, `rig-partly-from-closed-${label}`);
  const where = await page.evaluate(() => {
    const [first, second] = [...document.querySelectorAll('.sh-rig:not([data-frozen]) .sh-clip')].map(clip => clip.getBoundingClientRect());
    const tile = [...document.querySelectorAll('.sh-rig:not([data-frozen]) [data-copy="0"] .sh-node[data-type="weather-panel"]')][0]?.getBoundingClientRect();
    return { hinge: (first.right + second.left) / 2, top: tile?.top ?? 0, bottom: tile?.bottom ?? 0, found: Boolean(tile) };
  });
  expect(where.found, 'a wide tile crosses the fold in the sample document').toBe(true);
  const x = Math.round(where.hinge) - 100, y = Math.round(where.top) + 4, width = 200, height = Math.round(where.bottom - where.top) - 8;
  // The whole viewport, cropped in the page: a clipped screenshot of a 3D scene can come back half composited.
  const png = (await page.screenshot()).toString('base64');
  const read = await page.evaluate(async ({ png, x, y, width, height }) => {
    const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
    // Everything below is in device pixels: at 2x a column is half a point.
    const scale = image.width / window.innerWidth, w = Math.round(width * scale), h = Math.round(height * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d')!; context.drawImage(image, x * scale, y * scale, w, h, 0, 0, w, h);
    const data = context.getImageData(0, 0, w, h).data;
    const luma = (column: number, row: number) => { const at = (row * w + column) * 4; return 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]; };
    // The columns are read over the empty band between the tile's two dividers, where no text or icon falls near the fold.
    const from = Math.round(h * 0.46), to = Math.round(h * 0.56);
    const columns = Array.from({ length: w }, (_, column) => { let sum = 0; for (let row = from; row < to; row += 1) sum += luma(column, row); return sum / (to - from); });
    // The row of the tile's first divider: the strongest horizontal edge in its upper half, in a few columns on one side.
    const edgeRow = (start: number, end: number) => {
      let best = 0, bestScore = -1;
      for (let row = 3; row < Math.round(h * 0.5); row += 1) {
        let score = 0;
        for (let column = start; column < end; column += 1) score += Math.abs(luma(column, row) - (luma(column, row - 3) + luma(column, row + 3)) / 2);
        if (score > bestScore) { bestScore = score; best = row; }
      }
      return best;
    };
    const mid = w / 2;
    return { scale, columns, left: edgeRow(mid - 16 * scale, mid - 6 * scale) / scale, right: edgeRow(mid + 6 * scale, mid + 16 * scale) / scale };
  }, { png, x, y, width, height });
  const n = read.columns.length, edge = Math.round(20 * read.scale), around = Math.round(6 * read.scale);
  const side = (read.columns.slice(0, edge).reduce((a, b) => a + b, 0) + read.columns.slice(n - edge).reduce((a, b) => a + b, 0)) / (2 * edge);
  // A line is a jump from one column to the next; a falloff changes by a fraction of a level per column.
  const step = Math.max(...read.columns.slice(1).map((value, at) => Math.abs(value - read.columns[at])));
  const centre = Math.min(...read.columns.slice(n / 2 - around, n / 2 + around));
  note(`oneSurface-${label}`, { deviceScale: read.scale, sideLuma: Number(side.toFixed(1)), darkestCentreLuma: Number(centre.toFixed(1)), ratio: Number((centre / side).toFixed(3)), largestColumnStep: Number(step.toFixed(2)), dividerRows: [read.left, read.right] });
  // The crease may fall to 16% black on its centre line (the wallpaper's own gradient adds a little) and no further, and nowhere in one step.
  expect(centre / side).toBeGreaterThanOrEqual(0.75);
  expect(step, 'no line on the hinge').toBeLessThanOrEqual(1.5);
  expect(Math.abs(read.left - read.right), 'the divider continues across the fold').toBeLessThanOrEqual(1);
}

/** The document is dark whichever scheme the browser asks for: only the Studio chrome changes. */
for (const scheme of ['dark', 'light'] as const) {
  test(`partly folded is one surface: no line, no seam and no offset across the fold on the wide tile (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await oneSurface(page, scheme);
  });
}

// The owner's view: a hardware renderer at 2x, where an antialiased layer edge is most likely to show a hairline.
test.describe('at device scale 2', () => {
  test.use({ deviceScaleFactor: 2 });
  test('partly folded is one surface at 2x', async ({ page }) => {
    await oneSurface(page, `2x${process.env.STUDIO_E2E_GPU ? '-gpu' : ''}`);
  });
});

/**
 * Tabbing never reaches an `aria-hidden` copy, during a fold or after it, and a node that moves with no change to the tree (an inline style
 * only) hands its tab stop to the copy that now shows it. Looped under load on the software renderer to catch a late layout.
 */
test('tabbing during and after a fold never lands in a hidden copy, and a style-only move hands the stop to the other copy', async ({ page }) => {
  await startDuo(page);
  await page.getByTestId('simulator-rail').getByRole('button', { name: 'Partly Folded', exact: true }).click();
  const probe = async (label: string) => {
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null, inRig = Boolean(active?.closest('[data-preview-root] .sh-rig'));
        return { inRig, hidden: Boolean(active?.closest('[aria-hidden=true]')), scrolled: [...document.querySelectorAll('[data-preview-root] .sh-clip')].some(element => element.scrollTop !== 0 || element.scrollLeft !== 0) };
      });
      expect(state.scrolled, `${label} step ${step}: a clip scrolled`).toBe(false);
      if (state.inRig) expect(state.hidden, `${label} step ${step}: focus is in a hidden copy`).toBe(false);
    }
  };
  // Straight after the click, while the halves tilt and the second copy mounts.
  await probe('during the fold');
  await rigSettled(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await probe('after the fold');
  // A style-only move: shift a leaf node in the first copy and its twin by 300 px with no change to the tree, then ask who owns it.
  const owners = await page.evaluate(async () => {
    const [a, b] = [...document.querySelectorAll('[data-preview-root] .sh-rig:not([data-frozen]) [data-copy]')];
    const leaf = [...a.querySelectorAll('[data-sel]')].find(node => !node.querySelector('[data-sel]') && node.querySelector('button, a[href]'));
    if (!leaf) return undefined;
    const hidden = (element: Element) => element.hasAttribute('aria-hidden');
    const path: number[] = []; for (let at: Element | null = leaf; at && at !== a; at = at.parentElement) path.unshift([...at.parentElement!.children].indexOf(at));
    const twin = path.reduce<Element | null>((node, index) => node?.children[index] ?? null, b);
    if (!twin) return undefined;
    const settle = () => new Promise(resolve => setTimeout(resolve, 120));
    const before = [hidden(leaf), hidden(twin)];
    // Which half shows a node is where its centre is: move both by a clip's width so the owner swaps.
    const shift = (element: HTMLElement, by: number) => { element.style.position = 'relative'; element.style.left = `${by}px`; };
    const clip = a.closest('.sh-clip')!.getBoundingClientRect();
    shift(leaf as HTMLElement, clip.width); shift(twin as HTMLElement, clip.width);
    await settle();
    return { before, after: [hidden(leaf), hidden(twin)] };
  });
  expect(owners, 'a leaf node with a control exists').toBeDefined();
  expect(owners!.before[0] !== owners!.before[1], 'exactly one copy is hidden').toBe(true);
  expect(owners!.after[0] !== owners!.after[1], 'exactly one copy is hidden after the move').toBe(true);
  expect(owners!.after, 'ownership swapped with no change to the tree').not.toEqual(owners!.before);
  await probe('after a style-only move');
});
