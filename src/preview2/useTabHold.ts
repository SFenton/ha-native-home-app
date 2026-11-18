import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { CLICK_GUARD_MS, HOLD_MS, HOLD_SLOP_PX } from './rail-constants';
import { holdStep, idleHold, lensPosition, nearestCentre, overBar, type HoldEvent, type HoldPoint, type HoldState } from './tab-hold';

/** What {@link useTabHold} gives the bar it drives. */
export interface TabHold {
  /** Whether the bar is held: the labels and the lens show. */
  held: boolean;
  /** The tab under the lens while held. */
  index: number;
  /** The lens's place along the bar as a fractional tab index: it follows the pointer, and settles on a tab's centre on release. */
  position: number;
  /** Handlers for the bar's element. */
  bind: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void };
}

/**
 * Press-and-hold on a tab bar (`tab-hold.ts` is the state machine). The bar's tabs are the `.sh-tab` buttons inside `barRef`; the pointer
 * picks one by geometry along `axis` (so it works under the rig's 3D transform and the preview's zoom), the tab under the lens is marked
 * `data-lit`, and a release over the bar commits it by `onCommit(index)`. The click the browser sends after a held press is swallowed, so a
 * tab is never selected twice, and nothing is selected before the release.
 */
export function useTabHold(barRef: RefObject<HTMLElement | null>, axis: 'x' | 'y', onCommit: (index: number) => void): TabHold {
  const [state, setState] = useState<HoldState>(idleHold);
  const [position, setPosition] = useState(0);
  const machine = useRef<HoldState>(idleHold);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const stop = useRef<(() => void) | undefined>(undefined);

  const step = useCallback((event: HoldEvent) => {
    const next = holdStep(machine.current, event);
    machine.current = next.state;
    setState(next.state);
    return next;
  }, []);

  const bind = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const bar = barRef.current;
    if (!bar || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || machine.current.phase !== 'idle') return;
    const tabs = () => Array.from(bar.querySelectorAll<HTMLElement>('.sh-tab'));
    const pressed = tabs().findIndex(tab => tab.contains(event.target as Node));
    if (pressed < 0) return;
    const along = (point: HoldPoint) => axis === 'y' ? point.y : point.x;
    const centres = () => tabs().map(tab => { const box = tab.getBoundingClientRect(); return axis === 'y' ? box.top + box.height / 2 : box.left + box.width / 2; });
    const id = event.pointerId;
    let heldOnce = false;
    step({ type: 'press', index: pressed, at: { x: event.clientX, y: event.clientY } });
    setPosition(pressed);
    const arm = () => { heldOnce = true; step({ type: 'timer' }); };
    // Native holds at touch-down (HOLD_MS is 0): the lens is up on the first frame.
    const timer = HOLD_MS > 0 ? setTimeout(arm, HOLD_MS) : undefined;
    if (!timer) arm();

    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== id) return;
      const at = { x: move.clientX, y: move.clientY }, now = centres();
      const result = step({ type: 'move', index: nearestCentre(now, along(at)), at });
      if (result.state.phase === 'held') { heldOnce = true; setPosition(lensPosition(now, along(at))); }
    };
    const end = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      stop.current = undefined;
    };
    const swallowClick = () => {
      // The browser sends a click after the release: it would select whatever is under it, so it is dropped (a window listener runs before React's).
      const drop = (click: Event) => { click.stopPropagation(); click.preventDefault(); clear(); };
      const clear = () => { clearTimeout(guard); window.removeEventListener('click', drop, true); };
      const guard = setTimeout(clear, CLICK_GUARD_MS);
      window.addEventListener('click', drop, true);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== id) return;
      end();
      const box = bar.getBoundingClientRect(), now = centres(), at = { x: up.clientX, y: up.clientY };
      const index = nearestCentre(now, along(at));
      const result = step({ type: 'release', index, inside: overBar(at, box, HOLD_SLOP_PX) });
      if (heldOnce) {
        setPosition(index);
        if (result.commit !== undefined) commit.current(result.commit);
        swallowClick();
      }
    };
    const onCancel = (cancel: PointerEvent) => {
      if (cancel.pointerId !== id) return;
      end(); step({ type: 'cancel' });
      if (heldOnce) swallowClick();
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || machine.current.phase === 'idle') return;
      // The press goes on until the pointer lifts, but it selects nothing: the machine is idle, so the release has nothing to commit (native is silent on Escape).
      key.stopPropagation();
      step({ type: 'cancel' });
    };
    // Leaving the window (an app switch, a hidden tab) ends the press: a release outside the browser would never reach it, and the next pointerup anywhere would commit.
    const onLeave = () => { if (document.visibilityState === 'hidden' || !document.hasFocus()) { end(); step({ type: 'cancel' }); } };
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    stop.current = end;
  }, [axis, barRef, step]);

  // A held press shows its tab: the bar's own React children do not know which one the lens is on.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    bar.querySelectorAll<HTMLElement>('.sh-tab').forEach((tab, at) => { if (state.phase === 'held' && at === state.index) tab.setAttribute('data-lit', ''); else tab.removeAttribute('data-lit'); });
  }, [barRef, state]);
  useEffect(() => () => stop.current?.(), []);

  return { held: state.phase === 'held', index: state.index, position, bind: { onPointerDown: bind, onContextMenu: event => { if (machine.current.phase !== 'idle') event.preventDefault(); } } };
}
