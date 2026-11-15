import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, request } from './api';
import { componentLocations, compositionEditorSchema, compositionErrors, compositionSourceText, importCompositionText, moveCompositionNode } from './composition-editor';
import CompositionFields from './CompositionFields';
import HomeAssistantPublication from './HomeAssistantPublication';
import RoutesEditor from './RoutesEditor';
import { useCompositionStudio } from './useCompositionStudio';
import type { Json } from './shared/types';
import type { CompositionDocument } from './shared/composition/schema';
import { compositionWarnings } from './shared/composition/lints';
import { formatCompositionIssue, type UploadedCompositionAsset } from './shared/composition/workspace';
import { CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES } from './shared/composition/json';
import { uid } from './editor';
import { Dialog, Field, SelectField, TextField } from './ui';
import './NativeCompositionWorkspace.css';

const sections = ['Overview', 'Tabs', 'Chrome', 'Pages', 'Modals', 'Local state', 'Data sources', 'Wallpaper', 'Bootstrap', 'Routes', 'Live Activities', 'Shell and theme', 'Home Assistant'] as const;
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
  const warnings = useMemo(() => document ? compositionWarnings(document) : [], [document]);
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
      setAssetError('Use a PNG or JPEG up to 8 MB.'); return;
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
      <strong>2.0 workspace</strong>
      <span className={`save-status ${studio.dirty ? 'unsaved' : ''}`}>{studio.busy ? 'Working...' : studio.dirty ? 'Unsaved local changes' : `Draft ${studio.envelope?.revision ?? ''}`}</span>
      <button disabled={working || !studio.canUndo} onClick={studio.undo}>Undo</button>
      <button disabled={working || !studio.canRedo} onClick={studio.redo}>Redo</button>
      <button disabled={!document || working || !studio.dirty || errors.length > 0} onClick={() => void studio.save()}>Save draft</button>
      <button className="primary" disabled={!document || working || errors.length > 0} onClick={() => void studio.save(true)}>Publish to preview</button>
      <button className="primary" disabled={!document || working || errors.length > 0} onClick={() => void studio.save('home-assistant')}>Publish</button>
    </header>
    
    {studio.error && <div role="alert" className="inline-error">{studio.error}</div>}
    {studio.status && <div role="status" className="composition-status">{studio.status}</div>}
    {studio.houseImport && studio.houseImport.dropped.length > 0 && <details className="composition-status" open>
      <summary>{studio.houseImport.dropped.length} house-config behaviours were not carried over</summary>
      <ul>{studio.houseImport.dropped.map(note => <li key={note.path}><code>{note.path}</code>: {note.reason}</li>)}</ul>
    </details>}
    {studio.conflict && <div className="conflict-banner"><strong>A newer draft was saved. Your edits are kept.</strong><button disabled={studio.busy} onClick={() => open('reload')}>Use the server draft</button><button disabled={studio.busy} onClick={() => open('keep-local')}>Keep my changes</button></div>}
    <div className="composition-layout">
      <nav aria-label="Sections">
        {sections.map(item => <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{item}</button>)}
        <hr/>
        <button disabled={!document || working} onClick={() => open('import')}>Import JSON...</button>
        <button disabled={!document || working || studio.dirty} title="Adds chores pages and rooms from the live house config. Save or discard changes first." onClick={() => void studio.importHouse()}>Import from house config</button>
        <button disabled={!document} onClick={() => document && exportLocal(document)}>Export local JSON</button>
        <button disabled={!document || working} onClick={() => open('advanced')}>Advanced JSON...</button>
        <button disabled={working} onClick={() => studio.dirty ? open('reload') : void studio.reload()}>Reload saved draft</button>
      </nav>
      <main>
        <h1>{section}</h1>
        {!document ? <p>{studio.busy ? 'Loading…' : 'Sign in to load the draft.'}</p> : <fieldset disabled={studio.busy || uploading} className="composition-authoring">
          {section === 'Overview' && <>
            <TextField label="Composition name" value={document.name} onChange={name => studio.apply({ ...document, name })}/>
            <dl></dl>
            
            
            {studio.publishedRevision && <p>Frozen locally this session: revision {studio.publishedRevision}</p>}
            {studio.homeAssistant && <p>Published to Home Assistant this session: revision {studio.homeAssistant.revision}</p>}
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
            <p>Values that live on one screen, such as the selected tab. Add a choice field before local tabs.</p>
            {document.localState ? field(['localState'], document.localState, 'Local state')
              : <button onClick={() => studio.apply({ ...document, localState: [] })}>Add local state definitions</button>}
          </>}
          {section === 'Data sources' && <>
            
            {field(['dataSources'], document.dataSources, 'Data sources')}
          </>}
          {section === 'Bootstrap' && <>
            <p>Text the app shows after sign-in. Sign-in, permissions and sign-out stay native.</p>
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
            }}/>Show first-run setup</label>
            {document.bootstrap && field(['bootstrap'], document.bootstrap, 'Bootstrap policy')}
            
          </>}
          {section === 'Wallpaper' && <>
            <Field label="Upload wallpaper (PNG or JPEG, up to 8 MB)"><input type="file" accept="image/png,image/jpeg" onChange={event => {
              const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '';
            }}/></Field>
            {assetError && <p role="alert" className="inline-error">{assetError}</p>}
            <SelectField label="Wallpaper" value={document.assets[0]?.sha256 ?? ''} options={[{ value: '', label: 'Choose an uploaded image' }, ...assets.map(asset => ({
              value: asset.sha256, label: `${asset.sha256.slice(0, 16)}... ${asset.pixelWidth}x${asset.pixelHeight} (${asset.byteLength} bytes)`,
            }))]} onChange={hash => { const asset = assets.find(item => item.sha256 === hash); if (asset) selectAsset(asset); }}/>
            <button onClick={() => studio.apply({ ...document, assets: [], theme: { ...document.theme, background: { type: 'solid', token: 'shell-base@1' } } })}>Use a solid background</button>
            {document.assets.map(asset => <p key={asset.id}><code>{asset.id}</code> <a href={apiUrl(`/native${asset.source.path}`)} target="_blank" rel="noreferrer">View image</a></p>)}
            {field(['theme', 'background'], document.theme.background, 'Background policies')}
            
          </>}
          {section === 'Live Activities' && <>
            <p>Appearance for the widget and camera notifications. Job ID must match the engine job (the tag without "job.").</p>
            
            {field(['liveActivities'], document.liveActivities, 'Live Activities')}
            {document.extensions ? field(['extensions', 'cameras'], document.extensions.cameras, 'Camera copy')
              : <p>Add extensions under Routes first.</p>}
            
          </>}
          {section === 'Routes' && <>
            <RoutesEditor document={document} onChange={studio.apply}/>
            {document.extensions && field(['extensions', 'routes'], document.extensions.routes, 'Route targets (page, tab, anchors)')}
            <p>Paths that open a page from Siri, Spotlight or a notification.</p>
          </>}
          {section === 'Home Assistant' && <HomeAssistantPublication published={studio.homeAssistant} busy={working} onChange={studio.setStatus}/>}
          {section === 'Shell and theme' && <>
            
            
            {field(['navigation', 'policy'], document.navigation.policy, 'Shell policies')}
            {field(['theme'], document.theme, 'Theme')}
          </>}
        </fieldset>}
      </main>
      <aside aria-label="Validation">
        <h2>Validation</h2>
        {errors.length ? <div role="alert" className="inline-error">{errors.join('\n')}</div> : <p>{document ? 'No errors.' : 'No document loaded.'}</p>}
        {warnings.length > 0 && <div role="status" className="safety-note"><strong>Warnings</strong>
          <ul>{warnings.map(warning => <li key={`${warning.pointer}:${warning.message}`}><code>{warning.pointer}</code> {warning.message}</li>)}</ul></div>}
        
              </aside>
    </div>
    {operation && <Dialog title={operation === 'reload' ? 'Discard local changes and reload?' : operation === 'keep-local' ? 'Replace latest server draft with local work?' : operation === 'import' ? 'Import 2.0 content' : 'Advanced JSON'} onClose={() => setOperation(undefined)} wide>
      {(operation === 'import' || operation === 'advanced') ? <>
        <p>Paste or choose a 2.0 JSON document (up to 2 MB). Images are not included; upload them separately.</p>
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
        }}>Import</button></div>
      </> : <>
        <p>{operation === 'reload' ? 'Discards your unsaved changes and undo history. Export first if you need a copy.' : 'Replaces the server draft with yours. If someone saved meanwhile, you may see another conflict.'}</p>
        <button className="primary" disabled={studio.busy} onClick={async () => {
          if (operation === 'reload') await studio.reload(); else await studio.save(false, true);
          setOperation(undefined);
        }}>Confirm {operation === 'reload' ? 'reload' : 'keep local'}</button>
      </>}
    </Dialog>}
  </div>;
}
