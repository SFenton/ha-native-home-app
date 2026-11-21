import { describe, expect, it } from 'vitest';
import { describeValue, formatObservation, formatValue, nodeValueOptions } from '../../../src/workspace2/canvas/value-format';
import { lift } from '../../../src/shared/composition/graph';

const clock = { now: '2026-11-21T12:34:56', utcOffsetMinutes: -480 };
const home = { clock, timeZone: 'America/Los_Angeles' };

describe('canvas value presentation', () => {
  it.each([
    ['2026-11-21', 'Today'],
    ['2026-11-20', 'Nov 20'],
    ['2026-11-19', 'Nov 19'],
    ['2025-11-21', 'Nov 21, 2025'],
    ['2026-11-21T17:30:00+00:00', 'Today, 9:30 AM'],
    ['2026-11-21T04:00:04+00:00', 'Yesterday, 8:00 PM'],
    ['2026-11-19T07:30:00Z', 'Nov 18, 11:30 PM'],
    ['2025-11-21T17:30:00Z', 'Nov 21, 2025, 9:30 AM'],
    ['2026-11-22T07:59:59Z', 'Today, 11:59 PM'],
    ['2026-11-22T08:00:00Z', 'Nov 22, 12:00 AM'],
  ])('formats a complete untyped ISO value %s against the home day', (value, expected) => {
    expect(formatValue(value, home)).toBe(expected);
    expect(formatValue(value, { clock })).toBe(expected);
    expect(describeValue(value, home)).toBe(`${expected} (${value})`);
  });

  it('uses typed dates and offset-free datetimes as home wall time, including pipeline space syntax', () => {
    expect(formatValue('2026-11-21', { ...home, shape: { kind: 'string', format: 'date' } })).toBe('Today');
    expect(formatValue('2026-11-21T09:30:00', { ...home, shape: { kind: 'string', format: 'date-time' } })).toBe('Today, 9:30 AM');
    expect(formatValue('2026-11-21 09:30:00', { ...home, valueType: 'time' })).toBe('Today, 9:30 AM');
    expect(formatValue('2026-11-21T09:30:00', home)).toBe('2026-11-21T09:30:00');
  });

  it('carries declared date types through nullable record fields and list items', () => {
    expect(formatValue([{ due: '2026-11-21 09:30:00' }, { due: null }], { ...home, full: true, shape: {
      kind: 'array', of: { kind: 'object', fields: { due: { shape: { kind: 'union', of: [
        { kind: 'null' }, { kind: 'string', format: 'date-time' },
      ] } } } },
    } })).toBe('2 items; due: Today, 9:30 AM; due: Null');
  });

  it('uses the home zone at the value instant, not the current DST offset or browser zone', () => {
    const summerClock = { now: '2026-07-21T12:00:00', utcOffsetMinutes: -420 };
    expect(formatValue('2026-11-21T17:30:00Z', { clock: summerClock, timeZone: home.timeZone })).toBe('Nov 21, 9:30 AM');
    const newYear = { now: '2027-01-01T00:30:00', utcOffsetMinutes: 330 };
    expect(formatValue('2026-12-31T19:00:00Z', { clock: newYear, timeZone: 'Asia/Kolkata' })).toBe('Today, 12:30 AM');
    expect(formatValue('2026-12-31T18:29:59Z', { clock: newYear, timeZone: 'Asia/Kolkata' })).toBe('Yesterday, 11:59 PM');
    expect(formatValue('2026-12-30', { clock: newYear })).toBe('Dec 30, 2026');
  });

  it.each([
    '240--2026-11-21 04:00:04+00:00', 'Due 2026-11-21', '2026-11-21T17:30:00Z extra',
    '2026-11-21 17:30:00+00:00', '2026-02-30', '2026-11-21T25:30:00Z', '2026-11-21T17:30:00+24:00',
  ])('leaves non-ISO or invalid date text exact: %s', value => expect(formatValue(value, home)).toBe(value));

  it.each([
    ['needs_action', 'Needs action'], ['armed_home', 'Armed home'], ['not_home', 'Not home'],
    ['on', 'on'], ['off', 'off'], ['home', 'home'], ['hello_world2', 'hello_world2'], ['Armed_home', 'Armed_home'],
  ])('humanizes only complete snake-case state tokens: %s', (value, expected) => {
    expect(formatValue(value, home)).toBe(expected);
    expect(describeValue(value, home)).toBe(value === expected ? value : `${expected} (${value})`);
  });

  it.each(['needs_action', '2026-11-21', '2026-11-21T17:30:00+00:00'])('preserves authored literal Text %s', value => {
    const node = lift({ type: 'literal', value }, { kind: 'operand' }).graph.nodes[0];
    const options = { ...home, ...nodeValueOptions(node) };
    expect(formatValue(value, options)).toBe(value);
    expect(formatObservation({ state: 'known', source: 'live', value }, false, false, true, options)).toBe(value);
    const slot = lift({ type: 'literal', value }, { kind: 'slot' }).graph.nodes[0];
    expect(formatValue(value, { ...home, ...nodeValueOptions(slot) })).toBe(value);
  });

  it('keeps numbers, durations and exact held values', () => {
    expect(formatValue(90, { ...home, valueType: 'number' })).toBe('90');
    expect(formatValue('PT1H30M', home)).toBe('PT1H30M');
    const held = { state: 'cant-tell', source: 'scenario', kept: true, value: '2026-11-21T17:30:00Z', valueFormat: home } as const;
    expect(formatObservation(held)).toBe("Can't tell; Kept: Today, 9:30 AM");
    expect(formatObservation(held, false, false, true, {}, true)).toBe("Can't tell; Kept: Today, 9:30 AM (2026-11-21T17:30:00Z)");
  });
});
