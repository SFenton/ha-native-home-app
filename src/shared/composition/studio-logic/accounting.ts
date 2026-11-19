import type { BudgetAccountingEvent, BudgetAccountingObserver } from '../expression';
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
        reportAccounting(observer, { ...event, pointer: at }); break;
    }
  }
}
