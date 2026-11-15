import { useEffect, useMemo, useRef } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { buildDocumentIndex, selectionKey, type SelectionKey } from '../preview2/model';
import type { House, Overlay } from '../preview2/projections';

/** A page or a presented sheet. */
export type PreviewSurface = { kind: 'page' | 'modal'; id: string };

/** A window in points. Layout is geometric: never branch on `name`. */
export interface PreviewWindow { name: string; width: number; height: number; safeTop: number; safeBottom: number }

/** The windows the preview can draw. Phase 1 uses the iPhone. */
export const previewWindows: readonly PreviewWindow[] = [{ name: 'iPhone', width: 402, height: 874, safeTop: 62, safeBottom: 34 }];

/** The contract with the renderer lane (`preview2-contract.md`): same props as `Preview2`. */
export interface Preview2Props {
  document: CompositionDocument;
  mode: 'edit' | 'use';
  surface: PreviewSurface;
  onSurfaceChange(next: PreviewSurface): void;
  selection?: SelectionKey;
  onSelect(next: SelectionKey | undefined): void;
  window: PreviewWindow;
  bezel: boolean;
  house?: House;
  overlay: Overlay;
  onOverlayChange(next: Overlay): void;
  onSimulatedCall?(summary: string): void;
  revealKey?: SelectionKey;
  bottomInset?: number;
}

/**
 * Stand-in for `Preview2` until the renderer lane merges: a plain dark rectangle listing the surface's nodes as
 * selectable rows, its title, and the tab bar. It draws nothing of the app; it only exercises the shell's contract.
 */
export default function PreviewStub({ document, mode, surface, onSurfaceChange, selection, onSelect, window: size, bezel, revealKey, bottomInset = 0 }: Preview2Props) {
  const index = useMemo(() => buildDocumentIndex(document), [document]);
  const root = useRef<HTMLDivElement>(null);
  const surfaceKey = selectionKey(surface.kind, surface.id);
  const title = (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id)?.title ?? surface.id;
  useEffect(() => {
    if (!revealKey) return;
    root.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(revealKey)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [revealKey, bottomInset]);
  const rows: { key: SelectionKey; title: string; depth: number }[] = [];
  const walk = (key: SelectionKey, depth: number) => index.children(key).forEach(child => {
    const entry = index.get(child);
    if (entry?.node) rows.push({ key: child, title: entry.node.title, depth });
    walk(child, depth + 1);
  });
  walk(surfaceKey, 0);
  const editing = mode === 'edit';
  return <div ref={root} className={`sh-stub ${bezel ? 'bezel' : 'bare'}`} data-preview-root data-mode={mode}
    style={{ width: bezel ? size.width : '100%', maxWidth: '100%', minHeight: bezel ? size.height : undefined, paddingBottom: bottomInset }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !editing || !selection) return;
      const parent = index.ancestors(selection).at(-1);
      onSelect(parent && parent !== surfaceKey ? parent : undefined);
    }}>
    <button type="button" className="sh-stub-title" data-node-key={surfaceKey} data-selected={selection === surfaceKey || undefined} aria-pressed={selection === surfaceKey}
      onClick={() => editing && onSelect(surfaceKey)}>{title}</button>
    <ul className="sh-stub-list">
      {rows.map(row => <li key={row.key} style={{ paddingInlineStart: row.depth * 16 }}>
        <button type="button" className="sh-stub-row" data-node-key={row.key} data-selected={selection === row.key || undefined} aria-pressed={selection === row.key}
          onClick={() => editing && onSelect(row.key)}>{row.title}</button>
      </li>)}
    </ul>
    {surface.kind === 'page' && document.navigation.tabs.length > 0 && <nav className="sh-stub-tabs" aria-label="Tab bar">
      {document.navigation.tabs.map(tab => <button key={tab.id} type="button" data-node-key={selectionKey('tab', tab.id)}
        data-selected={selection === selectionKey('tab', tab.id) || undefined}
        onClick={() => { onSurfaceChange({ kind: 'page', id: tab.pageId }); if (editing) onSelect(selectionKey('tab', tab.id)); }}>{tab.label}</button>)}
    </nav>}
  </div>;
}
