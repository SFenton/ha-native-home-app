/**
 * The arithmetic of a `chart` (`sh.chart@1`): the axis a series gets, where its marks stand, which labels fit and what a screen reader says. All of it is
 * the app's hand-drawn precipitation and hourly charts made generic, so each rule cites the native source it ports (paths under `apple/` of the native
 * repository, read 2026-11-16) and the shared evaluation corpus (`contract/corpus/evaluation/chart-*.json`) pins it with the native tests' own numbers.
 * The preview draws with these functions and the app's chart view must agree with them.
 *
 * - `ceilingDomain`: `WeatherPrecipitationTimeline.chanceDomain` (`Sources/HassCore/Weather/WeatherPrecipitationTimeline.swift:40-44`), tested by
 *   `Tests/HassCoreTests/WeatherChartMathTests.swift:70-76`.
 * - `twoStepDomain`: `WeatherPrecipitationTimeline.amountAxis` (`WeatherPrecipitationTimeline.swift:65-91`), tested at `WeatherChartMathTests.swift:78-92`.
 * - `scaledPercent`: `WeatherPrecipitationTimeline.scaledPercent` (`WeatherPrecipitationTimeline.swift:47-50`), tested at `WeatherChartMathTests.swift:94-103`.
 * - `labelCadence` and `labelIndices`: `WeatherPrecipitationTimeline.swift:94-106`, tested at `WeatherChartMathTests.swift:59-68`.
 * - bar geometry and the unknown bar: `UKWeatherBarChartView.layoutSubviews` (`Sources/HassUI/UIKitPort/Features/Home/UKWeatherViews.swift:262-298`).
 * - the spoken series: `UKWeatherTiles.chance` and `.accumulation` (`Sources/HassUI/UIKitPort/Features/Home/UKWeatherSheet.swift:622-657`).
 */
import { roundHalfAwayFromZero } from './pipeline/text';

/** The factors a two-step axis tries at each power of ten, in order (`WeatherPrecipitationTimeline.swift:9`). */
export const AXIS_FACTORS: readonly number[] = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10];
const EPSILON = 1e-9;

/** A value rounded to `digits` places the way the app does for axis math: `.rounded()` (a tie goes away from zero) after nudging by one ulp (`:52-55`). */
export function roundedAxisValue(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return roundHalfAwayFromZero((value + Number.EPSILON) * factor) / factor;
}
/** Places after the point once trailing zeros are dropped, at most `maximumFractionDigits` looked at (`:57-62`). */
function decimalPlaces(value: number, maximumFractionDigits: number): number {
  let fixed = roundedAxisValue(value, maximumFractionDigits).toFixed(maximumFractionDigits);
  while (fixed.endsWith('0')) fixed = fixed.slice(0, -1);
  const dot = fixed.indexOf('.');
  return dot < 0 ? 0 : fixed.length - dot - 1;
}

/** The highest known value of a series, or `undefined` when none is known. */
export function peakOf(values: readonly (number | null)[]): number | undefined {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? Math.max(...known) : undefined;
}

/** The axis top of a `ceiling` domain: the peak rounded up to the next `step`, at least `min` and at most `max`; `min` when no value is known. */
export function ceilingDomain(peak: number | undefined, step: number, min: number, max: number): number {
  if (peak === undefined || !Number.isFinite(peak)) return min;
  const bounded = Math.min(max, Math.max(0, peak));
  return Math.min(max, Math.max(min, Math.ceil(bounded / step) * step));
}

/** What a two-step axis chose: its top, the step (the middle label) and the most fraction digits a label needs. */
export interface TwoStepAxis { domain: number; step: number; digits: number }
/**
 * A "nice" axis of two equal steps up to a top at least `total`: the smallest `factor * 10^n` step that is at least `total / 2` and `minimumStep`
 * and prints in at most `maximumFractionDigits` places. A total that is unknown, negative or not finite counts as 0.
 */
export function twoStepDomain(total: number | undefined, minimumStep: number, maximumFractionDigits: number, factors: readonly number[] = AXIS_FACTORS): TwoStepAxis {
  const bounded = total !== undefined && Number.isFinite(total) ? Math.max(0, total) : 0;
  const target = Math.max(minimumStep, bounded / 2);
  const start = Math.floor(Math.log10(target));
  for (let exponent = start - 1; exponent <= start + 12; exponent += 1) {
    const magnitude = 10 ** exponent;
    for (const factor of factors) {
      const step = roundedAxisValue(factor * magnitude);
      if (step + EPSILON < target || step + EPSILON < minimumStep) continue;
      const domain = roundedAxisValue(step * 2);
      const digits = Math.max(decimalPlaces(step, maximumFractionDigits + 2), decimalPlaces(domain, maximumFractionDigits + 2));
      if (digits > maximumFractionDigits) continue;
      return { domain, step, digits };
    }
  }
  const step = roundedAxisValue(target, maximumFractionDigits);
  return { domain: roundedAxisValue(step * 2, maximumFractionDigits), step, digits: maximumFractionDigits };
}

/** A value as a 0 to 100 share of the axis from `base` to `top`: unknown, or an axis with no height, is 0 (`:47-50`). Outside the axis it is clamped. */
export function scaledPercent(value: number | null | undefined, top: number, base = 0): number {
  if (value === null || value === undefined || !Number.isFinite(value) || !Number.isFinite(top) || !Number.isFinite(base) || top - base <= 0) return 0;
  return roundedAxisValue(Math.min(100, Math.max(0, (value - base) / (top - base) * 100)));
}

/** Every `cadence`-th label index, so the labels fit (`:94-98`). A cadence below 1 shows every label. */
export function labelIndices(count: number, cadence: number): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.trunc(cadence));
  return Array.from({ length: count }, (_, index) => index).filter(index => index % step === 0);
}
/**
 * How many marks apart labels sit (`:100-106`): the count over how many labels fit in the plot, each with a gap of 6 points. With no width or no label
 * width to go by it shows a quarter of them.
 */
export function labelCadence(count: number, plotWidth: number, widestLabelWidth: number, gap = 6): number {
  if (count <= 0) return 1;
  if (plotWidth <= 0 || widestLabelWidth <= 0) return Math.max(1, Math.ceil(count / 4));
  const capacity = Math.max(1, Math.floor(plotWidth / (widestLabelWidth + gap)));
  return Math.max(1, Math.ceil(count / capacity));
}

/** A number with up to `digits` fraction digits and `en-US` grouping, ties rounding up (`WeatherFormat.number`). */
export function axisNumber(value: number, digits: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}
/** An axis label or a spoken value: `pattern` with `{value}` replaced by the number. */
export function axisText(pattern: string, value: number, digits: number): string {
  return pattern.replace('{value}', axisNumber(value, digits));
}
/** The label of each axis level from the top down: `levels` of them, evenly from the top of the axis to its base (3 levels of a 100 axis: 100, 50, 0). */
export function axisLevels(levels: number, top: number, base = 0): number[] {
  return Array.from({ length: levels }, (_, index) => roundedAxisValue(top - (top - base) * index / (levels - 1)));
}

/** One mark as drawn: its slot, and for a bar its height in points. A value that is unknown is a short stub (`unknown`), never a bar of zero. */
export interface BarMark { index: number; x: number; width: number; height: number; unknown: boolean }
/**
 * The bars of a series in a plot `width` by `height` points: equal columns with `gap` between, each as tall as its share of the axis, never shorter than
 * `minimum` once it is above zero, and an unknown one `minimum` tall (`UKWeatherViews.swift:262-275`: columns `(width - 2 * (count - 1)) / count`, an
 * unknown bar 2 points, a known one `max(percent > 0 ? 2 : 0, height * percent / 100)`).
 */
export function barMarks(values: readonly (number | null)[], top: number, base: number, width: number, height: number, gap: number, minimum: number): BarMark[] {
  const count = Math.max(values.length, 1);
  const column = Math.max(0, (width - gap * (count - 1)) / count);
  return values.map((value, index) => {
    const unknown = value === null || !Number.isFinite(value);
    const percent = scaledPercent(value, top, base);
    return { index, x: index * (column + gap), width: column, height: unknown ? minimum : Math.max(percent > 0 ? minimum : 0, height * percent / 100), unknown };
  });
}
/** One point of a line or an area: the middle of its slot and its height above the base, or `null` where the value is unknown (the line breaks there). */
export interface PointMark { index: number; x: number; y: number | null }
/** The points of a series for a line: the middle of each of `count` equal slots across `width`, `y` measured from the top of a plot `height` points tall. */
export function pointMarks(values: readonly (number | null)[], top: number, base: number, width: number, height: number): PointMark[] {
  const count = Math.max(values.length, 1);
  return values.map((value, index) => ({
    index, x: (index + 0.5) * width / count,
    y: value === null || !Number.isFinite(value) ? null : height - height * scaledPercent(value, top, base) / 100,
  }));
}

/** What a screen reader says for a series: each label and its value, in order, `"Now 94%, 7 PM 40%"`; a value that is unknown says `unknownText` (`UKWeatherSheet.swift:622-657`). */
export function seriesText(points: readonly { label: string; value: number | null }[], pattern: string, digits: number, unknownText: string): string {
  return points.map(point => `${point.label} ${point.value === null || !Number.isFinite(point.value) ? unknownText : axisText(pattern, point.value, digits)}`).join(', ');
}
