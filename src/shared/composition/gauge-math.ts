/**
 * Where the parts of a `linear-gauge` (`sh.linear-gauge@1`) stand: a rail with a track, an optional span and an optional marker. It is the app's hand-drawn
 * rail (`UKWeatherRailView.applyFrames`, `apple/Sources/HassUI/UIKitPort/Features/Home/UKWeatherViews.swift:178-205`, read 2026-11-16) made generic, and the
 * numbers a document hands it are the ones `WeatherRails` computes (`apple/Sources/HassCore/Weather/WeatherRails.swift:7-38`, tested at
 * `apple/Tests/HassCoreTests/WeatherHighlightsTests.swift:146-170`): the share of the week's range a day covers, and where the current value sits in it.
 * A document builds those shares from operands (`math` `scale` and `clamp`, a rule for the flat case); this module only places them. The shared
 * evaluation corpus (`contract/corpus/evaluation/gauge-*.json`) pins both halves with the native tests' numbers.
 *
 * - A value is a share of the track from 0 to 1, or from 0 to 100 when the gauge says `percent`; one outside it is held at the nearest end, one that is not
 *   a number is 0 (`clamp`, `:190`).
 * - A `scale` gauge colours the whole track; a `span` gauge colours only the span, which is held inside the track (`size` at most `100 - start`) and not
 *   drawn when it is empty (`:192-198`).
 * - The marker is a circle of `markerSize` points kept wholly inside the track; with no value there is none (`:199-205`, `marker.alpha = 0`).
 * - A right-to-left layout mirrors every position (`x(origin, length)`, `:195`).
 */
import { roundedAxisValue } from './chart-math';

/** How a value is read: a share of 0 to 1, or of 0 to 100. */
export type GaugeScale = 'unit' | 'percent';
/** What a gauge needs to place its parts. A `null` or missing value is "not known". */
export interface GaugeInput {
  /** `unit` (the default) or `percent`. */
  scale?: GaugeScale;
  value?: number | null;
  /** Where the span starts and how long it is, in the same scale. */
  span?: { start?: number | null; size?: number | null };
  /** `scale`: the whole track is coloured; `span`: only the span. */
  fill: 'scale' | 'span';
  /** The track's width in points. */
  width: number;
  /** The marker's diameter in points. */
  markerSize: number;
  /** Mirrors the positions. */
  rtl?: boolean;
}
/** The span as drawn: shares of the track and where it sits in points from the left edge. */
export interface GaugeSpan { startPercent: number; sizePercent: number; left: number; width: number }
/** The marker as drawn: its share of the track and where its left edge sits in points. */
export interface GaugeMarker { percent: number; left: number }
/** The parts of a gauge, or `null` for a part that is not drawn. */
export interface GaugeLayout { span: GaugeSpan | null; marker: GaugeMarker | null }

/** A reading as a share of the track from 0 to 100. Not a number is 0; the result is held between the ends. */
export function gaugePercent(value: number | null | undefined, scale: GaugeScale = 'unit'): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  const percent = scale === 'unit' ? roundedAxisValue(value * 100) : value;
  return Math.min(100, Math.max(0, percent));
}

/** Places the span and the marker of a gauge. */
export function layoutGauge(input: GaugeInput): GaugeLayout {
  const { fill, width, markerSize, rtl = false, scale = 'unit' } = input;
  const mirror = (origin: number, length: number) => rtl ? width - origin - length : origin;
  let span: GaugeSpan | null = null;
  const startPercent = fill === 'scale' ? 0 : gaugePercent(input.span?.start, scale);
  const sizePercent = fill === 'scale' ? 100 : Math.min(gaugePercent(input.span?.size, scale), 100 - startPercent);
  if (sizePercent > 0) {
    const length = width * sizePercent / 100;
    span = { startPercent, sizePercent, left: mirror(width * startPercent / 100, length), width: length };
  }
  let marker: GaugeMarker | null = null;
  const value = input.value;
  if (value !== null && value !== undefined && Number.isFinite(value)) {
    const percent = gaugePercent(value, scale);
    const offset = Math.max(0, Math.min(width - markerSize, width * percent / 100 - markerSize / 2));
    marker = { percent, left: mirror(offset, markerSize) };
  }
  return { span, marker };
}
