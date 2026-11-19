import type { Json } from '../../types';
import {
  coerce, evaluateOperand as evaluateShared, evaluatePredicate, unavailable, value as found, valueAt,
  type Environment, type EvaluationObserver, type Viewer,
} from '../evaluator';
import type { Clock } from './dates';
import type { PipelineOperand, ReadKind, Where } from './schema';

/**
 * Evaluating a flow's operands and conditions. There is one definition of both (`../evaluator.ts`, shared with `visibleWhen`, rules and authored
 * strings); this file runs it in flow mode and adds the flow's budget. Evaluation is total: nothing throws, and anything missing, of the wrong kind,
 * or not a date is `null`. The only failure is running out of budget, which the caller handles (see `Meter`).
 *
 * Flow mode differs from a document in two deliberate ways, because a step builds many rows and one gap must not blank a row: an `object` or
 * `list` operand keeps a `null` part as `null` instead of becoming unavailable as a whole, and there is no `loading` or `unavailable`, so a
 * condition is yes or no.
 */

export type { Viewer };
export { valueAt };
/** What a flow reads besides its data. */
export interface FlowContext {
  clock: Clock;
  viewer?: Viewer;
  /** The value at `path` of a declared source, as the app's operand evaluator reads it (a parameter's `read`). */
  read?: (sourceId: string, path: string[]) => Json | undefined;
  observe?: {
    readonly evaluation?: EvaluationObserver;
    readonly pipeline: (event: PipelineObservation) => void;
  };
}
export type PipelineObservation =
  | { readonly kind: 'step'; readonly step: import('./schema').PipelineStep; readonly input: Json; readonly output: Json; readonly used: number; readonly limit: number }
  | { readonly kind: 'filter'; readonly step: import('./schema').PipelineStep; readonly item: Json; readonly index: number; readonly kept: boolean; readonly used: number; readonly limit: number }
  | { readonly kind: 'item'; readonly step: import('./schema').PipelineStep; readonly item: Json; readonly index: number; readonly value: Json; readonly included: boolean; readonly reason: string; readonly field?: string }
  | { readonly kind: 'sort'; readonly step: import('./schema').PipelineStep; readonly item: Json; readonly index: number; readonly position: number; readonly used: number; readonly limit: number };
export function notifyPipeline(observer: NonNullable<FlowContext['observe']>, event: PipelineObservation): void {
  try { observer.pipeline(event); }
  catch { console.warn('Studio pipeline observation failed; the answer is unchanged.'); }
}
/** The names an operand can see: the item a step is looking at and the evaluated parameters. */
export interface Scope { item?: Json; /** The 0-based position of `item` in the list a step is visiting (`index` operands, `sh.repeat@1`). */ index?: number; params: { get(name: string): Json | undefined } }

/** Thrown when a run exceeds its step budget. Caught by `evaluatePipeline`; never reaches a caller. */
export class OverBudget extends Error {}
/** The budget of one run: every step costs one plus the items it visits, and every operand or condition node evaluated costs one. */
export class Meter {
  spent = 0;
  constructor(readonly limit: number) {}
  spend(count = 1): void { this.spent += count; if (this.spent > this.limit) throw new OverBudget(); }
}

/** Coerces a read to its declared kind: a Home Assistant state is text, so `"3"` reads as the number 3; anything else is null. */
export function coerceRead(v: Json | undefined, kind: ReadKind): Json {
  return v === undefined || v === null ? null : coerce(v, kind) ?? null;
}

function environment(scope: Scope, context: FlowContext, meter: Meter): Environment {
  const env: Environment = {
    flow: true,
    spend: () => meter.spend(),
    clock: context.clock,
    viewer: context.viewer,
    item: scope.item,
    index: scope.index,
    params: scope.params,
    read: (sourceId, path) => {
      const read = context.read?.(sourceId, path);
      return read === undefined ? unavailable : found(read);
    },
  };
  if (context.observe) { env.observe = context.observe.evaluation; env.observationCost = meter; }
  return env;
}

/** The value of an operand; `null` when it has none. */
export function evaluateOperand(operand: PipelineOperand, scope: Scope, context: FlowContext, meter: Meter): Json {
  const result = evaluateShared(operand, environment(scope, context, meter));
  return result.status === 'value' ? result.value : null;
}
/** Whether a condition holds for the scope; a comparison involving a missing or wrongly typed value does not hold. */
export function evaluateWhere(where: Where, scope: Scope, context: FlowContext, meter: Meter): boolean {
  return evaluatePredicate(where, environment(scope, context, meter)) === 'yes';
}
