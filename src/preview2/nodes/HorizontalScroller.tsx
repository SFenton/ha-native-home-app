import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useRender } from '../render-context';

/** Props of {@link HorizontalScroller}. */
export interface HorizontalScrollerProps {
  /** `rail` is the chip row under the title; `paged` is the snapping row. Sets where the bar sits. */
  kind: 'rail' | 'paged';
  /** Class of the scrolling element itself (`sh-rail`, `sh-paged-track`). */
  className: string;
  style?: CSSProperties;
  role?: string;
  label?: string;
  children: ReactNode;
}

/** What the bar draws: the thumb's width and offset in the bar's own points; hidden when nothing overflows. */
type Thumb = { width: number; x: number; max: number; now: number };
const MIN_THUMB = 28;
const KEY_STEP = 40;

/**
 * A row that scrolls sideways. In Use it is the app's own row: no bar, scrolled by touch, trackpad, Shift and the wheel, or a
 * mouse drag (`attachPreviewPointer`). In Edit the same row also carries a thin scroll bar that can be dragged, since the
 * selection layer is busy with clicks and a mouse has no other way to reach what overflows. The bar sits over the row's own
 * padding, so Edit lays out as Use does, and it never takes part in selection (`data-passthrough`).
 */
export function HorizontalScroller({ kind, className, style, role, label, children }: HorizontalScrollerProps) {
  const { mode } = useRender();
  const scroller = useRef<HTMLDivElement>(null);
  return <div className="sh-hscroll" data-kind={kind}>
    <div ref={scroller} className={className} style={style} role={role} aria-label={label}>{children}</div>
    {mode === 'edit' && <ScrollBar scroller={scroller} label={label}/>}
  </div>;
}

/** The thin bar under a scrolling row: a track the width of the row and a thumb as wide as the row's visible share. */
function ScrollBar({ scroller, label }: { scroller: React.RefObject<HTMLDivElement | null>; label?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb>();
  const measure = () => {
    const row = scroller.current, track = bar.current;
    if (!row || !track) return;
    const max = row.scrollWidth - row.clientWidth;
    if (max <= 1 || track.clientWidth <= 0) { setThumb(old => old ? undefined : old); return; }
    const width = Math.min(track.clientWidth, Math.max(MIN_THUMB, track.clientWidth * row.clientWidth / row.scrollWidth));
    const next = { width, x: (track.clientWidth - width) * Math.min(1, Math.max(0, row.scrollLeft / max)), max, now: row.scrollLeft };
    setThumb(old => old && Math.abs(old.width - next.width) < .5 && Math.abs(old.x - next.x) < .5 && old.max === next.max ? old : next);
  };
  useEffect(() => {
    const row = scroller.current;
    if (!row) return;
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    const watch = () => { if (!sizes) return; sizes.disconnect(); sizes.observe(row); for (const child of row.children) sizes.observe(child); };
    watch();
    const changes = typeof MutationObserver === 'function' ? new MutationObserver(() => { watch(); measure(); }) : undefined;
    changes?.observe(row, { childList: true });
    return () => { row.removeEventListener('scroll', measure); sizes?.disconnect(); changes?.disconnect(); };
  }, [scroller]);

  const scale = () => { const track = bar.current; return track && track.offsetWidth > 0 ? track.getBoundingClientRect().width / track.offsetWidth || 1 : 1; };
  const latest = useRef<Thumb | undefined>(undefined);
  latest.current = thumb;
  // Native listeners: the workspace's node drag listens on the stage for a press on any node, and React's own listener sits above
  // it, so only a native listener here can keep a press on the bar from starting that drag or selecting the row.
  useEffect(() => {
    const track = bar.current;
    if (!track) return;
    const press = (event: globalThis.PointerEvent) => {
      const row = scroller.current, now = latest.current;
      event.stopPropagation();
      if (!row || !now || event.button !== 0) return;
      event.preventDefault();
      const px = scale();
      if (event.target !== track) {
        // The thumb: the row follows the pointer by the share of the track the thumb has travelled.
        const handle = event.target as HTMLElement, start = { x: event.clientX, left: row.scrollLeft }, ratio = now.max / Math.max(1, track.clientWidth - now.width);
        handle.setPointerCapture(event.pointerId);
        const move = (next: globalThis.PointerEvent) => { row.scrollLeft = start.left + (next.clientX - start.x) / px * ratio; };
        const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
      } else {
        // The bare track pages the row toward the press, as a scroll bar does.
        const at = (event.clientX - track.getBoundingClientRect().left) / px;
        row.scrollLeft += (at < now.x ? -1 : 1) * row.clientWidth * .9;
      }
    };
    const touch = (event: TouchEvent) => event.stopPropagation();
    track.addEventListener('pointerdown', press);
    track.addEventListener('touchstart', touch, { passive: true });
    return () => { track.removeEventListener('pointerdown', press); track.removeEventListener('touchstart', touch); };
  }, [scroller]);
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = scroller.current;
    if (!row || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault(); event.stopPropagation();
    row.scrollLeft += event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP;
  };
  return <div ref={bar} className="sh-hbar" data-passthrough="" data-idle={thumb ? undefined : ''}>
    {thumb && <div className="sh-hbar-thumb" role="scrollbar" aria-orientation="horizontal" aria-label={label ? `Scroll ${label}` : 'Scroll'} aria-valuemin={0} aria-valuemax={Math.round(thumb.max)} aria-valuenow={Math.round(thumb.now)}
      tabIndex={0} style={{ width: thumb.width, left: thumb.x }} onKeyDown={key}/>}
  </div>;
}
