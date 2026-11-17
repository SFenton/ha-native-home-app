import { describe, expect, it } from 'vitest';
import { crossesFold, foldReadout, gridFold, windowFold } from '../src/preview2/fold';
import { bandPlacements, bandTemplate, evenRounded, gridTracks, planGrid, type FoldBand } from '../src/preview2/grid';
import { previewWindows, withPose } from '../src/preview2/windows';

/*
 * Ported from the app's tests (native-home `c6174b9e`, `apple/Tests/HassDesignTests/`). Cited as file:line.
 *   DynamicGridMetricsTests.swift  = M     HingeAvoidanceTests.swift (DynamicGridBandTests) = B     DynamicGridFillTests.swift = F
 */
const near = (value: number, expected: number, digits = 3) => expect(value).toBeCloseTo(expected, digits);
const band: FoldBand = { lower: 455.3, upper: 495.7 };
const duo = previewWindows.find(item => item.name === 'Duo open, sideways')!;

describe('the even column rule', () => {
  it('rounds an odd count down to the even below, and leaves one alone (M:46 evenRoundingDropsOddCountsToTheEvenBelow)', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(evenRounded)).toEqual([1, 2, 2, 4, 4, 6, 6]);
    expect(evenRounded(0)).toBe(1);
  });

  it('rounds an odd fit down and shares the leftover width (M:51 hingeGridsRoundOddFitsDownAndShareTheLeftoverWidth)', () => {
    // 3 fit at 802 pt (200 minimum, 12 spacing); across a hinge that becomes 2 wider tracks. A tile's cap of four is the caller's.
    const plain = gridTracks(802, 200, 4, 12), hinge = gridTracks(802, 200, 4, 12, { even: true });
    expect(plain.columns).toBe(3);
    expect(hinge.columns).toBe(2);
    expect(hinge.tracks[0].width).toBe(395);
  });

  it('leaves even and single counts alone, and counts the cap first (M:62 hingeGridsLeaveEvenAndSingleCountsAlone)', () => {
    const even = { even: true };
    expect(gridTracks(520, 160, 4, 12, even).columns).toBe(2);
    expect(gridTracks(1000, 160, 4, 12, even).columns).toBe(4);
    expect(gridTracks(100, 160, 4, 12, even).columns).toBe(1);
    expect(gridTracks(1000, 160, 3, 12, even).columns).toBe(2);
  });

  it('gives a 3-column grid 2 columns across the fold, flat (S2)', () => {
    expect(gridTracks(836, 150, 3, 12, { even: true }).columns).toBe(2);
  });
});

describe('the band tracks', () => {
  it('gives each side its own tracks, the gap between them being the band (B:64 eachSideGetsItsOwnTracksAndTheGapIsTheBand)', () => {
    const grid = gridTracks(868, 150, 4, 12, { even: true, band });
    expect(grid.columns).toBe(4);
    expect(grid.side).toBe(2);
    const [a, b, c, d] = grid.tracks;
    expect(a.x).toBe(0);
    near(b.x + b.width, 455.3);
    near(c.x, 495.7);
    near(d.x + d.width, 868);
    near(a.width, (455.3 - 12) / 2);
    near(c.width, (372.3 - 12) / 2);
    expect(grid.tracks.every(track => track.x + track.width <= band.lower + 0.001 || track.x >= band.upper - 0.001)).toBe(true);
  });

  it('stops at half the maximum a side; tiles stop at four a row (B:78 aWideGridUsesMoreTracksPerSideUpToHalfTheMaximum)', () => {
    // The app's grid of small controls keeps a cap of six; a tile grid never passes four, two a side.
    expect(gridTracks(1600, 90, 6, 12, { even: true, band: { lower: 780, upper: 820 } }).columns).toBe(6);
    expect(gridTracks(1600, 150, 4, 12, { even: true, band: { lower: 780, upper: 820 } }).columns).toBe(4);
  });

  it('ignores a band a side cannot hold a track beside, and a one-column grid (B:95 aBandIsIgnoredWhenASideCannotHoldATrack)', () => {
    expect(gridTracks(868, 300, 4, 12, { even: true, band: { lower: 200, upper: 240 } })).toEqual(gridTracks(868, 300, 4, 12, { even: true }));
    expect(gridTracks(868, 150, 1, 12, { even: true, band }).columns).toBe(1);
    // Without the even flag (no vertical hinge on the device) a band changes nothing.
    expect(gridTracks(868, 150, 4, 12, { even: false, band }).side).toBeUndefined();
  });

  it('makes a span across the band take the band too (B:86 aSpanAcrossTheBandTakesTheBandToo)', () => {
    const grid = gridTracks(868, 150, 4, 12, { even: true, band });
    const placed = bandPlacements([4], 4, 2, false);
    const { template, lines } = bandTemplate(grid, 12, 40.4, placed);
    // Four tracks and the band's: five CSS columns, from the first line.
    expect(lines).toEqual([{ column: 1, span: 5, row: 1 }]);
    expect(template.split(' ')).toHaveLength(5);
  });

  it('S2: 836 pt with 4 columns, book gives 2 + 2 with cells of 214 and 172; flat gives 4 at 200', () => {
    // The grid starts 16 pt in, so the band is 439.3 to 479.7 in the grid's own offsets (`HingeAvoidance.band`).
    const folded = gridFold(windowFold(withPose(duo, 'book')), { x: 16, width: 836 });
    expect(folded?.even).toBe(true);
    near(folded!.band!.lower, 439.3, 2);
    const book = gridTracks(836, 150, 4, 12, folded);
    expect(book.columns).toBe(4);
    expect(book.side).toBe(2);
    expect(book.tracks.map(track => Math.round(track.width))).toEqual([214, 214, 172, 172]);
    near(book.tracks[2].x, 479.7, 1);
    const flat = gridTracks(836, 150, 4, 12, gridFold(windowFold(withPose(duo, 'flat')), { x: 16, width: 836 }));
    expect(flat.columns).toBe(4);
    expect(flat.side).toBeUndefined();
    expect(flat.tracks.map(track => track.width)).toEqual([200, 200, 200, 200]);
  });
});

describe('placing across a band', () => {
  const four = { columns: 4, side: 2 };
  it('keeps a fill from crossing the band; a lone tile fills only its side (F:76 aBandIsAWall)', () => {
    for (const input of [[1], [1, 1, 1], [1, 1, 1, 1, 1], [2, 1]]) {
      for (const place of bandPlacements(input, four.columns, four.side, true)) expect(place.first < 2 && place.first + place.span > 2).toBe(false);
    }
    expect(bandPlacements([1], 4, 2, true).map(item => item.span)).toEqual([2]);
    const three = bandPlacements([1, 1, 1], 4, 2, true);
    expect(three.map(item => item.span)).toEqual([1, 1, 2]);
    expect(three.map(item => item.first)).toEqual([0, 1, 2]);
  });

  it('leaves a row with an item over the band as placed (F:92 aRowWithAnItemOverTheBandIsLeftAsPlaced)', () => {
    expect(bandPlacements([3, 1], 4, 2, true).map(item => item.span)).toEqual([3, 1]);
  });

  it('S4: shortRow leading leaves the short row at the track width', () => {
    expect(bandPlacements([1, 1, 1], 4, 2, false).map(item => item.span)).toEqual([1, 1, 1]);
    expect(planGrid([1, 1, 1], 4, false)).toEqual({ columns: 4, spans: [1, 1, 1] });
    expect(planGrid([1, 1, 1], 4).widths).toBeDefined();
  });

  it('numbers CSS columns past the band: the trailing tracks start after its own', () => {
    const grid = gridTracks(836, 150, 4, 12, { even: true, band: { lower: 439.3, upper: 479.7 } });
    const { lines } = bandTemplate(grid, 12, 40.4, bandPlacements([1, 1, 1, 1, 1], 4, 2, true));
    expect(lines.map(line => line.column)).toEqual([1, 2, 4, 5, 1]);
    expect(lines.map(line => line.row)).toEqual([1, 1, 1, 1, 2]);
    expect(lines[4].span).toBe(2); // the lone tile fills its own side only
  });
});

describe('the window fold (S1)', () => {
  const flat = withPose(duo, 'flat'), book = withPose(duo, 'book');
  it('gives the book pose the band and the flat pose none, a vertical hinge existing in both', () => {
    expect(windowFold(book)).toMatchObject({ vertical: true, book: true, width: 951, rail: 83, band: { lower: 455.3 } });
    near(windowFold(book).band!.upper, 495.7);
    expect(windowFold(flat)).toMatchObject({ vertical: true, book: false, band: undefined });
  });

  it('has no vertical fold on the iPhone, the folded Duo, the Duo upright or the iPad', () => {
    for (const win of previewWindows.filter(item => item.name !== 'Duo open, sideways')) expect(windowFold(win).vertical).toBe(false);
    for (const win of previewWindows.filter(item => item.name !== 'Duo open, sideways')) expect(gridFold(windowFold(win), { x: 16, width: 300 })).toBeUndefined();
  });

  it('asks for the even rule where the fold crosses the grid: the band middle in book, the window midpoint flat', () => {
    expect(crossesFold(windowFold(book), { x: 16, width: 836 })).toBe(true);
    expect(crossesFold(windowFold(flat), { x: 16, width: 836 })).toBe(true);
    // A pane wholly on one side of the fold is not divided by it.
    expect(crossesFold(windowFold(flat), { x: 500, width: 368 })).toBe(false);
    expect(gridFold(windowFold(book), { x: 500, width: 368 })).toEqual({ even: false, band: undefined });
  });
});

describe('the pose read-out (S5)', () => {
  it('says book with the band, flat, or none', () => {
    expect(foldReadout(withPose(duo, 'book'))).toBe('Fold: book, band 455 to 496 pt');
    expect(foldReadout(withPose(duo, 'flat'))).toBe('Fold: flat');
    expect(foldReadout(previewWindows[0])).toBe('Fold: none');
  });
});
