import { z } from 'zod/v4';
import {
  callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, operandSchema, predicateBase, predicateSchema,
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
/** Select the same discriminator-matching union branch as composition diagnostics. */
export function expandSchemaIssues(list: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] {
  return list.flatMap(issue => {
    if (issue.code !== 'invalid_union' || !('errors' in issue) || !Array.isArray(issue.errors)) return [issue];
    const branches = (issue.errors as z.core.$ZodIssue[][]).filter(branch => branch.length && !branch.some(inner => inner.path.at(-1) === 'type' && inner.path.length === 1));
    if (branches.length !== 1) return [issue];
    return expandSchemaIssues(branches[0].map(inner => ({ ...inner, path: [...issue.path, ...inner.path] }) as z.core.$ZodIssue));
  });
}

/** Template validation retains its own diagnostics; only refused structural guards are observed here. */
export function observeStructuralRefusals(
  schema: z.ZodType, input: unknown, issues: readonly z.core.$ZodIssue[], observer: BudgetAccountingObserver, base: string,
): void {
  const observed = new Map<string, 'complete' | 'partial'>();
  const read = (path: readonly PropertyKey[]) => path.reduce<unknown>((value, key) =>
    value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined, input);
  for (const issue of expandSchemaIssues(issues)) observeSchemaRefusal(schema, input, read, issue, observer, base, observed);
}

interface SchemaRoot { readonly kind: RefusedKind; readonly value: unknown; readonly depth: number }
function schemaVariantMatches(schema: z.core.$ZodType, value: unknown): boolean {
  if (schema instanceof z.ZodLazy) return schemaVariantMatches(schema.unwrap(), value);
  if (schema instanceof z.ZodUnion) return schema.options.some(option => schemaVariantMatches(option, value));
  if (!(schema instanceof z.ZodObject) || value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['type', 'kind', 'op', 'model'].every(key => {
    const tag = schema.shape[key];
    return !(tag instanceof z.ZodLiteral || tag instanceof z.ZodEnum) || tag.safeParse(Reflect.get(value, key)).success;
  });
}
function schemaRoot(
  schema: z.core.$ZodType, value: unknown, path: readonly PropertyKey[], depth = 0, seen = new Set<z.core.$ZodType>(),
): SchemaRoot | undefined {
  if (seen.has(schema)) return undefined;
  const kind = schema === callServiceSchema ? 'call'
    : schema === operandBase || schema === operandSchema ? 'operand'
    : schema === predicateBase || schema === predicateSchema ? 'predicate' : undefined;
  if (kind) return schemaVariantMatches(schema, value) ? { kind, value, depth } : undefined;
  const next = new Set(seen).add(schema);
  if (schema instanceof z.ZodLazy || schema instanceof z.ZodOptional || schema instanceof z.ZodNullable
    || schema instanceof z.ZodDefault || schema instanceof z.ZodCatch || schema instanceof z.ZodReadonly || schema instanceof z.ZodNonOptional) {
    return schemaRoot(schema.unwrap(), value, path, depth, next);
  }
  if (schema instanceof z.ZodPipe) return schemaRoot(schema.in, value, path, depth, next);
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      const found = schemaRoot(option, value, path, depth, next);
      if (found) return found;
    }
    return undefined;
  }
  if (schema instanceof z.ZodObject) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (!schemaVariantMatches(schema, value)) return undefined;
    // Both call data and pipeline request data have this shared operand structure without the outer lazy schema.
    if (schema.shape.type instanceof z.ZodLiteral && schema.shape.type.values.has('object')
      && schema.shape.fields instanceof z.ZodRecord && schema.shape.fields.valueType === operandBase) return { kind: 'operand', value, depth };
    const key = path[depth], child: z.core.$ZodType | undefined = schema.shape[String(key)];
    return child ? schemaRoot(child, Reflect.get(value, key), path, depth + 1) : undefined;
  }
  if (depth >= path.length || value === null || typeof value !== 'object') return undefined;
  const child = schema instanceof z.ZodArray ? schema.element : schema instanceof z.ZodRecord ? schema.valueType : undefined;
  return child ? schemaRoot(child, Reflect.get(value, path[depth]), path, depth + 1) : undefined;
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
  schema: z.ZodType, input: unknown, read: (path: readonly PropertyKey[]) => unknown, issue: z.core.$ZodIssue,
  observer: BudgetAccountingObserver, base: string, observed: Map<string, 'complete' | 'partial'>,
): void {
  const params: unknown = Reflect.get(issue, 'params');
  if (params !== null && typeof params === 'object' && schemaIssues?.has(params)) return;
  if (issue.code === 'invalid_key') {
    for (const inner of issue.issues) {
      const guard = guardSize(inner, issue.path.at(-1));
      if (guard) reportAccounting(observer, { type: 'schema-limit', pointer: `${base}${pathPointer(issue.path)}`, ...guard, partial: true });
    }
    return;
  }
  const own = pathPointer(issue.path), value = read(issue.path);
  const guard = guardSize(issue, value);
  if (!guard) return;
  const partial: GuardSnapshot = {
    type: 'schema-limit', pointer: `${base}${own}`, ...guard, partial: true,
  };
  const root = schemaRoot(schema, input, issue.path);
  if (root) {
    const at = pathPointer(issue.path.slice(0, root.depth)), { kind, value: candidate } = root;
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
