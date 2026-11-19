import { describe, expect, it } from 'vitest';
import {
  checkCallService, checkOperand, checkPredicate, type BudgetAccountingEvent, type BudgetAccountingObserver,
  type BudgetScopeKind, type CallService, type Operand, type Predicate,
} from '../src/shared/composition/expression';
import { newFacts, typeOperand, typeSteps, typeWhere, type TypeScope } from '../src/shared/composition/pipeline/typing';
import { ANY, NUMBER, type Shape } from '../src/shared/composition/pipeline/shape';
import type { PipelineStep } from '../src/shared/composition/pipeline/schema';

const lit = (value = 1): Operand => ({ type: 'literal', value });
const viewer = (): Predicate => ({ type: 'viewer', isAdmin: true });
const compare = (): Predicate => ({ type: 'compare', op: 'eq', left: lit(), right: lit() });
const allOf = (): Predicate => ({ type: 'all', of: Array.from({ length: 16 }, compare) });
const choose = (when: Predicate, cases = 1): Operand => ({
  type: 'choose', cases: Array.from({ length: cases }, () => ({ when, then: lit() })), otherwise: lit(0),
});
const list = (leaves: number): Operand => ({ type: 'list', items: Array.from({ length: leaves }, () => lit()) });
const scope: TypeScope = { params: new Map(), allowRead: false, allowViewer: false, item: ANY };
function recording() {
  const events: BudgetAccountingEvent[] = [];
  const observer: BudgetAccountingObserver = event => { events.push(event); };
  return { events, observer };
}
function scopes(events: BudgetAccountingEvent[], kind: BudgetScopeKind) {
  return events.filter((event): event is Extract<BudgetAccountingEvent, { type: 'scope' }> => event.type === 'scope' && event.kind === kind);
}
function lastNode(events: BudgetAccountingEvent[], scopeId: string) {
  const found = events.filter(event => event.type === 'node' && event.scopeId === scopeId).at(-1);
  if (!found || found.type !== 'node') throw new Error(`no node accounting for ${scopeId}`);
  return found;
}
function summary(events: BudgetAccountingEvent[], kind: BudgetScopeKind) {
  const found = scopes(events, kind)[0];
  if (!found || found.type !== 'scope') throw new Error(`no ${kind} scope`);
  return lastNode(events, found.scopeId);
}
const resets = (events: BudgetAccountingEvent[]) => events.filter(event => event.type === 'condition-budget');
function deepOperand(depth: number): Operand {
  let value = lit();
  for (let index = 1; index < depth; index++) value = { type: 'math', op: 'round', args: [value] };
  return value;
}
function deepCondition(depth: number): Predicate {
  let value: Predicate = { type: 'exists', value: lit() };
  for (let index = 1; index < depth; index++) value = { type: 'not', of: value };
  return value;
}
function wideCondition(nodes: number): Predicate {
  return { type: 'all', of: [
    { type: 'all', of: Array.from({ length: 15 }, () => ({ type: 'exists', value: lit() })) },
    { type: 'all', of: Array.from({ length: nodes - 18 }, () => ({ type: 'exists', value: lit() })) },
  ] };
}
function baseCondition(replaceGroup?: number): Predicate {
  return { type: 'all', of: Array.from({ length: 2 }, (_, group) => ({
    type: 'all', of: Array.from({ length: 16 }, (_, index) => group === replaceGroup && index === 0
      ? { type: 'compare', op: 'eq', left: choose(viewer()), right: lit() }
      : viewer()),
  })) };
}

describe('checker-owned budget accounting', () => {
  it.each(['choose', 'count'] as const)('accepts and measures the 49-AST / 17-predicate All Of in %s', kind => {
    const { events, observer } = recording();
    const value: Operand = kind === 'choose' ? choose(allOf()) : { type: 'count', of: [{ test: allOf() }] };
    const found = checkOperand(value, '/value', false, false, undefined, observer);
    expect(found).toStrictEqual(checkOperand(value, '/value'));
    expect(found.issues).toEqual([]);
    expect(summary(events, 'expression')).toMatchObject({ nodes: kind === 'choose' ? 52 : 50, maxDepth: 4 });
    const condition = scopes(events, 'predicate')[1];
    expect(lastNode(events, condition.scopeId)).toMatchObject({ nodes: 17, maxDepth: 2, remaining: 15 });
    const ast = events.filter(event => event.type === 'node' && event.scopeId === 'expression:/value'
      && event.pointer.startsWith(kind === 'choose' ? '/value/cases/0/when' : '/value/of/0/test'));
    expect(ast).toHaveLength(49);
    expect(resets(events).map(event => event.action)).toEqual(kind === 'count' ? ['reset', 'restore'] : ['reset']);
  });

  it('gives a flow filter one 17-predicate scope and 32 independent single-node operand scopes', () => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    const steps: PipelineStep[] = [{ id: 'keep', op: 'filter', where: allOf() }];
    const input: Shape = { kind: 'array', of: NUMBER };
    expect(typeSteps(steps, input, scope.params, '/flow', facts, observer)).toStrictEqual(typeSteps(steps, input, scope.params, '/flow', plain));
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toEqual([]);
    expect(summary(events, 'flow-condition')).toMatchObject({ nodes: 17, maxDepth: 2, remaining: 15 });
    expect(scopes(events, 'flow-operand')).toHaveLength(32);
    for (const own of scopes(events, 'flow-operand')) expect(lastNode(events, own.scopeId)).toMatchObject({ nodes: 1, maxDepth: 1, remaining: 63 });
    expect(events.filter(event => event.type === 'node')).toHaveLength(49);
    expect(events[0]).toEqual({ type: 'steps', scopeId: 'steps:/flow', pointer: '/flow/steps', count: 1, limit: 32 });
  });

  it.each([64, 65])('reports charged and attempted expression nodes at %i', nodes => {
    const { events, observer } = recording();
    const value = list(nodes - 1);
    const facts = checkOperand(value, '/value', false, false, undefined, observer);
    expect(facts).toStrictEqual(checkOperand(value, '/value'));
    expect(facts.issues).toEqual(nodes === 64 ? [] : [{ code: 'limit_exceeded', pointer: '/value/items/63' }]);
    expect(summary(events, 'expression')).toMatchObject({ nodes: 64, attemptedNodes: nodes, maxDepth: 2, remaining: 0 });
  });

  it.each([8, 9])('records the expression depth %i without visiting refused descendants', depth => {
    const { events, observer } = recording();
    const value = deepOperand(depth);
    const facts = checkOperand(value, '/value', false, false, undefined, observer);
    expect(facts).toStrictEqual(checkOperand(value, '/value'));
    expect(facts.issues).toHaveLength(depth === 8 ? 0 : 1);
    expect(summary(events, 'expression')).toMatchObject({ nodes: Math.min(depth, 8), attemptedNodes: depth, maxDepth: depth, maxChargedDepth: Math.min(depth, 8) });
  });

  it('does not count descendants behind an expression-depth short-circuit', () => {
    const { events, observer } = recording();
    checkOperand(deepOperand(12), '/value', false, false, undefined, observer);
    expect(summary(events, 'expression')).toMatchObject({ nodes: 8, attemptedNodes: 9, maxDepth: 9 });
  });

  it.each([128, 129])('shares the %i-node call counter across data, targets and confirmation', nodes => {
    const { events, observer } = recording();
    const call: CallService = {
      type: 'call-service', domain: 'light', service: 'turn_on', data: { type: 'object', fields: { payload: list(63) } },
      target: { entity_id: list(nodes === 128 ? 59 : 60) },
      confirmation: { type: 'additional', style: 'alert', title: 'Confirm', confirmLabel: 'Run', cancelLabel: 'Cancel', destructive: false, when: compare() },
    };
    const facts = checkCallService(call, '/action', false, undefined, undefined, observer);
    expect(facts).toStrictEqual(checkCallService(call, '/action', false));
    expect(facts.issues).toEqual(nodes === 128 ? [] : [{ code: 'limit_exceeded', pointer: '/action/confirmation/when/right' }]);
    expect(scopes(events, 'expression')).toHaveLength(1);
    expect(summary(events, 'expression')).toMatchObject({ nodes: 128, attemptedNodes: nodes, maxDepth: 3, remaining: 0 });
    expect(resets(events)).toEqual([expect.objectContaining({ action: 'reset', pointer: '/action/confirmation/when' })]);
  });

  it.each([16, 17])('reports %i rule cases without changing refusal', cases => {
    const { events, observer } = recording();
    const value = choose(viewer(), cases);
    const facts = checkOperand(value, '/rule', false, false, undefined, observer);
    expect(facts).toStrictEqual(checkOperand(value, '/rule'));
    expect(facts.issues).toEqual(cases === 16 ? [] : [{ code: 'limit_exceeded', pointer: '/rule/cases' }]);
    expect(events.filter(event => event.type === 'rule-cases')).toEqual([{ type: 'rule-cases', pointer: '/rule/cases', count: cases, limit: 16 }]);
    expect(resets(events)).toHaveLength(cases);
  });

  it('records count resets and the restoration of the actual enclosing condition counter', () => {
    const { events, observer } = recording();
    const value: Operand = choose({
      type: 'exists', value: { type: 'count', of: [{ test: viewer() }, { test: viewer() }] },
    });
    expect(checkOperand(value, '/value', false, false, undefined, observer)).toStrictEqual(checkOperand(value, '/value'));
    expect(resets(events)).toEqual([
      expect.objectContaining({ action: 'reset', pointer: '/value/cases/0/when', previousRemaining: null, remaining: 32 }),
      expect.objectContaining({ action: 'reset', pointer: '/value/cases/0/when/value/of/0/test', previousRemaining: 31, remaining: 32 }),
      expect.objectContaining({ action: 'reset', pointer: '/value/cases/0/when/value/of/1/test', previousRemaining: 31, remaining: 32 }),
      expect.objectContaining({ action: 'restore', pointer: '/value/cases/0/when/value', previousRemaining: 31, remaining: 31, scopeId: 'predicate:/value/cases/0/when' }),
    ]);
  });
});

describe('flow-local counters', () => {
  it.each([64, 65])('records flow operand nodes at %i', nodes => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    expect(typeOperand(list(nodes - 1), scope, '/operand', facts, undefined, 1, observer)).toStrictEqual(typeOperand(list(nodes - 1), scope, '/operand', plain));
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toHaveLength(nodes === 64 ? 0 : 1);
    expect(summary(events, 'flow-operand')).toMatchObject({ nodes: 64, attemptedNodes: nodes, maxDepth: 2 });
  });

  it.each([8, 9])('records flow operand depth at %i', depth => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    expect(typeOperand(deepOperand(depth), scope, '/operand', facts, undefined, 1, observer)).toStrictEqual(typeOperand(deepOperand(depth), scope, '/operand', plain));
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toHaveLength(depth === 8 ? 0 : 1);
    expect(summary(events, 'flow-operand')).toMatchObject({ nodes: Math.min(depth, 8), attemptedNodes: depth, maxDepth: depth });
  });

  it.each([32, 33])('records predicate-only flow nodes at %i', nodes => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    typeWhere(wideCondition(nodes), scope, '/where', facts, undefined, 1, observer);
    typeWhere(wideCondition(nodes), scope, '/where', plain);
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toHaveLength(nodes === 32 ? 0 : 1);
    expect(summary(events, 'flow-condition')).toMatchObject({ nodes: 32, attemptedNodes: nodes, maxDepth: 3 });
  });

  it.each([6, 7])('records predicate-only flow depth at %i', depth => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    typeWhere(deepCondition(depth), scope, '/where', facts, undefined, 1, observer);
    typeWhere(deepCondition(depth), scope, '/where', plain);
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toHaveLength(depth === 6 ? 0 : 1);
    expect(summary(events, 'flow-condition')).toMatchObject({ nodes: Math.min(depth, 6), attemptedNodes: depth, maxDepth: depth });
    expect(scopes(events, 'flow-operand')).toHaveLength(depth === 6 ? 1 : 0);
  });

  it('keeps Choose value branches in one scope and its conditions and leaf operands separate', () => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    const value = choose(allOf());
    expect(typeOperand(value, scope, '/rule', facts, undefined, 1, observer)).toStrictEqual(typeOperand(value, scope, '/rule', plain));
    expect(facts).toStrictEqual(plain);
    expect(facts.issues).toEqual([]);
    expect(summary(events, 'flow-operand')).toMatchObject({ nodes: 3, maxDepth: 2, remaining: 61 });
    expect(summary(events, 'flow-condition')).toMatchObject({ nodes: 17, maxDepth: 2 });
    expect(scopes(events, 'flow-operand')).toHaveLength(33);
    expect(new Set(events.filter(event => event.type === 'scope').map(event => event.scopeId)).size).toBe(34);
    expect(events.filter(event => event.type === 'rule-cases')).toEqual([{ type: 'rule-cases', pointer: '/rule/cases', count: 1, limit: 16 }]);
  });

  it.each([32, 33])('reports %i authored step slots without introducing a typing limit check', count => {
    const { events, observer } = recording();
    const facts = newFacts(), plain = newFacts();
    const steps: PipelineStep[] = Array.from({ length: count }, (_, index) => ({ id: `step${index}`, op: 'limit', count: 1 }));
    const input: Shape = { kind: 'array', of: NUMBER };
    expect(typeSteps(steps, input, scope.params, '/flow', facts, observer)).toStrictEqual(typeSteps(steps, input, scope.params, '/flow', plain));
    expect(facts).toStrictEqual(plain);
    expect(events).toEqual([{ type: 'steps', scopeId: 'steps:/flow', pointer: '/flow/steps', count, limit: 32 }]);
  });
});

describe('CHK-nested-choose-budget is observed, not repaired', () => {
  it.each(['/visibleWhen', '/look/cases/0/when', '/activeWhen', '/filledWhen', '/errorWhen'])('keeps the initially uncapped 35-node predicate and early-reset failure at %s', pointer => {
    const plain = recording();
    expect(checkPredicate(baseCondition(), pointer, false, undefined, plain.observer).issues).toEqual([]);
    expect(summary(plain.events, 'expression')).toMatchObject({ nodes: 35, maxDepth: 3 });
    expect(summary(plain.events, 'predicate')).toMatchObject({ nodes: 35, maxDepth: 3, remaining: null });
    expect(resets(plain.events)).toEqual([]);

    const { events, observer } = recording();
    const value = baseCondition(0);
    const found = checkPredicate(value, pointer, false, undefined, observer);
    expect(found).toStrictEqual(checkPredicate(value, pointer));
    expect(found.issues).toEqual([{ code: 'limit_exceeded', pointer: `${pointer}/of/1/of/15` }]);
    expect(summary(events, 'expression')).toMatchObject({ nodes: 40, maxDepth: 5 });
    expect(resets(events)).toEqual([expect.objectContaining({
      action: 'reset', pointer: `${pointer}/of/0/of/0/left/cases/0/when`, previousRemaining: null, remaining: 32,
    })]);
    const reset = resets(events)[0];
    expect(lastNode(events, reset.scopeId)).toMatchObject({ nodes: 32, attemptedNodes: 33, remaining: 0, charged: false, pointer: `${pointer}/of/1/of/15` });
  });

  it('accepts 35 outer predicates after a later nested Choose replenishes the live counter', () => {
    expect(checkOperand(choose(baseCondition()), '/value').issues).toEqual([
      { code: 'limit_exceeded', pointer: '/value/cases/0/when/of/1/of/13' },
      { code: 'limit_exceeded', pointer: '/value/cases/0/when/of/1/of/14' },
      { code: 'limit_exceeded', pointer: '/value/cases/0/when/of/1/of/15' },
    ]);
    const { events, observer } = recording();
    const value = choose(baseCondition(1));
    const found = checkOperand(value, '/value', false, false, undefined, observer);
    expect(found).toStrictEqual(checkOperand(value, '/value'));
    expect(found.issues).toEqual([]);
    expect(summary(events, 'expression')).toMatchObject({ nodes: 43, maxDepth: 6 });
    expect(resets(events)).toEqual([
      expect.objectContaining({ action: 'reset', pointer: '/value/cases/0/when', previousRemaining: null, remaining: 32 }),
      expect.objectContaining({ action: 'reset', pointer: '/value/cases/0/when/of/1/of/0/left/cases/0/when', previousRemaining: 12, remaining: 32 }),
    ]);
    const predicateNodes = events.filter(event => event.type === 'node' && event.scopeId.startsWith('predicate:'));
    expect(predicateNodes).toHaveLength(36);
    expect(lastNode(events, resets(events)[1].scopeId)).toMatchObject({ nodes: 16, remaining: 16 });
  });
});
