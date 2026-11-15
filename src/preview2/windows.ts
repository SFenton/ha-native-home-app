/** A vertical or horizontal band the device cannot draw on, in window points. */
export interface Hinge { axis: 'vertical' | 'horizontal'; /** Where the band starts, along its axis' perpendicular. */ start: number; /** The band's thickness. */ length: number }

/** A window in points. Layout is geometric: never branch on `name`. */
export interface PreviewWindow {
  name: string; width: number; height: number; safeTop: number; safeBottom: number;
  /** The fold, when one crosses the window in this pose. */
  hinge?: Hinge;
  /** The pose the same window can take with its hinge crossing it (the Duo opened like a book). */
  bookHinge?: Hinge;
  /** Width of the vertical rail the tab bar becomes in a short window; the app's content (and a split) uses what is left. */
  rail?: number;
}

/**
 * The windows the preview offers, by size (atlas device table, `studio-ux-sh-patterns.md`): iPhone first, then the Duo
 * folded, open upright and open sideways, then the iPad upright and sideways. The Duo upright always has its horizontal hinge;
 * sideways it has none when flat and a vertical one when opened like a book.
 */
export const previewWindows: readonly PreviewWindow[] = [
  { name: 'iPhone', width: 402, height: 874, safeTop: 62, safeBottom: 34 },
  { name: 'Duo folded', width: 466, height: 678, safeTop: 24, safeBottom: 0, rail: 83 },
  { name: 'Duo open, upright', width: 669, height: 951, safeTop: 62, safeBottom: 34, hinge: { axis: 'horizontal', start: 455.3, length: 40.4 } },
  { name: 'Duo open, sideways', width: 951, height: 669, safeTop: 24, safeBottom: 0, rail: 83, bookHinge: { axis: 'vertical', start: 455.3, length: 40.4 } },
  { name: 'iPad upright', width: 834, height: 1194, safeTop: 24, safeBottom: 20 },
  { name: 'iPad sideways', width: 1194, height: 834, safeTop: 24, safeBottom: 20 },
];

/** The words for a window: its name and size. */
export const windowLabel = (item: PreviewWindow) => `${item.name} · ${item.width} × ${item.height}`;

/** A window that can take the book pose. */
export const canBook = (win: PreviewWindow) => win.bookHinge !== undefined;
/** The window in the book pose (its hinge crosses it), or flat again. */
export const withPose = (win: PreviewWindow, pose: 'flat' | 'book'): PreviewWindow => {
  const base = previewWindows.find(item => item.name === win.name) ?? win;
  return pose === 'book' && base.bookHinge ? { ...base, hinge: base.bookHinge } : { ...base, hinge: base.hinge };
};
/** Whether a window is in the book pose. */
export const isBook = (win: PreviewWindow) => win.bookHinge !== undefined && win.hinge?.axis === 'vertical';
