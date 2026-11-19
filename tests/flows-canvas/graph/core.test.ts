import { describe, expect, it } from 'vitest';
import { checkCallService, checkOperand, checkPredicate, compareOperations, dateOperations, mathOperations, operandBase, predicateBase, type CallService, type Operand, type Predicate } from '../../../src/shared/composition/expression';
import { flowExtrasSteps, pipelineSourceSchema, stepOperations } from '../../../src/shared/composition/pipeline/schema';
import { blockCatalog, budgetMeter, catalogAvailability, lift, lower, measureBudget, portType, portsCompatible, projectGraph, validateGraph, type LogicAnchor, type LogicGraph } from '../../../src/shared/composition/graph';
import type { Json } from '../../../src/shared/types';
import { predicateBudgetFixtures } from './fixtures';

const anchor: LogicAnchor = { kind: 'logic', id: 'test', field: '/body' };
const scalar = (value = 1): Operand => ({ type: 'literal', value });
const state = (): Predicate => ({ type: 'state', sourceId: 'light', path: ['state'], in: ['on'] });
const nots = (depth: number): Predicate => depth === 1 ? state() : { type: 'not', of: nots(depth - 1) };
const predicateNodes = (count: number): Predicate => {
  if (count === 1) return state();
  if (count <= 17) return { type: 'all', of: Array.from({ length: count - 1 }, state) };
  const first = Math.min(17, count - 2);
  return { type: 'all', of: [predicateNodes(first), predicateNodes(count - first - 1)] };
};
const flow = (steps = 1, entities = 1) => ({
  id: 'flow', kind: 'model', model: 'pipeline@1',
  inputs: {
    title: 'Flow', parameters: [],
    request: { type: 'entities', entityIds: Array.from({ length: entities }, (_, i) => ({ type: 'literal', value: `light.demo_e_${i}` })), attributes: [] },
    steps: [...Array.from({ length: steps - 1 }, (_, i) => ({ id: `step-${i}`, op: 'limit', count: 100 })), { id: 'count', op: 'count' }],
    output: { kind: 'scalar' }, schema: { kind: 'number' },
  },
});
function allowed(ast: Json, kind: 'operand' | 'condition' | 'flow') { return lower(lift(ast, { kind, anchor }).graph).ok; }

describe('G-catalog exhaustive named grammar traces', () => {
  const keys = new Set(blockCatalog.map(entry => entry.key));
  it('enumerates every operand, condition, request, step, output and recipe variant', () => {
    expect(keys.size).toBe(blockCatalog.length);
    for (const op of mathOperations) expect(keys.has(`operand.math.${op}`)).toBe(true);
    for (const op of dateOperations) expect(keys.has(`operand.date.${op}`)).toBe(true);
    for (const op of compareOperations) expect(keys.has(`predicate.compare.${op}`)).toBe(true);
    for (const op of [...stepOperations, ...flowExtrasSteps, 'average']) expect(keys.has(`step.${op}`)).toBe(true);
    for (const name of ['read', 'raw-state', 'last-changed', 'list-count', 'list-includes', 'viewer', 'control', 'item', 'index', 'param', 'format', 'map', 'choose', 'list', 'object', 'count']) expect(keys.has(`operand.${name}.value`)).toBe(true);
    for (const name of ['state', 'numeric', 'viewer', 'viewer-person', 'in', 'exists', 'all', 'any', 'not']) expect(keys.has(`predicate.${name}.value`)).toBe(true);
    for (const name of ['entities', 'none', 'entity-attribute', 'service-response']) expect(keys.has(`request.${name}`)).toBe(true);
    for (const name of ['todo-items', 'weather-forecast']) expect(keys.has(`request.ha-subscription.${name}`)).toBe(true);
    for (const name of ['scalar', 'record', 'rows', 'records']) expect(keys.has(`output.${name}`)).toBe(true);
    for (const entry of blockCatalog) {
      expect(entry.lowering.length > 0 || entry.cost === 'structural', entry.key).toBe(true);
      for (const node of entry.lowering) expect(node).toMatch(/^(operand\.|predicate\.|template\.|step\.|request|output\.|expr$|conditional$|bound-symbol$|repeat$)/);
    }
  });
  it('disables unsupported scopes and capabilities with explicit reasons', () => {
    expect(catalogAvailability('operand.count.value', 'flow-step', ['sh.count@1'])).toMatchObject({ enabled: false });
    expect(catalogAvailability('step.average', 'flow-step', ['sh.pipeline@1']).reason).toContain('sh.flow-average@1');
    expect(catalogAvailability('recipe.A-number-state', 'flow-step', []).reason).toContain('A-number-state');
    expect(catalogAvailability('step.average', 'flow-step', ['sh.pipeline@1', 'sh.flow-average@1']).enabled).toBe(true);
  });
});

describe.each(['read', 'expr'] as const)('shared %s text slots', type => {
  const slot = (whenUnavailable: string, fallback = 'No answer'): Json => type === 'read'
    ? { type, from: { type: 'source', sourceId: 'light', path: ['state'] }, as: 'number', missing: 'unavailable', fallback, whenUnavailable }
    : { type, value: scalar(), fallback, whenUnavailable };
  it.each(['fallback', 'keep'])('retains the native %s policy and requires the actual target capability', policy => {
    const ast = slot(policy), graph = lift(ast, { kind: 'slot', anchor }).graph;
    expect(measureBudget(ast, anchor, { kind: 'slot' }).accepted).toBe(true);
    expect(lower(graph, { targetCapabilities: ['sh.operands@1', 'sh.rules@1', 'sh.bindings@1'] })).toMatchObject({
      ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_capability', capability: 'sh.text-keep@1' })]),
    });
    expect(lower(graph, { targetCapabilities: ['sh.operands@1', 'sh.rules@1', 'sh.bindings@1', 'sh.text-keep@1'] })).toMatchObject({ ok: true, ast });
  });
  it.each([
    ['unknown policy', 'later', 'No answer', '/whenUnavailable'],
    ['oversized fallback', 'keep', 'x'.repeat(2001), '/fallback'],
  ])('refuses %s through the shared schema without changing the original', (_name, policy, fallback, pointer) => {
    const ast = slot(policy, fallback), graph = lift(ast, { kind: 'slot', anchor }).graph;
    expect(lower(graph)).toMatchObject({ ok: false, original: ast });
    const budget = measureBudget(ast, anchor, { kind: 'slot' });
    expect(budget.accepted).toBe(false);
    expect(budget.compilerIssues[0].pointer).toBe(pointer);
  });
});

describe('fragment capability requirements', () => {
  it.each<{ kind: 'operand' | 'condition' | 'call'; ast: Json; base: string[] }>([
    { kind: 'operand' as const, ast: scalar(), base: [] },
    { kind: 'condition' as const, ast: { type: 'compare', op: 'eq', left: scalar(), right: scalar() }, base: ['sh.conditions@1'] },
    { kind: 'call' as const, ast: { type: 'call-service', domain: 'light', service: 'turn_on', data: { type: 'object', fields: {} } }, base: ['sh.call-service@1'] },
  ])('requires operands used inside a $kind and reports them in its budget', ({ kind, ast, base }) => {
    const graph = lift(ast, { kind }).graph;
    expect(lower(graph, { targetCapabilities: base })).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_capability', capability: 'sh.operands@1' })]) });
    expect(lower(graph, { targetCapabilities: [...base, 'sh.operands@1'] }).ok).toBe(true);
    expect(measureBudget(ast, anchor, { kind }).capabilities).toEqual([...base, 'sh.operands@1'].sort());
  });
  it('does not invent operand requirements for a predicate or call that uses none', () => {
    for (const [ast, kind, capabilities] of [
      [{ type: 'viewer', isAdmin: true }, 'condition', []],
      [{ type: 'call-service', domain: 'light', service: 'turn_on' }, 'call', ['sh.call-service@1']],
    ] as const) {
      expect(lower(lift(ast, { kind }).graph, { targetCapabilities: capabilities }).ok).toBe(true);
      expect(measureBudget(ast, anchor, { kind }).capabilities).not.toContain('sh.operands@1');
    }
  });
});

describe('G-limits exact existing boundaries', () => {
  const comparisons = (count: number): Predicate => count === 1 ? { type: 'compare', op: 'eq', left: scalar(), right: scalar() }
    : count <= 17 ? { type: 'all', of: Array.from({ length: count - 1 }, () => comparisons(1)) }
      : { type: 'all', of: [comparisons(17), comparisons(count - 18)] };
  const filterFlow = (where: Predicate): Json => {
    const source = pipelineSourceSchema.parse(flow());
    source.inputs.steps.unshift({ id: 'keep', op: 'filter', where });
    return source;
  };
  it('accepts the amended contract 49-AST / 17-predicate condition in all three contexts', () => {
    const when = comparisons(17);
    const choose: Operand = { type: 'choose', cases: [{ when, then: scalar() }], otherwise: scalar() };
    const count: Operand = { type: 'count', of: [{ test: when }] };
    const filtered = filterFlow(when);
    for (const [ast, kind] of [
      [choose, 'operand'],
      [count, 'operand'],
      [filtered, 'flow'],
    ] as const) {
      expect(allowed(ast, kind)).toBe(true);
      const budget = measureBudget(ast, anchor, { kind });
      expect(budget).toMatchObject({ accepted: true, nodes: null, depth: null, compactVisible: false });
      if (kind === 'flow') {
        expect(budget.conditions[0]).toMatchObject({ nodes: 17, depth: null, astNodes: null, astDepth: null });
        expect(budget.scopes.find(scope => scope.kind === 'predicate')).toMatchObject({ nodes: 17, nodeLimit: 32, nodeAccounting: 'compiler' });
      } else expect(budget.accounting).toBe('unavailable');
    }
  });
  it.each([
    ['base', 'condition', true],
    ['early', 'condition', false],
    ['outerBase', 'operand', false],
    ['outerLater', 'operand', true],
  ] as const)('meter matches compiler for CHK-nested-choose-budget %s', (name, kind, accepted) => {
    const ast: Json = JSON.parse(JSON.stringify(predicateBudgetFixtures[name]));
    const native = kind === 'condition' ? checkPredicate(predicateBase.parse(ast), '') : checkOperand(operandBase.parse(ast), '');
    const budget = measureBudget(ast, anchor, { kind });
    const lowered = lower(lift(ast, { kind, anchor }).graph);
    expect(native.issues.length === 0).toBe(accepted);
    expect(lowered.ok).toBe(accepted);
    expect(budget).toMatchObject({ accepted, nodes: null, depth: null, counterResets: null, accounting: 'unavailable' });
    expect(budget.compilerIssues).toEqual(native.issues);
    expect(budget.firstExceedingPointer).toBe(native.issues.find(issue => issue.code === 'limit_exceeded')?.pointer);
    expect(budget.compactVisible).toBe(!accepted);
    if (name === 'early') expect(budget.firstExceedingPointer).toBe('/of/1/of/15');
    expect(budget.meters).toEqual([]);
    expect(budget.accountingUnavailableReason).toContain('Owner follow-up');
  });
  it.each([[32, true], [33, false]] as const)('flow predicates %i use predicate-only counters accepted=%s', (nodes, expected) => {
    const source = filterFlow(comparisons(nodes));
    const budget = measureBudget(source, anchor, { kind: 'flow' });
    expect(allowed(source, 'flow')).toBe(expected);
    expect(budget.accepted).toBe(expected);
    if (expected) expect(budget.conditions[0].nodes).toBe(nodes);
    else expect(budget.conditions).toEqual([]);
    expect(budget.scopes.filter(scope => scope.kind === 'expression').every(scope => scope.nodes === 1)).toBe(true);
  });
  it.each([[6, true], [7, false]] as const)('flow predicate depth %i uses a separate depth accepted=%s', (depth, expected) => {
    let where = comparisons(1);
    for (let i = 1; i < depth; i++) where = { type: 'not', of: where };
    expect(allowed(filterFlow(where), 'flow')).toBe(expected);
  });
  it('gives flow leaf operands fresh 64/8 budgets instead of pooling the whole filter', () => {
    const operand: Operand = { type: 'math', op: 'add', args: [{ type: 'math', op: 'add', args: Array.from({ length: 8 }, () => scalar()) }, scalar()] };
    const when: Predicate = { type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'compare', op: 'eq', left: operand, right: operand })) };
    const filtered = filterFlow(when);
    expect(allowed(filtered, 'flow')).toBe(true);
    const budget = measureBudget(filtered, anchor, { kind: 'flow' });
    expect(budget).toMatchObject({ nodes: null, accepted: true, accounting: 'partial' });
    expect(budget.firstExceedingPointer).toBeUndefined();
    expect(allowed({ type: 'choose', cases: [{ when, then: scalar() }], otherwise: scalar() }, 'operand')).toBe(false);
  });
  it.each([[128, true], [129, false]] as const)('shares the call expression counter at %i nodes accepted=%s', (nodes, expected) => {
    const call: CallService = {
      type: 'call-service', domain: 'light', service: 'turn_on',
      data: { type: 'object', fields: Object.fromEntries(Array.from({ length: 63 }, (_, i) => [`f${i}`, scalar()])) },
      target: { entity_id: { type: 'list', items: Array.from({ length: nodes - 65 }, (_, i) => ({ type: 'literal', value: `light.demo_e_${i}` })) } },
    };
    const result = lower(lift(call, { kind: 'call', anchor }).graph);
    expect(result.ok).toBe(expected);
    expect(checkCallService(call, '', false).issues.length === 0).toBe(expected);
    const budget = measureBudget(call, anchor, { kind: 'call' });
    expect(budget).toMatchObject({ nodes: null, depth: null, accepted: expected });
    expect(budget.scopes).toMatchObject([{ kind: 'expression', nodes: null, nodeLimit: 128, nodeAccounting: 'unavailable' }]);
  });
  it('keeps standalone look rules above 32 AST nodes in the document-predicate context', () => {
    const ast: Json = { type: 'conditional', cases: [{ when: comparisons(17), then: { type: 'literal-look', color: 'red' } }], otherwise: { type: 'literal-look', color: 'blue' } };
    const result = lower(lift(ast, { kind: 'slot', anchor }).graph);
    expect(result.ok).toBe(true);
    expect(measureBudget(ast, anchor, { kind: 'slot' })).toMatchObject({ accepted: true, accounting: 'unavailable' });
  });
  it.each([[64, true], [65, false]] as const)('field expression %i nodes accepted=%s', (nodes, expected) => {
    const ast: Operand = { type: 'list', items: Array.from({ length: nodes - 1 }, () => scalar()) };
    expect(measureBudget(ast, anchor)).toMatchObject({ nodes: null, accepted: expected });
    expect(allowed(ast, 'operand')).toBe(expected);
  });
  it.each([[8, true], [9, false]] as const)('standalone predicate depth %i accepted=%s', (depth, expected) => {
    expect(measureBudget(nots(depth), anchor, { kind: 'condition' })).toMatchObject({ depth: null, accepted: expected });
    expect(allowed(nots(depth), 'condition')).toBe(expected);
  });
  it('keeps standalone predicates at 64/8 instead of globally imposing 32/6', () => {
    expect(allowed(predicateNodes(33), 'condition')).toBe(true);
    expect(allowed(predicateNodes(64), 'condition')).toBe(true);
    expect(allowed(predicateNodes(65), 'condition')).toBe(false);
  });
  it.each([[32, true], [33, false]] as const)('count and choose embedded conditions %i nodes accepted=%s', (nodes, expected) => {
    const test = predicateNodes(nodes);
    for (const ast of [
      { type: 'count', of: [{ test }] },
      { type: 'choose', cases: [{ when: test, then: scalar() }], otherwise: scalar() },
    ] as const) {
      const mutable: Json = JSON.parse(JSON.stringify(ast));
      expect(allowed(mutable, 'operand')).toBe(expected);
      expect(measureBudget(mutable, anchor).accepted).toBe(expected);
    }
  });
  it.each([[6, true], [7, false]] as const)('embedded condition depth %i accepted=%s', (depth, expected) => {
    expect(allowed({ type: 'count', of: [{ test: nots(depth) }] }, 'operand')).toBe(expected);
  });
  it.each([[16, true], [17, false]] as const)('choose cases %i accepted=%s', (count, expected) => {
    expect(allowed({ type: 'choose', cases: Array.from({ length: count }, () => ({ when: state(), then: scalar() })), otherwise: scalar() }, 'operand')).toBe(expected);
  });
  it.each([[16, true], [17, false]] as const)('conditional slot cases %i use the native schema accepted=%s', (count, accepted) => {
    const ast = { type: 'conditional', cases: Array.from({ length: count }, () => ({ when: state(), then: { type: 'literal-look', color: 'red' } })), otherwise: { type: 'literal-look', color: 'blue' } };
    expect(lower(lift(ast, { kind: 'slot' }).graph).ok).toBe(accepted);
    expect(measureBudget(ast, anchor, { kind: 'slot' }).accepted).toBe(accepted);
  });
  it.each([[32, true], [33, false]] as const)('count entries %i accepted=%s', (count, expected) => {
    expect(allowed({ type: 'count', of: Array.from({ length: count }, () => ({ test: state() })) }, 'operand')).toBe(expected);
  });
  it.each([[32, true], [33, false]] as const)('flow steps %i accepted=%s', (count, expected) => {
    expect(allowed(flow(count), 'flow')).toBe(expected);
    expect(measureBudget(flow(count), anchor, { kind: 'flow' }).accepted).toBe(expected);
  });
  it.each([[64, true], [65, false]] as const)('entities %i accepted=%s', (count, expected) => {
    expect(allowed(flow(1, count), 'flow')).toBe(expected);
    expect(measureBudget(flow(1, count), anchor, { kind: 'flow' }).accepted).toBe(expected);
  });
  it.each([[8, true], [9, false]] as const)('flow parameters %i accepted=%s', (count, expected) => {
    const source = pipelineSourceSchema.parse(flow());
    source.inputs.parameters = Array.from({ length: count }, (_, i) => ({ name: `param_${i}`, type: 'number', value: scalar(i) }));
    expect(allowed(source, 'flow')).toBe(expected);
    expect(measureBudget(source, anchor, { kind: 'flow' }).accepted).toBe(expected);
  });
  it.each([[16, true], [17, false]] as const)('All/Any inputs %i accepted=%s', (count, expected) => {
    for (const type of ['all', 'any'] as const) expect(allowed({ type, of: Array.from({ length: count }, state) }, 'condition')).toBe(expected);
  });
  it.each([[48, 64, false], [49, 64, true], [96, 128, false], [97, 128, true], [24, 32, false], [25, 32, true], [6, 8, false], [7, 8, true], [4, 6, false], [5, 6, true], [12, 16, false], [13, 16, true]] as const)('meter %i/%i visible=%s', (used, limit, visible) => {
    expect(budgetMeter('test', used, limit)).toMatchObject({ used, limit, ratio: used / limit, visible, exceeded: used > limit });
  });
  it.each([[48, false], [49, true]] as const)('derives the %i/64 flow meter directly from the checker counter', (nodes, visible) => {
    const source = pipelineSourceSchema.parse(flow());
    source.inputs.request = { type: 'none', value: { type: 'list', items: Array.from({ length: nodes - 1 }, () => scalar()) } };
    const budget = measureBudget(source, anchor, { kind: 'flow' });
    expect(budget.accepted).toBe(true);
    expect(budget.scopes[0]).toMatchObject({ nodes, depth: null, nodeAccounting: 'compiler' });
    expect(budget.meters[0]).toMatchObject({ used: nodes, limit: 64, ratio: nodes / 64, visible });
  });
  it('exposes exact first exceeding node pointers', () => {
    const budget = measureBudget({ type: 'list', items: Array.from({ length: 64 }, () => scalar()) }, anchor);
    expect(budget.firstExceedingPointer).toBe('/items/63');
    expect(budget.runtimeLimit).toBe(100_000);
  });
});

describe('typed connections, structural refusals and fan-out', () => {
  it('does not coerce booleans/conditions, entity sources/IDs, lists/streams, text/numbers, nullable or unresolved values', () => {
    const number = portType({ kind: 'number' }), text = portType({ kind: 'string' });
    expect(portsCompatible(text, number).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'boolean' }, 'condition'), portType({ kind: 'boolean' })).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'string', format: 'entity-id' }, 'source-selection'), portType({ kind: 'string', format: 'entity-id' })).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'array', of: { kind: 'number' } }, 'stream'), portType({ kind: 'array', of: { kind: 'number' } })).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'any' }), number).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'union', of: [{ kind: 'number' }, { kind: 'null' }] }), number).compatible).toBe(false);
    expect(portsCompatible(portType({ kind: 'number' }, 'operand', 'item-a'), portType({ kind: 'number' }, 'operand', 'item-b')).compatible).toBe(false);
  });
  const base = () => lift({ type: 'math', op: 'add', args: [scalar(1), scalar(2)] }, { kind: 'operand' }).graph;
  it('allows ordinary Choose value edits without retaining the previous literal enum', () => {
    const ast: Operand = { type: 'choose', cases: [{ when: state(), then: { type: 'literal', value: 'Hot' } }], otherwise: { type: 'literal', value: 'Cold' } };
    const graph = lift(ast, { kind: 'operand' }).graph;
    const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 'Hot'
      ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 'Warm' } } } : node) };
    expect(lower(edited)).toMatchObject({ ok: true, ast: { ...ast, cases: [{ ...ast.cases[0], then: { type: 'literal', value: 'Warm' } }] } });
  });
  it('allows same-step item rewiring but rejects a different step scope', () => {
    const source = pipelineSourceSchema.parse(flow());
    source.inputs.steps.unshift(...[0, 1].map(i => ({ id: `filter-${i}`, op: 'filter' as const, where: { type: 'compare' as const, op: 'eq' as const, left: { type: 'item' as const, path: ['state'] }, right: { type: 'literal' as const, value: 'on' } } })));
    const graph = lift(source, { kind: 'flow' }).graph;
    const item = graph.nodes.find(node => node.origins[0] === '/inputs/steps/0/where/left')!;
    const wire = (step: number): LogicGraph => ({ ...graph, edges: graph.edges.map(edge => graph.nodes.find(node => node.id === edge.to.nodeId)?.origins[0] === `/inputs/steps/${step}/where` && edge.binding === '/right'
      ? { ...edge, from: { nodeId: item.id, portId: 'value' } } : edge) });
    expect(lower(wire(0))).toMatchObject({ ok: true });
    expect(lower(wire(1))).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'scope_mismatch' })]) });
  });
  it('refuses occupied inputs, disconnections, cycles and wrong edge binding without mutating the original', () => {
    const graph = base(), edge = graph.edges[0];
    expect(validateGraph({ ...graph, edges: [...graph.edges, { ...edge, id: 'extra' }] }).some(error => error.code === 'occupied_input')).toBe(true);
    expect(lower({ ...graph, edges: graph.edges.slice(1) })).toMatchObject({ ok: false, original: graph.original });
    const cycle = { ...graph, edges: graph.edges.map((edge, index) => index ? edge : { ...edge, from: { nodeId: graph.roots[0].nodeId, portId: 'value' } }) };
    expect(validateGraph(cycle).some(error => error.code === 'cycle')).toBe(true);
    expect(validateGraph({ ...graph, edges: [{ ...edge, binding: '/wrong' }, ...graph.edges.slice(1)] }).some(error => error.code === 'invalid_reference')).toBe(true);
  });
  it('recomputes edited payload types instead of trusting stale cached port descriptors', () => {
    const graph = base();
    const literal = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal')!;
    const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.id === literal.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: '12' } } } : node) };
    expect(lower(edited)).toMatchObject({ ok: false });
  });
  it('reports cyclic lexical scopes even when an edited parameter must resolve its owner', () => {
    const graph = base(), literal = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal')!;
    const edited: LogicGraph = {
      ...graph,
      scopes: graph.scopes.map(scope => ({ ...scope, parentId: scope.id })),
      nodes: graph.nodes.map(node => node.id === literal.id ? { ...node, payload: { kind: 'operand', value: { type: 'param', name: 'missing' } } } : node),
    };
    expect(validateGraph(edited)).toContainEqual(expect.objectContaining({ code: 'cycle' }));
  });
  it('does not silently fill deleted or optionalized grammar ports from their payload skeleton', () => {
    const graph = base(), root = graph.roots[0].nodeId, removed = graph.edges[0];
    for (const inputs of [
      graph.nodes.find(node => node.id === root)!.inputs.filter(input => input.id !== removed.to.portId),
      graph.nodes.find(node => node.id === root)!.inputs.map(input => input.id === removed.to.portId ? { ...input, required: false } : input),
    ]) {
      expect(lower({ ...graph, nodes: graph.nodes.map(node => node.id === root ? { ...node, inputs } : node), edges: graph.edges.slice(1) })).toMatchObject({ ok: false });
    }
  });
  it('expands a shared subtree per occurrence and charges every copied node', () => {
    const graph = lift({ type: 'math', op: 'multiply', args: [{ type: 'math', op: 'add', args: [scalar(1), scalar(2)] }, { type: 'math', op: 'add', args: [scalar(3), scalar(4)] }] }, { kind: 'operand' }).graph;
    const root = graph.nodes.find(node => node.id === graph.roots[0].nodeId)!;
    const first = graph.edges.find(edge => edge.to.nodeId === root.id && edge.binding === '/args/0')!;
    const changed: LogicGraph = { ...graph, edges: graph.edges.map(edge => edge.to.nodeId === root.id && edge.binding === '/args/1' ? { ...edge, from: first.from } : edge) };
    const result = lower(changed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.budgets[0]).toMatchObject({ nodes: null, depth: null, duplicatedUseCost: null, accepted: true });
      expect(result.sourceMap.filter(origin => origin.nodeId === first.from.nodeId && (origin.pointer === '/args/0' || origin.pointer === '/args/1'))).toHaveLength(2);
    }
  });
  it('refuses count inside a flow instead of interpreting it as a list reduction', () => {
    const source = pipelineSourceSchema.parse(flow());
    source.inputs.request = { type: 'none', value: { type: 'count', of: [{ test: state() }] } };
    expect(lower(lift(source, { kind: 'flow' }).graph).ok).toBe(false);
  });
  it('rejects flow dependency cycles without requiring a destination type descriptor', () => {
    const first = pipelineSourceSchema.parse(flow()), second = pipelineSourceSchema.parse(flow());
    first.id = 'first'; second.id = 'second';
    const parameter = (sourceId: string) => ({
      name: 'other', type: 'number' as const,
      value: { type: 'read' as const, from: { type: 'source' as const, sourceId, path: ['value'] }, as: 'number' as const, missing: 'unavailable' as const },
    });
    first.inputs.parameters = [parameter('second')]; second.inputs.parameters = [parameter('first')];
    expect(lower(lift({ dataSources: [first, second] }, { kind: 'fragment' }).graph)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'invalid_combination' })]) });
    expect(lower(lift({ ...first, inputs: { ...first.inputs, parameters: [parameter('first')] } }, { kind: 'flow' }).graph).ok).toBe(false);
  });
});
