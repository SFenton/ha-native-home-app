import { useCallback } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import type { CompositionDocument } from '../../shared/composition/schema';
import { isWrapped, removeWrapped } from './removal';
import { useDraftDocument, type Draft } from '../editors/draft';

/** Writes `next` at `path` of a document; no condition removes the key, and the `whenUnknown` beside it (spec "Remove Condition"). */
export function writeRule(document: CompositionDocument, path: EditorPath, next: Predicate | undefined, policyKey?: string): CompositionDocument {
  const parent = path.slice(0, -1), holder = valueAt(document, parent) as Record<string, unknown> | undefined;
  if (next) return replaceAt(holder === undefined && parent.length ? replaceAt(document, parent, policyKey ? { [policyKey]: 'keep' } : {}) : document, path, next);
  if (isWrapped(path)) return removeWrapped(document, path);
  const { [String(path.at(-1))]: _gone, ...rest } = holder!;
  if (policyKey) delete rest[policyKey];
  return replaceAt(document, parent, rest);
}

/**
 * The condition at `path` of an editor's draft, re-read when the draft changes, and the one way to write it. A pushed page holds no
 * closure over the page that pushed it: it reads and writes the draft through this.
 */
export function useRule(draft: Draft, path: EditorPath, policyKey?: string) {
  const document = useDraftDocument(draft);
  const key = path.join('/');
  const rule = valueAt(document, path) as Predicate | undefined;
  /** `base` is a document that already holds a source the edit created; `typing` coalesces keystrokes into one step. */
  const write = useCallback((next: Predicate | undefined, base?: CompositionDocument, typing?: string) => {
    draft.set(writeRule(base ?? draft.get(), path, next, policyKey), typing);
  }, [draft, key, policyKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { document, rule, write };
}
