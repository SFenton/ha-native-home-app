import { describe, expect, it } from 'vitest';
import { dateStyles } from '../src/shared/composition/expression';
import { formatDate } from '../src/shared/composition/date-format';
import { words } from '../src/workspace2/expr/words';

const clock = { now: '2026-11-12T09:41:00', utcOffsetMinutes: 0 };

describe('the date Style on a token (eight styles, drawn on the evaluation clock)', () => {
  it('offers exactly the eight styles, each with a name a person can read', () => {
    expect([...dateStyles]).toEqual(['short-date', 'long-date', 'weekday-date', 'time', 'date-time', 'relative', 'hour', 'weekday']);
    for (const style of dateStyles) expect(words.dateStyles[style]).toMatch(/^[A-Z]/);
  });
  it('draws each style the way the spec lists it', () => {
    const text = '2026-11-12T09:41:00';
    expect(formatDate('short-date', text, clock)).toBe('Nov 12');
    expect(formatDate('long-date', text, clock)).toBe('November 12, 2026');
    expect(formatDate('weekday-date', text, clock)).toBe('Thu, Nov 12');
    expect(formatDate('time', text, clock)).toBe('9:41 AM');
    expect(formatDate('date-time', text, clock)).toBe('Nov 12 at 9:41 AM');
    expect(formatDate('relative', text, clock)).toBe('Today');
  });
  it('adds the year to another year, and counts whole days for Relative', () => {
    expect(formatDate('short-date', '2025-11-12', clock)).toBe('Nov 12, 2025');
    expect(formatDate('relative', '2026-11-11', clock)).toBe('Yesterday');
    expect(formatDate('relative', '2026-11-13', clock)).toBe('Tomorrow');
    expect(formatDate('relative', '2026-11-09', clock)).toBe('3 days ago');
    expect(formatDate('relative', '2026-11-15', clock)).toBe('In 3 days');
  });
  it('has no text for what is not a date, and for the styles that need a clock when there is none', () => {
    expect(formatDate('long-date', 'soon', clock)).toBeUndefined();
    expect(formatDate('relative', '2026-11-12', undefined)).toBeUndefined();
    expect(formatDate('short-date', '2026-11-12', undefined)).toBeUndefined();
    expect(formatDate('long-date', '2026-11-12', undefined)).toBe('November 12, 2026');
  });
});
