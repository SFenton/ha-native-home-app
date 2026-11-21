import type { CompositionDocument } from '../../shared/composition/schema';
import { authoredNodes, fieldPointer } from '../logic-fields/registry';
import { documentEdit, LINKED_EDIT_REFUSAL, walkableDocument, type EditReferences } from './documentEdit';
import { toastManager } from '../toasts';
import { sameJson } from '../../sameJson';
import type { EditorPath } from '../../composition-editor';
import type { GraphSourceMap, LogicGraph } from '../../shared/composition/graph';
import { canonicalOfBounded } from '../../shared/composition/json';
import { changeFieldVariant, replaceAt, valueAt, type SchemaField } from '../../composition-editor';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { ownedSources } from '../../shared/composition/components';
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

/** What `rebuildField` declares for `value` rebuilt at `path`: the field deleted, its ancestors rebuilt in place, their other keys and the objects it keeps relocated. */
function rebuildReferences(document: CompositionDocument, path: EditorPath, value: unknown, extra: Pick<EditReferences, 'relocated' | 'discardLayouts'> = {}): EditReferences {
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
  return { relocated, fields, deleted: [path], ...(extra.discardLayouts ? { discardLayouts: extra.discardLayouts } : {}) };
}

export function rebuildField(document: CompositionDocument, path: EditorPath, value: unknown, extra: Pick<EditReferences, 'relocated' | 'discardLayouts'> = {}): CompositionDocument {
  return documentEdit(document, replaceAt(document, path, value), rebuildReferences(document, path, value, extra));
}

/**
 * A declared edit confined to `scope`: what an operation changes (`candidate`), the subtrees it changes (`scope`, plus the
 * saved canvas layout when `references.layout` is given) and what it declares about them. `retained` says whether
 * retained identities are declared too (as `editSubtrees` does) or only `references`.
 */
export interface ScopedEdit {
  readonly candidate: CompositionDocument;
  readonly scope: readonly EditorPath[];
  readonly references: EditReferences;
  readonly retained: boolean;
}

/**
 * Applies a `ScopedEdit` in two steps, so its declarations speak for its scope only.
 *
 * 1. Whatever else the candidate changes is an ordinary, undeclared edit: the candidate with every scoped subtree (and a
 *    declared layout) put back as `before` holds it. The boundary keeps or refuses that on its own, and may rewrite links
 *    as it does (a binding that follows its use, say).
 * 2. The operation's own change is then made on that accepted result, not on the stale candidate: each scoped subtree is
 *    taken from the candidate and grafted onto step 1's document, whose bindings and component bindings it keeps. A
 *    declared layout is merged canvas by canvas (step 1's canvases, with the ones the operation changed). The change is
 *    declared with the operation's references inside its scope only, and with the identities it retains there.
 *
 * So the combined edit is exactly the outside edit followed by the operation. Returns `before` when either step, or a
 * layout both changed differently, is refused.
 */
export function editWithin(before: CompositionDocument, edit: ScopedEdit): CompositionDocument {
  const { candidate, scope, references, retained } = edit;
  if (before === candidate) return candidate;
  const scoped = scope.map(path => fieldPointer(path));
  const within = (pointer: string) => scoped.some(base => pointer === base || pointer.startsWith(`${base}/`));
  // The operation was made at these paths of `before`; in the candidate they must still name the same owners.
  if (!scope.every(path => sameOwners(path, scope, before, candidate))) return refused(before);
  // A scope the candidate or `before` does not hold cannot be put back: the whole candidate is then an ordinary edit.
  if (scope.some(path => valueAt(before, path) === undefined || valueAt(candidate, path) === undefined)) return documentEdit(before, candidate);
  /** The candidate with each scoped subtree put back as `before` holds it; wherever nothing else changed, `before`'s own object. */
  const restore = (from: unknown, to: unknown, path: EditorPath): unknown => {
    const pointer = fieldPointer(path);
    if (scoped.includes(pointer)) return from;
    if (from === to || !scoped.some(base => base.startsWith(`${pointer}/`)) || !from || !to || typeof from !== 'object' || typeof to !== 'object' || Array.isArray(from) !== Array.isArray(to)) return to;
    const keys = Object.keys(to), held = from as Record<string, unknown>;
    const children = keys.map(key => restore(held[key], (to as Record<string, unknown>)[key], [...path, Array.isArray(to) ? Number(key) : key]));
    if (keys.length === Object.keys(held).length && keys.every((key, at) => Object.hasOwn(held, key) && children[at] === held[key])) return from;
    if (Array.isArray(to)) return children;
    return Object.fromEntries(keys.map((key, at) => [key, children[at]]));
  };
  const layout = Boolean(references.layout?.length);
  let outside = restore(before, candidate, []) as CompositionDocument;
  if (layout && outside.studioCanvas !== before.studioCanvas) {
    const { studioCanvas: _layout, ...rest } = outside;
    const back = (before.studioCanvas === undefined ? rest : { ...rest, studioCanvas: before.studioCanvas }) as CompositionDocument;
    outside = Object.keys(back).length === Object.keys(before).length && Object.keys(back).every(key => Reflect.get(back, key) === Reflect.get(before, key)) ? before : back;
  }
  let from = before;
  if (outside !== before) {
    from = documentEdit(before, outside);
    if (from === before) return before;
    // Step 1 keeps every scoped subtree where it was; if one moved, the operation no longer says where it applies.
    if (scope.some(path => valueAt(from, path) !== valueAt(before, path) || !sameOwners(path, scope, before, from))) return refused(before);
  }
  let target = from;
  for (const path of [...scope].sort((left, right) => left.length - right.length)) target = replaceAt(target, path, valueAt(candidate, path));
  if (layout) {
    const merged = mergedLayout(before.studioCanvas, from.studioCanvas, candidate.studioCanvas);
    if (merged === conflict) return refused(before);
    if (merged !== target.studioCanvas) {
      const { studioCanvas: _layout, ...rest } = target;
      target = (merged === undefined ? rest : { ...rest, studioCanvas: merged }) as CompositionDocument;
    }
  }
  const relocated = new Map<string, readonly string[]>(), fields = new Map<string, readonly string[]>();
  if (retained) {
    // The identities the operation retains inside its scope: composition nodes by ID, and objects it kept.
    const following = new Map(authoredNodes(target).map(location => [location.identity, fieldPointer(location.path)]));
    for (const location of authoredNodes(from)) {
      const pointer = fieldPointer(location.path), next = following.get(location.identity);
      if (next !== undefined && within(pointer) && within(next)) relocated.set(pointer, [next]);
    }
    for (const path of scope) for (const [pointer, to] of retainedObjects(valueAt(from, path), valueAt(target, path), path, fields)) relocated.set(pointer, to);
  }
  // The graft rebuilt each scope's ancestors in place. They, and the plain values they hold beside the scope (which identity
  // cannot place under a rebuilt object), are where they were: nothing outside the scope changes in this step, and a plain
  // value has nothing under it to declare.
  for (const path of scope) for (let depth = 0; depth < path.length; depth++) {
    const ancestor = path.slice(0, depth), pointer = fieldPointer(ancestor), held = valueAt(from, ancestor);
    fields.set(pointer, [pointer]);
    if (!held || typeof held !== 'object') continue;
    for (const [key, value] of Object.entries(held)) {
      const sibling = fieldPointer([...ancestor, key]);
      if (key !== String(path[depth]) && (value === null || typeof value !== 'object') && !within(sibling)) relocated.set(sibling, [sibling]);
    }
  }
  // The operation's own fields speak for its scope only: a mapping from, or to, anywhere else is not its to declare.
  for (const [pointer, to] of references.fields ?? []) if (within(pointer) && to.every(within)) fields.set(pointer, to);
  // Likewise a relocation: from inside the scope to inside it, or it is not the operation's to declare.
  for (const [pointer, to] of references.relocated ?? []) if (within(pointer) && to.every(within)) relocated.set(pointer, to);
  const inside = (paths: readonly EditorPath[] | undefined) => paths?.filter(path => within(fieldPointer(path)));
  const deleted = inside(references.deleted), discardLayouts = inside(references.discardLayouts), layoutPaths = inside(references.layout);
  const copied = references.copied?.filter(copy => within(fieldPointer(copy.from)) && within(fieldPointer(copy.to)));
  const next = documentEdit(from, target, {
    relocated, fields,
    ...(deleted?.length ? { deleted } : {}), ...(discardLayouts?.length ? { discardLayouts } : {}),
    ...(layoutPaths?.length ? { layout: layoutPaths } : {}), ...(copied?.length ? { copied } : {}),
  });
  return next === from ? before : next;
}

/**
 * Whether `path`, one of an edit's `scope`, names the same place in `document` as in `before`: every list it goes through
 * holds, at its position, the same owner. An element with an ID (a template, a saved component, a page, a node, a source,
 * a step) must have the same ID. A list without IDs must keep its length. Its element at each scoped index (the path's own,
 * and each other scope's through this list) must be a rebuild of `before`'s element at that index: every key that leads to
 * none of the edit's scopes holds `before`'s own value (`===`), and a key that leads to one is checked the same way a level
 * down, until the scope itself, which the operation may write. Every element at another index must be one of `before`'s
 * own objects from another index, each once; those may trade places with each other (the boundary follows each by
 * identity). Equal JSON is never evidence: two equal cases swap unseen. Keys of an object name themselves. Positions alone
 * are not identity: a template prepended before the scope's own would otherwise make the scope another template's.
 */
function sameOwners(path: EditorPath, scope: readonly EditorPath[], before: CompositionDocument, document: CompositionDocument): boolean {
  const pointers = scope.map(other => fieldPointer(other)), others = scope.filter(other => other !== path).map(other => fieldPointer(other));
  const leads = (at: EditorPath) => { const pointer = fieldPointer(at); return pointers.some(other => other === pointer || other.startsWith(`${pointer}/`)); };
  /** `now` at `at` is `was` rebuilt: the same object, a scope the operation writes, or every key held as it was except those leading to a scope. */
  const rebuilt = (was: unknown, now: unknown, at: EditorPath): boolean => {
    if (was === now || pointers.includes(fieldPointer(at))) return true;
    if (!was || !now || typeof was !== 'object' || typeof now !== 'object' || Array.isArray(was) !== Array.isArray(now)) return false;
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const child = [...at, Array.isArray(was) ? Number(key) : key];
      if (leads(child)) { if (!rebuilt(Reflect.get(was, key), Reflect.get(now, key), child)) return false; }
      else if (!Object.hasOwn(was, key) || !Object.hasOwn(now, key) || Reflect.get(was, key) !== Reflect.get(now, key)) return false;
    }
    return true;
  };
  let was: unknown = before, now: unknown = document;
  for (const [depth, key] of path.entries()) {
    if (Array.isArray(was) !== Array.isArray(now)) return false;
    if (Array.isArray(was) && Array.isArray(now)) {
      const list: readonly unknown[] = now, at = Number(key), id = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? (value as { id?: unknown }).id : undefined;
      const owner = id(was[at]), base = fieldPointer(path.slice(0, depth));
      const scoped = (index: number) => others.some(other => other === `${base}/${index}` || other.startsWith(`${base}/${index}/`));
      if (typeof owner === 'string' || typeof id(list[at]) === 'string') { if (owner !== id(list[at])) return false; }
      else {
        if (was.length !== list.length) return false;
        // Each scoped index holds a rebuild of `before`'s element there, so no outside change moved an owner into it.
        // Every other element is one of `before`'s own elements from another index (each once, by identity).
        const held = new Set(was.filter((_, index) => index !== at && !scoped(index)));
        for (const [index, item] of list.entries()) {
          if (index === at || scoped(index)) { if (!rebuilt(was[index], item, [...path.slice(0, depth), index])) return false; continue; }
          if (!held.delete(item)) return false;
        }
      }
    }
    if (!was || typeof was !== 'object' || !now || typeof now !== 'object') return false;
    was = Reflect.get(was, key); now = Reflect.get(now, key);
  }
  return true;
}

const conflict = Symbol('conflict');
/** Refuses as the boundary does: its notice, and `before`. */
function refused(before: CompositionDocument): CompositionDocument {
  toastManager.add({ title: LINKED_EDIT_REFUSAL, type: 'error' });
  return before;
}
/**
 * The saved layout after an outside edit (`from`, which the boundary may have rebased) and the operation's own layout
 * change (`to`), both made from `base`: what the operation makes when it runs on `from`. Canvas by canvas, each side's
 * change is taken where only that side made it, in the operation's order (the outside edit never reorders or adds
 * canvases; the boundary only rebases or drops them). A canvas, the canvas order or the bundles both sides changed
 * differently is a conflict, which refuses rather than picks one; a key the operation removed stays removed.
 */
function mergedLayout(base: unknown, from: unknown, to: unknown): unknown {
  if (sameJson(from, base)) return to;
  if (sameJson(to, base) || sameJson(to, from)) return from;
  const parse = (value: unknown) => value === undefined ? { success: true as const, data: undefined } : studioCanvasMetadataSchema.safeParse(value);
  const [b, f, t] = [parse(base), parse(from), parse(to)];
  if (!b.success || !f.success || !t.success || !f.data || !t.data) return conflict;
  const raw = (value: unknown) => (value as { canvases: unknown[] }).canvases;
  const byId = (data: typeof t.data | undefined, value: unknown) => new Map((data?.canvases ?? []).map((canvas, at) => [canvas.id, raw(value)[at]]));
  const was = byId(b.data, base), ours = byId(f.data, from), theirs = byId(t.data, to);
  // The outside edit keeps `base`'s canvases in their order, some rebased or dropped; anything else it did, the operation cannot be placed after.
  const kept = [...was.keys()].filter(id => ours.has(id));
  if ([...ours.keys()].some(id => !was.has(id)) || !sameJson([...ours.keys()], kept)) return conflict;
  const canvases: unknown[] = [];
  for (const [id, next] of theirs) {
    const old = was.get(id), mine = ours.get(id);
    if (old === undefined) { canvases.push(next); continue; }
    // A canvas the outside edit dropped: the operation, run after it, would not have it.
    if (mine === undefined) { if (!sameJson(next, old)) return conflict; continue; }
    if (sameJson(next, old) || sameJson(mine, next)) { canvases.push(mine); continue; }
    if (!sameJson(mine, old)) return conflict;
    canvases.push(next);
  }
  // A canvas the operation removed is gone, unless the outside edit changed it too.
  for (const [id, mine] of ours) if (!theirs.has(id) && !sameJson(mine, was.get(id))) return conflict;
  const bundles = sameJson(f.data.bundles, b.data?.bundles) ? (to as { bundles?: unknown }).bundles : sameJson(t.data.bundles, b.data?.bundles) ? (from as { bundles?: unknown }).bundles : conflict;
  if (bundles === conflict) return conflict;
  const { bundles: _bundles, ...rest } = from as { bundles?: unknown };
  return { ...rest, canvases, ...(bundles === undefined ? {} : { bundles }) };
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
 * Where a component parameter binding of `entry` writes in `document`: its node's field, or for a value parameter whose
 * optional field is absent, the place under its node where that field would be; a source binding's field in that source.
 */
function componentBindingTarget(document: CompositionDocument, at: number, binding: NonNullable<NonNullable<CompositionDocument['componentLibrary']>[number]['bindings']>[number]): string | undefined {
  const entry = document.componentLibrary![at], steps = binding.field.split('/').filter(Boolean), field = fieldPointer(steps);
  if (binding.nodeId) {
    const anchor = { kind: 'component' as const, id: entry.id, nodeId: binding.nodeId, field };
    const resolved = resolveLogicAnchor(document, anchor);
    if (resolved) return resolved.pointer;
    if (entry.params?.find(param => param.name === binding.param)?.kind !== 'value') return undefined;
    const holder = resolveLogicAnchor(document, { ...anchor, field: fieldPointer(steps.slice(0, -1)) });
    return holder ? `${holder.pointer}${fieldPointer(steps.slice(-1))}` : undefined;
  }
  const source = ownedSources(entry).find(held => held.id === binding.sourceId);
  if (!source) return undefined;
  const list = entry.sources?.includes(source as never) ? 'sources' : 'flows';
  return `${fieldPointer(['componentLibrary', at, list, (entry[list] as readonly unknown[]).indexOf(source)])}${field}`;
}

/**
 * The type change of the field at `path` (see `changeFieldType`) as a scoped edit: it changes, and speaks for, that field,
 * and the component parameter bindings it removes. A binding is kept only when its target is under a key the new type copies
 * unchanged; every other binding into the field (also one whose optional value field is absent) is removed and declared
 * deleted, so the boundary never re-places it on a field the new type does not have.
 */
export function fieldTypeEdit(document: CompositionDocument, path: EditorPath, schema: SchemaField, key: string): ScopedEdit {
  const previous = valueAt(document, path) as Json, value = changeFieldVariant(schema, previous, document, key);
  const kept = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)
    ? keptAcrossTypes.filter(field => Object.hasOwn(value, field) && Object.hasOwn(previous, field)) : [];
  const relocated = new Map(kept.map(field => { const pointer = fieldPointer([...path, field]); return [pointer, [pointer]] as const; }));
  const base = fieldPointer(path), inside = (pointer: string, at: string) => pointer === at || pointer.startsWith(`${at}/`);
  const keeps = (pointer: string) => kept.some(field => inside(pointer, fieldPointer([...path, field])));
  let candidate = replaceAt(document, path, value);
  const scope: EditorPath[] = [path], deleted: EditorPath[] = [];
  for (const [at, entry] of (document.componentLibrary ?? []).entries()) {
    const list: EditorPath = ['componentLibrary', at, 'bindings'];
    if (!entry.bindings?.length || inside(fieldPointer(list), base) || inside(base, fieldPointer(list))) continue;
    const dropped = entry.bindings.flatMap((binding, index) => {
      const target = componentBindingTarget(document, at, binding);
      return target !== undefined && inside(target, base) && !keeps(target) ? [index] : [];
    });
    if (!dropped.length) continue;
    candidate = replaceAt(candidate, list, entry.bindings.filter((_, index) => !dropped.includes(index)));
    scope.push(list);
    deleted.push(...dropped.map(index => [...list, index]));
  }
  const references = rebuildReferences(document, path, value, { relocated, discardLayouts: [path] });
  return { candidate, scope, references: { ...references, deleted: [...references.deleted ?? [], ...deleted] }, retained: false };
}

/**
 * A field's type change (the variant picker) as a declared edit. The old value is rebuilt as the new type: whatever lived
 * under it is declared deleted, so an automatic binding or component parameter binding into it is removed, and every saved
 * canvas layout rooted inside it is discarded. A binding is kept only when it is unambiguous: its target sits under a key
 * the new type copies verbatim from the old one (`id`, `title`, `label`, `icon`, `layout`), so the same value stays at the
 * same pointer. A value parameter's binding to an optional field the new type does not have is removed too. Every other
 * link is untouched. `bindings` and `layouts` say what the change removes (both 0 when nothing linked is lost, so nothing
 * needs asking). `document` comes back unchanged when the boundary refuses. A type incompatibility elsewhere (a source
 * the field refers to, say) shows as compile issues, as after any other edit; Publish validates.
 */
export function changeFieldType(document: CompositionDocument, path: EditorPath, schema: SchemaField, key: string): { document: CompositionDocument; bindings: number; layouts: number } {
  const next = editWithin(document, fieldTypeEdit(document, path, schema, key));
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
  // Only the moved canvases are this move's to check: another canvas may be stale until the boundary rebases it.
  if (readStudioCanvas({ ...document, studioCanvas: { ...stored, canvases: [...canvases.values()] } }).warnings.length) throw new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  return next;
}
