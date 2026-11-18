import { useEffect, useState } from 'react';
import { samePose, type DuoPose } from './duo-pose';

/**
 * The Duo's motion tokens (`studio-duo-sim` proposal, Motion spec). One curve drives a transition and everything in it (the halves' tilt,
 * the stage's zoom and centre, and the content's reflow), so no part runs ahead of another.
 */

/** A motion token: a duration and an easing curve, as CSS. */
export interface FoldToken {
  name: 'fold-pose' | 'fold-swing' | 'fold-reduced';
  /** Duration in ms. */
  ms: number;
  /** A CSS easing function. */
  ease: string;
  /** The ms at which the curve has covered 99% of its travel. */
  settleMs: number;
}

/**
 * The native standard spring (`MotionTokens.standard`, `.smooth(duration: 0.3)`) as a CSS `linear()` curve over 450 ms (1.5 durations):
 * x(t) = 1 - (1 + wt) e^(-wt), w = 2 pi / 0.3 s, sampled every 1/18th. 99% at 317 ms.
 */
export const SPRING_STOPS = [0, 0.098, 0.282, 0.466, 0.619, 0.737, 0.822, 0.881, 0.922, 0.949, 0.968, 0.98, 0.987, 0.992, 0.995, 0.997, 0.999, 0.999, 1] as const;
/** The spring as a CSS easing function. */
export const SPRING = `linear(${SPRING_STOPS.join(', ')})`;

/** A change of fold between open and partly folded, and a turn: the native spring, 0.3 s (99% at 317 ms). */
export const FOLD_POSE: FoldToken = { name: 'fold-pose', ms: 450, ease: SPRING, settleMs: 317 };
/** The cover swinging about the hinge: the same spring at 0.5 s (99% at 528 ms). Native has no such motion (the system switches displays), so `interim` until R1's recording. */
export const FOLD_SWING: FoldToken = { name: 'fold-swing', ms: 750, ease: SPRING, settleMs: 528 };
/** Reduce Motion: no tilt, swing or travel, the old pose cross-fades to the new (`MotionTokens.quick`, 0.2 s). */
export const FOLD_REDUCED: FoldToken = { name: 'fold-reduced', ms: 200, ease: 'ease-out', settleMs: 200 };
/** While an Edit-mode drag runs the rig flattens on this: 200 ms ease-out, and returns on {@link FOLD_POSE}. */
export const FLATTEN_MS = 200;

/** Whether a move between two poses swings the cover (it starts or ends closed, the turn kept) rather than tilting the halves. */
export const isSwing = (from: DuoPose, to: DuoPose): boolean => from.turn === to.turn && (from.fold === 'closed') !== (to.fold === 'closed');

/** The token for a move between two poses. A turn runs on `fold-pose`; Reduce Motion on `fold-reduced`. */
export function tokenFor(from: DuoPose | undefined, to: DuoPose, reduced: boolean): FoldToken {
  if (reduced) return FOLD_REDUCED;
  return from && isSwing(from, to) ? FOLD_SWING : FOLD_POSE;
}

/** Whether the person asked for less motion. */
export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `prefers-reduced-motion`, kept current. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const listener = () => setReduced(query.matches);
    query.addEventListener('change', listener);
    listener();
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

/**
 * The token of the latest move of `pose`, held until the next one. The first pose has none (nothing moved), so it reads `fold-pose`. Derived
 * while rendering, so the stage and the rig change their transition and their target in the same commit.
 */
export function useFoldToken(pose: DuoPose | undefined, reduced: boolean): FoldToken {
  const [state, setState] = useState<{ pose: DuoPose | undefined; token: FoldToken }>({ pose, token: reduced ? FOLD_REDUCED : FOLD_POSE });
  if (!samePose(state.pose, pose) || (reduced && state.token !== FOLD_REDUCED) || (!reduced && state.token === FOLD_REDUCED)) {
    const token = pose ? tokenFor(state.pose, pose, reduced) : reduced ? FOLD_REDUCED : FOLD_POSE;
    setState({ pose, token });
    return token;
  }
  return state.token;
}

/** The ms after which the inner or outer display of a swing may be unmounted: the token's duration plus a frame of grace. */
export const settleDelay = (token: FoldToken) => token.ms + 60;
