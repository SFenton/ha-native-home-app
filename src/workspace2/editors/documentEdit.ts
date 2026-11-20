import { valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { fieldSteps, ownedSources } from '../../shared/composition/components';
import { record, resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { sameJson } from '../../sameJson';
import { isUse, usesOf } from '../data/logic/logicModel';
import { authoredNodes, fieldAnchor, fieldPointer, pointerPath } from '../logic-fields/registry';
import { rebaseCanvasLayout } from '../logic-fields/layout';

export interface EditReferences {
  readonly relocated?: ReadonlyMap<string, readonly string[]>;
  readonly copied?: readonly { from: EditorPath; to: EditorPath }[];
}

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
  const previousNodes = authoredNodes(before), followingNodes = authoredNodes(after);
  const identities = new Map<object, string>(previousNodes.map(location => [location.node, location.identity]));
  const sameOwner = (left: EditorPath, right: EditorPath) => {
    const from = fieldAnchor(before, left), to = fieldAnchor(after, right);
    if ('nodeId' in from && from.nodeId && 'nodeId' in to && to.nodeId) {
      return from.nodeId === to.nodeId && (from.kind === 'component' || to.kind === 'component'
        ? from.kind === to.kind && from.id === to.id : true);
    }
    return from.kind === to.kind && from.id === to.id
      && ('nodeId' in from ? from.nodeId : undefined) === ('nodeId' in to ? to.nodeId : undefined);
  };
  const follow = (left: unknown, right: unknown, tail: EditorPath, base: EditorPath): EditorPath | undefined => {
    const moved = [...base];
    for (const key of tail) {
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
  return (pointer: string): EditorPath | undefined => {
    const path = pointerPath(pointer);
    for (let depth = path.length; depth > 0; depth--) {
      const value = valueAt(before, path.slice(0, depth));
      if (value === null || typeof value !== 'object') continue;
      let matches = next.get(value);
      const identity = identities.get(value);
      if (!matches && identity) {
        const nodes = followingNodes.filter(location => location.identity === identity);
        if (nodes.length > 1 || previousNodes.filter(location => location.identity === identity).length > 1) {
          throw new Error('This edit makes the binding node ambiguous.');
        }
        if (nodes.length) matches = [nodes[0].path];
      }
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
      if (matches.length !== 1) continue;
      return follow(value, valueAt(after, matches[0]), path.slice(depth), matches[0]);
    }
    return follow(before, after, path, []);
  };
}

/**
 * The document edit boundary, before either history records the change. Explicit metadata edits win;
 * otherwise references follow surviving authored subtrees or are removed with their targets.
 */
export function documentEdit(before: CompositionDocument, edit: CompositionDocument, references: EditReferences = {}): CompositionDocument {
  if (before === edit || sameJson(before, edit)) return edit;
  if (!before.logicUseBindings?.length && !before.componentLibrary?.some(entry => entry.bindings?.length) && !before.studioCanvas) return edit;
  const oldObjects = objectPaths(before), newObjects = objectPaths(edit);
  const locate = referencePaths(before, edit, oldObjects, newObjects);
  const locateAll = (pointer: string): EditorPath[] => {
    const remap = [...references.relocated ?? []].filter(([from]) => pointer === from || pointer.startsWith(`${from}/`))
      .sort(([left], [right]) => right.length - left.length)[0];
    const found = remap ? remap[1].map(to => pointerPath(`${to}${pointer.slice(remap[0].length)}`)) : [locate(pointer)].filter(path => path !== undefined);
    for (const copy of references.copied ?? []) {
      const from = fieldPointer(copy.from);
      if (pointer === from || pointer.startsWith(`${from}/`)) found.push(pointerPath(`${fieldPointer(copy.to)}${pointer.slice(from.length)}`));
    }
    return found.filter(path => valueAt(edit, path) !== undefined);
  };
  let next = edit;
  const resolved = before.logicUseBindings?.length ? resolveLogicUseBindings(before).bindings : [];
  if (next.logicUseBindings?.length && resolved.length) {
    const uses = new Map<string, ReturnType<typeof usesOf>>();
    const bindings = next.logicUseBindings.flatMap(binding => {
      const index = before.logicUseBindings!.findIndex(old => old === binding || sameJson(old, binding));
      if (index < 0) return [binding];
      const paths = locateAll(resolved[index].usePointer);
      if (!locateAll(`${resolved[index].usePointer}/args/${binding.argument}`).length || !locateAll(resolved[index].sourcePointer).length) return [];
      let candidates = uses.get(binding.logicId);
      if (!candidates) { candidates = usesOf(edit, binding.logicId); uses.set(binding.logicId, candidates); }
      return paths.flatMap(path => {
        if (!candidates.some(use => fieldPointer(use.path) === fieldPointer(path))) return [];
        const use = fieldAnchor(edit, path);
        return [sameJson(use, binding.use) ? binding : { ...binding, use }];
      });
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
        let paths = target === undefined ? [] : locateAll(target), optional = false;
        if (!paths.length && param?.kind === 'value') {
          const holder = target === undefined
            ? resolveLogicAnchor(before, { ...anchor, field: fieldPointer(fieldSteps(binding.field).slice(0, -1)) })?.pointer
            : fieldPointer(pointerPath(target).slice(0, -1));
          if (holder !== undefined) {
            optional = true;
            paths = locateAll(holder).map(path => [...path, fieldSteps(binding.field).at(-1)!]);
          }
        }
        if (target === undefined && !optional) return [binding];
        return paths.flatMap(path => {
          if (binding.nodeId) {
            const holderPath = optional ? path.slice(0, -1) : path;
            const node = optional && resolveLogicAnchor(edit, { ...anchor, field: '' });
            const base = node && node.pointer === fieldPointer(holderPath) ? { ...anchor, field: '' } : fieldAnchor(edit, holderPath);
            const address = optional ? { ...base, field: `${base.field}${fieldPointer(path.slice(-1))}` } : base;
            if (address.kind !== 'component' || address.id !== entry.id || !address.nodeId) return [];
            const field = fieldSteps(address.field).join('/');
            return [field === fieldSteps(binding.field).join('/') && address.nodeId === binding.nodeId ? binding : { ...binding, nodeId: address.nodeId, field }];
          }
          const source = ownedSources(entry).find(source => source.id === binding.sourceId);
          const paths = source && newObjects.get(source);
          if (paths?.length !== 1) return [];
          const base = fieldPointer(paths[0]), pointer = fieldPointer(path);
          if (!pointer.startsWith(`${base}/`)) return [];
          const field = pointerPath(pointer.slice(base.length)).join('/');
          return [field === fieldSteps(binding.field).join('/') ? binding : { ...binding, field }];
        });
      });
      return sameJson(bindings, entry.bindings) ? entry : { ...entry, bindings };
    });
    if (library.some((entry, index) => entry !== next.componentLibrary![index])) next = { ...next, componentLibrary: library };
  }
  next = rebaseCanvasLayout(before, next, locateAll);
  if (next.logicUseBindings?.length) resolveLogicUseBindings(next);
  return next;
}
