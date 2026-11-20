import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { argFits, expandKeepingHoles, expandLogic, type LogicEntry, type LogicRef } from '../../shared/composition/logic-library';
import { canonicalOfBounded } from '../../shared/composition/json';
import { resolveLogicUseBindings, unbindLogicUse } from '../../shared/composition/studio-logic/bindings';
import { record, resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { logicUseBindingsSchema } from '../../shared/composition/studio-logic/schemas';
import type { Json } from '../../shared/types';
import { fieldPointer, pointerPath } from './registry';
import { fieldSteps } from '../../shared/composition/components';
import { editSubtrees } from '../editors/provenance';

const resolvedValues = new WeakMap<object, WeakMap<object, unknown>>();
export function resolvedLogicValue<T>(document: unknown, value: T): T {
  if (!record(document) || !Array.isArray(document.logicUseBindings) || !document.logicUseBindings.length) return value;
  let values = resolvedValues.get(document);
  if (!values) {
    values = new WeakMap<object, unknown>();
    const resolved = resolveLogicUseBindings(document);
    for (const binding of resolved.bindings) {
      const path = pointerPath(binding.usePointer), authored = valueAt(document, path);
      if (authored && typeof authored === 'object') values.set(authored, valueAt(resolved.document, path));
    }
    resolvedValues.set(document, values);
  }
  const project = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (values.has(item)) return values.get(item);
    const entries = Object.entries(item).map(([key, child]) => [key, project(child)] as const);
    const projected = entries.every(([key, child]) => Reflect.get(item, key) === child) ? item
      : Array.isArray(item) ? entries.map(([, child]) => child) : Object.fromEntries(entries);
    values.set(item, projected);
    return projected;
  };
  return project(value) as T;
}

export function explicitTemplateUse(entry: LogicEntry, args: Record<string, Json>, enclosing: Readonly<LogicEntry['params']> = []): LogicRef {
  if (Object.keys(args).length !== entry.params.length || entry.params.some(param => {
    const arg = args[param.name];
    const hole = arg && typeof arg === 'object' && !Array.isArray(arg) && arg.type === 'hole';
    return !Object.hasOwn(args, param.name) || (hole
      ? !enclosing.some(owner => owner.name === arg.name && owner.kind === param.kind)
      : !argFits(param.kind, arg));
  })) {
    throw new Error('Set every argument explicitly. Preview stand-ins are not use values.');
  }
  return { type: 'logic-ref', logicId: entry.id, args };
}
export function materializeUseBindings(document: CompositionDocument, path: EditorPath): CompositionDocument {
  let next: unknown = document;
  const bindings = logicUseBindingsSchema.parse(document.logicUseBindings ?? []);
  const removed = new Set<number>();
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index], resolved = resolveLogicAnchor(document, binding.use);
    if (resolved?.pointer === fieldPointer(path) || resolved?.pointer.startsWith(`${fieldPointer(path)}/`)) {
      next = unbindLogicUse(next, index);
      removed.add(index);
    }
  }
  return removed.size ? { ...next as CompositionDocument, logicUseBindings: document.logicUseBindings!.filter((_, index) => !removed.has(index)) } : document;
}
export function unlinkTemplate(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const materialized = materializeUseBindings(document, path);
  const effective = resolveLogicUseBindings(document).document as CompositionDocument;
  const use = valueAt(effective, path) as LogicRef | undefined;
  if (use?.type !== 'logic-ref') throw new Error('This field is no longer a template use.');
  const owner = path[0] === 'logicLibrary' ? materialized.logicLibrary?.[Number(path[1])] : undefined;
  const expansion = owner ? undefined : expandLogic(effective);
  const expanded = owner ? expandKeepingHoles(materialized.logicLibrary ?? [], use, new Set(owner.params.map(param => param.name)))
    : valueAt(expansion!.document, path);
  if (canonicalOfBounded(expanded) === canonicalOfBounded(use)) throw new Error('This template could not be unlinked.');
  let next = replaceAt(materialized, path, expanded);
  const at = fieldPointer(path), inside = (pointer: string) => pointer === at || pointer.startsWith(`${at}/`);
  if (path[0] === 'componentLibrary' && expansion) {
    const index = Number(path[1]), entry = effective.componentLibrary![index], raw = materialized.componentLibrary![index];
    const affected = new Set((entry.bindings ?? []).flatMap((binding, index) => {
      if (!binding.nodeId) return [];
      const target = resolveLogicAnchor(effective, { kind: 'component', id: entry.id, nodeId: binding.nodeId, field: fieldPointer(fieldSteps(binding.field)) });
      return target && inside(target.pointer) ? [index] : [];
    }));
    const expandedEntry = valueAt(expansion.document, ['componentLibrary', index]) as typeof entry;
    const remapped = (original: number) => (expandedEntry.bindings ?? []).filter((_, index) => expansion.bindings[Number(path[1])]?.[index] === original);
    const bindings = (raw.bindings ?? []).flatMap((binding, index) => affected.has(index) ? remapped(index) : [binding]);
    for (const index of affected) if (index >= (raw.bindings?.length ?? 0)) bindings.push(...remapped(index));
    next = replaceAt(next, ['componentLibrary', index, 'bindings'], bindings);
  }
  const relocated = new Map<string, string[]>([[at, [at]]]);
  for (const location of expansion?.sourceMap ?? []) if (inside(location.authoredPointer)) {
    relocated.set(location.authoredPointer, [...relocated.get(location.authoredPointer) ?? [], location.pointer]);
  }
  return editSubtrees(document, next, { relocated, deleted: [path], fields: new Map([[at, [at]]]) });
}
