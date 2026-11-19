import type { Json } from '../../types';
import { MAX_CALL_NODES, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_COUNT_ENTRIES, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES, MAX_RULE_CASES, operandBase, predicateBase } from '../expression';
import { PIPELINE_BUDGET } from '../pipeline/evaluate';
import { PIPELINE_LIMITS } from '../pipeline/schema';
import { assertCompositionBounds } from '../json';
import { newFacts, typeOperand, typeWhere } from '../pipeline/typing';
import { describeGrammar, expressionChildren, inferFragment, type FragmentKind } from './grammar';
import { join, record } from './json';
import type { BudgetMeter, GraphBudget, LogicAnchor } from './types';

export function budgetMeter(kind: string, used: number, limit: number, pointer = ''): BudgetMeter {
  const ratio = used / limit;
  return { kind, pointer, used, limit, ratio, visible: ratio > 0.75, exceeded: used > limit };
}
export interface BudgetOptions { readonly kind?: FragmentKind; readonly capabilities?: readonly string[]; readonly duplicatedUseCost?: number; readonly generatedFlowCount?: number }
type ExpressionKind = 'operand' | 'condition';
type Entry = { value: Json; pointer: string; kind: ExpressionKind };

export function measureBudget(ast: Json, anchor: LogicAnchor, options: BudgetOptions = {}): GraphBudget {
  assertCompositionBounds(ast);
  const meters: BudgetMeter[] = [], conditions: GraphBudget['conditions'][number][] = [], scopes: GraphBudget['scopes'][number][] = [];
  const counterResets: GraphBudget['counterResets'][number][] = [];
  let totalNodes = 0, maxDepth = 0, cases = 0, steps = 0;
  let firstExceedingPointer: string | undefined;
  const meter = (kind: string, used: number, limit: number, at: string, exceeding = at) => {
    const metric = budgetMeter(kind, used, limit, at);
    meters.push(metric);
    if (metric.exceeded && firstExceedingPointer === undefined) firstExceedingPointer = exceeding;
  };
  const children = (value: Json, kind: ExpressionKind) => {
    if (!record(value)) return [];
    const result = expressionChildren(value, kind);
    if (value.type === 'object' || value.type === 'format') result.sort((a, b) => a.binding < b.binding ? -1 : a.binding > b.binding ? 1 : 0);
    if (value.type === 'map') result.sort((a, b) => (a.binding === '/of' ? 0 : a.binding === '/otherwise' ? 1 : 2) - (b.binding === '/of' ? 0 : b.binding === '/otherwise' ? 1 : 2));
    if (flowTraversal && value.type === 'choose') result.sort((a, b) => Number(b.binding === '/otherwise') - Number(a.binding === '/otherwise'));
    return result;
  };
  let flowTraversal = false;
  const astCost = (value: Json, kind: ExpressionKind): { nodes: number; depth: number } => {
    const costs = children(value, kind).map(child => astCost(child.value, child.kind === 'condition' ? 'condition' : 'operand'));
    return { nodes: 1 + costs.reduce((sum, cost) => sum + cost.nodes, 0), depth: 1 + Math.max(0, ...costs.map(cost => cost.depth)) };
  };
  const scopeCost = (entries: readonly Entry[], scopeKind: 'expression' | 'predicate', flow: boolean, nodeLimit: number, depthLimit: number, at: string) => {
    let nodes = 0, depth = 0, firstNode: string | undefined, firstDepth: string | undefined;
    const walk = (value: Json, own: string, kind: ExpressionKind, level: number): void => {
      nodes++; depth = Math.max(depth, level);
      if (nodes > nodeLimit && firstNode === undefined) firstNode = own;
      if (level > depthLimit && firstDepth === undefined) firstDepth = own;
      for (const child of children(value, kind)) {
        if (scopeKind === 'predicate' && child.kind !== 'condition') continue;
        if (scopeKind === 'expression' && flow && child.kind === 'condition') continue;
        walk(child.value, own + child.binding, child.kind === 'condition' ? 'condition' : 'operand', level + 1);
      }
    };
    entries.forEach(entry => walk(entry.value, entry.pointer, entry.kind, 1));
    let nodeAccounting: 'compiler' | 'contextual-walk' = 'contextual-walk';
    if (flow && entries.length === 1) {
      const entry = entries[0], counter = { nodes: nodeLimit }, facts = newFacts();
      const typing = { params: new Map(), item: { kind: 'any' as const }, allowRead: true, allowViewer: true };
      const operand = operandBase.safeParse(entry.value), predicate = predicateBase.safeParse(entry.value);
      if (scopeKind === 'expression' && operand.success) { typeOperand(operand.data, typing, entry.pointer, facts, counter); nodeAccounting = 'compiler'; }
      if (scopeKind === 'predicate' && predicate.success) {
        const predicateCounter: NonNullable<Parameters<typeof typeWhere>[4]> = { nodes: PIPELINE_LIMITS.whereNodes };
        typeWhere(predicate.data, typing, entry.pointer, facts, predicateCounter);
        counter.nodes = predicateCounter.nodes; nodeAccounting = 'compiler';
      }
      if (nodeAccounting === 'compiler') nodes = nodeLimit - counter.nodes + (firstNode === undefined ? 0 : 1);
    }
    const scope = { id: `${scopeKind}:${at}`, kind: scopeKind, pointer: at, nodes, depth, nodeLimit, depthLimit, entries: entries.map(entry => entry.pointer), nodeAccounting };
    scopes.push(scope);
    meter(`${scopeKind}-nodes`, nodes, nodeLimit, at, firstNode);
    meter(`${scopeKind}-depth`, depth, depthLimit, at, firstDepth);
    return scope;
  };
  const predicateScope = (value: Json, at: string, flow: boolean) => {
    const cost = scopeCost([{ value, pointer: at, kind: 'condition' }], 'predicate', flow, MAX_CONDITION_NODES, MAX_CONDITION_DEPTH, at);
    const ast = astCost(value, 'condition');
    conditions.push({ pointer: at, nodes: cost.nodes, depth: cost.depth, astNodes: ast.nodes, astDepth: ast.depth });
  };
  const documentPredicates = (entries: readonly Entry[], confirmation?: string, nodeLimit = MAX_EXPRESSION_NODES) => {
    type Counter = { pointer: string; nodes: number; depth: number; firstNode?: string; firstDepth?: string; entries: string[] };
    const counters: Counter[] = [];
    let active: Counter | undefined;
    let remaining = nodeLimit;
    const begin = (value: Json, at: string, kind: 'choose' | 'count' | 'confirmation') => {
      active = { pointer: at, nodes: 0, depth: 0, entries: [at] };
      counters.push(active);
      counterResets.push({ pointer: at, kind, scopeId: `predicate:${at}` });
      const ast = astCost(value, 'condition');
      conditions.push({ pointer: at, nodes: 0, depth: 0, astNodes: ast.nodes, astDepth: ast.depth });
    };
    const walk = (value: Json, at: string, kind: ExpressionKind, depth: number, astDepth: number) => {
      if (!record(value)) return;
      if (remaining <= 0 || astDepth > MAX_EXPRESSION_DEPTH) return;
      remaining--;
      if (kind === 'condition' && active) {
        active.nodes++; active.depth = Math.max(active.depth, depth);
        if (!active.entries.some(entry => at === entry || at.startsWith(entry + '/'))) active.entries.push(at);
        if (active.nodes > MAX_CONDITION_NODES && active.firstNode === undefined) active.firstNode = at;
        if (depth > MAX_CONDITION_DEPTH && active.firstDepth === undefined) active.firstDepth = at;
        if (active.nodes > MAX_CONDITION_NODES || depth > MAX_CONDITION_DEPTH) return;
      }
      const outer = active;
      for (const child of children(value, kind)) {
        const pointer = at + child.binding, condition = child.kind === 'condition';
        if (condition && (value.type === 'choose' || value.type === 'count')) begin(child.value, pointer, value.type);
        walk(child.value, pointer, condition ? 'condition' : 'operand', condition ? kind === 'condition' ? depth + 1 : 1 : 0, astDepth + 1);
      }
      if (value.type === 'count') {
        active = outer;
        counterResets.push({ pointer: at, kind: 'restore', ...(outer ? { scopeId: `predicate:${outer.pointer}` } : {}) });
      }
    };
    for (const entry of entries) {
      if (entry.kind === 'condition' && entry.pointer === confirmation) begin(entry.value, entry.pointer, 'confirmation');
      walk(entry.value, entry.pointer, entry.kind, entry.kind === 'condition' ? 1 : 0, 1);
    }
    for (const counter of counters) {
      const info = conditions.find(condition => condition.pointer === counter.pointer);
      if (info) {
        const index = conditions.indexOf(info);
        conditions[index] = { ...info, nodes: counter.nodes, depth: counter.depth };
      }
      scopes.push({ id: `predicate:${counter.pointer}`, kind: 'predicate', pointer: counter.pointer, nodes: counter.nodes, depth: counter.depth, nodeLimit: MAX_CONDITION_NODES, depthLimit: MAX_CONDITION_DEPTH, entries: counter.entries, nodeAccounting: 'contextual-walk' });
      meter('predicate-nodes', counter.nodes, MAX_CONDITION_NODES, counter.pointer, counter.firstNode);
      meter('predicate-depth', counter.depth, MAX_CONDITION_DEPTH, counter.pointer, counter.firstDepth);
    }
  };
  const limits = (value: Json, at: string) => {
    if (!record(value)) return;
    if ((value.type === 'choose' || value.type === 'map') && Array.isArray(value.cases)) {
      cases = Math.max(cases, value.cases.length);
      meter(value.type === 'map' ? 'map-cases' : 'cases', value.cases.length, value.type === 'map' ? 32 : MAX_RULE_CASES, join(at, 'cases'));
    }
    if (value.type === 'count' && Array.isArray(value.of)) meter('count-entries', value.of.length, MAX_COUNT_ENTRIES, join(at, 'of'));
    if ((value.type === 'all' || value.type === 'any') && Array.isArray(value.of)) meter('condition-inputs', value.of.length, 16, join(at, 'of'));
    if (value.type === 'list' && Array.isArray(value.items)) meter('list-items', value.items.length, 64, join(at, 'items'));
    if (value.type === 'object' && record(value.fields)) meter('object-fields', Object.keys(value.fields).length, 64, join(at, 'fields'));
    if (value.type === 'format' && record(value.args)) meter('format-arguments', Object.keys(value.args).length, 16, join(at, 'args'));
  };
  const inspect = (value: Json, at: string, kind: ExpressionKind, flow: boolean): void => {
    limits(value, at);
    for (const child of children(value, kind)) {
      const pointer = at + child.binding, condition = child.kind === 'condition';
      if (flow) {
        if (kind === 'operand' && condition) predicateScope(child.value, pointer, true);
        if (kind === 'condition' && !condition) scopeCost([{ value: child.value, pointer, kind: 'operand' }], 'expression', true, MAX_EXPRESSION_NODES, MAX_EXPRESSION_DEPTH, pointer);
      }
      inspect(child.value, pointer, condition ? 'condition' : 'operand', flow);
    }
  };
  const expression = (value: Json, at: string, kind: ExpressionKind, flow: boolean, flowWhere = false) => {
    const ast = astCost(value, kind);
    totalNodes += ast.nodes; maxDepth = Math.max(maxDepth, ast.depth);
    if (flowWhere) predicateScope(value, at, true);
    else scopeCost([{ value, pointer: at, kind }], 'expression', flow, MAX_EXPRESSION_NODES, MAX_EXPRESSION_DEPTH, at);
    if (!flow) documentPredicates([{ value, pointer: at, kind }]);
    inspect(value, at, kind, flow);
  };
  const visit = (value: Json, at: string, hint: FragmentKind, flow = false): void => {
    flowTraversal = flow;
    const kind = inferFragment(value, hint);
    if (kind === 'operand' || kind === 'condition') { expression(value, at, kind, flow, flow && kind === 'condition'); return; }
    if (kind === 'call' && record(value)) {
      const entries: Entry[] = [];
      if (value.data !== undefined) entries.push({ value: value.data, pointer: join(at, 'data'), kind: 'operand' });
      const target = value.target;
      if (record(target)) Object.keys(target).sort().forEach(key => entries.push({ value: target[key], pointer: join(at, 'target', key), kind: 'operand' }));
      if (record(value.confirmation) && value.confirmation.when !== undefined) {
        const own = join(at, 'confirmation', 'when');
        entries.push({ value: value.confirmation.when, pointer: own, kind: 'condition' });
      }
      scopeCost(entries, 'expression', false, MAX_CALL_NODES, MAX_EXPRESSION_DEPTH, at);
      documentPredicates(entries, entries.find(entry => entry.kind === 'condition')?.pointer, MAX_CALL_NODES);
      for (const entry of entries) {
        const cost = astCost(entry.value, entry.kind);
        totalNodes += cost.nodes; maxDepth = Math.max(maxDepth, cost.depth);
        inspect(entry.value, entry.pointer, entry.kind, false);
      }
      return;
    }
    if (kind === 'flow' && record(value) && value.inputs !== undefined) { visit(value.inputs, join(at, 'inputs'), 'flow-inputs', true); return; }
    if (kind === 'flow-inputs' && record(value)) {
      const count = Array.isArray(value.steps) ? value.steps.length : 0;
      steps = Math.max(steps, count);
      meter('steps', count, PIPELINE_LIMITS.steps, join(at, 'steps'));
      meter('parameters', Array.isArray(value.parameters) ? value.parameters.length : 0, PIPELINE_LIMITS.parameters, join(at, 'parameters'));
      if (Array.isArray(value.parameters)) value.parameters.forEach((parameter, i) => { if (record(parameter) && parameter.value !== undefined) visit(parameter.value, join(at, 'parameters', i, 'value'), 'operand', true); });
      if (value.request !== undefined) visit(value.request, join(at, 'request'), 'request', true);
      if (Array.isArray(value.steps)) value.steps.forEach((step, i) => visit(step, join(at, 'steps', i), 'step', true));
      if (value.output !== undefined) visit(value.output, join(at, 'output'), 'output', true);
      return;
    }
    if (kind === 'request' && record(value) && value.type === 'entities') {
      meter('entities', Array.isArray(value.entityIds) ? value.entityIds.length : 0, PIPELINE_LIMITS.entities, join(at, 'entityIds'));
      meter('entity-attributes', Array.isArray(value.attributes) ? value.attributes.length : 0, PIPELINE_LIMITS.entityAttributes, join(at, 'attributes'));
    }
    if (kind === 'slot' && record(value) && value.type === 'conditional' && Array.isArray(value.cases)) meter('cases', value.cases.length, MAX_RULE_CASES, join(at, 'cases'));
    if (kind === 'slot' && record(value) && value.type === 'read') {
      const { fallback: _fallback, whenUnavailable: _policy, ...operand } = value;
      expression(operand, at, 'operand', false);
      return;
    }
    if (kind === 'document' && record(value) && Array.isArray(value.dataSources)) meter('flow-sources', value.dataSources.filter(source => record(source) && source.model === 'pipeline@1').length, PIPELINE_LIMITS.pipelines, join(at, 'dataSources'));
    for (const child of describeGrammar(value, kind).children) visit(child.value, at + child.binding, child.kind, flow);
  };
  visit(ast, '', options.kind ?? 'auto');
  return {
    anchor, nodes: totalNodes, depth: maxDepth, conditions, scopes, counterResets, cases, steps, capabilities: [...new Set(options.capabilities ?? [])].sort(),
    duplicatedUseCost: options.duplicatedUseCost ?? 0, generatedFlowCount: options.generatedFlowCount ?? 0, runtimeLimit: PIPELINE_BUDGET,
    // All/any arity is detail-only; 16 comparisons use 17/32 predicates, not a full condition budget.
    meters, compactVisible: meters.some(meter => meter.visible && meter.kind !== 'condition-inputs'), ...(firstExceedingPointer === undefined ? {} : { firstExceedingPointer }),
  };
}
