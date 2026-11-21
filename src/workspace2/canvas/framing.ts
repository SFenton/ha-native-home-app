export interface CanvasBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export function frameCanvas(bounds: CanvasBounds, viewport: { width: number; height: number }, result: CanvasBounds = bounds, minimumZoom = .6) {
  const padding = 24, usableHeight = Math.max(1, viewport.height - 80);
  const fittingZoom = Math.min(1, Math.max(1, viewport.width - padding * 2) / bounds.width, Math.max(1, usableHeight - padding * 2) / bounds.height);
  const zoom = Math.max(minimumZoom, fittingZoom);
  const target = fittingZoom < minimumZoom ? result : bounds;
  return {
    zoom,
    left: Math.max(0, (target.x + target.width / 2) * zoom - viewport.width / 2),
    top: Math.max(0, target.height * zoom > usableHeight ? target.y * zoom - padding : (target.y + target.height / 2) * zoom - usableHeight / 2),
  };
}
