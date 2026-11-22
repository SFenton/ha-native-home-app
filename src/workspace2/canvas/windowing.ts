import { useLayoutEffect, useState, type RefObject } from 'react';

export interface CanvasWindow { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export function canvasWindowAt(left: number, top: number, width: number, height: number, zoom: number): CanvasWindow {
  const overscan = 240;
  return { left: (left - overscan) / zoom, top: (top - overscan) / zoom,
    right: (left + width + overscan) / zoom, bottom: (top + height + overscan) / zoom };
}
export function intersectsWindow(window: CanvasWindow, left: number, top: number, right: number, bottom: number): boolean {
  return right >= window.left && left <= window.right && bottom >= window.top && top <= window.bottom;
}
export function useCanvasWindow(viewport: RefObject<HTMLDivElement | null>, enabled: boolean, zoom: number): CanvasWindow {
  const [window, setWindow] = useState<CanvasWindow>({ left: 0, top: 0, right: 1200, bottom: 900 });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!enabled || !element) return;
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const { left, top, right, bottom } = canvasWindowAt(element.scrollLeft, element.scrollTop, element.clientWidth, element.clientHeight, zoom);
      setWindow(held => held.left === left && held.top === top && held.right === right && held.bottom === bottom ? held : { left, top, right, bottom });
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', scroll, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', scroll); cancelAnimationFrame(frame); };
  }, [viewport, enabled, zoom]);
  return window;
}
