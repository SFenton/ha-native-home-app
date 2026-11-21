import { useEffect, useState } from 'react';
import { useReducedMotion } from './fold-motion';
import { MOTION_MS } from './transition';

/** Where a bar is in its move: out while `hiding`, back while `showing`, else at `rest`. */
export type BarPhase = 'rest' | 'hiding' | 'showing';

/**
 * Whether a bar is drawn, and how it is moving. A bar the page hides is not in the tree at rest. When `animate` is on (Use) and the person has not asked for Reduce
 * Motion, it stays drawn while it leaves (`hiding`) and arrives moving (`showing`), over the same {@link MOTION_MS} as the push that causes it; under Reduce Motion
 * nothing slides: it is there or it is not.
 */
export function useBarPresence(hidden: boolean, animate: boolean): { mounted: boolean; phase: BarPhase } {
  const reduced = useReducedMotion();
  const moves = animate && !reduced;
  const [state, setState] = useState<{ hidden: boolean; phase: BarPhase }>({ hidden, phase: 'rest' });
  if (state.hidden !== hidden) setState({ hidden, phase: moves ? (hidden ? 'hiding' : 'showing') : 'rest' });
  useEffect(() => {
    if (state.phase === 'rest') return;
    const timer = setTimeout(() => setState(now => ({ ...now, phase: 'rest' })), MOTION_MS + 40);
    return () => clearTimeout(timer);
  }, [state.phase, state.hidden]);
  const phase = moves ? state.phase : 'rest';
  return { mounted: !state.hidden || phase === 'hiding', phase };
}
