import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ApiError, request } from '../../api';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../../shared/composition/compiler';
import { canonicalOfBounded } from '../../shared/composition/json';
import { lift, projectGraph, type CanvasHost, type CanvasLens, type CanvasSnapshot, type CanvasWriteResult, type LogicGraph } from '../../shared/composition/graph';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { useDraftDocument, type Draft } from '../editors/draft';
import { documentEdit } from '../editors/documentEdit';
import { canvasReferences, editSubtrees, type CanvasProvenance } from '../editors/provenance';
import FlowCanvas, { arrangeCanvas, type CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import type { CanvasObservations } from '../canvas/observations';
import { SimulationHost } from '../logic-simulation/SimulationHost';
import { createSimulationProgram } from '../logic-simulation/program';
import type { CanvasObservations as SimulationObservations } from '../logic-simulation/observations';
import { flowSources } from '../data/flow';
import { sourceName } from '../dialogs/sources';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import type { Workspace2 } from '../useWorkspace2';
import type { DerivedTheme } from '../theme';
import { fieldAdapters, fieldAnchor, fieldPointer, pointerPath, type LogicFieldKind } from './registry';
import { saveCanvasLayout } from './layout';
import { canvasPortObservations } from './observations';
import { RetireWorkspaceFlows } from './live';
import { previewGraph, templateUses } from './lenses';
import { LensChooser } from './LensChooser';
import ResultSummary from './ResultSummary';
import { displayValue } from '../logic-simulation/presentation';
import { useNameContext } from '../expr/useExpr';
import { graphBlockLabel, sourceLabel } from './presentation';
import { indexGraph } from '../canvas/graph-index';
import { operandSlot, slotOperand } from '../expr/tokens';
import type { Operand } from '../../shared/composition/expression';
import './logic-fields.css';

export interface CanvasFieldRequest {
  readonly draft: Draft;
  readonly path: EditorPath;
  readonly kind: LogicFieldKind;
  readonly label: string;
  readonly combine?: 'all' | 'any';
}
interface OpenField extends CanvasFieldRequest {
  readonly graph: LogicGraph;
  readonly sourceMap: CanvasProvenance['sourceMap'];
  readonly returnFocus: HTMLElement | null;
}
interface FieldsApi { readonly suspended: boolean; open(request: CanvasFieldRequest): void }
const Fields = createContext<FieldsApi | undefined>(undefined);
export const useLogicFields = () => useContext(Fields);

/** The value editor uses a slot view; the canvas must see the real library body. */
export function operandBodyDraft(draft: Draft, path: EditorPath): Draft {
  let view: CompositionDocument | undefined, canonical: CompositionDocument;
  return {
    ...draft,
    get() {
      const current = draft.get();
      if (current !== view) {
        const body = slotOperand(valueAt(current, path) as { type: string });
        if (!body) throw new Error('The template body must have a value.');
        view = current;
        canonical = replaceAt(current, path, body);
      }
      return canonical;
    },
    set(next, typing) {
      const body = valueAt(next, path) as Operand;
      draft.set(replaceAt(next, path, operandSlot(body, valueAt(draft.get(), path))), typing);
    },
  };
}
export function WhenCanvasClosed({ children }: { children: ReactNode }) {
  return useLogicFields()?.suspended ? null : children;
}

export function useFieldDraft(document: CompositionDocument, onChange: (next: CompositionDocument, group?: string) => void): Draft {
  const latest = useRef({ document, onChange }), listeners = useRef(new Set<() => void>());
  latest.current = { document, onChange };
  useEffect(() => { listeners.current.forEach(listener => listener()); }, [document]);
  const [draft] = useState<Draft>(() => ({
    get: () => latest.current.document,
    set: (next, group) => {
      next = documentEdit(latest.current.document, next);
      if (next === latest.current.document) return;
      latest.current = { ...latest.current, document: next }; latest.current.onChange(next, group); listeners.current.forEach(listener => listener());
    },
    subscribe: listener => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; },
    dirty: () => false, tryLeave: () => true, name: '',
    prompt: { get: () => false, set: () => {}, subscribe: () => () => {} },
    undo() {}, redo() {}, canUndo: () => false, canRedo: () => false,
  }));
  return draft;
}

export function LogicFieldsProvider({ ws, theme, children }: { ws: Workspace2; theme: DerivedTheme; children: ReactNode }) {
  const [opened, setOpened] = useState<OpenField>(), [error, setError] = useState('');
  const [retiring, setRetiring] = useState(false);
  useEffect(() => { if (!opened && retiring) setRetiring(false); }, [opened, retiring]);
  const open = useCallback((field: CanvasFieldRequest) => {
    try {
      let document = field.draft.get();
      let scoped = field;
      if (field.path[0] === 'logicLibrary' && field.path[2] === 'body' && document.logicLibrary?.[Number(field.path[1])]?.kind === 'operand') {
        const bodyPath = field.path.slice(0, 3), body = valueAt(document, bodyPath) as { type?: string; from?: unknown };
        if (body?.type === 'expr' || body?.type === 'read' && !body.from) {
          const draft = operandBodyDraft(field.draft, bodyPath);
          const path = body.type === 'expr' && field.path[3] === 'value' ? [...bodyPath, ...field.path.slice(4)] : field.path;
          field = { ...field, draft, path };
          document = draft.get();
          scoped = { ...field, path: bodyPath, kind: 'operand' };
        }
      }
      const layout = readStudioCanvas(document);
      for (let depth = field.path.length; depth > 0; depth--) {
        const value = valueAt(document, field.path.slice(0, depth)) as { kind?: string; model?: string } | undefined;
        if (value?.kind === 'model' && value.model === 'pipeline@1') { scoped = { ...field, path: field.path.slice(0, depth), kind: 'flow' }; break; }
      }
      const anchor = fieldAnchor(document, scoped.path);
      // Start the second check from the authored one, not an invented entity or a persisted placeholder.
      const working = field.combine ? replaceAt(document, field.path, { type: field.combine, of: [valueAt(document, field.path), valueAt(document, field.path)] }) : document;
      const lifted = lift(fieldAdapters[scoped.kind].read(working, scoped.path), {
        anchor, kind: fieldAdapters[scoped.kind].destination, metadata: layout.metadata,
        context: { document: document as unknown as Json, pointer: fieldPointer(scoped.path) },
      });
      let graph = lifted.graph;
      if (!layout.metadata || field.combine) graph = arrangeCanvas(graph);
      setError('');
      const sourceMap = field.combine ? lifted.sourceMap.flatMap(location => /^\/of\/[01](?:\/|$)/.test(location.pointer)
        ? [{ ...location, pointer: location.pointer.replace(/^\/of\/[01]/, '') }] : []) : lifted.sourceMap;
      setOpened({ ...scoped, graph, sourceMap, returnFocus: globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  const suspended = Boolean(opened) || retiring;
  const api = useMemo(() => ({ open, suspended }), [open, suspended]);
  return <Fields.Provider value={api}>{children}
    {suspended && ws.document && <RetireWorkspaceFlows ids={flowSources(ws.document).map(source => source.id)}/>}
    {error && <div className="w2-logic-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Dismiss</button></div>}
    {opened && <CanvasSession key={canonicalOfBounded(opened.graph.roots[0].anchor)} field={opened} ws={ws} theme={theme} onClose={() => { setRetiring(true); setOpened(undefined); }}/>}
  </Fields.Provider>;
}
let previewCollapsedInMemory = false;
let previewPreferenceUnsaved = false;
function CanvasSession({ field, ws, theme, onClose }: { field: OpenField; ws: Workspace2; theme: DerivedTheme; onClose: () => void }) {
  const previewStorageKey = 'sh-studio.canvas.preview-collapsed';
  const [preview, setPreview] = useState(() => {
    try {
      const stored = localStorage.getItem(previewStorageKey) === 'true';
      return { collapsed: previewPreferenceUnsaved ? previewCollapsedInMemory : stored, storageUnavailable: previewPreferenceUnsaved };
    }
    catch { return { collapsed: previewCollapsedInMemory, storageUnavailable: true }; }
  });
  const previewId = useId(), collapseToggle = useRef<HTMLButtonElement>(null), expandToggle = useRef<HTMLButtonElement>(null);
  const focusPreviewToggle = useRef(false);
  useEffect(() => {
    previewCollapsedInMemory = preview.collapsed;
    if (focusPreviewToggle.current) {
      (preview.collapsed ? expandToggle : collapseToggle).current?.focus();
      focusPreviewToggle.current = false;
    }
  }, [preview.collapsed]);
  const togglePreview = (collapsed: boolean) => {
    let storageUnavailable = false;
    try { localStorage.setItem(previewStorageKey, String(collapsed)); }
    catch { storageUnavailable = true; }
    previewPreferenceUnsaved = storageUnavailable;
    focusPreviewToggle.current = true;
    setPreview({ collapsed, storageUnavailable });
  };
  const document = useDraftDocument(field.draft), data = useWorkspaceData();
  const names = useNameContext(document);
  const entry = field.path[0] === 'logicLibrary' ? document.logicLibrary?.[Number(field.path[1])] : undefined;
  const nameContext = useMemo(() => entry ? { ...names, logic: { library: document.logicLibrary ?? [], settings: entry.params } } : names, [names, entry, document.logicLibrary]);
  const [working, setWorking] = useState(field.graph), [selected, setSelected] = useState<string | null>(null);
  const workingRef = useRef(working); workingRef.current = working;
  const blockNames = useMemo(() => {
    const index = indexGraph(working);
    return Object.fromEntries(working.nodes.map(node => [node.id, graphBlockLabel(node, working, nameContext, index).name]));
  }, [working, nameContext]);
  const [observations, setObservations] = useState<CanvasObservations>(), [active, setActive] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [lens, setLens] = useState<CanvasLens>({ kind: 'values' }), [tryWith, setTryWith] = useState<Record<string, Json>>();
  const [lastObservation, setLastObservation] = useState<SimulationObservations>(), [conflict, setConflict] = useState(false);
  const wsRef = useRef(ws); wsRef.current = ws;
  const appliedAnchors = useRef(new Map<string, ReturnType<typeof fieldAnchor>>());
  const appliedProvenance = useRef<CanvasProvenance>({ graph: field.graph, sourceMap: field.sourceMap });
  const snapshot = useCallback((): CanvasSnapshot => {
    const document = field.draft.get();
    return { document: document as unknown as Json, revision: canonicalOfBounded(document) };
  }, [field.draft]);
  const invalid = (message: string): CanvasWriteResult => ({ status: 'invalid', diagnostics: [{
    severity: 'error', code: 'invalid_value', anchor: field.graph.roots[0].anchor, pointer: '', message,
  }] });
  const apply = useCallback(async (transaction: Parameters<CanvasHost['apply']>[0], layout?: CanvasLayoutHandoff): Promise<CanvasWriteResult> => {
    const before = field.draft.get();
    if (canonicalOfBounded(before) !== transaction.revision) return { status: 'conflict', remote: snapshot() };
    let next = before;
    const paths: EditorPath[] = [];
    for (const replacement of transaction.replacements) {
      const resolved = resolveLogicAnchor(before, appliedAnchors.current.get(canonicalOfBounded(replacement.anchor)) ?? replacement.anchor);
      if (!resolved) return invalid('The logic owner moved or was removed. Local canvas edits have been retained.');
      const path = pointerPath(resolved.pointer); paths.push(path);
      next = fieldAdapters[field.kind].write(next, path, replacement.ast as Json);
    }
    if (transaction.generatedSources.length) next = { ...next, dataSources: [...next.dataSources, ...transaction.generatedSources] } as CompositionDocument;
    if (transaction.generatedLibrary.length) next = { ...next, logicLibrary: [...next.logicLibrary ?? [], ...transaction.generatedLibrary] } as CompositionDocument;
    const provenance = layout ?? { graph: workingRef.current, sourceMap: projectGraph(workingRef.current).sourceMap };
    const proposed = next;
    next = editSubtrees(before, next, canvasReferences(paths, appliedProvenance.current, provenance));
    if (next === before && proposed !== before) return invalid("This change can't keep its linked values, so it wasn't applied.");
    if (layout) next = saveCanvasLayout(next, transaction.replacements, layout, { document: before, paths });
    compileCompositionDocument(next);
    await request('/native/api/draft/prepare', { method: 'POST', body: JSON.stringify({ document: next }) });
    if (field.draft.get() !== before) return { status: 'conflict', remote: snapshot() };
    field.draft.set(next);
    if (canonicalOfBounded(field.draft.get()) !== canonicalOfBounded(next)) return invalid("This change can't keep its linked values, so it wasn't applied.");
    appliedProvenance.current = provenance;
    transaction.replacements.forEach((replacement, index) => appliedAnchors.current.set(canonicalOfBounded(replacement.anchor), fieldAnchor(field.draft.get(), paths[index])));
    return { status: 'applied', snapshot: snapshot() };
  }, [field, snapshot]);
  const save = useCallback(async (): Promise<CanvasWriteResult> => {
    const studio = wsRef.current.studio;
    if (canonicalOfBounded(field.draft.get()) !== canonicalOfBounded(studio.latestDocument())) return invalid('Finish this field with Done before saving the workspace draft.');
    await studio.whenIdle();
    if (!await studio.save()) {
      const reason = studio.latestSaveFailure();
      if (!(reason instanceof ApiError) || reason.status !== 409) return invalid(reason instanceof Error ? reason.message : 'Draft save failed. Local edits have been retained.');
      const remote = await request<{ document: CompositionDocument; revision: number }>('/native/api/draft');
      return { status: 'conflict', remote: { document: remote.document as unknown as Json, revision: String(remote.revision) } };
    }
    return { status: 'saved', snapshot: snapshot() };
  }, [field, snapshot]);
  const host = useMemo<CanvasHost>(() => ({
    snapshot, apply, save, open: () => { throw new Error('Close this canvas before opening another field.'); },
    openOutput: () => { throw new Error('Close this canvas before opening another output.'); },
    compareConflict: () => setConflict(true),
    uses: output => {
      const entry = document.logicLibrary?.find(entry => entry.id === output.id);
      return entry ? templateUses(document, entry).map(use => ({ anchor: use.anchor, output, arguments: use.value.args })) : [];
    },
    preview: setLens,
    data: { sources: document.dataSources.map(source => ({ id: source.id, name: source.kind === 'ha-entity' ? sourceLabel(source.id, nameContext) : sourceName(source) })) },
    targetCapabilities: supportedCompositionCapabilities,
  }), [snapshot, apply, save, document, nameContext]);
  const simulation = useMemo(() => {
    if (!['operand', 'condition', 'flow'].includes(field.kind) && !(field.kind === 'slot' && ['literal', 'read', 'expr'].includes(String((working.original as { type?: string })?.type)))) {
      return { error: 'Open a typed condition or value output to simulate this structure.' };
    }
    try {
      const sourceEntities = Object.fromEntries(document.dataSources.flatMap(source => source.kind === 'ha-entity' && source.entityId.type === 'literal' ? [[source.id, source.entityId.value]] : []));
      return { program: createSimulationProgram([previewGraph(document, working, field.path, lens, tryWith)], {
        library: document.logicLibrary, flows: flowSources(document), sourceEntities,
        names: { [canonicalOfBounded(working.roots[0].anchor)]: field.label },
      }) };
    } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [working, document, field.kind, field.path, lens, tryWith]);
  const observe = useCallback((value: SimulationObservations) => { setLastObservation(value); setObservations(canvasPortObservations(value)); }, []);
  const close = () => { setActive(false); };
  useEffect(() => { if (!active) onClose(); }, [active, onClose]);
  const warnings = readStudioCanvas(document).warnings;
  return <Dialog.Root open modal onOpenChange={() => {}}>
    <Dialog.Portal><Dialog.Backdrop className="w2-logic-backdrop" style={theme.variables}/><Dialog.Popup className="w2-scope w2-logic-overlay" style={theme.variables} aria-label={`${field.label} canvas`} finalFocus={() => field.returnFocus}>
      <Dialog.Title className="w2-logic-sr">{field.label}</Dialog.Title>
      <div className="w2-logic-work" data-preview-collapsed={preview.collapsed}>
        <div className="w2-logic-session-status">
          {conflict && <p role="alert">The saved revision changed. Local canvas edits are retained; close the canvas to compare revisions in the workspace.</p>}
          {warnings.map(warning => <p role="alert" key={warning.pointer}>{warning.message}</p>)}
          {warnings.length > 0 && <button type="button" onClick={() => {
            const before = field.draft.get(), { studioCanvas: _removed, ...rest } = before;
            field.draft.set(documentEdit(before, rest as CompositionDocument, { deleted: [['studioCanvas']] }));
          }}>Reset saved layout</button>}
          {preview.storageUnavailable && <p role="status">Browser storage is unavailable. The Preview choice will only be remembered until this page closes.</p>}
        </div>
        <FlowCanvas host={{ ...host, observations }} graph={field.graph} title={field.label} theme={theme} onClose={close} returnFocus={field.returnFocus}
          selectedNodeId={selected} onSelectionChange={setSelected} onGraphChange={setWorking}
          onApply={(transaction, layout) => apply(transaction, layout)}/>
        <aside className="w2-logic-simulation" aria-label="Canvas preview" id={previewId} hidden={preview.collapsed} inert={preview.collapsed}>
          <header className="w2-logic-preview-header"><strong>Preview</strong>
            <button type="button" ref={collapseToggle} aria-label="Collapse Preview" aria-expanded={!preview.collapsed} aria-controls={previewId} onClick={() => togglePreview(true)}>
              <PanelRightClose size={18} aria-hidden />
            </button>
          </header>
          <ResultSummary graph={working} program={simulation.program} observations={lastObservation} blockNames={blockNames} error={simulation.error}/>
          <LensChooser document={document} entry={field.path[0] === 'logicLibrary' ? document.logicLibrary?.[Number(field.path[1])] : undefined}
            lens={lens} onLens={setLens} onArguments={setTryWith}/>
          {lens.kind !== 'values' && <article className="w2-logic-field-preview" aria-label={lens.kind === 'stand-in' ? 'Stand-in field preview' : 'Use field preview'}>
            <strong>{field.label}</strong><output>{displayValue(lastObservation?.blocks[working.roots[0].nodeId]?.result, { name: field.label })}</output>
            <small>{lens.kind === 'stand-in' ? 'Preview only - not saved' : 'Resolved for the selected use'}</small>
          </article>}
          <details><summary>Simulation · Studio only</summary>
          {ready && simulation.program ? <SimulationHost program={simulation.program} document={document} canvasId={canonicalOfBounded(field.graph.roots[0].anchor)}
            blockNames={blockNames}
            selectedBlockId={selected ?? undefined} onSelectBlock={setSelected} onObservation={observe} active={active}
            freshness={{ stale: !data.live || !ws.houseStates.streaming }}/>
            : <p className="w2-caption" role="status">{simulation.error}</p>}
          </details>
        </aside>
        <aside className="w2-logic-preview-rail" aria-label="Collapsed canvas preview" hidden={!preview.collapsed}>
          <button type="button" ref={expandToggle} aria-label="Expand Preview" aria-expanded={!preview.collapsed} aria-controls={previewId} onClick={() => togglePreview(false)}>
            <PanelRightOpen size={18} aria-hidden /><span>Preview</span>
          </button>
        </aside>
      </div>
    </Dialog.Popup></Dialog.Portal>
  </Dialog.Root>;
}
