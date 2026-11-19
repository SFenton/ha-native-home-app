import type { Json } from '../../types';
import { MAX_CALL_NODES, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES, type BudgetAccountingEvent } from '../expression';
import { PIPELINE_BUDGET } from '../pipeline/evaluate';
import { compileGraphValue, type FragmentCompilation, type FragmentOptions } from './compile';
import { grammarChildren, expressionChildren, inferFragment, type FragmentKind } from './grammar';
import { record } from './json';
import type { BudgetMeter, GraphBudget, GraphJSON, LogicAnchor } from './types';

export function budgetMeter(kind: string, used: number, limit: number | null, pointer = ''): BudgetMeter {
  const ratio = limit === null ? null : used / limit;
  return { kind, pointer, used, limit, ratio, visible: ratio !== null && ratio > 0.75, exceeded: limit !== null && used > limit };
}
export interface BudgetOptions extends FragmentOptions {
  /** Retained for call-site compatibility; requirements are never seeded from caller guesses. */
  readonly capabilities?: readonly string[];
}
export interface AccountingCompilation extends FragmentCompilation {
  /** Optional native snapshots; an unobserved compilation remains a valid input. */
  readonly accounting?: readonly BudgetAccountingEvent[];
}
export const ACCOUNTING_FOLLOW_UP = 'Owner follow-up: consume the shared read-only expression/call and flow accounting observer for totals, depths, counter scopes/resets, structural limits and expansion provenance; preserve CHK-nested-choose-budget unchanged.';

export function measureBudget(ast: Json, anchor: LogicAnchor, options: BudgetOptions = {}): GraphBudget {
  return budgetFromCompilation(ast, anchor, compileGraphValue(ast, options), options);
}
export function budgetFromCompilation(ast: Json, anchor: LogicAnchor, compiled: AccountingCompilation, options: BudgetOptions = {}): GraphBudget {
  if (compiled.accounting !== undefined) return budgetFromAccounting(anchor, compiled, compiled.accounting);
  const compilerIssues = compiled.issues;
  const scopes: GraphBudget['scopes'][number][] = [];
  const conditions: GraphBudget['conditions'][number][] = [];
  const unknownScope = (at: string, limit: number, kind: 'expression' | 'predicate' = 'expression') => {
    scopes.push({ id: `${kind}:${at}`, kind, pointer: at, nodes: null, depth: null, nodeLimit: limit, depthLimit: kind === 'predicate' ? MAX_CONDITION_DEPTH : MAX_EXPRESSION_DEPTH, entries: [at], nodeAccounting: 'unavailable' });
  };
  // This only locates fresh checker entry points. No node/depth counters are maintained here.
  const flowScopes = (value: GraphJSON, kind: 'operand' | 'condition', at: string, entry = true): void => {
    if (!record(value)) return;
    if (entry) {
      const scopeKind = kind === 'condition' ? 'predicate' : 'expression';
      const nodeLimit = kind === 'condition' ? MAX_CONDITION_NODES : MAX_EXPRESSION_NODES;
      unknownScope(at, nodeLimit, scopeKind);
      if (kind === 'condition') conditions.push({ pointer: at, nodes: null, depth: null, astNodes: null, astDepth: null });
    }
    for (const child of expressionChildren(value, kind)) {
      const childKind = child.kind === 'condition' ? 'condition' : 'operand';
      flowScopes(child.value, childKind, at + child.binding, childKind !== kind);
    }
  };
  const walk = (value: GraphJSON, hint: FragmentKind, at: string, flow = false): void => {
    const kind = inferFragment(value, hint);
    if (kind === 'operand' || kind === 'condition') {
      if (flow) { flowScopes(value, kind, at); return; }
      unknownScope(at, MAX_EXPRESSION_NODES);
      return;
    }
    if (kind === 'call') {
      unknownScope(at, MAX_CALL_NODES);
      return;
    }
    if (kind === 'flow' || kind === 'flow-inputs') flow = true;
    for (const child of grammarChildren(value, kind)) walk(child.value, child.kind, at + child.binding, flow);
  };
  const kind = inferFragment(ast, options.kind);
  if (!options.context && kind !== 'document' && (!compilerIssues.length || ['operand', 'condition', 'call'].includes(kind))) walk(compiled.expanded, kind, '');
  const firstExceedingPointer = compilerIssues.find(issue => issue.code === 'limit_exceeded')?.pointer;
  return {
    anchor, nodes: null, depth: null, conditions, scopes, counterResets: null, cases: null, steps: null,
    capabilities: compiled.capabilities, duplicatedUseCost: null, generatedFlowCount: null, runtimeLimit: PIPELINE_BUDGET,
    accepted: compilerIssues.length === 0, compilerIssues, accounting: 'unavailable', accountingUnavailableReason: ACCOUNTING_FOLLOW_UP,
    meters: [], compactVisible: firstExceedingPointer !== undefined,
    ...(firstExceedingPointer === undefined ? {} : { firstExceedingPointer }),
  };
}

/** Reduces checker snapshots, not the AST. Acceptance and failures remain the single compilation's result. */
export function budgetFromAccounting(anchor: LogicAnchor, compiled: FragmentCompilation, events: readonly BudgetAccountingEvent[]): GraphBudget {
  const scopes = new Map<string, GraphBudget['scopes'][number]>();
  const entries = new Map<string, string[]>();
  const resets: NonNullable<GraphBudget['counterResets']>[number][] = [];
  const structural: BudgetMeter[] = [];
  for (const event of events) {
    if (event.type === 'scope') {
      const visits: string[] = [];
      entries.set(event.scopeId, visits);
      scopes.set(event.scopeId, {
        id: event.scopeId, kind: event.kind === 'predicate' || event.kind === 'flow-condition' ? 'predicate' : 'expression',
        pointer: event.pointer, nodeLimit: event.nodeLimit, depthLimit: event.depthLimit, nodes: 0, depth: 0,
        entries: visits, nodeAccounting: 'compiler',
      });
    } else if (event.type === 'node') {
      const scope = scopes.get(event.scopeId);
      if (!scope) throw new Error(`Accounting node has no checker scope: ${event.scopeId}`);
      entries.get(event.scopeId)!.push(event.pointer);
      scopes.set(event.scopeId, { ...scope, nodes: event.attemptedNodes, depth: event.maxDepth });
    } else if (event.type === 'condition-budget') resets.push({
      pointer: event.pointer, scopeId: event.scopeId,
      kind: event.action === 'restore' ? 'restore' : /\/of\/\d+\/test$/.test(event.pointer) ? 'count'
        : /\/confirmation\/when$/.test(event.pointer) ? 'confirmation' : 'choose',
    });
    else if (event.type === 'rule-cases') structural.push(budgetMeter('Rule cases', event.count, event.limit, event.pointer));
    else if (event.type === 'steps') structural.push(budgetMeter('Flow steps', event.count, event.limit, event.pointer));
  }
  const scopeList = [...scopes.values()];
  const expression = scopeList.filter(scope => scope.kind === 'expression');
  const predicates = scopeList.filter(scope => scope.kind === 'predicate');
  const meters = [...scopeList.flatMap(scope => [
    budgetMeter(`${scope.kind === 'expression' ? 'Expression' : 'Predicate'} nodes`, scope.nodes!, scope.nodeLimit, scope.pointer),
    budgetMeter(`${scope.kind === 'expression' ? 'Expression' : 'Predicate'} depth`, scope.depth!, scope.depthLimit, scope.pointer),
  ]), ...structural];
  const firstExceedingPointer = compiled.issues.find(issue => issue.code === 'limit_exceeded')?.pointer;
  return {
    anchor, nodes: expression.length ? expression.reduce((total, scope) => total + scope.nodes!, 0) : null,
    depth: expression.length ? Math.max(...expression.map(scope => scope.depth!)) : null,
    conditions: predicates.map(scope => ({ pointer: scope.pointer, nodes: scope.nodes, depth: scope.depth, astNodes: null, astDepth: null })),
    scopes: scopeList, counterResets: resets,
    cases: structural.some(meter => meter.kind === 'Rule cases') ? structural.filter(meter => meter.kind === 'Rule cases').reduce((total, meter) => total + meter.used, 0) : null,
    steps: structural.some(meter => meter.kind === 'Flow steps') ? structural.filter(meter => meter.kind === 'Flow steps').reduce((total, meter) => total + meter.used, 0) : null,
    capabilities: compiled.capabilities, duplicatedUseCost: null, generatedFlowCount: null, runtimeLimit: PIPELINE_BUDGET,
    accepted: compiled.issues.length === 0, compilerIssues: compiled.issues, accounting: 'partial',
    accountingUnavailableReason: 'Expansion duplication, generated-flow totals and unobserved structural limits are unavailable; no estimated counters are shown.',
    meters, compactVisible: meters.some(meter => meter.visible) || firstExceedingPointer !== undefined,
    ...(firstExceedingPointer === undefined ? {} : { firstExceedingPointer }),
  };
}
