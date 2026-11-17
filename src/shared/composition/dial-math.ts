/**
 * Where the parts of a `dial` (`sh.dial@1`) stand: a circular gauge with ticks on an arc, a few letters round the rim, and a pointer (one lit tick, or the one
 * closed needle style) at a value. It is the app's two hand-drawn dials made generic: the barometer (`UKWeatherPressureGaugeView`, 49 ticks over a 250 degree
 * sweep from 145 degrees, one tick lit) and the compass (`UKWeatherCompassView`, 48 ticks, a north flag, four letters and an arrow needle), both in
 * `apple/Sources/HassUI/UIKitPort/Features/Home/UKWeatherViews.swift` (compass `:306-440`, needle `:310-340`, gauge `:442-527`, read 2026-11-16). The numbers a
 * document hands it are the ones `WeatherPresentation` computes (`apple/Sources/HassCore/Weather/WeatherPresentation.swift:10-22,199-212`): a pressure as a
 * share of 970 to 1050 hPa, a wind bearing in degrees. The shared evaluation corpus (`contract/corpus/evaluation/dial-*.json`) pins this module with the native
 * tests' numbers (`apple/Tests/HassCoreTests/WeatherPresentationTests.swift:85-116`).
 *
 * - Angles are degrees, clockwise on screen from 3 o'clock (UIKit's y axis points down, so `cos` is x and `sin` is y): a sweep `start` of 145 is lower left,
 *   270 (or -90) is the top (`UKWeatherViews.swift:480-486`).
 * - A value is a share of the sweep from 0 to 1 (`unit`), 0 to 100 (`percent`) or, on a full turn, degrees (`degrees`, 0 to 360). A share outside the sweep
 *   is held at the nearest end (`min(100, max(0, percent))`, `:482`); on a full turn it wraps instead, as a bearing does
 *   (`normalizeBearingDegrees`, `WeatherPresentation.swift:13-16`). A value that is not a number gives no pointer.
 * - Ticks stand at `i / (count - 1)` of the sweep, both ends drawn (`index / 48`, `:497`); on a full turn at `i / count`, so the last does not repeat the first
 *   (`index * (2 pi / 48)`, `:419`). The radius is half the width; the centre is `centerY` of the height (0.56 for the barometer, `:493`).
 * - A needle turns the short way round when the sweep is a full turn (`shortestBearingDelta`, `WeatherPresentation.swift:19-22`).
 * - A direction is not mirrored by default: a compass and a dial are instruments in space. `mirrors` flips the sweep about the vertical axis for a right-to-left
 *   layout.
 */

/** How a pointer's value is read: a share of 0 to 1, of 0 to 100, or degrees of a full turn. */
export type DialScale = 'unit' | 'percent' | 'degrees';
/** The arc the ticks and the pointer travel: its first angle and how far it goes, in degrees. */
export interface DialSweep { start: number; length: number }
/** One ring of tick marks. `alternate.inner` is the inner radius of every second tick (the odd ones); `skip` lists tick indexes that are not drawn. */
export interface DialTicks { count: number; inner: number; outer: number; width: number; alternate?: { inner: number }; skip?: number[] }
/** The pointer: a lit tick across the ticks' ring, or the needle. `value` is not known when it is `null`. */
export type DialPointer =
  | { kind: 'tick'; value?: number | null; inner: number; outer: number; width: number }
  | { kind: 'needle'; value?: number | null };
/** A letter round the rim: its place along the sweep (0 to 1), and whether it is drawn only while the pointer has a value. */
export interface DialLabel { at: number; text: string; needsValue?: boolean }
/** What a dial needs to place its parts. */
export interface DialInput {
  /** The dial's width in points. */
  width: number;
  /** Width over height (default 1). */
  aspect?: number;
  /** Where the centre sits down the height, 0 to 1 (default 0.5). */
  centerY?: number;
  sweep: DialSweep;
  scale?: DialScale;
  ticks?: DialTicks;
  pointer?: DialPointer;
  labels?: DialLabel[];
  /** A triangle on the rim at this place along the sweep. */
  flag?: { at: number };
  /** Flips the sweep for a right-to-left layout (`mirrors`) when `rtl`. */
  mirrors?: boolean;
  rtl?: boolean;
}
/** A line from `(x1, y1)` to `(x2, y2)`, in points from the dial's top left. */
export interface DialSegment { x1: number; y1: number; x2: number; y2: number }
/** The parts of a dial, in points from its top left. A part that is not drawn is `null`. */
export interface DialLayout {
  width: number; height: number; cx: number; cy: number; radius: number;
  ticks: DialSegment[];
  /** The lit tick of a `tick` pointer. */
  lit: DialSegment | null;
  /** The needle's turn in degrees about the centre (0 is the head down, the dot up), for a `needle` pointer. */
  needle: { rotation: number; angle: number } | null;
  labels: { text: string; x: number; y: number; fontSize: number }[];
  /** The flag's three corners. */
  flag: { x: number; y: number }[] | null;
  /** The pointer's share of the sweep, 0 to 1. */
  share: number | null;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000 + 0;

/** `value` modulo 360 into `0..<360` (`normalizeBearingDegrees`, `WeatherPresentation.swift:13-16`). */
export function normalizeDegrees(value: number): number {
  const remainder = value % 360;
  return (remainder + 360) % 360;
}
/** The signed shortest rotation from one angle to another, in `(-180, 180]` (`shortestBearingDelta`, `WeatherPresentation.swift:19-22`). */
export function shortestTurn(from: number, to: number): number {
  const delta = ((normalizeDegrees(to) - normalizeDegrees(from) + 540) % 360) - 180;
  return delta <= -180 ? 180 : delta;
}
/**
 * The angle a needle is turned to next so it turns the short way round: from where it is (`previous`, unwrapped, or `null` for the first draw) to `target`.
 * A 350 to 10 change is 20 degrees on, not 340 back (`UKWeatherCompassView.update`, `UKWeatherViews.swift:365-370`).
 */
export function nextTurn(previous: number | null, target: number): number {
  return previous === null ? target : previous + shortestTurn(previous, target);
}

/** Whether a sweep is a whole turn: its ends meet, so a value wraps instead of being held. */
export const isFullTurn = (sweep: DialSweep): boolean => sweep.length >= 360;

/** A value as a share of the sweep from 0 to 1, or `null` when it is not a number. Held at the ends, or wrapped on a full turn. */
export function dialShare(value: number | null | undefined, scale: DialScale, sweep: DialSweep): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const share = scale === 'unit' ? value : scale === 'percent' ? value / 100 : value / 360;
  return isFullTurn(sweep) ? ((share % 1) + 1) % 1 : Math.min(1, Math.max(0, share));
}

/** The angle at a share of the sweep, mirrored about the vertical axis when asked: `start + share * length` (`145 + percent / 100 * 250`, `:482`). */
export function dialAngle(share: number, sweep: DialSweep, mirrored = false): number {
  const angle = sweep.start + share * sweep.length;
  return mirrored ? 180 - angle : angle;
}

/** The place of tick `index` of `count` along the sweep, 0 to 1. */
export function tickShare(index: number, count: number, sweep: DialSweep): number {
  return isFullTurn(sweep) ? index / count : index / (count - 1);
}

/** The font size of a letter round the rim: a fifth of the radius, at least 10 points (`max(10, radius * 0.2)`, `UKWeatherViews.swift:395`). */
export const labelFontSize = (radius: number): number => Math.max(10, radius * 0.2);
/** How far from the centre a letter stands, as a share of the radius (`:341`). */
export const LABEL_RADIUS = 0.58;
/** The flag on the rim: its tip and base as shares of the radius, and half its base (`UKCompassTicksView.draw`, `:426-431`). */
export const FLAG = { tip: 0.94, base: 0.84, half: 0.06 } as const;
/**
 * The needle: a closed shape drawn at 0 turn in a square as wide as the dial, as shares of that square (`UKWindNeedleView.draw`, `:318-336`). The head is the
 * triangle that points down, the tail the narrower quad above the centre, the dot sits on top.
 */
export const NEEDLE = {
  head: [[0.45, 0.5], [0.55, 0.5], [0.5, 0.74]], tail: [[0.45, 0.5], [0.55, 0.5], [0.52, 0.32], [0.48, 0.32]], dot: { at: [0.5, 0.29], size: 0.07 },
} as const;

/** Places every part of a dial. */
export function layoutDial(input: DialInput): DialLayout {
  const { width, sweep, scale = 'unit' } = input;
  const aspect = input.aspect ?? 1, centerY = input.centerY ?? 0.5;
  const mirrored = Boolean(input.mirrors && input.rtl);
  const height = width / aspect;
  const radius = width / 2, cx = width / 2, cy = height * centerY;
  const at = (angle: number, share: number) => {
    const radians = angle * Math.PI / 180;
    return { x: cx + Math.cos(radians) * radius * share, y: cy + Math.sin(radians) * radius * share };
  };
  const segment = (angle: number, inner: number, outer: number): DialSegment => {
    const from = at(angle, inner), to = at(angle, outer);
    return { x1: round4(from.x), y1: round4(from.y), x2: round4(to.x), y2: round4(to.y) };
  };
  const ticks: DialSegment[] = [];
  if (input.ticks) {
    const { count, inner, outer, alternate, skip = [] } = input.ticks;
    for (let index = 0; index < count; index += 1) {
      if (skip.includes(index)) continue;
      ticks.push(segment(dialAngle(tickShare(index, count, sweep), sweep, mirrored), alternate && index % 2 === 1 ? alternate.inner : inner, outer));
    }
  }
  const pointer = input.pointer;
  const share = pointer ? dialShare(pointer.value, scale, sweep) : null;
  let lit: DialSegment | null = null, needle: DialLayout['needle'] = null;
  if (pointer && share !== null) {
    const angle = dialAngle(share, sweep, mirrored);
    if (pointer.kind === 'tick') lit = segment(angle, pointer.inner, pointer.outer);
    else needle = { rotation: round4(angle + 90), angle: round4(angle) };
  }
  const fontSize = labelFontSize(radius);
  const labels = (input.labels ?? []).filter(label => !label.needsValue || share !== null).map(label => {
    const place = at(dialAngle(label.at, sweep, mirrored), LABEL_RADIUS);
    return { text: label.text, x: round4(place.x), y: round4(place.y), fontSize: round4(fontSize) };
  });
  let flag: DialLayout['flag'] = null;
  if (input.flag) {
    const angle = dialAngle(input.flag.at, sweep, mirrored), radians = angle * Math.PI / 180;
    // The base corners sit either side of the radius, along its normal.
    const base = at(angle, FLAG.base), nx = -Math.sin(radians) * radius * FLAG.half, ny = Math.cos(radians) * radius * FLAG.half;
    const tip = at(angle, FLAG.tip);
    flag = [{ x: round4(tip.x), y: round4(tip.y) }, { x: round4(base.x + nx), y: round4(base.y + ny) }, { x: round4(base.x - nx), y: round4(base.y - ny) }];
  }
  return { width: round4(width), height: round4(height), cx: round4(cx), cy: round4(cy), radius: round4(radius), ticks, lit, needle, labels, flag, share };
}
