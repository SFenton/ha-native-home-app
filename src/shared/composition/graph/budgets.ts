import type { Json } from '../../types';
import { z } from 'zod/v4';
import { compileCompositionDocument, parseCompositionShape } from '../compiler';
import { MAX_CALL_NODES, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES, callServiceSchema, checkCallService, checkOperand, checkPredicate, operandBase, predicateBase, type ItemScope } from '../expression';
import { assertCompositionBounds, CompositionValidationError, type CompositionIssue } from '../json';
import { expandLogic, type LogicEntry } from '../logic-library';
import { PIPELINE_BUDGET } from '../pipeline/evaluate';
import { PIPELINE_LIMITS } from '../pipeline/schema';
import { newFacts, typeOperand, typeWhere } from '../pipeline/typing';
import { conditional } from '../slots';
import { checkGraphPipeline, graphInputsSchema, graphSourceSchema, graphTextSlotSchema } from './capabilities';
import { describeGrammar, expressionChildren, inferFragment, type FragmentKind } from './grammar';
import { record, withoutCanvasMetadata } from './json';
import type { BudgetMeter, GraphBudget, LogicAnchor } from './types';

export function budgetMeter(kind: string, used: number, limit: number, pointer = ''): BudgetMeter {
  const ratio = used / limit;
  return { kind, pointer, used, limit, ratio, visible: ratio > 0.75, exceeded: used > limit };
}
export interface BudgetOptions {
  readonly kind?: FragmentKind;
  readonly capabilities?: readonly string[];
  readonly itemScope?: ItemScope;
  readonly allowControl?: boolean;
  readonly library?: readonly LogicEntry[];
}
export const ACCOUNTING_FOLLOW_UP = 'Owner follow-up: expose read-only expression/call and flow accounting from the actual checker, including totals, depths, counter scopes/resets, structural limits and expansion provenance; preserve CHK-nested-choose-budget unchanged.';

export function measureBudget(ast: Json, anchor: LogicAnchor, options: BudgetOptions = {}): GraphBudget {
  assertCompositionBounds(ast);
  const compilerIssues: CompositionIssue[] = [], scopes: GraphBudget['scopes'][number][] = [];
  const conditions: GraphBudget['conditions'][number][] = [], meters: BudgetMeter[] = [];
  const capabilities = new Set(options.capabilities ?? []);
  const report = (issues: readonly CompositionIssue[]) => compilerIssues.push(...issues);
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
  const walk = (value: Json, hint: FragmentKind, at: string, validate: boolean, flow = false): void => {
    const kind = inferFragment(value, hint);
    try {
      if (validate && kind === 'slot' && record(value) && value.type === 'conditional') parseCompositionShape(conditional(z.json()), value);
      if (validate && kind === 'slot' && record(value) && (value.type === 'read' || value.type === 'expr')) parseCompositionShape(graphTextSlotSchema, value);
      if (kind === 'operand' || kind === 'condition') {
        if (flow) { flowScopes(value, kind, at); return; }
        unknownScope(at, MAX_EXPRESSION_NODES);
        if (validate) {
          const facts = kind === 'operand'
            ? checkOperand(parseCompositionShape(operandBase, value), at, options.allowControl, false, options.itemScope)
            : checkPredicate(parseCompositionShape(predicateBase, value), at, false, options.itemScope);
          report(facts.issues); facts.needs.forEach(need => capabilities.add(`sh.${need}@1`));
        }
        return;
      }
      if (kind === 'call') {
        unknownScope(at, MAX_CALL_NODES);
        if (validate) {
          const facts = checkCallService(parseCompositionShape(callServiceSchema, value), at, options.allowControl ?? false, options.itemScope);
          report(facts.issues); facts.needs.forEach(need => capabilities.add(`sh.${need}@1`));
        }
        return;
      }
      if (kind === 'flow' || kind === 'flow-inputs') {
        if (validate) {
          const source = kind === 'flow' ? parseCompositionShape(graphSourceSchema, value)
            : { id: 'budget-flow', kind: 'model' as const, model: 'pipeline@1' as const, inputs: parseCompositionShape(graphInputsSchema, value) };
          const facts = checkGraphPipeline(source, at);
          report(facts.issues); facts.capabilities.forEach(capability => capabilities.add(capability));
          if (facts.issues.length) return;
        }
        flow = true;
      }
      if (kind === 'slot' && record(value) && value.type === 'read') {
        const { fallback: _fallback, whenUnavailable: _policy, ...operand } = value;
        walk(operand, 'operand', at, validate);
        return;
      }
      const description = describeGrammar(value, kind);
      if (validate && description.payload.kind === 'opaque') { report([{ code: 'unknown_variant', pointer: at }]); return; }
      for (const child of description.children) walk(child.value, child.kind, at + child.binding, validate && !flow, flow);
    } catch (error) {
      if (!(error instanceof CompositionValidationError)) throw error;
      report(error.issues.map(issue => ({ ...issue, pointer: at + issue.pointer })));
    }
  };
  try {
    const kind = inferFragment(ast, options.kind);
    if (kind === 'document') {
      try {
        const compiled = compileCompositionDocument(withoutCanvasMetadata(ast));
        compiled.capabilities.forEach(capability => capabilities.add(capability));
        walk(compiled.expanded, 'document', '', false);
      } catch (error) {
        if (!(error instanceof CompositionValidationError)) throw error;
        report(error.issues.map(issue => ({ ...issue, pointer: issue.pointer.replace(/^\/document(?=\/|$)/, '') })));
      }
    } else if (kind === 'fragment') {
      const expanded = expandLogic(ast).document;
      assertCompositionBounds(expanded);
      walk(parseCompositionShape(z.json(), expanded), kind, '', true);
    } else {
      const expanded = expandLogic({ logicLibrary: options.library ?? [], value: ast }).document;
      assertCompositionBounds(expanded);
      if (!record(expanded)) throw new Error('Logic expansion did not return an object.');
      walk(expanded.value, kind, '', true);
    }
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    report(error.issues.map(issue => ({ ...issue, pointer: issue.pointer.replace(/^\/value(?=\/|$)/, '') })));
  }
  const firstExceedingPointer = compilerIssues.find(issue => issue.code === 'limit_exceeded')?.pointer;
  return {
    anchor, nodes: null, depth: null, conditions, scopes, counterResets: null, cases: null, steps: null,
    capabilities: [...capabilities].sort(), duplicatedUseCost: null, generatedFlowCount: null, runtimeLimit: PIPELINE_BUDGET,
    accepted: compilerIssues.length === 0, compilerIssues, accounting: meters.length ? 'partial' : 'unavailable', accountingUnavailableReason: ACCOUNTING_FOLLOW_UP,
    meters, compactVisible: meters.some(meter => meter.visible) || firstExceedingPointer !== undefined,
    ...(firstExceedingPointer === undefined ? {} : { firstExceedingPointer }),
  };
}
