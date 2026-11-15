import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { DocumentIndex, SelectionKey } from './model';

/**
 * The selection key a click or tap landed on: the nearest `data-sel` ancestor of `target`. A wallpaper or page title sits
 * inside the page's own `data-sel`, so it selects the page.
 */
export function selectionKeyAt(target: EventTarget | null): SelectionKey | undefined {
  const found = target instanceof Element ? target.closest('[data-sel]') : null;
  return (found?.getAttribute('data-sel') ?? undefined) as SelectionKey | undefined;
}

/**
 * What Esc selects: the enclosing node, local tab or page, then nothing. A header button's group is not drawn, so it counts
 * as no parent.
 */
export function parentSelection(index: DocumentIndex, key: SelectionKey): SelectionKey | undefined {
  const parent = index.get(key)?.parent;
  return parent && !parent.startsWith('chrome-group:') ? parent : undefined;
}

/** Props of {@link SelectionLayer}. */
export interface SelectionLayerProps {
  /** Edit selects; Use leaves every click to the app's own actions. */
  mode: 'edit' | 'use';
  index: DocumentIndex;
  selection?: SelectionKey;
  onSelect(next: SelectionKey | undefined): void;
  /** A tap on a tab in Edit also opens the tab's page. */
  onTab(tabId: string): void;
  children: ReactNode;
}

/**
 * One delegated listener for the whole screen. In Edit a click anywhere takes the nearest `data-sel` key, selects it and stops
 * the app's own handler, so a tile never navigates while it is being edited; Esc selects the parent, then nothing. The ring and
 * the handle slot are drawn by the nodes themselves (see `NodeFrame`); this layer only decides what is selected.
 */
export function SelectionLayer({ mode, index, selection, onSelect, onTab, children }: SelectionLayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const click = (event: MouseEvent) => {
    if (mode !== 'edit' || (event.target instanceof Element && event.target.closest('.sh-handle-slot'))) return;
    event.preventDefault();
    event.stopPropagation();
    const key = selectionKeyAt(event.target);
    if (!key) { onSelect(undefined); return; }
    onSelect(key);
    if (key.startsWith('tab:')) onTab(key.slice(4));
  };
  const keydown = (event: KeyboardEvent) => {
    if (mode !== 'edit' || event.key !== 'Escape' || !selection) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(parentSelection(index, selection));
  };
  return <div ref={root} className="sh-layer" tabIndex={-1} onClickCapture={click} onKeyDown={keydown}
    onPointerDown={() => { if (mode === 'edit') root.current?.focus({ preventScroll: true }); }}>{children}</div>;
}
