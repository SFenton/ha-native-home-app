import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { expandLogic, logicSampleArguments, type LogicEntry } from '../../shared/composition/logic-library';
import { lift, type CanvasLens, type LogicGraph } from '../../shared/composition/graph';
import { projectGraph } from '../../shared/composition/graph/lower';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { isUse, usesOf } from '../data/logic/logicModel';
import type { Json } from '../../shared/types';
import { fieldAnchor, fieldPointer, pointerPath } from './registry';
import { materializeUseBindings } from './templates';

export function templateUses(document: CompositionDocument, entry: LogicEntry) {
  const resolved = resolveLogicUseBindings(document).document;
  return usesOf(document, entry.id).map(use => ({
    ...use, anchor: fieldAnchor(document, use.path),
    value: valueAt(resolved, use.path) as { args: Record<string, Json> },
    label: [use.place, use.nodeTitle, use.field].filter((part, index, parts) => part && parts.indexOf(part) === index).join(' / '),
  }));
}

/** Project a read-only lens. The canonical graph, template samples and real arguments remain untouched. */
export function previewGraph(document: CompositionDocument, working: LogicGraph, path: EditorPath, lens: CanvasLens,
  tryWith?: Readonly<Record<string, Json>>): LogicGraph {
  const projected = projectGraph(working);
  const edited = replaceAt(document, path, projected.ast);
  const bound = resolveLogicUseBindings(edited).document as CompositionDocument;
  const entry = path[0] === 'logicLibrary' ? bound.logicLibrary?.[Number(path[1])] : undefined;
  let value: Json;
  if (entry) {
    let args: unknown = tryWith ?? logicSampleArguments(entry);
    if (lens.kind === 'use') {
      const use = resolveLogicAnchor(bound, lens.anchor);
      if (!use || !isUse(use.value) || use.value.logicId !== entry.id) {
        throw new Error('The preview use no longer refers to this template.');
      }
      args = use.value.args;
      const usePath = pointerPath(use.pointer);
      if (usePath[0] === 'logicLibrary') {
        const owner = bound.logicLibrary?.[Number(usePath[1])];
        if (owner) {
          const library = bound.logicLibrary!.map(item => item.id === owner.id ? { ...item, body: use.value } : item);
          const expanded = expandLogic({ logicLibrary: library, value: { type: 'logic-ref', logicId: owner.id, args: logicSampleArguments(owner) } }).document as { value: Json };
          value = expanded.value;
          return remapPreviewGraph(value, working, bound, path);
        }
      }
    }
    value = (expandLogic({ logicLibrary: bound.logicLibrary, value: { type: 'logic-ref', logicId: entry.id, args } }).document as { value: Json }).value;
  } else value = (expandLogic({ ...(bound.logicLibrary ? { logicLibrary: bound.logicLibrary } : {}), value: valueAt(bound, path) }).document as { value: Json }).value;
  return remapPreviewGraph(value, working, bound, path);
}
function remapPreviewGraph(value: Json, working: LogicGraph, document: CompositionDocument, path: EditorPath): LogicGraph {
  const root = working.roots[0], graph = lift(value, { anchor: root.anchor, kind: root.destination.kind,
    ...(root.destination.kind === 'slot' ? { context: {
      document: replaceAt(materializeUseBindings(document, path), path, value) as unknown as Json, pointer: fieldPointer(path),
    } } : {}),
  }).graph;
  const originals = new Map(working.nodes.flatMap(node => node.origins.map(origin => [origin, node] as const)));
  const used = new Set(working.nodes.map(node => node.id));
  const ids = new Map(graph.nodes.map(node => {
    const original = originals.get(node.origins[0]);
    if (original) return [node.id, original.id];
    let id = `preview-${node.id}`;
    while (used.has(id)) id = `preview-${id}`;
    used.add(id);
    return [node.id, id];
  }));
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({ ...node, id: ids.get(node.id)!, position: originals.get(node.origins[0])?.position ?? node.position })),
    edges: graph.edges.map(edge => ({ ...edge, from: { ...edge.from, nodeId: ids.get(edge.from.nodeId)! }, to: { ...edge.to, nodeId: ids.get(edge.to.nodeId)! } })),
    roots: graph.roots.map(root => ({ ...root, nodeId: ids.get(root.nodeId)! })),
    scopes: graph.scopes.map(scope => ({ ...scope, ...(scope.ownerNodeId ? { ownerNodeId: ids.get(scope.ownerNodeId)! } : {}) })),
  };
}
