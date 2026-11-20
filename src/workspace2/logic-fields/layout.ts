import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { lift, type ASTReplacement } from '../../shared/composition/graph';
import { canonicalOfBounded } from '../../shared/composition/json';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, readStudioCanvas, type CanvasLayoutInput } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import { fieldAnchor, fieldPointer, pointerPath } from './registry';
import { valueAt, type EditorPath } from '../../composition-editor';
import { sameJson } from '../../sameJson';

export function rebaseCanvasLayout(before: CompositionDocument, after: CompositionDocument, locate: (pointer: string) => EditorPath[]): CompositionDocument {
  if (!before.studioCanvas || !sameJson(before.studioCanvas, after.studioCanvas) || !readStudioCanvas(before).metadata) return after;
  const stored = studioCanvasMetadataSchema.parse(before.studioCanvas);
  const { studioCanvas: _layout, ...semantic } = after;
  const canvases = stored.canvases.flatMap(canvas => {
    const associations: { old: string; root: number; node: string }[] = [];
    const roots: CanvasLayoutInput['roots'][number][] = [];
    for (const root of canvas.roots) {
      const pointer = root.anchor.kind === 'document' && root.anchor.field === '' ? '' : resolveLogicAnchor(before, root.anchor)?.pointer;
      if (pointer === undefined) continue;
      for (const path of locate(pointer)) {
        const anchor = fieldAnchor(semantic, path), base = fieldPointer(path);
        const graph = lift(valueAt(semantic, path) as Json, { anchor, context: { document: semantic as unknown as Json, pointer: base } }).graph;
        const nodes = new Map<string, CanvasLayoutInput['roots'][number]['nodes'][number]>();
        for (const old of canvas.nodes.filter(node => node.rootId === root.id)) {
          const origins = new Set(old.origins.flatMap(origin => locate(`${pointer}${origin}`))
            .map(fieldPointer).filter(at => at === base || at.startsWith(`${base}/`)).map(at => at.slice(base.length)));
          for (const node of graph.nodes.filter(node => node.origins.every(origin => origins.has(origin)))) {
            const previous = nodes.get(node.id);
            if (previous && (previous.x !== old.x || previous.y !== old.y)) throw new Error('This edit makes the saved canvas positions ambiguous.');
            nodes.set(node.id, { id: node.id, origins: node.origins, x: old.x, y: old.y });
            associations.push({ old: old.id, root: roots.length, node: node.id });
          }
        }
        roots.push({ anchor, nodes: [...nodes.values()] });
      }
    }
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
  return { ...document, studioCanvas: encodeStudioCanvas(document, canvases, stored?.bundles) };
}
