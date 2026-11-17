/** How a page change moves: a push slides in, a pop slides out. */
export type StackMotion = 'push' | 'pop';
/** How long a push or pop slides, in ms (0.3 s, the app's `standard` motion). */
export const MOTION_MS = 300;

/** The page drawn on top, and the page it replaces while the move runs. */
export interface Transition {
  /** The page on top now. Undefined only before the first page is shown. */
  shown?: string;
  /** The page that is leaving, drawn under the new one until the move ends. */
  leaving?: { id: string; motion: StackMotion };
}

/**
 * The transition after the top page becomes `pageId`. The old page keeps moving only when the change is a push or a pop and
 * `animate` is on (Use mode); a tab switch, an Edit change or a first page cuts, so no second page is ever drawn.
 * Pure: the same page returns `transition` itself.
 */
export function beginTransition(transition: Transition, pageId: string, motion: 'none' | StackMotion, animate: boolean): Transition {
  if (transition.shown === pageId) return transition;
  const from = transition.shown;
  return { shown: pageId, leaving: from && from !== pageId && animate && motion !== 'none' ? { id: from, motion } : undefined };
}

/**
 * The transition once the move has ended. `id` names the page that was leaving when the end was scheduled, so a late timer or
 * `animationend` from an earlier move never removes the page of a newer one.
 */
export function endTransition(transition: Transition, id?: string): Transition {
  if (!transition.leaving || (id !== undefined && transition.leaving.id !== id)) return transition;
  return { shown: transition.shown };
}
