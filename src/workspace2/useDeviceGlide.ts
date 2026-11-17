import { useEffect, useRef } from 'react';

/** The sheet's curve, shared by every motion of the library and the inspector. */
export const CURVE = 'cubic-bezier(.32,.72,0,1)';

/** Whether the person asked for less motion. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Glides the device from its old box to its new one when `key` changes (the library or the inspector opened or closed). The canvas
 * takes its new size at once and the preview re-fits once; this then animates the device's stage on `transform` (translate and scale), never on
 * width, for `ms` with the panel's own curve. Reduce Motion skips it: the device simply takes its new place.
 */
export function useDeviceGlide(stage: HTMLElement | null, key: string, ms: number) {
  const last = useRef(key), before = useRef<DOMRect | null>(null);
  // The old box is read while rendering, before this change reaches the DOM.
  if (last.current !== key) {
    last.current = key;
    before.current = stage?.querySelector('.device-stage')?.getBoundingClientRect() ?? null;
  }
  useEffect(() => {
    const from = before.current;
    before.current = null;
    if (!stage || !from || reducedMotion()) return;
    let frame = 0, steady = 0, tries = 0, previous = '';
    const settle = () => {
      const device = stage.querySelector<HTMLElement>('.device-stage');
      if (!device) return;
      const to = device.getBoundingClientRect(), signature = [to.left, to.top, to.width, to.height].map(Math.round).join();
      // The preview re-fits a frame or two after the canvas changes; wait until its box holds still.
      steady = signature === previous ? steady + 1 : 0; previous = signature; tries += 1;
      if (steady < 2 && tries < 20) { frame = requestAnimationFrame(settle); return; }
      if (Math.abs(from.left - to.left) < .5 && Math.abs(from.top - to.top) < .5 && Math.abs(from.width - to.width) < .5 && Math.abs(from.height - to.height) < .5) return;
      device.getAnimations().forEach(item => item.cancel());
      device.animate([
        { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: ms, easing: CURVE });
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [stage, key, ms]);
}
