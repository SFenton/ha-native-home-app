import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ApiError, request } from '../../api';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../../shared/composition/compiler';
import { canonicalOfBounded } from '../../shared/composition/json';
import { lift, projectGraph, type CanvasHost, type CanvasLens, type CanvasSnapshot, type CanvasWriteResult, type GraphSourceMap, type LogicGraph } from '../../shared/composition/graph';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import { sameJson } from '../../sameJson';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { useDraftDocument, type Draft } from '../editors/draft';
import { documentEdit } from '../editors/documentEdit';
import { canvasReferences, editSubtrees, editWithin, retargetLogicLayout, type CanvasProvenance, type ScopedEdit } from '../editors/provenance';
import type { EditReferences } from '../editors/documentEdit';
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
import { rebaseCanvasLayout, saveCanvasLayout } from './layout';
import { canvasPortObservations } from './observations';
import { RetireWorkspaceFlows } from './live';
import { previewGraph, templateUses } from './lenses';
import { LensChooser } from './LensChooser';
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

/**
 * A template body's editor-only slot view (`operandSlot`): where its operand sits. Under an `expr` wrapper that is the
 * wrapper's `value`; a read or a text slot is the operand itself.
 */
export function slotBase(document: CompositionDocument, path: EditorPath): EditorPath {
  return (valueAt(document, path) as { type?: string } | undefined)?.type === 'expr' ? [...path, 'value'] : path;
}
const ownerField = (path: EditorPath) => fieldPointer(path.slice(2));
const logicIdAt = (document: CompositionDocument, path: EditorPath) => document.logicLibrary?.[Number(path[1])]?.id;
/** A layout that cannot move (it does not fit either view) stays as stored; the canvas then reports it can't be used. */
function moveLayout(document: CompositionDocument, path: EditorPath, from: EditorPath, to: EditorPath): CompositionDocument {
  const id = logicIdAt(document, path);
  try { return id === undefined ? document : retargetLogicLayout(document, id, ownerField(from), ownerField(to)); } catch { return document; }
}
/**
 * The saved roots over a value holding the body (a document root at the whole document, or at an ancestor of the body: its
 * fingerprint reads the body) rebased from `original` to `moved`, as the boundary rebases them for any other edit: each
 * node stays at its origins, re-anchored. A whole-document lift sees a slot view's wrapper as one value, so the body's
 * own nodes inside it have no place there and are left out of the view's copy; the template's document keeps them, since
 * Done is rebased from that document (`editWithin`). Every other root is kept as `moved` holds it. A layout that cannot be
 * rebased stays as stored; the canvas then reports it can't be used.
 */
function rebaseCovering(original: CompositionDocument, moved: CompositionDocument, path: EditorPath): CompositionDocument {
  const stored = studioCanvasMetadataSchema.safeParse(moved.studioCanvas), body = fieldPointer(path);
  if (!stored.success) return moved;
  const affected = new Set(stored.data.canvases.flatMap(canvas => canvas.roots.filter(root => root.anchor.kind === 'document'
    && (body === root.anchor.field || body.startsWith(`${root.anchor.field}/`))).map(root => root.id)));
  if (!affected.size) return moved;
  const locate = (pointer: string): EditorPath[] => { const at = pointerPath(pointer); return valueAt(moved, at) === undefined ? [] : [at]; };
  const refuse = (): never => { throw new Error('The saved layout does not fit the slot view.'); };
  try {
    return rebaseCanvasLayout({ ...original, studioCanvas: moved.studioCanvas }, moved, locate,
      { affected, stored: stored.data, usable: true, deleted: pointer => pointer.startsWith(`${body}/`), refuse });
  } catch { return moved; }
}
/** The slot view a pushed value editor edits a template body in, with the body's saved canvas layout anchored where the operand now sits. */
export function slotBodyView(document: CompositionDocument, path: EditorPath, body: Operand): CompositionDocument {
  const view = replaceAt(document, path, operandSlot(body)), base = slotBase(view, path);
  return rebaseCovering(document, moveLayout(view, path, path, base), path);
}
/** The canonical document behind a slot view: the template body in its own place, its saved canvas layout anchored there. */
export function canonicalBody(view: CompositionDocument, path: EditorPath): CompositionDocument {
  const body = slotOperand(valueAt(view, path) as { type: string });
  if (!body) throw new Error('The template body must have a value.');
  const base = slotBase(view, path);
  return rebaseCovering(view, moveLayout(replaceAt(view, path, body), path, base, path), path);
}

/**
 * Done of a value editor over a template body, as a declared edit of `document`: the slot view handed back as the canonical
 * body. The body field is rebuilt in place. Its saved canvas layout comes from the editor, which already checked each edit,
 * so the body's roots are the layout this edit writes; canvas nodes (or roots) of the body the editor no longer holds are
 * declared deleted with their origins. These declarations speak for the body and its layout only (`editWithin`): anything
 * else the view changed is an ordinary edit, which keeps every other link and layout exactly as it was or is refused.
 */
export function bodyFromSlotView(document: CompositionDocument, view: CompositionDocument, path: EditorPath): CompositionDocument {
  const candidate = canonicalBody(view, path), body = fieldPointer(path), deleted: EditorPath[] = [];
  const previous = studioCanvasMetadataSchema.safeParse(document.studioCanvas), following = studioCanvasMetadataSchema.safeParse(candidate.studioCanvas);
  if (previous.success && !sameJson(document.studioCanvas, candidate.studioCanvas)) for (const canvas of previous.data.canvases) for (const root of canvas.roots) {
    const target = resolveLogicAnchor(document, root.anchor)?.pointer;
    if (target === undefined || target !== body && !target.startsWith(`${body}/`)) continue;
    const saved = following.success ? following.data.canvases.find(next => next.id === canvas.id) : undefined;
    if (!saved?.roots.some(next => next.id === root.id)) { deleted.push(pointerPath(target)); continue; }
    for (const node of canvas.nodes) if (node.rootId === root.id && !saved.nodes.some(next => next.id === node.id))
      for (const origin of node.origins) deleted.push([...pointerPath(target), ...pointerPath(origin)]);
  }
  // A document root over the body (the whole document, say) is no editor's: the boundary rebases it, following each node by
  // identity. Its nodes inside the body that the edit no longer holds by identity have nowhere to go, so their places inside
  // the body are declared gone, as for the body's own canvases; never one that holds or is held by a linked use.
  const uses = (document.logicUseBindings ?? []).flatMap(binding => resolveLogicAnchor(document, binding.use)?.pointer ?? []);
  const linked = (pointer: string) => uses.some(use => use === pointer || use.startsWith(`${pointer}/`) || pointer.startsWith(`${use}/`));
  if (previous.success) for (const canvas of previous.data.canvases) for (const root of canvas.roots) {
    if (root.anchor.kind !== 'document' || body !== root.anchor.field && !body.startsWith(`${root.anchor.field}/`)) continue;
    for (const node of canvas.nodes) if (node.rootId === root.id) for (const origin of node.origins) {
      const pointer = `${root.anchor.field}${origin}`;
      if (pointer.startsWith(`${body}/`) && !linked(pointer)) deleted.push(pointerPath(pointer));
    }
  }
  return editWithin(document, { candidate, scope: [path], retained: true, references: { fields: new Map([[body, [body]]]), layout: [path], ...(deleted.length ? { deleted } : {}) } });
}

/**
 * The source map of a canvas opened to combine the field at `at` (relative to the canvas root) with a second check: both
 * copies of the field (`<at>/of/0`, `<at>/of/1`) map back to the field as authored, the combining block itself (`<at>`)
 * maps nowhere because the document does not hold it yet, and every location outside the field is kept as lifted.
 */
export function combinedSourceMap(sourceMap: GraphSourceMap, at: string): GraphSourceMap {
  const copy = new RegExp(`^${at.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/of/[01](?=/|$)`);
  return sourceMap.flatMap(location => copy.test(location.pointer) ? [{ ...location, pointer: location.pointer.replace(copy, at) }]
    : location.pointer === at || location.pointer.startsWith(`${at}/`) ? [] : [location]);
}

/**
 * A canvas Apply through a value editor's slot view as a scoped edit of the slot view's document `inner`. `writes` are the
 * canonical places the canvas replaces (as `before`'s anchors resolve). One inside the template body is made where the
 * slot view holds the operand (`logicLibrary/<i>/body`, or its `value` under an `expr` wrapper; a read or a text slot
 * stays a slot, wrapping the new operand when it needs one), and the canvas provenance is written for that place. The edit
 * speaks for the places it writes only; `placed` is where each write's operand now sits, for the saved layout.
 */
export function slotApplyEdit(inner: CompositionDocument, slotPath: EditorPath, kind: LogicFieldKind, writes: readonly { path: EditorPath; ast: Json }[],
  generated: { readonly generatedSources: readonly unknown[]; readonly generatedLibrary: readonly unknown[] }, previous: CanvasProvenance, provenance: CanvasProvenance): ScopedEdit & { placed: EditorPath[] } {
  const slot = fieldPointer(slotPath), inside = (path: EditorPath) => fieldPointer(path) === slot || fieldPointer(path).startsWith(`${slot}/`);
  let next = inner;
  const bases: EditorPath[] = [], placed: EditorPath[] = [], scope: EditorPath[] = [];
  for (const { path, ast } of writes) {
    if (!inside(path)) { bases.push(path); placed.push(path); scope.push(path); next = fieldAdapters[kind].write(next, path, ast); continue; }
    const base = [...slotBase(next, slotPath), ...path.slice(slotPath.length)];
    bases.push(base);
    if (base.length > path.length || fieldPointer(path) !== slot) { placed.push(base); scope.push(base); next = fieldAdapters[kind].write(next, base, ast); continue; }
    next = replaceAt(next, slotPath, operandSlot(ast as unknown as Operand, valueAt(next, slotPath)));
    placed.push(slotBase(next, slotPath)); scope.push(slotPath);
  }
  if (generated.generatedSources.length) next = { ...next, dataSources: [...next.dataSources, ...generated.generatedSources] } as CompositionDocument;
  if (generated.generatedLibrary.length) next = { ...next, logicLibrary: [...next.logicLibrary ?? [], ...generated.generatedLibrary] } as CompositionDocument;
  let references = canvasReferences(bases, previous, provenance);
  bases.forEach((base, index) => { references = rebased(references, base, placed[index]); });
  return { candidate: next, scope, references, retained: true, placed };
}

/** Canonical views over slot-view drafts: what each one reads, so a canvas Apply can write where the slot view holds the body. */
const slotViews = new WeakMap<Draft, { readonly draft: Draft; readonly path: EditorPath }>();

/** The value editor uses a slot view; the canvas must see the real library body. */
export function operandBodyDraft(draft: Draft, path: EditorPath): Draft {
  let view: CompositionDocument | undefined, canonical: CompositionDocument;
  const read = () => {
    const current = draft.get();
    if (current !== view) { view = current; canonical = canonicalBody(current, path); }
    return canonical;
  };
  const body: Draft = {
    ...draft,
    get: read,
    set(next, typing) {
      const current = draft.get(), seen = read();
      const slotted = replaceAt(next, path, operandSlot(valueAt(next, path) as Operand, valueAt(current, path)));
      // An unchanged layout is the slot view's own; a changed one is handed on as written, for the boundary to judge.
      if (next.studioCanvas !== seen.studioCanvas || slotted.studioCanvas === current.studioCanvas) { draft.set(slotted, typing); return; }
      const { studioCanvas: _seen, ...semantic } = slotted;
      draft.set((current.studioCanvas === undefined ? semantic : { ...semantic, studioCanvas: current.studioCanvas }) as CompositionDocument, typing);
    },
  };
  slotViews.set(body, { draft, path });
  return body;
}

/** `references`, written for the operand at `from`, for the same operand placed at `to` (a slot view's wrapper that changed shape). */
function rebased(references: EditReferences, from: EditorPath, to: EditorPath): EditReferences {
  const old = fieldPointer(from), next = fieldPointer(to);
  if (old === next) return references;
  const move = (pointer: string) => pointer === old || pointer.startsWith(`${old}/`) ? `${next}${pointer.slice(old.length)}` : pointer;
  return { ...references,
    relocated: new Map([...references.relocated ?? []].map(([pointer, targets]) => [pointer, targets.map(move)])),
    fields: new Map([...references.fields ?? [], [old, [next]], [next, [next]]]),
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
      const sourceMap = field.combine ? combinedSourceMap(lifted.sourceMap, fieldPointer(field.path.slice(scoped.path.length))) : lifted.sourceMap;
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
function CanvasSession({ field, ws, theme, onClose }: { field: OpenField; ws: Workspace2; theme: DerivedTheme; onClose: () => void }) {
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
    const slot = slotViews.get(field.draft);
    if (slot) return applyThroughSlot(transaction, layout, before, slot);
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
  /**
   * Apply for a template body seen through a value editor's slot view. The canvas reads the body canonically, but the
   * draft holds the slot view, so the edit is made where the slot view holds the operand (`logicLibrary/<i>/body`, or its
   * `value` under an `expr` wrapper) and its provenance and saved layout are written for that place. It reports applied
   * only when the slot view's draft took exactly this edit.
   */
  async function applyThroughSlot(transaction: Parameters<CanvasHost['apply']>[0], layout: CanvasLayoutHandoff | undefined, before: CompositionDocument,
    slot: { readonly draft: Draft; readonly path: EditorPath }): Promise<CanvasWriteResult> {
    const inner = slot.draft.get(), writes: { path: EditorPath; ast: Json }[] = [], paths: EditorPath[] = [];
    for (const replacement of transaction.replacements) {
      const resolved = resolveLogicAnchor(before, appliedAnchors.current.get(canonicalOfBounded(replacement.anchor)) ?? replacement.anchor);
      if (!resolved) return invalid('The logic owner moved or was removed. Local canvas edits have been retained.');
      const path = pointerPath(resolved.pointer); paths.push(path); writes.push({ path, ast: replacement.ast as Json });
    }
    const provenance = layout ?? { graph: workingRef.current, sourceMap: projectGraph(workingRef.current).sourceMap };
    const edit = slotApplyEdit(inner, slot.path, field.kind, writes, transaction, appliedProvenance.current, provenance), placed = edit.placed;
    let next = editWithin(inner, edit);
    if (next === inner && edit.candidate !== inner) return invalid("This change can't keep its linked values, so it wasn't applied.");
    if (layout) next = saveCanvasLayout(next, transaction.replacements, layout, { document: inner, paths: placed });
    const canonical = canonicalBody(next, slot.path);
    compileCompositionDocument(canonical);
    await request('/native/api/draft/prepare', { method: 'POST', body: JSON.stringify({ document: canonical }) });
    if (slot.draft.get() !== inner) return { status: 'conflict', remote: snapshot() };
    slot.draft.set(next);
    if (canonicalOfBounded(slot.draft.get()) !== canonicalOfBounded(next)) return invalid("This change can't keep its linked values, so it wasn't applied.");
    appliedProvenance.current = provenance;
    transaction.replacements.forEach((replacement, index) => appliedAnchors.current.set(canonicalOfBounded(replacement.anchor), fieldAnchor(field.draft.get(), paths[index])));
    return { status: 'applied', snapshot: snapshot() };
  }
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
      <div className="w2-logic-work">
        <FlowCanvas host={{ ...host, observations }} graph={field.graph} title={field.label} theme={theme} onClose={close} returnFocus={field.returnFocus}
          selectedNodeId={selected} onSelectionChange={setSelected} onGraphChange={setWorking}
          onApply={(transaction, layout) => apply(transaction, layout)}/>
        <aside className="w2-logic-simulation" aria-label="Canvas preview">
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
          {conflict && <p role="alert">The saved revision changed. Local canvas edits are retained; close the canvas to compare revisions in the workspace.</p>}
          {warnings.map(warning => <p role="alert" key={warning.pointer}>{warning.message}</p>)}
          {warnings.length > 0 && <button type="button" onClick={() => {
            const before = field.draft.get(), { studioCanvas: _removed, ...rest } = before;
            field.draft.set(documentEdit(before, rest as CompositionDocument, { deleted: [['studioCanvas']] }));
          }}>Reset saved layout</button>}
        </aside>
      </div>
    </Dialog.Popup></Dialog.Portal>
  </Dialog.Root>;
}
