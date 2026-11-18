import { HOLD_MOVE_PX } from './rail-constants';

/**
 * The tab bar's press-and-hold as a pure state machine (`studio-sim-rails`, S6). Native is the system tab bar, which asks `shouldSelect` once,
 * when the touch ends: a tab is only selected when it is released. A press arms; after `HOLD_MS`, or at once when the pointer travels
 * `HOLD_MOVE_PX`, it is held (labels and the lens show); while held the pointer picks the tab under it by geometry; the release commits the tab under
 * the lens, and a release outside the bar commits the last tab the pointer was over (native: it does not cancel); a cancelled pointer or Escape selects nothing. A press that ends before it is held is a
 * tap, which the browser's own click commits, so the machine never does.
 */

/** Where the press is. */
export type HoldPhase = 'idle' | 'armed' | 'held';

/** A point in screen pixels. */
export interface HoldPoint { x: number; y: number }

/** The machine's state: the phase, the tab under the pointer, and where the press began. */
export interface HoldState {
  phase: HoldPhase;
  /** The tab the press began on, then the one under the lens. */
  index: number;
  origin: HoldPoint;
}

/** What can happen to a press. */
export type HoldEvent =
  | { type: 'press'; index: number; at: HoldPoint }
  /** The pointer moved: `index` is the tab nearest it along the bar's axis. */
  | { type: 'move'; index: number; at: HoldPoint }
  /** `HOLD_MS` ran out. */
  | { type: 'timer' }
  /** The touch ended; `index` is the tab nearest it, and `inside` says whether it ended over the bar. */
  | { type: 'release'; index: number; inside: boolean }
  /** The pointer was cancelled, or Escape was pressed. */
  | { type: 'cancel' };

/** The step's result: the next state, and the tab to select when a held press ended. */
export interface HoldStep { state: HoldState; commit?: number }

/** The state before any press. */
export const idleHold: HoldState = { phase: 'idle', index: 0, origin: { x: 0, y: 0 } };

/** One step of the machine. A held press that ends is the only thing that commits. */
export function holdStep(state: HoldState, event: HoldEvent): HoldStep {
  switch (event.type) {
    case 'press':
      return state.phase === 'idle' ? { state: { phase: 'armed', index: event.index, origin: event.at } } : { state };
    case 'move': {
      if (state.phase === 'held') return { state: { ...state, index: event.index } };
      if (state.phase === 'armed' && Math.hypot(event.at.x - state.origin.x, event.at.y - state.origin.y) >= HOLD_MOVE_PX) return { state: { ...state, phase: 'held', index: event.index } };
      return { state };
    }
    case 'timer':
      return { state: state.phase === 'armed' ? { ...state, phase: 'held' } : state };
    case 'release':
      return { state: idleHold, commit: state.phase === 'held' ? (event.inside ? event.index : state.index) : undefined };
    case 'cancel':
      return { state: idleHold };
  }
}

/** The index of the centre nearest `coord`: the tab under a pointer at that point along the bar's axis. */
export function nearestCentre(centres: readonly number[], coord: number): number {
  let best = 0;
  for (let at = 1; at < centres.length; at += 1) if (Math.abs(centres[at]! - coord) < Math.abs(centres[best]! - coord)) best = at;
  return best;
}

/**
 * Where the lens is along the bar, as a fractional tab index: it follows the pointer between the centres of the first and last tab and is
 * clamped to them. With no tabs, or one, it is 0.
 */
export function lensPosition(centres: readonly number[], coord: number): number {
  if (centres.length < 2) return 0;
  if (coord <= centres[0]!) return 0;
  const last = centres.length - 1;
  if (coord >= centres[last]!) return last;
  for (let at = 0; at < last; at += 1) {
    const from = centres[at]!, to = centres[at + 1]!;
    if (coord <= to) return at + (to === from ? 0 : (coord - from) / (to - from));
  }
  return last;
}

/** Whether a point is over a rectangle grown by `slop` on every side: the bar and the margin a drag may stray into. */
export const overBar = (point: HoldPoint, box: { left: number; right: number; top: number; bottom: number }, slop: number): boolean =>
  point.x >= box.left - slop && point.x <= box.right + slop && point.y >= box.top - slop && point.y <= box.bottom + slop;
