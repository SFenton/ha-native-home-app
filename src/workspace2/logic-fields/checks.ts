import type { Predicate } from '../../shared/composition/expression';
import { conditionCount } from '../expr/condition';

/** Count this condition's checks, not conditions owned by nested value expressions. */
export function logicCheckCount(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const node = value as Record<string, unknown>;
  return ['all', 'any', 'not', 'state', 'numeric', 'compare', 'in', 'exists', 'viewer-person', 'logic-ref'].includes(String(node.type))
    || node.type === 'viewer' && node.field === undefined ? conditionCount(value as Predicate) : 0;
}
export const hasMultipleChecks = (value: unknown): boolean => logicCheckCount(value) > 1;

export function inlineCheck(predicate: Predicate): Predicate {
  if ((predicate.type === 'all' || predicate.type === 'any') && predicate.of.length === 1) return inlineCheck(predicate.of[0]);
  if (predicate.type === 'not') {
    const of = inlineCheck(predicate.of);
    return of === predicate.of ? predicate : { ...predicate, of };
  }
  return predicate;
}
