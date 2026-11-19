// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as expression from '../../../src/shared/composition/expression';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LimitsMeter from '../../../src/workspace2/canvas/LimitsMeter';
import type { CallService, Operand, Predicate } from '../../../src/shared/composition/expression';
import { predicateBudgetFixtures } from '../graph/fixtures';
import { copy } from '../../../src/shared/composition/graph/json';
import { anchor, choose, count, flowFixture, number, observedFixture } from './fixtures';
import { measureBudget } from '../../../src/shared/composition/graph';

afterEach(cleanup);
const list = (nodes: number): Operand => ({ type: 'list', items: Array.from({ length: nodes - 1 }, () => number()) });
function predicate(nodes: number): Predicate {
  if (nodes === 1) return { type: 'viewer', isAdmin: true };
  if (nodes <= 17) return { type: 'all', of: Array.from({ length: nodes - 1 }, () => predicate(1)) };
  return { type: 'all', of: [predicate(16), predicate(nodes - 17)] };
}
describe('C-meter uses real checker accounting, not canvas AST counts', () => {
  it.each([[48, false], [49, true], [64, true], [65, true]] as const)('expression nodes %i show compact=%s', (nodes, visible) => {
    const budget = observedFixture(list(nodes), 'operand');
    expect(budget.meters.find(meter => meter.kind === 'Expression nodes')).toMatchObject({ used: nodes, limit: 64, visible });
    expect(budget.accepted).toBe(nodes <= 64);
    render(<LimitsMeter budgets={[budget]}/>);
    expect(screen.queryByLabelText('Limits above 75 percent') !== null).toBe(visible);
  });
  it.each([[96, false], [97, true], [128, true], [129, true]] as const)('shared call nodes %i show compact=%s', (nodes, visible) => {
    const call: CallService = { type: 'call-service', domain: 'light', service: 'turn_on', data: { type: 'object', fields: { payload: list(64) } }, target: { entity_id: list(nodes - 65) } };
    const budget = observedFixture(call, 'call');
    expect(budget.scopes.filter(scope => scope.kind === 'expression')).toHaveLength(1);
    expect(budget.meters.find(meter => meter.kind === 'Expression nodes')).toMatchObject({ used: nodes, limit: 128, visible });
    expect(budget.accepted).toBe(nodes <= 128);
  });
  it.each([[24, false], [25, true], [32, true], [33, true]] as const)('predicate nodes %i show compact=%s', (nodes, visible) => {
    const budget = observedFixture({ type: 'choose', cases: [{ when: predicate(nodes), then: number() }], otherwise: number() }, 'operand');
    expect(budget.meters.find(meter => meter.kind === 'Predicate nodes' && meter.limit === 32)).toMatchObject({ used: nodes, visible });
    expect(budget.accepted).toBe(nodes <= 32);
  });
  it.each([[6, false], [7, true], [8, true], [9, true]] as const)('expression depth %i show compact=%s', (depth, visible) => {
    let value = number(); for (let i = 1; i < depth; i++) value = { type: 'math', op: 'round', args: [value] };
    const budget = observedFixture(value, 'operand');
    expect(budget.meters.find(meter => meter.kind === 'Expression depth')).toMatchObject({ used: depth, visible });
  });
  it.each([[4, false], [5, true], [6, true], [7, true]] as const)('predicate depth %i show compact=%s', (depth, visible) => {
    let when = predicate(1); for (let i = 1; i < depth; i++) when = { type: 'not', of: when };
    const budget = observedFixture({ type: 'choose', cases: [{ when, then: number() }], otherwise: number() }, 'operand');
    expect(budget.meters.find(meter => meter.kind === 'Predicate depth' && meter.limit === 6)).toMatchObject({ used: depth, visible });
  });
  it('accepts all G-limits placements without applying 32 to the combined AST', () => {
    expect(observedFixture(choose, 'operand')).toMatchObject({ accepted: true, nodes: 52, depth: 4, compactVisible: true });
    expect(observedFixture(count, 'operand')).toMatchObject({ accepted: true, nodes: 50, depth: 4, compactVisible: true });
    const flow = flowFixture();
    expect(flow.accepted).toBe(true); expect(flow.compactVisible).toBe(false);
    expect(flow.scopes.filter(scope => scope.kind === 'expression')).toHaveLength(32);
    expect(flow.scopes.find(scope => scope.kind === 'predicate')).toMatchObject({ nodes: 17, depth: 2, nodeLimit: 32 });
  });
  it.each([[24, false], [25, true], [32, true]] as const)('flow steps %i show compact=%s', (steps, visible) => {
    const budget = flowFixture(Array.from({ length: steps }, (_, index) => ({ id: `step-${index}`, op: 'limit', count: 10 })));
    expect(budget.meters.find(meter => meter.kind === 'Flow steps')).toMatchObject({ used: steps, limit: 32, visible });
  });
  it('shows rule cases only above the exact 75% threshold', () => {
    for (const cases of [12, 13]) {
      const budget = observedFixture({ type: 'choose', cases: Array.from({ length: cases }, () => ({ when: predicate(1), then: number() })), otherwise: number() }, 'operand');
      expect(budget.meters.find(meter => meter.kind === 'Rule cases')).toMatchObject({ used: cases, visible: cases === 13 });
    }
  });
  it.each([['early', 'condition', false], ['outerLater', 'operand', true], ['base', 'condition', true], ['outerBase', 'operand', false]] as const)('meter matches compiler: CHK %s', (name, kind, accepted) => {
    const value = copy(predicateBudgetFixtures[name]);
    const budget = observedFixture(value as Operand | Predicate, kind), native = measureBudget(value, anchor, { kind });
    expect(budget.accepted).toBe(accepted); expect(budget.compilerIssues).toEqual(native.compilerIssues);
    expect(budget.firstExceedingPointer).toBe(native.firstExceedingPointer);
    if (name === 'early') expect(budget.firstExceedingPointer).toBe('/of/1/of/15');
    if (name === 'outerLater') expect(budget).toMatchObject({ nodes: 43, depth: 6, accepted: true });
    if (name === 'base') {
      const initial = budget.meters.find(meter => meter.kind === 'Predicate nodes')!;
      expect(initial).toMatchObject({ used: 35, limit: null, ratio: null, visible: false, exceeded: false });
    }
  });
  it('keeps production accounting explicitly unavailable until observer integration', () => {
    render(<LimitsMeter budgets={[measureBudget(choose, anchor, { kind: 'operand' })]}/>);
    fireEvent.click(screen.getByText('Limits'));
    expect(screen.getByText(/Accounting unavailable pending observer/)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });
  it.each(['/visibleWhen', '/look/cases/0/when', '/activeWhen', '/filledWhen', '/errorWhen'])('meter matches compiler: CHK early refusal in %s', pointer => {
    const base = observedFixture(copy(predicateBudgetFixtures.base) as Predicate, 'condition', pointer);
    expect(base).toMatchObject({ accepted: true, nodes: 35, depth: 3, counterResets: [] });
    expect(base.scopes.find(scope => scope.kind === 'predicate')).toMatchObject({ nodes: 35, nodeLimit: null, depthLimit: null });
    const early = observedFixture(copy(predicateBudgetFixtures.early) as Predicate, 'condition', pointer);
    expect(early.compilerIssues).toEqual([{ code: 'limit_exceeded', pointer: `${pointer}/of/1/of/15` }]);
    expect(early).toMatchObject({ accepted: false, nodes: 40, depth: 5, firstExceedingPointer: `${pointer}/of/1/of/15` });
    expect(early.scopes.find(scope => scope.nodeLimit === 32)).toMatchObject({ nodes: 33, nodeLimit: 32 });
    expect(early.counterResets).toEqual([expect.objectContaining({ pointer: `${pointer}/of/0/of/0/left/cases/0/when`, kind: 'choose' })]);
  });
  it('the accounting adapter and meter do not run the checker a second time', () => {
    const check = vi.spyOn(expression, 'checkOperand');
    try {
      const budget = observedFixture(choose, 'operand');
      render(<LimitsMeter budgets={[budget]}/>);
      fireEvent.click(screen.getByText('Limits'));
      expect(check).toHaveBeenCalledOnce();
    } finally { check.mockRestore(); }
  });
});
