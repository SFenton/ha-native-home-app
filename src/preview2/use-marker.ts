import { useLayoutEffect, useState, type RefObject } from 'react';
import { buildDocumentIndex, type SelectionKey } from './model';
import type { CompositionDocument } from '../shared/composition/schema';
import './use-marker.css';

/** The name the marker's tag and status line give the thing `key` stands for, or undefined when it has none to show. */
export function markTitle(document: CompositionDocument, key: SelectionKey): string | undefined {
  const entry = buildDocumentIndex(document).get(key);
  if (!entry) return undefined;
  if (entry.node) return entry.node.title;
  if (entry.kind === 'modal') return document.modals.find(modal => `modal:${modal.id}` === key)?.title;
  if (entry.kind === 'tab') return document.navigation.tabs.find(tab => `tab:${tab.id}` === key)?.label;
  return undefined;
}

const SVG = 'http://www.w3.org/2000/svg';
/** The tag: lucide's `Scan` and the element's title. Built by hand so the title is only ever text, and React never owns it. */
function buildTag(title: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'sh-use-tag';
  tag.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(name, value);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2');
  svg.append(path);
  const text = document.createElement('span');
  text.textContent = title;
  tag.append(svg, text);
  return tag;
}

/**
 * The Use marker (studio-ux2 lib3, L-mark; the one hook the Studio's library adds inside the simulator). In Use, the element the
 * library or the inspector has selected gets four corner marks and a name tag, so a person knows what the editor is showing.
 * It sets `data-marked` on the element the preview already tags with `data-sel` and puts the tag inside it; the marks are drawn by
 * `use-marker.css`. Nothing takes pointer events, so a tap still reaches the app. A page has no marker (the whole screen is the
 * page), and an element a rule hides is not drawn, so it has none.
 *
 * @param root The preview's root element.
 * @param active Whether the mode is Use.
 * @param key The selection, if any.
 * @param title What the tag says.
 * @param zoom The scale the device is drawn at; the tag undoes it to keep its size.
 * @returns The title of the element marked right now, for the status line; undefined when none is.
 */
export function useUseMarker(root: RefObject<HTMLElement | null>, active: boolean, key: SelectionKey | undefined, title: string | undefined, zoom: number): string | undefined {
  const [shown, setShown] = useState<string>();
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || !active || !key || !title || key.startsWith('page:')) { setShown(undefined); return; }
    let marked: HTMLElement | undefined;
    const clear = () => {
      if (!marked) return;
      marked.removeAttribute('data-marked'); marked.removeAttribute('data-mark-small');
      for (const tag of marked.querySelectorAll(':scope > .sh-use-tag')) tag.remove();
      marked = undefined;
    };
    const place = () => {
      const found = [...host.querySelectorAll<HTMLElement>('[data-sel]')].find(element => element.getAttribute('data-sel') === key);
      if (found !== marked) {
        clear();
        marked = found;
        if (marked) { marked.setAttribute('data-marked', ''); marked.append(buildTag(title)); }
      }
      setShown(marked ? title : undefined);
      if (!marked) return;
      // Corner arms are 18 px, 12 px on an element under 44 px either way (laid out size, so the zoom does not matter).
      if (marked.offsetWidth < 44 || marked.offsetHeight < 44) marked.setAttribute('data-mark-small', ''); else marked.removeAttribute('data-mark-small');
      const tag = marked.querySelector<HTMLElement>(':scope > .sh-use-tag');
      if (!tag) return;
      tag.style.setProperty('--sh-mark-scale', String(1 / zoom));
      // Within 24 px of the screen's top, the tag sits on the bottom edge so it stays on the screen.
      const screen = (marked.closest('.sh-screen') ?? host).getBoundingClientRect();
      tag.toggleAttribute('data-bottom', (marked.getBoundingClientRect().top - screen.top) / zoom < 24);
    };
    let queued = false;
    const soon = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; place(); }); } };
    place();
    const watch = new MutationObserver(soon);
    watch.observe(host, { childList: true, subtree: true });
    host.addEventListener('scroll', soon, true);
    return () => { watch.disconnect(); host.removeEventListener('scroll', soon, true); clear(); setShown(undefined); };
  }, [root, active, key, title, zoom]);
  return shown;
}
