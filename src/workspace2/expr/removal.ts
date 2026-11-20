import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { WhenUnknown } from '../../shared/composition/expression';
import type { CompositionDocument } from '../../shared/composition/schema';
import { editBoundField } from '../logic-fields/templates';

/** Removes the condition at `path`, and the policy beside it (spec "Remove Condition"). It is one step. */
/** A condition that lives inside a wrapper object (`enabledWhen: { condition, whenUnknown }`): the wrapper goes with it. */
export const isWrapped = (path: EditorPath) => path.at(-2) === 'enabledWhen' && path.at(-1) === 'condition';
/** Removes the wrapper object that holds the condition at `path`. */
export function removeWrapped(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const owner = path.slice(0, -2), holder = valueAt(document, owner) as Record<string, unknown>;
  const { [String(path.at(-2))]: _gone, ...rest } = holder;
  return replaceAt(document, owner, rest);
}
export function removeRuleAt(document: CompositionDocument, path: EditorPath, policyKey?: string): CompositionDocument {
  return editBoundField(document, path, document => {
    if (isWrapped(path)) return removeWrapped(document, path);
    const parent = path.slice(0, -1), holder = valueAt(document, parent) as Record<string, unknown>;
    const { [String(path.at(-1))]: _gone, ...rest } = holder;
    if (policyKey) delete rest[policyKey];
    return replaceAt(document, parent, rest);
  });
}
/** The policy beside a condition, when it has one. */
export const whenUnknownOf = (document: CompositionDocument, path: EditorPath, policyKey = 'whenUnknown'): WhenUnknown | 'enabled' | 'disabled' =>
  ((valueAt(document, path.slice(0, -1)) as Record<string, unknown> | undefined)?.[policyKey] as WhenUnknown | 'enabled' | 'disabled' | undefined) ?? 'keep';
