import { useLayoutEffect, type RefObject } from 'react';
import type { SelectionKey } from './model';
import './repeat-marker.css';

/**
 * The repeated-piece mark (templates spec 5, option B): a dashed outline round the piece the Repeated Pieces proposal is about, with a tag that
 * says which place it is ("1 of 14"). It sits beside `use-marker.ts` and follows the same method: it sets `data-repeat-mark` on the element the preview
 * already tags with `data-sel`, and puts the tag inside it as plain text. The outline is drawn by `repeat-marker.css`; nothing takes pointer events.
 *
 * @param root The preview's root element.
 * @param key The node to mark, or nothing.
 * @param label What the tag says.
 * @param zoom The scale the device is drawn at; the tag undoes it to keep its size.
 */
export function useRepeatMark(root: RefObject<HTMLElement | null>, key: SelectionKey | undefined, label: string | undefined, zoom: number): void {
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || !key || !label) return;
    let marked: HTMLElement | undefined;
    const clear = () => {
      if (!marked) return;
      marked.removeAttribute('data-repeat-mark');
      for (const tag of marked.querySelectorAll(':scope > .sh-repeat-tag')) tag.remove();
      marked = undefined;
    };
    const place = () => {
      const found = [...host.querySelectorAll<HTMLElement>('[data-sel]')].find(element => element.getAttribute('data-sel') === key);
      if (found !== marked) {
        clear();
        marked = found;
        if (marked) {
          marked.setAttribute('data-repeat-mark', '');
          const tag = document.createElement('span');
          tag.className = 'sh-repeat-tag';
          tag.setAttribute('aria-hidden', 'true');
          tag.textContent = label;
          marked.append(tag);
        }
      }
      const tag = marked?.querySelector<HTMLElement>(':scope > .sh-repeat-tag');
      if (!marked || !tag) return;
      if (tag.textContent !== label) tag.textContent = label;
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
    return () => { watch.disconnect(); host.removeEventListener('scroll', soon, true); clear(); };
  }, [root, key, label, zoom]);
}
