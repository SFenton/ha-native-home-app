import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { lift, type ASTReplacement, type LogicAnchor } from '../../shared/composition/graph';
import { canonicalOfBounded, CompositionValidationError } from '../../shared/composition/json';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, readStudioCanvas, type CanvasLayoutInput } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import { authoredNodes, fieldAnchor, fieldPointer, pointerPath, type AuthoredNode } from './registry';
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
  deleted(pointer: string): boolean;
  refuse(): never;
}

type StoredCanvas = StoredStudioCanvasMetadata['canvases'][number];
type StoredRoot = StoredCanvas['roots'][number];
type StoredNode = StoredCanvas['nodes'][number];
type LayoutNode = CanvasLayoutInput['roots'][number]['nodes'][number];
interface Associated { readonly anchor: LogicAnchor; readonly nodes: LayoutNode[]; readonly associations: { old: string; node: string }[] }

const asInput = (nodes: readonly StoredNode[]): LayoutNode[] => nodes.map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y }));

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
function anchorAt(document: CompositionDocument, path: EditorPath, nodes: () => readonly AuthoredNode[], refuse: () => never): LogicAnchor {
  try { return fieldAnchor(document, path, nodes()); } catch { return refuse(); }
}

/**
 * The full rebase's step for one destination of one root: lift the destination's current value, then carry each saved
 * node to the lifted nodes whose origins it still covers.
 */
function associate(semantic: CompositionDocument, pointer: string, path: EditorPath, own: readonly StoredNode[],
  locate: (pointer: string) => EditorPath[], changes: Pick<CanvasRebase, 'deleted' | 'refuse'>, nodes: () => readonly AuthoredNode[]): Associated {
  const anchor = anchorAt(semantic, path, nodes, changes.refuse), base = fieldPointer(path);
  const graph = lift(valueAt(semantic, path) as Json, { anchor, context: { document: semantic as unknown as Json, pointer: base } }).graph;
  const carried = new Map<string, LayoutNode>(), associations: { old: string; node: string }[] = [];
  for (const old of own) {
    const origins = new Set(old.origins.flatMap(origin => locate(`${pointer}${origin}`))
      .map(fieldPointer).filter(at => at === base || at.startsWith(`${base}/`)).map(at => at.slice(base.length)));
    const matches = graph.nodes.filter(node => node.origins.every(origin => origins.has(origin)));
    if (!matches.length && !old.origins.every(origin => changes.deleted(`${pointer}${origin}`))) changes.refuse();
    for (const node of matches) {
      const previous = carried.get(node.id);
      if (previous && (previous.x !== old.x || previous.y !== old.y)) changes.refuse();
      carried.set(node.id, { id: node.id, origins: node.origins, x: old.x, y: old.y });
      associations.push({ old: old.id, node: node.id });
    }
  }
  return { anchor, nodes: [...carried.values()], associations };
}

const rootPointer = (document: CompositionDocument, root: StoredRoot) =>
  root.anchor.kind === 'document' && root.anchor.field === '' ? '' : resolveLogicAnchor(document, root.anchor)?.pointer;

/**
 * Roots that a full rebase of this unedited document would not give back exactly as stored: an association it cannot
 * carry, a lifted ID or anchor it would rewrite, or a canvas it would re-normalize. Such roots must be rebased by every
 * edit; any other root may be kept as stored while nothing it reads changes. `only` limits the check to those roots (and
 * every root of a canvas that needs re-normalizing).
 */
export function uncertifiedCanvasRoots(document: CompositionDocument, stored: StoredStudioCanvasMetadata, only?: ReadonlySet<string>): Set<string> {
  const { studioCanvas: _layout, ...rest } = document, semantic = rest as CompositionDocument;
  let authored: AuthoredNode[] | undefined;
  const nodes = () => authored ??= authoredNodes(semantic);
  const failed = new Set<string>(), unproven = (): never => { throw failed; };
  const identity = (pointer: string) => valueAt(semantic, pointerPath(pointer)) === undefined ? [] : [pointerPath(pointer)];
  for (const canvas of stored.canvases) {
    if (only && !canvas.roots.some(root => only.has(root.id))) continue;
    const byRoot = nodesByRoot(canvas.nodes);
    if (!normalCanvas(canvas, byRoot)) { for (const root of canvas.roots) failed.add(root.id); continue; }
    for (const root of canvas.roots) {
      if (only && !only.has(root.id)) continue;
      const own = byRoot.get(root.id) ?? [], pointer = rootPointer(semantic, root);
      try {
        if (pointer === undefined) unproven();
        const result = associate(semantic, pointer!, pointerPath(pointer!), own, identity, { deleted: () => false, refuse: unproven }, nodes);
        if (!sameJson({ anchor: result.anchor, nodes: result.nodes }, { anchor: root.anchor, nodes: asInput(own) })) failed.add(root.id);
      } catch {
        failed.add(root.id);
      }
    }
  }
  return failed;
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
  let authored: AuthoredNode[] | undefined;
  const nodes = () => authored ??= authoredNodes(semantic);
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
        const result = associate(semantic, pointer, path, own, locate, changes, nodes);
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

export function saveCanvasLayout(document: CompositionDocument, replacements: readonly ASTReplacement[], handoff: CanvasLayoutHandoff,
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
      return position ? [{ id: node.id, origins: node.origins, ...position }] : [];
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
      return { anchor: root.anchor, nodes: canvas.nodes.filter(node => node.rootId === root.id)
        .map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y })) };
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
