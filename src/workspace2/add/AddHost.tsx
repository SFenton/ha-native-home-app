import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@base-ui/react/popover';
import { Drawer } from '@base-ui/react/drawer';
import { Plus } from 'lucide-react';
import type { SelectionKey } from '../../preview2/model';
import type { Workspace2 } from '../useWorkspace2';
import AddPicker, { offeredTypes, type AddChoice } from './AddPicker';
import { after, canHold, endOf, insertMade, type Destination } from './insert';
import { insertPlace } from '../linked';
import SavedComponents from '../SavedComponents';
import { tileType } from './catalog';

/** What the triggers call. */
export interface AddApi {
  /** Opens the picker for a destination; a wide picker anchors to `anchor`. */
  open(destination: Destination, anchor?: HTMLElement | null): void;
  /** Opens it after the selected node, else at the end of the page being shown. */
  openDefault(anchor?: HTMLElement | null): void;
  /** Adds a catalog type after the selection, else at the end of the page; one that needs an entity opens the picker on its Entities segment. */
  addType(type: string, anchor?: HTMLElement | null): void;
  /** Adds a place of a template after the selection, else at the end of the page (never inside another linked component). */
  addSaved(entryId: string, anchor?: HTMLElement | null): void;
  /** Whether the destination takes at least one tile, so a slot with nothing to add can stay empty. */
  accepts(destination: Destination): boolean;
}
const AddContext = createContext<AddApi | undefined>(undefined);
/** The add triggers' API, or undefined outside the host. */
export const useAdd = () => useContext(AddContext);

/** A point at the middle of the stage, for an add that no button started (the "A" key): a popover cannot anchor to something taller than the window. */
const centre = (stage: HTMLElement | null) => stage ? { getBoundingClientRect: () => { const box = stage.getBoundingClientRect(); return new DOMRect(box.left + box.width / 2, box.top + Math.min(box.height / 2, 220), 0, 0); } } : undefined;

/** The empty `.sh-add-slot` elements the preview draws at the end of each container in Edit, with the container they belong to. */
function useAddSlots(stage: HTMLElement | null): { element: HTMLElement; owner: SelectionKey }[] {
  const [slots, setSlots] = useState<{ element: HTMLElement; owner: SelectionKey }[]>([]);
  useEffect(() => {
    if (!stage) { setSlots([]); return; }
    let frame = 0;
    const find = () => {
      frame = 0;
      const next = [...stage.querySelectorAll<HTMLElement>('.sh-add-slot[data-add-for]')].map(element => ({ element, owner: element.getAttribute('data-add-for') as SelectionKey }));
      setSlots(old => old.length === next.length && old.every((item, at) => item.element === next[at].element) ? old : next);
    };
    find();
    const watch = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(find); });
    watch.observe(stage, { childList: true, subtree: true });
    return () => { watch.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [stage]);
  return slots;
}

/**
 * Owns the Add picker (spec 5.4): the state, the popover (wide) or the 60% sheet (narrow), the dashed "Add" slots the preview
 * leaves at the end of each container, and the "A" key. Choosing inserts at the destination, selects the new node (which opens
 * its properties) and is one undo step.
 */
export default function AddHost({ ws, narrow, stage, onError, children }: { ws: Workspace2; narrow: boolean; stage: HTMLElement | null; onError: (message: string) => void; children: ReactNode }) {
  const [state, setState] = useState<{ destination: Destination; anchor?: HTMLElement | null; type?: string }>();
  const { document, mode, surface, selection, select, studio } = ws;
  const accepts = useCallback((destination: Destination) => document ? offeredTypes(document, destination, []).length > 0 : false, [document]);
  const open = useCallback((destination: Destination, anchor?: HTMLElement | null) => {
    if (narrow) select(undefined); // one open sheet on narrow widths
    setState({ destination, anchor });
  }, [narrow, select]);
  const defaultDestination = useCallback((): Destination | undefined => {
    if (!document || !surface) return undefined;
    const key: SelectionKey | undefined = selection && ws.index?.get(selection)?.kind === 'node' ? selection : undefined;
    return (key ? after(document, key) : undefined) ?? endOf(document, `${surface.kind}:${surface.id}`);
  }, [document, surface, selection, ws.index]);
  const openDefault = useCallback((anchor?: HTMLElement | null) => { const destination = defaultDestination(); if (destination) open(destination, anchor); }, [defaultDestination, open]);
  const close = useCallback(() => setState(undefined), []);
  const addType = useCallback((typeName: string, anchor?: HTMLElement | null) => {
    const kind = tileType(typeName), start = defaultDestination();
    if (!document || !kind || !start) return;
    if (kind.domains || kind.asks) { setState({ destination: start, anchor, type: typeName }); return; }
    const page = surface ? endOf(document, `${surface.kind}:${surface.id}`) : undefined;
    const destination = canHold(document, start.owner, kind.type) ? start : page && canHold(document, page.owner, kind.type) ? page : undefined;
    if (!destination) { onError(`${kind.name} cannot go there`); return; }
    try {
      const result = insertMade(document, destination, kind.make({ document }));
      studio.apply(result.document);
      select(result.key);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }, [document, surface, defaultDestination, studio, select, onError]);
  const addSaved = useCallback((entryId: string) => {
    const start = defaultDestination();
    if (!document || !start) return;
    const page = surface ? endOf(document, `${surface.kind}:${surface.id}`) : undefined;
    const inside = (destination: Destination) => ws.index?.get(destination.owner)?.component !== undefined;
    const destination = !inside(start) ? start : page;
    if (!destination) return;
    try {
      let result;
      try { result = insertPlace(document, entryId, destination); }
      catch (error) { if (!page || destination === page) throw error; result = insertPlace(document, entryId, page); }
      studio.apply(result.document);
      select(result.key);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }, [document, surface, defaultDestination, studio, select, onError, ws.index]);
  const chooseTemplate = useCallback((entryId: string) => {
    if (!document || !state) return;
    try {
      const result = insertPlace(document, entryId, state.destination);
      studio.apply(result.document);
      select(result.key);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    setState(undefined);
  }, [document, state, studio, select, onError]);
  const choose = useCallback((choice: AddChoice) => {
    if (!document || !state) return;
    try {
      const result = insertMade(document, state.destination, choice.made);
      studio.apply(result.document);
      select(result.key);
      setState(undefined);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); setState(undefined); }
  }, [document, state, studio, select, onError]);

  // The "A" key adds, unless a person is typing or something else is open.
  useEffect(() => {
    if (mode !== 'edit') return;
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'a' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable=true], [role=combobox]') || window.document.querySelector('.w2-dialog, .w2-popover, .w2-sheet, [data-add-open]')) return;
      event.preventDefault(); openDefault();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [mode, openDefault]);

  const api = useMemo<AddApi>(() => ({ open, openDefault, addType, addSaved, accepts }), [open, openDefault, addType, addSaved, accepts]);
  const slots = useAddSlots(mode === 'edit' ? stage : null);
  const content = state && document ? <AddPicker document={document} destination={state.destination} onChoose={choose} onClose={close} initialType={state.type}
    templates={narrow ? query => <SavedComponents ws={ws} query={query} disabled={false} onAdd={chooseTemplate}/> : undefined}/> : null;
  return <AddContext.Provider value={api}>
    {children}
    {document && slots.map(({ element, owner }) => {
      const destination = endOf(document, owner);
      return destination && accepts(destination) ? createPortal(<button type="button" className="w2-add-slot" aria-label="Add" onClick={event => open(destination, event.currentTarget)}><Plus size={16} aria-hidden/>Add</button>, element, owner) : null;
    })}
    {state && !narrow && <Popover.Root open onOpenChange={next => { if (!next) close(); }}>
      <Popover.Portal><Popover.Positioner anchor={state.anchor ?? centre(stage)} sideOffset={8} align="center" className="w2-positioner"><Popover.Popup className="w2-scope w2-popover w2-add-pop" aria-label="Add" data-add-open>
        <Popover.Title className="w2-sr">Add</Popover.Title>{content}
      </Popover.Popup></Popover.Positioner></Popover.Portal>
    </Popover.Root>}
    {state && narrow && <Drawer.Root open onOpenChange={next => { if (!next) close(); }}>
      <Drawer.Portal><Drawer.Backdrop className="w2-backdrop"/><Drawer.Viewport className="w2-sheet-viewport"><Drawer.Popup className="w2-scope w2-sheet w2-add-sheet" aria-label="Add" data-add-open>
        <div className="w2-grabber" aria-hidden/><Drawer.Title className="w2-sr">Add</Drawer.Title><Drawer.Content className="w2-sheet-content">{content}</Drawer.Content>
      </Drawer.Popup></Drawer.Viewport></Drawer.Portal>
    </Drawer.Root>}
  </AddContext.Provider>;
}
