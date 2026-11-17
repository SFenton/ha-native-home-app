import { describe, expect, it } from 'vitest';
import { formatNumber as preview2FormatNumber } from '../src/preview2/evaluate';
import {
  compareText, daysBetween, daysFromCivil, finiteNumber, formatNumber, isCalendarDate, isDateText, isDateTimeText, numberText, roundHalfAwayFromZero,
  scalarText, textEquals, wallTime, clockToday, clockTime,
} from '../src/shared/composition/pipeline';

/**
 * Where JavaScript and Swift disagree, a Data Flow defines the answer itself, and these tests pin it. The four rows of the research note's table
 * were measured on Node 26.3 and Swift 6.4.2 (the left side of each pair below is what JavaScript does, asserted so a change of engine is noticed).
 */
describe('the four measured divergences', () => {
  it('orders text by scalar value: U+FF5E before U+1F600, where JavaScript puts U+1F600 first', () => {
    expect('\u{1F600}' < '～').toBe(true);
    expect(compareText('\u{1F600}', '～')).toBeGreaterThan(0);
    expect(compareText('～', '\u{1F600}')).toBeLessThan(0);
    expect(['\u{1F600}', '～', 'a', 'B'].sort(compareText)).toEqual(['B', 'a', '～', '\u{1F600}']);
  });

  it('treats canonically equivalent text as equal: U+00E9 is "e" + U+0301, where JavaScript says it is not', () => {
    const composed: string = '\u00e9', decomposed: string = 'e\u0301';
    expect(composed === decomposed).toBe(false);
    expect(textEquals('\u00e9', 'e\u0301')).toBe(true);
    expect(compareText('\u00e9', 'e\u0301')).toBe(0);
    expect(textEquals('e', 'E')).toBe(false);
    expect(compareText('e\u0301', 'f')).toBeGreaterThan(0);
  });

  it('prints numbers as Swift does, where JavaScript writes every digit', () => {
    expect(String(123456789012345680000)).toBe('123456789012345680000');
    expect(String(0.000001)).toBe('0.000001');
    expect(numberText(123456789012345680000)).toBe('1.2345678901234568e+20');
    expect(numberText(0.000001)).toBe('1e-06');
  });

  it('rounds a tie away from zero, where Math.round sends -2.5 up', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-0.4)).toBe(-0);
    expect(roundHalfAwayFromZero(1.4999999999999998)).toBe(1);
  });
});

describe('number text', () => {
  // Measured with Swift 6.4.2 `print(Double)`, except that a whole number below 1e15 has no ".0" (the grammar's existing rule).
  const swift: [number, string][] = [
    [0.1, '0.1'], [1.5, '1.5'], [100, '100'], [3, '3'], [-7, '-7'], [1e15, '1000000000000000.0'], [9007199254740992, '9007199254740992.0'],
    [1e16, '1e+16'], [123456789012345680000, '1.2345678901234568e+20'], [0.0001, '0.0001'], [0.00001, '1e-05'], [0.000001, '1e-06'],
    [1.5e-7, '1.5e-07'], [123456.789e3, '123456789'], [1e21, '1e+21'], [2.5e-10, '2.5e-10'], [12345678.9, '12345678.9'], [1e100, '1e+100'],
    [0.1 + 0.2, '0.30000000000000004'], [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'], [-0, '0'], [-1e-7, '-1e-07'],
  ];
  it.each(swift)('prints %s as %s', (value, expected) => { expect(numberText(value)).toBe(expected); });
  it('gives 0 for a number that has no text', () => {
    expect(numberText(NaN)).toBe('0');
    expect(numberText(Infinity)).toBe('0');
  });
  it('prints scalars and nothing else', () => {
    expect(scalarText('a')).toBe('a');
    expect(scalarText(2.5)).toBe('2.5');
    expect(scalarText(true)).toBe('true');
    expect(scalarText(null)).toBeUndefined();
    expect(scalarText([1])).toBeUndefined();
    expect(scalarText({})).toBeUndefined();
  });
  it('reads a number from a number or a numeric string', () => {
    expect(finiteNumber(' 4 ')).toBe(4);
    expect(finiteNumber('')).toBeUndefined();
    expect(finiteNumber('1e3')).toBe(1000);
    expect(finiteNumber(Infinity)).toBeUndefined();
    expect(finiteNumber(true)).toBeUndefined();
  });
  it('rounds to fixed digits like C printf, agreeing with the preview evaluator', () => {
    for (const [value, digits] of [[2.5, 0], [3.5, 0], [0.125, 2], [2.675, 2], [-1.005, 2], [0.5, 0], [1.5, 0], [1234.5678, 3], [1e21, 2], [-0.0004, 2], [7, 3]] as const) {
      expect(formatNumber(value, digits), `${value} / ${digits}`).toBe(preview2FormatNumber(value, digits));
    }
    expect(formatNumber(2.5, 0)).toBe('2');
    expect(formatNumber(3.5, 0)).toBe('4');
    expect(formatNumber(0.125, 2)).toBe('0.12');
    expect(formatNumber(-0.0004, 2)).toBe('0');
  });
});

describe('dates', () => {
  it('knows the calendar: leap years, month lengths and the range of a time', () => {
    expect(isCalendarDate(2024, 2, 29)).toBe(true);
    expect(isCalendarDate(2100, 2, 29)).toBe(false);
    expect(isCalendarDate(2000, 2, 29)).toBe(true);
    expect(isCalendarDate(2026, 4, 31)).toBe(false);
    expect(isCalendarDate(0, 1, 1)).toBe(false);
    expect(isDateText('2026-11-15')).toBe(true);
    expect(isDateText('2026-11-15T00:00')).toBe(false);
    expect(isDateTimeText('2026-11-15T23:59:59.999Z')).toBe(true);
    expect(isDateTimeText('2026-11-15 09:30')).toBe(true);
    expect(isDateTimeText('2026-11-15T24:00:00')).toBe(false);
    expect(isDateTimeText('2026-11-15T09:60:00')).toBe(false);
    expect(isDateTimeText('2026-11-15T09:00:00+24:00')).toBe(false);
    expect(isDateTimeText('2026-11-15T09:00:00+05:30')).toBe(true);
  });
  it('counts days from the epoch', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(1969, 12, 31)).toBe(-1);
    expect(daysFromCivil(2000, 3, 1)).toBe(11017);
    expect(daysFromCivil(2026, 11, 15)).toBe(20772);
  });
  it('moves a time with an offset onto the viewer clock, and leaves a wall time and a date alone', () => {
    expect(wallTime('2026-11-15', -480)).toEqual({ days: 20772, seconds: 0 });
    expect(wallTime('2026-11-15T09:30:15', -480)).toEqual({ days: 20772, seconds: 34215 });
    expect(wallTime('2026-11-15T07:30:00Z', -480)).toEqual({ days: 20771, seconds: 84600 });
    expect(wallTime('2026-11-15T09:30:00+05:30', -480)).toEqual({ days: 20771, seconds: 72000 });
    expect(wallTime('2026-11-15T09:30:00-08:00', -480)).toEqual({ days: 20772, seconds: 34200 });
    expect(wallTime('2026-11-15T09:30:00.750', -480)).toEqual({ days: 20772, seconds: 34200 });
    expect(wallTime('tomorrow', 0)).toBeUndefined();
    expect(wallTime('2026-02-30', 0)).toBeUndefined();
  });
  it('measures calendar days between dates, negative backwards, across a year and a leap day', () => {
    expect(daysBetween('2026-11-10', '2026-11-15', 0)).toBe(5);
    expect(daysBetween('2026-11-15', '2026-11-10', 0)).toBe(-5);
    expect(daysBetween('2023-12-31', '2024-03-01', 0)).toBe(61);
    expect(daysBetween('2026-11-15T23:59:00', '2026-11-16T00:01:00', 0)).toBe(1);
    expect(daysBetween('x', '2026-11-16', 0)).toBeUndefined();
  });
  it('reads the clock, which must be a wall-clock date and time', () => {
    expect(clockToday({ now: '2026-11-15T09:30:00', utcOffsetMinutes: 0 })).toBe('2026-11-15');
    expect(clockToday({ now: '2026-11-15T09:30:00Z', utcOffsetMinutes: 0 })).toBeUndefined();
    expect(clockTime({ now: '2026-11-15', utcOffsetMinutes: 0 })).toBeUndefined();
  });
});
