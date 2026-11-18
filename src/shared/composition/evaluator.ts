import type { Json } from '../types';
import type { EnabledWhen, Operand, Predicate } from './expression';
import { clampedColor, parseColor, type ColorRole } from './color';
import { formatDate } from './date-format';
import { formatDuration } from './duration-format';
import { mathArity } from './pipeline/schema';
import { clockTime, clockToday, daysBetween, instant, progressBetween, secondsBetween, wallTime, type Clock } from './pipeline/dates';
import { finiteNumber, formatNumber, roundHalfAwayFromZero, scalarText, textEquals, titleCase, wordsCase } from './pipeline/text';

/**
 * The one definition of what an operand and a condition mean, for every consumer: a Data Flow, a `visibleWhen`, a rule-based value and an
 * authored string. The app's `ServerUIOperand` and `ServerUIPredicate` implement the same definition, and the evaluation corpus holds the
 * answers both must give byte for byte. Evaluation is total: anything missing is `unavailable` (or `loading` while the first states arrive);
 * nothing throws except the budget hook a flow installs.
 *
 * Conditions give yes, no or unknown (Kleene logic). `compare`, `in` and `exists` give unknown only when an operand is `loading` or
 * `unavailable`; a value, null or wrongly typed, gives no. A flow runs the same definition in `flow` mode: there is no `loading` or
 * `unavailable` (a missing value is `null`, so a condition is yes or no), and an `object` or `list` keeps a null part as null.
 * Text equality, text order, number text and rounding are the rules of `pipeline/text.ts`, which the app follows too.
 */

/** What reading a value gives: the value, "not yet" or "not available". */
export type ReadResult = { status: 'value'; value: Json } | { status: 'loading' } | { status: 'unavailable' };
/** The outcome of a condition: it holds, it does not, or the data to say is not there. */
export type Tri = 'yes' | 'no' | 'unknown';
/** The signed-in person an expression can ask about. Absent fields are not known yet. */
export interface Viewer { userId?: string; isAdmin?: boolean; personEntityId?: string }
/** The state snapshot an evaluation reads. */
export interface Environment {
  /** The value at `path` of a declared source (`['state']` or `['attributes', ...]` for an entity; a read field for a model). */
  read(sourceId: string, path: string[]): ReadResult;
  /** The signed-in person; undefined before the connection knows them. */
  viewer?: Viewer;
  /** The state of the viewer's `person.*` entity. */
  viewerPersonState?(): ReadResult;
  /**
   * The state text of an `ha-entity` source exactly as Home Assistant reports it (`raw-state`): an entity that is `unknown` or `unavailable` gives that
   * text as a value, so the two can be told apart. `unavailable` is for a source that has no entity at all; `loading` before the first states arrive.
   * A host without it (a flow's) gives `unavailable`.
   */
  readRaw?(sourceId: string): ReadResult;
  /**
   * When the state of an `ha-entity` source last changed, as `YYYY-MM-DDTHH:MM:SS.sssZ` (`last-changed`, `sh.entity-time@1`). `unavailable` for a source
   * with no entity or no time, `loading` before the first states arrive. A host without it (a flow's) gives `unavailable`.
   */
  readChanged?(sourceId: string): ReadResult;
  /** The new value of the control that sent the action being resolved. */
  controlValue?: Json;
  /** The new value of each stopper of a dial control, by stopper id: what `control` with a `stopper` reads (`sh.dial-control@1`). */
  controlValues?: Readonly<Record<string, Json>>;
  /**
   * The clock `clock` and `date` use; absent means they are unavailable. `now-second` reads the same `now`: a host that ticks once a second (the
   * preview, the app) gives it seconds that move, and a host that does not gives the minute's.
   */
  clock?: Clock;
  /** The item a flow step or a repeat is looking at (`item` operands). */
  item?: Json;
  /** The 0-based position of that item (`index` operands, `sh.repeat@1`). */
  index?: number;
  /** The evaluated parameters of a flow (`param` operands). */
  params?: { get(name: string): Json | undefined };
  /** Flow mode (see above). */
  flow?: boolean;
  /** Whether the app draws a symbol of this name (`UIImage(systemName:)`); absent means every well-formed name is drawn. */
  hasSymbol?(name: string): boolean;
  /** Called once for every operand and condition node evaluated; a flow's budget throws from here. */
  spend?(): void;
}

export const unavailable: ReadResult = { status: 'unavailable' };
export const loading: ReadResult = { status: 'loading' };
export const value = (v: Json): ReadResult => ({ status: 'value', value: v });

export { finiteNumber, scalarText, formatNumber, roundHalfAwayFromZero };

const isRecord = (v: Json | undefined): v is { [key: string]: Json } => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The value at `path` of an object tree, or null when a segment is missing or not an object. An empty path is the value itself. */
export function valueAt(v: Json | undefined, path: readonly string[]): Json {
  let current: Json | undefined = v;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current === undefined ? null : current;
}
/** Coerces a read to its declared kind: a Home Assistant state is text, so `"3"` reads as the number 3; anything else is undefined. */
export function coerce(v: Json, kind: 'string' | 'number' | 'boolean' | 'entity-id'): Json | undefined {
  if (kind === 'string' && typeof v === 'string') return v;
  if (kind === 'entity-id' && typeof v === 'string') return /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(v) ? v : undefined;
  if (kind === 'boolean') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
  if (kind === 'number') return finiteNumber(v);
  return undefined;
}
/** Whether two scalars are equal: the same number or boolean, or the same text under NFC (so `"1"` and `1` match). */
export function sameScalar(a: Json, b: Json): boolean {
  if (typeof a === 'string' && typeof b === 'string') return textEquals(a, b);
  if (typeof a === typeof b && (typeof a === 'number' || typeof a === 'boolean')) return a === b;
  const left = scalarText(a), right = scalarText(b);
  return left !== undefined && right !== undefined && textEquals(left, right);
}
const combine = (parts: ReadResult[]): ReadResult | undefined =>
  parts.some(p => p.status === 'loading') ? loading : parts.some(p => p.status === 'unavailable') ? unavailable : undefined;

// MARK: Operands

/**
 * `env` with every way an expression reads watched: a read, a raw state, a last change and the viewer's person state that answer `loading`, and a viewer
 * that is not known yet, call `notYet`. The result inherits from `env` (so an absent hook stays absent) and nothing is read until a test asks.
 */
export function watching(env: Environment, notYet: () => void): Environment {
  const seen = (found: ReadResult): ReadResult => { if (found.status === 'loading') notYet(); return found; };
  const out: Environment = Object.create(env);
  Object.defineProperties(out, {
    read: { value: (sourceId: string, path: string[]) => seen(env.read(sourceId, path)) },
    viewer: { get: () => { if (!env.viewer) notYet(); return env.viewer; } },
    ...(env.readRaw ? { readRaw: { value: (sourceId: string) => seen(env.readRaw!(sourceId)) } } : {}),
    ...(env.readChanged ? { readChanged: { value: (sourceId: string) => seen(env.readChanged!(sourceId)) } } : {}),
    ...(env.viewerPersonState ? { viewerPersonState: { value: () => seen(env.viewerPersonState!()) } } : {}),
  });
  return out;
}

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
      return roundHalfAwayFromZero(n[0] * factor) / factor || 0;
    }
    case 'clamp': return n[1] <= n[2] ? Math.min(Math.max(n[0], n[1]), n[2]) : undefined;
    case 'truncate': {
      // Toward zero (`sh.math-truncate@1`); a result of -0 is 0.
      const places = n.length === 2 ? n[1] : 0;
      if (!Number.isInteger(places) || places < 0 || places > 6) return undefined;
      const factor = 10 ** places;
      return Math.trunc(n[0] * factor) / factor || 0;
    }
    case 'scale': return n[1] === n[2] ? undefined : n[3] + (n[0] - n[1]) / (n[2] - n[1]) * (n[4] - n[3]);
  }
}

/** Evaluates an operand against `env`. */
export function evaluateOperand(operand: Operand, env: Environment): ReadResult {
  env.spend?.();
  const result = operandResult(operand, env);
  // A flow has no loading or unavailable: a gap is null.
  return env.flow && result.status !== 'value' ? value(null) : result;
}
function operandResult(operand: Operand, env: Environment): ReadResult {
  switch (operand.type) {
    case 'literal': return value(operand.value);
    case 'control': {
      const sent = operand.stopper === undefined ? env.controlValue : env.controlValues?.[operand.stopper];
      return sent === undefined ? unavailable : value(sent);
    }
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
    case 'raw-state': {
      // Never inside a flow, whose reads are its own.
      if (env.flow) return unavailable;
      const state = env.readRaw?.(operand.sourceId) ?? unavailable;
      return state.status === 'value' && typeof state.value !== 'string' ? unavailable : state;
    }
    case 'last-changed': {
      if (env.flow) return unavailable;
      const changed = env.readChanged?.(operand.sourceId) ?? unavailable;
      return changed.status === 'value' && typeof changed.value !== 'string' ? unavailable : changed;
    }
    case 'list-count': {
      if (env.flow) return unavailable;
      const list = env.read(operand.from.sourceId, operand.from.path);
      if (list.status !== 'value') return list;
      return Array.isArray(list.value) ? value(list.value.length) : unavailable;
    }
    case 'count': {
      // The tests read the document's sources, which a flow does not have.
      if (env.flow) return unavailable;
      // Every way a test reads is watched; any "not yet" makes an unanswerable count `loading` rather than `unavailable`.
      let waiting = false;
      const watched = watching(env, () => { waiting = true; });
      let held = 0, considered = 0, unknown = 0;
      for (const entry of operand.of) {
        if (entry.viewer) {
          // No signed-in person yet: nothing about "whose" can be said. A person who is not one of the listed ones, or has no person entity, is simply not counted.
          if (!env.viewer) return loading;
          if (env.viewer.personEntityId === undefined || !entry.viewer.personEntityIds.includes(env.viewer.personEntityId)) continue;
        }
        considered += 1;
        const answer = evaluatePredicate(entry.test, watched);
        if (answer === 'yes') held += 1;
        else if (answer === 'unknown') unknown += 1;
      }
      return considered > 0 && unknown === considered ? (waiting ? loading : unavailable) : value(held);
    }
    case 'list-includes': {
      if (env.flow) return unavailable;
      const list = env.read(operand.from.sourceId, operand.from.path), needle = evaluateOperand(operand.value, env);
      const blocked = combine([list, needle]);
      if (blocked) return blocked;
      if (list.status !== 'value' || needle.status !== 'value' || !Array.isArray(list.value) || !scalarValue(needle.value)) return unavailable;
      return value(list.value.some(item => scalarValue(item) && sameScalar(item, needle.value)));
    }
    case 'item': return env.item === undefined ? unavailable : value(valueAt(env.item, operand.path));
    case 'index': return env.index === undefined ? unavailable : value(env.index);
    case 'param': {
      const found = env.params?.get(operand.name);
      return found === undefined ? unavailable : value(found);
    }
    case 'clock': {
      const clock = env.clock;
      if (!clock || !clockTime(clock)) return unavailable;
      return value(operand.part === 'today' ? clockToday(clock)! : clock.now);
    }
    case 'date': {
      const from = evaluateOperand(operand.from, env), to = evaluateOperand(operand.to, env);
      const blocked = combine([from, to]);
      if (blocked) return blocked;
      if (from.status !== 'value' || to.status !== 'value' || typeof from.value !== 'string' || typeof to.value !== 'string') return unavailable;
      if (operand.op === 'progress') {
        const fraction = env.clock ? progressBetween(from.value, to.value, env.clock) : undefined;
        return fraction === undefined ? unavailable : value(fraction);
      }
      if (operand.op === 'seconds-between') {
        const seconds = secondsBetween(from.value, to.value, env.clock?.utcOffsetMinutes ?? 0);
        return seconds === undefined ? unavailable : value(seconds);
      }
      const days = daysBetween(from.value, to.value, env.clock?.utcOffsetMinutes ?? 0);
      return days === undefined ? unavailable : value(days);
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
        if (found?.status !== 'value' || scalarText(found.value) === undefined) return unavailable;
        const spec = operand.formats?.[name];
        if (spec && 'text' in spec) {
          // A case draws the text of any scalar; a number or a boolean has no letter to change.
          output += (spec.text.case === 'words' ? wordsCase : titleCase)(scalarText(found.value)!);
        } else if (spec && 'date' in spec) {
          // A date style draws a date or a date and time; any other value has no text, so the whole format is unavailable.
          const drawn = typeof found.value === 'string' ? formatDate(spec.date.style, found.value, env.clock) : undefined;
          if (drawn === undefined) return unavailable;
          output += drawn;
        } else if (spec && 'duration' in spec) {
          // A duration draws a number; anything else, or a number with no text (a compact duration of 0 or less), leaves the whole format without one.
          const drawn = finiteNumber(found.value) === undefined ? undefined : formatDuration(spec.duration.style, spec.duration.unit, finiteNumber(found.value)!);
          if (drawn === undefined) return unavailable;
          output += drawn;
        } else {
          const digits = spec?.number.maximumFractionDigits, number = finiteNumber(found.value);
          output += digits !== undefined && number !== undefined ? formatNumber(number, digits, spec?.number.minimumFractionDigits) : scalarText(found.value)!;
        }
        rest = rest.slice(close + 1);
      }
      return value(output + rest);
    }
    case 'map': {
      const subject = evaluateOperand(operand.of, env);
      if (subject.status !== 'value') return subject;
      if (subject.value === null) return unavailable;
      const hit = operand.cases.find(branch => sameScalar(subject.value, branch.equals));
      return evaluateOperand(hit ? hit.then : operand.otherwise, env);
    }
    case 'choose': {
      // The first case that holds gives the value. A case that cannot be answered yet stops the rule: nothing later may stand in for it,
      // and the slot keeps what it showed (`loading`).
      const picked = pickCase(operand.cases.length, index => evaluatePredicate(operand.cases[index].when, env));
      if (picked === 'stalled') return loading;
      return evaluateOperand(picked === 'otherwise' ? operand.otherwise : operand.cases[picked].then, env);
    }
    case 'math': {
      const parts = operand.args.map(arg => evaluateOperand(arg, env));
      const blocked = combine(parts);
      if (blocked) return blocked;
      const numbers = parts.map(part => part.status === 'value' ? finiteNumber(part.value) : undefined);
      const [low, high] = mathArity[operand.op];
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

// MARK: Conditions

const all = (parts: Tri[]): Tri => parts.includes('no') ? 'no' : parts.includes('unknown') ? 'unknown' : 'yes';
const any = (parts: Tri[]): Tri => parts.includes('yes') ? 'yes' : parts.includes('unknown') ? 'unknown' : 'no';
const negate = (part: Tri): Tri => part === 'yes' ? 'no' : part === 'no' ? 'yes' : 'unknown';
const member = (list: string[], v: Json): Tri => {
  const text = scalarText(v);
  return text === undefined ? 'unknown' : list.includes(text) ? 'yes' : 'no';
};
/** The ordering key of a date or date and time text on the environment's clock, or undefined. */
function instantOf(v: Json, env: Environment): number | undefined {
  if (typeof v !== 'string') return undefined;
  const time = wallTime(v, env.clock?.utcOffsetMinutes ?? 0);
  return time ? instant(time) : undefined;
}
const scalarValue = (v: Json): boolean => v !== null && typeof v !== 'object';

/** Evaluates a condition to yes, no or unknown (Kleene logic: one `no` settles `all`, one `yes` settles `any`). */
export function evaluatePredicate(predicate: Predicate, env: Environment): Tri {
  env.spend?.();
  const answer = predicateResult(predicate, env);
  return env.flow && answer === 'unknown' ? 'no' : answer;
}
function predicateResult(predicate: Predicate, env: Environment): Tri {
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
    case 'exists': {
      const found = evaluateOperand(predicate.value, env);
      return found.status !== 'value' ? 'unknown' : found.value !== null ? 'yes' : 'no';
    }
    case 'in': {
      const subject = evaluateOperand(predicate.value, env);
      const options = predicate.in.map(option => evaluateOperand(option, env));
      if (subject.status !== 'value') return 'unknown';
      if (!scalarValue(subject.value)) return 'no';
      if (options.some(option => option.status === 'value' && scalarValue(option.value) && sameScalar(subject.value, option.value))) return 'yes';
      return options.some(option => option.status !== 'value') ? 'unknown' : 'no';
    }
    case 'compare': {
      const left = evaluateOperand(predicate.left, env), right = evaluateOperand(predicate.right, env);
      if (left.status !== 'value' || right.status !== 'value') return 'unknown';
      const a = left.value, b = right.value;
      switch (predicate.op) {
        case 'eq': case 'ne': return scalarValue(a) && scalarValue(b) && sameScalar(a, b) === (predicate.op === 'eq') ? 'yes' : 'no';
        case 'above': case 'below':
          return typeof a === 'number' && typeof b === 'number' && (predicate.op === 'above' ? a > b : a < b) ? 'yes' : 'no';
        case 'before': case 'after': {
          const x = instantOf(a, env), y = instantOf(b, env);
          return x !== undefined && y !== undefined && (predicate.op === 'before' ? x < y : x > y) ? 'yes' : 'no';
        }
      }
    }
  }
}

// MARK: Rules

/**
 * Which case of a rule is used: the index of the first case that holds, `otherwise` when none does, or `stalled` when a case that cannot be
 * answered yet stands before any that holds. This is the ONE place that decides what "a case that can't tell" means, for a `choose`, a
 * `conditional` look and a `conditional` action alike: today it stops the rule (nothing later may stand in for it), and each caller decides what
 * a stalled rule shows (a `choose` is `loading`, so the slot keeps what it showed; a look falls back to `otherwise`; an action does nothing).
 * To make a rule skip a case that can't tell instead, change the `unknown` line below and nothing else.
 */
export function pickCase(count: number, answer: (index: number) => Tri): number | 'otherwise' | 'stalled' {
  for (let index = 0; index < count; index++) {
    const answered = answer(index);
    if (answered === 'yes') return index;
    if (answered === 'unknown') return 'stalled';
  }
  return 'otherwise';
}

/** A look that depends on conditions (`sh.rules@1`): the first case that holds, else `otherwise`. */
export interface Conditional<T> { type: 'conditional'; cases: { when: Predicate; then: T }[]; otherwise: T }
/**
 * The look a slot has now. A rule that is stalled shows `otherwise` until it can answer; a rule on a look never blanks it. A plain look is
 * returned as it is.
 */
export function resolveLook<T extends { type: string }>(slot: T | Conditional<T>, env: Environment): T {
  if (slot.type !== 'conditional') return slot as T;
  const rule = slot as Conditional<T>;
  const picked = pickCase(rule.cases.length, index => evaluatePredicate(rule.cases[index].when, env));
  return typeof picked === 'number' ? rule.cases[picked].then : rule.otherwise;
}

// MARK: Looks, text and badges

/** What a look slot gives: the look, or "not yet" (the slot keeps what it showed). */
export type LookResult<T> = { status: 'value'; look: T } | { status: 'loading' };
/** An exact color. */
export type SolidRgb = { type: 'solid-rgb'; red: number; green: number; blue: number };
/** An exact color for each appearance (`sh.solid-appearance@1`). */
export type SolidAppearance = { type: 'solid-appearance'; light: SolidRgb; dark: SolidRgb };
/** A fill: the standard one, an exact color, or an exact color for each appearance. */
export type Fill = { type: 'standard' } | SolidRgb | SolidAppearance;
/** A symbol as the document spells it. */
export interface SymbolLook { type: 'sf-symbol'; name: string; rendering: 'canonical'; unavailable: 'fallback' }
/** A color from an entity's text (`sh.rules@1`): clamped to read, with a required fallback for when there is no color. */
export interface BoundColor<F> { type: 'bound-color'; value: Operand; fallback: F }
/** A symbol named by an entity's text (`sh.rules@1`), with a required fallback. */
export interface BoundSymbol { type: 'bound-symbol'; value: Operand; fallback: SymbolLook }

/**
 * The fill a slot draws. A `bound-color` reads its value as text: loading is "not yet"; text that is a tier 1 color (`color.ts`) becomes the
 * clamped color of `role` (`fill` or `glyph`); anything else (unavailable, a number, a name, alpha 0) is the fallback. A `conditional` holds exact fills.
 */
export function resolveFill<F extends Fill>(slot: F | Conditional<F> | BoundColor<F>, env: Environment, role: ColorRole = 'fill'): LookResult<F | Fill> {
  if (slot.type !== 'bound-color') return { status: 'value', look: resolveLook(slot as F | Conditional<F>, env) };
  const found = evaluateOperand(slot.value, env);
  if (found.status === 'loading') return { status: 'loading' };
  const parsed = found.status === 'value' && typeof found.value === 'string' ? parseColor(found.value) : undefined;
  return { status: 'value', look: parsed ? { type: 'solid-rgb', ...clampedColor(parsed, role) } : slot.fallback };
}
/**
 * The symbol a slot draws. A `bound-symbol` reads its value as text: loading is "not yet"; text of 1 to 80 characters the app can draw is the
 * symbol (the fallback's other fields kept); anything else is the fallback.
 */
export function resolveSymbol(slot: SymbolLook | Conditional<SymbolLook> | BoundSymbol, env: Environment): LookResult<SymbolLook> {
  if (slot.type !== 'bound-symbol') return { status: 'value', look: resolveLook(slot as SymbolLook | Conditional<SymbolLook>, env) };
  const found = evaluateOperand(slot.value, env);
  if (found.status === 'loading') return { status: 'loading' };
  const name = found.status === 'value' && typeof found.value === 'string' ? found.value.trim() : '';
  const drawn = name.length > 0 && name.length <= 80 && (env.hasSymbol?.(name) ?? true);
  return { status: 'value', look: drawn ? { ...slot.fallback, name } : slot.fallback };
}

/** A text slot: a literal, a read or an `expr`, each with an optional fallback for when the value is unavailable. */
export type TextSlot = { type: 'literal'; value: string } | ({ type: 'read' } & Extract<Operand, { type: 'read' }> & { fallback?: string })
  | { type: 'expr'; value: Operand; fallback?: string };
/** What a text slot gives: its value, "not yet" (`loading`: the slot keeps what it showed) or, with no fallback, `unavailable`. */
export function resolveText(slot: TextSlot, env: Environment): ReadResult {
  const result = evaluateOperand(slot.type === 'expr' ? slot.value : slot as Operand, env);
  const fallback = slot.type === 'literal' ? undefined : slot.fallback;
  return result.status === 'unavailable' && fallback !== undefined ? value(fallback) : result;
}

/** A badge as an evaluator reads it: none, or a value and, from `sh.badge-spoken@1`, the words VoiceOver says for it. */
export type BadgeSlot = { type: 'none' } | { type: 'value'; value: Operand; spoken?: Operand };
/**
 * A badge value (`sh.badges@1`): a number or text. It draws nothing (`null`) when it is `none`, empty, 0 (the number, or text that reads as 0) or
 * unavailable (a rule that stalls with no source loading, raw reads included, counts as unavailable), and is "not yet" while a source loads, so the badge keeps what it showed. A number prints as `scalarText` prints it.
 *
 * With `spoken` (`sh.badge-spoken@1`) the answer also says `spoken`: the words VoiceOver adds after the name, or `null` to say the drawn text. A badge that
 * draws nothing says nothing; a `spoken` that is empty, not text or unavailable says the drawn text; one still loading keeps what the badge showed. A badge
 * with no `spoken` answers exactly as before, with no `spoken` key.
 */
export function resolveBadge(badge: BadgeSlot | undefined, env: Environment): { status: 'value'; text: string | null; spoken?: string | null } | { status: 'loading' } {
  if (!badge || badge.type === 'none') return { status: 'value', text: null };
  // A rule that stalls is `loading` to every slot. For a badge, "not yet" must mean a source that is still loading: a stall in which no read was loading
  // is a count that cannot be read, and that draws nothing (the value rule), so a capped count behaves like a plain one.
  let waiting = false;
  const watched = watching(env, () => { waiting = true; });
  const found = evaluateOperand(badge.value, watched);
  if (found.status === 'loading' && !waiting) return { status: 'value', text: null, ...(badge.spoken ? { spoken: null } : {}) };
  if (found.status === 'loading') return { status: 'loading' };
  if (found.status !== 'value' || (typeof found.value !== 'string' && typeof found.value !== 'number')) return { status: 'value', text: null, ...(badge.spoken ? { spoken: null } : {}) };
  const text = scalarText(found.value)!.trim();
  const drawn = text === '' || finiteNumber(text) === 0 ? null : text;
  if (!badge.spoken) return { status: 'value', text: drawn };
  if (drawn === null) return { status: 'value', text: null, spoken: null };
  const said = evaluateOperand(badge.spoken, env);
  if (said.status === 'loading') return { status: 'loading' };
  const words = said.status === 'value' && typeof said.value === 'string' ? said.value.trim() : '';
  return { status: 'value', text: drawn, spoken: words === '' ? null : words };
}

// MARK: Enabled, tile faces, actions and questions

/**
 * Whether a control is enabled (`sh.enabled-when@1`). No rule means enabled. While the condition cannot be answered, `enabled` and `disabled` say so
 * and `keep` repeats `previous` (enabled when it was never answered), so a reconnect never flips a control.
 */
export function isEnabled(rule: EnabledWhen | undefined, env: Environment, previous?: boolean): boolean {
  if (!rule) return true;
  const answer = evaluatePredicate(rule.condition, env);
  if (answer !== 'unknown') return answer === 'yes';
  return rule.whenUnknown === 'enabled' ? true : rule.whenUnknown === 'disabled' ? false : previous ?? true;
}

/** The three faces a state tile's conditions decide; `null` is "from the style". */
export interface TileFaces { active: boolean | null; filled: boolean | null; error: boolean | null }
/** The conditions a `state-tile` may carry (`sh.tile-look@1`). */
export interface TileLook { activeWhen?: Predicate; filledWhen?: Predicate; errorWhen?: Predicate }
/**
 * What a state tile's look conditions decide. A condition that holds sets its face on; `activeWhen` that does not hold sets the unlit face. A
 * condition that cannot be answered, or is absent, leaves the face to the style's class.
 */
export function tileFaces(look: TileLook, env: Environment): TileFaces {
  const face = (rule: Predicate | undefined): boolean | null => {
    if (!rule) return null;
    const answer = evaluatePredicate(rule, env);
    return answer === 'unknown' ? null : answer === 'yes';
  };
  return { active: face(look.activeWhen), filled: face(look.filledWhen), error: face(look.errorWhen) };
}

/** An action chosen by rule (`sh.action-rules@1`): the first case that holds, else `otherwise` (an action, or `none`). One level only. */
export interface ConditionalAction<A> { type: 'conditional'; cases: { when: Predicate; then: A }[]; otherwise: A | { type: 'none' } }
/** Which case of a conditional action is used: its index, `otherwise` or `stalled` (a case that cannot be answered yet; nothing runs). */
export const pickAction = (rule: ConditionalAction<unknown>, env: Environment): number | 'otherwise' | 'stalled' =>
  pickCase(rule.cases.length, index => evaluatePredicate(rule.cases[index].when, env));
/** The action to run now: the chosen case's, `otherwise`'s, or `undefined` when it is `none` or the rule is stalled. */
export function resolveAction<A extends { type: string }>(rule: A | ConditionalAction<A>, env: Environment): A | undefined {
  if (rule.type !== 'conditional') return rule as A;
  const conditional = rule as ConditionalAction<A>;
  const picked = pickAction(conditional, env);
  if (picked === 'stalled') return undefined;
  const chosen = picked === 'otherwise' ? conditional.otherwise : conditional.cases[picked].then;
  return chosen.type === 'none' ? undefined : chosen as A;
}

/**
 * Whether an action asks first (`sh.confirm-when@1`): with no `when` it always asks; a `when` that holds asks, one that does not holds back the
 * question, and one that cannot be answered asks, so a gap never skips a question the author wanted.
 */
export function asksFirst(when: Predicate | undefined, env: Environment): boolean {
  return when === undefined || evaluatePredicate(when, env) !== 'no';
}

// MARK: Layout parts (`sh.tile-parts@1`, `sh.tab-blocks@1`)

/**
 * The fill of a state tile's progress (`sh.tile-parts@1`): the operand's number clamped to 0 through 1. Anything that is not a number, a value that is
 * loading and a value that is unavailable draw no progress (`null`).
 */
export function tileProgress(operand: Operand | undefined, env: Environment): number | null {
  if (!operand) return null;
  const result = evaluateOperand(operand, env);
  if (result.status !== 'value' || typeof result.value !== 'number' || !Number.isFinite(result.value)) return null;
  return Math.min(1, Math.max(0, result.value));
}

/** A tab or area's rule: shown while `visibleWhen` holds; an answer that cannot be given follows `whenUnknown` (`keep` repeats `previous`, shown when never answered). */
export function ruleHolds(rule: { visibleWhen?: Predicate; whenUnknown?: 'show' | 'hide' | 'keep' }, env: Environment, previous?: boolean): boolean {
  if (!rule.visibleWhen) return true;
  const answer = evaluatePredicate(rule.visibleWhen, env);
  if (answer !== 'unknown') return answer === 'yes';
  const policy = rule.whenUnknown ?? 'keep';
  return policy === 'show' ? true : policy === 'hide' ? false : previous ?? true;
}

/**
 * The tab a container shows: the one asked for while its rule lets it show, else the fallback tab while that shows, else the first tab that shows.
 * When no tab shows, the first tab (a container never draws nothing).
 */
export function tabOnShow(tabs: readonly { id: string; visibleWhen?: Predicate; whenUnknown?: 'show' | 'hide' | 'keep' }[], requested: string | undefined, fallback: string | undefined, env: Environment): string {
  const shows = (id: string | undefined) => { const tab = tabs.find(item => item.id === id); return tab !== undefined && ruleHolds(tab, env); };
  if (shows(requested)) return requested!;
  if (shows(fallback)) return fallback!;
  return tabs.find(tab => ruleHolds(tab, env))?.id ?? tabs[0].id;
}

/** The tone a readout draws: its own, or the first case of a rule that holds, else `otherwise`. A stalled rule shows `otherwise` until it can answer, as a look does (`sh.rules@1`). */
export function resolveTone<T extends string>(tone: T | Conditional<T>, env: Environment): T {
  if (typeof tone === 'string') return tone;
  const picked = pickCase(tone.cases.length, index => evaluatePredicate(tone.cases[index].when, env));
  return typeof picked === 'number' ? tone.cases[picked].then : tone.otherwise;
}
