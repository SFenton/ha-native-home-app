import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';
import type { GroupState } from '../shared/composition/grid-groups';

/**
 * The sim's half of `sh.grid-state-groups@1` (`build/design/sim-fidelity-contract.md`, section 3): a grouped grid learns the face each of its tiles draws from the tiles
 * themselves, so a heading can never disagree with its tile, and moves a tile that changed group by the cause of the change.
 */

/** The grid that asks its tiles for the face they draw; absent outside a grouped grid. */
export const GridFaces = createContext<((nodeId: string, state: GroupState) => void) | undefined>(undefined);
/** The id of the node a frame draws, for the tile inside it to report under. */
export const NodeIdContext = createContext<string | undefined>(undefined);

/** The face a tile draws: unavailable, lit (active), else idle. */
export const faceState = (unavailable: boolean, lit: boolean): GroupState => unavailable ? 'unavailable' : lit ? 'active' : 'idle';

/** A tile tells its grouped grid which face it draws now. A layout effect, so the grid regroups before the first paint and never shows the ungrouped order. */
export function useFaceReport(state: GroupState): void {
  const report = useContext(GridFaces), id = useContext(NodeIdContext);
  useLayoutEffect(() => { if (report && id) report(id, state); }, [report, id, state]);
}

// MARK: The cause of a move

/** How long after a person's action a change of face counts as theirs: the call, the overlay write and the redraw all land inside it. */
const PERSON_WINDOW_MS = 1500;
let lastPerson = Number.NEGATIVE_INFINITY;
/** The person did something (a tap, a button, a swipe's release): the next move is theirs. */
export const markPerson = (now: number = performance.now()): void => { lastPerson = now; };
/** Whether a move at `now` follows the person's action. A house change, a snapshot and a reconnect never do. */
export const isPersonMove = (now: number = performance.now()): boolean => now - lastPerson <= PERSON_WINDOW_MS;

// MARK: Motion

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** `MotionTokens.standard`: 0.35 s on the standard curve. `quick` is 0.2 s. */
export const STANDARD_MS = 350, QUICK_MS = 200;

/**
 * Animates a regroup when the person caused it. `order` is the drawn order of the grid's items (headings and tiles) by key; when it changes, each item that moved
 * slides from where it was (a FLIP), and with Reduce Motion the tiles that changed group fade in instead and nothing slides. A house change, the first draw and any
 * order change not after the person's action apply with no animation.
 */
export function useRegroupMotion(grid: RefObject<HTMLElement | null>, order: string, groupOf: ReadonlyMap<string, string>): void {
  const rects = useRef(new Map<string, DOMRect>());
  const previous = useRef<{ order: string; groups: ReadonlyMap<string, string> } | undefined>(undefined);
  useLayoutEffect(() => {
    const host = grid.current;
    if (!host) return;
    const now = new Map<string, DOMRect>();
    const items = new Map<string, HTMLElement>();
    host.querySelectorAll<HTMLElement>(':scope > [data-group-item]').forEach(element => { items.set(element.dataset.groupItem!, element); now.set(element.dataset.groupItem!, element.getBoundingClientRect()); });
    const before = previous.current, changed = before !== undefined && before.order !== order;
    if (changed && isPersonMove() && typeof Element !== 'undefined' && 'animate' in Element.prototype) {
      if (reducedMotion()) {
        for (const [key, element] of items) if (before!.groups.get(key) !== undefined && before!.groups.get(key) !== groupOf.get(key)) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: QUICK_MS, easing: 'ease-out' });
      } else {
        for (const [key, element] of items) {
          const from = rects.current.get(key), to = now.get(key);
          if (!from || !to || (from.left === to.left && from.top === to.top)) continue;
          element.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: STANDARD_MS, easing: 'cubic-bezier(.4, 0, .2, 1)' });
        }
      }
    }
    rects.current = now;
    previous.current = { order, groups: groupOf };
  });
}
