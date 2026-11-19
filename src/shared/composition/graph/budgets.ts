import type { Json } from '../../types';
import { MAX_CALL_NODES, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES, operandBase, predicateBase } from '../expression';
import { PIPELINE_BUDGET } from '../pipeline/evaluate';
import { PIPELINE_LIMITS } from '../pipeline/schema';
import { newFacts, typeOperand, typeWhere } from '../pipeline/typing';
import { compileGraphValue, type FragmentOptions } from './compile';
import { describeGrammar, expressionChildren, inferFragment, type FragmentKind } from './grammar';
import { record } from './json';
import type { BudgetMeter, GraphBudget, LogicAnchor } from './types';

export function budgetMeter(kind: string, used: number, limit: number | null, pointer = ''): BudgetMeter {
  const ratio = limit === null ? null : used / limit;
  return { kind, pointer, used, limit, ratio, visible: ratio !== null && ratio > 0.75, exceeded: limit !== null && used > limit };
}
export interface BudgetOptions extends FragmentOptions {
  /** Retained for call-site compatibility; requirements are never seeded from caller guesses. */
  readonly capabilities?: readonly string[];
}
export const ACCOUNTING_FOLLOW_UP = 'Owner follow-up: consume the shared read-only expression/call and flow accounting observer for totals, depths, counter scopes/resets, structural limits and expansion provenance; preserve CHK-nested-choose-budget unchanged.';

export function measureBudget(ast: Json, anchor: LogicAnchor, options: BudgetOptions = {}): GraphBudget {
  const compiled = compileGraphValue(ast, options), compilerIssues = compiled.issues;
  const scopes: GraphBudget['scopes'][number][] = [];
  const conditions: GraphBudget['conditions'][number][] = [], meters: BudgetMeter[] = [];
  const unknownScope = (at: string, limit: number) => {
    scopes.push({ id: `expression:${at}`, kind: 'expression', pointer: at, nodes: null, depth: null, nodeLimit: limit, depthLimit: MAX_EXPRESSION_DEPTH, entries: [at], nodeAccounting: 'unavailable' });
  };
  // This only locates fresh checker entry points. No node/depth counters are maintained here.
  const flowScopes = (value: Json, kind: 'operand' | 'condition', at: string, entry = true): void => {
    if (!record(value)) return;
    if (entry) {
      const facts = newFacts(), counter = { nodes: MAX_EXPRESSION_NODES };
      const typing = { params: new Map(), item: { kind: 'any' as const }, allowRead: true, allowViewer: true };
      let nodes: number | null = null;
      if (kind === 'operand') {
        const parsed = operandBase.safeParse(value);
        if (parsed.success) { typeOperand(parsed.data, typing, at, facts, counter); nodes = MAX_EXPRESSION_NODES - counter.nodes; }
      } else {
        const parsed = predicateBase.safeParse(value);
        if (parsed.success) {
          const counter: NonNullable<Parameters<typeof typeWhere>[4]> = { nodes: PIPELINE_LIMITS.whereNodes };
          typeWhere(parsed.data, typing, at, facts, counter);
          nodes = PIPELINE_LIMITS.whereNodes - counter.nodes;
        }
      }
      const scopeKind = kind === 'condition' ? 'predicate' : 'expression';
      const nodeLimit = kind === 'condition' ? MAX_CONDITION_NODES : MAX_EXPRESSION_NODES;
      scopes.push({ id: `${scopeKind}:${at}`, kind: scopeKind, pointer: at, nodes, depth: null, nodeLimit, depthLimit: kind === 'condition' ? MAX_CONDITION_DEPTH : MAX_EXPRESSION_DEPTH, entries: [at], nodeAccounting: nodes === null ? 'unavailable' : 'compiler' });
      if (nodes !== null) meters.push(budgetMeter(`${scopeKind}-nodes`, nodes, nodeLimit, at));
      if (kind === 'condition') conditions.push({ pointer: at, nodes, depth: null, astNodes: null, astDepth: null });
    }
    for (const child of expressionChildren(value, kind)) {
      const childKind = child.kind === 'condition' ? 'condition' : 'operand';
      flowScopes(child.value, childKind, at + child.binding, childKind !== kind);
    }
  };
  const walk = (value: Json, hint: FragmentKind, at: string, flow = false): void => {
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
    const description = describeGrammar(value, kind);
    for (const child of description.children) walk(child.value, child.kind, at + child.binding, flow);
  };
  const kind = inferFragment(ast, options.kind);
  if (!options.context && kind !== 'document' && (!compilerIssues.length || ['operand', 'condition', 'call'].includes(kind))) walk(compiled.expanded, kind, '');
  const firstExceedingPointer = compilerIssues.find(issue => issue.code === 'limit_exceeded')?.pointer;
  return {
    anchor, nodes: null, depth: null, conditions, scopes, counterResets: null, cases: null, steps: null,
    capabilities: compiled.capabilities, duplicatedUseCost: null, generatedFlowCount: null, runtimeLimit: PIPELINE_BUDGET,
    accepted: compilerIssues.length === 0, compilerIssues, accounting: meters.length ? 'partial' : 'unavailable', accountingUnavailableReason: ACCOUNTING_FOLLOW_UP,
    meters, compactVisible: meters.some(meter => meter.visible) || firstExceedingPointer !== undefined,
    ...(firstExceedingPointer === undefined ? {} : { firstExceedingPointer }),
  };
}
