import { describe, expect, it } from 'vitest';
import { curvePoint, layoutArc, arcProgress, type ArcInput } from '../src/shared/composition/arc-track-math';
import { dialAngle, dialShare, isFullTurn, labelFontSize, layoutDial, nextTurn, normalizeDegrees, shortestTurn, tickShare } from '../src/shared/composition/dial-math';

/** The dial and arc arithmetic beyond what the evaluation corpus pins: properties that hold for every input, and the edges the cases do not name. */
describe('dial angles and shares', () => {
  it('holds every share of a partial sweep in 0 to 1, and wraps every share of a full turn into [0, 1)', () => {
    for (let value = -3; value <= 3; value += 0.173) {
      const held = dialShare(value, 'unit', { start: 145, length: 250 })!;
      expect(held).toBeGreaterThanOrEqual(0);
      expect(held).toBeLessThanOrEqual(1);
      const wrapped = dialShare(value, 'unit', { start: -90, length: 360 })!;
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(1);
    }
  });
  it('reads the three scales as the same share', () => {
    const sweep = { start: -90, length: 360 };
    expect(dialShare(0.25, 'unit', sweep)).toBeCloseTo(dialShare(25, 'percent', sweep)!, 12);
    expect(dialShare(90, 'degrees', sweep)).toBeCloseTo(dialShare(0.25, 'unit', sweep)!, 12);
  });
  it('gives no share for anything that is not a finite number', () => {
    for (const value of [null, undefined, Number.NaN, Infinity, -Infinity]) expect(dialShare(value as number, 'unit', { start: 0, length: 90 })).toBeNull();
  });
  it('is on its start at share 0 and its end at share 1, mirrored or not', () => {
    expect(dialAngle(0, { start: 145, length: 250 })).toBe(145);
    expect(dialAngle(1, { start: 145, length: 250 })).toBe(395);
    expect(dialAngle(0, { start: 145, length: 250 }, true)).toBe(35);
    expect(dialAngle(1, { start: 145, length: 250 }, true)).toBe(-215);
  });
  it('spreads ticks over a partial sweep with both ends drawn, and over a full turn with the last one short of the first', () => {
    expect(tickShare(0, 49, { start: 145, length: 250 })).toBe(0);
    expect(tickShare(48, 49, { start: 145, length: 250 })).toBe(1);
    expect(tickShare(0, 48, { start: -90, length: 360 })).toBe(0);
    expect(tickShare(47, 48, { start: -90, length: 360 })).toBeCloseTo(47 / 48, 12);
    expect(isFullTurn({ start: 0, length: 360 })).toBe(true);
    expect(isFullTurn({ start: 0, length: 359 })).toBe(false);
  });
  it('sizes a letter at a fifth of the radius, never below 10', () => {
    expect(labelFontSize(100)).toBe(20);
    expect(labelFontSize(10)).toBe(10);
  });
});

describe('turning the short way', () => {
  it('gives a delta in (-180, 180] for every pair of angles, and lands on the target', () => {
    for (let from = -400; from <= 400; from += 37) for (let to = -400; to <= 400; to += 41) {
      const delta = shortestTurn(from, to);
      expect(delta).toBeGreaterThan(-180);
      expect(delta).toBeLessThanOrEqual(180);
      expect(normalizeDegrees(from + delta)).toBeCloseTo(normalizeDegrees(to), 9);
    }
  });
  it('keeps a needle that is fed a run of headings within half a turn of each step, however far it has wound', () => {
    let angle: number | null = null;
    for (const heading of [350, 10, 30, 350, 10, 200, 20, 340, 0, 359, 1]) {
      const next: number = nextTurn(angle, heading);
      if (angle !== null) expect(Math.abs(next - angle)).toBeLessThanOrEqual(180);
      expect(normalizeDegrees(next)).toBeCloseTo(normalizeDegrees(heading), 9);
      angle = next;
    }
  });
});

describe('the dial layout', () => {
  const sweep = { start: 145, length: 250 };
  it('puts every tick between its inner and outer radius, and draws none of those it is told to skip', () => {
    const layout = layoutDial({ width: 200, sweep, ticks: { count: 13, inner: 0.5, outer: 0.9, width: 1, skip: [2, 5] } });
    expect(layout.ticks).toHaveLength(11);
    for (const tick of layout.ticks) {
      expect(Math.hypot(tick.x1 - layout.cx, tick.y1 - layout.cy)).toBeCloseTo(50, 3);
      expect(Math.hypot(tick.x2 - layout.cx, tick.y2 - layout.cy)).toBeCloseTo(90, 3);
    }
  });
  it('alternates the inner end of every second tick', () => {
    const layout = layoutDial({ width: 200, sweep: { start: -90, length: 360 }, ticks: { count: 12, inner: 0.8, outer: 0.92, width: 1, alternate: { inner: 0.85 } } });
    layout.ticks.forEach((tick, index) => expect(Math.hypot(tick.x1 - 100, tick.y1 - 100)).toBeCloseTo(index % 2 === 1 ? 85 : 80, 3));
  });
  it('mirrors a sweep about the vertical axis in a right-to-left layout, and only when asked', () => {
    const base = { width: 140, sweep, ticks: { count: 9, inner: 0.7, outer: 0.9, width: 1 } };
    const plain = layoutDial(base).ticks, flipped = layoutDial({ ...base, mirrors: true, rtl: true }).ticks;
    plain.forEach((tick, index) => {
      const other = flipped[index];
      expect(other.x1).toBeCloseTo(140 - tick.x1, 3);
      expect(other.y1).toBeCloseTo(tick.y1, 3);
    });
    expect(layoutDial({ ...base, rtl: true }).ticks).toEqual(plain);
    expect(layoutDial({ ...base, mirrors: true }).ticks).toEqual(plain);
  });
  it('is as tall as its aspect says, with its centre where centerY puts it', () => {
    const layout = layoutDial({ width: 140, aspect: 1.4, centerY: 0.56, sweep });
    expect([layout.height, layout.cx, layout.cy, layout.radius]).toEqual([100, 70, 56, 70]);
    const square = layoutDial({ width: 90, sweep });
    expect([square.height, square.cy]).toEqual([90, 45]);
  });
  it('draws a letter that needs a value only when the pointer has one', () => {
    const labels = [{ at: 0, text: 'N' }, { at: 0.25, text: 'E', needsValue: true }];
    const input = { width: 100, sweep: { start: -90, length: 360 }, scale: 'degrees' as const, labels };
    expect(layoutDial({ ...input, pointer: { kind: 'needle', value: 10 } }).labels.map(label => label.text)).toEqual(['N', 'E']);
    expect(layoutDial({ ...input, pointer: { kind: 'needle', value: null } }).labels.map(label => label.text)).toEqual(['N']);
    expect(layoutDial({ ...input }).labels.map(label => label.text)).toEqual(['N']);
  });
  it('lights a tick that is one of the ring when the pointer is on a tick of it', () => {
    const ring = { count: 49, inner: 0.78, outer: 0.92, width: 1 };
    const layout = layoutDial({ width: 140, aspect: 1.4, centerY: 0.56, sweep, ticks: ring, pointer: { kind: 'tick', value: 0.25, inner: 0.78, outer: 0.92, width: 1 } });
    expect(layout.ticks).toContainEqual(layout.lit);
  });
  it('never gives a negative zero', () => {
    const layout = layoutDial({ width: 100, sweep: { start: -90, length: 360 }, ticks: { count: 4, inner: 0.5, outer: 1, width: 1 } });
    for (const tick of layout.ticks) for (const value of Object.values(tick)) expect(Object.is(value, -0)).toBe(false);
  });
});

describe('the arc layout', () => {
  const native: ArcInput = { curve: { from: [8, 40], control: [50, 4], to: [92, 40] }, box: [100, 48], maxWidth: 200, width: 100 };
  it('puts the marker on the closed form of the app\'s curve at every share, to four places', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const marker = layoutArc({ ...native, progress: t })!.marker!;
      expect(marker.x).toBeCloseTo(8 + 84 * t, 3);
      expect(marker.y).toBeCloseTo(40 - 72 * t * (1 - t), 3);
    }
  });
  it('starts the curve and ends it at its end points', () => {
    expect(curvePoint(native.curve, 0)).toEqual([8, 40]);
    expect(curvePoint(native.curve, 1)).toEqual([92, 40]);
  });
  it('mirrors every position in a right-to-left layout, the marker included, and keeps its height', () => {
    for (const t of [0, 0.2, 0.5, 0.9]) {
      const a = layoutArc({ ...native, progress: t }).marker!, b = layoutArc({ ...native, progress: t, rtl: true }).marker!;
      expect(b.x).toBeCloseTo(100 - a.x, 3);
      expect(b.y).toBeCloseTo(a.y, 3);
    }
  });
  it('scales positions with the width and caps the width at the widest', () => {
    const wide = layoutArc({ ...native, width: 150, progress: 0.5 }), capped = layoutArc({ ...native, width: 500, progress: 0.5 });
    expect(wide.marker).toMatchObject({ x: 75, y: 33 });
    expect([capped.width, capped.height]).toEqual([200, 96]);
  });
  it('has no marker for no progress, and holds a progress past the ends', () => {
    expect(layoutArc({ ...native, progress: null }).marker).toBeNull();
    expect(layoutArc({ ...native, progress: undefined }).marker).toBeNull();
    expect(arcProgress(5)).toBe(1);
    expect(arcProgress(-5)).toBe(0);
    expect(arcProgress(Number.NaN)).toBeNull();
    expect(arcProgress(50, 'percent')).toBe(0.5);
  });
});
