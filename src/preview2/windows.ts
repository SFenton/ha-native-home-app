import { RAIL } from './rail-constants';
import { cameraCutout, closedRailSide, hingeAxisOf, openRailSide, samePose, type CameraCutout, type DuoPose, type RailSide } from './duo-pose';

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
 * Duo simulator profile (the screen masks and the `phone15` chrome) where measured. The closed Duo's camera and rail edge per turn
 * come from the pose (`duo-pose.ts`), and the Dynamic Island on either Duo display stays unmeasured (R1) and is not drawn.
 */
export interface BodyFrame {
  bezel: number;
  screenRadii: Radii;
  bodyRadii: Radii;
  hingeStrip?: HingeStrip;
}

/** Where the Dynamic Island sits on each Duo display during a Live Activity. Unset: R1 did not place it. No island is drawn on any Duo window until it is. */
export const DUO_ISLAND_AT: { x: number; y: number; width: number; height: number } | undefined = undefined;

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
  /** Whether the window's numbers are carried round from a measured pose rather than measured (the closed Duo at every turn but 0). */
  interim?: boolean;
  /**
   * Whether the window draws a Dynamic Island. Only the iPhone does: the Duo's inner display has no cutout (an under-display camera),
   * and where the island sits on either Duo display is unmeasured (R1, `build/research/studio-duosim.md`), so none is drawn.
   */
  island?: boolean;
  /** The body drawn around it when the preview shows a bezel. */
  frame: BodyFrame;
  /** The Duo's pose (turn and fold) this window is drawn in. Absent for a device that does not fold. */
  pose?: DuoPose;
  /** The screen edge the rail takes. Absent: trailing (the rail is trailing wherever the window has one and says nothing). */
  railSide?: RailSide;
  /** The closed Duo's outer camera: its occlusion and keep-clear regions, in window points. `interim` beyond turn 0 (R1). */
  camera?: CameraCutout;
}

/**
 * The windows the preview offers, by size (atlas device table, `studio-ux-sh-patterns.md`): iPhone first, then the Duo
 * folded, open upright and open sideways, then the iPad upright and sideways. Opened, the Duo is flat with no band in either
 * direction; partly folded it carries a band across the window: horizontal upright (the app ignores it), vertical sideways (a book).
 */
export const previewWindows: readonly PreviewWindow[] = [
  { name: 'iPhone', width: 402, height: 874, safeTop: 62, safeBottom: 34, island: true, frame: PHONE_BODY },
  { name: 'Duo folded', width: 466, height: 678, safeTop: 24, safeBottom: 34, rail: 84, frame: FOLDED_DUO_BODY, pose: { turn: 0, fold: 'closed' } },
  // safeTop 62 is an iPhone figure the atlas kit (24) disagrees with; no measured source until R1.
  // The horizontal band is the fold's centre by symmetry (the fold bisects the 951 pt side): computed, not measured.
  { name: 'Duo open, upright', width: 669, height: 951, safeTop: 62, safeBottom: 34, bookHinge: { axis: 'horizontal', start: 455.3, length: 40.4 }, frame: OPEN_DUO_BODY, pose: { turn: 90, fold: 'open' } },
  { name: 'Duo open, sideways', width: 951, height: 669, safeTop: 24, safeBottom: 0, rail: 83, bookHinge: { axis: 'vertical', start: 455.3, length: 40.4 }, frame: OPEN_DUO_BODY, pose: { turn: 0, fold: 'open' } },
  { name: 'iPad upright', width: 834, height: 1194, safeTop: 24, safeBottom: 20, frame: PHONE_BODY },
  { name: 'iPad sideways', width: 1194, height: 834, safeTop: 24, safeBottom: 20, frame: PHONE_BODY },
  // Last in the list so the indexes of the older windows hold. The folded Duo turned a quarter: the outer display transposed (678 x 466), the rail on its camera's edge. R1 measured the portrait only: its bottom inset (34) and rail inset (84) are kept here, interim.
  { name: 'Duo folded, sideways', width: 678, height: 466, safeTop: 24, safeBottom: 34, rail: 84, frame: FOLDED_DUO_BODY, pose: { turn: 90, fold: 'closed' } },
];

/** The words for a window: its name alone. The size is the window's own business; a person picks a device, not a measure. */
export const windowLabel = (item: PreviewWindow) => item.name;

/** A window that can take the book pose. */
export const canBook = (win: PreviewWindow) => win.bookHinge !== undefined;
/** The window in the book pose (its hinge crosses it), or flat again. */
export const withPose = (win: PreviewWindow, pose: 'flat' | 'book'): PreviewWindow => {
  const base = previewWindows.find(item => item.name === win.name) ?? win;
  if (base.pose && base.bookHinge) return duoWindow({ turn: win.pose?.turn ?? base.pose.turn, fold: pose === 'book' ? 'partly' : 'open' });
  return { ...base, hinge: base.hinge };
};
/** Whether a window is in the book pose. */
export const isBook = (win: PreviewWindow) => win.bookHinge !== undefined && win.hinge !== undefined;

/** The window's size by its name in {@link previewWindows}. */
const named = (name: string) => previewWindows.find(item => item.name === name) as PreviewWindow;
const duoCache = new Map<string, PreviewWindow>();

/**
 * The Duo window for a pose. Closed, the outer display (466 x 678, or 678 x 466 turned) with its rail on the camera's edge and the
 * camera cutout; open, the inner display with a rail when its hinge is vertical; partly folded, the open window with its band. The
 * same pose always gives the same object, so a memo keyed on the window holds across renders.
 */
export function duoWindow(pose: DuoPose): PreviewWindow {
  const key = `${pose.turn}:${pose.fold}`, held = duoCache.get(key);
  if (held) return held;
  const vertical = hingeAxisOf(pose.turn) === 'vertical', closed = pose.fold === 'closed';
  const base = named(closed ? (vertical ? 'Duo folded' : 'Duo folded, sideways') : (vertical ? 'Duo open, sideways' : 'Duo open, upright'));
  const side = closed ? closedRailSide(pose.turn) : openRailSide(pose.turn);
  const made: PreviewWindow = {
    ...base, pose: { turn: pose.turn, fold: pose.fold }, hinge: pose.fold === 'partly' ? base.bookHinge : undefined,
    ...(base.rail !== undefined && side ? { railSide: side } : {}), ...(closed ? { camera: cameraCutout(pose.turn), ...(pose.turn !== 0 ? { interim: true } : {}) } : {}),
  };
  duoCache.set(key, made);
  return made;
}

/** The Duo's pose of a window: its own, or the one its name and hinge say. Undefined for a device that does not fold. */
export function poseOfWindow(win: PreviewWindow): DuoPose | undefined {
  if (win.pose) return win.pose;
  const base = previewWindows.find(item => item.name === win.name);
  return base?.pose ? { turn: base.pose.turn, fold: win.hinge ? 'partly' : base.pose.fold } : undefined;
}

/** The screen edge a window's rail takes. */
export const railSideOf = (win: PreviewWindow): RailSide => win.railSide ?? 'trailing';

/** Whether two windows are the same pose of the same device. */
export const sameWindow = (a: PreviewWindow, b: PreviewWindow) => a.name === b.name && samePose(a.pose, b.pose) && Boolean(a.hinge) === Boolean(b.hinge);

/** The rail's centre line in a window, from its left edge: 48 pt in from the camera-side edge. */
export const railCentre = (win: PreviewWindow): number => railSideOf(win) === 'leading' ? RAIL.centre : win.width - RAIL.centre;
