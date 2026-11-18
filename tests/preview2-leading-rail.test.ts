import { describe, expect, it } from 'vitest';
import { leadingHalfWidth } from '../src/preview2/sheet-frame';
import { contentOrigin, contentSize, splitGeometry, splitReadout } from '../src/preview2/split';
import { duoWindow } from '../src/preview2/windows';

/** The open Duo sideways with its rail on the leading edge (turn 180): the rail is 83 pt on the left, the hinge band is in window points. */
const trailing = duoWindow({ turn: 0, fold: 'partly' }), leading = duoWindow({ turn: 180, fold: 'partly' });
const flatTrailing = duoWindow({ turn: 0, fold: 'open' }), flatLeading = duoWindow({ turn: 180, fold: 'open' });

describe('geometry with the rail on the leading edge', () => {
  it('starts the content after a leading rail, and at the edge for a trailing one or none', () => {
    expect(contentOrigin(trailing)).toBe(0);
    expect(contentOrigin(leading)).toBe(83);
    expect(contentOrigin(duoWindow({ turn: 90, fold: 'open' }))).toBe(0);
    expect(contentSize(leading)).toEqual({ width: 951 - 83, height: 669 });
  });

  it('measures the panes from the content origin: the same band, 83 pt less before it', () => {
    const a = splitGeometry(trailing)!, b = splitGeometry(leading)!;
    expect(a).toMatchObject({ hinge: true, band: 40.4 });
    expect(a.leading).toBeCloseTo(455.3, 5);
    expect(b.leading).toBeCloseTo(455.3 - 83, 5);
    expect(a.leading + a.band + a.trailing).toBeCloseTo(868, 5);
    expect(b.leading + b.band + b.trailing).toBeCloseTo(868, 5);
  });

  it('reads the split out the same way', () => {
    expect(splitReadout(trailing)).toBe('Split view: on, 455 and 372 pt');
    expect(splitReadout(leading)).toBe('Split view: on, 372 and 455 pt');
  });

  it('gives a flat leading-rail Duo the midpoint split of its content area', () => {
    const flat = splitGeometry(flatLeading)!, other = splitGeometry(flatTrailing)!;
    expect(flat.hinge).toBe(false);
    expect(flat.leading + flat.band + flat.trailing).toBe(other.leading + other.band + other.trailing);
  });

  it('sizes a half sheet to the leading half: counted from the content origin when the rail is leading', () => {
    expect(leadingHalfWidth(trailing)).toBe(Math.floor(455.3 - 8));
    expect(leadingHalfWidth(leading)).toBe(Math.floor(455.3 - 83 - 8));
    expect(leadingHalfWidth(flatLeading)).toBe(leadingHalfWidth(flatTrailing));
  });
});
