import type { PreviewWindow } from './windows';

/** Narrowest pane a split may produce (`SplitPolicy.minimumPaneWidth` in the app). */
export const MINIMUM_PANE_WIDTH = 360;
/** Width of the band between panes when no hinge crosses the window. */
export const MIDPOINT_BAND = 1;
/** The width from which a window is regular (the size class the app reads; a Duo opened upright counts, a folded one does not). */
export const REGULAR_WIDTH = 600;

/** Whether a window is regular width. */
export const isRegularWidth = (width: number) => width >= REGULAR_WIDTH;

/**
 * The app's `SplitPolicy.allowsSplit(size:isRegularWidth:)`, port for port: a split needs a regular-width window that is
 * wider than tall, with each half at least {@link MINIMUM_PANE_WIDTH}. Geometry only, never a device name.
 */
export function allowsSplit(size: { width: number; height: number }, regular: boolean): boolean {
  if (!regular || !(size.width > size.height)) return false;
  return size.width / 2 >= MINIMUM_PANE_WIDTH;
}

/** The area pages draw in: the window less the rail a short window gives the tab bar. */
export const contentSize = (win: PreviewWindow) => ({ width: win.width - (win.rail ?? 0), height: win.height });

/** Pane widths of an open split. */
export interface SplitGeometry { leading: number; band: number; trailing: number; hinge: boolean }

/**
 * `SplitPolicy.columnWidths` for a window that may split: the vertical hinge when one crosses it and leaves each pane at
 * least {@link MINIMUM_PANE_WIDTH}, else the midpoint band. Undefined when the window may not split.
 */
export function splitGeometry(win: PreviewWindow): SplitGeometry | undefined {
  const size = contentSize(win);
  if (!allowsSplit(size, isRegularWidth(win.width))) return undefined;
  const hinge = win.hinge?.axis === 'vertical' ? win.hinge : undefined;
  if (hinge) {
    const leading = hinge.start, trailing = size.width - hinge.start - hinge.length;
    if (leading >= MINIMUM_PANE_WIDTH && trailing >= MINIMUM_PANE_WIDTH) return { leading, band: hinge.length, trailing, hinge: true };
  }
  const leading = Math.floor((size.width - MIDPOINT_BAND) / 2);
  return { leading, band: MIDPOINT_BAND, trailing: size.width - MIDPOINT_BAND - leading, hinge: false };
}

/**
 * Whether the window shows a flyout instead of the tab bar: regular width with no hinge crossing it (`ShellChrome`). A short
 * window that turns the tab bar into a rail (the Duo) keeps the rail.
 */
export const usesFlyout = (win: PreviewWindow) => isRegularWidth(win.width) && !win.hinge && !win.rail;

/** The Window menu's read-out line: "Split view: off" or "Split view: on, 433 and 434 pt". */
export function splitReadout(win: PreviewWindow): string {
  const geometry = splitGeometry(win);
  if (!geometry) return 'Split view: off';
  const round = (value: number) => Math.round(value);
  return `Split view: on, ${round(geometry.leading)} and ${round(geometry.trailing)} pt`;
}
