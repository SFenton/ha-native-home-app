import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronRight, GripVertical, Layers, LayoutGrid, List, Rows3, SquareStack, Type as TypeGlyph, Square } from 'lucide-react';
import { GlyphByName, hasGlyph } from '../../preview2/nodes/shared';
import type { SelectionKey } from '../../preview2/model';
import { NodeMenu } from '../PropertiesPanel';
import { useDrag, TOUCH_DELAY, TOUCH_TOLERANCE, MOUSE_SLOP, type Locator } from '../dnd/DragLayer';
import type { Cue } from '../dnd/geometry';
import { endOf, type Destination } from '../add/insert';
import { isOverlayLevel, OVERLAY_SLOT, type LevelRow } from '../levels';
import type { Workspace2 } from '../useWorkspace2';
import { AreaMenu } from '../layout/AreaMenu';

/** The glyph of a node type, for a row whose node has no icon of its own. */
const typeGlyphs: Record<string, typeof Square> = {
  'tile-grid': LayoutGrid, stack: Rows3, repeat: Rows3, section: Rows3, 'status-rail': List, 'room-section': Rows3, 'paged-row': Rows3, 'local-tabs': SquareStack, 'local-tab': SquareStack, 'shared-area': Layers, text: TypeGlyph,
};

/** One row's glyph: the node's icon, else the glyph of its type. */
function RowGlyph({ row }: { row: LevelRow }) {
  if (row.icon && hasGlyph(row.icon)) return <GlyphByName name={row.icon} size={20}/>;
  const Glyph = typeGlyphs[row.type] ?? Square;
  return <Glyph size={20} strokeWidth={1.8} aria-hidden/>;
}

/** What the sheet gives the list: how to go into a row, what a leaf does, and the Move To… page. */
export interface LevelListProps {
  ws: Workspace2;
  /** The container the rows belong to. */
  level: SelectionKey;
  rows: LevelRow[];
  onEnter: (key: SelectionKey) => void;
  /** A leaf was chosen: it is selected, and the sheet gives way to its properties. */
  onLeaf: (key: SelectionKey) => void;
  onMoveTo: (id: string) => void;
  onError: (message: string) => void;
  /** Which way the last move between levels went, so the list slides in from that side. */
  direction?: 'forward' | 'back';
}

/**
 * The rows of one level (studio-ux2 pick 4), 56 px at least: glyph, title over its context line, the node's More menu, the grip
 * that reorders within the level, and a chevron on a container. A container row goes in; a leaf row selects. The grip uses the
 * canvas's drag layer: a touch needs a hold of 220 ms and a second finger cancels it, a pointer starts after 4 px, and Space or
 * Enter starts a keyboard move whose arrows step through this level only. Dropping onto a row to nest is not offered here: Move To…
 * does that without an accident.
 */
export default function LevelList({ ws, level, rows, onEnter, onLeaf, onMoveTo, onError, direction }: LevelListProps) {
  const drag = useDrag();
  const list = useRef<HTMLUListElement>(null);
  const document = ws.document!, index = ws.index!;

  /** The destination at a position of this level's own list. */
  const slot = (at: number): Destination | undefined => {
    const end = endOf(document, level);
    return end ? { ...end, index: at } : undefined;
  };
  /** The position in the document list of a row's node. */
  const place = (key: SelectionKey) => Number(index.get(key)?.path.at(-1));
  /** The bar for a destination: above the first row at or after it, else below the last row. */
  const cueFor = (destination: Destination): Cue | undefined => {
    const host = list.current;
    if (!host) return undefined;
    const next = rows.find(row => place(row.key) >= destination.index);
    const anchor = host.querySelector<HTMLElement>(`[data-row="${next?.key ?? rows.at(-1)?.key}"]`);
    if (!anchor) return undefined;
    const box = anchor.getBoundingClientRect();
    return { line: { left: box.left + 8, top: (next ? box.top : box.bottom) - 1, width: box.width - 16, height: 3 }, name: '', vertical: false };
  };
  const locate = (): Locator => (x, y) => {
    const host = list.current;
    if (!host) return undefined;
    for (const element of host.querySelectorAll<HTMLElement>('[data-row]')) {
      const box = element.getBoundingClientRect();
      if (y < box.top || y > box.bottom || x < box.left || x > box.right) continue;
      const key = element.getAttribute('data-row') as SelectionKey;
      const at = place(key) + (y - box.top < box.height / 2 ? 0 : 1);
      const destination = slot(at);
      const cue = destination && cueFor(destination);
      return destination && cue ? { destination, cue } : undefined;
    }
    return undefined;
  };

  const down = (key: SelectionKey) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || event.button !== 0) return;
    event.preventDefault();
    const row = event.currentTarget.closest<HTMLElement>('[data-row]');
    const start = { x: event.clientX, y: event.clientY }, touch = event.pointerType === 'touch';
    let started = false, last = start, timer = 0;
    const begin = (point: { x: number; y: number }) => { started = true; drag.begin({ key, mode: touch ? 'touch' : 'mouse', point, locate: locate(), ghostOf: row }); drag.move(last.x, last.y); };
    const stop = () => { clearTimeout(timer); window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('pointerdown', other, true); };
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      last = { x: e.clientX, y: e.clientY };
      const away = Math.hypot(last.x - start.x, last.y - start.y);
      if (!started) {
        // A touch waits for its hold: moving before it is a scroll that was meant for the list, so it gives up.
        if (touch) { if (away > TOUCH_TOLERANCE) stop(); return; }
        if (away < MOUSE_SLOP) return;
        begin(start);
      }
      drag.move(last.x, last.y);
    };
    const up = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started) drag.end(); };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; stop(); if (started) drag.cancel(); };
    // A second finger cancels a drag that has begun, and keeps one that has not from beginning.
    const other = (e: PointerEvent) => { if (e.pointerId === event.pointerId) return; stop(); if (started) drag.cancel(); };
    if (touch) timer = window.setTimeout(() => begin(last), TOUCH_DELAY);
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('pointerdown', other, true);
  };
  const keyboard = (key: SelectionKey) => (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter') && drag && !drag.active) {
      event.preventDefault(); event.stopPropagation();
      drag.startKeyboard(key, cueFor, destination => destination.owner === level);
    }
  };

  if (!rows.length) return isOverlayLevel(index, level) ? <p className="w2-empty w2-level-empty w2-overlay-slot" data-testid="overlay-slot">{OVERLAY_SLOT}</p> : <p className="w2-empty w2-level-empty">Nothing here yet.</p>;
  return <ul className="w2-level-list" ref={list} data-direction={direction} aria-label="Items" data-testid="level-list" data-base-ui-swipe-ignore>
    {rows.map(row => {
      const node = index.get(row.key)?.kind === 'node', area = Boolean(row.area);
      const current = ws.selection === row.key;
      return <li key={row.key} data-row={row.key} data-current={current || undefined} className="w2-level-row">
        <button type="button" className="w2-level-main" aria-current={current ? 'true' : undefined} onClick={() => row.container ? onEnter(row.key) : onLeaf(row.key)}>
          <span className="w2-level-glyph"><RowGlyph row={row}/></span>
          <span className="w2-level-text"><span className="w2-level-title">{row.title}</span><span className="w2-level-context">{row.context}</span></span>
        </button>
        {node && <NodeMenu ws={ws} path={index.get(row.key)!.path} selectionKey={row.key} onError={onError} label={`More for ${row.title}`} className="w2-icon-button w2-level-more"
          onMoveTo={() => onMoveTo(index.get(row.key)!.node!.id)}/>}
        {area && <AreaMenu ws={ws} areaKey={row.key} title={row.title} onError={onError}/>}
        {node && <button type="button" className="w2-level-grip" aria-label={`Move ${row.title}`} data-base-ui-swipe-ignore onPointerDown={down(row.key)} onKeyDown={keyboard(row.key)}><GripVertical size={18} aria-hidden/></button>}
        <span className="w2-level-chevron" aria-hidden onClick={() => row.container && onEnter(row.key)}>{row.container && <ChevronRight size={18}/>}</span>
      </li>;
    })}
  </ul>;
}
