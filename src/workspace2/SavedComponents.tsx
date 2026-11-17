import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { MoreHorizontal } from 'lucide-react';
import { componentReferences, type ComponentUse } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument } from '../shared/composition/schema';
import { useAdd } from './add/AddHost';
import { useDrag } from './dnd/DragLayer';
import { deleteComponent, nameTaken, nameValid, renameComponent, usesText } from './linked';
import RowGlyph from './RowGlyph';
import { typeName } from './util';
import { useHeld } from './useHeld';
import type { Workspace2 } from './useWorkspace2';

/** A drag starts after this many pixels, as everywhere else in the Studio. */
const SLOP = 4;
/** The prefix a saved row's drag carries, so the drop can tell a component from a catalog type. */
export const SAVED_CARRY = 'component:';

/** The templates with the number of places that use each, in the library's order. */
export function savedRows(document: CompositionDocument | undefined): { entry: ComponentEntry; uses: ComponentUse[] }[] {
  const entries = document?.componentLibrary ?? [];
  if (!document || !entries.length) return [];
  const all = componentReferences(document);
  return entries.map(entry => ({ entry, uses: all.filter(use => use.ref.componentId === entry.id) }));
}

/** The place a use is, in words: the page, sheet or tab it sits in. */
const placeWords = (use: ComponentUse) => use.tab ? `${use.surface.title} › ${use.tab.label}` : use.surface.title;
const placeKind = (use: ComponentUse) => use.tab ? 'Tab' : use.surface.kind === 'page' ? 'Page' : 'Sheet';

/**
 * The Templates group of the Components palette (studio-linked spec, "The library"): one 48 px row for each template, with its glyph, its name and
 * how many places use it, and a More menu (Rename, Show Uses, Delete). A click or Enter adds a place of the template after the selection, a drag adds it at
 * the drop cue. In Use the rows are disabled under the palette's notice.
 */
export default function SavedComponents({ ws, query, disabled, describedBy, onAdd }: { ws: Workspace2; query: string; disabled: boolean; describedBy?: string; /** Adds a place somewhere the caller chose (the phone Add sheet's destination); without it a click adds after the selection and a drag adds at the drop cue. */ onAdd?: (entryId: string) => void }) {
  const document = ws.document!;
  const add = useAdd(), drag = useDrag();
  const rows = useMemo(() => savedRows(document), [document]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => !needle || row.entry.name.toLowerCase().includes(needle));
  const [renaming, setRenaming] = useState<string>();
  const [uses, setUses] = useState<{ id: string; anchor: HTMLElement }>();
  const [deleting, setDeleting] = useState<string>();
  const dragged = useRef(false);
  const run = (action: () => void) => { try { action(); } catch (error) { ws.linked.say(error instanceof Error ? error.message : String(error)); } };
  const down = (entry: ComponentEntry) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    if (!drag || onAdd || disabled || event.button !== 0 || event.pointerType === 'touch') return;
    const cell = event.currentTarget, start = { x: event.clientX, y: event.clientY };
    let started = false;
    const moved = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP) return;
        started = true; dragged.current = true;
        drag.begin({ key: 'node:__new__', carry: `${SAVED_CARRY}${entry.id}`, mode: 'mouse', point: start, locate: drag.locateNew(entry.node.type), ghostOf: cell });
      }
      drag.move(e.clientX, e.clientY);
    };
    const stop = (commit: boolean) => () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); if (started) (commit ? drag.end() : drag.cancel()); };
    const up = stop(true), cancel = stop(false);
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  const usingFor = uses ? rows.find(row => row.entry.id === uses.id) : undefined;
  const deletingRow = deleting ? rows.find(row => row.entry.id === deleting) : undefined;
  const heldRow = useHeld(deletingRow);
  // Every hook is above these returns: the group goes from empty to listed as templates come and go.
  if (!rows.length) return <p className="w2-empty" data-testid="saved-empty">No templates yet. Choose Save as Template from a component’s More menu.</p>;
  if (!shown.length) return onAdd ? <p className="w2-empty">Nothing matches.</p> : null;
  return <>
    <ul className="w2-saved-list" aria-label="Templates">
      {shown.map(({ entry, uses: places }) => <li key={entry.id} className="w2-saved-row" data-testid="saved-row" data-component={entry.id}>
        {renaming === entry.id
          ? <Rename document={document} entry={entry} onDone={() => setRenaming(undefined)} onRename={name => run(() => { ws.studio.apply(renameComponent(document, entry.id, name)); })}/>
          : <button type="button" className="w2-saved-main" aria-disabled={disabled || undefined} aria-describedby={disabled ? describedBy : undefined} title={entry.name}
            aria-label={`${entry.name}. ${usesText(places.length)}`}
            onPointerDown={down(entry)}
            onClick={event => { if (disabled) return; if (dragged.current) { dragged.current = false; return; } if (onAdd) onAdd(entry.id); else add?.addSaved(entry.id, event.currentTarget); }}>
            <span className="w2-saved-glyph"><RowGlyph type={entry.node.type} icon={(entry.node as { icon?: { name: string } }).icon?.name} size={20}/></span>
            <span className="w2-saved-text"><span className="w2-saved-name">{entry.name}</span><span className="w2-saved-uses">{usesText(places.length)}</span></span>
          </button>}
        {renaming !== entry.id && <Menu.Root>
          <Menu.Trigger className="w2-icon-button w2-saved-more" aria-label={`More for ${entry.name}`} disabled={disabled}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
          <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
            <Menu.Item className="w2-menu-item" onClick={() => setRenaming(entry.id)}>Rename</Menu.Item>
            {places.length > 0 && <Menu.Item className="w2-menu-item" onClick={event => setUses({ id: entry.id, anchor: (event.currentTarget as HTMLElement) })}>Show Uses</Menu.Item>}
            <Menu.Separator className="w2-menu-sep"/>
            <Menu.Item className="w2-menu-item w2-danger-item" onClick={() => {
              if (places.length === 0) run(() => { ws.studio.apply(deleteComponent(document, entry.id)); ws.linked.say(`Deleted ${entry.name}.`); });
              else setDeleting(entry.id);
            }}>Delete</Menu.Item>
          </Menu.Popup></Menu.Positioner></Menu.Portal>
        </Menu.Root>}
      </li>)}
    </ul>
    {usingFor && uses && <Popover.Root open onOpenChange={next => { if (!next) setUses(undefined); }}>
      <Popover.Portal><Popover.Positioner anchor={uses.anchor.isConnected ? uses.anchor : undefined} sideOffset={8} align="start" className="w2-positioner">
        <Popover.Popup className="w2-scope w2-popover w2-saved-uses-pop" aria-label={`Used in ${usingFor.uses.length} ${usingFor.uses.length === 1 ? 'Place' : 'Places'}`} data-testid="saved-uses">
          <Popover.Title className="w2-uses-title">{`Used in ${usingFor.uses.length} ${usingFor.uses.length === 1 ? 'Place' : 'Places'}`}</Popover.Title>
          <ul className="w2-uses-list">{usingFor.uses.map(use => <li key={use.ref.id}>
            <button type="button" className="w2-link-row" onClick={() => { ws.selectAnywhere(`node:${use.ref.id}`); setUses(undefined); }}>
              <span className="w2-style-text"><span className="w2-page-title">{placeWords(use)}</span><span className="w2-page-via">{`${placeKind(use)} · ${typeName(usingFor.entry.node.type)}`}</span></span></button></li>)}</ul>
        </Popover.Popup>
      </Popover.Positioner></Popover.Portal>
    </Popover.Root>}
    <AlertDialog.Root open={Boolean(deletingRow)} onOpenChange={next => { if (!next) setDeleting(undefined); }}>
      <AlertDialog.Portal><AlertDialog.Backdrop className="w2-backdrop"/><AlertDialog.Viewport className="w2-dialog-viewport">
        {heldRow && <DeleteQuestion row={heldRow} onCancel={() => setDeleting(undefined)} onDelete={() => {
          run(() => { ws.studio.apply(deleteComponent(document, heldRow.entry.id)); ws.linked.say(`Deleted ${heldRow.entry.name}. Its places are unlinked.`); });
          setDeleting(undefined);
        }}/>}
      </AlertDialog.Viewport></AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

/** The delete question for a component that is in use: no default button and no red, the person chose Delete and nothing leaves a page. */
function DeleteQuestion({ row, onCancel, onDelete }: { row: { entry: ComponentEntry; uses: ComponentUse[] }; onCancel: () => void; onDelete: () => void }) {
  const popup = useRef<HTMLDivElement>(null);
  return <AlertDialog.Popup ref={popup} className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="delete-component" tabIndex={-1} initialFocus={popup}>
    <header className="w2-dialog-head"><AlertDialog.Title>{`Delete “${row.entry.name}”?`}</AlertDialog.Title></header>
    <AlertDialog.Description className="w2-dialog-text">{`It is used in ${row.uses.length} ${row.uses.length === 1 ? 'place' : 'places'}. Each one stays where it is, unlinked.`}</AlertDialog.Description>
    <div className="w2-linked-actions">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="w2-tonal" onClick={onDelete}>Delete Template</button>
    </div>
  </AlertDialog.Popup>;
}

/** A saved row's name as a field with Done, the way State Styles rename: one undo step per committed name, the same name rules as the dialog. */
function Rename({ document, entry, onRename, onDone }: { document: CompositionDocument; entry: ComponentEntry; onRename: (name: string) => void; onDone: () => void }) {
  const [name, setName] = useState(entry.name);
  const field = useRef<HTMLInputElement>(null), errorId = useId();
  useEffect(() => { field.current?.select(); }, []);
  const taken = nameValid(name) && nameTaken(document, name, entry.id);
  const ok = nameValid(name) && !taken;
  const done = () => { if (ok && name.trim() !== entry.name) onRename(name.trim()); if (ok) onDone(); };
  return <div className="w2-saved-rename">
    <input ref={field} value={name} maxLength={80} aria-label={`Name of ${entry.name}`} aria-invalid={taken || undefined} aria-describedby={taken ? errorId : undefined}
      onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); done(); } else if (event.key === 'Escape') { event.stopPropagation(); onDone(); } }}/>
    <button type="button" onClick={done} disabled={!ok}>Done</button>
    {taken && <p id={errorId} role="alert" className="w2-field-error">{`A template named ${name.trim()} already exists.`}</p>}
  </div>;
}
