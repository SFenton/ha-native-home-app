/**
 * TEST-ONLY REFERENCE ORACLE. A verbatim copy of `src/workspace2/editors/documentEdit.ts` at commit 5b28fc4, the last whole-document
 * reconciliation before dependency scoping; only import paths differ. `edit-oracle.test.ts` checks the scoped
 * implementation against it on seeded random edit sequences. Never import this from `src/`, and never "fix" it: its
 * behavior is the specification the scoped `documentEdit` must reproduce (see the documented deviations in that test).
 */
import { valueAt, type EditorPath } from '../../../../src/composition-editor';
import type { CompositionDocument } from '../../../../src/shared/composition/schema';
import { fieldSteps, ownedSources } from '../../../../src/shared/composition/components';
import { resolveLogicAnchor } from '../../../../src/shared/composition/studio-logic/anchors';
import { resolveLogicUseBindings } from '../../../../src/shared/composition/studio-logic/bindings';
import { sameJson } from '../../../../src/sameJson';
import { usesOf } from '../../../../src/workspace2/data/logic/logicModel';
import { fieldAnchor, fieldPointer, pointerPath } from '../../../../src/workspace2/logic-fields/registry';
import { rebaseCanvasLayout } from './layout';
import { canonicalOfBounded, CompositionValidationError } from '../../../../src/shared/composition/json';
import { toastManager } from '../../../../src/workspace2/toasts';
import { readStudioCanvas } from '../../../../src/shared/composition/studio-logic/layout';
import { studioCanvasMetadataSchema, type StoredStudioCanvasMetadata } from '../../../../src/shared/composition/studio-logic/schemas';

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
const validated = new WeakMap<CompositionDocument, CompositionDocument>();
const inside = (pointer: string, base: string) => pointer === base || pointer.startsWith(`${base}/`);

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
  if (before === edit || sameJson(before, edit) && !references.relocated?.size && !references.copied?.length) return edit;
  const linked = (document: CompositionDocument) => document.logicUseBindings?.length || document.componentLibrary?.some(entry => entry.bindings?.length) || document.studioCanvas;
  if (!linked(before) && !linked(edit)) return edit;
  const oldObjects = objectPaths(before), newObjects = objectPaths(edit);
  const locate = referencePaths(before, newObjects);
  const deleted = (pointer: string) => (references.deleted ?? []).some(path => inside(pointer, fieldPointer(path)))
    || [...references.relocated ?? []].some(([from, to]) => !to.length && inside(pointer, from));
  const declared = (pointer: string) => deleted(pointer)
    || [...references.relocated ?? []].some(([from]) => inside(pointer, from));
  const componentTarget = (document: CompositionDocument, entry: NonNullable<CompositionDocument['componentLibrary']>[number],
    binding: NonNullable<typeof entry.bindings>[number], objects: Map<object, EditorPath[]>): string | undefined => {
    const field = fieldPointer(fieldSteps(binding.field));
    if (binding.nodeId) {
      const anchor = { kind: 'component' as const, id: entry.id, nodeId: binding.nodeId, field };
      const resolved = resolveLogicAnchor(document, anchor);
      if (resolved) return resolved.pointer;
      if (entry.params?.find(param => param.name === binding.param)?.kind !== 'value') return undefined;
      const steps = fieldSteps(binding.field), holder = resolveLogicAnchor(document, { ...anchor, field: fieldPointer(steps.slice(0, -1)) });
      return holder ? `${holder.pointer}${fieldPointer(steps.slice(-1))}` : undefined;
    }
    const source = ownedSources(entry).find(source => source.id === binding.sourceId);
    const base = fieldPointer(['componentLibrary', document.componentLibrary!.findIndex(old => old.id === entry.id)]);
    const paths = source && objects.get(source)?.filter(path => inside(fieldPointer(path), base));
    const pointer = paths?.length === 1 ? `${fieldPointer(paths[0])}${field}` : undefined;
    return pointer !== undefined && valueAt(document, pointerPath(pointer)) !== undefined ? pointer : undefined;
  };
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
  const resolved = before.logicUseBindings?.length ? resolveLogicUseBindings(before).bindings : [];
  before.logicUseBindings?.forEach((binding, index) => {
    if (!edit.logicUseBindings?.some(next => next === binding || sameJson(next, binding)) && !declared(resolved[index].usePointer)) refuse();
  });
  if (next.logicUseBindings?.length && resolved.length) {
    const uses = new Map<string, ReturnType<typeof usesOf>>();
    const seen = new Map<string, NonNullable<CompositionDocument['logicUseBindings']>[number]>();
    const bindings = next.logicUseBindings.flatMap(binding => {
      const index = before.logicUseBindings!.findIndex(old => old === binding || sameJson(old, binding));
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
        const use = fieldAnchor(edit, path);
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
    if (entry.bindings?.length && !next.componentLibrary?.some(next => next.id === entry.id) && !declared(fieldPointer(['componentLibrary', index]))) refuse();
  }
  if (next.componentLibrary) {
    const library = next.componentLibrary.map(entry => {
      const previous = before.componentLibrary?.find(old => old.id === entry.id);
      if (!previous?.bindings?.length) return entry;
      for (const [bindingIndex, binding] of previous.bindings.entries()) {
        if (entry.bindings?.some(next => next === binding || sameJson(next, binding))) continue;
        if (deleted(fieldPointer(['componentLibrary', before.componentLibrary!.indexOf(previous), 'bindings', bindingIndex]))) continue;
        const target = componentTarget(before, previous, binding, oldObjects);
        if (target === undefined || !declared(target)) refuse();
      }
      if (!entry.bindings?.length) return entry;
      const bindings = entry.bindings.flatMap(binding => {
        if (!previous.bindings!.some(old => old === binding || sameJson(old, binding))) return [binding];
        const oldField = fieldPointer(fieldSteps(binding.field));
        const anchor = { kind: 'component' as const, id: entry.id, ...(binding.nodeId ? { nodeId: binding.nodeId } : {}), field: oldField };
        const target = componentTarget(before, previous, binding, oldObjects);
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
            const base = node && node.pointer === fieldPointer(holderPath) ? { ...anchor, field: '' } : fieldAnchor(edit, holderPath);
            const address = optional ? { ...base, field: `${base.field}${fieldPointer(path.slice(-1))}` } : base;
            if (address.kind !== 'component' || address.id !== entry.id || !address.nodeId) return [];
            const field = fieldSteps(address.field).join('/');
            return [field === fieldSteps(binding.field).join('/') && address.nodeId === binding.nodeId ? binding : { ...binding, nodeId: address.nodeId, field }];
          }
          const source = ownedSources(entry).find(source => source.id === binding.sourceId);
          const owner = fieldPointer(['componentLibrary', edit.componentLibrary!.findIndex(next => next.id === entry.id)]);
          const paths = source && newObjects.get(source)?.filter(path => inside(fieldPointer(path), owner));
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
  next = rebaseCanvasLayout(before, next, locateAll, {
    fields: references.fields, discard: references.discardLayouts,
    deleted, refuse,
  });
  const targets = objectPaths(next);
  for (const entry of next.componentLibrary ?? []) for (const binding of entry.bindings ?? []) {
    if (!entry.params?.some(param => param.name === binding.param) || componentTarget(next, entry, binding, targets) === undefined) refuse();
  }
  if (next.studioCanvas && !sameJson(before.studioCanvas, next.studioCanvas) && readStudioCanvas(next).warnings.length) refuse();
  if (next.logicUseBindings?.length) resolveLogicUseBindings(next);
  return next;
}
