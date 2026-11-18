import { useEffect, type RefObject } from 'react';
import { elementAt, pathTo, visibleCopy } from './twin-scroll';

/**
 * The partly folded Duo draws one screen twice, once through each half. For the keyboard and a screen reader there is one screen: each
 * control and each leaf node is exposed in the copy whose half shows it, and the other copy's duplicate is `aria-hidden` and gets
 * `tabindex="-1"`. The hidden copy therefore has no tab stop, and no control that is clipped out of view takes focus (focusing one would
 * also scroll the `overflow: hidden` clip). The copies stay clickable: a tap lands in whichever half it is made in.
 */

/** What can take focus. */
export const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"], [data-copy-tab]';
/** Marks what this module changed, so it can undo it. */
const OFF = 'data-copy-off', TAB = 'data-copy-tab';

/** Whether a node has no node of its own inside it: the smallest unit of content that is shown in one half. */
const isLeaf = (element: Element) => !element.querySelector('[data-sel]');

/** Takes an element and what can take focus inside it out of the keyboard's and a screen reader's reach, or puts them back. */
function setReach(element: Element, reachable: boolean, hide: boolean): void {
  if (hide) {
    if (reachable) { if (element.hasAttribute(OFF)) { element.removeAttribute(OFF); element.removeAttribute('aria-hidden'); } }
    else if (!element.hasAttribute('aria-hidden')) { element.setAttribute(OFF, ''); element.setAttribute('aria-hidden', 'true'); }
  }
  const targets = [...(element.matches(FOCUSABLE) ? [element] : []), ...element.querySelectorAll(FOCUSABLE)];
  for (const target of targets) {
    if (reachable) {
      if (target.hasAttribute(TAB)) {
        const was = target.getAttribute(TAB);
        if (was === null || was === '') target.removeAttribute('tabindex'); else target.setAttribute('tabindex', was);
        target.removeAttribute(TAB);
      }
      if (!hide && target.hasAttribute(OFF)) { target.removeAttribute(OFF); target.removeAttribute('aria-hidden'); }
    } else {
      if (!target.hasAttribute(TAB)) target.setAttribute(TAB, target.getAttribute('tabindex') ?? '');
      target.setAttribute('tabindex', '-1');
    }
  }
}

/**
 * The copy of a node that is exposed: where its half shows its centre. The selected node is exposed where its Edit handle is drawn
 * (`HandleSlot` puts the handle in the copy that shows it), so the handle a person sees is the one they can reach.
 */
export function exposedCopy<T extends Element>(copies: readonly [T, T]): T {
  const handles = copies.map(copy => copy.matches('[data-selected]') ? copy.querySelector(':scope > .sh-handle-slot') : null);
  if (handles.every(Boolean)) return copies[handles[0] === visibleCopy(handles as Element[]) ? 0 : 1];
  return visibleCopy(copies) ?? copies[0];
}

/** Exposes every leaf node and every loose control in one copy of a pair of copies of the screen, and hides its duplicate in the other. */
export function assignReach(first: Element, second: Element): void {
  const pair = (element: Element): [Element, Element] | undefined => {
    const path = pathTo(first, element), other = path && elementAt(second, path);
    return other ? [element, other] : undefined;
  };
  const done = new Set<Element>();
  const insideDone = (element: Element) => { for (let at: Element | null = element; at; at = at.parentElement) if (done.has(at)) return true; return false; };
  for (const node of first.querySelectorAll('[data-sel]')) {
    if (!isLeaf(node)) continue;
    const copies = pair(node);
    if (!copies) continue;
    const owner = exposedCopy(copies);
    for (const copy of copies) { setReach(copy, copy === owner, true); done.add(copy); }
  }
  for (const control of first.querySelectorAll(FOCUSABLE)) {
    const copies = pair(control);
    if (!copies || copies.some(copy => insideDone(copy))) continue;
    const owner = exposedCopy(copies);
    for (const copy of copies) setReach(copy, copy === owner, true);
  }
}

/** Gives every control and node its normal reach again (the Duo stopped being drawn twice). */
export function clearReach(...roots: Element[]): void {
  for (const root of roots) {
    root.querySelectorAll(`[${OFF}], [${TAB}]`).forEach(element => setReach(element, true, true));
  }
}

/** Whether an element is in the copy of its control that is hidden from the keyboard and a screen reader. */
const inHiddenCopy = (element: Element) => element.hasAttribute(TAB) || element.closest(`[${OFF}]`) !== null;

/**
 * Focus that lands in a hidden copy (a click, a script, a layout that moved under the keyboard): look again at who owns the control, and if
 * it is still hidden move focus to the same control in the visible copy, or let go of it. Keyboard focus never rests out of sight, so the
 * `overflow: hidden` clip never scrolls to show it.
 */
export function guardFocus(first: Element, second: Element, target: Element): void {
  assignReach(first, second);
  if (!inHiddenCopy(target)) return;
  const [mine, other] = first.contains(target) ? [first, second] : [second, first];
  const path = pathTo(mine, target), twin = path && elementAt(other, path);
  if (twin instanceof HTMLElement && !inHiddenCopy(twin)) twin.focus({ preventScroll: true });
  else (target as HTMLElement).blur?.();
  for (const clip of [first, second].map(root => root.closest('.sh-clip'))) if (clip) { clip.scrollLeft = 0; clip.scrollTop = 0; }
}

/**
 * Keeps {@link assignReach} current while `enabled`: after the copies mount, on the pose state (`key`), and from what actually moves a control:
 * a change to either tree (nodes, `data-selected`, `style`, `class`, text), a resize of any node (a grid measuring, a font arriving), the end
 * of the tilt's transition and of a reflow's animations. The work is queued to a frame, and skipped while a reflow move plays or the rig settles
 * (it runs once more when the last move ends, and on the pose `key` when the rig settles). The module only writes `aria-hidden`, `tabindex` and
 * its own markers, none of which it watches, so it cannot trigger itself. A Tab key and every focus that lands in a copy are checked
 * synchronously ({@link guardFocus}).
 */
export function useCopyReach(first: RefObject<Element | null>, second: RefObject<Element | null>, enabled: boolean, key: string): void {
  useEffect(() => {
    const a = first.current, b = second.current;
    if (!enabled || !a || !b) return;
    let frame = 0;
    // Nodes whose reflow move is playing, and the rig that is still settling: while either is in motion the rects include the move's `translate`,
    // so a tile that travels through the other half would flip its reach and flip back. Nothing is reassigned until the move ends.
    const moving = new Set<Element>();
    const rig = a.closest('.sh-rig');
    const busy = () => { for (const element of moving) if (!element.isConnected) moving.delete(element); return moving.size > 0 || !!rig?.hasAttribute('data-settling'); };
    const resizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => queue());
    const watch = () => { if (resizes) for (const root of [a, b]) { resizes.observe(root); root.querySelectorAll('[data-sel]').forEach(node => resizes.observe(node)); } };
    const run = () => { frame = 0; if (busy()) return; assignReach(a, b); watch(); };
    function queue() { if (!frame) frame = requestAnimationFrame(run); }
    assignReach(a, b); watch();
    // The tilt's transition ends on the half, above the copies; a reflow's animations start and end on their nodes and say so (`reflow.ts`).
    const started = (event: Event) => { if (event.target instanceof Element) moving.add(event.target); };
    const ended = (event: Event) => { if (event.target instanceof Element) moving.delete(event.target); queue(); };
    rig?.addEventListener('transitionend', queue);
    for (const root of [a, b]) { root.addEventListener('sh-reflow-start', started); root.addEventListener('sh-reflow-end', ended); }
    const observer = new MutationObserver(queue);
    for (const root of [a, b]) observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-selected', 'style', 'class'] });
    const tab = (event: Event) => { if ((event as KeyboardEvent).key === 'Tab') assignReach(a, b); };
    // Always look again before trusting the marks: a Tab from outside the rig can land on a control a layout change has just moved out of sight.
    const focus = (event: Event) => { const target = event.target; if (target instanceof Element) guardFocus(a, b, target); };
    for (const root of [a, b]) { root.addEventListener('keydown', tab, true); root.addEventListener('focusin', focus, true); }
    return () => {
      observer.disconnect(); resizes?.disconnect();
      rig?.removeEventListener('transitionend', queue);
      for (const root of [a, b]) { root.removeEventListener('sh-reflow-start', started); root.removeEventListener('sh-reflow-end', ended); root.removeEventListener('keydown', tab, true); root.removeEventListener('focusin', focus, true); }
      if (frame) cancelAnimationFrame(frame); clearReach(a, b);
    };
  }, [first, second, enabled, key]);
}
