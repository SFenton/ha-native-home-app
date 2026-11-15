import type { Operand, Predicate, WhenUnknown } from '../shared/composition/expression';
import type { Json } from '../shared/types';

/**
 * A pure evaluator for the 2.0 operand and predicate grammar, mirroring the app's `ServerUIOperand`,
 * `ServerUIPredicate` and `ServerUIVisibility`. Evaluation is total: anything missing is `unavailable` (or `loading`
 * while the first states are still arriving); nothing throws.
 */

/** What reading a value gives: the value, "not yet" or "not available". */
export type ReadResult = { status: 'value'; value: Json } | { status: 'loading' } | { status: 'unavailable' };
/** The outcome of a predicate: it holds, it does not, or the data to say is not there. */
export type Tri = 'yes' | 'no' | 'unknown';
/** The signed-in person an expression can ask about. Absent fields are not known yet. */
export interface Viewer { userId?: string; isAdmin?: boolean; personEntityId?: string }
/** The state snapshot an evaluation reads. */
export interface Environment {
  /** The value at `path` of a declared source (`['state']` or `['attributes', ...]` for an entity). */
  read(sourceId: string, path: string[]): ReadResult;
  /** The signed-in person; undefined before the connection knows them. */
  viewer?: Viewer;
  /** The state of the viewer's `person.*` entity. */
  viewerPersonState?(): ReadResult;
  /** The new value of the control that sent the action being resolved. */
  controlValue?: Json;
}

export const unavailable: ReadResult = { status: 'unavailable' };
export const loading: ReadResult = { status: 'loading' };
export const value = (v: Json): ReadResult => ({ status: 'value', value: v });

// MARK: Scalars

/** A finite number from a number or a numeric string (a Home Assistant state is always text). */
export function finiteNumber(v: Json | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}
/** A scalar as text: strings as they are, whole numbers without a fraction, booleans as `true`/`false`. */
export function scalarText(v: Json | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return undefined;
}
function coerce(v: Json, kind: 'string' | 'number' | 'boolean' | 'entity-id'): Json | undefined {
  if ((kind === 'string' || kind === 'entity-id') && typeof v === 'string') return v;
  if (kind === 'boolean') {
    if (typeof v === 'boolean') return v;
    return v === 'true' ? true : v === 'false' ? false : undefined;
  }
  if (kind === 'number') return finiteNumber(v);
  return undefined;
}
const matches = (a: Json, b: Json) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  const left = scalarText(a), right = scalarText(b);
  return left !== undefined && right !== undefined && left === right;
};
/** The text of a number with at most `digits` fraction digits and no trailing zeros. */
export function formatNumber(n: number, digits: number): string {
  let text = n.toFixed(Math.max(0, Math.min(6, digits)));
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}
const combine = (parts: ReadResult[]): ReadResult | undefined =>
  parts.some(p => p.status === 'loading') ? loading : parts.some(p => p.status === 'unavailable') ? unavailable : undefined;

// MARK: Operands

function compute(op: Extract<Operand, { type: 'math' }>['op'], n: number[]): number | undefined {
  switch (op) {
    case 'add': return n.reduce((a, b) => a + b, 0);
    case 'multiply': return n.reduce((a, b) => a * b, 1);
    case 'min': return Math.min(...n);
    case 'max': return Math.max(...n);
    case 'subtract': return n[0] - n[1];
    case 'divide': return n[1] === 0 ? undefined : n[0] / n[1];
    case 'round': {
      const places = n.length === 2 ? n[1] : 0;
      if (!Number.isInteger(places) || places < 0 || places > 6) return undefined;
      const factor = 10 ** places;
      return Math.round(n[0] * factor) / factor;
    }
    case 'clamp': return n[1] <= n[2] ? Math.min(Math.max(n[0], n[1]), n[2]) : undefined;
    case 'scale': return n[1] === n[2] ? undefined : n[3] + (n[0] - n[1]) / (n[2] - n[1]) * (n[4] - n[3]);
  }
}
const arity: Record<Extract<Operand, { type: 'math' }>['op'], [number, number]> = {
  add: [2, 8], multiply: [2, 8], min: [2, 8], max: [2, 8], subtract: [2, 2], divide: [2, 2], round: [1, 2], clamp: [3, 3], scale: [5, 5],
};

/** Evaluates an operand against `env`. */
export function evaluateOperand(operand: Operand, env: Environment): ReadResult {
  switch (operand.type) {
    case 'literal': return value(operand.value);
    case 'control': return env.controlValue === undefined ? unavailable : value(env.controlValue);
    case 'viewer': {
      if (!env.viewer) return loading;
      const field = env.viewer[operand.field];
      return field === undefined ? unavailable : value(field);
    }
    case 'read': {
      const result = env.read(operand.from.sourceId, operand.from.path);
      if (result.status !== 'value') return result;
      const coerced = coerce(result.value, operand.as);
      return coerced === undefined ? unavailable : value(coerced);
    }
    case 'format': {
      const values = new Map(Object.entries(operand.args).map(([name, arg]) => [name, evaluateOperand(arg, env)]));
      const blocked = combine([...values.values()]);
      if (blocked) return blocked;
      let output = '', rest = operand.pattern;
      for (let open = rest.indexOf('{'); open >= 0; open = rest.indexOf('{')) {
        output += rest.slice(0, open);
        const close = rest.indexOf('}', open);
        if (close < 0) { output += rest.slice(open); rest = ''; break; }
        const name = rest.slice(open + 1, close), found = values.get(name);
        if (found?.status !== 'value') return unavailable;
        const digits = operand.formats?.[name]?.number.maximumFractionDigits, number = finiteNumber(found.value);
        output += digits !== undefined && number !== undefined ? formatNumber(number, digits) : scalarText(found.value) ?? '';
        rest = rest.slice(close + 1);
      }
      return value(output + rest);
    }
    case 'map': {
      const subject = evaluateOperand(operand.of, env);
      if (subject.status !== 'value') return subject;
      const hit = operand.cases.find(branch => matches(subject.value, branch.equals));
      return evaluateOperand(hit ? hit.then : operand.otherwise, env);
    }
    case 'math': {
      const parts = operand.args.map(arg => evaluateOperand(arg, env));
      const blocked = combine(parts);
      if (blocked) return blocked;
      const numbers = parts.map(part => part.status === 'value' ? finiteNumber(part.value) : undefined);
      const [low, high] = arity[operand.op];
      if (numbers.some(n => n === undefined) || numbers.length < low || numbers.length > high) return unavailable;
      const result = compute(operand.op, numbers as number[]);
      return result === undefined || !Number.isFinite(result) ? unavailable : value(result);
    }
    case 'object': {
      const parts = Object.entries(operand.fields).map(([key, field]) => [key, evaluateOperand(field, env)] as const);
      return combine(parts.map(([, part]) => part))
        ?? value(Object.fromEntries(parts.map(([key, part]) => [key, part.status === 'value' ? part.value : null])));
    }
    case 'list': {
      const parts = operand.items.map(item => evaluateOperand(item, env));
      return combine(parts) ?? value(parts.map(part => part.status === 'value' ? part.value : null));
    }
  }
}

// MARK: Predicates

const all = (parts: Tri[]): Tri => parts.includes('no') ? 'no' : parts.includes('unknown') ? 'unknown' : 'yes';
const any = (parts: Tri[]): Tri => parts.includes('yes') ? 'yes' : parts.includes('unknown') ? 'unknown' : 'no';
const negate = (part: Tri): Tri => part === 'yes' ? 'no' : part === 'no' ? 'yes' : 'unknown';
const member = (list: string[], v: Json): Tri => {
  const text = scalarText(v);
  return text === undefined ? 'unknown' : list.includes(text) ? 'yes' : 'no';
};

/** Evaluates a predicate to yes, no or unknown (Kleene logic: one `no` settles `all`, one `yes` settles `any`). */
export function evaluatePredicate(predicate: Predicate, env: Environment): Tri {
  switch (predicate.type) {
    case 'state': {
      const read = env.read(predicate.sourceId, predicate.path);
      return read.status === 'value' ? member(predicate.in, read.value) : 'unknown';
    }
    case 'numeric': {
      const read = env.read(predicate.sourceId, predicate.path);
      const number = read.status === 'value' ? finiteNumber(read.value) : undefined;
      if (number === undefined) return 'unknown';
      const parts: Tri[] = [];
      for (const [bound, above] of [[predicate.above, true], [predicate.below, false]] as const) {
        if (!bound) continue;
        const limit = evaluateOperand(bound, env);
        const n = limit.status === 'value' ? finiteNumber(limit.value) : undefined;
        parts.push(n === undefined ? 'unknown' : (above ? number > n : number < n) ? 'yes' : 'no');
      }
      return all(parts);
    }
    case 'viewer': {
      const viewer = env.viewer;
      if (!viewer) return 'unknown';
      const parts: Tri[] = [];
      if (predicate.isAdmin !== undefined) parts.push(viewer.isAdmin === undefined ? 'unknown' : viewer.isAdmin === predicate.isAdmin ? 'yes' : 'no');
      if (predicate.userIds !== undefined) parts.push(viewer.userId === undefined ? 'unknown' : predicate.userIds.includes(viewer.userId) ? 'yes' : 'no');
      return all(parts);
    }
    case 'viewer-person': {
      const read = env.viewerPersonState?.();
      return read?.status === 'value' ? member(predicate.in, read.value) : 'unknown';
    }
    case 'all': return all(predicate.of.map(part => evaluatePredicate(part, env)));
    case 'any': return any(predicate.of.map(part => evaluatePredicate(part, env)));
    case 'not': return negate(evaluatePredicate(predicate.of, env));
  }
}

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

/** Whether a `selectedWhen` option is selected: unknown counts as not selected. */
export const isSelected = (predicate: Predicate, env: Environment): boolean => evaluatePredicate(predicate, env) === 'yes';

/** The text of an operand result for display, or `fallback` when it has no value. */
export function textOf(result: ReadResult, fallback: string): string {
  return result.status === 'value' ? scalarText(result.value) ?? fallback : fallback;
}
