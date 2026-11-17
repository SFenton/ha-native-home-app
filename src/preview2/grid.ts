/** The most tiles the app puts in one row (`DynamicGridMetrics.maxTileColumns`, the one tile rule). */
export const MAX_TILE_COLUMNS = 4;

/**
 * `DynamicGridMetrics`' column count: `floor((width + spacing) / (minimum + spacing))`, clamped to `1...maxColumns`. An
 * unmeasured (zero or infinite) width gives `maxColumns`.
 */
export function gridColumns(width: number, minimum: number, maxColumns: number, spacing: number): number {
  const most = Math.max(1, Math.floor(maxColumns));
  if (!Number.isFinite(width) || width <= 0) return most;
  return Math.min(most, Math.max(1, Math.floor((width + spacing) / (minimum + spacing))));
}

/**
 * The cell minimum a grid uses when it keeps at least `minimumColumns` columns (`sh.grid-min-columns@1`): the authored `minimum`, or the width each cell has
 * when `minimumColumns` of them share `width`, whichever is smaller. With no floor, or no measured width, the minimum stands.
 */
export function floorMinimum(width: number, minimum: number, minimumColumns: number | undefined, spacing: number): number {
  if (!minimumColumns || !Number.isFinite(width) || width <= 0) return minimum;
  const share = (width - (minimumColumns - 1) * spacing) / minimumColumns;
  return share > 0 ? Math.min(minimum, share) : minimum;
}

/**
 * The most tracks a tile takes by its content when the grid keeps `minimumColumns` columns: its share of the tracks, so that many tiles still sit in a row.
 * Without a floor a tile may take the whole row (`columns`).
 */
export function shareOfTracks(columns: number, minimumColumns: number | undefined): number {
  return minimumColumns ? Math.max(1, Math.floor(columns / minimumColumns)) : columns;
}

/** The span each item takes, clamped to the track count (an item never spans more columns than exist). */
const clampSpans = (spans: readonly number[], columns: number) => spans.map(span => Math.min(Math.max(1, Math.floor(span)), columns));

// MARK: - Content-aware spans (`UKGridSolver`, "owner, 2026-11-01, content-aware span")

/** The width of the page padding a tile adds on each side (`HassTokens.Spacing.m`). */
const TILE_PADDING = 12;
/** The glyph column of a row tile, with its gap to the text (`GlassTileFace.rowGlyphWidth` and `Spacing.m`). */
export const TILE_GLYPH_COLUMN = 42;
/** The chevron's reserve on a navigation tile (`GlassTileFace.chevronReserve`). */
export const TILE_CHEVRON = 20;
/** The least width given to a tile's text, so a short title does not make a tile narrower than its controls need (`TileMinimumWidth.textFloor`). */
export const TILE_TEXT_FLOOR = 96;
/** The trailing strip of `count` 44 point discs, 12 apart, and the 8 point gap to the text (`TileActionButtonStyle.stripWidth` and `gap`, `Spacing.s`). */
export const tileStrip = (count: number): number => count > 0 ? count * 44 + (count - 1) * 12 + 8 : 0;

/** `TileMinimumWidth.width(text:glyphColumn:chevron:strip:)`: the least width of a tile that shows its text on one line beside its controls. */
export function tileMinimumWidth(text: number, glyphColumn: number, chevron: number, strip: number): number {
  return 2 * TILE_PADDING + glyphColumn + Math.max(text, TILE_TEXT_FLOOR) + chevron + strip;
}

/**
 * `DynamicGridMetrics.spans(minimums:trackWidth:columns:spacing:)` applied as `UKGridSolver.solve` applies it: a tile that declared a
 * minimum takes `ceil((minimum + spacing) / (track + spacing))` tracks, capped at the row. The grid decides when `layout.span` is unset
 * (`undefined`); a span the author set, 1 included, is kept as given, so the author overrides the grid.
 */
export function contentSpans(spans: readonly (number | undefined)[], minimums: readonly number[], trackWidth: number, columns: number, spacing: number): number[] {
  const cap = Math.max(1, Math.floor(columns));
  return spans.map((span, at) => {
    const minimum = minimums[at] ?? 0;
    if (span !== undefined) return span;
    if (!(minimum > 0)) return 1;
    if (!(trackWidth > 0) || !Number.isFinite(trackWidth)) return cap;
    return Math.min(Math.max(Math.ceil((minimum - 0.01 + spacing) / (trackWidth + spacing)), 1), cap);
  });
}

/** Splits spans into rows the way the grid packs them: in order, a new row when the next item does not fit. */
export function packRows(spans: readonly number[], columns: number): number[][] {
  const rows: number[][] = [];
  let used = 0;
  clampSpans(spans, columns).forEach((span, at) => {
    if (!rows.length || used + span > columns) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(at);
    used += span;
  });
  return rows;
}

/**
 * `DynamicGridMetrics.sharedWidths`: the widths, in tracks, of one short row. Every item keeps at least its placed span and the
 * rest of the row is shared equally (max-min fair share): three tiles in four tracks become thirds.
 */
export function sharedWidths(spans: readonly number[], columns: number): number[] {
  const placed = clampSpans(spans, columns);
  const order = placed.map((span, at) => ({ span, at })).sort((a, b) => a.span - b.span);
  const widths = new Array<number>(placed.length).fill(0);
  let left = columns, count = order.length;
  for (const item of order) {
    const share = left / count;
    const width = Math.max(item.span, share);
    widths[item.at] = width; left -= width; count -= 1;
  }
  return widths;
}

/**
 * `DynamicGridMetrics.fillingPlacements`: whole-track spans for a grid of more than one row. A row that leaves tracks unused hands
 * them out one at a time to its narrowest item, ties to the later, so every edge stays on the other rows' track lines
 * (4 + 3 is 4 + 1, 1, 2; a 1 and a 2 in four are 2, 2).
 */
export function fillingPlacements(spans: readonly number[], columns: number): number[] {
  const placed = clampSpans(spans, columns);
  for (const row of packRows(placed, columns)) {
    let spare = columns - row.reduce((sum, at) => sum + placed[at], 0);
    while (spare > 0) {
      const narrowest = row.reduce((best, at) => placed[at] <= placed[best] ? at : best, row[0]);
      placed[narrowest] += 1; spare -= 1;
    }
  }
  return placed;
}

/** How a grid places its items: the spans, and for a one-row grid the shared widths to lay its tracks with. `fill: false` (`shortRow: leading`) leaves short rows as placed. */
export interface GridPlan { columns: number; spans: number[]; /** Fractional track widths of a single short row; absent otherwise. */ widths?: number[] }

/**
 * The prod rule for short rows (`dynamic-grid.md`, "Short rows fill"): a grid of one row shares the width equally; a grid of
 * several fills each short row in whole tracks. A row that already fills the tracks is left alone.
 */
export function planGrid(spans: readonly number[], columns: number, fill = true): GridPlan {
  const placed = clampSpans(spans, columns);
  if (!fill) return { columns, spans: placed };
  const rows = packRows(placed, columns);
  if (rows.length <= 1) {
    const total = placed.reduce((sum, span) => sum + span, 0);
    return total < columns ? { columns, spans: placed.map(() => 1), widths: sharedWidths(placed, columns) } : { columns, spans: placed };
  }
  return { columns, spans: fillingPlacements(placed, columns) };
}


// MARK: - The fold (`DynamicGridMetrics`' hinge rules)

/** The hinge band across a grid, in the grid's own x offsets (`HingeAvoidance.band`). */
export interface FoldBand { lower: number; upper: number }

/** What the fold asks of a grid: an even track count (a vertical hinge exists and crosses it) and the band to keep clear (book pose only). */
export interface GridFold { even: boolean; band?: FoldBand }

/** One track's place in the grid: its x offset from the grid's leading edge and its width. */
export interface Track { x: number; width: number }

/** The tracks a grid lays out at a width. */
export interface GridTracks {
  columns: number;
  tracks: Track[];
  /** While a band splits the grid, the tracks on each side of it; absent otherwise. */
  side?: number;
}

/** `DynamicGridMetrics.evenRounded`: the count rounded down to an even number, never below two; a single track stays single (5 to 4, 3 to 2). */
export function evenRounded(columns: number): number {
  return columns >= 2 ? columns - columns % 2 : Math.max(columns, 1);
}

/**
 * `DynamicGridMetrics.init(width:minCellWidth:maxColumns:spacing:evenColumns:band:)` for a measured, finite width. Equal tracks with
 * `floor((width + spacing) / (minimum + spacing))` columns, clamped to `1...maxColumns`, rounded to even with `fold.even`. With a band
 * (and `maxColumns >= 2`) the grid is two regions with the same track count, `min(fitLeading, fitTrailing, maxColumns / 2)` per side,
 * sharing each side's width; the band is the gap between the two middle tracks. A side narrower than one minimum ignores the band.
 */
export function gridTracks(width: number, minimum: number, maxColumns: number, spacing: number, fold: GridFold = { even: false }): GridTracks {
  const most = Math.max(Math.floor(maxColumns), 1);
  const { band } = fold;
  if (fold.even && most >= 2 && band && band.lower > 0 && band.upper < width) {
    const leading = band.lower, trailing = width - band.upper;
    const fit = (room: number) => Math.floor((room + spacing) / (minimum + spacing));
    const side = Math.min(fit(leading), fit(trailing), Math.floor(most / 2));
    if (side >= 1) {
      const leadingCell = Math.max(0, (leading - spacing * (side - 1)) / side), trailingCell = Math.max(0, (trailing - spacing * (side - 1)) / side);
      const lead = Array.from({ length: side }, (_, at) => ({ x: at * (leadingCell + spacing), width: leadingCell }));
      const trail = Array.from({ length: side }, (_, at) => ({ x: band.upper + at * (trailingCell + spacing), width: trailingCell }));
      return { columns: side * 2, tracks: [...lead, ...trail], side };
    }
  }
  let columns = Math.min(Math.max(Math.floor((width + spacing) / (minimum + spacing)), 1), most);
  if (fold.even) columns = evenRounded(columns);
  const cell = Math.max(0, (width - spacing * (columns - 1)) / columns);
  return { columns, tracks: Array.from({ length: columns }, (_, at) => ({ x: at * (cell + spacing), width: cell })) };
}

/** Where one item of a band grid goes: its first and last track, and its row. */
export interface BandPlacement { first: number; span: number; row: number }

/**
 * Places items across a band: rows pack in order; with `fill` a row's spare tracks go, one at a time to the narrowest item, ties to the
 * later, within each side of the band (a fill never crosses it, and a row with an item that spans the band is left as placed;
 * `DynamicGridMetrics.fillSegments`). An item with an explicit span that crosses the band takes the band's width too.
 */
export function bandPlacements(spans: readonly number[], columns: number, side: number, fill: boolean): BandPlacement[] {
  const placed = clampSpans(spans, columns);
  const rows = packRows(placed, columns);
  const result: BandPlacement[] = new Array(placed.length);
  const starts = (members: number[]) => { let at = 0; return members.map(index => { const first = at; at += placed[index]; return first; }); };
  rows.forEach((members, row) => {
    if (fill) {
      const first = starts(members);
      const crosses = members.some((index, at) => first[at] < side && first[at] + placed[index] > side);
      if (!crosses) {
        const segments = [
          { items: members.filter((_, at) => first[at] < side), tracks: side },
          { items: members.filter((_, at) => first[at] >= side), tracks: columns - side },
        ];
        for (const segment of segments) {
          let spare = segment.tracks - segment.items.reduce((sum, index) => sum + placed[index], 0);
          while (spare > 0 && segment.items.length) {
            const narrowest = segment.items.reduce((best, index) => placed[index] <= placed[best] ? index : best, segment.items[0]);
            placed[narrowest] += 1; spare -= 1;
          }
        }
      }
    }
    const first = starts(members);
    members.forEach((index, at) => { result[index] = { first: first[at], span: placed[index], row }; });
  });
  return result;
}

/**
 * The CSS for a band grid: its tracks in points, the band as one more track between the sides (the grid's gap already puts `spacing`
 * either side of it), and each item's grid lines. An item that crosses the band spans its track too.
 */
export function bandTemplate(grid: GridTracks, spacing: number, bandWidth: number, placements: readonly BandPlacement[]) {
  const side = grid.side ?? grid.columns;
  const part = (value: number) => `${+value.toFixed(2)}px`;
  const template = [...grid.tracks.slice(0, side).map(track => part(track.width)), part(Math.max(0, bandWidth - 2 * spacing)), ...grid.tracks.slice(side).map(track => part(track.width))].join(' ');
  const lines = placements.map(item => {
    const crosses = item.first < side && item.first + item.span > side;
    return { column: item.first < side ? item.first + 1 : item.first + 2, span: item.span + (crosses ? 1 : 0), row: item.row + 1 };
  });
  return { template, lines };
}
