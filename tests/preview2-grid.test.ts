import { describe, expect, it } from 'vitest';
import { fillingPlacements, gridColumns, MAX_TILE_COLUMNS, packRows, planGrid, sharedWidths } from '../src/preview2/grid';

describe('grid columns', () => {
  it('counts floor((width + spacing) / (minimum + spacing)), clamped to 1...max', () => {
    expect(gridColumns(340, 150, 4, 12)).toBe(2);
    expect(gridColumns(500, 150, 4, 12)).toBe(3);
    expect(gridColumns(120, 150, 4, 12)).toBe(1);
    expect(gridColumns(2000, 150, MAX_TILE_COLUMNS, 12)).toBe(4);
    expect(gridColumns(0, 150, 3, 12)).toBe(3);
  });
});

describe('grid fill', () => {
  it('packs items into rows in order', () => {
    expect(packRows([1, 1, 2, 1, 1], 3)).toEqual([[0, 1], [2, 3], [4]]);
    expect(packRows([5], 3)).toEqual([[0]]);
  });

  it('shares a short single row equally: three tiles in four tracks become thirds, a 1 and a 2 become 2 and 2', () => {
    expect(sharedWidths([1, 1, 1], 4).map(width => +width.toFixed(3))).toEqual([1.333, 1.333, 1.333]);
    expect(sharedWidths([1, 2], 4)).toEqual([2, 2]);
    expect(sharedWidths([3], 4)).toEqual([4]);
  });

  it('fills the short row of a taller grid in whole tracks, spare tracks to the narrowest, ties to the later', () => {
    expect(fillingPlacements([1, 1, 1, 1, 1, 1, 1], 4)).toEqual([1, 1, 1, 1, 1, 1, 2]);
    expect(fillingPlacements([1, 2, 1, 1, 1], 4)).toEqual([1, 2, 1, 2, 2]);
  });

  it('leaves a Rooms tile of span 2 alone in three columns at the full width, not two thirds', () => {
    const plan = planGrid([2], 3);
    expect(plan.widths).toEqual([3]);
    expect(plan.spans).toEqual([1]);
  });

  it('leaves a full row untouched', () => {
    expect(planGrid([1, 2], 3)).toEqual({ columns: 3, spans: [1, 2] });
    expect(planGrid([1, 1, 1, 1], 4)).toEqual({ columns: 4, spans: [1, 1, 1, 1] });
  });

  it('fills the last row of several, keeping every edge on a track line', () => {
    expect(planGrid([1, 1, 1, 1, 1], 3)).toEqual({ columns: 3, spans: [1, 1, 1, 1, 2] });
    expect(planGrid([1, 1, 1], 2).spans).toEqual([1, 1, 2]);
  });
});
