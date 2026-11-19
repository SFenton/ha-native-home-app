import { checkCallService, checkOperand, checkPredicate, type BudgetAccountingEvent, type CallService, type Operand, type Predicate } from '../../../src/shared/composition/expression';
import { budgetFromCompilation, type AccountingCompilation } from '../../../src/shared/composition/graph/budgets';
import type { FragmentCompilation } from '../../../src/shared/composition/graph/compile';
import { newFacts, typeSteps, typeWhere } from '../../../src/shared/composition/pipeline/typing';
import type { PipelineStep } from '../../../src/shared/composition/pipeline/schema';
import type { Json } from '../../../src/shared/types';

export const anchor = { kind: 'logic', id: 'canvas-test', field: '/body' } as const;
export const number = (value = 1): Operand => ({ type: 'literal', value });
export const comparisons: Predicate = { type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'compare', op: 'eq', left: number(), right: number() })) };
export const choose: Operand = { type: 'choose', cases: [{ when: comparisons, then: number() }], otherwise: number() };
export const count: Operand = { type: 'count', of: [{ test: comparisons }] };
export function observedFixture(ast: Operand | Predicate | CallService, kind: 'operand' | 'condition' | 'call', at = '') {
  const accounting: BudgetAccountingEvent[] = [], observe = (event: BudgetAccountingEvent) => accounting.push(event);
  const facts = kind === 'condition' ? checkPredicate(ast as Predicate, at, false, undefined, observe)
    : kind === 'call' ? checkCallService(ast as CallService, at, false, undefined, undefined, observe)
      : checkOperand(ast as Operand, at, false, false, undefined, observe);
  return fixtureBudget(ast, facts.issues, accounting);
}
export function flowFixture(steps?: PipelineStep[]) {
  const accounting: BudgetAccountingEvent[] = [], facts = newFacts();
  if (steps) typeSteps(steps, { kind: 'array', of: { kind: 'number' } }, new Map(), '/inputs', facts, event => accounting.push(event));
  else typeWhere(comparisons, { params: new Map(), allowRead: false, allowViewer: false }, '/inputs/steps/0/where', facts, undefined, 1, event => accounting.push(event));
  return fixtureBudget({}, facts.issues, accounting);
}
function fixtureBudget(ast: Json, issues: FragmentCompilation['issues'], accounting: BudgetAccountingEvent[]) {
  const compiled: AccountingCompilation = { expanded: ast, origins: [], issues, capabilities: [], dependencies: [], accounting };
  return budgetFromCompilation(ast, anchor, compiled);
}
