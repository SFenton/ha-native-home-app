import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, type FoldToken } from './fold-motion';

/**
 * Beautiful reflow: when the window's fold changes, the screen lays out once for its final pose and every element whose frame changed
 * travels from its old place to its new one on the transition's own token (the app's `UKReflow`: lay out once inside one spring). Only position
 * interpolates; nothing fades, nothing is re-created and order never changes mid-flight. Text is never drawn scaled and never rewraps in flight: an
 * element is laid out at its final size on the first frame, so its text takes its final wrapping at once (the motion spec), and it travels there.
 *
 * Frames are read from layout offsets, never rects, so the tilt of the 3D rig and the preview's zoom do not enter them.
 */

/** What moves: elements the screen draws as nodes, and the headings that sit between grouped tiles. */
export const REFLOW_SELECTOR = '.sh-node, [data-group-item]';

/** An element's frame in layout points, from the screen's own origin. */
export interface Frame { x: number; y: number; width: number; height: number }
/** One element in a measurement: its frame, the nearest measured element around it, and whether it has none inside it. */
export interface Measured { frame: Frame; parent?: string; leaf: boolean }
/** The words of a move. `dx` and `dy` are the translation to start from, relative to the element's measured parent. */
export interface Move { id: string; dx: number; dy: number }

/** Frames closer than this, in points, count as unmoved. */
const EPSILON = 0.5;

/**
 * The moves between two measurements. A child's translation is relative to its parent's own movement, because the child rides inside the
 * parent's animated box: `(old - old parent) - (new - new parent)`.
 */
export function planReflow(before: ReadonlyMap<string, Measured>, after: ReadonlyMap<string, Measured>): Move[] {
  const moves: Move[] = [];
  for (const [id, now] of after) {
    const then = before.get(id);
    if (!then) continue;
    const parentThen = now.parent !== undefined ? before.get(now.parent) : undefined, parentNow = now.parent !== undefined ? after.get(now.parent) : undefined;
    const dx = (then.frame.x - (parentThen?.frame.x ?? 0)) - (now.frame.x - (parentNow?.frame.x ?? 0));
    const dy = (then.frame.y - (parentThen?.frame.y ?? 0)) - (now.frame.y - (parentNow?.frame.y ?? 0));
    if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) continue;
    moves.push({ id, dx, dy });
  }
  return moves;
}

/** The offset of an element from `screen`'s origin, summing offsets up the offset parents so no transform or scroll position enters. */
export function frameWithin(element: HTMLElement, screen: Element): Frame {
  let x = 0, y = 0, at: HTMLElement | null = element;
  while (at && at !== screen) {
    x += at.offsetLeft; y += at.offsetTop;
    at = at.offsetParent as HTMLElement | null;
    if (at && at !== screen) { x += at.clientLeft; y += at.clientTop; }
  }
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

/** An identifier for an element within one screen: its path of child indexes. Stable between two measurements of the same DOM. */
const identify = (element: Element, screen: Element): string => {
  const path: number[] = [];
  for (let at: Element | null = element; at && at !== screen; at = at.parentElement) path.push(Array.prototype.indexOf.call(at.parentElement?.children ?? [], at));
  return path.reverse().join('.');
};

/** Every movable element of a screen, with its frame. Keyed by DOM path, so an element that stays keeps its key across a re-layout. */
export function measureScreen(screen: Element): { measured: Map<string, Measured>; elements: Map<string, HTMLElement> } {
  const measured = new Map<string, Measured>(), elements = new Map<string, HTMLElement>();
  const all = [...screen.querySelectorAll<HTMLElement>(REFLOW_SELECTOR)];
  for (const element of all) {
    const id = identify(element, screen);
    const parent = element.parentElement?.closest<HTMLElement>(REFLOW_SELECTOR);
    measured.set(id, { frame: frameWithin(element, screen), parent: parent && screen.contains(parent) ? identify(parent, screen) : undefined, leaf: !element.querySelector(REFLOW_SELECTOR) });
    elements.set(id, element);
  }
  return { measured, elements };
}

/** Starts the animations of a plan on the elements, on `token`. Returns them so a later plan can replace them. */
export function playReflow(moves: readonly Move[], elements: ReadonlyMap<string, HTMLElement>, token: Pick<FoldToken, 'ms' | 'ease'>): Animation[] {
  const played: Animation[] = [];
  for (const move of moves) {
    const element = elements.get(move.id);
    if (!element || typeof element.animate !== 'function') continue;
    const from: Keyframe = { translate: `${move.dx}px ${move.dy}px` }, to: Keyframe = { translate: '0px 0px' };
    const animation = element.animate([from, to], { duration: token.ms, easing: token.ease, fill: 'backwards' });
    // WAAPI animations fire no `animationend`: say when a move starts and ends, so what depends on where a node is (`copy-access.ts`) waits for
    // it to settle and then looks again. The start is only sent with a way to know the end (`finished`), which settles when the move ends and
    // rejects when it is cancelled (a later plan replaces it), so a start is always followed by an end.
    const finished = animation.finished;
    if (finished) {
      element.dispatchEvent(new Event('sh-reflow-start', { bubbles: true }));
      const ended = () => { element.dispatchEvent(new Event('sh-reflow-end', { bubbles: true })); };
      finished.then(ended, ended);
    }
    played.push(animation);
  }
  return played;
}

/**
 * Reflows the screens inside `roots` when `key` changes (the window's fold). The old frames are read while rendering, before the change
 * reaches the DOM; after every commit that follows, until the next frame paints, the new frames are read and the animations restarted,
 * because a grid may settle its tracks in a layout effect of its own. Nothing runs when `enabled` is false or Reduce Motion is on.
 */
export function useReflow(roots: readonly RefObject<HTMLElement | null>[], key: string, token: FoldToken, enabled: boolean): void {
  const last = useRef(key), pending = useRef<Map<number, Map<string, Measured>> | undefined>(undefined), played = useRef<Animation[]>([]);
  if (last.current !== key) {
    last.current = key;
    pending.current = undefined;
    if (enabled && !prefersReducedMotion()) {
      const taken = new Map<number, Map<string, Measured>>();
      roots.forEach((root, at) => { const screen = root.current?.querySelector('.sh-screen'); if (screen) taken.set(at, measureScreen(screen).measured); });
      // A copy that mounts with the change (the second half's) has no old frames of its own: it is the same tree, so it starts from the first's.
      const fallback = [...taken.values()][0];
      if (fallback) roots.forEach((_root, at) => { if (!taken.has(at)) taken.set(at, fallback); });
      if (taken.size) pending.current = taken;
    }
  }
  useLayoutEffect(() => {
    const before = pending.current;
    if (!before) return;
    let cancelled = false;
    // Children settle their own state (a grid's tracks) in layout effects of their own; their re-render is flushed before this microtask and before paint.
    queueMicrotask(() => {
      if (cancelled) return;
      played.current.forEach(item => item.cancel());
      played.current = [];
      before.forEach((then, at) => {
        const screen = roots[at]?.current?.querySelector('.sh-screen');
        if (!screen) return;
        const now = measureScreen(screen);
        played.current.push(...playReflow(planReflow(then, now.measured), now.elements, token));
      });
    });
    const frame = requestAnimationFrame(() => { pending.current = undefined; });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  });
}
