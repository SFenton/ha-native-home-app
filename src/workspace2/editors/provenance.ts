import type { CompositionDocument } from '../../shared/composition/schema';
import { authoredNodes, fieldPointer } from '../logic-fields/registry';
import { documentEdit, walkableDocument, type EditReferences } from './documentEdit';
import type { EditorPath } from '../../composition-editor';
import type { GraphSourceMap, LogicGraph } from '../../shared/composition/graph';
import { canonicalOfBounded } from '../../shared/composition/json';
import { changeFieldVariant, replaceAt, valueAt, type SchemaField } from '../../composition-editor';
import type { Json } from '../../shared/types';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import { encodeStudioCanvas, readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { CompositionValidationError } from '../../shared/composition/json';
import type { LogicAnchor } from '../../shared/composition/graph/types';

const copiedFrom = new WeakMap<object, object>();
const rebuiltOrigins = new WeakMap<object, object>();

export function rebuiltFrom<T extends object>(before: unknown, after: T): T {
  if (before && typeof before === 'object') rebuiltOrigins.set(after, before);
  return after;
}

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

function retainedObjects(before: unknown, after: unknown, base: EditorPath, fields: Map<string, readonly string[]>): Map<string, readonly string[]> {
  const previous = new Map<object, string[]>(), relocated = new Map<string, string[]>();
  const walk = (value: unknown, path: EditorPath, visit: (value: object, pointer: string) => void) => {
    if (!value || typeof value !== 'object') return;
    visit(value, fieldPointer(path));
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key], visit);
  };
  walk(before, base, (value, pointer) => previous.set(value, [...previous.get(value) ?? [], pointer]));
  walk(after, base, (value, pointer) => {
    const rebuilt = rebuiltOrigins.get(value), containers = rebuilt && previous.get(rebuilt);
    if (containers?.length === 1) fields.set(containers[0], [...fields.get(containers[0]) ?? [], pointer]);
    let origin: object | undefined = value;
    while (origin && !previous.has(origin)) origin = copiedFrom.get(origin);
    const origins = origin ? previous.get(origin) ?? [] : [];
    if (origins.length === 1) relocated.set(origins[0], [...relocated.get(origins[0]) ?? [], pointer]);
  });
  return relocated;
}

export function rebuildField(document: CompositionDocument, path: EditorPath, value: unknown, extra: Pick<EditReferences, 'relocated' | 'discardLayouts'> = {}): CompositionDocument {
  const next = replaceAt(document, path, value);
  const fields = new Map<string, readonly string[]>();
  const relocated = retainedObjects(valueAt(document, path), value, path, fields);
  for (let depth = 0; depth <= path.length; depth++) {
    const ancestor = path.slice(0, depth), pointer = fieldPointer(ancestor);
    fields.set(pointer, [pointer]);
    if (depth === path.length) continue;
    for (const key of Object.keys(valueAt(document, ancestor) as object)) {
      if (key === String(path[depth])) continue;
      const sibling = fieldPointer([...ancestor, key]);
      relocated.set(sibling, [sibling]);
    }
  }
  for (const [from, to] of extra.relocated ?? []) relocated.set(from, [...to]);
  return documentEdit(document, next, {
    relocated, fields, deleted: [path], ...(extra.discardLayouts ? { discardLayouts: extra.discardLayouts } : {}),
  });
}

/** What `changeFieldVariant` copies from the old value into the new one, unchanged and at the same key. */
const keptAcrossTypes = ['id', 'title', 'label', 'icon', 'layout'] as const;
const linkCount = (document: CompositionDocument) => (document.logicUseBindings?.length ?? 0)
  + (document.componentLibrary ?? []).reduce((count, entry) => count + (entry.bindings?.length ?? 0), 0);
const layoutCount = (document: CompositionDocument) => {
  const stored = document.studioCanvas === undefined ? undefined : studioCanvasMetadataSchema.safeParse(document.studioCanvas);
  return stored?.success ? stored.data.canvases.reduce((count, canvas) => count + canvas.roots.length, 0) : 0;
};

/**
 * A field's type change (the variant picker) as a declared edit. The old value is rebuilt as the new type: whatever lived
 * under it is declared deleted, so an automatic binding or component parameter binding into it is removed, and every saved
 * canvas layout rooted inside it is discarded. A binding is kept only when it is unambiguous: its target sits under a key
 * the new type copies verbatim from the old one (`id`, `title`, `label`, `icon`, `layout`), so the same value stays at the
 * same pointer. Every other link is untouched. `bindings` and `layouts` say what the change removes (both 0 when nothing
 * linked is lost, so nothing needs asking); `document` comes back unchanged when the boundary refuses.
 */
export function changeFieldType(document: CompositionDocument, path: EditorPath, schema: SchemaField, key: string): { document: CompositionDocument; bindings: number; layouts: number } {
  const previous = valueAt(document, path) as Json, value = changeFieldVariant(schema, previous, document, key);
  const kept = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)
    ? keptAcrossTypes.filter(field => Object.hasOwn(value, field) && Object.hasOwn(previous, field)) : [];
  const relocated = new Map(kept.map(field => { const pointer = fieldPointer([...path, field]); return [pointer, [pointer]] as const; }));
  const next = rebuildField(document, path, value, { relocated, discardLayouts: [path] });
  return { document: next, bindings: next === document ? 0 : linkCount(document) - linkCount(next), layouts: next === document ? 0 : layoutCount(document) - layoutCount(next) };
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
  return { relocated, fields: new Map(paths.flatMap(path => path.map((_, depth) => {
    const pointer = fieldPointer(path.slice(0, depth + 1));
    return [pointer, [pointer]] as const;
  }))) };
}

/** Structural operations declare their copies/rebuilds; retained composition IDs supply the other relocations. */
export function editSubtrees(before: CompositionDocument, after: CompositionDocument, references: EditReferences = {}): CompositionDocument {
  if (before === after) return after;
  // A document the authored walk cannot take is the boundary's to decide (it refuses where its own reads cannot take the
  // shape), without the references the walk would derive.
  if (!walkableDocument(before) || !walkableDocument(after)) return documentEdit(before, after, references);
  if (!before.logicUseBindings?.length && !before.componentLibrary?.some(entry => entry.bindings?.length) && !before.studioCanvas) return documentEdit(before, after, references);
  const following = new Map(authoredNodes(after).map(location => [location.identity, location.path]));
  const relocated: Map<string, readonly string[]> = new Map(authoredNodes(before).flatMap(location => {
    const path = following.get(location.identity);
    return path ? [[fieldPointer(location.path), [fieldPointer(path)]] as const] : [];
  }));
  const fields = new Map<string, readonly string[]>();
  for (const [from, to] of retainedObjects(before, after, [], fields)) relocated.set(from, to);
  for (const [from, to] of references.fields ?? []) fields.set(from, to);
  for (const [from, to] of references.relocated ?? []) relocated.set(from, to);
  return documentEdit(before, after, { ...references, relocated, fields });
}

/** The document without its links: automatic bindings, component parameter bindings and saved canvas layout. */
function withoutLinks(document: CompositionDocument): CompositionDocument {
  const { logicUseBindings: _bindings, studioCanvas: _layout, ...rest } = document;
  return (document.componentLibrary ? { ...rest, componentLibrary: document.componentLibrary.map(({ bindings: _parameters, ...entry }) => entry) } : rest) as CompositionDocument;
}

/**
 * Replaces the whole document (Import, Edit as JSON) as one validated edit. Nothing of the current document is retained, so
 * every one of its links is declared deleted (the whole document, `deleted: [[]]`); the replacement's own links are then
 * added as authored, and the boundary checks them whole (bindings resolve, component parameters find their fields, the saved
 * layout fits). Returns `before` (after the boundary's notice) when the replacement's links do not hold; never a repaired copy.
 */
export function replaceDocument(before: CompositionDocument, after: CompositionDocument): CompositionDocument {
  if (before === after) return after;
  const unlinked = withoutLinks(after);
  const cleared = documentEdit(before, unlinked, { deleted: [[]] });
  if (cleared === before) return before;
  const linked = documentEdit(cleared, after);
  return linked === cleared ? before : linked;
}

/**
 * Moves the saved canvas roots of a logic template's field from one field prefix to another: the same value seen at another
 * place, such as a template body inside its editor-only slot view (`/body/value`) and canonically (`/body`). Origins are
 * anchor-relative, so every node, position and group membership is carried as is; only the roots' anchors (and the IDs
 * derived from them) change. Other canvases are kept as stored. Throws when the moved layout does not fit the document.
 */
export function retargetLogicLayout(document: CompositionDocument, logicId: string, from: string, to: string): CompositionDocument {
  const layout = readStudioCanvas(document);
  if (!layout.present || from === to) return document;
  const parsed = studioCanvasMetadataSchema.safeParse(layout.raw);
  if (!parsed.success) return document;
  const stored = parsed.data;
  const moves = (anchor: LogicAnchor) => anchor.kind === 'logic' && anchor.id === logicId && (anchor.field === from || anchor.field.startsWith(`${from}/`));
  const moved = stored.canvases.filter(canvas => canvas.roots.some(root => moves(root.anchor)));
  if (!moved.length) return document;
  const order = moved.map(canvas => canvas.roots.map(root => canvas.nodes.filter(node => node.rootId === root.id)));
  const target = (anchor: LogicAnchor) => moves(anchor) ? { ...anchor, field: `${to}${anchor.field.slice(from.length)}` } as LogicAnchor : anchor;
  // A canvas the layout save named after its roots' anchors (`saveCanvasLayout`) is renamed with them, so the move is its own inverse.
  const named = (canvas: typeof moved[number]) => canvas.id === canonicalOfBounded(canvas.roots.map(root => root.anchor)) ? canonicalOfBounded(canvas.roots.map(root => target(root.anchor))) : canvas.id;
  const encoded = encodeStudioCanvas(document, moved.map((canvas, index) => ({
    id: named(canvas), ...(canvas.viewport ? { viewport: canvas.viewport } : {}),
    roots: canvas.roots.map((root, at) => ({
      anchor: target(root.anchor),
      nodes: order[index][at].map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y })),
    })),
  })));
  const canvases = new Map(moved.map((canvas, index) => {
    const ids = new Map(order[index].flat().map((node, at) => [node.id, encoded.canvases[index].nodes[at].id]));
    const groups = canvas.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.map(id => ids.get(id)!) }));
    return [canvas, { ...encoded.canvases[index], ...(groups ? { groups } : {}) }] as const;
  }));
  const next = { ...document, studioCanvas: { ...stored, canvases: stored.canvases.map(canvas => canvases.get(canvas) ?? canvas) } };
  if (readStudioCanvas(next).warnings.length) throw new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  return next;
}
