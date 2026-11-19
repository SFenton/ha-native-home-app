import { z } from 'zod/v4';
import {
  callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, predicateBase,
  type BudgetAccountingEvent, type BudgetAccountingObserver, type CallService, type Operand, type Predicate,
} from '../expression';
import { pointer } from '../json';

let schemaAccounting = false;
let observerFailures: WeakSet<object> | undefined;
interface SchemaTrace {
  readonly events: BudgetAccountingEvent[];
  readonly observer: BudgetAccountingObserver;
}
let schemaIssues: WeakMap<object, { trace: SchemaTrace; depth: number }> | undefined;

export function rethrowAccountingObserverFailure(error: unknown): never {
  if (error !== null && typeof error === 'object') (observerFailures ??= new WeakSet()).add(error);
  throw error;
}
export function isAccountingObserverFailure(error: unknown): boolean {
  return error !== null && typeof error === 'object' && observerFailures?.has(error) === true;
}
export function reportAccounting(observer: BudgetAccountingObserver, event: BudgetAccountingEvent): void {
  try { observer(event); }
  catch (error) { rethrowAccountingObserverFailure(error); }
}

/** Synchronous parse scope, restored even when schema code throws or parses recursively. */
export function withSchemaAccounting<T>(parse: () => T): T {
  const previous = schemaAccounting;
  schemaAccounting = true;
  try { return parse(); }
  finally { schemaAccounting = previous; }
}
export function beginSchemaAccounting(): SchemaTrace | undefined {
  if (!schemaAccounting) return undefined;
  const events: BudgetAccountingEvent[] = [];
  return { events, observer: event => { events.push(event); } };
}
export function attachSchemaAccounting(issue: object, trace: SchemaTrace, depth: number): void {
  // Zod prefixes/copies issues, but retains their params object while finalizing them.
  const held: unknown = Reflect.get(issue, 'params');
  const params = held !== null && typeof held === 'object' ? held : {};
  Reflect.set(issue, 'params', params);
  (schemaIssues ??= new WeakMap()).set(params, { trace, depth });
}

/** Emit only enforcing schema traces, not a second copy of successful scoped checks. */
export function emitSchemaAccounting(
  issue: { readonly path: readonly PropertyKey[] }, observer: BudgetAccountingObserver, base: string, emitted: Set<object>,
): void {
  const params: unknown = Reflect.get(issue, 'params');
  const found = params !== null && typeof params === 'object' ? schemaIssues?.get(params) : undefined;
  if (!found || emitted.has(found.trace)) return;
  emitted.add(found.trace);
  const root = issue.path.slice(0, issue.path.length - found.depth).reduce<string>((at, part) => pointer(at, String(part)), base);
  const scope = (id: string) => {
    const colon = id.indexOf(':') + 1;
    return `${id.slice(0, colon)}${root}${id.slice(colon)}`;
  };
  for (const event of found.trace.events) {
    const at = `${root}${event.pointer}`;
    switch (event.type) {
      case 'scope':
      case 'node':
      case 'steps':
        reportAccounting(observer, { ...event, pointer: at, scopeId: scope(event.scopeId) }); break;
      case 'condition-budget':
        reportAccounting(observer, { ...event, pointer: at, scopeId: scope(event.scopeId), previousScopeId: scope(event.previousScopeId) }); break;
      case 'rule-cases':
      case 'schema-limit':
        reportAccounting(observer, { ...event, pointer: at }); break;
    }

  }
}

type RefusedKind = 'operand' | 'predicate' | 'call';
let grammarKinds: Map<string, Set<RefusedKind>> | undefined;
function refusedKind(value: object): RefusedKind | undefined {
  const type: unknown = Reflect.get(value, 'type');
  if (typeof type !== 'string') return undefined;
  if (!grammarKinds) {
    grammarKinds = new Map();
    for (const [kind, schema] of [['operand', operandBase], ['predicate', predicateBase], ['call', callServiceSchema]] as const) {
      const concrete = schema instanceof z.ZodLazy ? schema.unwrap() : schema;
      const variants = concrete instanceof z.ZodDiscriminatedUnion ? concrete.options : [concrete];
      for (const variant of variants) {
        if (!(variant instanceof z.ZodObject)) continue;
        const discriminator: unknown = variant.shape.type;
        const types = discriminator instanceof z.ZodLiteral ? discriminator.values : discriminator instanceof z.ZodEnum ? discriminator.options : [];
        for (const type of types) if (typeof type === 'string') {
          const held = grammarKinds.get(type) ?? new Set<RefusedKind>();
          held.add(kind); grammarKinds.set(type, held);
        }
      }
    }
  }
  const kinds = grammarKinds.get(type);
  if (kinds?.size === 1) return [...kinds][0];
  if (type === 'viewer') return Object.hasOwn(value, 'field') ? 'operand' : 'predicate';
  return undefined;
}
const pathPointer = (path: readonly PropertyKey[]) => path.reduce<string>((base, part) => pointer(base, String(part)), '');
type GuardSnapshot = Extract<BudgetAccountingEvent, { type: 'schema-limit' }>;
type GuardSize = Pick<GuardSnapshot, 'count' | 'limit' | 'direction'>;
function guardSize(issue: z.core.$ZodIssue, value: unknown): GuardSize | undefined {
  const count = typeof value === 'number' ? value : typeof value === 'string' ? [...value].length : Array.isArray(value) ? value.length : undefined;
  if (count === undefined) return undefined;
  if (issue.code === 'too_big' || issue.code === 'too_small') {
    const limit = issue.code === 'too_big' ? issue.maximum : issue.minimum;
    return typeof limit === 'number' ? { count, limit, direction: issue.code === 'too_big' ? 'maximum' : 'minimum' } : undefined;
  }
  if (issue.code === 'invalid_format' && issue.format === 'regex' && typeof value === 'string' && 'pattern' in issue && typeof issue.pattern === 'string') {
    // Closed ASCII identifier guards use one repeated class, optionally preceded by a leading-character class.
    const range = /^\/\^(\[[^\]]+\])?\[[^\]]+\]\{(\d+),(\d+)\}\$\/$/.exec(issue.pattern);
    if (!range) return undefined;
    const prefix = range[1] ? 1 : 0, minimum = Number(range[2]) + prefix, maximum = Number(range[3]) + prefix;
    if (count < minimum) return { count, limit: minimum, direction: 'minimum' };
    if (count > maximum) return { count, limit: maximum, direction: 'maximum' };
  }
  if (issue.code === 'custom' && typeof value === 'string' && !value.trim()) return { count: 0, limit: 1, direction: 'minimum' };
  return undefined;
}

/** Only called after a structural size/range refusal, and only with an attached observer. */
export function observeSchemaRefusal(
  read: (path: readonly PropertyKey[]) => unknown, issue: z.core.$ZodIssue, observer: BudgetAccountingObserver, base: string, observed: Map<string, 'complete' | 'partial'>,
): void {
  const params: unknown = Reflect.get(issue, 'params');
  if (params !== null && typeof params === 'object' && schemaIssues?.has(params)) return;
  const own = pathPointer(issue.path), value = read(issue.path);
  const guard = guardSize(issue, value);
  if (!guard) return;
  const partial: GuardSnapshot = {
    type: 'schema-limit', pointer: `${base}${own}`, ...guard, partial: true,
  };
  for (let depth = issue.path.length; depth >= 0; depth--) {
    const path = issue.path.slice(0, depth), at = pathPointer(path), candidate = read(path);
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const kind = refusedKind(candidate);
    if (!kind) continue;
    if (observed.has(at)) {
      if (observed.get(at) === 'partial') reportAccounting(observer, partial);
      return;
    }
    observed.set(at, 'complete');
    const events: BudgetAccountingEvent[] = [], collect: BudgetAccountingObserver = event => { events.push(event); };
    try {
      // These roots already failed schema validation; the observation-only boundary deliberately accepts unvalidated fields.
      if (kind === 'operand') checkOperand(candidate as Operand, `${base}${at}`, true, false, 'lenient', collect);
      else if (kind === 'predicate') checkPredicate(candidate as Predicate, `${base}${at}`, false, 'lenient', collect);
      else checkCallService(candidate as CallService, `${base}${at}`, true, 'lenient', 'any', collect);
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof RangeError)) throw error;
      observed.set(at, 'partial');
      reportAccounting(observer, partial);
      return;
    }
    for (const event of events) reportAccounting(observer, event);
    return;
  }
  reportAccounting(observer, partial);
}
