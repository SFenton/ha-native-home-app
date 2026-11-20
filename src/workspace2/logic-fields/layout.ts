import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { lift, type ASTReplacement } from '../../shared/composition/graph';
import { canonicalOfBounded, CompositionValidationError } from '../../shared/composition/json';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, readStudioCanvas, type CanvasLayoutInput } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import { fieldAnchor, fieldPointer, pointerPath } from './registry';
import { valueAt, type EditorPath } from '../../composition-editor';
import { sameJson } from '../../sameJson';
import { documentEdit, LINKED_EDIT_REFUSAL } from '../editors/documentEdit';

export interface CanvasRebase {
  readonly fields?: ReadonlyMap<string, readonly string[]>;
  readonly discard?: readonly EditorPath[];
  /** Root IDs whose anchors or contents the edit reached; others are kept as stored. Omitted: every root. */
  readonly affected?: ReadonlySet<string>;
  /** `before`'s parsed metadata and that it is usable, when the caller already knows (both per revision). */
  readonly stored?: StoredStudioCanvasMetadata;
  readonly usable?: boolean;
  deleted(pointer: string): boolean;
  refuse(): never;
}

export function rebaseCanvasLayout(before: CompositionDocument, after: CompositionDocument, locate: (pointer: string) => EditorPath[],
  changes: CanvasRebase,
): CompositionDocument {
  if (!before.studioCanvas || !sameJson(before.studioCanvas, after.studioCanvas) || !(changes.usable ?? readStudioCanvas(before).metadata)) return after;
  const stored = changes.stored ?? studioCanvasMetadataSchema.parse(before.studioCanvas);
  const { studioCanvas: _layout, ...semantic } = after;
  let changed = false;
  const rebased = stored.canvases.map(canvas => {
    const associations: { old: string; root: number; node: string }[] = [];
    const roots: CanvasLayoutInput['roots'][number][] = [];
    /** The stored root behind each entry of `roots` that the edit did not reach. */
    const kept: (StoredStudioCanvasMetadata['canvases'][number]['roots'][number] | undefined)[] = [];
    if (!canvas.roots.length || canvas.groups?.some(group => new Set(group.nodeIds).size !== group.nodeIds.length)) changed = true;
    for (const root of canvas.roots) {
      const own = canvas.nodes.filter(node => node.rootId === root.id);
      if (changes.affected && !changes.affected.has(root.id)) {
        for (const node of own) associations.push({ old: node.id, root: roots.length, node: node.nodeId });
        roots.push({ anchor: root.anchor, nodes: own.map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y })) });
        kept.push(root);
        continue;
      }
      const pointer = root.anchor.kind === 'document' && root.anchor.field === '' ? '' : resolveLogicAnchor(before, root.anchor)?.pointer;
      if (pointer === undefined) { changed = true; continue; }
      if (changes.discard?.some(path => pointer === fieldPointer(path) || pointer.startsWith(`${fieldPointer(path)}/`))) { changed = true; continue; }
      const destinations = changes.fields?.get(pointer)?.map(pointerPath) ?? locate(pointer);
      if (!destinations.length && !changes.deleted(pointer)) changes.refuse();
      if (destinations.length !== 1) changed = true;
      for (const path of destinations) {
        const anchor = fieldAnchor(semantic, path), base = fieldPointer(path);
        const graph = lift(valueAt(semantic, path) as Json, { anchor, context: { document: semantic as unknown as Json, pointer: base } }).graph;
        const nodes = new Map<string, CanvasLayoutInput['roots'][number]['nodes'][number]>();
        for (const old of own) {
          const origins = new Set(old.origins.flatMap(origin => locate(`${pointer}${origin}`))
            .map(fieldPointer).filter(at => at === base || at.startsWith(`${base}/`)).map(at => at.slice(base.length)));
          const matches = graph.nodes.filter(node => node.origins.every(origin => origins.has(origin)));
          if (!matches.length && !old.origins.every(origin => changes.deleted(`${pointer}${origin}`))) changes.refuse();
          for (const node of matches) {
            const previous = nodes.get(node.id);
            if (previous && (previous.x !== old.x || previous.y !== old.y)) changes.refuse();
            nodes.set(node.id, { id: node.id, origins: node.origins, x: old.x, y: old.y });
            associations.push({ old: old.id, root: roots.length, node: node.id });
          }
        }
        const next = { anchor, nodes: [...nodes.values()] };
        if (!sameJson(next, { anchor: root.anchor, nodes: own.map(node => ({ id: node.nodeId, origins: node.origins, x: node.x, y: node.y })) })) changed = true;
        roots.push(next); kept.push(undefined);
      }
    }
    return { canvas, roots, associations, kept };
  });
  // Every root kept its anchor, its place and each node association, so the stored (usable) metadata is already the encoding.
  if (!changed) return after;
  if (changes.affected && changes.usable) return spliceCanvasLayout(after, stored, rebased);
  const canvases = rebased.flatMap(({ canvas, roots, associations }) => {
    if (!roots.length) return [];
    const input = { id: canvas.id, roots, ...(canvas.viewport ? { viewport: canvas.viewport } : {}) };
    const encoded = encodeStudioCanvas(after, [input]).canvases[0];
    const groups = canvas.groups?.map(group => ({ ...group, nodeIds: [...new Set(group.nodeIds.flatMap(id => associations
      .filter(association => association.old === id).flatMap(association => encoded.nodes
        .filter(node => node.rootId === encoded.roots[association.root].id && node.nodeId === association.node).map(node => node.id))))] }));
    return [{ ...input, ...(groups ? { groups } : {}) }];
  });
  const encoded = encodeStudioCanvas(after, canvases, stored.bundles);
  return sameJson(stored, encoded) ? after : { ...after, studioCanvas: encoded };
}

/**
 * The encoding `encodeStudioCanvas` would give, built without re-resolving roots the edit did not reach: those are stored
 * entries of usable metadata whose reads are unchanged. Rebased roots are encoded (and so checked) on their own, then the
 * cross-root rules (unique root IDs, groups over existing nodes) are checked over the whole result.
 */
function spliceCanvasLayout(after: CompositionDocument, stored: StoredStudioCanvasMetadata, rebased: readonly {
  canvas: StoredStudioCanvasMetadata['canvases'][number];
  roots: readonly CanvasLayoutInput['roots'][number][];
  associations: readonly { old: string; root: number; node: string }[];
  kept: readonly (StoredStudioCanvasMetadata['canvases'][number]['roots'][number] | undefined)[];
}[]): CompositionDocument {
  const invalid = () => new CompositionValidationError([{ code: 'invalid_value', pointer: '/studioCanvas' }]);
  const rootIds = new Set<string>();
  const canvases = rebased.flatMap(({ canvas, roots, associations, kept }) => {
    if (!roots.length) return [];
    const fresh = roots.filter((_, index) => !kept[index]);
    const encoded = fresh.length ? encodeStudioCanvas(after, [{ id: canvas.id, roots: fresh }]).canvases[0] : undefined;
    let next = 0;
    const merged = roots.map((_, index) => {
      const root = kept[index] ?? encoded!.roots[next++];
      const nodes = kept[index] ? canvas.nodes.filter(node => node.rootId === root.id) : encoded!.nodes.filter(node => node.rootId === root.id);
      if (rootIds.has(root.id)) throw invalid();
      rootIds.add(root.id);
      return { root, nodes };
    });
    const nodes = merged.flatMap(entry => entry.nodes);
    const groups = canvas.groups?.map(group => ({ ...group, nodeIds: [...new Set(group.nodeIds.flatMap(id => associations
      .filter(association => association.old === id).flatMap(association => nodes
        .filter(node => node.rootId === merged[association.root].root.id && node.nodeId === association.node).map(node => node.id))))] }));
    return [{ id: canvas.id, roots: merged.map(entry => entry.root), nodes, ...(canvas.viewport ? { viewport: canvas.viewport } : {}), ...(groups ? { groups } : {}) }];
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
