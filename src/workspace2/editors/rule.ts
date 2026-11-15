import type { CompositionDocument } from '../../shared/composition/schema';
import { checkPredicate, type Predicate } from '../../shared/composition/expression';
import { ensureSource } from '../add/sources';

/** The rule as the builder shows it: "Show when all|any of these are true" over rows. */
export interface RuleRoot { mode: 'all' | 'any'; items: Predicate[]; /** The rule was one condition, not a group; it is written back that way while it stays one. */ wrapped: boolean }

/** How the builder draws one predicate. `json` rows (and groups past two levels) are edited as JSON and kept as they are. */
export type RowKind = 'state' | 'not-state' | 'numeric-above' | 'numeric-below' | 'viewer-admin' | 'viewer-users' | 'viewer-person' | 'group' | 'json';

/** Opens a rule into its root group. No rule is an empty root, which reads "Always". */
export function openRule(rule: Predicate | undefined): RuleRoot {
  if (!rule) return { mode: 'all', items: [], wrapped: true };
  if (rule.type === 'all' || rule.type === 'any') return { mode: rule.type, items: rule.of, wrapped: false };
  return { mode: 'all', items: [rule], wrapped: true };
}
/** Closes the root back into a rule. An unchanged rule comes back as it was; no rows is no rule. */
export function closeRule(root: RuleRoot): Predicate | undefined {
  if (!root.items.length) return undefined;
  if (root.wrapped && root.items.length === 1 && root.mode === 'all') return root.items[0];
  return { type: root.mode, of: root.items };
}

const literalNumber = (operand: { type: string; value?: unknown } | undefined) => operand?.type === 'literal' && typeof operand.value === 'number';
/** The row a predicate is drawn as. `level` is 1 for rows of the root group and 2 for rows of a group inside it. */
export function rowKind(predicate: Predicate, level = 1): RowKind {
  switch (predicate.type) {
    case 'state': return 'state';
    case 'not': return predicate.of.type === 'state' ? 'not-state' : 'json';
    case 'numeric':
      if (predicate.above && !predicate.below && literalNumber(predicate.above)) return 'numeric-above';
      if (predicate.below && !predicate.above && literalNumber(predicate.below)) return 'numeric-below';
      return 'json';
    case 'viewer':
      if (predicate.isAdmin !== undefined && predicate.userIds === undefined) return 'viewer-admin';
      if (predicate.userIds && predicate.isAdmin === undefined) return 'viewer-users';
      return 'json';
    case 'viewer-person': return 'viewer-person';
    case 'all': case 'any': return level >= 2 ? 'json' : 'group';
  }
}

/** The conditions in a rule, as "<n> conditions" counts them. */
export function conditionCount(rule: Predicate | undefined): number {
  if (!rule) return 0;
  if (rule.type === 'all' || rule.type === 'any') return rule.of.reduce((sum, item) => sum + conditionCount(item), 0);
  if (rule.type === 'not') return conditionCount(rule.of);
  return 1;
}

/** The summary of a rule for its row: "Always", or the number of conditions. */
export const ruleSummary = (rule: Predicate | undefined) => {
  const count = conditionCount(rule);
  return count === 0 ? 'Always' : count === 1 ? '1 condition' : `${count} conditions`;
};

/** A state condition on an entity, reading the entity through a data source the document already has or gets. */
export function entityCondition(document: CompositionDocument, entityId: string, states: string[] = ['on']): { document: CompositionDocument; predicate: Predicate } {
  const { document: next, sourceId } = ensureSource(document, entityId);
  return { document: next, predicate: { type: 'state', sourceId, path: ['state'], in: states } };
}
/** A numeric condition. */
export function numericCondition(document: CompositionDocument, entityId: string, kind: 'above' | 'below', value = 0): { document: CompositionDocument; predicate: Predicate } {
  const { document: next, sourceId } = ensureSource(document, entityId);
  const operand = { type: 'literal' as const, value };
  return { document: next, predicate: { type: 'numeric', sourceId, path: ['state'], ...(kind === 'above' ? { above: operand } : { below: operand }) } };
}
/** Switches a row between its operators ("is", "is not", "is above", "is below"), keeping the entity. */
export function changeOperator(predicate: Predicate, operator: 'is' | 'is not' | 'is above' | 'is below'): Predicate {
  const inner = predicate.type === 'not' ? predicate.of : predicate;
  if (inner.type === 'state') return operator === 'is not' ? { type: 'not', of: inner } : operator === 'is' ? inner : { type: 'numeric', sourceId: inner.sourceId, path: inner.path, [operator === 'is above' ? 'above' : 'below']: { type: 'literal', value: 0 } };
  if (inner.type === 'numeric') {
    if (operator === 'is above') return { type: 'numeric', sourceId: inner.sourceId, path: inner.path, above: inner.above ?? inner.below ?? { type: 'literal', value: 0 } };
    if (operator === 'is below') return { type: 'numeric', sourceId: inner.sourceId, path: inner.path, below: inner.below ?? inner.above ?? { type: 'literal', value: 0 } };
    const state: Predicate = { type: 'state', sourceId: inner.sourceId, path: inner.path, in: ['on'] };
    return operator === 'is not' ? { type: 'not', of: state } : state;
  }
  return predicate;
}

/** The problem a rule has, in words, when it exceeds the app's limits (depth 8, 64 parts); undefined when it is within them. */
export function ruleProblem(rule: Predicate | undefined): string | undefined {
  if (!rule) return undefined;
  return checkPredicate(rule, '').issues.some(issue => issue.code === 'limit_exceeded') ? 'This rule is too large. Remove some conditions.' : undefined;
}

/** How many levels of groups a rule nests. */
export function groupDepth(rule: Predicate | undefined): number {
  if (!rule) return 0;
  if (rule.type === 'all' || rule.type === 'any') return 1 + Math.max(0, ...rule.of.map(groupDepth));
  if (rule.type === 'not') return groupDepth(rule.of);
  return 0;
}
