import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Database, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { nativeHomeEndpoints } from './shared/native-endpoints';
import { apiUrl, request } from './api';
import { isBackgroundImage, MAX_BACKGROUND_LENGTH } from './shared/background';
import type { Action, DataSource, Json, Primitive, StudioDocument } from './shared/types';
import { allComponents, interactionReferences, uid, type Edit } from './editor';
import { EmptyState, Field, Icon, IconButton, IconField, JsonField, NumberField, PrimitiveField, SelectField, TextField } from './ui';

type PanelProps = { document: StudioDocument; apply: (edit: Edit) => void };
export function DataPanel({ document, apply, onFetch, dataModes, dataErrors, liveEnabled, onLive, onNativeImport }: PanelProps & { onFetch: (id: string) => void; dataModes: Record<string, string>; dataErrors: Record<string, string>; liveEnabled: boolean; onLive: (value: boolean) => void; onNativeImport: () => void }) {
  const [selectedId, setSelectedId] = useState(document.dataSources[0]?.id ?? '');
  const selected = document.dataSources.find(source => source.id === selectedId);
  const update = (edit: (source: DataSource) => void) => apply(draft => {
    const source = draft.dataSources.find(item => item.id === selectedId);
    if (!source) return;
    edit(source);
    if (source.kind === 'native-home' && !Object.keys(nativeHomeEndpoints).length) throw new Error('No verified native-home endpoints are installed. Use a static JSON sample or a Home Assistant entity source.');
  });
  const remove = () => apply(draft => {
    if (interactionReferences(draft, 'source', selectedId)) throw new Error('This source is used by a search bar. Remove or change that search before deleting it.');
    if (allComponents(draft).some(component => component.binding?.sourceId === selectedId)) throw new Error('This source is used by components. Remove their bindings before deleting it.');
    draft.dataSources = draft.dataSources.filter(source => source.id !== selectedId);
  });
  const changeKind = (kind: string) => update(source => {
    if (kind === source.kind) return;
    if (kind !== 'static' && kind !== 'ha-state' && kind !== 'native-home' && kind !== 'endpoint') throw new Error('Unsupported source kind.');
    source.kind = kind;
    delete source.endpoint; delete source.entityId; delete source.queryVariable;
    if (kind === 'ha-state') source.entityId = 'sensor.living_room_temperature';
    if (kind === 'native-home') source.endpoint = Object.keys(nativeHomeEndpoints)[0];
    if (kind === 'endpoint') source.endpoint = 'registered-endpoint';
  });
  return <div className="management-panel"><div className="management-heading"><div><span className="eyebrow">CONNECTED BY DESIGN</span><h1>Data sources</h1><p>Real structure. Safe samples. A preview you control.</p></div><button className="primary" onClick={() => { const id = uid('source'); apply(draft => { draft.dataSources.push({ id, name: 'New data source', kind: 'static', refreshSeconds: 60, sample: [] }); }); setSelectedId(id); }}><Plus size={15}/> New source</button></div>
    <div className="data-safety"><Database size={19}/><div><strong>Live readings, simulated actions</strong><p>Native Home imports load current data immediately when connected. Other drafts start with samples. Turn fetching off to use editable samples; readings are never saved into the document.</p></div></div>
    <div className="management-card"><h2>Start from your native app</h2><p className="muted">Generate editable Home, Security, Climate, Chores, Settings, room pages, and status chips from the server's actual HouseConfig. Review unsupported features before replacing the editor. Requires authenticated Studio and server-side Home Assistant credentials.</p><button onClick={onNativeImport}>Initialize from Native Home</button></div>
    <label className="checkbox-field live-opt-in"><input type="checkbox" checked={liveEnabled} onChange={event => onLive(event.target.checked)}/> Allow fetching configured data for this preview session</label>
    {selected && dataErrors[selected.id] && <p className="inline-error" role="alert">{dataErrors[selected.id]}{dataModes[selected.id] === 'error' && !selected.queryVariable && ' Previously received values may be stale.'}</p>}
    <div className="management-split"><div className="source-list">{document.dataSources.map(source => <button key={source.id} className={selectedId === source.id ? 'selected' : ''} onClick={() => setSelectedId(source.id)}><span className="source-symbol"><Database size={18}/></span><span><strong>{source.name}</strong><small>{source.kind} · {source.queryVariable ? 'on search' : `${source.refreshSeconds}s refresh`}</small></span><span className="sample-badge">{dataModes[source.id] ?? 'sample'}</span></button>)}</div><div className="management-card">{selected ? <><div className="card-title"><h2>{selected.name}</h2><IconButton label="Delete data source" onClick={remove}><Trash2 size={15}/></IconButton></div><TextField label="Source name" value={selected.name} onChange={name => update(source => { source.name = name; })}/><div className="field-pair"><SelectField label="Source kind" value={selected.kind} options={['static', 'ha-state', 'native-home', 'endpoint']} onChange={changeKind}/>{!selected.queryVariable && <NumberField label="Poll interval (seconds)" min={5} max={86400} value={selected.refreshSeconds} onChange={value => update(source => { source.refreshSeconds = value; })}/>}</div>{selected.kind === 'ha-state' && <TextField label="Home Assistant entity ID" value={selected.entityId} onChange={value => update(source => { source.entityId = value; })}/>} {selected.kind === 'native-home' && <SelectField label="Verified endpoint" value={selected.endpoint ?? ''} options={Object.keys(nativeHomeEndpoints)} onChange={value => update(source => { source.endpoint = value; })}/>}
      {selected.kind === 'endpoint' && <EndpointSourceEditor key={`endpoint-${selected.id}`} source={selected} document={document} update={update}/>}
      <JsonField key={selected.id} label="Sample data JSON" value={selected.sample} onChange={value => update(source => { source.sample = value; })}/><div className="data-fetch"><span className="sample-badge">{dataModes[selected.id] ?? 'sample'}</span><button disabled={!liveEnabled || Boolean(selected.queryVariable)} onClick={() => onFetch(selected.id)}><RefreshCw size={14}/> Fetch preview data</button></div><p className="field-note">Source ID: <code>{selected.id}</code>. Bind a component to this source in the inspector. {selected.queryVariable ? 'Open its search bar in Interact mode and enable endpoint search reads. Query sources do not poll.' : 'Polling runs only while live preview data is enabled.'}</p></> : <EmptyState icon="database" title="Connect a source">Choose a source or create one with JSON sample data.</EmptyState>}</div></div>
  </div>;
}

function EndpointSourceEditor({ source, document, update }: { source: DataSource; document: StudioDocument; update: (edit: (source: DataSource) => void) => void }) {
  const [endpoint, setEndpoint] = useState(source.endpoint ?? '');
  const [registry, setRegistry] = useState<{ id: string; name: string; kind: string; searchable: boolean }[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => { setEndpoint(source.endpoint ?? ''); }, [source.endpoint]);
  useEffect(() => () => active.current?.abort(), []);
  async function loadRegistry() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError('');
    try {
      const endpoints = await request<NonNullable<typeof registry>>('/api/read-endpoints', { signal: controller.signal });
      if (!controller.signal.aborted) setRegistry(endpoints);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section aria-label="Registered read endpoint">
    <p className="field-note">An administrator registers fixed read-only Home Assistant or external endpoints on the server. Only their IDs belong here; URLs and credentials never belong in the document.</p>
    <TextField label="Registered endpoint ID" value={endpoint} onChange={setEndpoint} placeholder="recipes-search"/>
    <div className="field-pair"><button onClick={() => update(item => { item.endpoint = endpoint; })}>Apply endpoint ID</button><button disabled={busy} onClick={loadRegistry}>{busy ? 'Loading endpoints...' : 'Load registered endpoints'}</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {registry && <><SelectField label="Available registered endpoints" value={source.endpoint ?? ''} options={[
      { value: source.endpoint ?? '', label: registry.some(item => item.id === source.endpoint) ? `${registry.find(item => item.id === source.endpoint)!.name} (${source.endpoint})` : `${source.endpoint ?? ''} (not registered here)` },
      ...registry.filter(item => item.id !== source.endpoint).map(item => ({ value: item.id, label: `${item.name} (${item.id})${item.searchable ? ' - search' : ''}` })),
    ]} onChange={value => update(item => { item.endpoint = value; })}/>{!registry.length && <p className="field-note">No endpoints are registered on this server. Samples still work offline.</p>}</>}
    <SelectField label="Search query variable" value={source.queryVariable ?? ''} options={[{ value: '', label: 'No query' }, ...Object.entries(document.variables).filter(([, value]) => typeof value === 'string').map(([key]) => key)]} onChange={value => update(item => { if (value) item.queryVariable = value; else delete item.queryVariable; })}/>
    <p className="field-note">Add a string variable in Variables, then select this source for an endpoint search bar. Queries require explicit consent in Interact mode; they are debounced, never polled, and cancelled when the search is hidden. Save source changes before enabling reads.</p>
  </section>;
}

export function VariablesPanel({ document, apply, variables, entities, onVariables, onEntities, onReset }: PanelProps & { variables: Record<string, Primitive>; entities: Record<string, Primitive>; onVariables: (value: Record<string, Primitive>) => void; onEntities: (value: Record<string, Primitive>) => void; onReset: () => void }) {
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState('boolean');
  const [entityKey, setEntityKey] = useState('');
  const [error, setError] = useState('');
  function addVariable() {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(newKey) || ['__proto__', 'constructor', 'prototype'].includes(newKey)) { setError('Use a unique key with letters, numbers, dots, underscores or hyphens.'); return; }
    if (Object.hasOwn(document.variables, newKey)) { setError('That variable already exists.'); return; }
    const value = newType === 'boolean' ? false : newType === 'number' ? 0 : '';
    apply(draft => { draft.variables[newKey] = value; });
    onVariables({ ...variables, [newKey]: value }); setNewKey(''); setError('');
  }
  return <div className="management-panel"><div className="management-heading"><div><span className="eyebrow">MAKE IT RESPONSIVE</span><h1>Variables & conditions</h1><p>Design the state. Try the behavior. Keep the real home untouched.</p></div><button onClick={onReset}><RefreshCw size={14}/> Reset preview</button></div>
    <div className="variables-heading"><h2>App variables</h2><span className="badge">PREVIEW STATE IS NOT SAVED</span></div><div className="variable-table"><div className="variable-table-head"><span>Variable</span><span>Initial value · saved</span><span>Preview value · session</span><span/></div>{Object.entries(document.variables).map(([key, value]) => <div className="variable-row" key={key}><code>{key}</code><ValueControl label={`Initial value for ${key}`} value={value} onChange={value => apply(draft => { draft.variables[key] = value; })}/><ValueControl label={`Preview value for ${key}`} value={variables[key] ?? value} onChange={value => onVariables({ ...variables, [key]: value })}/><IconButton label={`Delete variable ${key}`} onClick={() => apply(draft => {
      const usesVariable = (action: Action | undefined) => (action?.type === 'toggle' || action?.type === 'set') && action.variable === key;
      const referenced = interactionReferences(draft, 'variable', key) || draft.dataSources.some(source => source.queryVariable === key)
        || allComponents(draft).some(component => (component.visibility?.source === 'variable' && component.visibility.key === key)
          || [component.props.variable, component.props.filterVariable, component.props.sortDirectionVariable].includes(key)
          || usesVariable(component.action))
        || [...draft.pages, ...draft.modals].some(page => page.toolbar.some(item => usesVariable(item.action)));
      if (referenced) throw new Error(`"${key}" is in use. Remove its conditions and actions before deleting it.`);
      delete draft.variables[key];
    })}><Trash2 size={14}/></IconButton></div>)}</div>
    <div className="add-variable"><TextField label="New variable key" value={newKey} onChange={setNewKey} placeholder="guestMode"/><SelectField label="Initial type" value={newType} options={['boolean', 'number', 'string']} onChange={setNewType}/><button onClick={addVariable}><Plus size={14}/> Add variable</button></div>{error && <p role="alert" className="inline-error">{error}</p>}
    <div className="management-card entity-panel"><h2>Simulated entity states</h2><p className="muted">Test entity-based visibility without connecting to Home Assistant. Missing entities do not match a condition.</p>{Object.entries(entities).map(([key, value]) => <div className="entity-row" key={key}><code>{key}</code><PrimitiveField label={`Simulated value for ${key}`} value={value} onChange={value => onEntities({ ...entities, [key]: value })}/><IconButton label={`Remove simulated ${key}`} onClick={() => { const next = { ...entities }; delete next[key]; onEntities(next); }}><Trash2 size={14}/></IconButton></div>)}<div className="add-variable"><TextField label="Entity ID to simulate" value={entityKey} onChange={setEntityKey} placeholder="binary_sensor.front_door"/><button onClick={() => { if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(entityKey)) { setError('Enter an entity ID such as binary_sensor.front_door.'); return; } onEntities({ ...entities, [entityKey]: 'on' }); setEntityKey(''); setError(''); }}><Plus size={14}/> Simulate entity</button></div></div>
    <div className="ifttt-explainer"><span>IF</span><div><strong>A variable or entity matches</strong><p>Choose equals, not equal, truthy, greater than, or less than in a component's visibility inspector.</p></div><span>THEN</span><div><strong>Show the component</strong><p>Switch to Interact mode to try navigation and toggles. Hidden edit-mode components stay selectable.</p></div></div>
  </div>;
}
function ValueControl({ label, value, onChange }: { label: string; value: Primitive; onChange: (value: Primitive) => void }) {
  if (typeof value === 'boolean') return <button role="switch" aria-label={label} aria-checked={value} className={`value-toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><span/>{value ? 'True' : 'False'}</button>;
  if (typeof value === 'number') return <input aria-label={label} type="number" value={value} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }}/>;
  if (value === null) return <PrimitiveField label={label} value={value} onChange={onChange}/>;
  return <input aria-label={label} value={value} onChange={event => onChange(event.target.value)}/>;
}

export function NavigationPanel({ document, apply }: PanelProps) {
  return <div className="management-panel"><div className="management-heading"><div><span className="eyebrow">A PLACE FOR EVERYTHING</span><h1>Navigation & theme</h1><p>The app's structure, styled around your household.</p></div><button className="primary" disabled={document.navigation.tabs.length >= 8} onClick={() => apply(draft => { const page = draft.pages.find(page => !draft.navigation.tabs.some(tab => tab.pageId === page.id)) ?? draft.pages[0]; draft.navigation.tabs.push({ id: uid('tab'), label: page.title, icon: page.icon, pageId: page.id }); })}><Plus size={15}/> Add tab</button></div>
    <div className="management-card"><h2>Tab bar</h2><p className="muted">Tabs navigate to pages. Use a short label and recognizable icon; fewer tabs leave more room for content.</p>{document.navigation.tabs.map((tab, index) => <div className="tab-editor" key={tab.id}><span className="tab-number">{index + 1}</span><TextField label="Tab label" value={tab.label} onChange={label => apply(draft => { draft.navigation.tabs[index].label = label; })}/><IconField label="Tab icon" value={tab.icon} onChange={icon => apply(draft => { draft.navigation.tabs[index].icon = icon; })}/><SelectField label="Tab destination" value={tab.pageId} options={document.pages.map(page => ({ value: page.id, label: page.title }))} onChange={pageId => apply(draft => { draft.navigation.tabs[index].pageId = pageId; })}/><div className="tab-editor-tools"><IconButton label={`Move ${tab.label} tab up`} disabled={index === 0} onClick={() => apply(draft => { const [item] = draft.navigation.tabs.splice(index, 1); draft.navigation.tabs.splice(index - 1, 0, item); })}><ArrowUp size={14}/></IconButton><IconButton label={`Move ${tab.label} tab down`} disabled={index === document.navigation.tabs.length - 1} onClick={() => apply(draft => { const [item] = draft.navigation.tabs.splice(index, 1); draft.navigation.tabs.splice(index + 1, 0, item); })}><ArrowDown size={14}/></IconButton><IconButton label={`Delete ${tab.label} tab`} onClick={() => apply(draft => { draft.navigation.tabs.splice(index, 1); })}><Trash2 size={14}/></IconButton></div></div>)}{!document.navigation.tabs.length && <EmptyState title="A focused, single-page experience">Add tabs when your app has more top-level destinations.</EmptyState>}</div>
    <div className="management-card theme-editor"><h2>App identity</h2><TextField label="Project name" value={document.name} onChange={name => apply(draft => { draft.name = name; })}/><SelectField label="Initial page" value={document.navigation.initialPageId} options={document.pages.map(page => ({ value: page.id, label: page.title }))} onChange={pageId => apply(draft => { draft.navigation.initialPageId = pageId; })}/><div className="field-pair"><Field label="App accent color"><input type="color" value={document.theme.accent} onChange={event => apply(draft => { draft.theme.accent = event.target.value; })}/></Field><SelectField label="Appearance" value={document.theme.appearance} options={['light', 'dark', 'system']} onChange={value => apply(draft => { draft.theme.appearance = value as StudioDocument['theme']['appearance']; })}/></div><NumberField label="Text scale" min={0.75} max={2} step={0.05} value={document.theme.fontScale} onChange={value => apply(draft => { draft.theme.fontScale = value; })}/><div className="theme-swatches">{['#dd784e', '#6260d7', '#138f83', '#3785c7', '#bb6389', '#577953'].map(color => <button aria-label={`Set app accent to ${color}`} className={document.theme.accent === color ? 'selected' : ''} style={{ background: color }} key={color} onClick={() => apply(draft => { draft.theme.accent = color; })}/>)}</div></div>
    <BackgroundEditor key={document.theme.background?.image ?? 'none'} document={document} apply={apply}/>
  </div>;
}

function BackgroundEditor({ document: studioDocument, apply }: PanelProps) {
  const background = studioDocument.theme.background;
  const [url, setUrl] = useState(background?.image.startsWith('data:') ? '' : background?.image ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setImage = (image: string) => {
    if (!isBackgroundImage(image)) { setError('Use a valid HTTP(S) or root-relative image URL without credentials.'); return; }
    apply(draft => { draft.theme.background = { image, dim: background?.dim ?? .46, blur: background?.blur ?? 16.8 }; });
    setError('');
  };
  async function upload(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10_000_000) {
      setError('Choose a JPEG, PNG, or WebP image smaller than 10 MB.'); return;
    }
    setBusy(true); setError('');
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare the background image.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', 0.75);
      if (image.length > MAX_BACKGROUND_LENGTH) throw new Error('This image is too detailed to embed. Use a smaller image or an image URL.');
      setImage(image);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The image could not be decoded.'); }
    finally { bitmap?.close(); setBusy(false); }
  }
  return <section className="management-card background-editor"><h2>App background image</h2><p className="muted">Fill every device posture with your own wallpaper. Uploaded images are resized and embedded in the saved document and exports, without image metadata.</p>
    <Field label="Upload background image"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => void upload(event.target.files?.[0])}/></Field>
    <TextField label="Background image URL" value={url} placeholder="https://example.com/wallpaper.jpg" onChange={setUrl}/>
    <button disabled={busy || !url.trim()} onClick={() => setImage(url.trim())}>Apply image URL</button>
    {busy && <p role="status">Preparing background image...</p>}
    {background && <><div className="background-thumbnail"><img src={background.image === '/api/native-wallpaper' ? apiUrl(background.image) : background.image} alt="Current app background"/></div><div className="field-pair"><NumberField label="Background dimming" value={background.dim} min={0} max={0.9} step={0.01} onChange={dim => apply(draft => { if (draft.theme.background) draft.theme.background.dim = dim; })}/><NumberField label="Background blur" value={background.blur} min={0} max={40} step={0.1} onChange={blur => apply(draft => { if (draft.theme.background) draft.theme.background.blur = blur; })}/></div><button onClick={() => apply(draft => { delete draft.theme.background; })}>Remove background image</button></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
