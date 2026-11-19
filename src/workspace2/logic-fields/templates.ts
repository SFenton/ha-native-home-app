import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { argFits, expandKeepingHoles, type LogicEntry, type LogicRef } from '../../shared/composition/logic-library';
import { canonicalOfBounded } from '../../shared/composition/json';
import { resolveLogicUseBindings, unbindLogicUse } from '../../shared/composition/studio-logic/bindings';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { logicUseBindingsSchema } from '../../shared/composition/studio-logic/schemas';
import type { Json } from '../../shared/types';
import { fieldPointer } from './registry';

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
  for (let index = bindings.length - 1; index >= 0; index--) {
    const binding = bindings[index], resolved = resolveLogicAnchor(document, binding.use);
    if (resolved?.pointer === fieldPointer(path) || resolved?.pointer.startsWith(`${fieldPointer(path)}/`)) next = unbindLogicUse(next, index);
  }
  return next as CompositionDocument;
}
export function unlinkTemplate(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const materialized = materializeUseBindings(document, path);
  const use = valueAt(resolveLogicUseBindings(materialized).document, path) as LogicRef | undefined;
  if (use?.type !== 'logic-ref') throw new Error('This field is no longer a template use.');
  const owner = path[0] === 'logicLibrary' ? materialized.logicLibrary?.[Number(path[1])] : undefined;
  const expanded = expandKeepingHoles(materialized.logicLibrary ?? [], use, new Set(owner?.params.map(param => param.name) ?? []));
  if (canonicalOfBounded(expanded) === canonicalOfBounded(use)) throw new Error('This template could not be unlinked.');
  return replaceAt(materialized, path, expanded);
}
