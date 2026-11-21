import { valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { fieldSteps, ownedSources } from '../../shared/composition/components';
import { atPointer, resolveLogicAnchor, type ResolvedLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { sameJson } from '../../sameJson';
import { usesOf } from '../data/logic/logicModel';
import { AnchorResolver, authoredNodes, fieldAnchor, ownerAuthoredNodes, fieldPointer, pointerPath, walkableList, walkableOwner, walkedOwnerLists, type AuthoredNode, type WalkedOwnerList } from '../logic-fields/registry';
import { canvasWalk, knownUsable, rebaseCanvasLayout, uncertifiedCanvasRoots, usableLayout, walkedNodes } from '../logic-fields/layout';
import { canonicalOfBounded, CompositionValidationError } from '../../shared/composition/json';
import { toastManager } from '../toasts';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { logicUseBindingsSchema, studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../shared/composition/studio-logic/schemas';
import type { LogicAnchor } from '../../shared/composition/graph/types';
import { changedPaths, EditDependencies, readTrie, reads, type ReadTrie } from './editDependencies';

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
   * With the keys of `counts` (every object of the indexed revision), every object of each revision the index was carried
   * to (a superset, only ever widened). An object outside both is fresh: it can occur in a later revision only where an
   * edit placed it.
   */
  readonly members: WeakSet<object>;
  /** How often each object occurs in the indexed revision. */
  readonly counts: ReadonlyMap<object, number>;
  /** The indexed revision itself: `counts` are exact for it, and only for it (not for the revisions the index is carried to). */
  readonly revision: CompositionDocument;
  /** Keys whose witness could not be carried forward; every edit reconciles these. */
  readonly always: ReadonlySet<string>;
  /** Canvas roots a full rebase would not give back unchanged; every edit rebases these. */
  readonly uncertified: ReadonlySet<string>;
  /** The revision has an owner the whole-document reconciliation cannot read (see `ownerShaped`); every edit reconciles everything. */
  readonly unshaped: boolean;
  /**
   * Known-usable layout metadata. Edits that keep this index either leave every root's reads untouched or rebase the reached
   * roots through a check that refuses unusable output, so usability carries forward. Unusable metadata is rechecked.
   */
  usable?: true;
}
const revisions = new WeakMap<CompositionDocument, ReferenceIndex>();
/** `studioCanvasMetadataSchema.safeParse` of committed layout metadata, by its object (shared by revisions that keep it). */
const parsedLayouts = new WeakMap<object, ReturnType<typeof studioCanvasMetadataSchema.safeParse>>();
function parsedCanvas(value: unknown): ReturnType<typeof studioCanvasMetadataSchema.safeParse> {
  if (value === null || typeof value !== 'object') return studioCanvasMetadataSchema.safeParse(value);
  let parsed = parsedLayouts.get(value);
  if (!parsed) { parsed = studioCanvasMetadataSchema.safeParse(value); parsedLayouts.set(value, parsed); }
  return parsed;
}
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

/** How often each object occurs in `document`. */
function objectCounts(document: CompositionDocument): Map<object, number> {
  const counts = new Map<object, number>();
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
  return counts;
}

/**
 * Owner shapes. The whole-document reconciliation (5b28fc4) walks every page, modal and component entry through
 * `authoredNodes` whenever it anchors a field there (`fieldAnchor`: for each retained automatic binding, each located
 * component node binding and each canvas root it rebases), and reads every component entry on every edit (`entry.id`, its
 * `bindings` iterated with each binding's `param` and `field`, its `params` searched, and for a source binding its
 * `sources` and `flows` spread and searched by `id`). On owners those reads cannot take they throw. Scoping skips the
 * walk wherever no binding is in scope, so it checks those shapes itself: on every owner an edit reaches or places, and
 * once per indexed revision on every owner. A revision or candidate with an owner of any other shape is reconciled whole,
 * and anything that then throws refuses. `logicLibrary` and `dataSources` entries are only looked up (by
 * `resolveLogicAnchor`, `usesOf` and a schema parse), never walked unguarded, so no shape of theirs throws.
 */
const present = (value: unknown) => value !== null && value !== undefined;
const listOf = (value: unknown, item: (value: unknown) => boolean) => !present(value) || Array.isArray(value) && value.every(item);
/** The component entry reads beyond the walk; a superset of the shapes they throw on (a binding without a text field, say). */
const entryShaped = (entry: object) => {
  const { bindings, params, sources, flows } = entry as Record<string, unknown>;
  return listOf(bindings, binding => present(binding) && typeof (binding as { field?: unknown }).field === 'string')
    && listOf(params, present) && listOf(sources, present) && listOf(flows, present);
};
/**
 * Committed objects already checked: walkable nodes, and owners (by role) whose reads were checked too. Committed
 * revisions are immutable, so identity keeps the result; a candidate's objects are added only once it is accepted.
 */
const shapedNodes = new WeakSet<object>(), shapedSurfaces = new WeakSet<object>(), shapedEntries = new WeakSet<object>();
interface Checked { readonly nodes: object[]; readonly surfaces: object[]; readonly entries: object[] }
const checking = (): Checked => ({ nodes: [], surfaces: [], entries: [] });
function ownerShaped(list: WalkedOwnerList, owner: unknown, checked: Checked): boolean {
  const entry = list === 'componentLibrary', known = entry ? shapedEntries : shapedSurfaces;
  if (owner !== null && typeof owner === 'object' && known.has(owner)) return true;
  // A walkable owner is an object: it holds `components` or a `node`.
  if (!walkableOwner(list, owner, shapedNodes, checked.nodes) || entry && !entryShaped(owner as object)) return false;
  (entry ? checked.entries : checked.surfaces).push(owner as object);
  return true;
}
function listShaped(document: CompositionDocument, list: WalkedOwnerList, checked: Checked): boolean {
  const owners: unknown = Reflect.get(document, list);
  return walkableList(list, owners) && ((owners ?? []) as unknown[]).every(owner => ownerShaped(list, owner, checked));
}
function commitShapes(checked: Checked): void {
  for (const node of checked.nodes) shapedNodes.add(node);
  for (const surface of checked.surfaces) shapedSurfaces.add(surface);
  for (const entry of checked.entries) shapedEntries.add(entry);
}

const ownerLists = { page: 'pages', modal: 'modals', component: 'componentLibrary', logic: 'logicLibrary', flow: 'dataSources' } as const;

interface IndexBuild {
  readonly dependencies: EditDependencies;
  readonly before: CompositionDocument;
  /** `resolveLogicAnchor(before, ...)`, from indexes. */
  readonly resolver: AnchorResolver;
  /** Shared scans already observed. */
  readonly scans: Set<string>;
  /** Owner-or-node pointer by owner kind, owner ID and node ID, so a page is not rescanned for every anchor on it. */
  readonly bases: Map<string, string | undefined>;
}
const baseKey = (anchor: Exclude<LogicAnchor, { kind: 'document' }>) => JSON.stringify([anchor.kind, anchor.id, anchor.nodeId ?? null]);

/** `resolveLogicAnchor`'s owner (or node) step, memoized for one index build. */
function anchorBase(build: IndexBuild, anchor: Exclude<LogicAnchor, { kind: 'document' }>): string | undefined {
  const key = baseKey(anchor);
  if (!build.bases.has(key)) build.bases.set(key, build.resolver.resolve({ ...anchor, field: '' })?.pointer);
  return build.bases.get(key);
}

/** `resolveLogicAnchor(before, anchor)?.pointer`, reusing the memoized owner/node step and then its final field step. */
function anchorPointer(build: IndexBuild, anchor: LogicAnchor): string | undefined {
  if (anchor.kind === 'document') return build.resolver.resolve(anchor)?.pointer;
  const base = anchorBase(build, anchor);
  if (base === undefined) return undefined;
  return atPointer(valueAt(build.before, pointerPath(base)), anchor.field) === undefined ? undefined : `${base}${anchor.field}`;
}

/**
 * What the canonical node scan (`resolveLogicAnchor` with a node ID) reads in one owner, relative to it, given that the
 * owner list scan matched that owner: recorded through the resolver itself, on a document holding just that owner, so
 * these are its own reads. Each walked node (an entry's `node`, each of a surface's `components`) is recorded once per
 * object and its trie shared wherever it is placed; each owner's trie is memoized too. The scan reads nothing outside
 * the matched owner beyond the list scan, so for a committed owner object the reads are fixed.
 */
const walkReads = new WeakMap<object, ReadTrie>(), ownerWalks = { component: new WeakMap<object, ReadTrie>(), surface: new WeakMap<object, ReadTrie>(), other: new WeakMap<object, ReadTrie>() };
function nodeReads(node: object): ReadTrie {
  let known = walkReads.get(node);
  if (!known) {
    const base = '/pages/0/components/0';
    known = readTrie(reads({ pages: [{ id: '', components: [node] }] }, document => resolveLogicAnchor(document, { kind: 'page', id: '', nodeId: '', field: '' }))
      .filter(([pointer]) => pointer.startsWith(`${base}/`)).map(([pointer, exact]) => [pointer.slice(base.length), exact] as const));
    walkReads.set(node, known);
  }
  return known;
}
function ownerReads(kind: Exclude<LogicAnchor['kind'], 'document'>, owner: Record<string, unknown> & { id: string }): ReadTrie {
  const memo = ownerWalks[kind === 'component' ? 'component' : kind === 'page' || kind === 'modal' ? 'surface' : 'other'];
  let known = memo.get(owner);
  if (!known) {
    const key = ownerLists[kind], base = `/${key}/0`, walked: (readonly [readonly string[], ReadTrie])[] = [];
    const found = reads({ [key]: [owner] }, document => resolveLogicAnchor(document, { kind, id: owner.id, nodeId: '', field: '' }), (value, pointer) => {
      const at = pointer.startsWith(`${base}/`) ? pointerPath(pointer.slice(base.length)) as string[] : [];
      const node = kind === 'component' ? at.length === 1 && at[0] === 'node' : (kind === 'page' || kind === 'modal') && at.length === 2 && at[0] === 'components';
      if (node) walked.push([at, nodeReads(value)]);
      return node;
    });
    known = readTrie(found.filter(([pointer]) => pointer === base || pointer.startsWith(`${base}/`))
      .map(([pointer, exact]) => [pointer.slice(base.length), exact] as const), walked);
    memo.set(owner, known);
  }
  return known;
}

/**
 * Register what `resolveLogicAnchor` reads for `anchor` against `own`. The owner-list ID scan and an owner's node-tree scan
 * are observed once per index and shared through groups; the anchor's own field path is registered directly.
 */
function watchAnchor(build: IndexBuild, anchor: LogicAnchor, own: readonly string[]): void {
  const { dependencies, before, scans } = build, keys = [...own, 'guard'];
  const path = (base: string, field: string) => dependencies.addSteps(base, field, keys);
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
    const group = `nodes:${anchor.kind}:${anchor.id}`, key = ownerLists[anchor.kind], list: unknown = Reflect.get(before, key);
    if (typeof anchor.id !== 'string' || !Array.isArray(list)) scan(group, document => resolveLogicAnchor(document, { kind: anchor.kind, id: anchor.id, nodeId: '', field: '' }));
    else {
      if (!scans.has(group)) {
        scans.add(group);
        // The scan reads the owner list (registered under `list:`, which every key here joins too), then the matched owner.
        const matches = build.resolver.owners(key, anchor.id);
        if (matches.length === 1) {
          dependencies.mount(`/${key}/${matches[0]}`, ownerReads(anchor.kind, list[matches[0]] as Record<string, unknown> & { id: string }), [group, 'guard']);
        }
      }
      for (const key of own) dependencies.join(group, key);
    }
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

type ResolvedUses = ReturnType<typeof resolveLogicUseBindings>['bindings'];
interface ResolvedBindings {
  readonly library: unknown;
  /** Each binding's parsed `use`. */
  readonly uses: readonly LogicAnchor[];
  /** The node each use resolved to, and for a component use its entry (whose `bindings` the resolution reads and extends). */
  readonly nodes: readonly object[];
  readonly entries: readonly (object | undefined)[];
  /** Which uses share a place (see `resolvedUses`): for each, the first binding resolved in the same place. */
  readonly places: readonly number[];
  /** The node and owner pointers each use resolved to, in the revision these results are for. */
  readonly bases: readonly { readonly node: string; readonly owner: string }[];
  readonly bindings: ResolvedUses;
}
/**
 * `resolveLogicUseBindings(document).bindings`, reused per binding for a committed revision holding the same bindings
 * array and library. The canonical resolution reads, per binding: the owner list scan, the owner's node scan, the resolved
 * node (its use field, type and source field, after the arguments earlier bindings wrote into it), the library, and for a
 * component use its entry's `bindings` (after earlier appends). Its writes never change an ID, a type or a child list (a
 * use field cannot pass through `children`, `tabs` or `blocks`), and they stay inside the use's own node and, for a
 * component use, its entry: so bindings in different places (a component use's entry, any other use's node) never read
 * each other's writes, and the duplicate check only ever matches within one place. A binding is reused when its use
 * resolves (owner and node uniqueness included) to the same node object, a component use to the same entry, and the
 * bindings sharing its place are the same ones as before; only the pointers can differ, and they are put back in place.
 * Every other place's bindings are resolved again by the canonical resolution, together and in order, which reads and
 * writes for them exactly what the whole run does. A resolution that throws is not remembered.
 */
const resolvedBindings = new WeakMap<object, ResolvedBindings>();
/**
 * Binding certifications (see the index build) by the top-level authored node the binding's location is in (a page or
 * modal component, or a component entry's `node`), then by the location below it and the binding. Whether the address
 * derived there names the binding's own node and field is decided inside that node: the authored walk reaches every
 * top-level node, a use field never runs through a child list, so the deepest walked node on the path is the bound node
 * exactly when the walk inside the top-level node reaches it; and then the round trip resolves the stored address, which
 * the binding's own resolution (owner and node uniqueness included, checked on every build) already found. Each build
 * keeps, per node it consults, only the answers it used.
 */
const certifications = new WeakMap<object, Map<string, boolean>>();
function resolvedUses(document: CompositionDocument, resolver: AnchorResolver): ResolvedUses {
  const list: unknown = document.logicUseBindings;
  const locate = (uses: readonly LogicAnchor[]) => uses.map(use => resolver.resolve({ ...use, field: '' }));
  /** Where a use's resolution writes: a page or modal use's node; a component use's (or any other) owner. */
  const place = (use: LogicAnchor, at: ReturnType<typeof locate>[number]) => at === undefined ? undefined
    : use.kind === 'page' || use.kind === 'modal' ? `n:${at.node?.pointer}` : `o:${at.owner.pointer}`;
  /** For each binding, the first binding in the same place. */
  const places = (uses: readonly LogicAnchor[], found: ReturnType<typeof locate>) => {
    const first = new Map<string | undefined, number>();
    return found.map((at, index) => {
      const key = place(uses[index], at), known = first.get(key);
      if (known !== undefined) return known;
      first.set(key, index);
      return index;
    });
  };
  const remember = (uses: readonly LogicAnchor[], found: ReturnType<typeof locate>, bindings: ResolvedUses) => {
    const placed = found.every((at, index) => at?.node && bindings[index].usePointer.startsWith(at.node.pointer) && bindings[index].sourcePointer.startsWith(at.node.pointer)
      && (!bindings[index].componentBindingPointer || bindings[index].componentBindingPointer!.startsWith(`${at.owner.pointer}/`)));
    if (placed) resolvedBindings.set(list as object, { library: document.logicLibrary, uses, nodes: found.map(at => at!.node!.value),
      entries: uses.map((use, index) => use.kind === 'component' ? found[index]!.owner.value : undefined), places: places(uses, found),
      bases: found.map(at => ({ node: at!.node!.pointer, owner: at!.owner.pointer })), bindings });
  };
  const memo = list !== null && typeof list === 'object' ? resolvedBindings.get(list) : undefined;
  if (memo && memo.library === document.logicLibrary) {
    const found = locate(memo.uses);
    if (found.every(at => at?.node)) {
      const shared = places(memo.uses, found), at = (index: number) => place(memo.uses[index], found[index])!;
      const same = (index: number) => found[index]!.node!.value === memo.nodes[index]
        && (memo.entries[index] === undefined || found[index]!.owner.value === memo.entries[index]);
      // Places (in this revision) whose bindings are resolved again: each place of a changed binding, and of any binding
      // that shares, or shared, a place with one whose sharing changed.
      const again = new Set<string>(), regroup: number[] = [];
      found.forEach((_, index) => {
        if (!same(index)) again.add(at(index));
        if (shared[index] !== memo.places[index]) regroup.push(index);
      });
      if (regroup.length) {
        const oldGroups = new Set(regroup.map(index => memo.places[index])), newGroups = new Set(regroup.map(index => shared[index]));
        found.forEach((_, peer) => { if (oldGroups.has(memo.places[peer]) || newGroups.has(shared[peer])) again.add(at(peer)); });
      }
      const subset = memo.uses.flatMap((_, index) => again.has(at(index)) ? [index] : []);
      const fresh = subset.length
        ? resolveLogicUseBindings({ ...document, logicUseBindings: subset.map(index => (list as unknown[])[index]) } as CompositionDocument).bindings : [];
      const redone = new Map(subset.map((index, at) => [index, { ...fresh[at], pointer: `/logicUseBindings/${index}` }]));
      const bindings = memo.bindings.map((binding, index) => {
        const resolved = redone.get(index);
        if (resolved) return resolved;
        const { node, owner } = found[index]!, base = memo.bases[index];
        return { ...binding, usePointer: `${node!.pointer}${binding.usePointer.slice(base.node.length)}`, sourcePointer: `${node!.pointer}${binding.sourcePointer.slice(base.node.length)}`,
          ...(binding.componentBindingPointer ? { componentBindingPointer: `${owner.pointer}${binding.componentBindingPointer.slice(base.owner.length)}` } : {}) };
      });
      if (subset.length) remember(memo.uses, found, bindings);
      return bindings;
    }
  }
  const bindings = resolveLogicUseBindings(document).bindings;
  const parsed = logicUseBindingsSchema.safeParse(list);
  if (parsed.success && parsed.data.length === bindings.length && list !== null && typeof list === 'object') {
    const uses = parsed.data.map(binding => binding.use as LogicAnchor);
    remember(uses, locate(uses), bindings);
  }
  return bindings;
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
  const shapes = { unshaped: false };
  try {
    return reconcile(before, edit, references, shapes);
  } catch (error) {
    // The whole-document reconciliation throws on owners it cannot read; this boundary refuses them instead.
    if (shapes.unshaped && !(error instanceof LinkedEditRefusal) && !(error instanceof CompositionValidationError)) return refuse();
    throw error;
  }
}

function reconcile(before: CompositionDocument, edit: CompositionDocument, references: EditReferences, shapes: { unshaped: boolean }): CompositionDocument {
  if (before === edit || sameJson(before, edit) && !references.relocated?.size && !references.copied?.length) return edit;
  /**
   * Whether `document` holds anything linked, read as the whole-document reconciliation reads it, in the same order and
   * stopping where it stops. Where that read throws (a component library that is not a list, or a missing entry before
   * any entry with bindings), the shape is unreadable: refuse, before anything else reads the owners.
   */
  const linked = (document: CompositionDocument) => {
    if (document.logicUseBindings?.length) return true;
    const library: unknown = document.componentLibrary;
    if (library !== null && library !== undefined) {
      if (!Array.isArray(library)) return refuse();
      if (library.some(entry => entry === null || entry === undefined ? refuse() : (entry as ComponentEntry).bindings?.length)) return true;
    }
    return Boolean(document.studioCanvas);
  };
  if (!linked(before) && !linked(edit)) return edit;
  // Past this point the whole-document reconciliation reads `before`'s bindings through `forEach`, which throws on anything
  // but a list (a value without a length passes the checks of the edit that installs it). Where `before` holds bindings, it
  // reads the candidate's through `some` (likewise) and each binding it keeps through its `use` (which throws on a missing
  // entry). It accepts neither; refuse both before anything reads the lists.
  const held: unknown = before.logicUseBindings, proposed: unknown = edit.logicUseBindings;
  if (held !== null && held !== undefined && !Array.isArray(held)) refuse();
  if (before.logicUseBindings?.length && proposed !== null && proposed !== undefined
    && (!Array.isArray(proposed) || proposed.some(binding => binding === null || binding === undefined))) refuse();
  // Per-transaction memos of the candidate: never cached beyond this call, except for objects of committed revisions (those
  // `before`'s index has seen), which are immutable.
  let editPaths: Map<object, EditorPath[]> | undefined, editResolver: AnchorResolver | undefined, beforeResolver: AnchorResolver | undefined;
  const committed = (value: object) => indexed !== undefined && (indexed.counts.has(value) || indexed.members.has(value));
  const walk = canvasWalk(committed), editNodes = walkedNodes(edit, walk);
  const pathsOfEdit = () => editPaths ??= objectPaths(edit);
  /**
   * `referencePaths(before, objectPaths(edit))`, without indexing the candidate where the index counts `before` exactly. An
   * object occurring once in `before` that the edit placed nowhere new (`placements` sees every position where the
   * candidate holds an object `before` did not hold there) occurs in the candidate once if it is still at its own path,
   * and nowhere if not. Any other object is looked up in the candidate's full index.
   */
  const locate = (pointer: string): EditorPath | undefined => {
    const exact = indexed?.revision === before ? indexed.counts : undefined;
    if (!exact) return referencePaths(before, pathsOfEdit())(pointer);
    const path = pointerPath(pointer);
    for (let depth = path.length; depth > 0; depth--) {
      const prefix = path.slice(0, depth), value = valueAt(before, prefix);
      if (value === null || typeof value !== 'object') continue;
      if (exact.get(value) !== 1 || placements.has(value)) return referencePaths(before, pathsOfEdit())(pointer);
      if (valueAt(edit, prefix) === value) return path;
    }
    return undefined;
  };
  /** A field's anchor in the candidate; a field without one owner (duplicate IDs, say) refuses rather than throws. */
  const anchorAt = (path: EditorPath) => {
    try { return fieldAnchor(edit, path, editNodes, anchor => (editResolver ??= new AnchorResolver(edit, committed)).resolve(anchor)); } catch { return refuse(); }
  };
  const deleted = (pointer: string) => (references.deleted ?? []).some(path => inside(pointer, fieldPointer(path)))
    || [...references.relocated ?? []].some(([from, to]) => !to.length && inside(pointer, from));
  const declared = (pointer: string) => deleted(pointer)
    || [...references.relocated ?? []].some(([from]) => inside(pointer, from));
  const componentTarget = (document: CompositionDocument, entry: ComponentEntry,
    binding: NonNullable<typeof entry.bindings>[number], objects: () => Map<object, EditorPath[]>,
    resolve: (anchor: LogicAnchor) => ResolvedLogicAnchor | undefined = anchor => resolveLogicAnchor(document, anchor)): string | undefined => {
    const field = fieldPointer(fieldSteps(binding.field));
    if (binding.nodeId) {
      const anchor = { kind: 'component' as const, id: entry.id, nodeId: binding.nodeId, field };
      const resolved = resolve(anchor);
      if (resolved) return resolved.pointer;
      if (entry.params?.find(param => param.name === binding.param)?.kind !== 'value') return undefined;
      const steps = fieldSteps(binding.field), holder = resolve({ ...anchor, field: fieldPointer(steps.slice(0, -1)) });
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
    // Set first: the index build below reads the owners too.
    const checked = checking(), unshaped = !walkedOwnerLists.every(list => listShaped(before, list, checked));
    commitShapes(checked);
    if (unshaped) shapes.unshaped = true;
    const dependencies = new EditDependencies(), targets = new Map<string, string>(), resolver = new AnchorResolver(before);
    const evidence = new WeakMap<object, string[]>(), holders = new Map<string, string[]>(), members = new WeakSet<object>();
    const counts = objectCounts(before);
    /** `keys` rely on the object at `at`: anything at, above or below it, or the object placed anywhere new, reaches them. */
    const witnessAt = (at: string, keys: readonly string[], value = valueAt(before, pointerPath(at)) as object, steps?: readonly string[]) => {
      dependencies.add(steps ?? at, keys);
      for (const key of keys) { const own = holders.get(key); if (own) own.push(at); else holders.set(key, [at]); }
      const held = evidence.get(value);
      if (held) held.push(...keys); else evidence.set(value, [...keys]);
    };
    /**
     * `keys` identity-locate `pointer` (and pointers below it). `referencePaths` returns the deepest object on the path
     * that occurs once in the candidate; in this revision that is the deepest object occurring once here. While it stays in
     * place and is placed nowhere else, it still occurs once, so the location is unchanged. A path with no such object
     * cannot be located at all: its keys are reconciled by every edit.
     */
    const witnessed = (pointer: string | undefined, ...keys: string[]) => {
      let value: unknown = before, found = 0, witness: object | undefined;
      const path = pointer === undefined ? [] : pointerPath(pointer);
      for (let depth = 1; pointer !== undefined && depth <= path.length; depth++) {
        value = value !== null && typeof value === 'object' && Object.hasOwn(value, path[depth - 1]) ? Reflect.get(value, path[depth - 1]) : undefined;
        if (value === null || typeof value !== 'object') break;
        if (counts.get(value) === 1) { found = depth; witness = value; }
      }
      if (!witness) dependencies.add('', keys);
      else { const steps = path.slice(0, found) as string[]; witnessAt(fieldPointer(steps), keys, witness, steps); }
    };
    const build: IndexBuild = { dependencies, before, resolver, scans: new Set(), bases: new Map() };
    /**
     * Keys the whole-document reconciliation would not give back unchanged even for an edit that touches nothing they read:
     * a binding whose stored address is not the one `fieldAnchor` derives for its own location (a node `resolveLogicAnchor`
     * finds but the authored walk does not, say), or that fails outright. Every edit reconciles these (see `always`).
     * Whether one is certified depends only on the owner and its list, which its key reads anyway, so a carried index stays
     * exact.
     */
    const always = new Set<string>();
    const anchorOf = (path: EditorPath) => fieldAnchor(before, path, ownerAuthoredNodes(before, path), anchor => resolver.resolve(anchor));
    const consulted = new Map<Map<string, boolean>, Set<string>>();
    const certifiedAt = (path: EditorPath, binding: unknown, check: () => boolean): boolean => {
      const top = path[0] === 'componentLibrary' ? path[2] === 'node' ? 3 : undefined
        : (path[0] === 'pages' || path[0] === 'modals') && path[2] === 'components' && path.length > 3 ? 4 : undefined;
      const holder: unknown = top === undefined ? undefined : valueAt(before, path.slice(0, top));
      if (holder === null || typeof holder !== 'object') return check();
      const key = `${fieldPointer(path.slice(top))}\u0000${JSON.stringify(binding)}`;
      let memo = certifications.get(holder);
      if (!memo) { memo = new Map(); certifications.set(holder, memo); }
      let used = consulted.get(memo);
      if (!used) { used = new Set(); consulted.set(memo, used); }
      used.add(key);
      let known = memo.get(key);
      if (known === undefined) { known = check(); memo.set(key, known); }
      return known;
    };
    let stored: ReturnType<typeof studioCanvasMetadataSchema.safeParse> | undefined;
    const resolved = before.logicUseBindings?.length ? resolvedUses(before, resolver) : [];
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
      // The reconciliation re-derives each located use's address; one that comes back different is rewritten.
      const usePath = pointerPath(binding.usePointer);
      if (!certifiedAt(usePath, authored.use, () => {
        try { return sameJson(anchorOf(usePath), authored.use); } catch { return false; /* the reconciliation fails on it */ }
      })) { always.add(key); always.add(reanchor); }
      if (authored.use.kind === 'component') {
        const owner = anchorPointer(build, { kind: 'component', id: authored.use.id, field: '' })!;
        dependencies.add(`${owner}/params`, key); dependencies.add(`${owner}/bindings`, key);
      }
    });
    /**
     * Whether reconciling a node binding at its own target gives it back unchanged: the address derived there (through the
     * holder for an absent optional value) names the same node and field. A target with no value that is not an optional
     * value is refused by every reconciliation, so it is not certified either.
     */
    const fixedComponentBinding = (entry: ComponentEntry, binding: NonNullable<ComponentEntry['bindings']>[number], target: string): boolean => {
      const steps = fieldSteps(binding.field), path = pointerPath(target), anchor = { kind: 'component' as const, id: entry.id, nodeId: binding.nodeId!, field: '' };
      try {
        let address: LogicAnchor;
        if (valueAt(before, path) !== undefined) address = anchorOf(path);
        else {
          if (entry.params?.find(param => param.name === binding.param)?.kind !== 'value') return false;
          const holder = path.slice(0, -1), node = resolver.resolve(anchor);
          const base = node && node.pointer === fieldPointer(holder) ? anchor : anchorOf(holder);
          address = { ...base, field: `${base.field}${fieldPointer(path.slice(-1))}` };
        }
        return address.kind === 'component' && address.id === entry.id && address.nodeId === binding.nodeId
          && fieldSteps(address.field).join('/') === steps.join('/');
      } catch { return false; }
    };
    before.componentLibrary?.forEach((entry, at) => {
      for (const field of ['params', 'bindings', 'sources', 'flows']) {
        dependencies.add(fieldPointer(['componentLibrary', at, field]), `e:${entry.id}`);
        dependencies.add(fieldPointer(['componentLibrary', at, field]), 'guard');
      }
      let paths: Map<object, EditorPath[]> | undefined;
      entry.bindings?.forEach((binding, bindingIndex) => {
        const key = `p:${entry.id}:${bindingIndex}`, target = componentTarget(before, entry, binding, () => paths ??= entryObjectPaths(before, entry), anchor => resolver.resolve(anchor));
        // An already-broken binding stays in every edit's scope, so only an edit that repairs or removes it is accepted (one
        // naming an unknown parameter may still be removed by declaring its target deleted: its target is kept for that).
        if (target !== undefined) targets.set(key, target);
        if (target === undefined || !entry.params?.some(param => param.name === binding.param)) return dependencies.add('', key);
        witnessed(target, key);
        if (binding.nodeId && !certifiedAt(pointerPath(target), [entry.id, entry.params?.find(param => param.name === binding.param)?.kind, binding],
          () => fixedComponentBinding(entry, binding, target))) always.add(key);
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
    for (const [memo, used] of consulted) for (const key of memo.keys()) if (!used.has(key)) memo.delete(key);
    if (before.studioCanvas) {
      // Unusable metadata is left alone unless the edit changes it (`rebaseCanvasLayout` rechecks before rebasing).
      stored = parsedCanvas(before.studioCanvas);
      if (!stored.success) dependencies.add('', 'layout');
      else for (const canvas of stored.data.canvases) for (const root of canvas.roots) {
        const key = `c:${root.id}`;
        // Every origin below the root locates through the root's path.
        witnessed(anchorPointer(build, root.anchor), key);
        watchAnchor(build, root.anchor, [key]);
      }
    }
    indexed = { dependencies, resolved, targets, entries: new Set(before.componentLibrary?.map(entry => entry.id)), evidence, holders, members, counts, revision: before, always,
      uncertified: stored?.success ? uncertifiedCanvasRoots(before, stored.data) : new Set(), unshaped, ...(stored?.success ? { stored: stored.data } : {}) };
    revisions.set(before, indexed);
  }
  const index = indexed, scope = new Set<string>(), touch = (pointer: string) => index.dependencies.intersect(pointer, scope);
  // Objects at positions `before` did not hold them, counted per position; a witness among them was placed somewhere new.
  const placements = new Map<object, number>();
  let rewitnessed = false;
  // Owner lists, and owners (`/pages/3`), a changed pointer falls in.
  const reached = new Set<string>();
  const reach = (pointer: string) => {
    const end = pointer.indexOf('/', 1), list = end < 0 ? pointer.slice(1) : pointer.slice(1, end);
    if (!(walkedOwnerLists as readonly string[]).includes(list)) return;
    const below = end < 0 ? -1 : pointer.indexOf('/', end + 1);
    reached.add(end < 0 ? list : below < 0 ? pointer : pointer.slice(0, below));
  };
  changedPaths(before, edit, pointer => { touch(pointer); reach(pointer); }, value => {
    placements.set(value, (placements.get(value) ?? 0) + 1);
    const keys = index.evidence.get(value);
    if (keys) { rewitnessed = true; for (const key of keys) scope.add(key); }
  });
  const checked = checking();
  if (index.unshaped || [...reached].some(at => {
    const [list, owner] = at.startsWith('/') ? pointerPath(at) as [WalkedOwnerList, string] : [at as WalkedOwnerList];
    if (owner === undefined) return !listShaped(edit, list, checked);
    const owners: unknown = Reflect.get(edit, list);
    // A list that changed kind or length is reached itself.
    return Array.isArray(owners) && !ownerShaped(list, owners[Number(owner)], checked);
  })) {
    shapes.unshaped = true;
    for (const key of ['guard', 'components', 'layout', 'added']) scope.add(key);
    index.resolved.forEach((_, at) => { scope.add(`a:${at}`); scope.add(`r:${at}`); });
  }
  for (const key of index.always) scope.add(key);
  index.dependencies.expand(scope);
  const guardChanged = scope.has('guard');
  for (const [from, to] of [...references.relocated ?? [], ...references.fields ?? []]) {
    if (to.length !== 1 || to[0] !== from) touch(from);
  }
  for (const copy of references.copied ?? []) touch(fieldPointer(copy.from));
  if (edit.logicUseBindings !== before.logicUseBindings) {
    // A binding the edit no longer holds by identity (removed, rebuilt or replaced) is reconciled; retained ones are not.
    // A value that is not a list (only possible here when `before` holds none) is new, and checked whole like any addition.
    const list = Array.isArray(proposed) ? proposed as NonNullable<CompositionDocument['logicUseBindings']> : [], kept = new Set(list);
    before.logicUseBindings?.forEach((binding, at) => { if (!kept.has(binding)) { scope.add(`a:${at}`); scope.add(`r:${at}`); } });
    const held = new Set(before.logicUseBindings ?? []);
    if (Array.isArray(proposed) ? list.some(binding => !held.has(binding)) : proposed !== null && proposed !== undefined) scope.add('added');
  }
  for (const path of [...references.deleted ?? [], ...references.discardLayouts ?? []]) touch(fieldPointer(path));
  for (const root of index.uncertified) scope.add(`c:${root}`);
  index.dependencies.expand(scope);
  /**
   * The index stays exact for the result while nothing it read changed: no guarded read, no binding rewrite, and no
   * witness placed somewhere new (which may now occur twice).
   */
  const finish = (document: CompositionDocument, rebased?: StoredStudioCanvasMetadata) => {
    if (document === edit) commitShapes(checked);
    if (guardChanged || rewitnessed || document.logicUseBindings !== before.logicUseBindings) return document;
    let carried: ReferenceIndex | undefined;
    if (document === edit && document.studioCanvas === before.studioCanvas) carried = index;
    // A rebase that kept every canvas and root (IDs and anchors) moved only node associations, which nothing else indexes;
    // the roots it rebased are certified afresh against the result.
    else if (rebased && index.stored && document.studioCanvas === rebased && sameJson(rootsOf(index.stored), rootsOf(rebased))) {
      const reached = new Set([...scope].filter(key => key.startsWith('c:')).map(key => key.slice(2)));
      const uncertified = new Set([...index.uncertified].filter(root => !reached.has(root)));
      for (const root of uncertifiedCanvasRoots(document, rebased, reached, walk)) uncertified.add(root);
      carried = { ...index, stored: rebased, usable: true, uncertified };
      // The carried index takes the rebased metadata as its own parse; a later index of a revision holding this object
      // reads the same (and so keeps the per-root memos keyed by its root objects).
      if (!parsedLayouts.has(rebased)) parsedLayouts.set(rebased, { success: true, data: rebased } as ReturnType<typeof studioCanvasMetadataSchema.safeParse>);
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
      if (value === null || typeof value !== 'object' || placements.get(value) !== 1 || index.counts.has(value) || index.members.has(value)) {
        (always ??= new Set(index.always)).add(key); continue;
      }
      if (held) held.push(key); else index.evidence.set(value, [key]);
    }
    // Every object of the result is in `before` or was placed by the edit (or, after a rebase, sits in the new metadata).
    for (const value of placements.keys()) index.members.add(value);
    if (document !== edit) changedPaths(edit, document, () => {}, value => index.members.add(value));
    // Usable metadata of a committed result vouches for later revisions that resolve every root alike (see `usableLayout`).
    if (carried.usable) knownUsable(document);
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
  if (layouts && before.studioCanvas && next.studioCanvas === before.studioCanvas && index.stored && !index.usable
    && usableLayout(before, index.stored, anchor => (beforeResolver ??= new AnchorResolver(before)).resolve(anchor))) index.usable = true;
  const layout = next.studioCanvas, settled = next;
  if (layouts) next = rebaseCanvasLayout(before, next, locateAll, {
    fields: references.fields, discard: references.discardLayouts, deleted, refuse, walk,
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
