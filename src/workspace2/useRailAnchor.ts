import { useLayoutEffect, useState } from 'react';

/** Where the simulator rail sits, in the canvas's own coordinates. */
export interface RailAnchor { left: number; top: number; /** The rail sits under the device (a canvas under 420 px wide), centred on it. */ under: boolean }

/**
 * Finds the room just right of the device and level with its middle, so the rail follows the device as the window, the zoom and the
 * panels change. `stage` is the element the device is drawn in; `deps` are what can move the device without resizing the stage.
 */
export function useRailAnchor(stage: HTMLElement | null, enabled: boolean, deps: readonly unknown[], under = false): RailAnchor | undefined {
  const [anchor, setAnchor] = useState<RailAnchor>();
  useLayoutEffect(() => {
    if (!stage || !enabled) { setAnchor(undefined); return; }
    const measure = () => {
      const device = stage.querySelector<HTMLElement>('.device-stage'), canvas = stage.parentElement;
      if (!device || !canvas) return;
      const box = device.getBoundingClientRect(), room = canvas.getBoundingClientRect();
      let left: number, top: number;
      if (under) {
        // Under the device, 12 px below the frame itself, centred on it and kept inside the canvas by the rail's own width.
        const frame = (stage.querySelector<HTMLElement>('.device-model') ?? device).getBoundingClientRect();
        const half = (canvas.querySelector<HTMLElement>('.w2-rail-slot')?.offsetWidth ?? 0) / 2;
        left = Math.max(half + 8, Math.min(room.width - half - 8, frame.left + frame.width / 2 - room.left)); top = Math.min(room.height - 8, frame.bottom - room.top + 12);
      } else {
        // Gap of 16 px from the device; kept inside the canvas, with the rail's own width reserved.
        left = Math.min(box.right - room.left + 16, room.width - 56); top = Math.max(60, Math.min(room.height - 60, box.top - room.top + box.height / 2));
      }
      setAnchor(old => old && old.under === under && Math.abs(old.left - left) < .5 && Math.abs(old.top - top) < .5 ? old : { left, top, under });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(stage);
    const device = stage.querySelector('.device-stage');
    if (device) observer?.observe(device);
    window.addEventListener('resize', measure);
    // The preview sizes itself a frame after the window changes, so look again once it has.
    const frame = requestAnimationFrame(measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, enabled, under, ...deps]);
  return anchor;
}
