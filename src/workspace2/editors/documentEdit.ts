import { valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { fieldKind, fieldSteps, ownedSources } from '../../shared/composition/components';
import { atPointer, record, resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { readStudioCanvas } from '../../shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema } from '../../shared/composition/studio-logic/schemas';
import { sameJson } from '../../sameJson';
import { isUse, usesOf } from '../data/logic/logicModel';
import { fieldAnchor, fieldPointer, pointerPath } from '../logic-fields/registry';

function objectPaths(value: unknown): Map<object, EditorPath[]> {
  const paths = new Map<object, EditorPath[]>();
  const visit = (value: unknown, path: EditorPath) => {
    if (value === null || typeof value !== 'object') return;
    paths.set(value, [...paths.get(value) ?? [], path]);
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(value, []);
  return paths;
}

/** Match immutable subtrees first; changed containers retain fields, never another array item's identity. */
function referencePaths(before: CompositionDocument, after: CompositionDocument, old: Map<object, EditorPath[]>, next: Map<object, EditorPath[]>) {
  const sameOwner = (left: EditorPath, right: EditorPath) => {
    const from = fieldAnchor(before, left), to = fieldAnchor(after, right);
    return from.kind === to.kind && from.id === to.id
      && ('nodeId' in from ? from.nodeId : undefined) === ('nodeId' in to ? to.nodeId : undefined);
  };
  return (pointer: string): EditorPath | undefined => {
    const path = pointerPath(pointer);
    for (let depth = path.length; depth > 0; depth--) {
      const value = valueAt(before, path.slice(0, depth));
      if (value === null || typeof value !== 'object') continue;
      let matches = next.get(value);
      // Lowering rebuilds AST objects. Only a referenced, uniquely surviving use may
      // acquire that correspondence; equal-looking siblings already have their own identity.
      if (!matches && isUse(value)) {
        const candidates = usesOf(after, value.logicId).filter(use => {
          const candidate = valueAt(after, use.path);
          return candidate !== null && typeof candidate === 'object' && !old.has(candidate)
            && sameOwner(path.slice(0, depth), use.path) && sameJson(value, candidate);
        });
        if (candidates.length) {
          const previous = usesOf(before, value.logicId).filter(use => {
            const candidate = valueAt(before, use.path);
            return candidate !== null && typeof candidate === 'object' && !next.has(candidate)
              && sameOwner(use.path, candidates[0].path) && sameJson(value, candidate);
          });
          if (candidates.length !== 1 || previous.length !== 1) throw new Error('This edit makes the template bindings ambiguous.');
          matches = [candidates[0].path];
          next.set(value, matches);
        }
      }
      if (!matches?.length) continue;
      if (matches.length !== 1) throw new Error('This edit makes the binding target ambiguous.');
      const moved = [...matches[0], ...path.slice(depth)];
      return valueAt(after, moved) === undefined ? undefined : moved;
    }
    let left: unknown = before, right: unknown = after;
    const moved: EditorPath = [];
    for (const key of path) {
      if (Array.isArray(left) && Array.isArray(right)) {
        const item: unknown = left[Number(key)];
        let index = right.indexOf(item);
        if (index < 0 && record(item) && typeof item.id === 'string') {
          const matches = right.flatMap((candidate, index) => record(candidate) && candidate.id === item.id ? [index] : []);
          if (matches.length > 1) throw new Error('This edit makes the binding owner ambiguous.');
          index = matches[0] ?? -1;
        }
        if (index < 0) {
          index = Number(key);
          const candidate: unknown = right[index];
          if (left.length !== right.length || candidate !== null && typeof candidate === 'object' && old.has(candidate)) return;
        }
        left = item; right = right[index]; moved.push(index);
      } else {
        if (!record(left) || !record(right)) return;
        if (isUse(left) && (!isUse(right) || left.logicId !== right.logicId)) return;
        left = Reflect.get(left, key); right = Reflect.get(right, key); moved.push(key);
      }
      if (right === undefined) return;
    }
    return moved;
  };
}

/**
 * The document edit boundary, before either history records the change. Explicit metadata edits win;
 * otherwise references follow surviving authored subtrees or are removed with their targets.
 */
export function documentEdit(before: CompositionDocument, edit: CompositionDocument): CompositionDocument {
  if (before === edit || sameJson(before, edit)) return edit;
  if (!before.logicUseBindings?.length && !before.componentLibrary?.some(entry => entry.bindings?.length) && !before.studioCanvas) return edit;
  const oldObjects = objectPaths(before), newObjects = objectPaths(edit);
  const locate = referencePaths(before, edit, oldObjects, newObjects);
  let next = edit;
  const resolved = before.logicUseBindings?.length ? resolveLogicUseBindings(before).bindings : [];
  if (next.logicUseBindings?.length && resolved.length) {
    const uses = new Map<string, ReturnType<typeof usesOf>>();
    const bindings = next.logicUseBindings.flatMap(binding => {
      const index = before.logicUseBindings!.findIndex(old => old === binding || sameJson(old, binding));
      if (index < 0) return [binding];
      const path = locate(resolved[index].usePointer);
      if (!path || !locate(`${resolved[index].usePointer}/args/${binding.argument}`) || !locate(resolved[index].sourcePointer)) return [];
      let candidates = uses.get(binding.logicId);
      if (!candidates) { candidates = usesOf(edit, binding.logicId); uses.set(binding.logicId, candidates); }
      if (!candidates.some(use => fieldPointer(use.path) === fieldPointer(path))) return [];
      const use = fieldAnchor(edit, path);
      return [sameJson(use, binding.use) ? binding : { ...binding, use }];
    });
    if (!sameJson(bindings, next.logicUseBindings)) next = { ...next, logicUseBindings: bindings };
  }
  if (next.componentLibrary) {
    const library = next.componentLibrary.map(entry => {
      const previous = before.componentLibrary?.find(old => old.id === entry.id);
      if (!previous?.bindings?.length || !entry.bindings?.length) return entry;
      const bindings = entry.bindings.flatMap(binding => {
        if (!previous.bindings!.some(old => old === binding || sameJson(old, binding))) return [binding];
        const oldField = fieldPointer(fieldSteps(binding.field));
        const anchor = { kind: 'component' as const, id: entry.id, ...(binding.nodeId ? { nodeId: binding.nodeId } : {}), field: oldField };
        let target = binding.nodeId ? resolveLogicAnchor(before, anchor)?.pointer : undefined;
        if (binding.sourceId) {
          const source = ownedSources(previous).find(source => source.id === binding.sourceId);
          const paths = source && oldObjects.get(source);
          if (paths?.length === 1) target = `${fieldPointer(paths[0])}${oldField}`;
        }
        const param = entry.params?.find(param => param.name === binding.param);
        // A value setting can address an absent optional field; its existing holder still has an identity.
        const optional = target === undefined && param?.kind === 'value' && binding.nodeId
          ? resolveLogicAnchor(before, { ...anchor, field: fieldPointer(fieldSteps(binding.field).slice(0, -1)) }) : undefined;
        if (optional) target = optional.pointer;
        if (target === undefined) return [binding];
        const holder = locate(target);
        const path = holder && optional ? [...holder, fieldSteps(binding.field).at(-1)!] : holder;
        if (!path) return [];
        if (binding.nodeId) {
          const holderPath = optional ? path.slice(0, -1) : path;
          const node = optional && resolveLogicAnchor(edit, { ...anchor, field: '' });
          const base = node && node.pointer === fieldPointer(holderPath) ? { ...anchor, field: '' } : fieldAnchor(edit, holderPath);
          const address = optional ? { ...base, field: `${base.field}${fieldPointer(path.slice(-1))}` } : base;
          if (address.kind !== 'component' || address.id !== entry.id || !address.nodeId) return [];
          const owner = resolveLogicAnchor(edit, { ...address, field: '' });
          if (param?.kind !== 'value' && fieldKind(owner?.value, address.field) !== param?.kind) return [];
          const field = fieldSteps(address.field).join('/');
          return [field === fieldSteps(binding.field).join('/') && address.nodeId === binding.nodeId ? binding : { ...binding, nodeId: address.nodeId, field }];
        }
        const source = ownedSources(entry).find(source => source.id === binding.sourceId);
        const paths = source && newObjects.get(source);
        if (paths?.length !== 1) return [];
        const base = fieldPointer(paths[0]), pointer = fieldPointer(path);
        if (!pointer.startsWith(`${base}/`)) return [];
        const field = pointerPath(pointer.slice(base.length)).join('/');
        if (param?.kind !== 'value' && fieldKind(source, field) !== param?.kind) return [];
        return [field === fieldSteps(binding.field).join('/') ? binding : { ...binding, field }];
      });
      return sameJson(bindings, entry.bindings) ? entry : { ...entry, bindings };
    });
    if (library.some((entry, index) => entry !== next.componentLibrary![index])) next = { ...next, componentLibrary: library };
  }
  // Layout is advisory, but must not keep origins that now identify another block. Never repair invalid imported layout.
  if (before.studioCanvas && before.studioCanvas === edit.studioCanvas && readStudioCanvas(before).metadata) {
    const stored = studioCanvasMetadataSchema.parse(before.studioCanvas);
    const canvases = stored.canvases.filter(canvas => canvas.roots.every(root => {
      const resolved = resolveLogicAnchor(before, root.anchor);
      if (!resolved || !sameJson(resolveLogicAnchor(next, root.anchor)?.pointer, resolved.pointer)) return false;
      return canvas.nodes.filter(node => node.rootId === root.id).every(node => node.origins.every(origin => {
        const pointer = `${resolved.pointer}${origin}`, path = locate(pointer);
        return path !== undefined && fieldPointer(path) === pointer && atPointer(next, pointer) !== undefined;
      }));
    }));
    if (canvases.length !== stored.canvases.length) next = { ...next, studioCanvas: { ...stored, canvases } };
  }
  if (next.logicUseBindings?.length) resolveLogicUseBindings(next);
  return next;
}
