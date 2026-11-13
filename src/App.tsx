import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronRight, Cloud, Code2, Download, FileUp, Hand, History, Home, Layers, LoaderCircle, MousePointer2, PanelRight, Play, Plus, Redo2, Save, Send, Smartphone, Undo2, Upload, X } from 'lucide-react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createComponent } from './shared/catalog';
import { createSampleDocument } from './shared/sample';
import { importNativeHome, record, type NativeSnapshot } from './shared/native-preview';
import type { Action, Component, ComponentType, Primitive, StudioDocument } from './shared/types';
import { apiUrl, request, validateDocument } from './api';
import { assertCanRemoveComponent, containers, deleteSurface, duplicateComponent, findComponent, findSiblings, getComponents, getPage, insertComponent, moveComponent, removeComponent, reorderComponent, safeHttpUrl, uid, type Target } from './editor';
import { useStudio } from './useStudio';
import { usePreviewData } from './usePreviewData';
import Sidebar, { ComponentLibrary, type WorkspaceView } from './Sidebar';
import MobileWorkspace, { type MobileWorkspaceHandle } from './MobileWorkspace';
import { MobileTouchSensor, useMobileDragGuard, mobileDragAccessibility } from './mobile-drag';
import { useReducedMotion } from 'motion/react';
import Inspector from './Inspector';
import DevicePreview, { initialPreview } from './DevicePreview';
import { DataPanel, NavigationPanel, VariablesPanel } from './ProjectPanels';
import { Dialog, EmptyState, Field, Icon, IconButton, SelectField, TextField } from './ui';

type DialogKind = 'source' | 'import' | 'native-import' | 'publish' | 'reset' | 'reload' | 'delete-surface' | 'report-issue' | 'request-feature' | undefined;
type ActionLog = { id: string; time: string; message: string; tone: 'info' | 'error' | 'success' };
const editorKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, droppableContainers, droppableRects } = args.context;
  const matchingRects = new Map([...droppableRects].filter(([id]) => droppableContainers.get(id)?.data.current?.kind === active?.data.current?.kind));
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableRects: matchingRects } });
};
const editorCollision: CollisionDetection = args => {
  if (!args.pointerCoordinates) return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(item => item.data.current?.kind === args.active.data.current?.kind) });
  const hits = pointerWithin(args);
  return hits.sort((a, b) => {
    const area = (id: typeof a.id) => {
      const rect = args.droppableRects.get(id);
      return rect ? rect.width * rect.height : Infinity;
    };
    return area(a.id) - area(b.id);
  });
};
function downloadText(content: string, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const studio = useStudio();
  const { document, apply, notify } = studio;
  const [target, setTarget] = useState<Target>({ kind: 'page', id: 'home' });
  const [selection, setSelection] = useState<string>();
  const [view, setView] = useState<WorkspaceView>('design');
  const [editing, setEditing] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [settings, setSettings] = useState(initialPreview);
  const [previewPage, setPreviewPage] = useState('');
  const [previewModal, setPreviewModal] = useState<string>();
  const [variableOverrides, setVariableOverrides] = useState<Record<string, Primitive>>({});
  const [entities, setEntities] = useState<Record<string, Primitive>>({});
  const [dialog, setDialog] = useState<DialogKind>();
  const [format, setFormat] = useState<'json' | 'yaml'>('json');
  const [sourceText, setSourceText] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackBody, setFeedbackBody] = useState('');
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [dragging, setDragging] = useState<string>();
  const variables = useMemo(() => ({ ...document?.variables, ...variableOverrides }), [document?.variables, variableOverrides]);
  const activeQuerySourceIds = useMemo(() => {
    if (!document || editing || settings.threeD || view !== 'design' || dialog || target.kind === 'activity') return [];
    const surface = previewModal ? document.modals.find(modal => modal.id === previewModal)
      : document.pages.find(page => page.id === previewPage) ?? document.pages.find(page => page.id === document.navigation.initialPageId);
    return surface?.search?.mode === 'endpoint' ? [surface.search.sourceId] : [];
  }, [document, editing, settings.threeD, view, dialog, target.kind, previewModal, previewPage]);
  const { liveEnabled, queryLiveEnabled, changeLive, enableQueryReads, dataResults, dataModes, dataErrors, fetchData } = usePreviewData(document, studio.savedDataSources, studio.serverMode, notify, variables, activeQuerySourceIds);
  const [nativeImport, setNativeImport] = useState<ReturnType<typeof importNativeHome>>();
  const variableKey = JSON.stringify(document?.variables ?? {});
  const loadedDocumentId = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);
  const mobileWorkspace = useRef<MobileWorkspaceHandle>(null);
  const mobileDrag = useMobileDragGuard(JSON.stringify([view, editing, target, settings]));
  const reduceEditorMotion = useReducedMotion();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(MobileTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: editorKeyboardCoordinates }));
  const previewDocument = useMemo(() => document ? { ...document, dataSources: document.dataSources.map(source => Object.hasOwn(dataResults, source.id) ? { ...source, sample: dataResults[source.id] } : source) } : undefined, [document, dataResults]);
  const previewEntities = useMemo(() => {
    const live: Record<string, Primitive> = {};
    for (const source of previewDocument?.dataSources ?? []) {
      if (source.kind !== 'native-home' || source.endpoint !== 'house-states' || !Array.isArray(source.sample)) continue;
      for (const value of source.sample) {
        const entity = record(value);
        if (typeof entity.entityId === 'string' && typeof entity.state === 'string') live[entity.entityId] = entity.state;
      }
    }
    return { ...live, ...entities };
  }, [previewDocument, entities]);
  useEffect(() => { setVariableOverrides({}); }, [variableKey]);
  const selectTarget = useCallback((next: Target) => { setTarget(next); setSelection(undefined); setPreviewModal(undefined); if (next.kind === 'page') setPreviewPage(next.id); }, []);
  function editPreview() {
    if (!editing && target.kind !== 'activity') {
      const next: Target = previewModal ? { kind: 'modal', id: previewModal } : { kind: 'page', id: previewPage };
      if (next.id && (next.kind !== target.kind || next.id !== target.id)) {
        setTarget(next);
        setSelection(undefined);
      }
    }
    setEditing(true);
  }
  useEffect(() => {
    if (!document) return;
    if (loadedDocumentId.current !== document.id) {
      loadedDocumentId.current = document.id; setTarget({ kind: 'page', id: document.navigation.initialPageId }); setPreviewPage(document.navigation.initialPageId); setSelection(undefined); setVariableOverrides({});
    } else {
      const exists = target.kind === 'activity' ? document.liveActivities.some(item => item.id === target.id) : Boolean(getPage(document, target));
      if (!exists) selectTarget({ kind: 'page', id: document.navigation.initialPageId });
      if (!document.pages.some(page => page.id === previewPage)) setPreviewPage(document.navigation.initialPageId);
      if (selection && !findComponent(getComponents(document, target), selection)) setSelection(undefined);
    }
  }, [document, target, selection, previewPage, selectTarget]);
  const openDialog = (next: DialogKind) => { setDialog(next); setDialogError(''); };
  const appendLog = useCallback((message: string, tone: ActionLog['tone'] = 'info') => {
    setLogs(previous => [{ id: uid('event'), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), message, tone }, ...previous].slice(0, 60));
  }, []);
  const runAction = useCallback((action?: Action) => {
    if (!action || action.type === 'none') return;
    switch (action.type) {
      case 'navigate': setPreviewPage(action.pageId); setPreviewModal(undefined); appendLog(`Navigated to ${document?.pages.find(page => page.id === action.pageId)?.title ?? action.pageId}`); break;
      case 'modal': setPreviewModal(action.modalId); appendLog(`Opened modal ${document?.modals.find(modal => modal.id === action.modalId)?.title ?? action.modalId}`); break;
      case 'dismiss': setPreviewModal(undefined); appendLog('Dismissed modal'); break;
      case 'toggle':
        if (typeof variables[action.variable] !== 'boolean') { notify(`"${action.variable}" needs a boolean initial value. Define it in Variables.`, 'error'); break; }
        setVariableOverrides(previous => ({ ...previous, [action.variable]: !variables[action.variable] })); appendLog(`${action.variable} → ${!variables[action.variable]}`); break;
      case 'set': setVariableOverrides(previous => ({ ...previous, [action.variable]: action.value })); appendLog(`${action.variable} → ${JSON.stringify(action.value)}`); break;
      case 'service':
        appendLog(`SIMULATED ${action.domain}.${action.service} → ${action.entityId} ${JSON.stringify(action.data ?? {})}`, 'success');
        notify(`Simulated ${action.domain}.${action.service}. No Home Assistant device was changed.`, 'info');
        break;
      case 'url': {
        const url = safeHttpUrl(action.url, window.location.href);
        if (!url) { notify('Blocked unsafe link. Use HTTP(S) or a root-relative path without credentials.', 'error'); appendLog('Blocked an unsafe external URL', 'error'); break; }
        window.open(url, '_blank', 'noopener,noreferrer'); appendLog(`Opened ${url}`); break;
      }
      case 'report-issue':
      case 'request-feature': setDialog(action.type); setDialogError(''); setFeedbackTitle(''); setFeedbackBody(''); break;
    }
  }, [appendLog, document, notify, variables]);
  function addComponent(type: ComponentType, destinationId: string | undefined = selection, inside = false, placement: 'before' | 'after' = 'after') {
    const component = createComponent(type);
    if (type === 'toggle' && document) {
      const variable = Object.keys(document.variables).find(key => typeof document.variables[key] === 'boolean');
      if (variable) { component.props.variable = variable; component.action = { type: 'toggle', variable }; }
      else notify('Define a boolean in Variables, then bind this toggle in the inspector.', 'info');
    }
    apply(draft => {
      const components = getComponents(draft, target);
      insertComponent(components, component, destinationId, inside, placement);
    });
    setSelection(component.id); setShowInspector(true);
  }
  function duplicateSelected() {
    if (!selection || !document) return;
    const component = findComponent(getComponents(document, target), selection);
    if (!component) return;
    const duplicate = duplicateComponent(component);
    apply(draft => { const siblings = findSiblings(getComponents(draft, target), selection); if (siblings) siblings.splice(siblings.findIndex(item => item.id === selection) + 1, 0, duplicate); });
    setSelection(duplicate.id);
  }
  const remove = (id: string) => { apply(draft => { assertCanRemoveComponent(getPage(draft, target), id); removeComponent(getComponents(draft, target), id); }); if (selection === id) setSelection(undefined); };
  const move = (id: string, offset: number) => apply(draft => reorderComponent(getComponents(draft, target), id, offset));
  function createSurface(kind: Target['kind']) {
    const id = uid(kind);
    apply(draft => {
      if (kind === 'activity') draft.liveActivities.push({ id, name: 'New activity', enabled: true, attributes: {}, variants: { lockScreen: [], compactLeading: [], compactTrailing: [], minimal: [], expanded: [] } });
      else {
        const page = { id, title: kind === 'modal' ? 'New modal' : 'New page', icon: kind === 'modal' ? 'Layers' : 'House', layout: { columns: 2, gap: 12 }, components: [], toolbar: [] };
        if (kind === 'modal') draft.modals.push({ ...page, presentation: 'sheet', detent: 'medium' }); else draft.pages.push(page);
      }
    });
    selectTarget(kind === 'activity' ? { kind, id, variant: 'lockScreen' } : { kind, id }); setView('design'); setShowInspector(true);
  }
  function onDragEnd(event: DragEndEvent) {
    setDragging(undefined);
    if (!event.over) return;
    const inside = event.over.data.current?.kind === 'inside';
    const placement = event.over.data.current?.placement === 'before' ? 'before' : event.over.data.current?.placement === 'after' ? 'after' : undefined;
    const overId = String(event.over.data.current?.componentId ?? event.over.id);
    const activeId = String(event.active.data.current?.componentId ?? event.active.id);
    if (event.active.data.current?.kind === 'palette') {
      addComponent(event.active.data.current.type as ComponentType, overId === 'drop:root' ? '' : overId, inside, placement);
    } else {
      apply(draft => {
        const components = getComponents(draft, target);
        if (overId === 'drop:root') {
          const item = findComponent(components, activeId);
          if (item) { removeComponent(components, item.id); components.push(item); }
        } else if (activeId !== overId && !moveComponent(components, activeId, overId, inside, placement)) throw new Error('Cannot move a component into its own descendants or an unavailable destination.');
      });
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (globalThis.document.querySelector('dialog[open]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void studio.save(); }
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? studio.redo() : studio.undo(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selection && editing) { event.preventDefault(); duplicateSelected(); }
      if (event.key === 'Escape') { setSelection(undefined); setPreviewModal(undefined); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selection && editing) { event.preventDefault(); remove(selection); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  });
  function openSource() { if (document) { setSourceText(format === 'json' ? JSON.stringify(document, null, 2) : stringifyYaml(document)); openDialog('source'); } }
  async function importText(text: string) {
    setDialogBusy(true); setDialogError('');
    try {
      const value: unknown = parseYaml(text, { maxAliasCount: 30 });
      await studio.importDocument(value);
      setDialog(undefined); setSelection(undefined); setVariableOverrides({}); setView('design');
      const imported = value as StudioDocument; selectTarget({ kind: 'page', id: imported.navigation.initialPageId });
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDialogBusy(false); }
  }
  async function prepareNativeImport() {
    openDialog('native-import'); setDialogBusy(true); setNativeImport(undefined);
    try {
      const snapshot = await request<NativeSnapshot>('/api/native-home');
      const candidate = importNativeHome(snapshot);
      const validation = await validateDocument(candidate.document);
      if (!validation.valid) throw new Error(validation.errors.join('\n'));
      setNativeImport(candidate);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDialogBusy(false); }
  }
  async function exportDocument(exportFormat: 'json' | 'yaml') {
    try {
      if (studio.dirty && !await studio.save()) return;
      const response = await fetch(apiUrl(`/api/export?format=${exportFormat}&source=draft`));
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      downloadText(await response.text(), `native-home.${exportFormat}`, exportFormat === 'json' ? 'application/json' : 'application/yaml');
      notify(`${exportFormat.toUpperCase()} exported from the saved server draft.`, 'success');
    } catch (reason) { notify(reason instanceof Error ? reason.message : String(reason), 'error'); }
  }
  async function submitFeedback() {
    setDialogBusy(true); setDialogError('');
    try {
      await request('/api/feedback', { method: 'POST', body: JSON.stringify({ kind: dialog, title: feedbackTitle, description: feedbackBody }) });
      appendLog(`Feedback queued: ${feedbackTitle}`, 'success'); notify('Feedback saved to the server queue. No external issue was created.', 'success'); setDialog(undefined);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDialogBusy(false); }
  }
  const selected = document && selection ? findComponent(getComponents(document, target), selection) : undefined;
  const surfaceName = document ? target.kind === 'activity' ? document.liveActivities.find(item => item.id === target.id)?.name : getPage(document, target)?.title : '';
  return <div className={`studio ${showInspector && view === 'design' ? 'with-inspector' : 'without-inspector'}`}>
    <header className="studio-header">
      <a className="brand" href="./" onClick={event => { if (studio.dirty) { event.preventDefault(); openDialog('reload'); } }}><span className="brand-symbol"><Home size={21}/></span><span>native home <b>STUDIO</b></span></a>
      <div className="project-name">{document?.name ?? 'Your native experience'} <span className="badge">DRAFT</span></div>
      <span className={`save-status ${studio.dirty ? 'unsaved' : ''}`}><Cloud size={15}/>{studio.busy ? 'Saving changes…' : studio.dirty ? 'Unsaved changes' : document ? 'All changes saved' : 'Connecting'}</span>
      <IconButton label="Undo (Ctrl+Z)" disabled={!studio.canUndo || studio.busy} onClick={studio.undo}><Undo2 size={17}/></IconButton><IconButton label="Redo (Ctrl+Shift+Z)" disabled={!studio.canRedo || studio.busy} onClick={studio.redo}><Redo2 size={17}/></IconButton>
      <span className="header-separator"/><button className="save-button" disabled={!document || !studio.dirty || studio.busy} onClick={() => void studio.save()}><Save size={14}/> Save</button><button className="primary publish-button" disabled={!document || studio.busy} onClick={() => openDialog('publish')}><Upload size={14}/> Publish<ArrowUpRight size={13}/></button>
    </header>
    <DndContext sensors={sensors} collisionDetection={editorCollision} accessibility={mobileDragAccessibility} cancelDrop={mobileDrag.cancelDrop} onDragStart={(event: DragStartEvent) => { mobileDrag.begin(); setDragging(String(event.active.data.current?.title ?? event.active.data.current?.type ?? event.active.id)); if (event.active.data.current?.componentId) setSelection(String(event.active.data.current.componentId)); }} onDragEnd={event => { try { onDragEnd(event); } finally { mobileDrag.finish(); } }} onDragCancel={() => { mobileDrag.finish(); setDragging(undefined); }}>
      {document && previewDocument ? <MobileWorkspace ref={mobileWorkspace}
        view={view} onView={setView} editing={editing} dragging={Boolean(dragging)}
        onPaneChange={mobileDrag.invalidate}
        inspectorVisible={showInspector} onInspectorVisible={setShowInspector}
        project={<Sidebar document={document} apply={apply} target={target} selection={selection} view={view} onView={setView} onTarget={selectTarget} onSelect={id => { setSelection(id); setShowInspector(true); }} onAdd={type => addComponent(type)} onNewSurface={createSurface} onDeleteSurface={() => openDialog('delete-surface')} onMove={move} onDelete={remove} onReveal={() => mobileWorkspace.current?.showPane('project')}/>}
        toolbar={<div className="editor-toolbar"><div className="editor-route"><span className="route-icon"><Icon name={view === 'data' ? 'database' : view === 'variables' ? 'sliders' : view === 'navigation' ? 'list' : target.kind === 'activity' ? 'activity' : 'layers'} size={15}/></span><strong>{view === 'design' ? surfaceName : view === 'data' ? 'Data sources' : view === 'variables' ? 'Variables & conditions' : 'Navigation & theme'}</strong>{view === 'design' && <span className="small-muted">{target.kind === 'activity' ? 'Live Activity' : target.kind === 'modal' ? 'Modal' : 'Page'}</span>}</div><div className="toolbar-center">{view === 'design' && <div className="mode-switch"><button className={editing ? 'active' : ''} onClick={editPreview}><MousePointer2 size={13}/> Edit</button><button className={!editing ? 'active' : ''} onClick={() => { setEditing(false); if (target.kind === 'modal') setPreviewModal(target.id); if (target.kind === 'page') setPreviewPage(target.id); }}><Play size={12}/> Interact</button></div>}</div><div className="toolbar-end"><IconButton label="View and edit source" onClick={openSource}><Code2 size={17}/></IconButton><IconButton label="Import JSON or YAML" onClick={() => { setSourceText(''); openDialog('import'); }}><FileUp size={16}/></IconButton><div className="export-menu"><details><summary aria-label="Export document"><Download size={16}/></summary><div><button onClick={() => void exportDocument('json')}>Export JSON</button><button onClick={() => void exportDocument('yaml')}>Export YAML</button><button onClick={() => openDialog('reset')}>Restore example</button></div></details></div><IconButton label="Toggle properties inspector" onClick={() => mobileWorkspace.current?.toggleInspector()}><PanelRight size={16}/></IconButton></div></div>}
        notices={<>
          {studio.conflict && <div className="conflict-banner" role="alert"><AlertCircle size={18}/><div><strong>The server draft changed in another session.</strong><span>Your local edits are safe. Choose which version to keep.</span></div><button disabled={studio.busy} onClick={() => void studio.keepLocal()}>Keep local & replace server</button><button onClick={() => openDialog('reload')}>Reload server version</button></div>}
          {view === 'design' && studio.serverMode === 'live' && !document.dataSources.some(source => source.kind === 'native-home' && source.endpoint === 'house-states') && <div className="data-safety"><Cloud size={19}/><div><strong>HA is connected; this draft is not initialized from Native Home.</strong><p>Load the real house layout and live entity bindings without publishing or changing devices.</p><button onClick={() => void prepareNativeImport()}>Initialize from Native Home</button></div></div>}
        </>}
        preview={<DevicePreview surfaceActive={view === 'design' && !dialog} document={previewDocument} target={target} selection={selection} onSelect={id => { setSelection(id); setShowInspector(true); }} editing={editing} onAction={runAction} onFeedback={message => notify(message, 'info')} previewPage={previewPage} previewModal={previewModal} onDismiss={() => { if (editing && target.kind === 'modal') selectTarget({ kind: 'page', id: previewPage || document.navigation.initialPageId }); else setPreviewModal(undefined); }} variables={variables} entities={previewEntities} settings={settings} onSettings={setSettings} dataModes={dataModes} dataErrors={dataErrors} liveDataEnabled={liveEnabled} queryLiveEnabled={queryLiveEnabled} onEnableQuery={enableQueryReads} onSearchVariable={(variable, value) => setVariableOverrides(previous => ({ ...previous, [variable]: value }))} onSearchSubmit={id => void fetchData(id)} onTarget={selectTarget}/>}
        panels={{
          data: <DataPanel document={document} apply={apply} onFetch={id => void fetchData(id)} dataModes={dataModes} dataErrors={dataErrors} liveEnabled={liveEnabled} onLive={changeLive} onNativeImport={() => void prepareNativeImport()}/>,
          variables: <VariablesPanel document={document} apply={apply} variables={variables} entities={entities} onVariables={setVariableOverrides} onEntities={setEntities} onReset={() => { setVariableOverrides({}); setEntities({}); notify('Preview state reset to configured initial values.'); }}/>,
          navigation: <NavigationPanel document={document} apply={apply}/>,
        }}
        inspector={<Inspector document={document} target={target} selection={selection} apply={apply} duplicate={duplicateSelected} remove={() => selection && remove(selection)} move={offset => selection && move(selection, offset)} onClose={() => mobileWorkspace.current?.closeInspector()}/>}
        insert={<ComponentLibrary selection={selection} onAdd={type => addComponent(type)} onAddInside={selected && containers.has(selected.type) ? type => addComponent(type, selection, true) : undefined}/>}
        activity={showLog && <div className="action-log"><div><strong><History size={14}/> Preview activity</strong><span>Session only · no devices changed</span><button onClick={() => setLogs([])}>Clear</button><IconButton label="Close activity log" onClick={() => setShowLog(false)}><X size={14}/></IconButton></div>{logs.length ? <ol>{logs.map(log => <li className={log.tone} key={log.id}><time>{log.time}</time><span>{log.message}</span></li>)}</ol> : <p>Interact with a tile, toggle, or navigation action to see what happened here.</p>}</div>}
        status={<footer className="editor-statusbar"><span><span className="status-dot enabled"/> {Object.values(dataModes).includes('error') ? 'Preview data error' : Object.values(dataModes).includes('live') ? 'Live data received' : liveEnabled ? 'Preview fetching enabled' : 'Sample preview'}<span className="statusbar-dot">·</span>Service actions simulated</span><button aria-pressed={liveEnabled} onClick={() => changeLive(!liveEnabled)}>Live data: {liveEnabled ? 'on' : 'off'}</button><button onClick={() => setShowLog(!showLog)}><History size={12}/> Activity{logs.length > 0 && <b>{logs.length}</b>}</button><span className="revision-label">Draft r{studio.revision}{studio.publishedRevision !== undefined && ` · Published r${studio.publishedRevision}`}</span></footer>}
      /> : <div className="startup-state"><div className="startup-logo"><Home size={38}/></div><span className="eyebrow">WELCOME TO NATIVE HOME STUDIO</span><h1>{studio.error ? 'Your project is out of reach.' : 'Make home feel like you.'}</h1><p>{studio.error || 'Opening your saved project and a fresh perspective on home.'}</p>{studio.error ? <button className="primary" onClick={() => void studio.reload()}>Retry connection</button> : <LoaderCircle className="spin" size={24}/>}</div>}
      <DragOverlay dropAnimation={reduceEditorMotion ? null : undefined} style={{ pointerEvents: 'none' }}>{dragging && <div className="drag-footprint"><div className="drag-preview"><Layers size={17}/>{dragging.replaceAll('-', ' ')}</div></div>}</DragOverlay>
    </DndContext>
    <div className="notice-stack" aria-live="polite" aria-label="Studio notifications">{studio.notices.map(notice => <div key={notice.id} className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'error' ? <AlertCircle size={19}/> : notice.tone === 'success' ? <CheckCircle2 size={19}/> : <Smartphone size={19}/>}<span>{notice.message}</span><IconButton label="Dismiss notification" onClick={() => studio.dismissNotice(notice.id)}><X size={14}/></IconButton></div>)}</div>
    {dialog === 'native-import' && <Dialog title="Initialize from Native Home" onClose={() => !dialogBusy && setDialog(undefined)}>
      <p className="dialog-description">Reads your server's schema-2 house configuration. Nothing is saved, published, or sent to a device until you explicitly apply and save the generated draft.</p>
      {dialogBusy && <p role="status">Reading and validating native configuration...</p>}
      {dialogError && <><p className="inline-error" role="alert">{dialogError}</p><p className="dialog-description">This requires authenticated Studio access and server-side HA_URL / HA_TOKEN (or trusted Supervisor Ingress). Do not put credentials in the document or a data source.</p></>}
      {nativeImport && <><p>{nativeImport.document.pages.length} pages, {nativeImport.document.modals.length} modals, and native entity bindings are ready.</p><ul className="dialog-description">{nativeImport.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><p className="safety-note">Replace the current editor document and enable live preview reads? Undo restores the layout. Existing saved and published drafts are unchanged until you save. Live states and camera feeds load immediately, stay session-only, and are never embedded in exports. Turn reads off with the Live data button.</p></>}
      <div className="dialog-actions"><button disabled={dialogBusy} onClick={() => setDialog(undefined)}>Cancel</button><button className="primary" disabled={!nativeImport || dialogBusy} onClick={async () => {
        if (!nativeImport) return;
        setDialogBusy(true); setDialogError('');
        try {
          await studio.importDocument(nativeImport.document);
          setEntities({}); changeLive(true); setView('design'); setDialog(undefined); selectTarget({ kind: 'page', id: 'home' });
        } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setDialogBusy(false); }
      }}>Replace editor with native reference</button></div>
    </Dialog>}
    {(dialog === 'source' || dialog === 'import') && <Dialog title={dialog === 'source' ? 'Your experience, in code' : 'Bring your project home'} wide onClose={() => !dialogBusy && setDialog(undefined)}><p className="dialog-description">{dialog === 'source' ? 'The current editor document, including unsaved edits. Apply changes only after server validation.' : 'Import a Native Home Studio JSON or YAML document. Your current document is preserved if validation fails.'}</p>{dialog === 'source' && <div className="source-toolbar"><div className="mode-switch">{(['json', 'yaml'] as const).map(value => <button key={value} className={format === value ? 'active' : ''} onClick={() => { try { const parsed = parseYaml(sourceText, { maxAliasCount: 30 }); setSourceText(value === 'json' ? JSON.stringify(parsed, null, 2) : stringifyYaml(parsed)); setFormat(value); setDialogError(''); } catch (reason) { setDialogError(String(reason)); } }}>{value.toUpperCase()}</button>)}</div><span className="small-muted">{studio.dirty ? 'Unsaved editor document' : `Saved revision ${studio.revision}`}</span></div>}{dialog === 'import' && <div className="import-file"><input ref={fileInput} type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" aria-label="Choose JSON or YAML document" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setDialogError('Choose a document smaller than 2 MB.'); return; } try { setSourceText(await file.text()); } catch (reason) { setDialogError(String(reason)); } }}/><span>or paste your document below</span></div>}<textarea aria-label={dialog === 'source' ? 'Document source' : 'Import document source'} spellCheck={false} className="source-editor" placeholder="Paste JSON or YAML here..." value={sourceText} onChange={event => setSourceText(event.target.value)}/>{dialogError && <pre role="alert" className="validation-errors">{dialogError}</pre>}<div className="dialog-actions"><button onClick={() => setDialog(undefined)} disabled={dialogBusy}>Cancel</button><button className="primary" disabled={dialogBusy || !sourceText.trim()} onClick={() => void importText(sourceText)}>{dialogBusy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} Validate & {dialog === 'source' ? 'apply' : 'import'}</button></div></Dialog>}
    {dialog === 'publish' && <Dialog title="Ready for the next version?" onClose={() => setDialog(undefined)}><div className="publish-illustration"><Upload size={28}/></div><p className="dialog-description">Publish an immutable snapshot of your project to the server. {studio.dirty ? 'Your unsaved changes will be saved first, then that exact revision will be published.' : `Saved draft revision ${studio.revision} is ready to publish.`}</p><div className="safety-note"><strong>Native integration is not connected yet.</strong><br/>This publishes a server-driven configuration, not an installed app, Apple simulator, or APNs update.</div><div className="dialog-actions"><button onClick={() => setDialog(undefined)}>Keep editing</button><button className="primary" disabled={studio.busy} onClick={() => { setDialog(undefined); void studio.publish(); }}><Upload size={14}/> Publish configuration</button></div></Dialog>}
    {(dialog === 'reload' || dialog === 'reset' || dialog === 'delete-surface') && <Dialog title={dialog === 'reload' ? 'Reload the server draft?' : dialog === 'reset' ? 'Start from the example?' : `Delete ${surfaceName}?`} onClose={() => setDialog(undefined)}><p className="dialog-description">{dialog === 'reload' ? 'This replaces local edits with the latest saved server version. Export or copy your source first if you need to keep both.' : dialog === 'reset' ? 'Replace the editor document with the complete household example. Your server draft is unchanged until you save; undo restores your current work.' : `This removes the ${target.kind} and its content. References from navigation and actions are cleared. You can undo this change.`}</p><div className="dialog-actions"><button onClick={() => setDialog(undefined)}>Cancel</button><button className={dialog === 'delete-surface' ? 'danger-button' : 'primary'} onClick={() => {
      if (dialog === 'reload') { void studio.reload(); setVariableOverrides({}); }
      if (dialog === 'reset') { void studio.importDocument(createSampleDocument()).catch(reason => notify(String(reason), 'error')); setVariableOverrides({}); changeLive(false); }
      if (dialog === 'delete-surface') apply(draft => deleteSurface(draft, target));
      setDialog(undefined);
    }}>{dialog === 'reload' ? 'Discard local & reload' : dialog === 'reset' ? 'Use example' : 'Delete'}</button></div></Dialog>}
    {(dialog === 'report-issue' || dialog === 'request-feature') && <Dialog title={dialog === 'report-issue' ? 'Report an issue' : 'A good idea starts here'} onClose={() => !dialogBusy && setDialog(undefined)}><p className="dialog-description">Feedback is saved to a local server queue. Nothing is posted to GitHub or another external service.</p><form onSubmit={event => { event.preventDefault(); void submitFeedback(); }}><TextField label={dialog === 'report-issue' ? 'What went wrong?' : 'Feature title'} value={feedbackTitle} onChange={setFeedbackTitle} required maxLength={240}/><Field label="Details"><textarea required rows={5} value={feedbackBody} onChange={event => setFeedbackBody(event.target.value)} placeholder="A little context makes a big difference."/></Field>{dialogError && <p className="inline-error" role="alert">{dialogError}</p>}<div className="dialog-actions"><button type="button" onClick={() => setDialog(undefined)} disabled={dialogBusy}>Cancel</button><button type="submit" className="primary" disabled={dialogBusy || !feedbackTitle.trim() || !feedbackBody.trim()}><Send size={14}/> {dialogBusy ? 'Saving…' : 'Save feedback'}</button></div></form></Dialog>}
  </div>;
}
