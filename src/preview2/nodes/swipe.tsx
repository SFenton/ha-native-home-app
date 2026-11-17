import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { defaultDetent, type TileSwipe } from '../../shared/composition/tile-swipe';
import { findScroller } from '../preview-pointer';
import { useRender } from '../render-context';
import {
  adjust, bubbleCenter, bubbleText, bubbleTop, bubbleWidth, crossesDetent, formatSwipe, fraction, releasePlans, SWIPE_THRESHOLD, valueAtX, BUBBLE, BUBBLE_LARGE,
} from '../tile-swipe';
import './swipe.css';

/** What a swiped tile hands its frame: the setting, the value the tile shows now, and what a release does. */
export interface SwipeSpec {
  /** `light` is the light group tile (its own words and call); `state` is a state tile (the authored format and call). */
  kind: 'light' | 'state';
  swipe: TileSwipe;
  /** The number the tile shows now; undefined while it has none (no swipe then). */
  current: number | undefined;
  /** False while the tile is unavailable or its `enabledWhen` does not hold. */
  enabled: boolean;
  /** What is adjusted, for the accessible name: "brightness", "position". */
  label: string;
  /** One call with the snapped value. */
  commit(value: number): void;
  /** The light group tile's own words for "Off" and the level (`sh.state-words@1`). */
  words?: { off?: string; level?: string };
}
/** The share of the range a tile's band shows now: its dragged or live value, or none when the band is off or there is no value. */
export const bandShare = (spec: SwipeSpec | undefined, shown: number | undefined): number | null =>
  !spec || spec.swipe.band === false || shown === undefined ? null : fraction(shown, spec.swipe.range);

/** Selector of the parts a swipe never starts on: a press that starts on a tile's round button (or its chevron) is that button's (C5). The tile's own tap is not one: a drag cancels it (C4). */
const OWN_TOUCH = '.sh-tile-disc, .sh-dv-disc, .sh-dv-chev';

/**
 * The frame of a swiped tile (`build/design/tile-swipe.md`, section 7). In Use a horizontal drag of 6 pixels draws the band and the bubble under the
 * pointer and sends one call on release; a vertical drag scrolls the preview and plans nothing; Escape drops the drag. In Edit it draws nothing of its own.
 * The children get the value to draw: the dragged one while dragging, else the live one.
 */
export function SwipeFrame({ spec, children }: { spec: SwipeSpec | undefined; children: (shown: number | undefined, dragging: boolean) => ReactNode }) {
  const { mode, largeText } = useRender();
  const frame = useRef<HTMLDivElement>(null);
  const latest = useRef(spec);
  latest.current = spec;
  const [drag, setDrag] = useState<{ value: number; room: number; rtl: boolean; width: number }>();
  const [ticks, setTicks] = useState(0);
  const active = mode === 'use' && Boolean(spec?.enabled) && spec?.current !== undefined;

  useEffect(() => {
    const element = frame.current;
    // A tile in a row that scrolls sideways attaches no pan (C3): the row scrolls, and the keys and the slider role stay.
    if (!element || !active || element.closest('[data-type="paged-row"], [data-type="status-rail"]')) return;
    let start: { id: number; x: number; y: number } | undefined, began = false, last: number | undefined, origin: DOMRect | undefined;
    const stop = () => {
      start = undefined; began = false; last = undefined; origin = undefined;
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('keydown', escape, true);
    };
    const range = () => latest.current!.swipe.range;
    const detent = () => latest.current!.swipe.detent ?? defaultDetent(range());
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || start || !(event.target instanceof Element) || event.target.closest(OWN_TOUCH)) return;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY }; began = false; last = undefined;
      // Registered before the preview's own pan (which listens on the stage root), so a horizontal drag can keep it from scrolling the page.
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', cancel, true); window.addEventListener('keydown', escape, true);
    };
    const move = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!began) {
        if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
        // More vertical than horizontal: the scroll's (C1). Nothing is planned.
        if (Math.abs(dx) <= Math.abs(dy)) { stop(); return; }
        began = true;
        // The tile's own box, taken before the lift scales it: the finger is measured against the tile at rest.
        origin = element.getBoundingClientRect();
        try { element.setPointerCapture(event.pointerId); } catch { /* the pointer ended */ }
      }
      event.stopImmediatePropagation(); event.preventDefault();
      const box = origin ?? element.getBoundingClientRect(), scale = element.offsetWidth ? box.width / element.offsetWidth : 1;
      const rtl = getComputedStyle(element).direction === 'rtl';
      const value = valueAtX((event.clientX - box.left) / (scale || 1), element.offsetWidth, range(), rtl);
      if (latest.current!.swipe.haptic !== 'none' && crossesDetent(last, value, range(), detent())) setTicks(count => count + 1);
      last = value;
      const scroller = findScroller(element, document.body, 'y');
      setDrag({ value, rtl, width: element.offsetWidth, room: scroller ? box.top - scroller.getBoundingClientRect().top : box.top });
    };
    const finish = (commit: boolean) => {
      const value = last, was = began;
      stop(); setDrag(undefined);
      if (!was) return;
      // The drag cancels the tile's tap (C4): the click that follows the release is swallowed once.
      const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
      element.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => element.removeEventListener('click', swallow, true), 60);
      const now = latest.current!;
      if (commit && value !== undefined && releasePlans(now.current, value)) now.commit(value);
    };
    const up = (event: PointerEvent) => { if (start && event.pointerId === start.id) finish(true); };
    const cancel = (event: PointerEvent) => { if (start && event.pointerId === start.id) finish(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && began) { event.stopPropagation(); finish(false); } };
    element.setAttribute('data-no-pan-x', '');
    element.addEventListener('pointerdown', down);
    return () => { element.removeAttribute('data-no-pan-x'); element.removeEventListener('pointerdown', down); stop(); };
  }, [active]);

  const shown = drag?.value ?? spec?.current;
  if (!spec) return <>{children(undefined, false)}</>;
  const large = Boolean(largeText);
  const name = spec.kind === 'light' && shown !== undefined ? bubbleText('light', shown, spec.swipe.format, spec.words) : shown === undefined ? undefined : formatSwipe(spec.swipe.format, shown);
  const spoken = spec.kind === 'light' && spec.current !== undefined ? bubbleText('light', spec.current, undefined, spec.words) : spec.current === undefined ? undefined : formatSwipe(spec.swipe.format, spec.current);
  const detent = spec.swipe.detent ?? defaultDetent(spec.swipe.range);
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active || event.target !== event.currentTarget || spec.current === undefined) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const up = rtl ? ['ArrowLeft', 'ArrowUp'] : ['ArrowRight', 'ArrowUp'], down = rtl ? ['ArrowRight', 'ArrowDown'] : ['ArrowLeft', 'ArrowDown'];
    const direction = up.includes(event.key) ? 1 : down.includes(event.key) ? -1 : 0;
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    const next = adjust(spec.current, direction, spec.swipe.range, detent);
    if (releasePlans(spec.current, next)) spec.commit(next);
  };
  const bubble = drag && name !== undefined ? (() => {
    const wide = bubbleWidth(name, drag.width, large), height = (large ? BUBBLE_LARGE : BUBBLE).height;
    const center = bubbleCenter(fraction(drag.value, spec.swipe.range), drag.width, wide, drag.rtl);
    return <span className="sh-swipe-bubble" data-testid="swipe-bubble" aria-hidden="true" style={{ width: wide, height, insetInlineStart: center - wide / 2, top: bubbleTop(drag.room, large) - height / 2 } as CSSProperties}>{name}</span>;
  })() : null;
  return <div ref={frame} className="sh-swipe" data-swiping={drag ? '' : undefined} data-swipe-ticks={ticks} data-testid="swipe-frame"
    {...(spec.enabled && spec.current !== undefined ? {
      'data-swipe-tile': '', role: 'slider', tabIndex: mode === 'use' ? 0 : -1, onKeyDown: key,
      'aria-label': spec.label, 'aria-orientation': 'horizontal' as const,
      'aria-valuemin': spec.swipe.range.min, 'aria-valuemax': spec.swipe.range.max, 'aria-valuenow': shown, 'aria-valuetext': drag && name !== undefined ? name : spoken,
    } : {})}>
    {children(shown, Boolean(drag))}
    {bubble}
  </div>;
}
