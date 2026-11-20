import type { CompositionDocument } from '../../shared/composition/schema';
import { authoredNodes, fieldPointer } from '../logic-fields/registry';
import { documentEdit, type EditReferences } from './documentEdit';
import type { EditorPath } from '../../composition-editor';
import type { GraphSourceMap, LogicGraph } from '../../shared/composition/graph';
import { canonicalOfBounded } from '../../shared/composition/json';
import { replaceAt, valueAt } from '../../composition-editor';

const copiedFrom = new WeakMap<object, object>();

/** Provenance is editor-local and never serialized into a document or clipboard. */
export function copySubtree<T>(value: T): T {
  const copy = structuredClone(value);
  const mark = (from: unknown, to: unknown) => {
    if (!from || !to || typeof from !== 'object' || typeof to !== 'object') return;
    copiedFrom.set(to, from);
    for (const [key, child] of Object.entries(from)) mark(child, Reflect.get(to, key));
  };
  mark(value, copy);
  return copy;
}

function retainedObjects(before: unknown, after: unknown, base: EditorPath): Map<string, readonly string[]> {
  const previous = new Map<object, string[]>(), relocated = new Map<string, string[]>();
  const walk = (value: unknown, path: EditorPath, visit: (value: object, pointer: string) => void) => {
    if (!value || typeof value !== 'object') return;
    visit(value, fieldPointer(path));
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key], visit);
  };
  walk(before, base, (value, pointer) => previous.set(value, [...previous.get(value) ?? [], pointer]));
  walk(after, base, (value, pointer) => {
    let origin: object | undefined = value;
    while (origin && !previous.has(origin)) origin = copiedFrom.get(origin);
    const origins = origin ? previous.get(origin) ?? [] : [];
    if (origins.length === 1) relocated.set(origins[0], [...relocated.get(origins[0]) ?? [], pointer]);
  });
  return relocated;
}

export function rebuildField(document: CompositionDocument, path: EditorPath, value: unknown): CompositionDocument {
  const next = replaceAt(document, path, value);
  return documentEdit(document, next, { relocated: retainedObjects(valueAt(document, path), value, path) });
}

export interface CanvasProvenance { readonly graph: LogicGraph; readonly sourceMap: GraphSourceMap }

function emissions(sourceMap: GraphSourceMap) {
  const nodes = new Map<string, Set<string>>();
  for (const location of sourceMap) {
    if (location.stage === 'expanded' || location.portId !== 'value') continue;
    const key = `${canonicalOfBounded(location.anchor)}:${location.nodeId}`;
    const pointers = nodes.get(key) ?? new Set<string>();
    pointers.add(location.pointer); nodes.set(key, pointers);
  }
  return new Map([...nodes].map(([key, pointers]) => [key, [...pointers].filter(pointer => {
    if (pointer && pointers.has('')) return false;
    for (let at = pointer.lastIndexOf('/'); at > 0; at = pointer.lastIndexOf('/', at - 1)) if (pointers.has(pointer.slice(0, at))) return false;
    return true;
  })]));
}

/** Lowering's stable block IDs distinguish identical uses and describe fan-out, re-parenting and deletion. */
export function canvasReferences(paths: readonly EditorPath[], before: CanvasProvenance, after: CanvasProvenance): EditReferences {
  const previous = emissions(before.sourceMap), following = emissions(after.sourceMap);
  const relocated = new Map<string, string[]>();
  before.graph.roots.forEach((root, index) => {
    const anchor = canonicalOfBounded(root.anchor), base = fieldPointer(paths[index]);
    for (const node of before.graph.nodes) {
      const key = `${anchor}:${node.id}`;
      for (const origin of previous.get(key) ?? []) {
        const from = `${base}${origin}`;
        relocated.set(from, [...relocated.get(from) ?? [], ...(following.get(key) ?? []).map(pointer => `${base}${pointer}`)]);
      }
    }
  });
  return { relocated };
}

/** Structural operations declare their copies/rebuilds; retained composition IDs supply the other relocations. */
export function editSubtrees(before: CompositionDocument, after: CompositionDocument, references: EditReferences = {}): CompositionDocument {
  if (before === after || !before.logicUseBindings?.length && !before.componentLibrary?.some(entry => entry.bindings?.length) && !before.studioCanvas) return after;
  const following = new Map(authoredNodes(after).map(location => [location.identity, location.path]));
  const relocated: Map<string, readonly string[]> = new Map(authoredNodes(before).flatMap(location => {
    const path = following.get(location.identity);
    return path ? [[fieldPointer(location.path), [fieldPointer(path)]] as const] : [];
  }));
  for (const [from, to] of retainedObjects(before, after, [])) relocated.set(from, to);
  for (const [from, to] of references.relocated ?? []) relocated.set(from, to);
  return documentEdit(before, after, { ...references, relocated });
}
