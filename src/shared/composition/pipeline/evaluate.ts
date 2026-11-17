import type { Json } from '../../types';
import { compareText, scalarText } from './text';
import { instant, wallTime } from './dates';
import { coerceRead, evaluateOperand, evaluateWhere, Meter, OverBudget, valueAt, type FlowContext, type Scope } from './operands';
import type { PipelineInputs, PipelineStep } from './schema';

/**
 * The step evaluator of a Data Flow. It is pure and total: the same data, parameters and clock give the same answer in TypeScript and in
 * Swift (the shared corpus `contract/corpus/pipelines` pins it), nothing throws, and a step applied to the wrong kind of value gives the
 * empty result of its kind (`[]`, `0` or `null`) instead of failing. The one failure is running out of budget.
 *
 * Budget: a run may spend `PIPELINE_BUDGET` units. A step costs one plus one per item it visits; every operand and condition node it evaluates
 * costs one (`all` and `any` evaluate every part, so the cost never depends on an earlier answer). A run over budget gives no data, and the
 * app keeps what it last had.
 */
export const PIPELINE_BUDGET = 100_000;

/** One row of a list. `subtitle` and `value` are absent when empty. */
export interface Row { id: string; title: string; subtitle?: string; value?: string }
/** What each step left behind: how many items it holds (`null` when it holds one value). */
export interface StepTrace { id: string; op: string; size: number | null }
export type RunResult =
  | { status: 'ok'; output: Json; value: Json; visits: number; trace: StepTrace[] }
  | { status: 'over-budget'; visits: number; stepId: string | null };

const isRecord = (value: Json | undefined): value is { [key: string]: Json } => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value: Json): Json[] => Array.isArray(value) ? value : [];

// MARK: Parameters and request

const parameterKinds = {
  string: (value: Json) => typeof value === 'string' ? value : null,
  number: (value: Json) => typeof value === 'number' && Number.isFinite(value) ? value : coerceRead(value, 'number'),
  boolean: (value: Json) => coerceRead(value, 'boolean'),
  'entity-id': (value: Json) => coerceRead(value, 'entity-id'),
} as const;
/** The value of every declared parameter, evaluated in dependency order. A parameter that cannot be evaluated (a cycle the compiler refuses) is `null`. */
export function evaluateParameters(inputs: Pick<PipelineInputs, 'parameters'>, context: FlowContext, meter: Meter): Map<string, Json> {
  const values = new Map<string, Json>(), pending = new Set<string>();
  const declared = new Map(inputs.parameters.map(parameter => [parameter.name, parameter]));
  const scope: Scope = { params: { get: (name: string) => resolve(name) } };
  function resolve(name: string): Json | undefined {
    if (values.has(name)) return values.get(name);
    const parameter = declared.get(name);
    if (!parameter || pending.has(name)) return null;
    pending.add(name);
    const value = parameterKinds[parameter.type](evaluateOperand(parameter.value, scope, context, meter));
    pending.delete(name);
    values.set(name, value);
    return value;
  }
  for (const parameter of inputs.parameters) resolve(parameter.name);
  return values;
}
/** The service call a `service-response` request makes: its domain, service, target and data with the parameters filled in. A target or data key whose operand is `null` is left out. */
export function resolveServiceCall(inputs: PipelineInputs, context: FlowContext, budget = PIPELINE_BUDGET):
  { domain: string; service: string; target: Record<string, Json>; data: Record<string, Json> } | undefined {
  const request = inputs.request;
  if (request.type !== 'service-response') return undefined;
  const meter = new Meter(budget);
  try {
    const scope: Scope = { params: evaluateParameters(inputs, context, meter) };
    const present = (entries: [string, Json][]) => Object.fromEntries(entries.filter(([, value]) => value !== null));
    return {
      domain: request.domain, service: request.service,
      target: present(Object.entries(request.target ?? {}).map(([key, operand]) => [key, operand ? evaluateOperand(operand, scope, context, meter) : null])),
      data: present(Object.entries(request.data?.fields ?? {}).map(([key, operand]) => [key, evaluateOperand(operand, scope, context, meter)])),
    };
  } catch (error) { if (error instanceof OverBudget) return undefined; throw error; }
}

// MARK: Steps

/** The kind of ordering a `sort` key uses, as a comparable: missing or wrongly typed values have none and sort last. */
type Key = { text: string } | { number: number } | undefined;
function sortKey(value: Json, kind: 'text' | 'number' | 'date', context: FlowContext): Key {
  if (kind === 'text') return typeof value === 'string' ? { text: value } : undefined;
  if (kind === 'number') return typeof value === 'number' ? { number: value } : undefined;
  const time = typeof value === 'string' ? wallTime(value, context.clock.utcOffsetMinutes) : undefined;
  return time ? { number: instant(time) } : undefined;
}
function compareKeys(a: Key, b: Key): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if ('text' in a) return compareText(a.text, (b as { text: string }).text);
  return a.number - (b as { number: number }).number;
}
/** The identity of a key for `group` and `unique`: its kind and text, so `1` and `"1"` differ and equal strings agree under NFC. `null` and anything that is not a scalar are one key. */
const identity = (value: Json): string => typeof value === 'string' ? `s${value.normalize('NFC')}` : typeof value === 'number' ? `n${scalarText(value)}`
  : typeof value === 'boolean' ? `b${value}` : 'z';

function setDefault(item: Json, path: readonly string[], fill: Json): Json {
  if (fill === null || !isRecord(item)) return item;
  const [head, ...rest] = path;
  if (rest.length) {
    if (!Object.hasOwn(item, head)) return item;
    const inner = setDefault(item[head], rest, fill);
    return inner === item[head] ? item : { ...item, [head]: inner };
  }
  return Object.hasOwn(item, head) && item[head] !== null ? item : { ...item, [head]: fill };
}

/** The lowest or highest of the numbers among `parts`; `null` when there is none. A part that is not a finite number is skipped, as `sum` skips it. */
function extreme(kind: 'min' | 'max', parts: Json[]): number | null {
  let found: number | null = null;
  for (const part of parts) {
    if (typeof part !== 'number' || !Number.isFinite(part)) continue;
    found = found === null ? part : kind === 'min' ? Math.min(found, part) : Math.max(found, part);
  }
  return found === 0 ? 0 : found;
}

/** Runs one step on a value. */
export function runStep(step: PipelineStep, value: Json, scope: Scope, context: FlowContext, meter: Meter): Json {
  meter.spend();
  const each = (items: Json[]) => meter.spend(items.length);
  const withItem = (item: Json, index = 0): Scope => ({ item, index, params: scope.params });
  switch (step.op) {
    case 'get': return valueAt(value, step.path);
    case 'select-key': {
      const key = evaluateOperand(step.key, scope, context, meter);
      return typeof key === 'string' && isRecord(value) && Object.hasOwn(value, key) ? value[key] : null;
    }
    case 'filter': {
      const items = list(value); each(items);
      return items.filter((item, at) => evaluateWhere(step.where, withItem(item, at), context, meter));
    }
    case 'sort': {
      const items = list(value); each(items);
      const keyed = items.map((item, index) => ({ item, index, keys: step.by.map(by => sortKey(evaluateOperand(by.value, withItem(item, index), context, meter), by.kind, context)) }));
      keyed.sort((a, b) => {
        for (const [position, by] of step.by.entries()) {
          const x = a.keys[position], y = b.keys[position];
          if (x === undefined || y === undefined) { if (x !== y) return x === undefined ? 1 : -1; continue; }
          const difference = compareKeys(x, y);
          if (difference) return by.direction === 'ascending' ? difference : -difference;
        }
        return a.index - b.index;
      });
      return keyed.map(entry => entry.item);
    }
    case 'limit': return list(value).slice(0, step.count);
    case 'map': {
      const build = (item: Json, at = 0): Json => Object.fromEntries(Object.entries(step.fields).map(([name, operand]) => [name, evaluateOperand(operand, withItem(item, at), context, meter)]));
      if (Array.isArray(value)) { each(value); return value.map(build); }
      return isRecord(value) ? build(value) : null;
    }
    case 'group': {
      const items = list(value); each(items);
      const groups = new Map<string, { key: Json; items: Json[] }>();
      for (const [at, item] of items.entries()) {
        const key = evaluateOperand(step.by, withItem(item, at), context, meter), slot = identity(key);
        const group = groups.get(slot) ?? { key: typeof key === 'object' ? null : key, items: [] };
        group.items.push(item); groups.set(slot, group);
      }
      return [...groups.values()].map(group => ({ key: group.key, count: group.items.length, items: group.items }));
    }
    case 'count': return list(value).length;
    case 'sum': {
      const items = list(value); each(items);
      let total = 0;
      for (const [at, item] of items.entries()) { const part = evaluateOperand(step.value, withItem(item, at), context, meter); if (typeof part === 'number') total += part; }
      return total === 0 ? 0 : total;
    }
    case 'first': return list(value)[0] ?? null;
    case 'flatten': {
      const items = list(value); each(items);
      return items.flatMap(item => list(valueAt(item, step.path)));
    }
    case 'unique': {
      const items = list(value); each(items);
      const seen = new Set<string>();
      return items.filter((item, at) => {
        const slot = identity(evaluateOperand(step.by, withItem(item, at), context, meter));
        if (seen.has(slot)) return false;
        seen.add(slot); return true;
      });
    }
    // `sh.flow-extras@1`
    case 'min': case 'max': {
      const items = list(value); each(items);
      return extreme(step.op, items.map((item, at) => evaluateOperand(step.value, withItem(item, at), context, meter)));
    }
    case 'running-sum': {
      const items = list(value); each(items);
      // The native scan (`WeatherPrecipitationTimeline.points`, `WeatherPrecipitationTimeline.swift:14-19`): a total that has gone unknown stays unknown when
      // `nullPropagates`; otherwise a part that is not a number adds nothing. An item that is not an object passes through unchanged.
      let total: number | null = 0;
      return items.map((item, at) => {
        const part = evaluateOperand(step.value, withItem(item, at), context, meter);
        const number = typeof part === 'number' && Number.isFinite(part) ? part : undefined;
        if (step.nullPropagates) total = total !== null && number !== undefined ? total + number : null;
        else if (number !== undefined && total !== null) total += number;
        return isRecord(item) ? { ...item, [step.into]: total === 0 ? 0 : total } : item;
      });
    }
    case 'annotate': {
      const items = list(value); each(items);
      // Each aggregate is taken over the whole list first, then written onto every object in it, so every item carries the same list-wide value.
      const written = Object.entries(step.fields).map(([name, field]) =>
        [name, extreme(field.aggregate, items.map((item, at) => evaluateOperand(field.value, withItem(item, at), context, meter)))] as const);
      return items.map(item => isRecord(item) ? { ...item, ...Object.fromEntries(written) } : item);
    }
    case 'default': {
      const fill = (item: Json, at = 0) => setDefault(item, step.path, evaluateOperand(step.value, withItem(item, at), context, meter));
      if (Array.isArray(value)) { each(value); return value.map(fill); }
      return isRecord(value) ? fill(value) : value;
    }
  }
}

// MARK: Run

const text = (value: Json): string | undefined => { const out = scalarText(value); return out === undefined || !out.trim() ? undefined : out; };
/** The rows an output asks for from the final list: items with no id or no title are skipped, the first of a repeated id wins, at most `max` are kept. */
function rowsOf(inputs: PipelineInputs, items: Json[], scope: Scope, context: FlowContext, meter: Meter): Row[] {
  const output = inputs.output;
  if (output.kind !== 'rows') return [];
  meter.spend(items.length);
  const rows: Row[] = [], seen = new Set<string>();
  for (const [at, item] of items.entries()) {
    if (rows.length >= output.max) break;
    const own: Scope = { item, index: at, params: scope.params };
    const id = text(evaluateOperand(output.row.id, own, context, meter)), title = text(evaluateOperand(output.row.title, own, context, meter));
    const subtitle = output.row.subtitle ? text(evaluateOperand(output.row.subtitle, own, context, meter)) : undefined;
    const value = output.row.value ? text(evaluateOperand(output.row.value, own, context, meter)) : undefined;
    if (id === undefined || title === undefined || seen.has(id.normalize('NFC'))) continue;
    seen.add(id.normalize('NFC'));
    rows.push({ id, title, ...(subtitle !== undefined ? { subtitle } : {}), ...(value !== undefined ? { value } : {}) });
  }
  return rows;
}
/** The records an output asks for from the final list (`sh.repeat@1`): the objects in it, in order, at most `max`; anything else in the list is skipped. */
function recordsOf(inputs: PipelineInputs, items: Json[], meter: Meter): Json {
  const output = inputs.output;
  if (output.kind !== 'records') return [];
  meter.spend(items.length);
  return items.filter(isRecord).slice(0, output.max);
}
/**
 * Runs a flow on the data its request returned. `response` is the answer (an attribute's value, a service's response, a subscription's push, or the rows `entityRows` builds); a `none` request has no answer and ignores it.
 * Never throws; over budget gives `over-budget` and no data.
 */
export function evaluatePipeline(inputs: PipelineInputs, response: Json, context: FlowContext, budget = PIPELINE_BUDGET): RunResult {
  const meter = new Meter(budget);
  let stepId: string | null = null;
  try {
    const scope: Scope = { params: evaluateParameters(inputs, context, meter) };
    let value = inputs.request.type === 'none' ? evaluateOperand(inputs.request.value, scope, context, meter) : response;
    const trace: StepTrace[] = [];
    for (const step of inputs.steps) {
      stepId = step.id;
      value = runStep(step, value, scope, context, meter);
      trace.push({ id: step.id, op: step.op, size: Array.isArray(value) ? value.length : null });
    }
    stepId = null;
    const output = inputs.output;
    const given: Json = output.kind === 'rows' ? rowsOf(inputs, list(value), scope, context, meter) as unknown as Json
      : output.kind === 'records' ? recordsOf(inputs, list(value), meter)
      : output.kind === 'record' ? (isRecord(value) ? value : null)
      : (value === null || typeof value === 'object' ? null : value);
    return { status: 'ok', output: given, value, visits: meter.spent, trace };
  } catch (error) {
    if (error instanceof OverBudget) return { status: 'over-budget', visits: meter.spent, stepId };
    throw error;
  }
}
