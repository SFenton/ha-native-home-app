import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import type { CompositionDocument } from '../shared/composition/schema';
import { canHold, type Destination } from './add/insert';
import { useDrag, type Locator } from './dnd/DragLayer';
import type { Cue } from './dnd/geometry';
import { buildPageRows } from './outline';
import { Tag } from './kit';
import type { Workspace2 } from './useWorkspace2';

/** The destination just before a node in its own container. */
function before(document: CompositionDocument, key: SelectionKey): Destination | undefined {
  const entry = buildDocumentIndex(document).get(key);
  return entry?.parent ? { list: entry.path.slice(0, -1), index: Number(entry.path.at(-1)), owner: entry.parent } : undefined;
}
const within = (index: ReturnType<typeof buildDocumentIndex>, key: SelectionKey, ancestor: SelectionKey) => key === ancestor || index.ancestors(key).includes(ancestor);

/** The bar for a slot, drawn between the rows of the list. */
function cueOnRows(list: HTMLElement, document: CompositionDocument, destination: Destination): Cue | undefined {
  const index = buildDocumentIndex(document);
  const siblings = index.children(destination.owner);
  const rowOf = (key: SelectionKey | undefined) => key ? list.querySelector<HTMLElement>(`[data-row="${key}"]`) : null;
  const next = rowOf(siblings[destination.index]);
  const last = rowOf(siblings[destination.index - 1]) ?? rowOf(destination.owner);
  const anchor = next ?? last;
  if (!anchor) return undefined;
  const box = anchor.getBoundingClientRect();
  const y = next ? box.top : box.bottom;
  return { line: { left: box.left + 8, top: y - 1, width: box.width - 16, height: 3 }, name: '', vertical: false };
}

/**
 * "This Page" (spec 5.3): the nodes of the page or sheet being shown, in order, indented by depth, with a "Rule" tag where a
 * Visible-when rule decides. Choosing a row selects it and shows it on the canvas; the grip reorders it by pointer or keyboard
 * through the same drag layer as the canvas, so one move is one undo step.
 */
export default function ThisPage({ ws, onPick }: { ws: Workspace2; onPick?: () => void }) {
  const drag = useDrag();
  const list = useRef<HTMLUListElement>(null);
  const document = ws.document, surface = ws.surface;
  const index = useMemo(() => document ? buildDocumentIndex(document) : undefined, [document]);
  const rows = useMemo(() => document && index && surface ? buildPageRows(document, index, surface) : [], [document, index, surface]);
  if (!document || !index || !surface) return null;
  if (!rows.length) return <p className="w2-empty">Nothing on this page yet.</p>;

  const locate = (dragged: SelectionKey): Locator => (x, y) => {
    const host = list.current;
    if (!host) return undefined;
    const type = index.get(dragged)?.node?.type ?? '';
    for (const element of host.querySelectorAll<HTMLElement>('[data-row]')) {
      const box = element.getBoundingClientRect();
      if (y < box.top || y > box.bottom || x < box.left || x > box.right) continue;
      const key = element.getAttribute('data-row') as SelectionKey;
      if (within(index, key, dragged)) return undefined;
      const entry = index.get(key);
      const frac = (y - box.top) / box.height;
      // The middle of a container's row drops into it, at its end; the edges drop before or after the row.
      const options: Destination[] = [];
      if (frac > 0.25 && frac < 0.75 && entry?.node) {
        const kids = index.children(key);
        const list = entry.path.concat(entry.node.type === 'local-tabs' ? [] : ['children']);
        if (canHold(document, key, type)) options.push({ list, index: kids.length, owner: key });
      }
      const side = frac < 0.5 ? before(document, key) : (() => { const b = before(document, key); return b ? { ...b, index: b.index + 1 } : undefined; })();
      if (side && canHold(document, side.owner, type)) options.push(side);
      const destination = options[0];
      const cue = destination && cueOnRows(host, document, destination);
      return destination && cue ? { destination, cue } : undefined;
    }
    return undefined;
  };

  const pick = (key: SelectionKey) => { ws.select(key); onPick?.(); };
  const down = (key: SelectionKey) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || event.button !== 0) return;
    event.preventDefault();
    const row = event.currentTarget.closest<HTMLElement>('[data-row]');
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    const moved = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
        started = true;
        drag.begin({ key, mode: e.pointerType === 'touch' ? 'touch' : 'mouse', point: start, locate: locate(key), ghostOf: row });
      }
      drag.move(e.clientX, e.clientY);
    };
    const done = (commit: boolean) => () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); if (started) (commit ? drag.end() : drag.cancel()); };
    const up = done(true), cancel = done(false);
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  const keyboard = (key: SelectionKey) => (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter') && drag && !drag.active) {
      event.preventDefault(); event.stopPropagation();
      drag.startKeyboard(key, destination => list.current ? cueOnRows(list.current, document, destination) : undefined);
    }
  };

  return <ul className="w2-this-page-list" ref={list} aria-label="This Page" data-testid="this-page">
    {rows.map(row => <li key={row.key} data-row={row.key} data-current={ws.selection === row.key || undefined} className="w2-this-row" style={{ paddingInlineStart: 4 + row.depth * 16 }}>
      <button type="button" className="w2-this-grip" aria-label={`Move ${row.title}`} onPointerDown={down(row.key)} onKeyDown={keyboard(row.key)}><GripVertical size={16} aria-hidden/></button>
      <button type="button" className="w2-this-main" aria-current={ws.selection === row.key ? 'true' : undefined} onClick={() => pick(row.key)}>
        <span className="w2-page-title">{row.title}</span>
        {row.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
      </button>
    </li>)}
  </ul>;
}
