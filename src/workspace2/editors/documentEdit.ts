import { valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { fieldSteps, ownedSources } from '../../shared/composition/components';
import { atPointer, resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { sameJson } from '../../sameJson';
import { usesOf } from '../data/logic/logicModel';
import { authoredNodes, fieldAnchor, fieldPointer, pointerPath, type AuthoredNode } from '../logic-fields/registry';
import { rebaseCanvasLayout, uncertifiedCanvasRoots } from '../logic-fields/layout';
import { canonicalOfBounded, CompositionValidationError } from '../../shared/composition/json';
import { toastManager } from '../toasts';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../shared/composition/studio-logic/schemas';
import type { LogicAnchor } from '../../shared/composition/graph/types';
import { changedPaths, EditDependencies } from './editDependencies';

export interface EditReferences {
  readonly relocated?: ReadonlyMap<string, readonly string[]>;
  readonly copied?: readonly { from: EditorPath; to: EditorPath }[];
  readonly deleted?: readonly EditorPath[];
  readonly fields?: ReadonlyMap<string, readonly string[]>;
  readonly discardLayouts?: readonly EditorPath[];
  readonly layout?: readonly EditorPath[];
}

export const LINKED_EDIT_REFUSAL = "This change can't keep its linked values, so it wasn't applied.";
class LinkedEditRefusal extends Error {}
const refuse = (): never => { throw new LinkedEditRefusal(LINKED_EDIT_REFUSAL); };
/**
 * Caches below are keyed only by committed revisions: a `before` the caller holds, or a result this boundary accepted.
 * Documents are immutable once committed, so their identity is a stable key (mutating one in place is outside the
 * contract). A candidate `edit` is never a key: a refused candidate may be mutated and offered again.
 */
const validated = new WeakMap<CompositionDocument, CompositionDocument>();
const inside = (pointer: string, base: string) => pointer === base || pointer.startsWith(`${base}/`);
interface ReferenceIndex {
  readonly dependencies: EditDependencies;
  readonly resolved: ReturnType<typeof resolveLogicUseBindings>['bindings'];
  readonly targets: ReadonlyMap<string, string>;
  readonly entries: ReadonlySet<string>;
  /** `before.studioCanvas` parsed once per index; an index outlives a revision only while that object is retained. */
  readonly stored?: StoredStudioCanvasMetadata;
  /**
   * Retention witnesses: for each key, the object its identity location relies on (the deepest object on the located
   * pointer's path that occurs exactly once in the revision, see `referencePaths`), mapped to the keys relying on it. While
   * a witness stays in place and occurs nowhere else, every pointer through it locates to itself; placed anywhere new, it
   * brings its keys into scope. A source binding also relies on its source object's identity inside its entry. Witnesses an
   * accepted edit rebuilds are added as the index is carried forward; stale entries only ever widen scope.
   */
  readonly evidence: WeakMap<object, string[]>;
  /** The witness pointers behind each key in `evidence`. */
  readonly holders: ReadonlyMap<string, readonly string[]>;
  /**
   * Every object of the indexed revision and of each revision the index was carried to (a superset, only ever widened).
   * An object outside it is fresh: it can occur in a later revision only where an edit placed it.
   */
  readonly members: WeakSet<object>;
  /** Keys whose witness could not be carried forward; every edit reconciles these. */
  readonly always: ReadonlySet<string>;
  /** Canvas roots a full rebase would not give back unchanged; every edit rebases these. */
  readonly uncertified: ReadonlySet<string>;
  /**
   * Known-usable layout metadata. Edits that keep this index either leave every root's reads untouched or rebase the reached
   * roots through a check that refuses unusable output, so usability carries forward. Unusable metadata is rechecked.
   */
  usable?: true;
}
const revisions = new WeakMap<CompositionDocument, ReferenceIndex>();
const rootsOf = (metadata: StoredStudioCanvasMetadata) => metadata.canvases.map(canvas => [canvas.id, canvas.roots.map(root => [root.id, root.anchor])]);
function objectPaths(value: unknown, prefix: EditorPath = []): Map<object, EditorPath[]> {
  const paths = new Map<object, EditorPath[]>();
  const visit = (value: unknown, path: EditorPath) => {
    if (value === null || typeof value !== 'object') return;
    paths.set(value, [...paths.get(value) ?? [], path]);
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(value, prefix);
  return paths;
}

type ComponentEntry = NonNullable<CompositionDocument['componentLibrary']>[number];
/**
 * `objectPaths(document)` restricted to the entry with `entry`'s ID: all a source binding's lookup keeps (it filters to
 * paths inside that entry), at the cost of the entry rather than the document.
 */
function entryObjectPaths(document: CompositionDocument, entry: Pick<ComponentEntry, 'id'>): Map<object, EditorPath[]> {
  const at = document.componentLibrary?.findIndex(old => old.id === entry.id) ?? -1;
  return at < 0 ? new Map() : objectPaths(document.componentLibrary![at], ['componentLibrary', at]);
}

/** How often each object occurs in `document`, adding each to `members`. */
function objectCounts(document: CompositionDocument, members: WeakSet<object>): Map<object, number> {
  const counts = new Map<object, number>();
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    members.add(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
  return counts;
}

const ownerLists = { page: 'pages', modal: 'modals', component: 'componentLibrary', logic: 'logicLibrary', flow: 'dataSources' } as const;

interface IndexBuild {
  readonly dependencies: EditDependencies;
  readonly before: CompositionDocument;
  /** Shared scans already observed. */
  readonly scans: Set<string>;
  /** Owner-or-node pointer by owner kind, owner ID and node ID, so a page is not rescanned for every anchor on it. */
  readonly bases: Map<string, string | undefined>;
}
const baseKey = (anchor: Exclude<LogicAnchor, { kind: 'document' }>) => JSON.stringify([anchor.kind, anchor.id, anchor.nodeId ?? null]);

/** `resolveLogicAnchor`'s owner (or node) step, memoized for one index build. */
function anchorBase(build: IndexBuild, anchor: Exclude<LogicAnchor, { kind: 'document' }>): string | undefined {
  const key = baseKey(anchor);
  if (!build.bases.has(key)) build.bases.set(key, resolveLogicAnchor(build.before, { ...anchor, field: '' })?.pointer);
  return build.bases.get(key);
}

/** `resolveLogicAnchor(before, anchor)?.pointer`, reusing the memoized owner/node step and then its final field step. */
function anchorPointer(build: IndexBuild, anchor: LogicAnchor): string | undefined {
  if (anchor.kind === 'document') return resolveLogicAnchor(build.before, anchor)?.pointer;
  const base = anchorBase(build, anchor);
  if (base === undefined) return undefined;
  return atPointer(valueAt(build.before, pointerPath(base)), anchor.field) === undefined ? undefined : `${base}${anchor.field}`;
}

/**
 * Register what `resolveLogicAnchor` reads for `anchor` against `own`. The owner-list ID scan and an owner's node-tree scan
 * are observed once per index and shared through groups; the anchor's own field path is registered directly.
 */
function watchAnchor(build: IndexBuild, anchor: LogicAnchor, own: readonly string[]): void {
  const { dependencies, before, scans } = build, keys = [...own, 'guard'];
  const path = (base: string, field: string) => {
    let at = base;
    dependencies.add(at, keys, true);
    for (const part of pointerPath(field)) { at = `${at}${fieldPointer([part])}`; dependencies.add(at, keys, true); }
    return at;
  };
  const scan = (group: string, read: (document: CompositionDocument) => unknown) => {
    if (!scans.has(group)) { scans.add(group); dependencies.observe(before, [group, 'guard'], read); }
    for (const key of own) dependencies.join(group, key);
  };
  if (anchor.kind === 'document') {
    // The fingerprint is the canonical text of the whole addressed value.
    dependencies.add('/id', keys, true); dependencies.add(path('', anchor.field), keys);
    return;
  }
  scan(`list:${ownerLists[anchor.kind]}`, document => resolveLogicAnchor(document, { kind: anchor.kind, id: '', field: '' }));
  if (anchor.nodeId !== undefined) {
    scan(`nodes:${anchor.kind}:${anchor.id}`, document => resolveLogicAnchor(document, { kind: anchor.kind, id: anchor.id, nodeId: '', field: '' }));
  }
  // The owner (or node) itself, then each step of the field below it.
  const base = anchorBase(build, anchor);
  if (base !== undefined) path(base, anchor.field);
}

/** Identity is evidence of retention; equal-looking JSON and array positions are not. */
function referencePaths(before: CompositionDocument, next: Map<object, EditorPath[]>) {
  return (pointer: string): EditorPath | undefined => {
    const path = pointerPath(pointer);
    for (let depth = path.length; depth > 0; depth--) {
      const value = valueAt(before, path.slice(0, depth));
      if (value === null || typeof value !== 'object') continue;
      const matches = next.get(value);
      if (!matches?.length) continue;
      if (matches.length !== 1) continue;
      return [...matches[0], ...path.slice(depth)];
    }
    return undefined;
  };
}

/**
 * History records only edits whose linked references survive or have an explicit relocation/deletion.
 */
export function documentEdit(before: CompositionDocument, edit: CompositionDocument, references: EditReferences = {}): CompositionDocument {
  const visited = new Set<CompositionDocument>();
  for (let parent = edit; validated.has(parent) && !visited.has(parent);) {
    visited.add(parent);
    parent = validated.get(parent)!;
    if (parent === before) return edit;
  }
  try {
    const next = applyDocumentEdit(before, edit, references);
    if (next !== before) validated.set(next, before);
    return next;
  } catch (error) {
    if (!(error instanceof LinkedEditRefusal) && !(error instanceof CompositionValidationError)) throw error;
    toastManager.add({ title: LINKED_EDIT_REFUSAL, type: 'error' });
    return before;
  }
}

function applyDocumentEdit(before: CompositionDocument, edit: CompositionDocument, references: EditReferences): CompositionDocument {
  if (before === edit || sameJson(before, edit) && !references.relocated?.size && !references.copied?.length) return edit;
  const linked = (document: CompositionDocument) => document.logicUseBindings?.length || document.componentLibrary?.some(entry => entry.bindings?.length) || document.studioCanvas;
  if (!linked(before) && !linked(edit)) return edit;
  // Per-transaction memos of the candidate: never cached beyond this call.
  let editPaths: Map<object, EditorPath[]> | undefined, editNodes: AuthoredNode[] | undefined;
  const pathsOfEdit = () => editPaths ??= objectPaths(edit);
  const locate = (pointer: string) => referencePaths(before, pathsOfEdit())(pointer);
  /** A field's anchor in the candidate; a field without one owner (duplicate IDs, say) refuses rather than throws. */
  const anchorAt = (path: EditorPath) => {
    try { return fieldAnchor(edit, path, editNodes ??= authoredNodes(edit)); } catch { return refuse(); }
  };
  const deleted = (pointer: string) => (references.deleted ?? []).some(path => inside(pointer, fieldPointer(path)))
    || [...references.relocated ?? []].some(([from, to]) => !to.length && inside(pointer, from));
  const declared = (pointer: string) => deleted(pointer)
    || [...references.relocated ?? []].some(([from]) => inside(pointer, from));
  const componentTarget = (document: CompositionDocument, entry: ComponentEntry,
    binding: NonNullable<typeof entry.bindings>[number], objects: () => Map<object, EditorPath[]>): string | undefined => {
    const field = fieldPointer(fieldSteps(binding.field));
    if (binding.nodeId) {
      const anchor = { kind: 'component' as const, id: entry.id, nodeId: binding.nodeId, field };
      const resolved = resolveLogicAnchor(document, anchor);
      if (resolved) return resolved.pointer;
      if (entry.params?.find(param => param.name === binding.param)?.kind !== 'value') return undefined;
      const steps = fieldSteps(binding.field), holder = resolveLogicAnchor(document, { ...anchor, field: fieldPointer(steps.slice(0, -1)) });
      return holder ? `${holder.pointer}${fieldPointer(steps.slice(-1))}` : undefined;
    }
    const source = ownedSources(entry).find(source => source.id === binding.sourceId);
    const base = fieldPointer(['componentLibrary', document.componentLibrary!.findIndex(old => old.id === entry.id)]);
    const paths = source && objects().get(source)?.filter(path => inside(fieldPointer(path), base));
    const pointer = paths?.length === 1 ? `${fieldPointer(paths[0])}${field}` : undefined;
    return pointer !== undefined && valueAt(document, pointerPath(pointer)) !== undefined ? pointer : undefined;
  };
  let indexed = revisions.get(before);
  if (!indexed) {
    const dependencies = new EditDependencies(), targets = new Map<string, string>();
    const evidence = new WeakMap<object, string[]>(), holders = new Map<string, string[]>(), members = new WeakSet<object>();
    const counts = objectCounts(before, members);
    /** `keys` rely on the object at `at`: anything at, above or below it, or the object placed anywhere new, reaches them. */
    const witnessAt = (at: string, keys: readonly string[]) => {
      for (const key of keys) { dependencies.add(at, key); holders.set(key, [...holders.get(key) ?? [], at]); }
      const value = valueAt(before, pointerPath(at)) as object, held = evidence.get(value);
      if (held) held.push(...keys); else evidence.set(value, [...keys]);
    };
    /**
     * `keys` identity-locate `pointer` (and pointers below it). `referencePaths` returns the deepest object on the path
     * that occurs once in the candidate; in this revision that is the deepest object occurring once here. While it stays in
     * place and is placed nowhere else, it still occurs once, so the location is unchanged. A path with no such object
     * cannot be located at all: its keys are reconciled by every edit.
     */
    const witnessed = (pointer: string | undefined, ...keys: string[]) => {
      let value: unknown = before, found: string | undefined;
      const path = pointer === undefined ? [] : pointerPath(pointer);
      for (let depth = 1; pointer !== undefined && depth <= path.length; depth++) {
        value = value !== null && typeof value === 'object' && Object.hasOwn(value, path[depth - 1]) ? Reflect.get(value, path[depth - 1]) : undefined;
        if (value === null || typeof value !== 'object') break;
        if (counts.get(value) === 1) found = fieldPointer(path.slice(0, depth));
      }
      if (found === undefined) for (const key of keys) dependencies.add('', key);
      else witnessAt(found, keys);
    };
    const build: IndexBuild = { dependencies, before, scans: new Set(), bases: new Map() };
    let stored: ReturnType<typeof studioCanvasMetadataSchema.safeParse> | undefined;
    const resolved = before.logicUseBindings?.length ? resolveLogicUseBindings(before).bindings : [];
    // Bindings array edits are scoped per element below; any of them invalidates this index's positions.
    dependencies.add('/logicUseBindings', 'guard');
    dependencies.add('/studioCanvas', 'layout');
    dependencies.add('/studioCanvas', 'guard');
    dependencies.add('/componentLibrary', 'components', true);
    resolved.forEach((binding, at) => {
      const key = `a:${at}`, reanchor = `r:${at}`, authored = before.logicUseBindings![at];
      // Also covers the argument's location: that path runs through the use's.
      witnessed(binding.usePointer, key, reanchor);
      dependencies.add(binding.sourcePointer, key);
      dependencies.add('/logicLibrary', key);
      // The canonical resolution already found this use's node: `usePointer` is that node's pointer followed by the field.
      if (authored.use.kind !== 'document') build.bases.set(baseKey(authored.use), binding.usePointer.slice(0, binding.usePointer.length - authored.use.field.length));
      watchAnchor(build, authored.use, [key, reanchor]);
      if (authored.use.kind === 'component') {
        const owner = anchorPointer(build, { kind: 'component', id: authored.use.id, field: '' })!;
        dependencies.add(`${owner}/params`, key); dependencies.add(`${owner}/bindings`, key);
      }
    });
    before.componentLibrary?.forEach((entry, at) => {
      for (const field of ['params', 'bindings', 'sources', 'flows']) {
        dependencies.add(fieldPointer(['componentLibrary', at, field]), `e:${entry.id}`);
        dependencies.add(fieldPointer(['componentLibrary', at, field]), 'guard');
      }
      let paths: Map<object, EditorPath[]> | undefined;
      entry.bindings?.forEach((binding, bindingIndex) => {
        const key = `p:${entry.id}:${bindingIndex}`, target = componentTarget(before, entry, binding, () => paths ??= entryObjectPaths(before, entry));
        // An already-broken binding stays in every edit's scope, so only an edit that repairs or removes it is accepted.
        if (target === undefined || !entry.params?.some(param => param.name === binding.param)) return dependencies.add('', key);
        targets.set(key, target); witnessed(target, key);
        if (!binding.nodeId) {
          // A source binding is found by its source object's unique identity inside its entry (that object is its second
          // witness; the sources lists and IDs are read under `e:`), and by the entry's ID-order position.
          witnessAt(target.slice(0, target.length - fieldPointer(fieldSteps(binding.field)).length), [key]);
          for (let earlier = 0; earlier <= at; earlier++) {
            dependencies.add(fieldPointer(['componentLibrary', earlier, 'id']), key); dependencies.add(fieldPointer(['componentLibrary', earlier, 'id']), 'guard');
          }
        }
        const anchor = { kind: 'component' as const, id: entry.id, ...(binding.nodeId ? { nodeId: binding.nodeId } : {}),
          field: binding.nodeId ? fieldPointer(fieldSteps(binding.field)) : target.slice(fieldPointer(['componentLibrary', at]).length) };
        // Covers the holder fallback too: its field is a prefix of this one.
        watchAnchor(build, anchor, [key]);
      });
    });
    if (before.studioCanvas) {
      // Unusable metadata is left alone unless the edit changes it (`rebaseCanvasLayout` rechecks before rebasing).
      stored = studioCanvasMetadataSchema.safeParse(before.studioCanvas);
      if (!stored.success) dependencies.add('', 'layout');
      else for (const canvas of stored.data.canvases) for (const root of canvas.roots) {
        const key = `c:${root.id}`;
        // Every origin below the root locates through the root's path.
        witnessed(anchorPointer(build, root.anchor), key);
        watchAnchor(build, root.anchor, [key]);
      }
    }
    indexed = { dependencies, resolved, targets, entries: new Set(before.componentLibrary?.map(entry => entry.id)), evidence, holders, members, always: new Set(),
      uncertified: stored?.success ? uncertifiedCanvasRoots(before, stored.data) : new Set(), ...(stored?.success ? { stored: stored.data } : {}) };
    revisions.set(before, indexed);
  }
  const index = indexed, scope = new Set<string>(), touch = (pointer: string) => index.dependencies.intersect(pointer, scope);
  // Objects at positions `before` did not hold them, counted per position; a witness among them was placed somewhere new.
  const placements = new Map<object, number>();
  let rewitnessed = false;
  changedPaths(before, edit, touch, value => {
    placements.set(value, (placements.get(value) ?? 0) + 1);
    const keys = index.evidence.get(value);
    if (keys) { rewitnessed = true; for (const key of keys) scope.add(key); }
  });
  for (const key of index.always) scope.add(key);
  index.dependencies.expand(scope);
  const guardChanged = scope.has('guard');
  for (const [from, to] of [...references.relocated ?? [], ...references.fields ?? []]) {
    if (to.length !== 1 || to[0] !== from) touch(from);
  }
  for (const copy of references.copied ?? []) touch(fieldPointer(copy.from));
  if (edit.logicUseBindings !== before.logicUseBindings) {
    // A binding the edit no longer holds by identity (removed, rebuilt or replaced) is reconciled; retained ones are not.
    const kept = new Set(edit.logicUseBindings ?? []);
    before.logicUseBindings?.forEach((binding, at) => { if (!kept.has(binding)) { scope.add(`a:${at}`); scope.add(`r:${at}`); } });
    const held = new Set(before.logicUseBindings ?? []);
    if (edit.logicUseBindings?.some(binding => !held.has(binding))) scope.add('added');
  }
  for (const path of [...references.deleted ?? [], ...references.discardLayouts ?? []]) touch(fieldPointer(path));
  for (const root of index.uncertified) scope.add(`c:${root}`);
  index.dependencies.expand(scope);
  /**
   * The index stays exact for the result while nothing it read changed: no guarded read, no binding rewrite, and no
   * witness placed somewhere new (which may now occur twice).
   */
  const finish = (document: CompositionDocument, rebased?: StoredStudioCanvasMetadata) => {
    if (guardChanged || rewitnessed || document.logicUseBindings !== before.logicUseBindings) return document;
    let carried: ReferenceIndex | undefined;
    if (document === edit && document.studioCanvas === before.studioCanvas) carried = index;
    // A rebase that kept every canvas and root (IDs and anchors) moved only node associations, which nothing else indexes;
    // the roots it rebased are certified afresh against the result.
    else if (rebased && index.stored && document.studioCanvas === rebased && sameJson(rootsOf(index.stored), rootsOf(rebased))) {
      const reached = new Set([...scope].filter(key => key.startsWith('c:')).map(key => key.slice(2)));
      const uncertified = new Set([...index.uncertified].filter(root => !reached.has(root)));
      for (const root of uncertifiedCanvasRoots(document, rebased, reached)) uncertified.add(root);
      carried = { ...index, stored: rebased, usable: true, uncertified };
    }
    if (!carried) return document;
    // A witness is still proof when it stayed in place (it was placed nowhere new) or is a fresh object (in no earlier
    // revision) placed exactly once. Anything else at a witness position may occur twice, so those keys are reconciled by
    // every later edit instead.
    let always: Set<string> | undefined;
    for (const key of scope) for (const pointer of index.holders.get(key) ?? []) {
      const value = valueAt(document, pointerPath(pointer));
      const held = value !== null && typeof value === 'object' ? index.evidence.get(value) : undefined;
      if (held?.includes(key)) continue;
      if (value === null || typeof value !== 'object' || placements.get(value) !== 1 || index.members.has(value)) {
        (always ??= new Set(index.always)).add(key); continue;
      }
      if (held) held.push(key); else index.evidence.set(value, [key]);
    }
    // Every object of the result is in `before` or was placed by the edit (or, after a rebase, sits in the new metadata).
    for (const value of placements.keys()) index.members.add(value);
    if (document !== edit) changedPaths(edit, document, () => {}, value => index.members.add(value));
    revisions.set(document, always ? { ...carried, always } : carried);
    return document;
  };
  if (!scope.size) return finish(edit);
  const automatic = (at: number) => scope.has(`a:${at}`);
  const parameter = (entry: string, at: number) => scope.has('components') || scope.has(`e:${entry}`) || scope.has(`p:${entry}:${at}`);
  const component = (entry: string) => scope.has('components') || scope.has(`e:${entry}`) || !index.entries.has(entry)
    || [...scope].some(key => key.startsWith(`p:${entry}:`));
  const layouts = scope.has('layout') || [...scope].some(key => key.startsWith('c:'));
  const locateAll = (pointer: string): EditorPath[] => {
    const remap = [...references.relocated ?? []].filter(([from]) => pointer === from || pointer.startsWith(`${from}/`))
      .sort(([left], [right]) => right.length - left.length)[0];
    const found = remap ? remap[1].map(to => pointerPath(`${to}${pointer.slice(remap[0].length)}`))
      : references.fields?.get(pointer)?.map(pointerPath) ?? [locate(pointer)].filter(path => path !== undefined);
    for (const copy of references.copied ?? []) {
      const from = fieldPointer(copy.from);
      if (pointer === from || pointer.startsWith(`${from}/`)) found.push(pointerPath(`${fieldPointer(copy.to)}${pointer.slice(from.length)}`));
    }
    return [...new Map(found.filter(path => valueAt(edit, path) !== undefined).map(path => [fieldPointer(path), path])).values()];
  };
  let next = edit;
  const resolved = index.resolved;
  before.logicUseBindings?.forEach((binding, index) => {
    if (!automatic(index)) return;
    if (!edit.logicUseBindings?.some(next => next === binding || sameJson(next, binding)) && !declared(resolved[index].usePointer)) refuse();
  });
  // Added bindings still pass through the duplicate check below, which compares every binding's use and argument; so does
  // any edit to the array itself (a binding repeated in place is collapsed there, not refused later).
  if (next.logicUseBindings?.length && resolved.length && (scope.has('added') || next.logicUseBindings !== before.logicUseBindings
    || [...scope].some(key => key.startsWith('r:')))) {
    const uses = new Map<string, ReturnType<typeof usesOf>>();
    const seen = new Map<string, NonNullable<CompositionDocument['logicUseBindings']>[number]>();
    const bindings = next.logicUseBindings.flatMap((binding, at) => {
      const index = next.logicUseBindings === before.logicUseBindings ? at : before.logicUseBindings!.findIndex(old => old === binding || sameJson(old, binding));
      if (index >= 0 && !automatic(index)) return [binding];
      if (index < 0) return [binding];
      const paths = locateAll(resolved[index].usePointer);
      if (!locateAll(`${resolved[index].usePointer}/args/${binding.argument}`).length) {
        if (!deleted(resolved[index].usePointer) && !deleted(`${resolved[index].usePointer}/args/${binding.argument}`)) refuse();
        return [];
      }
      let candidates = uses.get(binding.logicId);
      if (!candidates) { candidates = usesOf(edit, binding.logicId); uses.set(binding.logicId, candidates); }
      const result = paths.flatMap(path => {
        if (!candidates.some(use => fieldPointer(use.path) === fieldPointer(path))) return [];
        const use = anchorAt(path);
        return [sameJson(use, binding.use) ? binding : { ...binding, use }];
      });
      if (!result.length && !deleted(resolved[index].usePointer)) refuse();
      return result;
    }).filter(binding => {
        const key = canonicalOfBounded([binding.use, binding.argument]);
        const previous = seen.get(key);
        if (previous && (previous.logicId !== binding.logicId || previous.from.field !== binding.from.field)) refuse();
        if (previous) return false;
        seen.set(key, binding); return true;
    });
    if (!sameJson(bindings, next.logicUseBindings)) next = { ...next, logicUseBindings: bindings };
  }
  for (const [index, entry] of (before.componentLibrary ?? []).entries()) {
    if (!component(entry.id)) continue;
    if (entry.bindings?.length && !next.componentLibrary?.some(next => next.id === entry.id) && !declared(fieldPointer(['componentLibrary', index]))) refuse();
  }
  if (next.componentLibrary) {
    const library = next.componentLibrary.map(entry => {
      if (!component(entry.id)) return entry;
      const previous = before.componentLibrary?.find(old => old.id === entry.id);
      if (!previous?.bindings?.length) return entry;
      for (const [bindingIndex, binding] of previous.bindings.entries()) {
        if (!parameter(entry.id, bindingIndex)) continue;
        if (entry.bindings?.some(next => next === binding || sameJson(next, binding))) continue;
        if (deleted(fieldPointer(['componentLibrary', before.componentLibrary!.indexOf(previous), 'bindings', bindingIndex]))) continue;
        const target = index.targets.get(`p:${entry.id}:${bindingIndex}`);
        if (target === undefined || !declared(target)) refuse();
      }
      if (!entry.bindings?.length) return entry;
      let editEntries: Map<object, EditorPath[]> | undefined;
      const bindings = entry.bindings.flatMap((binding, at) => {
        const oldIndex = entry.bindings === previous.bindings ? at : previous.bindings!.findIndex(old => old === binding || sameJson(old, binding));
        if (oldIndex >= 0 && !parameter(entry.id, oldIndex)) return [binding];
        if (!previous.bindings!.some(old => old === binding || sameJson(old, binding))) return [binding];
        const oldField = fieldPointer(fieldSteps(binding.field));
        const anchor = { kind: 'component' as const, id: entry.id, ...(binding.nodeId ? { nodeId: binding.nodeId } : {}), field: oldField };
        const target = index.targets.get(`p:${entry.id}:${oldIndex}`);
        const param = entry.params?.find(param => param.name === binding.param);
        let paths = target === undefined ? [] : locateAll(target), optional = false;
        if (!paths.length && param?.kind === 'value') {
          const holder = target === undefined
            ? resolveLogicAnchor(before, { ...anchor, field: fieldPointer(fieldSteps(binding.field).slice(0, -1)) })?.pointer
            : fieldPointer(pointerPath(target).slice(0, -1));
          if (holder !== undefined) {
            optional = true;
            const retained = locateAll(holder);
            const node = binding.nodeId && resolveLogicAnchor(edit, { ...anchor, field: fieldPointer(fieldSteps(binding.field).slice(0, -1)) });
            paths = (retained.length ? retained : node ? [pointerPath(node.pointer)] : []).map(path => [...path, fieldSteps(binding.field).at(-1)!]);
          }
        }
        if (target === undefined && !optional) refuse();
        const result = paths.flatMap(path => {
          if (binding.nodeId) {
            const holderPath = optional ? path.slice(0, -1) : path;
            const node = optional && resolveLogicAnchor(edit, { ...anchor, field: '' });
            const base = node && node.pointer === fieldPointer(holderPath) ? { ...anchor, field: '' } : anchorAt(holderPath);
            const address = optional ? { ...base, field: `${base.field}${fieldPointer(path.slice(-1))}` } : base;
            if (address.kind !== 'component' || address.id !== entry.id || !address.nodeId) return [];
            const field = fieldSteps(address.field).join('/');
            return [field === fieldSteps(binding.field).join('/') && address.nodeId === binding.nodeId ? binding : { ...binding, nodeId: address.nodeId, field }];
          }
          const source = ownedSources(entry).find(source => source.id === binding.sourceId);
          const owner = fieldPointer(['componentLibrary', edit.componentLibrary!.findIndex(next => next.id === entry.id)]);
          const paths = source && (editEntries ??= entryObjectPaths(edit, entry)).get(source)?.filter(path => inside(fieldPointer(path), owner));
          if (paths?.length !== 1) return [];
          const base = fieldPointer(paths[0]), pointer = fieldPointer(path);
          if (!pointer.startsWith(`${base}/`)) return [];
          const field = pointerPath(pointer.slice(base.length)).join('/');
          return [field === fieldSteps(binding.field).join('/') ? binding : { ...binding, field }];
        });
        if (!result.length && (target === undefined || !deleted(target))) refuse();
        return result;
      });
      return sameJson(bindings, entry.bindings) ? entry : { ...entry, bindings };
    });
    if (library.some((entry, index) => entry !== next.componentLibrary![index])) next = { ...next, componentLibrary: library };
  }
  if (before.studioCanvas && !sameJson(before.studioCanvas, next.studioCanvas) && !deleted('/studioCanvas')) {
    if (!references.layout?.length) refuse();
    if (readStudioCanvas(before).warnings.length || readStudioCanvas(next).warnings.length || !next.studioCanvas) return refuse();
    const previous = studioCanvasMetadataSchema.parse(before.studioCanvas), following = studioCanvasMetadataSchema.parse(next.studioCanvas);
    const projection = (document: CompositionDocument, canvases: StoredStudioCanvasMetadata['canvases']) => canvases.flatMap(canvas => {
      const affected = new Set(canvas.roots.filter(root => {
        const target = resolveLogicAnchor(document, root.anchor);
        return target && references.layout!.some(path => inside(target.pointer, fieldPointer(path)));
      }).map(root => root.id));
      const roots = canvas.roots.filter(root => !affected.has(root.id));
      if (!roots.length) return [];
      const nodes = canvas.nodes.filter(node => !affected.has(node.rootId));
      const ids = new Set(nodes.map(node => node.id));
      return [{ ...canvas, roots, nodes, ...(canvas.groups ? { groups: canvas.groups
        .map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => ids.has(id)) })).filter(group => group.nodeIds.length) } : {}) }];
    });
    if (!sameJson(projection(before, previous.canvases), projection(next, following.canvases)) || !sameJson(previous.bundles, following.bundles)) refuse();
    for (const canvas of previous.canvases) for (const root of canvas.roots) {
      const target = resolveLogicAnchor(before, root.anchor);
      if (!target || deleted(target.pointer)) continue;
      const saved = following.canvases.find(next => next.id === canvas.id);
      if (!saved) return refuse();
      if (!saved.roots.some(next => next.id === root.id)) refuse();
      for (const node of canvas.nodes.filter(node => node.rootId === root.id)) {
        if (!saved.nodes.some(next => next.id === node.id) && !node.origins.every(origin => deleted(`${target.pointer}${origin}`))) refuse();
      }
    }
  }
  if (layouts && before.studioCanvas && next.studioCanvas === before.studioCanvas && index.stored && !index.usable && readStudioCanvas(before).metadata) index.usable = true;
  const layout = next.studioCanvas, settled = next;
  if (layouts) next = rebaseCanvasLayout(before, next, locateAll, {
    fields: references.fields, discard: references.discardLayouts, deleted, refuse,
    affected: scope.has('layout') ? undefined : new Set([...scope].filter(key => key.startsWith('c:')).map(key => key.slice(2))),
    ...(next.studioCanvas === before.studioCanvas && index.stored ? { stored: index.stored, usable: index.usable ?? false } : {}),
  });
  for (const entry of next.componentLibrary ?? []) if (component(entry.id)) {
    let paths: Map<object, EditorPath[]> | undefined;
    for (const [at, binding] of (entry.bindings ?? []).entries()) {
      if (!parameter(entry.id, at) && entry.bindings === before.componentLibrary?.find(old => old.id === entry.id)?.bindings) continue;
      if (!entry.params?.some(param => param.name === binding.param) || componentTarget(next, entry, binding, () => paths ??= entryObjectPaths(next, entry)) === undefined) refuse();
    }
  }
  // Metadata the edit itself changed is checked whole; a rebase only emits metadata it has checked.
  if (next.studioCanvas && next.studioCanvas === layout && !sameJson(before.studioCanvas, layout) && readStudioCanvas(next).warnings.length) refuse();
  if (next.logicUseBindings?.length) {
    const bindings = next.logicUseBindings === before.logicUseBindings ? next.logicUseBindings.filter((_, at) => automatic(at)) : next.logicUseBindings;
    if (bindings.length) resolveLogicUseBindings({ ...next, logicUseBindings: bindings });
  }
  return finish(next, settled === edit && next.studioCanvas !== layout ? next.studioCanvas as StoredStudioCanvasMetadata : undefined);
}
