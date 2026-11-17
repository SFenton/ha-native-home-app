import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import type { SelectionKey } from '../preview2/model';
import { collapseCrumbs, CRUMB_SEPARATOR, type Crumb } from './levels';

/** The breadcrumb's text size and the room each crumb and each separator takes beside its words (the buttons' side padding, the "›"); a crumb is 44 px wide at least. */
const FONT = '12px system-ui, sans-serif', CRUMB_PAD = 8, SEPARATOR = 16;

/** A function that measures a crumb's words in px: the canvas where there is one, a rough width per character where there is not. */
function useMeasure(): (title: string) => number {
  return useMemo(() => {
    // A DOM without a canvas (a test's jsdom reports itself) gets the rough width; a browser measures the words.
    const context = typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? (() => { try { return document.createElement('canvas').getContext('2d'); } catch { return null; } })() : null;
    if (context) context.font = FONT;
    return (title: string) => Math.max(44, (context?.measureText(title).width ?? title.length * 6.4) + CRUMB_PAD);
  }, []);
}

/**
 * The path to the level on show, as the sheet's subtitle (studio-ux2 pick 4): each crumb is a button that jumps to that level. A path
 * wider than the room keeps its first and last crumbs and folds the middle ones into one "…" button that opens a menu of them; the
 * last crumb truncates when even that does not fit. At the root there is no level above, so the page's own name shows as text.
 */
export default function Crumbs({ path, atRoot, onJump, align }: { path: Crumb[]; atRoot: boolean; onJump: (key: SelectionKey) => void; /** `start` sets the path from the leading edge (the library's header); the phone's sheet centers it. */ align?: 'start' }) {
  const host = useRef<HTMLElement>(null);
  const [room, setRoom] = useState(Infinity);
  const measure = useMeasure();
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const read = () => setRoom(element.clientWidth > 0 ? element.clientWidth : Infinity);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(read);
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  const shown = useMemo(() => atRoot ? [] : collapseCrumbs(path, room, measure, SEPARATOR), [atRoot, path, room, measure]);
  return <nav ref={host} className="w2-crumbs" aria-label="Path" data-align={align}>
    {atRoot
      ? <span className="w2-crumb-text" aria-current="location">{path[0]?.title}</span>
      : shown.map((item, at) => {
        const last = at === shown.length - 1;
        return <span key={'crumb' in item ? item.crumb.key : 'hidden'} className="w2-crumb-item" data-last={last || undefined}>
          {'crumb' in item
            ? <button type="button" className="w2-crumb" data-drop-level={item.crumb.key} onClick={() => onJump(item.crumb.key)}><span>{item.crumb.title}</span></button>
            : <Menu.Root><Menu.Trigger className="w2-crumb w2-crumb-more" aria-label="Hidden levels">…</Menu.Trigger>
              <Menu.Portal><Menu.Positioner sideOffset={4} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
                {item.hidden.map(crumb => <Menu.Item key={crumb.key} className="w2-menu-item" onClick={() => onJump(crumb.key)}>{crumb.title}</Menu.Item>)}
              </Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root>}
          {!last && <span className="w2-crumb-sep" aria-hidden>{CRUMB_SEPARATOR}</span>}
        </span>;
      })}
  </nav>;
}
