import { railSideOf, type PreviewWindow } from './windows';

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

/**
 * Whether the system draws the bars on a vertical edge: the Duo folded and unfolded sideways, where the tab bar becomes the rail
 * (`shellInVerticalBar`, `toolbarVerticalEdge`), on the edge `railSideOf` names. Geometry again: a window gets a rail width or it does not. Unfolded upright has horizontal bars.
 */
export const inVerticalBar = (win: PreviewWindow) => win.rail !== undefined;

/** The area pages draw in: the window less the rail a short window gives the tab bar. */
export const contentSize = (win: PreviewWindow) => ({ width: win.width - (win.rail ?? 0), height: win.height });

/** Where the content area starts, in window points: the rail's width when the rail is on the leading edge, else 0. */
export const contentOrigin = (win: PreviewWindow) => win.rail !== undefined && railSideOf(win) === 'leading' ? win.rail : 0;

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
    // The band is in window points; the panes are what is left of the content area on each side of it.
    const leading = hinge.start - contentOrigin(win), trailing = size.width - leading - hinge.length;
    if (leading >= MINIMUM_PANE_WIDTH && trailing >= MINIMUM_PANE_WIDTH) return { leading, band: hinge.length, trailing, hinge: true };
  }
  const leading = Math.floor((size.width - MIDPOINT_BAND) / 2);
  return { leading, band: MIDPOINT_BAND, trailing: size.width - MIDPOINT_BAND - leading, hinge: false };
}

/**
 * Whether the system draws the tabs at the top of the window, in the navigation bar's row, with no menu button (proposal `global-chrome`, section 1): regular width with no hinge and
 * no rail, the full-screen iPad in both orientations. `UITabBarController` places the bar from the size class; the preview tests the same geometry. A Duo keeps its bottom bar or its rail.
 */
export const tabsAtTop = (win: PreviewWindow) => isRegularWidth(win.width) && !win.hinge && !win.bookHinge && !win.rail;

/** The Window menu's read-out line: "Split view: off" or "Split view: on, 433 and 434 pt". */
export function splitReadout(win: PreviewWindow): string {
  const geometry = splitGeometry(win);
  if (!geometry) return 'Split view: off';
  const round = (value: number) => Math.round(value);
  return `Split view: on, ${round(geometry.leading)} and ${round(geometry.trailing)} pt`;
}
