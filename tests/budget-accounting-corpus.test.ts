import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as expression from '../src/shared/composition/expression';
import * as typing from '../src/shared/composition/pipeline/typing';
import { decodeCompositionPublication } from '../server/composition';
import { CompositionValidationError, parseCompositionJSON, pointer } from '../src/shared/composition/json';

const directory = path.resolve(__dirname, '../contract/corpus');
const index: { cases: { file: string; outcome: 'accept' | 'reject' }[] } = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
const original = { ...expression, ...typing };
let observing = false;
let visits = 0;
const observedCalls = new Set<string>();
let refusedRoots = 0;
const observer: expression.BudgetAccountingObserver = () => { visits += 1; };
function observe(name: string) {
  if (!observing) return undefined;
  observedCalls.add(name);
  return observer;
}
vi.spyOn(expression, 'checkOperand').mockImplementation((value, at, control, flow, scope) =>
  original.checkOperand(value, at, control, flow, scope, observe('operand')));
vi.spyOn(expression, 'checkPredicate').mockImplementation((value, at, flow, scope) =>
  original.checkPredicate(value, at, flow, scope, observe('predicate')));
vi.spyOn(expression, 'checkCallService').mockImplementation((value, at, control, scope, stoppers) =>
  original.checkCallService(value, at, control, scope, stoppers, observe('call')));
vi.spyOn(typing, 'typeOperand').mockImplementation((value, scope, at, facts, budget, depth) =>
  original.typeOperand(value, scope, at, facts, budget, depth, observe('flow-operand')));
vi.spyOn(typing, 'typeSteps').mockImplementation((steps, input, params, at, facts) =>
  original.typeSteps(steps, input, params, at, facts, observe('flow-steps')));

function decode(bytes: Buffer) {
  try { return { publication: decodeCompositionPublication(bytes) }; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { issues: error.issues };
  }
}

function checkRoots(bytes: Buffer) {
  let parsed: unknown;
  try { parsed = parseCompositionJSON(bytes); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    expect(decode(bytes)).toEqual({ issues: error.issues });
    return;
  }
  function walk(value: unknown, at: string) {
    if (value === null || typeof value !== 'object') return;
    if ('type' in value) {
      // Exercise semantic refusals even when the publication's schema rejects before its compiler walk.
      const operand = original.operandBase.safeParse(value);
      if (operand.success) {
        const plain = original.checkOperand(operand.data, at, true, false, 'lenient');
        expect(original.checkOperand(operand.data, at, true, false, 'lenient', observer)).toStrictEqual(plain);
        if (plain.issues.length) refusedRoots += 1;
      }
      const predicate = original.predicateBase.safeParse(value);
      if (predicate.success) {
        const plain = original.checkPredicate(predicate.data, at, false, 'lenient');
        expect(original.checkPredicate(predicate.data, at, false, 'lenient', observer)).toStrictEqual(plain);
        if (plain.issues.length) refusedRoots += 1;
      }
    }
    for (const [key, child] of Object.entries(value)) walk(child, pointer(at, key));
  }
  walk(parsed, '');
}

describe('read-only accounting across the complete publication contract corpus', () => {
  it.each(index.cases)('$outcome $file gives identical publication or ordered diagnostics', entry => {
    const bytes = readFileSync(path.join(directory, entry.file));
    observing = false;
    const plain = decode(bytes);
    observing = true;
    try {
      expect(decode(bytes)).toStrictEqual(plain);
      checkRoots(bytes);
    }
    finally { observing = false; }
  });

  it('actually observed both expression and flow checker entry points', () => {
    expect(visits).toBeGreaterThan(0);
    expect(refusedRoots).toBeGreaterThan(0);
    expect(observedCalls).toEqual(new Set(['operand', 'predicate', 'call', 'flow-operand', 'flow-steps']));
    expect(new Set(index.cases.map(entry => entry.outcome))).toEqual(new Set(['accept', 'reject']));
  });
});
