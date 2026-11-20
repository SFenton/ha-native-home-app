/**
 * TEST-ONLY REFERENCE ORACLE. A verbatim copy of `src/workspace2/logic-fields/layout.ts` at commit 5b28fc4, the last whole-document
 * reconciliation before dependency scoping; only import paths differ. `edit-oracle.test.ts` checks the scoped
 * implementation against it on seeded random edit sequences. Never import this from `src/`, and never "fix" it: its
 * behavior is the specification the scoped `documentEdit` must reproduce (see the documented deviations in that test).
 */
import type { CompositionDocument } from '../../../../src/shared/composition/schema';
import type { Json } from '../../../../src/shared/types';
import { lift, type ASTReplacement } from '../../../../src/shared/composition/graph';
import { canonicalOfBounded } from '../../../../src/shared/composition/json';
import { resolveLogicAnchor } from '../../../../src/shared/composition/studio-logic/anchors';
import { encodeStudioCanvas, readStudioCanvas, type CanvasLayoutInput } from '../../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../../../src/shared/composition/studio-logic/schemas';
import type { CanvasLayoutHandoff } from '../../../../src/workspace2/canvas/FlowCanvas';
import { fieldAnchor, fieldPointer, pointerPath } from '../../../../src/workspace2/logic-fields/registry';
import { valueAt, type EditorPath } from '../../../../src/composition-editor';
import { sameJson } from '../../../../src/sameJson';
import { documentEdit, LINKED_EDIT_REFUSAL } from './documentEdit';

export function rebaseCanvasLayout(before: CompositionDocument, after: CompositionDocument, locate: (pointer: string) => EditorPath[],
  changes: { fields?: ReadonlyMap<string, readonly string[]>; discard?: readonly EditorPath[]; deleted(pointer: string): boolean; refuse(): never },
): CompositionDocument {
  if (!before.studioCanvas || !sameJson(before.studioCanvas, after.studioCanvas) || !readStudioCanvas(before).metadata) return after;
  const stored = studioCanvasMetadataSchema.parse(before.studioCanvas);
  const { studioCanvas: _layout, ...semantic } = after;
  const canvases = stored.canvases.flatMap(canvas => {
    const associations: { old: string; root: number; node: string }[] = [];
    const roots: CanvasLayoutInput['roots'][number][] = [];
    for (const root of canvas.roots) {
      const pointer = root.anchor.kind === 'document' && root.anchor.field === '' ? '' : resolveLogicAnchor(before, root.anchor)?.pointer;
      if (pointer === undefined) continue;
      if (changes.discard?.some(path => pointer === fieldPointer(path) || pointer.startsWith(`${fieldPointer(path)}/`))) continue;
      const destinations = changes.fields?.get(pointer)?.map(pointerPath) ?? locate(pointer);
      if (!destinations.length && !changes.deleted(pointer)) changes.refuse();
      for (const path of destinations) {
        const anchor = fieldAnchor(semantic, path), base = fieldPointer(path);
        const graph = lift(valueAt(semantic, path) as Json, { anchor, context: { document: semantic as unknown as Json, pointer: base } }).graph;
        const nodes = new Map<string, CanvasLayoutInput['roots'][number]['nodes'][number]>();
        for (const old of canvas.nodes.filter(node => node.rootId === root.id)) {
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
