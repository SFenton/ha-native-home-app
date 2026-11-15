import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiUrl, request } from '../api';
import { compositionSourceText, importCompositionText, valueAt, type EditorPath } from '../composition-editor';
import { CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES } from '../shared/composition/json';
import { formatCompositionIssue } from '../shared/composition/workspace';
import type { Json } from '../shared/types';
import CompositionFields from '../CompositionFields';
import RoutesEditor from '../RoutesEditor';
import { Field, TextField } from '../ui';
import { fieldOptions, RowsProvider, schemaAt, useRows } from './rows';
import { Modal, Tag } from './kit';
import { copyText } from './util';
import { toastManager } from './toasts';
import type { Workspace2 } from './useWorkspace2';

/** Every dialog the Project menu opens (spec 5.7). Tabs, Header Buttons and Wallpaper open the properties surface instead. */
export type DialogKey = 'rename' | 'data' | 'local-state' | 'links' | 'launch' | 'live' | 'history' | 'import' | 'json' | 'activity' | 'about' | 'help';
export const dialogTitles: Record<DialogKey, string> = {
  rename: 'Rename', data: 'Data', 'local-state': 'Local State', links: 'Links', launch: 'App Launch', live: 'Live Activities', history: 'Publish History',
  import: 'Import', json: 'Edit as JSON', activity: 'Activity', about: 'About', help: 'Help',
};

/** The generated form for one part of the document, under the authored labels. */
function PartForm({ path, label, owner = 'project' }: { path: EditorPath; label: string; owner?: string }) {
  const { document, onChange, onError } = useRows();
  return <CompositionFields schema={schemaAt(document, path)} value={valueAt(document, path) as Json} path={path} label={label} document={document} onChange={onChange} onError={onError} options={fieldOptions(owner, [])}/>;
}

function Rename() {
  const { document, onChange } = useRows();
  return <TextField label="Name" value={document.name} maxLength={160} onChange={name => onChange({ ...document, name })}/>;
}

function Data() { return <PartForm path={['dataSources']} label="Data"/>; }

function LocalState() {
  const { document, onChange } = useRows();
  if (!document.localState) return <div className="w2-empty-block"><p>No local state.</p><button type="button" onClick={() => onChange({ ...document, localState: [] })}>Add State</button></div>;
  return <>
    <p className="w2-caption">Kept on this device while a page is open. Not saved to Home Assistant.</p>
    <PartForm path={['localState']} label="Local State"/>
    {document.localState.length === 0 && <p className="w2-empty">No local state.</p>}
  </>;
}

function Links() {
  const { document, onChange } = useRows();
  return <>
    <RoutesEditor document={document} onChange={onChange}/>
    {document.extensions && <PartForm path={['extensions', 'routes']} label="Links"/>}
    {document.extensions?.linkPrefixes && <PartForm path={['extensions', 'linkPrefixes']} label="Link prefixes"/>}
    {document.extensions?.routes.length === 0 && <p className="w2-empty">No links. Add one from a page’s settings.</p>}
  </>;
}

function Launch() {
  const { document, onChange } = useRows();
  const on = Boolean(document.bootstrap);
  const toggle = (checked: boolean) => {
    const next = structuredClone(document);
    if (checked) next.bootstrap = {
      type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
      recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable', unavailableMessage: 'Try again when your publisher is available.', retryLabel: 'Try Again' },
      setup: [
        { permission: 'notifications', explanation: 'Choose whether this device can receive home alerts.' },
        { permission: 'time-sensitive', explanation: 'Review how urgent home alerts reach this device.' },
        { permission: 'location', explanation: 'Choose whether to share this device location with Home Assistant.' },
      ],
    };
    else delete next.bootstrap;
    onChange(next);
  };
  const names = { notifications: 'Notifications', 'time-sensitive': 'Time Sensitive', location: 'Location' } as const;
  return <>
    <label className="w2-switch-row" data-field-path="bootstrap"><span className="w2-row-label">Custom launch text</span><input type="checkbox" role="switch" checked={on} onChange={event => toggle(event.target.checked)}/></label>
    {document.bootstrap && <>
      <PartForm path={['bootstrap', 'arrivalAnnouncement']} label="Ready announcement"/>
      {(['loadingTitle', 'unavailableTitle', 'unavailableMessage', 'retryLabel'] as const).map(name => <PartForm key={name} path={['bootstrap', 'recovery', name]} label={name === 'retryLabel' ? 'Retry button' : name === 'loadingTitle' ? 'Loading title' : name === 'unavailableTitle' ? 'Unavailable title' : 'Unavailable message'}/>)}
      <h3 className="w2-group-title">Why we ask</h3>
      {document.bootstrap.setup.map((item, at) => <div key={item.permission}>
        <span hidden data-field-path={`bootstrap/setup/${at}/permission`}/>
        <PartForm path={['bootstrap', 'setup', at, 'explanation']} label={names[item.permission]}/>
      </div>)}
    </>}
  </>;
}

function Live() {
  const { document } = useRows();
  return <>
    <PartForm path={['liveActivities']} label="Live Activities"/>
    <p className="w2-caption">Matches the job’s tag without “job.”.</p>
    {document.liveActivities.length === 0 && <p className="w2-empty">No Live Activities.</p>}
    {document.extensions && <PartForm path={['extensions', 'cameras']} label="Camera notifications"/>}
  </>;
}

function History({ ws }: { ws: Workspace2 }) {
  const { liveRevision, publication, refreshPublication, log } = ws;
  const [target, setTarget] = useState<number>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void refreshPublication(); }, [refreshPublication]);
  const entries = publication?.current ? [publication.current, ...publication.history] : [];
  const when = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); };
  const rollBack = async () => {
    if (target === undefined) return;
    setBusy(true); setError('');
    try {
      await request('/native/api/ha/rollback', { method: 'POST', body: JSON.stringify({ revision: target }) });
      toastManager.add({ title: 'Rolled back' }); log(`Rolled back to revision ${target}`); setTarget(undefined); await refreshPublication();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <>
    {entries.length === 0 ? <p className="w2-empty">Nothing published yet.</p> : <ul className="w2-history">{entries.map(entry => <li key={entry.revision}>
      <div className="w2-history-text"><strong>Revision {entry.revision}</strong><time dateTime={entry.publishedAt}>{when(entry.publishedAt)}</time></div>
      {entry.revision === liveRevision ? <Tag tone="success">Live</Tag> : <button type="button" onClick={() => setTarget(entry.revision)}>Roll Back</button>}
    </li>)}</ul>}
    {error && <p role="alert" className="w2-error-text">{error}</p>}
    <Modal open={target !== undefined} onOpenChange={open => { if (!open && !busy) setTarget(undefined); }} size="s" title={`Roll Back to Revision ${target ?? ''}?`}
      description="It becomes the live layout as a new revision. Your draft does not change."
      footer={<><button type="button" disabled={busy} onClick={() => setTarget(undefined)}>Cancel</button><button type="button" className="w2-primary" disabled={busy} onClick={() => void rollBack()}>Roll Back</button></>}/>
  </>;
}

function Import({ ws, close }: { ws: Workspace2; close: () => void }) {
  const { document, onChange } = useRows();
  const [text, setText] = useState(''), [error, setError] = useState(''), [replace, setReplace] = useState<ReturnType<typeof importCompositionText>>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const parse = () => {
    try { setReplace(importCompositionText(text, document.id)); setError(''); }
    catch (reason) { setError(reason instanceof CompositionValidationError ? reason.issues.map(formatCompositionIssue).join('\n') : reason instanceof Error ? reason.message : String(reason)); }
  };
  const fromHome = async () => {
    setBusy(true); setError('');
    try {
      if (ws.studio.dirty && !(await ws.persist())) throw new Error(ws.studio.error || 'Save the draft first.');
      if (await ws.studio.importHouse()) { toastManager.add({ title: 'Imported' }); ws.log('Imported from Home Assistant'); close(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <Field label="Paste JSON"><textarea className="w2-code" value={text} onChange={event => setText(event.target.value)}/></Field>
    <input ref={file} hidden type="file" accept=".json,application/json" onChange={async event => {
      const picked = event.target.files?.[0]; event.target.value = '';
      if (!picked) return;
      if (picked.size > MAX_COMPOSITION_ENVELOPE_BYTES) { setError('That file is too large to import.'); return; }
      setText(await picked.text());
    }}/>
    {error && <pre role="alert" className="w2-error-text w2-pre">{error}</pre>}
    <div className="w2-actions">
      <button type="button" onClick={() => file.current?.click()}>Choose File…</button>
      <button type="button" disabled={busy} onClick={() => void fromHome()}>From Home Assistant</button>
      <button type="button" className="w2-primary" disabled={!text.trim()} onClick={parse}>Import</button>
    </div>
    <p className="w2-caption">Adds the rooms and chores pages this draft does not have yet.</p>
    <Modal open={Boolean(replace)} onOpenChange={open => { if (!open) setReplace(undefined); }} size="s" title="Replace the Draft?" description="Undo brings it back."
      footer={<><button type="button" onClick={() => setReplace(undefined)}>Cancel</button><button type="button" className="w2-primary" onClick={() => { if (replace) { onChange(replace); toastManager.add({ title: 'Imported' }); ws.log('Imported a document'); } setReplace(undefined); close(); }}>Replace</button></>}/>
  </>;
}

function JsonEditor({ close }: { close: () => void }) {
  const { document, onChange } = useRows();
  const [text, setText] = useState(() => compositionSourceText(document, true)), [error, setError] = useState('');
  return <>
    <textarea className="w2-code w2-code-tall" aria-label="Document" value={text} onChange={event => setText(event.target.value)}/>
    {error && <pre role="alert" className="w2-error-text w2-pre">{error}</pre>}
    <div className="w2-actions">
      <button type="button" onClick={close}>Cancel</button>
      <button type="button" className="w2-primary" onClick={() => {
        try { onChange(importCompositionText(text, document.id)); close(); }
        catch (reason) { setError(reason instanceof CompositionValidationError ? reason.issues.map(formatCompositionIssue).join('\n') : reason instanceof Error ? reason.message : String(reason)); }
      }}>Apply</button>
    </div>
  </>;
}

function Activity({ ws }: { ws: Workspace2 }) {
  return ws.activity.length === 0 ? <p className="w2-empty">Nothing yet.</p> : <ul className="w2-activity">{ws.activity.map(entry => <li key={entry.id}>{entry.text}</li>)}</ul>;
}

function About({ ws }: { ws: Workspace2 }) {
  const envelope = ws.studio.envelope;
  const [frozen, setFrozen] = useState('');
  const address = new URL(apiUrl('/native/api/published'), window.location.href).href;
  const row = (label: string, value: string) => <div className="w2-row w2-about-row"><span className="w2-row-label">{label}</span><code>{value}</code>
    <button type="button" aria-label={`Copy ${label}`} onClick={async () => { if (await copyText(value)) toastManager.add({ title: 'Copied' }); }}>Copy</button></div>;
  return <>
    {row('Publisher ID', envelope?.publisherId ?? '')}{row('Document ID', ws.document?.id ?? '')}{row('Preview address', address)}
    {row('Capabilities', (envelope?.capabilities ?? []).join(', '))}{row('Manifest', envelope?.assetManifestSha256 ?? '')}
    <div className="w2-actions"><button type="button" disabled={ws.problemCount > 0 || ws.studio.busy} onClick={async () => { if (await ws.persist(true)) { setFrozen('Frozen as a local revision.'); ws.log('Froze a local revision'); } }}>Freeze a Local Revision</button></div>
    {frozen && <p role="status" className="w2-caption">{frozen}</p>}
  </>;
}

function Help() {
  return <p>The preview is a drawing of the app. Service calls are simulated.</p>;
}

/** The body of one Project dialog. `close` closes the dialog (on narrow: pops the pushed page). */
export function DialogBody({ dialog, ws, close, onError }: { dialog: DialogKey; ws: Workspace2; close: () => void; onError: (message: string) => void }): ReactNode {
  const document = ws.document;
  if (!document) return null;
  const ctx = { document, onChange: ws.studio.apply, onError };
  const body = {
    rename: <Rename/>, data: <Data/>, 'local-state': <LocalState/>, links: <Links/>, launch: <Launch/>, live: <Live/>, history: <History ws={ws}/>,
    import: <Import ws={ws} close={close}/>, json: <JsonEditor close={close}/>, activity: <Activity ws={ws}/>, about: <About ws={ws}/>, help: <Help/>,
  }[dialog];
  return <RowsProvider value={ctx}><div className="w2-form" data-dialog={dialog}>{body}</div></RowsProvider>;
}
