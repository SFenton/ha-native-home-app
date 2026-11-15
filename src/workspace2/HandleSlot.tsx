import { useEffect, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Plus } from 'lucide-react';
import { useAdd } from './add/AddHost';
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
 * The selected tile's handle (spec 5.1, wide only): a drag grip and More on its top trailing corner, drawn into the slot the
 * preview leaves on the selected node. The grip moves the tile with Option-Up and Option-Down, or Up and Down, until drag
 * and drop lands in phase 2; More holds Duplicate, Move Up, Move Down and Delete.
 */
export default function HandleSlot({ ws, stage, onError }: { ws: Workspace2; stage: HTMLElement | null; onError: (message: string) => void }) {
  const key = ws.mode === 'edit' && ws.target?.kind === 'node' ? ws.target.key : undefined;
  const slot = useSlot(stage, key);
  const add = useAdd();
  const entry = key ? ws.index?.get(key) : undefined;
  if (!slot || !key || !entry?.node || !ws.document) return null;
  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    try { ws.studio.apply(moveNodeBy(ws.document!, entry.path, event.key === 'ArrowUp' ? -1 : 1)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return createPortal(<div className="w2-handle" data-testid="node-handle">
    <button type="button" className="w2-handle-grip" aria-label="Move" title="Move" onKeyDown={move}><GripVertical size={16} aria-hidden/></button>
    <button type="button" className="w2-handle-add" aria-label={`Add after ${entry.node.title}`} title="Add" onClick={event => { const destination = after(ws.document!, key); if (destination) add?.open(destination, event.currentTarget); }}><Plus size={16} aria-hidden/></button>
    <NodeMenu ws={ws} path={entry.path} selectionKey={key} onError={onError} className="w2-handle-more"/>
  </div>, slot);
}
