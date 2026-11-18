import { contentOrigin, isRegularWidth } from './split';
import type { PreviewWindow } from './windows';

/** The 580 x 660 form sheet on iPad (`HassFormSheetSize`, measured on iOS 26 and 27). */
export const FORM_SHEET = { width: 580, height: 660 } as const;
/** The page sheet's width on iPad: the atlas figure (`chrome.js`), not yet measured on a device. */
export const PAGE_SHEET_WIDTH = 704;
/** A sheet in the Duo's leading half sits this far in from the window's leading, top and bottom edges (`DuoSheetPolicy.halfMargin`). */
export const HALF_MARGIN = 8;
/** The width of the division between a flat page's halves (`DuoSheetPolicy.midpointBand`). */
export const HALF_MIDPOINT_BAND = 1;

/**
 * The width of the sheet the Duo opened flat upright presents from the bottom edge, in points. Undefined means the window's full width:
 * the owner saw the native sheet anchored to the bottom in this pose (G18), but its width is not measured, so none is guessed.
 * R1 (`build/research/studio-duosim.md`, section 7) measures the presented frame; set the width here when it reports.
 */
export const DUO_PORTRAIT_SHEET_WIDTH: number | undefined = undefined;

/**
 * Where a presented sheet sits in a window:
 * - `bottom`: rising from the bottom edge, full width unless `width` says (compact windows: iPhone, the folded Duo; the Duo flat upright).
 * - `leading`: the leading half beside a vertical hinge or the Duo's rail, full height (`UKSheetPlacement`, `DuoSheetPolicy`).
 * - `center`: a centred form or page sheet (iPad, the Duo partly folded upright).
 * - `cover`: a full-screen sheet over the whole window.
 */
export interface SheetFrame {
  placement: 'bottom' | 'leading' | 'center' | 'cover';
  /** The sheet's width in points; undefined means the window's width. */
  width?: number;
  /** The sheet's height in points when it is fixed (the leading half's full height); undefined sizes to content. */
  height?: number;
  /** The most the sheet may grow to (the form sheet's 660). */
  maxHeight?: number;
  /** Whether the sheet fills the window's height from the bottom (`DuoSheetPolicy.fillsHeight`). */
  fillsHeight: boolean;
}

/** The part of a sheet's presentation that decides its frame. */
export interface SheetPresentation { width: 'form' | 'page'; fullScreen?: boolean }

/** The width of the leading half: ends at the hinge when one folds the window, else before the midpoint of the free width (`leadingHalfWidth`). */
export function leadingHalfWidth(win: PreviewWindow): number {
  const free = win.width - (win.rail ?? 0);
  const hinge = win.hinge?.axis === 'vertical' ? win.hinge : undefined;
  // The leading half starts after a leading rail, so the hinge's place is counted from there.
  const end = hinge ? hinge.start - contentOrigin(win) : (free - HALF_MIDPOINT_BAND) / 2;
  return Math.max(0, Math.floor(end - HALF_MARGIN));
}

/**
 * The app's sheet placement as geometry, never a device name: compact windows take the full width; a window with a vertical
 * hinge or the rail (the Duo landscape) takes the leading half at full height; the Duo flat upright rises from the bottom, full width
 * until measured; any other regular window (iPad, the Duo partly folded upright) centres the form sheet (580 x 660) or the page sheet by `presentation.width`.
 */
export function sheetFrame(win: PreviewWindow, presentation: SheetPresentation): SheetFrame {
  if (presentation.fullScreen) return { placement: 'cover', fillsHeight: true };
  if (!isRegularWidth(win.width)) return { placement: 'bottom', fillsHeight: win.rail !== undefined };
  if (win.rail !== undefined || win.hinge?.axis === 'vertical')
    return { placement: 'leading', width: leadingHalfWidth(win), height: Math.floor(win.height - 2 * HALF_MARGIN), fillsHeight: true };
  // The Duo opened flat upright (a window that can hinge, no rail, no band): the owner saw the native sheet rise from the bottom (G18).
  // Partly folded upright (a horizontal band) is unmeasured: R1, so it keeps the centred iPad frames below.
  if (win.bookHinge !== undefined && win.hinge === undefined) return { placement: 'bottom', width: DUO_PORTRAIT_SHEET_WIDTH, fillsHeight: false };
  if (presentation.width === 'form') return { placement: 'center', width: FORM_SHEET.width, maxHeight: FORM_SHEET.height, fillsHeight: false };
  return { placement: 'center', width: Math.min(PAGE_SHEET_WIDTH, win.width), fillsHeight: false };
}

/** Whether the page behind a sheet scales back: only in compact width, where the system draws the card effect. */
export const scalesBackBehindSheet = (win: PreviewWindow): boolean => !isRegularWidth(win.width);
