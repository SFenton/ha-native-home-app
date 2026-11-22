import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { lift, type ASTReplacement, type GraphNode, type LogicAnchor } from '../../shared/composition/graph';
import { canonicalOfBounded, CompositionValidationError } from '../../shared/composition/json';
import { resolveLogicAnchor, type ResolvedLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, normalizeAnnotation, readStudioCanvas, type CanvasLayoutInput } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import { AnchorResolver, authoredNodes, fieldAnchor, fieldPointer, pointerPath, type AuthoredNode } from './registry';
import { valueAt, type EditorPath } from '../../composition-editor';
import { sameJson } from '../../sameJson';
import { documentEdit, LINKED_EDIT_REFUSAL } from '../editors/documentEdit';

export interface CanvasRebase {
  readonly fields?: ReadonlyMap<string, readonly string[]>;
  readonly discard?: readonly EditorPath[];
  /**
   * Root IDs to rebase; the others are kept as stored. Omitted: every root. Only roots `uncertifiedCanvasRoots` passes may
   * be left out, and only while nothing they read has changed.
   */
  readonly affected?: ReadonlySet<string>;
  /** `before`'s parsed metadata and that it is usable, when the caller already knows (both per revision). */
  readonly stored?: StoredStudioCanvasMetadata;
  readonly usable?: boolean;
  /** Shared with the certification of the result, and which objects are committed (see {@link CanvasWalk}). */
  readonly walk?: CanvasWalk;
  deleted(pointer: string): boolean;
  refuse(): never;
}

/** One value's lifted nodes (IDs and origins: all a rebase reads of a lift, and a function of the value alone), by origin. */
interface Lifted {
  readonly nodes: readonly { readonly id: string; readonly origins: readonly string[] }[];
  /** Indices of the nodes with each origin, and of those with none (which every saved node's origins cover). */
  readonly byOrigin: ReadonlyMap<string, readonly number[]>;
  readonly bare: readonly number[];
}
/**
 * What one transaction's rebase and the certification of its result share, and which objects are committed (immutable,
 * so lifts of them are kept across revisions; a candidate's own objects are kept only for the transaction). The result
 * holds the same owners as the rebased candidate, so the authored-node walk is shared too, checked by those owners.
 */
export interface CanvasWalk {
  readonly committed: (value: object) => boolean;
  readonly lifts: Map<object, Lifted>;
  authored?: { readonly owners: readonly unknown[]; readonly nodes: readonly AuthoredNode[] };
}
export const canvasWalk = (committed: (value: object) => boolean): CanvasWalk => ({ committed, lifts: new Map() });
const liftedValues = new WeakMap<object, Lifted>();
function liftedNodes(value: unknown, anchor: LogicAnchor, semantic: CompositionDocument, base: string, walk: CanvasWalk): Lifted {
  const object = value !== null && typeof value === 'object' ? value : undefined;
  const known = object && (walk.lifts.get(object) ?? liftedValues.get(object));
  if (known) return known;
  const graph = lift(value as Json, { anchor, context: { document: semantic as unknown as Json, pointer: base } }).graph;
  const byOrigin = new Map<string, number[]>(), bare: number[] = [];
  graph.nodes.forEach((node, index) => {
    if (!node.origins.length) bare.push(index);
    for (const origin of new Set(node.origins)) {
      const same = byOrigin.get(origin);
      if (same) same.push(index); else byOrigin.set(origin, [index]);
    }
  });
  const result: Lifted = { nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins })), byOrigin, bare };
  if (object) { walk.lifts.set(object, result); if (walk.committed(object)) liftedValues.set(object, result); }
  return result;
}
/** `authoredNodes(semantic)`, once per transaction for the same owners. */
export function walkedNodes(semantic: CompositionDocument, walk: CanvasWalk): () => readonly AuthoredNode[] {
  const owners = [semantic.pages, semantic.modals, semantic.componentLibrary];
  return () => {
    if (!walk.authored || walk.authored.owners.some((owner, at) => owner !== owners[at])) walk.authored = { owners, nodes: authoredNodes(semantic) };
    return walk.authored.nodes;
  };
}

type StoredCanvas = StoredStudioCanvasMetadata['canvases'][number];
type StoredRoot = StoredCanvas['roots'][number];
type StoredNode = StoredCanvas['nodes'][number];
type LayoutNode = CanvasLayoutInput['roots'][number]['nodes'][number];
type LayoutHandoff = Omit<CanvasLayoutHandoff, 'annotations'> & {
  readonly annotations?: Readonly<Record<string, NonNullable<GraphNode['annotation']>>>;
};
interface Associated { readonly anchor: LogicAnchor; readonly nodes: LayoutNode[]; readonly associations: { old: string; node: string }[] }

const presentation = ({ x, y, label, note }: StoredNode) => ({
  x, y, ...(label ? { label } : {}), ...(note ? { note } : {}),
});
const asInput = (nodes: readonly StoredNode[]): LayoutNode[] => nodes.map(node => ({ id: node.nodeId, origins: node.origins, ...presentation(node) }));

/** A canvas's nodes grouped by root, in stored order (one pass, however many roots share the canvas). */
function nodesByRoot(nodes: readonly StoredNode[]): Map<string, StoredNode[]> {
  const byRoot = new Map<string, StoredNode[]>();
  for (const node of nodes) {
    const own = byRoot.get(node.rootId);
    if (own) own.push(node); else byRoot.set(node.rootId, [node]);
  }
  return byRoot;
}

/** Whether re-encoding this canvas, with every root unchanged, gives it back as stored (no group or node-order normalizing). */
function normalCanvas(canvas: StoredCanvas, byRoot: ReadonlyMap<string, readonly StoredNode[]>): boolean {
  if (!canvas.roots.length || canvas.groups?.some(group => new Set(group.nodeIds).size !== group.nodeIds.length)) return false;
  const ordered = canvas.roots.flatMap(root => byRoot.get(root.id) ?? []);
  return ordered.length === canvas.nodes.length && ordered.every((node, at) => node === canvas.nodes[at]);
}

/** A field's anchor; a field that no longer has one owner (duplicate IDs, a removed owner) refuses the edit. */
function anchorAt(document: CompositionDocument, path: EditorPath, nodes: () => readonly AuthoredNode[], refuse: () => never, resolver: AnchorResolver): LogicAnchor {
  try { return fieldAnchor(document, path, nodes, anchor => resolver.resolve(anchor)); } catch { return refuse(); }
}

/**
 * The full rebase's step for one destination of one root: lift the destination's current value, then carry each saved
 * node to the lifted nodes whose origins it still covers.
 */
function associate(semantic: CompositionDocument, pointer: string, path: EditorPath, own: readonly StoredNode[],
  locate: (pointer: string) => EditorPath[], changes: Pick<CanvasRebase, 'deleted' | 'refuse'>, nodes: () => readonly AuthoredNode[],
  resolver: AnchorResolver, walk: CanvasWalk): Associated {
  const anchor = anchorAt(semantic, path, nodes, changes.refuse, resolver), base = fieldPointer(path);
  const graph = liftedNodes(valueAt(semantic, path), anchor, semantic, base, walk);
  const carried = new Map<string, LayoutNode>(), associations: { old: string; node: string }[] = [];
  for (const old of own) {
    const origins = new Set(old.origins.flatMap(origin => locate(`${pointer}${origin}`))
      .map(fieldPointer).filter(at => at === base || at.startsWith(`${base}/`)).map(at => at.slice(base.length)));
    // The lifted nodes whose origins `origins` all cover, in lifted order: those with one of them, or with none.
    const reached = new Set(graph.bare);
    for (const origin of origins) for (const index of graph.byOrigin.get(origin) ?? []) reached.add(index);
    const matches = [...reached].sort((left, right) => left - right).map(index => graph.nodes[index])
      .filter(node => node.origins.every(origin => origins.has(origin)));
    if (!matches.length && !old.origins.every(origin => changes.deleted(`${pointer}${origin}`))) changes.refuse();
    for (const node of matches) {
      const previous = carried.get(node.id);
      if (previous && (previous.x !== old.x || previous.y !== old.y || previous.label !== old.label || previous.note !== old.note)) changes.refuse();
      carried.set(node.id, { id: node.id, origins: node.origins, ...presentation(old) });
      associations.push({ old: old.id, node: node.id });
    }
  }
  return { anchor, nodes: [...carried.values()], associations };
}

const rootPointer = (document: CompositionDocument, root: StoredRoot) =>
  root.anchor.kind === 'document' && root.anchor.field === '' ? '' : resolveLogicAnchor(document, root.anchor)?.pointer;

/**
 * A stored root's own content (anchor, then each node's lifted ID, origins and position, in order), as text that tells
 * apart every two values `sameJson` does. Kept per parsed root object while it has the same node objects.
 */
const rootKeys = new WeakMap<StoredRoot, { readonly own: readonly StoredNode[]; readonly key: string }>();
function rootKey(root: StoredRoot, own: readonly StoredNode[]): string {
  const known = rootKeys.get(root);
  if (known && known.own.length === own.length && known.own.every((node, at) => node === own[at])) return known.key;
  const key = JSON.stringify([root.anchor, own.map(node => [node.nodeId, node.origins, node.x, node.y])],
    (_key, value: unknown) => value === undefined ? '\u0000undefined' : typeof value === 'number' ? `\u0000${String(value)}` : value);
  rootKeys.set(root, { own, key });
  return key;
}
/**
 * Certification results by the committed object a root's check reads (see `uncertifiedCanvasRoots`), then by the root's
 * own content. Only filled from committed documents, so identity keeps each answer. The content is the root's stored
 * layout, which every layout edit changes while the object stays, so each object keeps only its most recently used
 * {@link CERTIFIED_PER_HOLDER} answers (a root moved again and again does not pile up keys while its node lives).
 */
const certified = new WeakMap<object, Map<string, boolean>>();
export const CERTIFIED_PER_HOLDER = 4;
function certifiedAnswer(memo: Map<string, boolean>, key: string): boolean | undefined {
  const known = memo.get(key);
  if (known !== undefined) { memo.delete(key); memo.set(key, known); }
  return known;
}
function certify(holder: object, memo: Map<string, boolean>, key: string, ok: boolean): void {
  memo.delete(key);
  memo.set(key, ok);
  for (const oldest of memo.keys()) { if (memo.size <= CERTIFIED_PER_HOLDER) break; memo.delete(oldest); }
  certified.set(holder, memo);
}
/** How many certification answers are kept for `holder` (for tests). */
export const certifiedAnswers = (holder: object): number => certified.get(holder)?.size ?? 0;

/**
 * Roots that a full rebase of this unedited document would not give back exactly as stored: an association it cannot
 * carry, a lifted ID or anchor it would rewrite, or a canvas it would re-normalize. Such roots must be rebased by every
 * edit; any other root may be kept as stored while nothing it reads changes. `only` limits the check to those roots (and
 * every root of a canvas that needs re-normalizing).
 *
 * `document` must be committed (an indexed revision or an accepted result). Each root's check is memoized by the object
 * it reads, given that its anchor resolves (which is checked afresh, owner and node uniqueness included, on every call):
 * the resolved node, or for an owner-level anchor the owner. Given that resolution, the check reads nothing else:
 * `fieldAnchor` finds the deepest authored node on the root's path, which is that node or one inside it, and its round
 * trip resolves the same owner (the same ID) and, when it names the same node, that node; one inside it with another ID
 * already fails the comparison. `lift` and the origin checks read only the field's value, below the node. A document
 * anchor reads only its value (its ID and fingerprint are part of resolving it); one over the whole document is not
 * memoized. The answer for an unwalkable document may differ (the full check throws, so it would fail every root), but
 * such a revision is reconciled whole, so certification is not consulted.
 */
export function uncertifiedCanvasRoots(document: CompositionDocument, stored: StoredStudioCanvasMetadata, only?: ReadonlySet<string>,
  walk: CanvasWalk = canvasWalk(() => true)): Set<string> {
  const { studioCanvas: _layout, ...rest } = document, semantic = rest as CompositionDocument;
  const nodes = walkedNodes(semantic, walk);
  const failed = new Set<string>(), unproven = (): never => { throw failed; };
  const identity = (pointer: string) => valueAt(semantic, pointerPath(pointer)) === undefined ? [] : [pointerPath(pointer)];
  const resolver = new AnchorResolver(semantic);
  for (const canvas of stored.canvases) {
    if (only && !canvas.roots.some(root => only.has(root.id))) continue;
    const byRoot = nodesByRoot(canvas.nodes);
    if (!normalCanvas(canvas, byRoot)) { for (const root of canvas.roots) failed.add(root.id); continue; }
    for (const root of canvas.roots) {
      if (only && !only.has(root.id)) continue;
      const own = byRoot.get(root.id) ?? [];
      const whole = root.anchor.kind === 'document' && root.anchor.field === '';
      const resolved = whole ? undefined : resolver.resolve(root.anchor);
      if (!whole && !resolved) { failed.add(root.id); continue; }
      const holder = resolved && (root.anchor.kind === 'document' ? resolved.value : (resolved.node ?? resolved.owner).value);
      const memo = holder !== null && typeof holder === 'object' ? certified.get(holder) ?? new Map<string, boolean>() : undefined;
      const key = memo && rootKey(root, own), known = key === undefined ? undefined : certifiedAnswer(memo!, key);
      if (known !== undefined) { if (!known) failed.add(root.id); continue; }
      let ok = true, pure = true;
      try {
        const pointer = whole ? '' : resolved!.pointer;
        const result = associate(semantic, pointer, pointerPath(pointer), own, identity, { deleted: () => false, refuse: unproven }, nodes, resolver, walk);
        ok = sameJson({ anchor: result.anchor, nodes: result.nodes }, { anchor: root.anchor, nodes: asInput(own) });
      } catch (error) {
        // An owner the walk cannot read throws outside the root's own reads: not remembered.
        ok = false; pure = error === failed || error instanceof CompositionValidationError;
      }
      if (!ok) failed.add(root.id);
      if (memo && pure) certify(holder as object, memo, key!, ok);
    }
  }
  return failed;
}

/**
 * Whether `readStudioCanvas(document).metadata` is defined, where `stored` is the parse of `document.studioCanvas` and
 * `resolve` is `resolveLogicAnchor` over `document`. That check reads the document only through each root's resolution:
 * the value the root resolves to (each origin is looked up in it) and its owner's ID; the rest is the metadata itself. So
 * a committed revision known to have usable metadata in the same `studioCanvas` object answers for any other whose every
 * root resolves to the same value (the same object, or an equal primitive) on an owner with the same ID. A root over the
 * whole document (its fingerprint reads everything) is always checked in full.
 */
const usableRevisions = new WeakMap<object, CompositionDocument>();
/** Record that committed `document`'s layout metadata is usable. */
export function knownUsable(document: CompositionDocument): void {
  const raw: unknown = document.studioCanvas;
  if (raw !== null && typeof raw === 'object') usableRevisions.set(raw, document);
}
export function usableLayout(document: CompositionDocument, stored: StoredStudioCanvasMetadata, resolve: (anchor: LogicAnchor) => ResolvedLogicAnchor | undefined): boolean {
  const raw: unknown = document.studioCanvas, known = raw !== null && typeof raw === 'object' ? usableRevisions.get(raw) : undefined;
  if (known === document) return true;
  const roots = stored.canvases.flatMap(canvas => canvas.roots);
  if (known && !roots.some(root => root.anchor.kind === 'document' && root.anchor.field === '')) {
    const other = new AnchorResolver(known);
    const same = roots.every(root => {
      const here = resolve(root.anchor), there = other.resolve(root.anchor);
      return here !== undefined && there !== undefined && Object.is(here.value, there.value)
        && Reflect.get(here.owner.value as object, 'id') === Reflect.get(there.owner.value as object, 'id');
    });
    if (same) return true;
  }
  const usable = readStudioCanvas(document).metadata !== undefined;
  if (usable) knownUsable(document);
  return usable;
}

interface Rebased {
  readonly canvas: StoredCanvas;
  readonly byRoot: ReadonlyMap<string, readonly StoredNode[]>;
  readonly roots: CanvasLayoutInput['roots'][number][];
  readonly associations: { old: string; root: number; node: string }[];
  /** The stored root behind each entry of `roots` that was kept rather than rebased. */
  readonly kept: (StoredRoot | undefined)[];
}

export function rebaseCanvasLayout(before: CompositionDocument, after: CompositionDocument, locate: (pointer: string) => EditorPath[],
  changes: CanvasRebase,
): CompositionDocument {
  if (!before.studioCanvas || !sameJson(before.studioCanvas, after.studioCanvas) || !(changes.usable ?? readStudioCanvas(before).metadata)) return after;
  const stored = changes.stored ?? studioCanvasMetadataSchema.parse(before.studioCanvas);
  const { studioCanvas: _layout, ...rest } = after, semantic = rest as CompositionDocument;
  const walk = changes.walk ?? canvasWalk(() => false), nodes = walkedNodes(semantic, walk), resolver = new AnchorResolver(semantic, walk.committed);
  let changed = false;
  const rebased = stored.canvases.map((canvas): Rebased => {
    const byRoot = nodesByRoot(canvas.nodes);
    const associations: Rebased['associations'] = [], roots: Rebased['roots'] = [], kept: Rebased['kept'] = [];
    if (!normalCanvas(canvas, byRoot)) changed = true;
    for (const root of canvas.roots) {
      const own = byRoot.get(root.id) ?? [];
      if (changes.affected && !changes.affected.has(root.id)) {
        for (const node of own) associations.push({ old: node.id, root: roots.length, node: node.nodeId });
        roots.push({ anchor: root.anchor, nodes: asInput(own) }); kept.push(root);
        continue;
      }
      const pointer = rootPointer(before, root);
      if (pointer === undefined) { changed = true; continue; }
      if (changes.discard?.some(path => pointer === fieldPointer(path) || pointer.startsWith(`${fieldPointer(path)}/`))) { changed = true; continue; }
      const destinations = changes.fields?.get(pointer)?.map(pointerPath) ?? locate(pointer);
      if (!destinations.length && !changes.deleted(pointer)) changes.refuse();
      if (destinations.length !== 1) changed = true;
      for (const path of destinations) {
        const result = associate(semantic, pointer, path, own, locate, changes, nodes, resolver, walk);
        for (const association of result.associations) associations.push({ ...association, root: roots.length });
        const next = { anchor: result.anchor, nodes: result.nodes };
        if (!sameJson(next, { anchor: root.anchor, nodes: asInput(own) })) changed = true;
        roots.push(next); kept.push(undefined);
      }
    }
    return { canvas, byRoot, roots, associations, kept };
  });
  // Every root kept its anchor, its place and each node association, so the stored (usable) metadata is already the encoding.
  if (!changed) return after;
  if (changes.affected && changes.usable) return spliceCanvasLayout(after, stored, rebased);
  const canvases = rebased.flatMap(({ canvas, roots, associations }) => {
    if (!roots.length) return [];
    const input = { id: canvas.id, roots, ...(canvas.viewport ? { viewport: canvas.viewport } : {}) };
    const encoded = encodeStudioCanvas(after, [input]).canvases[0];
    return [{ ...input, ...groupsFor(canvas, associations, encoded.roots.map(root => root.id), nodesByRoot(encoded.nodes)) }];
  });
  const encoded = encodeStudioCanvas(after, canvases, stored.bundles);
  return sameJson(stored, encoded) ? after : { ...after, studioCanvas: encoded };
}

/**
 * Each group's members, carried through the root associations to their encoded node IDs (in association order, then
 * encoded order). Associations are indexed by old node ID and encoded nodes by root and lifted ID, so this is linear.
 */
function groupsFor(canvas: StoredCanvas, associations: Rebased['associations'], rootIds: readonly string[],
  byRoot: ReadonlyMap<string, readonly StoredNode[]>): { groups?: StoredCanvas['groups'] } {
  if (!canvas.groups) return {};
  const byOld = new Map<string, Rebased['associations']>();
  for (const association of associations) {
    const own = byOld.get(association.old);
    if (own) own.push(association); else byOld.set(association.old, [association]);
  }
  const encoded = new Map<string | undefined, Map<string, string[]>>();
  const idsOf = (root: number, nodeId: string) => {
    const rootId = rootIds[root];
    let lifted = encoded.get(rootId);
    if (!lifted) {
      lifted = new Map();
      for (const node of (rootId === undefined ? undefined : byRoot.get(rootId)) ?? []) {
        const ids = lifted.get(node.nodeId);
        if (ids) ids.push(node.id); else lifted.set(node.nodeId, [node.id]);
      }
      encoded.set(rootId, lifted);
    }
    return lifted.get(nodeId) ?? [];
  };
  return { groups: canvas.groups.map(group => ({ ...group, nodeIds: [...new Set(group.nodeIds.flatMap(id =>
    (byOld.get(id) ?? []).flatMap(association => idsOf(association.root, association.node))))] })) };
}

/**
 * The encoding `encodeStudioCanvas` would give, built without re-resolving the kept roots: those are certified, unchanged
 * entries of usable metadata. Rebased roots are encoded (and so checked) on their own, then the cross-root rules (unique
 * root IDs, groups over existing nodes) are checked over the whole result.
 */
function spliceCanvasLayout(after: CompositionDocument, stored: StoredStudioCanvasMetadata, rebased: readonly Rebased[]): CompositionDocument {
  const invalid = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  const rootIds = new Set<string>();
  const canvases = rebased.flatMap(({ canvas, byRoot, roots, associations, kept }) => {
    if (!roots.length) return [];
    const fresh = roots.filter((_, index) => !kept[index]);
    const encoded = fresh.length ? encodeStudioCanvas(after, [{ id: canvas.id, roots: fresh }]).canvases[0] : undefined;
    const freshNodes = nodesByRoot(encoded?.nodes ?? []);
    let next = 0;
    const merged = roots.map((_, index) => {
      const root = kept[index] ?? encoded!.roots[next++];
      if (rootIds.has(root.id)) throw invalid();
      rootIds.add(root.id);
      return { root, nodes: (kept[index] ? byRoot : freshNodes).get(root.id) ?? [] };
    });
    const ids = merged.map(entry => entry.root.id), mergedNodes = new Map(merged.map(entry => [entry.root.id, entry.nodes]));
    return [{ id: canvas.id, roots: merged.map(entry => entry.root), nodes: merged.flatMap(entry => entry.nodes),
      ...(canvas.viewport ? { viewport: canvas.viewport } : {}), ...groupsFor(canvas, associations, ids, mergedNodes) }];
  });
  const encoded: StoredStudioCanvasMetadata = { version: 2, canvases, ...(stored.bundles ? { bundles: stored.bundles } : {}) };
  return sameJson(stored, encoded) ? after : { ...after, studioCanvas: encoded };
}

export function saveCanvasLayout(document: CompositionDocument, replacements: readonly ASTReplacement[], handoff: LayoutHandoff,
  previous: { document: CompositionDocument; paths: readonly EditorPath[] } = {
    document, paths: replacements.map(replacement => {
      const resolved = resolveLogicAnchor(document, replacement.anchor);
      if (!resolved) throw new Error('The layout owner no longer exists.');
      return pointerPath(resolved.pointer);
    }),
  }): CompositionDocument {
  const old = readStudioCanvas(previous.document);
  if (old.warnings.length) throw new Error("Saved layout can't be used. Reset the saved layout explicitly before applying a new layout.");
  const roots = replacements.map((replacement, index) => {
    const path = previous.paths[index];
    if (!path) throw new Error('The layout owner no longer exists.');
    const anchor = fieldAnchor(document, path);
    const oldRoot = handoff.graph.roots.find(root => canonicalOfBounded(root.anchor) === canonicalOfBounded(replacement.anchor));
    if (!oldRoot) throw new Error('The layout root is missing.');
    const fresh = lift(valueAt(document, path) as Json, { anchor, kind: oldRoot.destination.kind,
      context: { document: document as unknown as Json, pointer: fieldPointer(path) },
    }).graph;
    return { anchor, nodes: fresh.nodes.flatMap(node => {
      const location = handoff.sourceMap.find(location => location.stage !== 'expanded' && location.portId === 'value'
        && location.pointer === node.origins[0] && canonicalOfBounded(location.anchor) === canonicalOfBounded(replacement.anchor));
      const position = location && handoff.positions[location.nodeId];
      return position ? [{ id: node.id, origins: node.origins, ...position,
        ...normalizeAnnotation(location && handoff.annotations?.[location.nodeId]),
      }] : [];
    }) };
  });
  const current = readStudioCanvas(document);
  if (current.warnings.length) throw new Error("Saved layout can't be used. Local edits have been retained.");
  const stored = current.present ? studioCanvasMetadataSchema.parse(current.raw) : undefined;
  const placed = new Set<string>();
  const canvases: CanvasLayoutInput[] = (stored?.canvases ?? []).map(canvas => ({
    id: canvas.id,
    roots: canvas.roots.map(root => {
      const key = canonicalOfBounded(root.anchor);
      const replacement = roots.find(candidate => canonicalOfBounded(candidate.anchor) === key);
      if (replacement) { placed.add(key); return replacement; }
      return { anchor: root.anchor, nodes: asInput(canvas.nodes.filter(node => node.rootId === root.id)) };
    }),
    ...(canvas.groups ? { groups: canvas.groups } : {}),
    ...(canvas.viewport ? { viewport: canvas.viewport } : {}),
  }));
  const added = roots.filter(root => !placed.has(canonicalOfBounded(root.anchor)));
  if (added.length) canvases.push({ id: canonicalOfBounded(added.map(root => root.anchor)), roots: added });
  const proposed = { ...document, studioCanvas: encodeStudioCanvas(document, canvases, stored?.bundles) };
  const applied = documentEdit(document, proposed, { layout: previous.paths });
  if (applied === document && !sameJson(document, proposed)) throw new Error(LINKED_EDIT_REFUSAL);
  return applied;
}

export function restoreComponentLayout(original: CompositionDocument, document: CompositionDocument, id: string): CompositionDocument | undefined {
  if (!original.studioCanvas) return document;
  const previous = studioCanvasMetadataSchema.parse(original.studioCanvas), next = studioCanvasMetadataSchema.parse(document.studioCanvas);
  const saved = new Set(next.canvases.flatMap(canvas => canvas.roots.map(root => root.id)));
  const paths: EditorPath[] = [];
  for (const canvas of previous.canvases) {
    const roots = canvas.roots.filter(root => root.anchor.kind === 'component' && root.anchor.id === id && !saved.has(root.id));
    if (!roots.length) continue;
    for (const root of roots) {
      const target = resolveLogicAnchor(document, root.anchor);
      if (!target) throw new Error('The restored layout owner no longer exists.');
      paths.push(pointerPath(target.pointer));
    }
    const ids = new Set(roots.map(root => root.id)), nodes = canvas.nodes.filter(node => ids.has(node.rootId));
    const nodeIds = new Set(nodes.map(node => node.id));
    const groups = canvas.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => nodeIds.has(id)) })).filter(group => group.nodeIds.length);
    const present = next.canvases.find(next => next.id === canvas.id);
    if (!present) next.canvases.push({ ...canvas, roots, nodes, ...(groups ? { groups } : {}) });
    else {
      present.roots.push(...roots); present.nodes.push(...nodes);
      for (const group of groups ?? []) {
        const existing = present.groups?.find(existing => existing.id === group.id);
        if (existing) Object.assign(existing, { ...group, nodeIds: [...new Set([...existing.nodeIds, ...group.nodeIds])] });
        else (present.groups ??= []).push(group);
      }
    }
  }
  if (!paths.length) return document;
  const proposed = { ...document, studioCanvas: next };
  const applied = documentEdit(document, proposed, { layout: paths });
  return applied === document && !sameJson(document, proposed) ? undefined : applied;
}
