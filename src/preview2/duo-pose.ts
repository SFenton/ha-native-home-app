/**
 * The Duo's pose as two numbers: how far the device is turned and how far it is opened. Every window the Duo can take is derived
 * from them (`duoWindow` in `windows.ts`), so a transition is a move between two points and no pose is a special case.
 *
 * Turn is clockwise from the closed portrait Duo: 0 is the hinge strip on the left, 90 on the top, 180 on the right, 270 on the
 * bottom. A closed Duo opens like a book about its hinge strip, so a vertical hinge (turn 0 and 180) opens sideways (951 x 669) and a
 * horizontal one (turn 90 and 270) opens upright (669 x 951). Fold and unfold keep the turn.
 *
 * Values marked `interim` are the HIG rule (`build/design/studio-duo-sim/proposal.md`, D3) applied to R1's closed portrait numbers, and are
 * replaced by a measurement where R1 reports one. R1 measured the closed portrait only (the Accessibility grant is missing for the rest).
 */

/** A quarter turn clockwise from the closed portrait Duo. */
export type Turn = 0 | 90 | 180 | 270;
/** How far the Duo is opened: closed (the outer display), partly folded (a book, 144 degrees) or open flat. */
export type Fold = 'closed' | 'partly' | 'open';
/** The two numbers that decide every Duo window. */
export interface DuoPose { turn: Turn; fold: Fold }

/** Every turn, in the order a clockwise rotation visits them. */
export const turns: readonly Turn[] = [0, 90, 180, 270];
/** Every fold, from closed to open. */
export const folds: readonly Fold[] = ['closed', 'partly', 'open'];
/** What choosing iPhone Duo opens: flat and sideways, turn 0. */
export const DEFAULT_DUO_POSE: DuoPose = { turn: 0, fold: 'open' };

/** The turn a quarter further round, clockwise (`Rotate Right`) or counter-clockwise (`Rotate Left`). */
export const turnedBy = (turn: Turn, direction: 'left' | 'right'): Turn => ((turn + (direction === 'right' ? 90 : 270)) % 360) as Turn;
/** The pose a quarter turn on. Fold and unfold keep the turn, and a turn keeps the fold. */
export const rotatedPose = (pose: DuoPose, direction: 'left' | 'right'): DuoPose => ({ turn: turnedBy(pose.turn, direction), fold: pose.fold });
/** The pose with another fold, the turn kept. */
export const foldedPose = (pose: DuoPose, fold: Fold): DuoPose => ({ turn: pose.turn, fold });
/** Whether two poses are the same. */
export const samePose = (a: DuoPose | undefined, b: DuoPose | undefined) => a?.turn === b?.turn && a?.fold === b?.fold;
/** The signed quarter or half turn (degrees, -180 to 180) from one turn to another by the shorter way: a clockwise click is +90. */
export const turnDelta = (from: Turn, to: Turn): number => ((to - from + 540) % 360) - 180;

/** The axis the hinge runs along: vertical when the Duo's hinge strip is on the left or right (turn 0 and 180). */
export const hingeAxisOf = (turn: Turn): 'vertical' | 'horizontal' => turn % 180 === 0 ? 'vertical' : 'horizontal';
/** Which edge of the closed body carries the hinge strip, in the closed Duo's own window. */
export const hingeEdgeOf = (turn: Turn): 'left' | 'top' | 'right' | 'bottom' => (['left', 'top', 'right', 'bottom'] as const)[turn / 90];
/** Whether the half that is first in reading order (left or top) is the cover that swings over the other when the Duo closes. */
export const coverIsFirst = (turn: Turn): boolean => turn < 180;

/** Which screen edge a vertical rail takes. `leading` is the left edge in a left-to-right language (`UIVerticalBarEdge`). */
export type RailSide = 'leading' | 'trailing';
/** The corner of the closed window that holds the outer camera. */
export interface CameraCorner { horizontal: 'left' | 'right'; vertical: 'top' | 'bottom' }
/** A rectangle in window points. */
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * The closed portrait Duo as R1 measured it (`build/evidence/studio-duo-sim/r1`, `data/closed-t0-sheets.jsonl`, 466 x 678 pt): the camera's
 * occlusion region, 37 x 37 at (399.67, 29.33), and the keep-clear region above the rail, 84 x 170 at (382, 0). R1 measured this pose
 * only; the other three turns are these rectangles carried round the window (`turnRect`) and carry `interim`.
 */
export const CLOSED_PORTRAIT = { width: 466, height: 678 } as const;
export const R1_OCCLUSION: Rect = { x: 399.67, y: 29.33, width: 37, height: 37 };
export const R1_KEEP_CLEAR: Rect = { x: 382, y: 0, width: 84, height: 170 };

/** A rectangle of the closed portrait window carried a quarter turn clockwise `quarters` times: its own window turns with it. */
export function turnRect(rect: Rect, quarters: number): Rect {
  let out = rect, width: number = CLOSED_PORTRAIT.width, height: number = CLOSED_PORTRAIT.height;
  for (let step = 0; step < quarters; step += 1) {
    out = { x: height - (out.y + out.height), y: out.x, width: out.height, height: out.width };
    [width, height] = [height, width];
  }
  return out;
}

/** The camera's corner at a turn, from where the region sits in the turned window. */
export function cameraCornerOf(turn: Turn): CameraCorner {
  const quarters = turn / 90, window = turn % 180 === 0 ? CLOSED_PORTRAIT : { width: CLOSED_PORTRAIT.height, height: CLOSED_PORTRAIT.width };
  const region = turnRect(R1_OCCLUSION, quarters);
  return { horizontal: region.x + region.width / 2 > window.width / 2 ? 'right' : 'left', vertical: region.y + region.height / 2 > window.height / 2 ? 'bottom' : 'top' };
}

/**
 * The rail's edge on the closed Duo: the vertical screen edge that holds the camera corner (HIG, Vertical controls: they "align to the
 * hardware, keeping their position relative to the outer camera"). Trailing at turn 0 (R1: `verticalBarEdge` trailing), where the camera is
 * on the right; the other turns follow the camera and are `interim`.
 */
export const closedRailSide = (turn: Turn): RailSide => cameraCornerOf(turn).horizontal === 'right' ? 'trailing' : 'leading';
/** The rail's edge on the open Duo: with the hinge vertical it keeps the closed edge of that turn, and horizontal bars (no rail) when upright. */
export const openRailSide = (turn: Turn): RailSide | undefined => hingeAxisOf(turn) === 'vertical' ? closedRailSide(turn) : undefined;

/** The outer camera in the closed window, in points. */
export interface CameraCutout {
  corner: CameraCorner;
  /** The camera's occlusion region (R1 turn 0). */
  occlusion: Rect;
  /** The region the app keeps clear of controls: the status items sit in it, and the rail starts after it. */
  keepClear: Rect;
  /**
   * Where the status items and the rail's start sit: the keep-clear region confined to the rail column, so the time and the connection mark
   * stack past the camera on the rail at every turn and never reach the content beside it (at a quarter turn the keep-clear itself is wider than the rail).
   */
  statusColumn: Rect;
  /** Whether the numbers are carried round from the closed portrait rather than measured: every turn but 0. */
  interim: boolean;
  /** The camera centre and the occlusion's width, for drawing. */
  x: number; y: number; size: number;
}
/** The camera of the closed Duo at a turn: R1's rectangles carried round the window. */
export function cameraCutout(turn: Turn): CameraCutout {
  const quarters = turn / 90, occlusion = turnRect(R1_OCCLUSION, quarters), keepClear = turnRect(R1_KEEP_CLEAR, quarters);
  const corner = cameraCornerOf(turn), window = turn % 180 === 0 ? CLOSED_PORTRAIT : { width: CLOSED_PORTRAIT.height, height: CLOSED_PORTRAIT.width };
  const column = R1_KEEP_CLEAR.width, reach = R1_KEEP_CLEAR.height;
  const statusColumn: Rect = { x: corner.horizontal === 'right' ? window.width - column : 0, y: corner.vertical === 'top' ? 0 : window.height - reach, width: column, height: reach };
  return {
    corner, occlusion, keepClear, statusColumn, interim: turn !== 0,
    x: occlusion.x + occlusion.width / 2, y: occlusion.y + occlusion.height / 2, size: occlusion.width,
  };
}

/** The half-open angles of the book pose and the swing: each half of a partly folded Duo tilts 18 degrees toward the viewer (interior angle 144). */
export const BOOK_TILT = 18;
/** The two halves' tilt per fold: the cover (the half that swings over the other) and the base, in degrees. */
export function tiltOf(fold: Fold): { cover: number; base: number } {
  return fold === 'closed' ? { cover: 180, base: 0 } : fold === 'partly' ? { cover: BOOK_TILT, base: BOOK_TILT } : { cover: 0, base: 0 };
}
