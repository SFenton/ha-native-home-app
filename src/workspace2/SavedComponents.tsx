import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTemplateActions } from './templateActions';
import { templateWords as words } from './templateWords';
import { componentReferences, type ComponentUse } from '../shared/composition/components';
import type { ComponentEntry, CompositionDocument } from '../shared/composition/schema';
import { useAdd } from './add/AddHost';
import { useDrag } from './dnd/DragLayer';
import { nameTaken, nameValid, renameComponent, usesText } from './linked';
import RowGlyph from './RowGlyph';
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


/**
 * The Templates group of the Components palette (studio-tpl-ux): a 32 px tree row for each template with its icon, name and the number of places,
 * a + (Add to Page) and a More menu (Add to Page, Rename, Show Uses, Delete). A click or Enter opens the template's editor, a drag adds a place at the
 * drop cue. In Use + and the menu's Add, Rename and Delete are disabled.
 *
 * Two callers change what a row does: `onAdd` is the phone Add sheet (a tap adds at the sheet's destination, More gains Edit Template) and `onOpen` is
 * Project > Templates (a tap and Show Uses go to the caller; the row has More only, since the sheet covers the page).
 */
export default function SavedComponents({ ws, query, disabled, describedBy, onAdd, onEdit, onOpen }: { ws: Workspace2; query: string; disabled: boolean; describedBy?: string; /** Adds a place somewhere the caller chose (the phone Add sheet's destination); without it a click opens the editor and a drag adds at the drop cue. */ onAdd?: (entryId: string) => void; /** The phone Add sheet's More > Edit Template: the caller closes its sheet, then opens the editor. */ onEdit?: (entryId: string) => void; /** Project > Templates on a phone: a tap opens the editor, and the row has More only. */ onOpen?: (entryId: string) => void }) {
  const document = ws.document!;
  const add = useAdd(), drag = useDrag();
  const rows = useMemo(() => savedRows(document), [document]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => !needle || row.entry.name.toLowerCase().includes(needle));
  const [renaming, setRenaming] = useState<string>();
  const dragged = useRef(false);
  const run = (action: () => void) => { try { action(); } catch (error) { ws.linked.say(error instanceof Error ? error.message : String(error)); } };
  const down = (entry: ComponentEntry) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    if (!drag || onAdd || onOpen || disabled || event.button !== 0 || event.pointerType === 'touch') return;
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
  const actions = useTemplateActions(ws);
  const list = useRef<HTMLUListElement>(null);
  const [stop, setStop] = useState<string>();
  const keys = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const buttons = [...list.current?.querySelectorAll<HTMLButtonElement>('button.w2-tpl-row') ?? []];
    const at = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (at < 0 || next === undefined) return;
    event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
  };
  // Every hook is above these returns: the group goes from empty to listed as templates come and go.
  if (!rows.length) return <p className="w2-empty" data-testid="saved-empty">No templates yet. Choose Save as Template from a component’s More menu.</p>;
  if (!shown.length) return onAdd ? <p className="w2-empty">Nothing matches.</p> : null;
  const tabbable = shown.find(row => row.entry.id === stop)?.entry.id ?? shown[0].entry.id;
  return <>
    <ul ref={list} className="w2-saved-list" aria-label="Templates" onKeyDown={keys}>
      {shown.map(({ entry, uses: places }) => {
        const open = !onAdd && !onOpen && ws.templateId === entry.id;
        return <li key={entry.id} className="w2-saved-row" data-testid="saved-row" data-component={entry.id} data-open={open || undefined}>
        {renaming === entry.id
          ? <Rename document={document} entry={entry} onDone={() => setRenaming(undefined)} onRename={name => run(() => { ws.studio.apply(renameComponent(document, entry.id, name)); })}/>
          : <button type="button" className="w2-tpl-row" tabIndex={entry.id === tabbable ? 0 : -1} onFocus={() => setStop(entry.id)} aria-current={open || undefined} aria-disabled={(onAdd && disabled) || undefined} aria-describedby={disabled ? describedBy : undefined} title={entry.name}
            aria-label={`${entry.name}, template, ${usesText(places.length).toLowerCase()}`}
            onPointerDown={down(entry)}
            onClick={() => { if (dragged.current) { dragged.current = false; return; } if (onAdd) { if (!disabled) onAdd(entry.id); } else if (onOpen) onOpen(entry.id); else ws.openTemplate(open ? undefined : entry.id); }}>
            <span className="w2-tree-icon"><RowGlyph type={entry.node.type} icon={(entry.node as { icon?: { name: string } }).icon?.name}/></span>
            <span className="w2-tree-title">{entry.name}</span><span className="w2-tree-count" title={usesText(places.length)}>{places.length}</span>
          </button>}
        {renaming !== entry.id && !onAdd && !onOpen && <button type="button" className="w2-icon-button w2-saved-add" aria-label={words.addLabel(entry.name)} title={words.add} disabled={disabled} onClick={event => add?.addSaved(entry.id, event.currentTarget)}><Plus size={16} aria-hidden/></button>}
        {renaming !== entry.id && <Menu.Root>
          <Menu.Trigger className="w2-icon-button w2-saved-more" aria-label={`More for ${entry.name}`}><MoreHorizontal size={16} aria-hidden/></Menu.Trigger>
          <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
            {!onAdd && !onOpen && <Menu.Item className="w2-menu-item" disabled={disabled} onClick={event => add?.addSaved(entry.id, event.currentTarget as HTMLElement)}>{words.add}</Menu.Item>}
            {onAdd && <Menu.Item className="w2-menu-item" onClick={() => (onEdit ?? ws.openTemplate)(entry.id)}>{words.edit}</Menu.Item>}
            {!onOpen && <Menu.Separator className="w2-menu-sep"/>}
            <Menu.Item className="w2-menu-item" disabled={disabled} onClick={() => setRenaming(entry.id)}>{words.rename}</Menu.Item>
            <Menu.Item className="w2-menu-item" disabled={places.length === 0} onClick={() => { if (onOpen) onOpen(entry.id); else if (onAdd) (onEdit ?? ws.openTemplate)(entry.id); else ws.setUsesId(entry.id); }}>{words.showUses}</Menu.Item>
            <Menu.Separator className="w2-menu-sep"/>
            <Menu.Item className="w2-menu-item w2-danger-item" disabled={disabled} onClick={() => actions.remove(entry.id)}>{words.deletePlain}</Menu.Item>
          </Menu.Popup></Menu.Positioner></Menu.Portal>
        </Menu.Root>}
      </li>; })}
    </ul>
    {actions.dialog}
  </>;
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
