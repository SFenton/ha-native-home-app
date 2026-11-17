import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Plus } from 'lucide-react';
import { useAdd } from './add/AddHost';
import { MOUSE_SLOP, useDrag } from './dnd/DragLayer';
import { locateOnCanvas } from './dnd/geometry';
import { after } from './add/insert';
import { NodeMenu } from './PropertiesPanel';
import { moveNodeBy } from './nodeActions';
import type { Workspace2 } from './useWorkspace2';

/** The empty slot the preview draws on the selected node (`[data-selected] > .sh-handle-slot`), or none. */
function useSlot(stage: HTMLElement | null, key: string | undefined): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!stage || !key) { setSlot(null); return; }
    const find = () => setSlot(old => {
      const next = [...stage.querySelectorAll<HTMLElement>('[data-selected] > .sh-handle-slot')].find(element => element.getAttribute('data-handle-for') === key) ?? null;
      return next === old ? old : next;
    });
    find();
    const watch = new MutationObserver(find);
    watch.observe(stage, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [stage, key]);
  return slot;
}

/**
 * The factor that undoes the preview's own scale at `slot`, so the handle keeps its size whatever the zoom: the model's laid
 * out width over its drawn width. 1 when the slot is not inside a scaled model.
 */
function counterScale(slot: HTMLElement): number {
  const model = slot.closest<HTMLElement>('.device-model');
  const drawn = model?.getBoundingClientRect().width ?? 0;
  return model && drawn > 0 && model.offsetWidth > 0 ? model.offsetWidth / drawn : 1;
}

/**
 * The selected tile's handle (spec 5.1, wide only): a drag grip and More on its top trailing corner, drawn into the slot the
 * preview leaves on the selected node. Space on the grip picks the tile up and the arrows step it through every slot it may
 * land in; Option-Up and Option-Down still nudge it a place; More holds Duplicate, Move Up, Move Down and Delete.
 */
export default function HandleSlot({ ws, stage, onError }: { ws: Workspace2; stage: HTMLElement | null; onError: (message: string) => void }) {
  const key = ws.mode === 'edit' && ws.target?.kind === 'node' ? ws.target.key : undefined;
  const slot = useSlot(stage, key);
  const add = useAdd();
  const drag = useDrag();
  const entry = key ? ws.index?.get(key) : undefined;
  if (!slot || !key || !entry?.node || !ws.document) return null;
  const move = (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter') && drag && !drag.active) { event.preventDefault(); event.stopPropagation(); drag.startKeyboard(key as never); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    try { ws.studio.apply(moveNodeBy(ws.document!, entry.path, event.key === 'ArrowUp' ? -1 : 1)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  // A press and a pull on the grip lifts the selected tile through the one drag layer; a press that never moves is a click.
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.active || !stage || event.button !== 0) return;
    const source = stage.querySelector<HTMLElement>(`[data-sel="${key}"]`);
    const start = { x: event.clientX, y: event.clientY }, pointer = event.pointerId;
    const touch = event.pointerType === 'touch';
    let started = false;
    const moved = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < MOUSE_SLOP) return;
        started = true;
        drag.begin({ key: key as never, mode: touch ? 'touch' : 'mouse', point: start, locate: (x, y) => ws.document ? locateOnCanvas(stage, ws.document, key as never, x, y) : undefined, ghostOf: source });
      }
      e.preventDefault();
      drag.move(e.clientX, e.clientY);
    };
    const cleanup = () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', abort); window.removeEventListener('keydown', escape, true); };
    // The release after a drag must not also click the grip or the tile under it.
    const swallow = () => { const block = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); }; window.addEventListener('click', block, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', block, true), 80); };
    const up = (e: PointerEvent) => { if (e.pointerId !== pointer) return; cleanup(); if (started) { swallow(); drag.end(); } };
    const abort = (e: PointerEvent) => { if (e.pointerId !== pointer) return; cleanup(); if (started) { swallow(); drag.cancel(); } };
    const escape = (e: KeyboardEvent | globalThis.KeyboardEvent) => { if (e.key === 'Escape' && started) { e.stopPropagation(); cleanup(); swallow(); drag.cancel(); } };
    window.addEventListener('pointermove', moved, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', abort); window.addEventListener('keydown', escape, true);
  };
  return createPortal(<div className="w2-handle" data-testid="node-handle" style={{ '--w2-handle-scale': counterScale(slot) } as CSSProperties}>
    <button type="button" className="w2-handle-grip" aria-label="Move" title="Move" onPointerDown={press} onKeyDown={move}><GripVertical size={16} aria-hidden/></button>
    <button type="button" className="w2-handle-add" aria-label={`Add after ${entry.node.title}`} title="Add" onClick={event => { const destination = after(ws.document!, key); if (destination) add?.open(destination, event.currentTarget); }}><Plus size={16} aria-hidden/></button>
    <NodeMenu ws={ws} path={entry.path} selectionKey={key} onError={onError} className="w2-handle-more"/>
  </div>, slot);
}
