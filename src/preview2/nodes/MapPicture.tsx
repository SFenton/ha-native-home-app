import { useEffect, useRef, useState } from 'react';
import { useRender } from '../render-context';
import { decodeValetudoPng, drawValetudoMap, type ValetudoMap } from '../valetudo-map';

/** The web's live poll interval (`ValetudoMapLoader.pollInterval`). */
export const MAP_POLL_MS = 3500;

/** Where a shown map came from: the vacuum answering, or the camera's last picture. */
export type MapProvenance = 'live' | 'reported';

/**
 * Loads the vacuum's map from its camera picture and keeps the last good one on screen (`ValetudoMapLoader`). It polls only in Use
 * while the vacuum answers; in Edit, or while the vacuum is unavailable, it reads once. `undefined` without a connection, so the
 * node draws its schematic.
 */
export function useValetudoMap(mapId: string | undefined, live: boolean): { map?: ValetudoMap; failed: boolean } {
  const { mapPicture, mode } = useRender();
  const [state, setState] = useState<{ map?: ValetudoMap; failed: boolean }>({ failed: false });
  const hasMap = useRef(false);
  hasMap.current = Boolean(state.map);
  useEffect(() => {
    if (!mapPicture || !mapId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      // A hidden tab keeps its timer but asks for nothing: the app polls only while the map is on screen (`OnScreenMonitor`).
      if (typeof document !== 'undefined' && document.hidden && hasMap.current) { schedule(); return; }
      try {
        const bytes = await mapPicture(`camera.${mapId}_map_data`, abort.signal);
        if (abort.signal.aborted) return;
        if (bytes) setState({ map: await decodeValetudoPng(new Uint8Array(bytes)), failed: false });
      } catch { if (!abort.signal.aborted) setState(old => old.map ? old : { failed: true }); }
      schedule();
    };
    const schedule = () => { if (live && mode === 'use' && !abort.signal.aborted) timer = setTimeout(() => { void load(); }, MAP_POLL_MS); };
    void load();
    return () => { abort.abort(); if (timer) clearTimeout(timer); };
  }, [mapPicture, mapId, live, mode]);
  return mapPicture ? state : { failed: false };
}

/** The map drawn into a canvas that fills its box. The canvas is decoration: the node around it carries the label. */
export function MapPicture({ map, selected, reported, flip }: { map: ValetudoMap; selected?: ReadonlySet<string>; reported: boolean; /** Mirrors the picture on screen, after the rotation (`sh.surface-orientation@1`). */ flip?: { horizontal: boolean; vertical: boolean } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawValetudoMap(ctx, map, { width, height, selected, reported });
  }, [map, selected, reported]);
  return <canvas ref={ref} className="sh-dv-map-canvas" aria-hidden="true" data-testid="valetudo-map" style={flipStyle(flip)} data-flip={flipName(flip)}/>;
}

/** The CSS that mirrors a picture on screen; none when nothing flips, so a map without an orientation draws exactly as before. */
export const flipStyle = (flip?: { horizontal: boolean; vertical: boolean }) => flip && (flip.horizontal || flip.vertical) ? { transform: `scale(${flip.horizontal ? -1 : 1}, ${flip.vertical ? -1 : 1})` } : undefined;
/** The flips in words, for a test and a screenshot: `horizontal`, `vertical`, `both`, or none. */
export const flipName = (flip?: { horizontal: boolean; vertical: boolean }) => flip?.horizontal && flip.vertical ? 'both' : flip?.horizontal ? 'horizontal' : flip?.vertical ? 'vertical' : undefined;
