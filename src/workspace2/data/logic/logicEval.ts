import type { Environment } from '../../../shared/composition/evaluator';
import type { Operand, Predicate } from '../../../shared/composition/expression';
import { expandLogic, usesLogic, type LogicEntry } from '../../../shared/composition/logic-library';
import { evaluateOperand as evaluate, evaluatePredicate as evaluateTest } from '../../../preview2/evaluate';

/** What an environment needs to read logic: the library, and the Try With value of each setting while a template's body is on show. */
export interface LogicFill { library: readonly LogicEntry[]; samples?: Record<string, unknown> }
const fills = new WeakMap<object, LogicFill>();
/** Says how `env` reads a use or a setting. The editors' environment is registered once, where it is built. */
export function registerFill(env: Environment, fill: LogicFill | undefined): Environment {
  if (fill) fills.set(env, fill);
  return env;
}
const fillHoles = (value: unknown, samples: Record<string, unknown>): unknown => {
  if (Array.isArray(value)) return value.map(item => fillHoles(item, samples));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'hole' && typeof record.name === 'string') return Object.hasOwn(samples, record.name) ? structuredClone(samples[record.name]) : value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, fillHoles(item, samples)]));
};
/** What a use worked out to, by the library it was worked out with and then the use itself: an edit to a template makes a new library, so no use reads a stale answer. */
const worked = new WeakMap<object, WeakMap<object, unknown>>();
/** The logic as plain operands or conditions: settings at their Try With values, uses worked out. Unchanged when it holds neither. */
function plain<T>(value: T, env: Environment): T {
  const fill = fills.get(env);
  if (!fill || !value || typeof value !== 'object' || !usesLogic({ x: value })) return value;
  const key = value as unknown as object, byValue = worked.get(fill.library) ?? new WeakMap<object, unknown>(), held = byValue.get(key);
  if (held !== undefined && fill.samples === undefined) return held as T;
  let out: unknown = value;
  try { out = (expandLogic({ logicLibrary: fill.library, x: fill.samples ? fillHoles(value, fill.samples) : value }).document as { x: unknown }).x; } catch { out = value; }
  if (fill.samples === undefined) { byValue.set(key, out); worked.set(fill.library, byValue); }
  return out as T;
}
/** `evaluateOperand` that also reads uses and settings. */
export const evaluateOperand = (operand: Operand, env: Environment) => evaluate(plain(operand, env), env);
/** `evaluatePredicate` that also reads uses and settings. */
export const evaluatePredicate = (predicate: Predicate, env: Environment) => evaluateTest(plain(predicate, env), env);
export { scalarText } from '../../../preview2/evaluate';
