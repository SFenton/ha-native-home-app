import { describe, expect, it } from 'vitest';
import {
  axisLevels, axisNumber, axisText, barMarks, ceilingDomain, labelCadence, labelIndices, peakOf, pointMarks, roundedAxisValue, scaledPercent, seriesText, twoStepDomain,
} from '../src/shared/composition/chart-math';
import { gaugePercent, layoutGauge } from '../src/shared/composition/gauge-math';

/** The chart and gauge arithmetic beyond what the evaluation corpus pins: properties that hold for every input, and the edges the cases do not name. */
describe('chart axis arithmetic', () => {
  it('rounds a share the way the app does: one ulp up first, then a tie goes away from zero', () => {
    expect(roundedAxisValue(0.0000005)).toBe(0.000001);
    expect(roundedAxisValue(2.5, 0)).toBe(3);
    expect(roundedAxisValue(-2.5, 0)).toBe(-3);
    expect(roundedAxisValue(1 / 3)).toBe(0.333333);
  });
  it('finds the peak of the known values only', () => {
    expect(peakOf([null, 3, 9, null])).toBe(9);
    expect(peakOf([null, null])).toBeUndefined();
    expect(peakOf([])).toBeUndefined();
    expect(peakOf([Number.NaN, 2])).toBe(2);
  });
  it('gives a ceiling that is never below the peak nor outside its bounds, for every peak from 0 to 120', () => {
    for (let peak = 0; peak <= 120; peak += 0.5) {
      const top = ceilingDomain(peak, 10, 10, 100);
      expect(top).toBeGreaterThanOrEqual(10);
      expect(top).toBeLessThanOrEqual(100);
      expect(top % 10).toBe(0);
      if (peak <= 100) expect(top).toBeGreaterThanOrEqual(peak);
    }
  });
  it('gives a two-step axis that holds the total in two equal steps and no label past its places, for a sweep of totals', () => {
    for (const [minimum, places] of [[0.01, 3], [0.25, 2], [1, 0]] as const) {
      for (let total = 0; total <= 300; total += 0.37) {
        const { domain, step, digits } = twoStepDomain(total, minimum, places);
        expect(domain).toBeCloseTo(step * 2, 9);
        expect(step).toBeGreaterThanOrEqual(minimum - 1e-9);
        expect(domain).toBeGreaterThanOrEqual(total - 1e-9);
        expect(digits).toBeLessThanOrEqual(places);
      }
    }
  });
  it('shares a value without leaving 0 to 100', () => {
    for (const value of [-1e9, -1, 0, 0.5, 99.999, 100, 1e9]) {
      const percent = scaledPercent(value, 100);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
    expect(scaledPercent(Number.NaN, 100)).toBe(0);
    expect(scaledPercent(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('shows more labels as the plot widens, never more than fit, and always the first', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let width = 40; width <= 800; width += 20) {
      const cadence = labelCadence(24, width, 32);
      expect(cadence).toBeLessThanOrEqual(last);
      last = cadence;
      const shown = labelIndices(24, cadence);
      expect(shown[0]).toBe(0);
      expect(shown.length * (32 + 6)).toBeLessThanOrEqual(width + 32 + 6 + 1e-9 + (cadence === 24 ? 100 : 0));
    }
  });
  it('lists the levels top first, evenly, with the base last', () => {
    const levels = axisLevels(4, 90, 0);
    expect(levels).toEqual([90, 60, 30, 0]);
    expect(axisLevels(2, 5, -5)).toEqual([5, -5]);
  });
  it('formats a label with up to the places it is given', () => {
    expect(axisNumber(0.5, 0)).toBe('1');
    expect(axisNumber(1234.5678, 2)).toBe('1,234.57');
    expect(axisText('{value}%', 50, 0)).toBe('50%');
    expect(axisText('no number', 50, 0)).toBe('no number');
  });
  it('is as tall as its share, with no bar taller than the plot', () => {
    for (const mark of barMarks([0, 1, 50, 99, 100, 500, null], 100, 0, 200, 76, 2, 2)) expect(mark.height).toBeLessThanOrEqual(76);
  });
  it('lays bars side by side across exactly the plot', () => {
    const bars = barMarks(Array.from({ length: 7 }, () => 10), 100, 0, 150, 76, 3, 2);
    const last = bars[bars.length - 1];
    expect(last.x + last.width).toBeCloseTo(150, 9);
    expect(bars[1].x - (bars[0].x + bars[0].width)).toBeCloseTo(3, 9);
  });
  it('puts the points of a line in the middle of equal slots and breaks it where a value is unknown', () => {
    const marks = pointMarks([10, null, 30], 100, 0, 90, 100);
    expect(marks.map(mark => mark.x)).toEqual([15, 45, 75]);
    expect(marks.map(mark => mark.y)).toEqual([90, null, 70]);
  });
  it('reads a series out label by label, saying the given words for what is not known', () => {
    expect(seriesText([{ label: 'a', value: 1 }, { label: 'b', value: null }], '{value} u', 0, 'n/a')).toBe('a 1 u, b n/a');
  });
});

describe('gauge placement', () => {
  it('reads a share on either scale and holds it between the ends', () => {
    expect(gaugePercent(0.5)).toBe(50);
    expect(gaugePercent(50, 'percent')).toBe(50);
    expect(gaugePercent(-1)).toBe(0);
    expect(gaugePercent(7, 'unit')).toBe(100);
    expect(gaugePercent(null)).toBe(0);
    expect(gaugePercent(undefined)).toBe(0);
  });
  it('keeps the marker wholly inside the track at every value', () => {
    for (let value = -0.5; value <= 1.5; value += 0.05) {
      const { marker } = layoutGauge({ fill: 'scale', value, width: 120, markerSize: 12 });
      expect(marker!.left).toBeGreaterThanOrEqual(0);
      expect(marker!.left + 12).toBeLessThanOrEqual(120);
    }
  });
  it('mirrors every position in a right-to-left layout', () => {
    const plain = layoutGauge({ fill: 'span', span: { start: 0.2, size: 0.3 }, value: 0.4, width: 100, markerSize: 10 });
    const mirrored = layoutGauge({ fill: 'span', span: { start: 0.2, size: 0.3 }, value: 0.4, width: 100, markerSize: 10, rtl: true });
    expect(mirrored.span!.left).toBeCloseTo(100 - plain.span!.left - plain.span!.width, 9);
    expect(mirrored.marker!.left).toBeCloseTo(100 - plain.marker!.left - 10, 9);
    expect(mirrored.span!.width).toBe(plain.span!.width);
  });
  it('never lets a span leave the track', () => {
    for (let start = -0.5; start <= 1.5; start += 0.1) {
      const { span } = layoutGauge({ fill: 'span', span: { start, size: 0.7 }, width: 100, markerSize: 12 });
      if (span) { expect(span.left).toBeGreaterThanOrEqual(0); expect(span.left + span.width).toBeLessThanOrEqual(100 + 1e-9); }
    }
  });
});
