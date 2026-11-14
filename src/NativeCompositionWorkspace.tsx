import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, request } from './api';
import { componentLocations, compositionEditorSchema, compositionErrors, compositionSourceText, importCompositionText, moveCompositionNode } from './composition-editor';
import CompositionFields from './CompositionFields';
import { useCompositionStudio } from './useCompositionStudio';
import type { Json } from './shared/types';
import type { CompositionDocument } from './shared/composition/schema';
import { formatCompositionIssue, type UploadedCompositionAsset } from './shared/composition/workspace';
import { CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES } from './shared/composition/json';
import { uid } from './editor';
import { Dialog, Field, SelectField, TextField } from './ui';
import './NativeCompositionWorkspace.css';

const sections = ['Overview', 'Tabs', 'Chrome', 'Pages', 'Modals', 'Local state', 'Data sources', 'Wallpaper', 'Bootstrap', 'Live Activities', 'Native policies'] as const;
type Section = typeof sections[number];
type Operation = 'import' | 'advanced' | 'reload' | 'keep-local' | undefined;
function exportLocal(document: CompositionDocument) {
  const url = URL.createObjectURL(new Blob([compositionSourceText(document)], { type: 'application/json' }));
  const anchor = globalThis.document.createElement('a');
  anchor.href = url; anchor.download = 'native-composition-local.json'; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function NativeCompositionWorkspace({ onLegacy, active }: { onLegacy: () => void; active: boolean }) {
  const studio = useCompositionStudio(), document = studio.document;
  const [section, setSection] = useState<Section>('Overview');
  const [operation, setOperation] = useState<Operation>(), [source, setSource] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [assets, setAssets] = useState<UploadedCompositionAsset[]>([]);
  const [uploading, setUploading] = useState(false), [assetError, setAssetError] = useState('');
  const working = studio.busy || uploading;
  const [moving, setMoving] = useState(''), [parent, setParent] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const errors = useMemo(() => document ? compositionErrors(document) : [], [document]);
  const locations = useMemo(() => document ? componentLocations(document) : [], [document]);
  const loadAssets = async () => {
    try {
      const loaded = await request<UploadedCompositionAsset[]>('/native/api/assets');
      setAssets(previous => [...new Map([...previous, ...loaded].map(asset => [asset.sha256, asset])).values()]);
      setAssetError('');
    }
    catch (reason) { setAssetError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { if (section === 'Wallpaper') void loadAssets(); }, [section]);
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!operation && !uploading) void studio.save();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active, operation, uploading, studio.save]);
  function open(next: Operation) {
    setDialogError(''); setSource(next === 'advanced' && document ? compositionSourceText(document, true) : ''); setOperation(next);
  }
  const selectAsset = (asset: UploadedCompositionAsset) => {
    if (!document) return;
    const id = document.assets.find(item => item.sha256 === asset.sha256)?.id ?? uid('backdrop');
    studio.apply({
      ...document, assets: [{ ...asset, id, role: 'backdrop' }],
      theme: {
        ...document.theme, background: {
          type: 'downloaded', assetId: id, recipe: 'house-r3@1',
          blur: { type: 'preference', key: 'backdrop-blur', initialPercent: 50 },
          scrim: { type: 'canonical@1' }, motion: 'stationary@1', reducedTransparency: 'canonical-base@1',
        },
      },
    });
  };
  async function upload(file: File) {
    if (file.size < 1 || file.size > 8388608 || !['image/png', 'image/jpeg'].includes(file.type)) {
      setAssetError('Choose a PNG/JPEG file containing 1 to 8388608 bytes.'); return;
    }
    setUploading(true); setAssetError('');
    try {
      const asset = await request<UploadedCompositionAsset>('/native/api/assets', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setAssets(previous => [...previous.filter(item => item.sha256 !== asset.sha256), asset]);
      selectAsset(asset);
    } catch (reason) { setAssetError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); }
  }
  const props = document ? { document, onChange: studio.apply, onError: studio.setError } : undefined;
  const field = (path: (string | number)[], value: Json, label: string) => {
    let schema = compositionEditorSchema;
    for (const key of path) schema = schema.properties?.[String(key)] ?? {};
    return props && <CompositionFields {...props} path={path} schema={schema} value={value} label={label}/>;
  };
  return <div className="studio native-composition">
    <header className="studio-header">
      <button onClick={onLegacy}>1.0 workspace</button>
      <strong>Native composition <span className="badge">2.0</span></strong>
      <span className={`save-status ${studio.dirty ? 'unsaved' : ''}`}>{studio.busy ? 'Working...' : studio.dirty ? 'Unsaved local changes' : `Draft ${studio.envelope?.revision ?? ''}`}</span>
      <button disabled={working || !studio.canUndo} onClick={studio.undo}>Undo</button>
      <button disabled={working || !studio.canRedo} onClick={studio.redo}>Redo</button>
      <button disabled={!document || working || !studio.dirty || errors.length > 0} onClick={() => void studio.save()}>Save draft</button>
      <button className="primary" disabled={!document || working || errors.length > 0} onClick={() => void studio.save(true)}>Publish native</button>
    </header>
    <div className="composition-notice">First-slice native contract, not a browser fidelity preview or production-parity certification. Schema-1 saved work is separate and unchanged. Actions are never executed here.</div>
    {studio.error && <div role="alert" className="inline-error">{studio.error}</div>}
    {studio.status && <div role="status" className="composition-status">{studio.status}</div>}
    {studio.conflict && <div className="conflict-banner"><strong>Revision conflict. Local edits are still here.</strong><button disabled={studio.busy} onClick={() => open('reload')}>Reload server draft</button><button disabled={studio.busy} onClick={() => open('keep-local')}>Keep local work...</button></div>}
    <div className="composition-layout">
      <nav aria-label="Native composition sections">
        {sections.map(item => <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item}</button>)}
        <hr/>
        <button disabled={!document || working} onClick={() => open('import')}>Import JSON...</button>
        <button disabled={!document} onClick={() => document && exportLocal(document)}>Export local JSON</button>
        <button disabled={!document || working} onClick={() => open('advanced')}>Advanced JSON...</button>
        <button disabled={working} onClick={() => studio.dirty ? open('reload') : void studio.reload()}>Reload saved draft</button>
      </nav>
      <main>
        <h1>{section}</h1>
        {!document ? <p>{studio.busy ? 'Loading the separate native workspace...' : 'Native composition requires the existing authenticated Studio session. Resolve the error and reload.'}</p> : <fieldset disabled={studio.busy || uploading} className="composition-authoring">
          {section === 'Overview' && <>
            <TextField label="Composition name" value={document.name} onChange={name => studio.apply({ ...document, name })}/>
            <dl><dt>Publisher identity</dt><dd>{studio.envelope?.publisherId}</dd><dt>Document identity</dt><dd>{document.id}</dd><dt>Native endpoint</dt><dd><code>{typeof window === 'undefined' ? '/native' : new URL('./native', window.location.href).href}</code></dd></dl>
            <p>Save validates and durably stores a draft. Publish saves valid local work first, then atomically selects an immutable publication. Export includes current local edits. Import replaces content only, retaining this workspace's publisher/document identity; referenced assets must already be uploaded to this publisher.</p>
            <p>Stable IDs are read-only. Edit titles and labels freely; use destination selectors to reassign relationships before deleting referenced definitions.</p>
            {studio.publishedRevision && <p>Published this session: revision {studio.publishedRevision}</p>}
          </>}
          {section === 'Tabs' && <>
            {field(['navigation', 'initialPageId'], document.navigation.initialPageId, 'Initial page')}
            {field(['navigation', 'initialTabId'], document.navigation.initialTabId, 'Initial tab')}
            {field(['navigation', 'tabs'], document.navigation.tabs, 'Tabs')}
          </>}
          {section === 'Chrome' && field(['navigation', 'chrome'], document.navigation.chrome, 'Shell chrome')}
          {section === 'Pages' && field(['pages'], document.pages, 'Pages')}
          {section === 'Modals' && field(['modals'], document.modals, 'Modals')}
          {(section === 'Pages' || section === 'Modals') && <fieldset className="composition-fieldset"><legend>Move component to another parent</legend>
            <SelectField label="Component to move" value={moving} options={[{ value: '', label: 'Choose a component' }, ...locations.map(({ node }) => ({ value: node.id, label: `${node.title} (${node.id})` }))]} onChange={setMoving}/>
            <SelectField label="New parent" value={parent} options={[{ value: '', label: 'Choose a page, modal, grid, section or local tab' },
              ...[...document.pages, ...document.modals].map(surface => ({ value: `surface:${surface.id}`, label: `${surface.title} (${surface.id})` })),
              ...locations.flatMap(({ node }) => node.type === 'tile-grid' || node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section'
                ? [{ value: `${node.type === 'tile-grid' ? 'grid' : 'section'}:${node.id}`, label: `${node.title} (${node.id})` }]
                : node.type === 'local-tabs' ? node.tabs.map(tab => ({ value: `local-tab:${node.id}:${tab.id}`, label: `${node.title} / ${tab.label}` })) : [])]} onChange={setParent}/>
            <button disabled={!moving || !parent} onClick={() => {
              const [kind, id, tabId] = parent.split(':');
              if (kind !== 'surface' && kind !== 'grid' && kind !== 'section' && kind !== 'local-tab') return;
              try { studio.apply(moveCompositionNode(document, moving, { kind, id, tabId })); } catch (reason) { studio.report(reason); }
            }}>Move to end of parent</button>
            <p className="field-note">Use Up/Down in the component list to set exact order. Moving outside a grid resets span to 1.</p>
          </fieldset>}
          {section === 'Local state' && <>
            <p>Scene-local selections and values only, not saved settings or Home Assistant state. Add a choice field before local tabs, then choose its option IDs for each tab. Tabs must match the field's option order and labels. Save/discard forms require a native domain draft adapter and remain unsupported.</p>
            {document.localState ? field(['localState'], document.localState, 'Local state')
              : <button onClick={() => studio.apply({ ...document, localState: [] })}>Add local state definitions</button>}
          </>}
          {section === 'Data sources' && <>
            <p>Typed entity and domain sources. Targets, labels, symbols, ordered controls, states and confirmations are structured fields. Providers resolve on-device; Studio never fetches private account data or camera streams and never operates Home Assistant.</p>
            {field(['dataSources'], document.dataSources, 'Data sources')}
          </>}
          {section === 'Bootstrap' && <>
            <p>Trusted post-authentication copy only. Home Assistant sign-in, secure fields, system permission decisions and sign-out confirmation remain native. Notifications must precede Time Sensitive; all three setup steps stay present.</p>
            <label className="checkbox-field"><input type="checkbox" checked={Boolean(document.bootstrap)} onChange={event => {
              const next = structuredClone(document);
              if (event.target.checked) next.bootstrap = {
                type: 'native-bootstrap@1', arrivalAnnouncement: 'Your home is ready.',
                recovery: { loadingTitle: 'Getting your layout', unavailableTitle: 'Layout unavailable',
                  unavailableMessage: 'Try again when your publisher is available.', retryLabel: 'Try Again' },
                setup: [
                  { permission: 'notifications', explanation: 'Choose whether this device can receive home alerts.' },
                  { permission: 'time-sensitive', explanation: 'Review how urgent home alerts reach this device.' },
                  { permission: 'location', explanation: 'Choose whether to share this device location with Home Assistant.' },
                ],
              };
              else delete next.bootstrap;
              studio.apply(next);
            }}/>Include trusted bootstrap policy</label>
            {document.bootstrap && field(['bootstrap'], document.bootstrap, 'Bootstrap policy')}
            <p>The post-authentication destination is the authored Initial page and Initial tab, not a feature ID. This policy cannot configure a publisher address, OAuth client, credential, permission grant, or sign-out bypass. Before a trusted publication exists the app uses only its compiled sign-in and configuration-recovery boundary, never a compiled dashboard.</p>
          </>}
          {section === 'Wallpaper' && <>
            <Field label="Upload wallpaper (PNG/JPEG, at most 8 MiB)"><input type="file" accept="image/png,image/jpeg" onChange={event => {
              const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '';
            }}/></Field>
            {assetError && <p role="alert" className="inline-error">{assetError}</p>}
            <SelectField label="Uploaded immutable asset" value={document.assets[0]?.sha256 ?? ''} options={[{ value: '', label: 'Choose an uploaded image' }, ...assets.map(asset => ({
              value: asset.sha256, label: `${asset.sha256.slice(0, 16)}... ${asset.pixelWidth}x${asset.pixelHeight} (${asset.byteLength} bytes)`,
            }))]} onChange={hash => { const asset = assets.find(item => item.sha256 === hash); if (asset) selectAsset(asset); }}/>
            <button onClick={() => studio.apply({ ...document, assets: [], theme: { ...document.theme, background: { type: 'solid', token: 'shell-base@1' } } })}>Use solid native background</button>
            {document.assets.map(asset => <p key={asset.id}><code>{asset.id}</code> <a href={apiUrl(`/native${asset.source.path}`)} target="_blank" rel="noreferrer">View authenticated image</a></p>)}
            {field(['theme', 'background'], document.theme.background, 'Background policies')}
            <p>Uploads are immutable and same-publisher only. Earlier published images survive selection changes and restarts. Native decoding, symbol availability and pixel comparison remain native verification gates.</p>
          </>}
          {section === 'Live Activities' && <>
            <p>Accepted appearance is delivered privately to the existing widget and camera-notification targets.
              Job Id must exactly match the engine job ID (the tag without job.). The engine still owns state,
              timing, safe controls and links. Watch remains the production stub, not a configurable dashboard.</p>
            {field(['liveActivities'], document.liveActivities, 'Live Activities')}
            {document.extensions ? field(['extensions'], document.extensions, 'Native Extensions')
              : <button onClick={() => studio.apply({ ...document, extensions: {
                type: 'native-extensions@1', watch: 'stub@1', routes: [], cameras: [],
              } })}>Add native extension delivery</button>}
            <p>Routes attach existing system shortcuts, Spotlight and notification paths to authored pages.
              Camera entries change copy only, never camera targets, streams or notification actions.
              Changes appear on the next engine/system render; no new polling or push budget is introduced.</p>
          </>}
          {section === 'Native policies' && <>
            <p>Supported controls include native tabs and chrome; sections, rows, inline local tabs and scene-local controls; room navigation; status, weather, lights, alarms, locks and garages; climate, room devices, bedroom, remotes, vacuums and cameras. Bindings, targets, ordered options, labels, symbols and supported presentation policies are editable fields, not browser approximations.</p>
            <p>Collections, account headers, remotes and bedroom controls require matching native providers. Unsupported: whole-feature dispatch, arbitrary service commands, complete save/discard form composition, route arguments, split panes, pinned modal bars, content images and external assets. Implemented controls do not certify complete production pages or pixel parity.</p>
            {field(['navigation', 'policy'], document.navigation.policy, 'Shell policies')}
            {field(['theme'], document.theme, 'Theme')}
          </>}
        </fieldset>}
      </main>
      <aside aria-label="Native composition validation">
        <h2>Validation</h2>
        {errors.length ? <div role="alert" className="inline-error">{errors.join('\n')}</div> : <p>{document ? 'Document compiler accepted the current tree. Asset bytes are checked by the server on save/publish.' : 'No document loaded.'}</p>}
        <p>Errors name exact document pointers. Unsupported capabilities are rejected, never silently approximated. Invalid drafts cannot replace the last publication.</p>
        <h2>Last saved manifest</h2>
        <code>{studio.envelope?.assetManifestSha256}</code>
        <ul>{studio.envelope?.capabilities.map(capability => <li key={capability}><code>{capability}</code></li>)}</ul>
      </aside>
    </div>
    {operation && <Dialog title={operation === 'reload' ? 'Discard local changes and reload?' : operation === 'keep-local' ? 'Replace latest server draft with local work?' : operation === 'import' ? 'Import native composition content' : 'Advanced native composition JSON'} onClose={() => setOperation(undefined)} wide>
      {(operation === 'import' || operation === 'advanced') ? <>
        <p>JSON document only (2.0, at most 2 MiB plus 64 KiB of input whitespace). Unknown fields, duplicate keys and unsupported capabilities are rejected. Content import preserves the current document identity. Assets are not embedded; upload their exact bytes separately.</p>
        <Field label="Composition JSON"><textarea className="code-input composition-source" value={source} onChange={event => setSource(event.target.value)}/></Field>
        <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > MAX_COMPOSITION_ENVELOPE_BYTES) { setDialogError('Input exceeds 2 MiB plus 64 KiB; the document itself must fit 2 MiB'); return; }
          try { setSource(await file.text()); } catch (reason) { setDialogError(String(reason)); }
        }}/>
        {dialogError && <div role="alert" className="inline-error">{dialogError}</div>}
        <div className="composition-actions"><button onClick={() => fileInput.current?.click()}>Choose JSON file</button><button className="primary" onClick={() => {
          try {
            if (!document) return;
            studio.apply(importCompositionText(source, document.id)); setOperation(undefined);
          } catch (reason) {
            setDialogError(reason instanceof CompositionValidationError ? reason.issues.map(formatCompositionIssue).join('\n') : reason instanceof Error ? reason.message : String(reason));
          }
        }}>Validate and apply locally</button></div>
      </> : <>
        <p>{operation === 'reload' ? 'This discards the local native document and undo history. Export local JSON first if you need a copy. Schema-1 work is unaffected.' : 'This explicitly replaces the latest server native draft with your local document. A concurrent change can still produce another conflict. Publishing remains a separate operation.'}</p>
        <button className="primary" disabled={studio.busy} onClick={async () => {
          if (operation === 'reload') await studio.reload(); else await studio.save(false, true);
          setOperation(undefined);
        }}>Confirm {operation === 'reload' ? 'reload' : 'keep local'}</button>
      </>}
    </Dialog>}
  </div>;
}
