/** A vertical or horizontal band the device cannot draw on, in window points. */
export interface Hinge { axis: 'vertical' | 'horizontal'; /** Where the band starts, along its axis' perpendicular. */ start: number; /** The band's thickness. */ length: number }

/** Four corner radii in points, clockwise from the top left: top left, top right, bottom right, bottom left. */
export type Radii = readonly [number, number, number, number];

/** The strip along the folded Duo's hinge side, drawn proud of the body (Xcode's `phone15` chrome art). */
export interface HingeStrip {
  /** The strip's width. */
  width: number;
  /** How far it stands outside the body's leading edge; the rest overlaps the bezel. */
  outside: number;
  /** The strip's height; it is centred on the body. */
  height: number;
  /** The radius of its two outer corners. */
  radius: number;
}

/**
 * The body drawn around a window, in points: the bezel, the screen's corners and the body's own corners. Values come from Apple's
 * Duo simulator profile (the screen masks and the `phone15` chrome) where measured; the camera cutout, the Dynamic Island and a
 * folded landscape window are held until the simulator measurement R1 (`build/research/studio-duosim.md`, section 7) and are not
 * drawn: `camera`, `islandAt` and `railSide` stay unset here until it reports.
 */
export interface BodyFrame {
  bezel: number;
  screenRadii: Radii;
  bodyRadii: Radii;
  hingeStrip?: HingeStrip;
  /** The outer camera's cutout, in window points. Unset: its corner, size and offset are unmeasured (R1). */
  camera?: { x: number; y: number; width: number; height: number };
  /** The side the folded Duo's rail takes in a rotation. Unset: unmeasured (R1); the rail stays trailing. */
  railSide?: 'leading' | 'trailing';
}

// MARK: - Held until the simulator measurement (R1)
// Each constant below is deliberately unset. Nothing in the repo or in Apple's pages measures it
// (`build/research/studio-duosim.md`, sections 3a and 7); R1 records it on "iPhone Duo (HASS)". Do not guess a value: set it when R1 reports.

/** The outer camera's cutout on the folded Duo: its corner, size and offset in window points. Unset: R1. */
export const DUO_CAMERA_CUTOUT: BodyFrame['camera'] = undefined;
/** Where the Dynamic Island sits on each Duo display during a Live Activity. Unset: R1. No island is drawn on any Duo window until it is. */
export const DUO_ISLAND_AT: { x: number; y: number; width: number; height: number } | undefined = undefined;
/** Which side the folded Duo's rail takes per rotation. Unset: R1; the rail stays on the trailing edge and the folded Duo has no sideways window. */
export const DUO_FOLDED_RAIL_SIDE: BodyFrame['railSide'] = undefined;
/** The folded Duo turned a quarter (678 x 466 by transposition) with its safe areas and rail. Unset: R1; Rotate stays dimmed when folded. */
export const DUO_FOLDED_LANDSCAPE: { width: number; height: number; safeTop: number; safeBottom: number; rail: number } | undefined = undefined;

/** A set of corner radii as a CSS `border-radius` value. */
export const radiiCss = (radii: Radii) => radii.map(value => `${value}px`).join(' ');

/** The iPhone-shaped body: 12 pt bezel, 55 pt screen corners, 67 pt body corners (the Studio's long-standing frame). */
export const PHONE_BODY: BodyFrame = { bezel: 12, screenRadii: [55, 55, 55, 55], bodyRadii: [67, 67, 67, 67] };
/**
 * The folded Duo's outer display (466 x 678): corners 8 pt on the hinge side and 59 pt on the free side, a 14 pt bezel, body corners
 * about 1 and 69 pt and a 14 pt hinge strip standing 9 pt outside the body (`phone15` chrome, measured on this machine's Xcode 27.1).
 */
export const FOLDED_DUO_BODY: BodyFrame = {
  bezel: 14, screenRadii: [8, 59, 59, 8], bodyRadii: [1, 69, 69, 1], hingeStrip: { width: 14, outside: 9, height: 693, radius: 7 },
  camera: DUO_CAMERA_CUTOUT, railSide: DUO_FOLDED_RAIL_SIDE,
};
/**
 * The opened Duo's inner display: 55 pt screen corners (the profile). The 20 pt bezel is computed from Apple's open size and the
 * panel, and the body radius is screen plus bezel by convention: Apple draws no Duo-specific art for the open body (flagged, medium).
 */
export const OPEN_DUO_BODY: BodyFrame = { bezel: 20, screenRadii: [55, 55, 55, 55], bodyRadii: [75, 75, 75, 75] };

/** A window in points. Layout is geometric: never branch on `name`. */
export interface PreviewWindow {
  name: string; width: number; height: number; safeTop: number; safeBottom: number;
  /** The fold, when one crosses the window in this pose. */
  hinge?: Hinge;
  /** The pose the same window can take with its hinge crossing it (the Duo opened like a book). */
  bookHinge?: Hinge;
  /** Width of the vertical rail the tab bar becomes in a short window; the app's content (and a split) uses what is left. */
  rail?: number;
  /**
   * Whether the window draws a Dynamic Island. Only the iPhone does: the Duo's inner display has no cutout (an under-display camera),
   * and where the island sits on either Duo display is unmeasured (R1, `build/research/studio-duosim.md`), so none is drawn.
   */
  island?: boolean;
  /** The body drawn around it when the preview shows a bezel. */
  frame: BodyFrame;
}

/**
 * The windows the preview offers, by size (atlas device table, `studio-ux-sh-patterns.md`): iPhone first, then the Duo
 * folded, open upright and open sideways, then the iPad upright and sideways. Opened, the Duo is flat with no band in either
 * direction; partly folded it carries a band across the window: horizontal upright (the app ignores it), vertical sideways (a book).
 */
export const previewWindows: readonly PreviewWindow[] = [
  { name: 'iPhone', width: 402, height: 874, safeTop: 62, safeBottom: 34, island: true, frame: PHONE_BODY },
  { name: 'Duo folded', width: 466, height: 678, safeTop: 24, safeBottom: 0, rail: 83, frame: FOLDED_DUO_BODY },
  // safeTop 62 is an iPhone figure the atlas kit (24) disagrees with; no measured source until R1.
  // The horizontal band is the fold's centre by symmetry (the fold bisects the 951 pt side): computed, not measured.
  { name: 'Duo open, upright', width: 669, height: 951, safeTop: 62, safeBottom: 34, bookHinge: { axis: 'horizontal', start: 455.3, length: 40.4 }, frame: OPEN_DUO_BODY },
  { name: 'Duo open, sideways', width: 951, height: 669, safeTop: 24, safeBottom: 0, rail: 83, bookHinge: { axis: 'vertical', start: 455.3, length: 40.4 }, frame: OPEN_DUO_BODY },
  { name: 'iPad upright', width: 834, height: 1194, safeTop: 24, safeBottom: 20, frame: PHONE_BODY },
  { name: 'iPad sideways', width: 1194, height: 834, safeTop: 24, safeBottom: 20, frame: PHONE_BODY },
];

/** The words for a window: its name alone. The size is the window's own business; a person picks a device, not a measure. */
export const windowLabel = (item: PreviewWindow) => item.name;

/** A window that can take the book pose. */
export const canBook = (win: PreviewWindow) => win.bookHinge !== undefined;
/** The window in the book pose (its hinge crosses it), or flat again. */
export const withPose = (win: PreviewWindow, pose: 'flat' | 'book'): PreviewWindow => {
  const base = previewWindows.find(item => item.name === win.name) ?? win;
  return pose === 'book' && base.bookHinge ? { ...base, hinge: base.bookHinge } : { ...base, hinge: base.hinge };
};
/** Whether a window is in the book pose. */
export const isBook = (win: PreviewWindow) => win.bookHinge !== undefined && win.hinge !== undefined;
