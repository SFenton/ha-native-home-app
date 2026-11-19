import { useLayoutEffect, useState, type RefObject } from 'react';

export interface CanvasWindow { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
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
      const overscan = 240, left = (element.scrollLeft - overscan) / zoom, top = (element.scrollTop - overscan) / zoom;
      const right = (element.scrollLeft + element.clientWidth + overscan) / zoom, bottom = (element.scrollTop + element.clientHeight + overscan) / zoom;
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
