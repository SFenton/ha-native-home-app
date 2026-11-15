import { useEffect, type RefObject } from 'react';

/** Distance in screen pixels a mouse must travel before a press becomes a pan. */
export const PAN_THRESHOLD = 6;
/** Controls that own their own drag. A press that starts on one never pans. */
export const NO_PAN_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-pan], video, audio';
/** Elements that own horizontal drags (swipe rows). Vertical pans still pass through. */
export const NO_PAN_X_SELECTOR = '[data-no-pan-x]';
const CLICK_GUARD_MS = 120;
const VELOCITY_WINDOW_MS = 100;
const MIN_SPEED = 0.02;

type Axis = 'x' | 'y';
type Sample = { x: number; y: number; t: number };
/** Hooks the module needs from its environment, replaceable in tests. */
export type PreviewPointerOptions = {
  /** Returns true while mouse click-and-drag should pan (Interact mode). */
  pan: () => boolean;
  now?: () => number;
  raf?: (callback: (time: number) => void) => number;
  caf?: (handle: number) => void;
};

function overflowOf(element: Element, axis: Axis) {
  const style = getComputedStyle(element);
  return axis === 'y' ? style.overflowY : style.overflowX;
}
/** True when the element can scroll along the axis, optionally in one direction (-1 toward start, 1 toward end). */
export function canScroll(element: HTMLElement, axis: Axis, direction = 0) {
  if (!/(auto|scroll|overlay)/.test(overflowOf(element, axis))) return false;
  const size = axis === 'y' ? element.clientHeight : element.clientWidth;
  const total = axis === 'y' ? element.scrollHeight : element.scrollWidth;
  const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
  if (total - size <= 1) return false;
  if (direction < 0) return position > 0;
  if (direction > 0) return position < total - size - 1;
  return true;
}
/** Nearest ancestor of `start`, up to and including `root`, that can scroll along the axis. */
export function findScroller(start: Element | null, root: Element, axis: Axis, direction = 0): HTMLElement | undefined {
  for (let element = start; element; element = element.parentElement) {
    if (element instanceof HTMLElement && canScroll(element, axis, direction)) return element;
    if (element === root) break;
  }
  return undefined;
}

/**
 * Keeps wheel and touch scrolling inside a device preview and, while `options.pan()` is true, lets a
 * mouse press-and-drag pan the scroller under the pointer like a finger, with momentum on release.
 * Touch input keeps native scrolling. Returns a cleanup function.
 */
export function attachPreviewPointer(root: HTMLElement, options: PreviewPointerOptions) {
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((callback: (time: number) => void) => window.requestAnimationFrame(callback));
  const caf = options.caf ?? ((handle: number) => window.cancelAnimationFrame(handle));

  // Wheel and touch guards: the page behind the device never scrolls.
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const consumed = (event.deltaY !== 0 && findScroller(target, root, 'y', Math.sign(event.deltaY)))
      || (event.deltaX !== 0 && findScroller(target, root, 'x', Math.sign(event.deltaX)));
    if (!consumed && event.cancelable) event.preventDefault();
  };
  let touch: { x: number; y: number; target: Element | null } | undefined;
  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0];
    touch = event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY, target: event.target instanceof Element ? event.target : null } : undefined;
  };
  const onTouchMove = (event: TouchEvent) => {
    const point = event.touches[0];
    if (!touch || event.touches.length !== 1 || !point || !event.cancelable) return;
    const dx = touch.x - point.clientX, dy = touch.y - point.clientY;
    touch = { ...touch, x: point.clientX, y: point.clientY };
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const consumed = vertical ? findScroller(touch.target, root, 'y', Math.sign(dy)) : findScroller(touch.target, root, 'x', Math.sign(dx));
    if (!consumed) event.preventDefault();
  };

  // Mouse pan.
  type Gesture = { id: number; startX: number; startY: number; axis?: Axis; scroller?: HTMLElement; originLeft: number; originTop: number; scale: number; target: Element; samples: Sample[]; panning: boolean };
  let gesture: Gesture | undefined;
  let momentum: number | undefined;
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  const stopMomentum = () => { if (momentum !== undefined) { caf(momentum); momentum = undefined; } };
  const endSuppression = () => { suppressClick = false; if (suppressTimer) clearTimeout(suppressTimer); suppressTimer = undefined; };
  const scaleOf = () => { const width = root.offsetWidth; return width ? root.getBoundingClientRect().width / width || 1 : 1; };

  const finish = () => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    root.classList.remove('preview-panning');
  };
  const onPointerDown = (event: PointerEvent) => {
    stopMomentum(); endSuppression();
    if (event.pointerType !== 'mouse' || event.button !== 0 || !options.pan()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(NO_PAN_SELECTOR)) return;
    gesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originLeft: 0, originTop: 0, scale: scaleOf(), target, samples: [{ x: event.clientX, y: event.clientY, t: now() }], panning: false };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
    if (!gesture.panning) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      const preferred: Axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
      const other: Axis = preferred === 'y' ? 'x' : 'y';
      const axis = [preferred, other].find(candidate => findScroller(gesture!.target, root, candidate));
      if (!axis || (axis === 'x' && gesture.target.closest(NO_PAN_X_SELECTOR))) { gesture = undefined; finish(); return; }
      const scroller = findScroller(gesture.target, root, axis)!;
      Object.assign(gesture, { axis, scroller, originLeft: scroller.scrollLeft, originTop: scroller.scrollTop, panning: true });
      root.classList.add('preview-panning');
    }
    const { scroller, scale, originLeft, originTop } = gesture;
    if (!scroller) return;
    scroller.scrollLeft = originLeft - dx / scale;
    scroller.scrollTop = originTop - dy / scale;
    const t = now();
    gesture.samples = [...gesture.samples.filter(sample => t - sample.t <= VELOCITY_WINDOW_MS), { x: event.clientX, y: event.clientY, t }];
    event.preventDefault();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const done = gesture;
    gesture = undefined; finish();
    if (!done.panning || !done.scroller) return;
    suppressClick = true;
    suppressTimer = setTimeout(endSuppression, CLICK_GUARD_MS);
    const first = done.samples[0], last = done.samples[done.samples.length - 1];
    const span = Math.max(1, (last?.t ?? 0) - (first?.t ?? 0));
    if (event.type === 'pointercancel' || !first || !last || now() - last.t > VELOCITY_WINDOW_MS) return;
    let vx = -(last.x - first.x) / span / done.scale, vy = -(last.y - first.y) / span / done.scale;
    const scroller = done.scroller;
    let previous = now();
    const step = () => {
      const t = now(), elapsed = Math.min(64, t - previous);
      previous = t;
      const beforeLeft = scroller.scrollLeft, beforeTop = scroller.scrollTop;
      scroller.scrollLeft += vx * elapsed; scroller.scrollTop += vy * elapsed;
      const decay = Math.pow(0.95, elapsed / 16.67);
      vx *= decay; vy *= decay;
      const moved = scroller.scrollLeft !== beforeLeft || scroller.scrollTop !== beforeTop;
      momentum = moved && Math.hypot(vx, vy) > MIN_SPEED ? raf(step) : undefined;
    };
    if (Math.hypot(vx, vy) > MIN_SPEED) momentum = raf(step);
  };
  const onClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    event.stopPropagation(); event.preventDefault();
    endSuppression();
  };
  const onDragStart = (event: Event) => event.preventDefault();

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('click', onClick, true);
  root.addEventListener('dragstart', onDragStart);
  return () => {
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('dragstart', onDragStart);
    stopMomentum(); endSuppression(); gesture = undefined; finish();
  };
}

/** Attaches {@link attachPreviewPointer} to the element for the life of the component. */
export function usePreviewPointer(ref: RefObject<HTMLElement | null>, pan: boolean) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return attachPreviewPointer(element, { pan: () => pan });
  }, [ref, pan]);
}
