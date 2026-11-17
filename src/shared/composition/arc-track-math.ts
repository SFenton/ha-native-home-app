/**
 * Where the parts of an `arc-track` (`sh.arc-track@1`) stand: a quadratic curve in a box, an optional horizon line, and a marker that moves along the curve
 * with progress. It is the app's daylight arc made generic (`UKWeatherSunArcView`, `apple/Sources/HassUI/UIKitPort/Features/Home/UKWeatherViews.swift:536-590`,
 * read 2026-11-16): a 100 by 48 box capped at 200 points wide, a dashed curve from (8, 40) via (50, 4) to (92, 40), a horizon from (4, 40) to (96, 40), a marker of
 * 10 points. The shared evaluation corpus (`contract/corpus/evaluation/arc-track-*.json`) pins this module with the native test numbers
 * (`apple/Tests/HassCoreTests/WeatherPresentationTests.swift:148-153`, `sunArcMarker`).
 *
 * - The arc is as wide as the room allows up to `maxWidth`, and as tall as the box's shape gives (`min(width, 200) * 48 / 100`, `:547`). Positions scale with
 *   the width; line widths, dashes and the marker's size do not (they are points, `:566-580`).
 * - Progress is a share of the curve from 0 to 1 (`unit`) or 0 to 100 (`percent`); outside it is held at the nearest end (`clampPercent`,
 *   `WeatherPresentation.swift:10`), and one that is not a number hides the marker (`if let percent`, `:576`).
 * - The marker stands on the curve at parameter t: `B(t) = (1-t)^2 from + 2t(1-t) control + t^2 to`. For the app's curve that is `x = 8 + 84t`,
 *   `y = 40 - 72 t (1-t)` (`sunArcMarker`, `WeatherPresentation.swift:267-270`).
 * - Progress runs from the curve's `from` end to its `to` end, the reading direction: a right-to-left layout mirrors it, unless the document says `mirrors: false`
 *   (the sun's east to west is a reading of progress, not a fixed place).
 */

/** How progress is read: a share of 0 to 1, or of 0 to 100. */
export type ArcScale = 'unit' | 'percent';
/** A point in the box, `[x, y]`. */
export type ArcPoint = [number, number];
/** What an arc needs to place its parts. */
export interface ArcInput {
  /** The curve's end, control and end points, in the box's own units. */
  curve: { from: ArcPoint; control: ArcPoint; to: ArcPoint };
  /** The box's width and height in its own units: it sets the shape. */
  box: [number, number];
  /** The most the arc is wide, in points. Absent: the room it has. */
  maxWidth?: number;
  /** The horizon line's ends, in the box's own units. */
  horizon?: { from: ArcPoint; to: ArcPoint };
  /** The width the arc has to fill, in points. */
  width: number;
  /** Progress along the curve; not known when `null` or missing. */
  progress?: number | null;
  scale?: ArcScale;
  /** Mirrors the positions for a right-to-left layout. Absent: it does. */
  mirrors?: boolean;
  rtl?: boolean;
}
/** The parts of an arc in points from its top left. A part that is not drawn is `null`. */
export interface ArcLayout {
  width: number; height: number;
  curve: { from: ArcPoint; control: ArcPoint; to: ArcPoint };
  horizon: { from: ArcPoint; to: ArcPoint } | null;
  /** The marker's centre and its parameter on the curve, from 0 to 1. */
  marker: { x: number; y: number; t: number } | null;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000 + 0;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

/** Progress as a parameter on the curve, 0 to 1, or `null` when it is not a number. */
export function arcProgress(value: number | null | undefined, scale: ArcScale = 'unit'): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const share = scale === 'unit' ? value : value / 100;
  return Math.min(1, Math.max(0, share));
}

/** The point at parameter `t` of a quadratic curve. */
export function curvePoint(curve: ArcInput['curve'], t: number): ArcPoint {
  const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
  return [a * curve.from[0] + b * curve.control[0] + c * curve.to[0], a * curve.from[1] + b * curve.control[1] + c * curve.to[1]];
}

/** Places the curve, the horizon and the marker of an arc. */
export function layoutArc(input: ArcInput): ArcLayout {
  const { box, curve } = input;
  const drawWidth = Math.min(input.width, input.maxWidth ?? Infinity);
  const scale = drawWidth / box[0];
  const mirrored = (input.mirrors ?? true) && Boolean(input.rtl);
  const place = ([x, y]: ArcPoint): ArcPoint => [round4((mirrored ? box[0] - x : x) * scale), round4(y * scale)];
  const t = arcProgress(input.progress, input.scale);
  let marker: ArcLayout['marker'] = null;
  if (t !== null) {
    const [x, y] = place(curvePoint(curve, t));
    marker = { x, y, t: round6(t) };
  }
  return {
    width: round4(drawWidth), height: round4(box[1] * scale),
    curve: { from: place(curve.from), control: place(curve.control), to: place(curve.to) },
    horizon: input.horizon ? { from: place(input.horizon.from), to: place(input.horizon.to) } : null,
    marker,
  };
}
