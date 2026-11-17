import type { Predicate, WhenUnknown } from '../shared/composition/expression';
import { evaluatePredicate, scalarText, type Environment, type ReadResult } from '../shared/composition/evaluator';

/**
 * A pure evaluator for the 2.0 operand and predicate grammar, mirroring the app's `ServerUIOperand`,
 * `ServerUIPredicate` and `ServerUIVisibility`. The operand and condition definition itself lives in
 * `shared/composition/evaluator.ts`, shared with Data Flow; this file re-exports it and adds the visibility rules.
 */

export {
  evaluateOperand, evaluatePredicate, finiteNumber, formatNumber, loading, roundHalfAwayFromZero, scalarText, unavailable, value,
  type Environment, type ReadResult, type Tri, type Viewer,
} from '../shared/composition/evaluator';

// MARK: Visibility

/** The two optional fields a node or tab carries. */
export interface VisibilityRule { visibleWhen?: Predicate; whenUnknown?: WhenUnknown }

/**
 * Whether a node or tab is shown. No rule means shown. While the rule cannot be answered, `show` shows, `hide` hides and
 * `keep` (the default) repeats `previous`, shown when it was never answered, so a reconnect never blanks a screen.
 */
export function isShown(rule: VisibilityRule, env: Environment, previous?: boolean): boolean {
  if (!rule.visibleWhen) return true;
  const answer = evaluatePredicate(rule.visibleWhen, env);
  if (answer !== 'unknown') return answer === 'yes';
  const policy = rule.whenUnknown ?? 'keep';
  return policy === 'show' ? true : policy === 'hide' ? false : previous ?? true;
}

/** The nodes whose `props.visibility` hides them while a room source reports another state. */
const roomVisibilityTypes = new Set(['room-card', 'room-chip', 'room-section']);

/**
 * `ServerUIBindings.roomVisible`: a room card, chip or section with `props.visibility` is shown while its source reads one of the
 * listed states, and hidden when the source is unavailable or reads another. While the source is loading it repeats `previous`, so a
 * reconnect never blanks a section. Nodes without the rule are always shown.
 */
export function roomVisibilityHolds(node: { type: string; props?: unknown }, env: Environment, previous?: boolean): boolean {
  if (!roomVisibilityTypes.has(node.type)) return true;
  const rule = (node.props as { visibility?: { sourceId: string; states: string[] } } | undefined)?.visibility;
  if (!rule) return true;
  const state = env.read(rule.sourceId, ['state']);
  if (state.status === 'loading') return previous ?? true;
  return state.status === 'value' && rule.states.includes(String(state.value));
}

/** Whether a node is shown: its own `visibleWhen` rule and, for a room card, chip or section, its room `visibility`. */
export function nodeIsShown(node: VisibilityRule & { type: string; props?: unknown }, env: Environment, previous?: boolean): boolean {
  return isShown(node, env, previous) && roomVisibilityHolds(node, env, previous);
}

/** Whether a `selectedWhen` option is selected: unknown counts as not selected. */
export const isSelected = (predicate: Predicate, env: Environment): boolean => evaluatePredicate(predicate, env) === 'yes';

/** The text of an operand result for display, or `fallback` when it has no value. */
export function textOf(result: ReadResult, fallback: string): string {
  return result.status === 'value' ? scalarText(result.value) ?? fallback : fallback;
}
