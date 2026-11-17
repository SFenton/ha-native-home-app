import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { gridFold } from '../fold';
import { bandPlacements, bandTemplate, contentSpans, floorMinimum, gridTracks, planGrid, shareOfTracks } from '../grid';
import { useRender } from '../render-context';

/** Where the grid sits: its x offset and width in window points, and whether it is on a page (a sheet or a column pane is not). */
export interface MeasuredFrame { x: number; width: number; onPage: boolean }
const unmeasured: MeasuredFrame = { x: 0, width: 0, onPage: true };

/**
 * The laid-out frame of an element in window points, kept current by a `ResizeObserver` and re-measured when `key` changes (a pose
 * change moves a grid without resizing it). The x offset sums `offsetLeft` up to the screen, so it ignores the preview's zoom and any
 * transform of a page sliding in. Width 0 until measured.
 */
export function useMeasuredFrame(ref: RefObject<HTMLElement | null>, key: string): MeasuredFrame {
  const [frame, setFrame] = useState(unmeasured);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      let x = 0, at: HTMLElement | null = element;
      const screen = element.closest('.sh-screen');
      while (at && at !== screen) {
        x += at.offsetLeft;
        at = at.offsetParent as HTMLElement | null;
        if (at && at !== screen) x += at.clientLeft;
      }
      const next = { x, width: element.clientWidth, onPage: !element.closest('.sh-sheet, .sh-pane') };
      setFrame(now => now.x === next.x && now.width === next.width && now.onPage === next.onPage ? now : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, key]);
  return frame;
}

/** What a grid asks for. */
export interface FoldedGridOptions {
  /** The smallest cell and the most columns (already capped for tiles), and the gap between cells. */
  minimum: number; maxColumns: number; gap: number;
  /** The least number of columns (`sh.grid-min-columns@1`): the grid keeps them however wide a tile's own minimum is, and a tile with no span of its own takes at most its share of them. */
  minimumColumns?: number;
  /** The tracks each item asks for. */
  /** `layout.span` of each item; `undefined` is automatic (the grid decides from the item's minimum width). */
  spans: readonly (number | undefined)[];
  /** Each item's least width (0 for none): an item that declared one and has no span of its own takes the tracks its content needs. */
  minimums?: readonly number[];
  /** `shortRow: share` fills short rows; `leading` leaves them. */
  fill: boolean;
  /** Whether the grid avoids the fold (`fold: page`; always for alarm modes and room-section grids). Never in a sheet or a column pane. */
  follows: boolean;
}

/** One item's CSS grid lines. `column` and `row` are set only while a band splits the grid. */
export interface GridLine { span: number; column?: number; row?: number }

/** The CSS an item takes for its lines: `span n` in plain tracks, `column / span n` and its row around a band. Nothing before the grid is measured. */
export function lineStyle(line: GridLine | undefined): CSSProperties | undefined {
  if (!line) return undefined;
  return { gridColumn: line.column ? `${line.column} / span ${line.span}` : `span ${line.span}`, gridRow: line.row };
}

/** The measured grid: its track count, the CSS tracks and each item's lines. All undefined until the grid is measured. */
export interface FoldedGrid {
  columns?: number;
  template?: string;
  lines?: GridLine[];
  /** Whether the grid is laid out around the hinge band. */
  banded: boolean;
}

/**
 * The tracks of a tile-style grid in this window (`DynamicGridMetrics`): plain columns, an even count where the fold crosses a grid
 * that follows it, or two regions around the band in the book pose. Short rows fill as the app's grid does.
 */
export function useFoldedGrid(ref: RefObject<HTMLElement | null>, options: FoldedGridOptions): FoldedGrid {
  const { fold } = useRender();
  const { minimum, maxColumns, gap, spans: authored, minimums, fill, follows, minimumColumns } = options;
  const frame = useMeasuredFrame(ref, fold ? `${fold.width}:${fold.vertical}:${fold.band?.lower}:${fold.band?.upper}` : '');
  const spanKey = `${authored.join(',')}|${minimums?.join(',') ?? ''}`;
  return useMemo<FoldedGrid>(() => {
    if (frame.width <= 0) return { banded: false };
    const folded = follows && frame.onPage ? gridFold(fold, frame) : undefined;
    // The floor: a cell never has to be wider than what `minimumColumns` columns leave each, so the grid never has fewer.
    const tracks = gridTracks(frame.width, floorMinimum(frame.width, minimum, minimumColumns, gap), maxColumns, gap, folded);
    const narrowest = Math.min(...tracks.tracks.map(track => track.width));
    const count = tracks.side ?? tracks.columns;
    const widened = minimums?.some(item => item > 0) ? contentSpans(authored, minimums, narrowest, count, gap) : authored.map(span => span ?? 1);
    // Content widens a tile only up to its share, so `minimumColumns` tiles still sit across; a span the author set is kept.
    const most = shareOfTracks(count, minimumColumns);
    const spans = widened.map((span, at) => authored[at] === undefined ? Math.min(span, most) : span);
    if (tracks.side && fold?.band) {
      const placements = bandPlacements(spans, tracks.columns, tracks.side, fill);
      const { template, lines } = bandTemplate(tracks, gap, fold.band.upper - fold.band.lower, placements);
      return { columns: tracks.columns, template, lines, banded: true };
    }
    const plan = planGrid(spans, tracks.columns, fill);
    return { columns: plan.columns, banded: false,
      template: plan.widths ? plan.widths.map(part => `${part}fr`).join(' ') : `repeat(${plan.columns}, minmax(0, 1fr))`,
      lines: plan.spans.map(span => ({ span })) };
  }, [frame, fold, minimum, maxColumns, gap, spanKey, fill, follows, minimumColumns]);
}
