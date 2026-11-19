import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { lift, type ASTReplacement } from '../../shared/composition/graph';
import { canonicalOfBounded } from '../../shared/composition/json';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../canvas/FlowCanvas';
import { fieldAnchor, fieldPointer, pointerPath } from './registry';
import { valueAt, type EditorPath } from '../../composition-editor';

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
  const id = canonicalOfBounded(roots.map(root => root.anchor));
  const encoded = encodeStudioCanvas(document, [{ id, roots }]);
  const stored = old.present ? studioCanvasMetadataSchema.parse(old.raw) : undefined;
  const ownAnchors = new Set([...roots.map(root => canonicalOfBounded(root.anchor)), ...previous.paths.map(path => canonicalOfBounded(fieldAnchor(previous.document, path)))]);
  const canvases = stored?.canvases.filter(canvas => !canvas.roots.some(root => ownAnchors.has(canonicalOfBounded(root.anchor)))) ?? [];
  return { ...document, studioCanvas: { ...encoded, canvases: [...canvases, ...encoded.canvases], ...(stored?.bundles ? { bundles: stored.bundles } : {}) } };
}
