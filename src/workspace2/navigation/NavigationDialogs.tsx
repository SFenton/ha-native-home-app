import { LinkLossQuestion } from '../LinkLossQuestion';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Field, IconField } from '../../ui';
import { Modal } from '../kit';
import type { SurfaceRef } from '../outline';
import { listedSurface } from '../selection';
import type { Workspace2 } from '../useWorkspace2';
import { FIRST_LEVEL_WORDS, firstLevelTitle, moveToSheets, addLevel, addPage, addSheet, addTab, deleteLevel, deleteSurface, levelOpenerCount, openerCount, renameLevel, renameSurface, tabRoom } from './edit';
import { listenForNavigation, type CreatePageOptions, type CreateSheetOptions, type NavigationRequest } from './controller';
import './navigation.css';

type Resolve = (id: string | undefined) => void;
const refValue = (ref: SurfaceRef) => `${ref.kind}:${ref.id}`;
const parseRef = (value: string): SurfaceRef | undefined => {
  const [kind, ...id] = value.split(':');
  return kind === 'page' || kind === 'modal' ? { kind, id: id.join(':') } : undefined;
};

/** The footer every creation dialog has: Cancel and a Create that submits the dialog's form. */
function Footer({ form, onCancel, disabled, action = 'Create' }: { form: string; onCancel: () => void; disabled?: boolean; action?: string }) {
  return <><button type="button" onClick={onCancel}>Cancel</button><button type="submit" form={form} className="w2-primary" disabled={disabled}>{action}</button></>;
}

/** "New Page": Name, then where it is linked from. One undo step; switches to the page unless the caller asked not to. */
function NewPage({ ws, options, onDone }: { ws: Workspace2; options: CreatePageOptions; onDone: Resolve }) {
  const form = useId();
  const document = ws.document!;
  const current = listedSurface(ws.surface, document);
  const initial = options.from === 'none' ? 'none' : options.from && options.from !== 'current' ? refValue(options.from) : current ? refValue(current) : 'none';
  const [name, setName] = useState(''), [from, setFrom] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const link = options.hideLink ? undefined : from === 'none' ? undefined : parseRef(from);
    const made = addPage(document, name, link);
    ws.studio.apply(options.connect ? options.connect(made.document, made.id) : made.document);
    if (options.switchTo !== false) { ws.setSurface({ kind: 'page', id: made.id }); ws.select(undefined); }
    onDone(made.id);
  };
  return <Modal open onOpenChange={open => { if (!open) onDone(undefined); }} size="s" title="New Page" footer={<Footer form={form} onCancel={() => onDone(undefined)} disabled={!name.trim()}/>}>
    <form id={form} className="w2-new" onSubmit={submit}>
      <Field label="Name"><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></Field>
      {!options.hideLink && <Field label="Link from"><select value={from} onChange={event => setFrom(event.target.value)}>
        {current && <option value={refValue(current)}>{(current.kind === 'page' ? document.pages : document.modals).find(item => item.id === current.id)?.title}</option>}
        <optgroup label="Pages">{document.pages.filter(page => page.id !== current?.id || current.kind !== 'page').map(page => <option key={page.id} value={`page:${page.id}`}>{page.title}</option>)}</optgroup>
        {document.modals.length > 0 && <optgroup label="Sheets">{document.modals.filter(modal => modal.id !== current?.id || current.kind !== 'modal').map(modal => <option key={modal.id} value={`modal:${modal.id}`}>{modal.title}</option>)}</optgroup>}
        <option value="none">Nothing yet</option>
      </select></Field>}
    </form>
  </Modal>;
}

/** "New Tab": Label, Icon, then "New page" or an existing page. Disabled at the cap, with the reason. */
function NewTab({ ws, onDone }: { ws: Workspace2; onDone: Resolve }) {
  const form = useId();
  const document = ws.document!;
  const room = tabRoom(document);
  const [label, setLabel] = useState(''), [icon, setIcon] = useState('house'), [page, setPage] = useState('new');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!room.room || !label.trim()) return;
    const made = addTab(document, { label, icon, pageId: page === 'new' ? undefined : page });
    ws.studio.apply(made.document);
    ws.setSurface({ kind: 'page', id: made.pageId }); ws.select(undefined);
    onDone(made.id);
  };
  return <Modal open onOpenChange={open => { if (!open) onDone(undefined); }} size="s" title="New Tab" footer={<Footer form={form} onCancel={() => onDone(undefined)} disabled={!room.room || !label.trim()}/>}>
    <form id={form} className="w2-new" onSubmit={submit}>
      <Field label="Label"><input autoFocus value={label} maxLength={80} disabled={!room.room} onChange={event => setLabel(event.target.value)}/></Field>
      <IconField label="Icon" value={icon} onChange={setIcon}/>
      <Field label="Page"><select value={page} disabled={!room.room} onChange={event => setPage(event.target.value)}>
        <option value="new">New page</option>
        {document.pages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></Field>
      {!room.room && <p role="status" className="w2-caption w2-new-reason">{room.reason}</p>}
    </form>
  </Modal>;
}

/** "New Sheet" or "New Modal": Name and Height (a Modal is always full). Opens it presented in the preview. */
function NewSheet({ ws, options, onDone }: { ws: Workspace2; options: CreateSheetOptions; onDone: Resolve }) {
  const form = useId();
  const modal = Boolean(options.fullScreen), word = modal ? 'Modal' : 'Sheet';
  const [name, setName] = useState(''), [height, setHeight] = useState<'fitted' | 'full'>('fitted');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const made = addSheet(ws.document!, name, height, modal);
    ws.studio.apply(options.connect ? options.connect(made.document, made.id) : made.document);
    if (options.open !== false) { ws.setSurface({ kind: 'modal', id: made.id }); ws.select(undefined); }
    onDone(made.id);
  };
  return <Modal open onOpenChange={open => { if (!open) onDone(undefined); }} size="s" title={`New ${word}`} footer={<Footer form={form} onCancel={() => onDone(undefined)} disabled={!name.trim()}/>}>
    <form id={form} className="w2-new" onSubmit={submit}>
      <Field label="Name"><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></Field>
      {!modal && <div className="w2-segment" role="group" aria-label="Height"><span className="w2-row-label">Height</span>
        {(['fitted', 'full'] as const).map(item => <button key={item} type="button" aria-pressed={height === item} onClick={() => setHeight(item)}>{item === 'full' ? 'Full' : 'Fitted'}</button>)}
      </div>}
    </form>
  </Modal>;
}

/** Rename a page or sheet. */
function Rename({ ws, surface, onDone }: { ws: Workspace2; surface: SurfaceRef; onDone: () => void }) {
  const form = useId();
  const document = ws.document!;
  const current = (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id);
  const [name, setName] = useState(current?.title ?? '');
  return <Modal open onOpenChange={open => { if (!open) onDone(); }} size="s" title="Rename" footer={<Footer form={form} onCancel={onDone} disabled={!name.trim()} action="Rename"/>}>
    <form id={form} className="w2-new" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; ws.studio.apply(renameSurface(document, surface, name)); onDone(); }}>
      <Field label="Name"><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></Field>
    </form>
  </Modal>;
}

/** Delete a page or sheet after saying what else goes. */
function Delete({ ws, surface, onDone }: { ws: Workspace2; surface: SurfaceRef; onDone: () => void }) {
  const document = ws.document!;
  const current = (surface.kind === 'page' ? document.pages : document.modals).find(item => item.id === surface.id);
  const count = openerCount(document, surface);
  return <Modal open onOpenChange={open => { if (!open) onDone(); }} size="s" title={`Delete “${current?.title ?? ''}”?`}
    description={count > 0 ? `${count} ${count === 1 ? 'tile opens' : 'tiles open'} this ${surface.kind === 'page' ? 'page' : 'sheet'}. ${count === 1 ? 'Its' : 'Their'} action is removed.` : undefined}
    footer={<><button type="button" onClick={onDone}>Cancel</button><button type="button" className="w2-danger" onClick={() => {
      try { ws.studio.apply(deleteSurface(document, surface).document); ws.select(undefined); }
      catch (error) { ws.studio.setError(error instanceof Error ? error.message : String(error)); }
      onDone();
    }}>Delete</button></>}/>;
}

/** "New Level": Name. The level is the sheet's: a tile at the end of the sheet opens it, inside the sheet. One undo step. */
function NewLevel({ ws, sheetId, onDone }: { ws: Workspace2; sheetId: string; onDone: Resolve }) {
  const form = useId();
  const sheet = ws.document!.modals.find(item => item.id === sheetId);
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !sheet) return;
    const made = addLevel(ws.document!, sheetId, name);
    ws.studio.apply(made.document);
    onDone(made.id);
  };
  return <Modal open onOpenChange={open => { if (!open) onDone(undefined); }} size="s" title="New Level" footer={<Footer form={form} onCancel={() => onDone(undefined)} disabled={!name.trim() || !sheet}/>}>
    <form id={form} className="w2-new" onSubmit={submit}>
      <Field label="Name"><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></Field>
      {sheet && <p className="w2-caption">A level of {sheet.title}. It opens inside the sheet, with Back and Close. A tile that opens it is added to the end of {sheet.title}.</p>}
      {sheet && ws.document!.levels === undefined && <p className="w2-caption">{FIRST_LEVEL_WORDS}</p>}
    </form>
  </Modal>;
}

/** The question before the document's first level (Move to Sheets): what it changes, Cancel, and the move by name. A yes applies the move as one undo step; Cancel changes nothing. */
function FirstLevel({ ws, pageId, onMoved, onDone }: { ws: Workspace2; pageId: string; onMoved: () => void; onDone: () => void }) {
  const page = ws.document!.pages.find(item => item.id === pageId);
  return <LinkLossQuestion asking={page && { title: firstLevelTitle(page.title), text: FIRST_LEVEL_WORDS, confirm: 'Move to Sheets', tone: 'plain' }} onCancel={onDone}
    onConfirm={() => { const moved = moveToSheets(ws.document!, pageId, true); if (moved.ok) { ws.studio.apply(moved.document); onMoved(); } onDone(); }}/>;
}

/** Rename a level. */
function RenameLevel({ ws, levelId, onDone }: { ws: Workspace2; levelId: string; onDone: () => void }) {
  const form = useId();
  const document = ws.document!;
  const [name, setName] = useState(document.levels?.find(item => item.id === levelId)?.title ?? '');
  return <Modal open onOpenChange={open => { if (!open) onDone(); }} size="s" title="Rename" footer={<Footer form={form} onCancel={onDone} disabled={!name.trim()} action="Rename"/>}>
    <form id={form} className="w2-new" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; ws.studio.apply(renameLevel(document, levelId, name)); onDone(); }}>
      <Field label="Name"><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></Field>
    </form>
  </Modal>;
}

/** Delete a level after saying what else goes. */
function DeleteLevel({ ws, levelId, onDone }: { ws: Workspace2; levelId: string; onDone: () => void }) {
  const document = ws.document!;
  const count = levelOpenerCount(document, levelId);
  return <Modal open onOpenChange={open => { if (!open) onDone(); }} size="s" title={`Delete “${document.levels?.find(item => item.id === levelId)?.title ?? ''}”?`}
    description={count > 0 ? `${count} ${count === 1 ? 'tile opens' : 'tiles open'} this level. ${count === 1 ? 'Its' : 'Their'} action is removed.` : undefined}
    footer={<><button type="button" onClick={onDone}>Cancel</button><button type="button" className="w2-danger" onClick={() => {
      try { ws.studio.apply(deleteLevel(document, levelId).document); ws.select(undefined); }
      catch (error) { ws.studio.setError(error instanceof Error ? error.message : String(error)); }
      onDone();
    }}>Delete</button></>}/>;
}

/**
 * Mounts the creation, rename and delete dialogs and answers the entry points in `controller.ts`. One per workspace. It
 * shows one dialog at a time; a second request while one is open cancels the first.
 */
export function NavigationHost({ ws }: { ws: Workspace2 }) {
  const [request, setRequest] = useState<NavigationRequest>();
  useEffect(() => listenForNavigation(next => setRequest(old => { if (old && 'resolve' in old) old.resolve(undefined); return next; })), []);
  if (!request || !ws.document) return null;
  const finish = (id?: string) => { if ('resolve' in request) request.resolve(id); setRequest(undefined); };
  switch (request.kind) {
    case 'page': return <NewPage ws={ws} options={request.options} onDone={finish}/>;
    case 'sheet': return <NewSheet ws={ws} options={request.options} onDone={finish}/>;
    case 'tab': return <NewTab ws={ws} onDone={finish}/>;
    case 'rename': return <Rename ws={ws} surface={request.surface} onDone={() => setRequest(undefined)}/>;
    case 'delete': return <Delete ws={ws} surface={request.surface} onDone={() => setRequest(undefined)}/>;
    case 'level': return <NewLevel ws={ws} sheetId={request.sheetId} onDone={finish}/>;
    case 'first-level': return <FirstLevel ws={ws} pageId={request.pageId} onMoved={request.onMoved} onDone={() => setRequest(undefined)}/>;
    case 'rename-level': return <RenameLevel ws={ws} levelId={request.levelId} onDone={() => setRequest(undefined)}/>;
    case 'delete-level': return <DeleteLevel ws={ws} levelId={request.levelId} onDone={() => setRequest(undefined)}/>;
  }
}
