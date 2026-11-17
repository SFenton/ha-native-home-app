import type { FoldBand, GridFold } from './grid';
import { isRegularWidth } from './split';
import type { PreviewWindow } from './windows';

/**
 * The window's fold as the app publishes it (`WindowFold`, `UKHinge`): a vertical hinge exists in either pose of a Duo opened
 * sideways, and the band only while it is partly folded (the book pose).
 */
export interface WindowFold {
  /** The window's width in points (a Duo opened sideways is 951). */
  width: number;
  /** The trailing rail's width; zero when the window has none. */
  rail: number;
  /** Whether a vertical hinge exists in this pose, flat or book (`UKHinge.hasFold`). Unfolded upright (a horizontal hinge) is false. */
  vertical: boolean;
  /** The band the content must keep clear, in window points, while partly folded. */
  band?: FoldBand;
  /** Whether the window is partly folded (the book pose). */
  book: boolean;
  /** Whether the window is regular width, the size class the room sections read. */
  regular: boolean;
}

/** The fold of a preview window: what every drawn grid reads from the render context. */
export function windowFold(win: PreviewWindow): WindowFold {
  const band = win.hinge?.axis === 'vertical' ? win.hinge : undefined;
  return {
    width: win.width, rail: win.rail ?? 0, vertical: band !== undefined || win.bookHinge?.axis === 'vertical', book: band !== undefined,
    band: band ? { lower: band.start, upper: band.start + band.length } : undefined, regular: isRegularWidth(win.width),
  };
}

/** A grid's frame in window points. */
export interface GridFrame { x: number; width: number }

/**
 * `UKHinge.crossesFold`: whether the fold passes through a grid's frame, the band's middle while partly folded, else the window's
 * midpoint (lying flat). A grid that sits wholly on one side of it is not divided and keeps its own count.
 */
export function crossesFold(fold: WindowFold, frame: GridFrame): boolean {
  const middle = fold.band ? (fold.band.lower + fold.band.upper) / 2 : fold.width / 2;
  return frame.x + 1 < middle && middle < frame.x + frame.width - 1;
}

/**
 * What the fold asks of a grid that follows it (`UKDynamicGridView.solution`): an even track count when a vertical hinge exists and
 * crosses the grid, in either pose; the band, in grid offsets (`HingeAvoidance.band`, the frame rounded), only while partly folded.
 * Undefined when the grid does not follow the fold, or no vertical hinge exists.
 */
export function gridFold(fold: WindowFold | undefined, frame: GridFrame): GridFold | undefined {
  if (!fold?.vertical) return undefined;
  const even = crossesFold(fold, frame);
  const x = Math.round(frame.x), width = Math.round(frame.width);
  const middle = fold.band ? (fold.band.lower + fold.band.upper) / 2 : undefined;
  const band = fold.band && middle !== undefined && middle > x && middle < x + width
    ? { lower: Math.max(fold.band.lower, x) - x, upper: Math.min(fold.band.upper, x + width) - x } : undefined;
  return { even, band };
}

/**
 * The Window menu's fold line: "Fold: book, band 455 to 496 pt", "Fold: flat", "Fold: hinge across the page, layout unchanged" for the
 * Duo partly folded upright, or "Fold: none" where no hinge exists.
 */
export function foldReadout(win: PreviewWindow): string {
  const fold = windowFold(win);
  if (win.hinge?.axis === 'horizontal') return 'Fold: hinge across the page, layout unchanged';
  if (!fold.vertical) return 'Fold: none';
  if (!fold.band) return 'Fold: flat';
  return `Fold: book, band ${Math.round(fold.band.lower)} to ${Math.round(fold.band.upper)} pt`;
}
