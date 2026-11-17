/**
 * The drop's settle (spec section 6): the things that moved glide from where they were to where they are now (FLIP: first
 * measure, then change, then play the difference), and the drag image lands on the node it became. Every step is a transform
 * or opacity animation, so it runs on the compositor and stays smooth while the main thread is busy.
 */

/** How long the glide takes: long enough to follow, short enough to feel instant (HIG motion: quick and purposeful). */
export const SETTLE_MS = 220;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A rect, and how far it is scaled on screen (the preview draws at a zoom). */
export interface Placed { left: number; top: number; scale: number }
/** Where each element was, by its key. */
export type Before = Map<string, Placed>;

/** What is animated: nodes in the preview and rows in "This Page". */
const SELECTOR = '[data-sel^="node:"], [data-row]';
const keyOf = (element: Element) => element.getAttribute('data-sel') ?? element.getAttribute('data-row') ?? '';

/** Whether motion is welcome: the person has not asked for less. */
export const motionAllowed = () => typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches;

const placedOf = (element: HTMLElement): Placed => {
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, scale: element.offsetWidth > 0 ? box.width / element.offsetWidth : 1 };
};

/** Measures every node and row in `roots` before a change. Measuring reads layout once, for all of them. */
export function measureBefore(roots: (ParentNode | null | undefined)[]): Before {
  const before: Before = new Map();
  if (!motionAllowed()) return before;
  for (const root of roots) for (const element of root?.querySelectorAll<HTMLElement>(SELECTOR) ?? []) {
    const key = keyOf(element);
    if (key && !before.has(key)) before.set(key, placedOf(element));
  }
  return before;
}

/**
 * Plays each element that moved from its old place to its new one. An element inside another that moved glides with it, so
 * only the difference from its parent's glide is played on it. Returns how many animations started.
 */
export function playSettle(roots: (ParentNode | null | undefined)[], before: Before, duration = SETTLE_MS): number {
  if (!before.size || !motionAllowed()) return 0;
  const moves = new Map<Element, { x: number; y: number }>();
  let started = 0;
  for (const root of roots) for (const element of root?.querySelectorAll<HTMLElement>(SELECTOR) ?? []) {
    const was = before.get(keyOf(element));
    if (!was || typeof element.animate !== 'function') continue;
    const now = placedOf(element);
    let x = was.left - now.left, y = was.top - now.top;
    const parent = element.parentElement?.closest(SELECTOR);
    const inherited = parent ? moves.get(parent) : undefined;
    // A glide already on the parent carries this element; take it off so it is not played twice.
    if (inherited) { x -= inherited.x; y -= inherited.y; }
    moves.set(element, { x: x + (inherited?.x ?? 0), y: y + (inherited?.y ?? 0) });
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
    const scale = now.scale || 1;
    element.animate([{ transform: `translate(${x / scale}px, ${y / scale}px)` }, { transform: 'translate(0, 0)' }], { duration, easing: EASING });
    started++;
  }
  return started;
}

/**
 * Lands a drag image on what it became: it glides to the node's new place while it fades, then goes. `image` is a copy of the
 * drag image that was on screen; `target` the node now in the document. Without a target the image just fades.
 */
export function settleGhost(image: HTMLElement, target: Element | null | undefined, duration = SETTLE_MS): void {
  const done = () => image.remove();
  if (!motionAllowed() || typeof image.animate !== 'function') { done(); return; }
  const from = image.getBoundingClientRect();
  const to = target?.getBoundingClientRect();
  const dx = to ? to.left - from.left : 0, dy = to ? to.top - from.top : 0;
  const grow = to && from.width > 0 ? to.width / from.width : 1;
  const run = image.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 0.9 },
    { transform: `translate(${dx}px, ${dy}px) scale(${grow})`, opacity: 0 },
  ], { duration, easing: EASING, fill: 'forwards' });
  run.onfinish = done; run.oncancel = done;
}
