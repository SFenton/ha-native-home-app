import { useLayoutEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText, middleEllipsis } from './util';
import { toastManager } from './toasts';

/** The width of one monospace character at 12 px, when a canvas cannot measure it. */
const FALLBACK_CHAR = 7.2;

/** How many characters of the ID's monospace face fit in `width` px. */
function charsIn(width: number, element: HTMLElement): number {
  let char = FALLBACK_CHAR;
  const context = document.createElement('canvas').getContext?.('2d') ?? null;
  if (context) { const style = getComputedStyle(element); context.font = `${style.fontSize} ${style.fontFamily}`; char = context.measureText('0').width || FALLBACK_CHAR; }
  return Math.floor(width / char);
}

/**
 * The ID row of an Advanced page: the standard label column, then one read-only field holding the ID in monospace and a
 * Copy glyph button at its trailing edge. The ID is one selectable line; when it does not fit, its middle is cut and the whole ID
 * stays in `title`.
 */
export default function IdRow({ id, path }: { id: string; path: string }) {
  const code = useRef<HTMLElement>(null);
  const [room, setRoom] = useState(Infinity);
  useLayoutEffect(() => {
    const element = code.current;
    if (!element) return;
    const measure = () => { const width = element.parentElement?.clientWidth ?? 0; setRoom(width > 0 ? charsIn(width - 10 - 36, element) : Infinity); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(element.parentElement!);
    return () => watch.disconnect();
  }, [id]);
  return <div className="w2-id-row" data-field-path={path}><span className="w2-row-label">ID</span>
    <div className="w2-id-field"><code ref={code} title={id}>{middleEllipsis(id, room)}</code>
      <button type="button" className="w2-id-copy" aria-label="Copy ID" title="Copy ID" onClick={async () => { if (await copyText(id)) toastManager.add({ title: 'Copied' }); }}><Copy size={16} aria-hidden/></button></div></div>;
}
