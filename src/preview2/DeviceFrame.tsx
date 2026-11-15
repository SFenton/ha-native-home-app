import { useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { usePreviewPointer } from '../preview-pointer';

/** Room the stage keeps around the model, in px at zoom 1. */
export const STAGE_PADDING = { x: 40, y: 36 } as const;

/**
 * The zoom (percent, 25 to 120) that fits a `width` by `height` model inside `canvas`, leaving `reserveX` and `reserveY`
 * px free for the controls around it.
 */
export function fitZoom(canvas: { clientWidth: number; clientHeight: number }, width: number, height: number, reserveX = 80, reserveY = 240): number | undefined {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return undefined;
  const scale = Math.min((canvas.clientWidth - reserveX) / width, (canvas.clientHeight - reserveY) / height);
  return Math.min(120, Math.max(25, Math.floor(scale * 100)));
}

/** Runs `fit` now and whenever `canvasRef` resizes, while `enabled`. */
export function useAutoFit(canvasRef: RefObject<HTMLElement | null>, enabled: boolean, fit: () => void) {
  useEffect(() => {
    if (!enabled) return;
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [canvasRef, enabled, fit]);
}

/** Props of {@link DeviceFrame}. */
export interface DeviceFrameProps {
  /** Model size in px at zoom 1. */
  width: number;
  height: number;
  /** Scale factor (1 = 100%). */
  zoom: number;
  /** While true a mouse press-and-drag pans the scroller under the pointer, like a finger. */
  pan: boolean;
  /** Extra transform appended after the scale (the 1.0 3D view). */
  transform?: string;
  stageClassName?: string;
  stageProps?: HTMLAttributes<HTMLDivElement>;
  modelClassName?: string;
  modelProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>;
  modelStyle?: CSSProperties;
  /** Receives the model element, for callers that measure or capture it. */
  frameRef?: RefObject<HTMLDivElement | null>;
  /** Stage perspective for the 3D view; leave unset for a flat frame. */
  perspective?: number;
  children: ReactNode;
}

/**
 * The device frame, shared by the 1.0 preview and Preview2: a stage sized to the scaled model, the model itself scaled from
 * its centre, and the scroll host behaviour (wheel and touch stay inside, a mouse pans in Interact mode; see
 * `attachPreviewPointer`). It draws nothing inside: callers pass the screen as children and the look as classes.
 */
export function DeviceFrame({ width, height, zoom, pan, transform = '', stageClassName = '', stageProps, modelClassName = '', modelProps, modelStyle, frameRef, perspective, children }: DeviceFrameProps) {
  const own = useRef<HTMLDivElement>(null);
  const ref = frameRef ?? own;
  usePreviewPointer(ref, pan);
  const { style: stageStyle, ...stageRest } = stageProps ?? {};
  return <div {...stageRest} className={`device-stage ${stageClassName}`.trim()} style={{ width: width * zoom + STAGE_PADDING.x, height: height * zoom + STAGE_PADDING.y, ...(perspective ? { perspective } : {}), ...stageStyle }}>
    <div {...modelProps} ref={ref} data-pan={pan ? '' : undefined} className={`device-model ${modelClassName}`.trim()}
      style={{ width, height, left: (width * zoom + STAGE_PADDING.x - width) / 2, top: (height * zoom + STAGE_PADDING.y - height) / 2, transform: `scale(${zoom}) ${transform}`.trim(), ...modelStyle }}>
      {children}
    </div>
  </div>;
}

/** A stable callback ref helper for components that need both their own ref and a caller's. */
export function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback(((...args: never[]) => latest.current(...args)) as T, []);
}
