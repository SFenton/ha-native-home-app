import { describe, expect, it } from 'vitest';
import { checkPipelineSource, evaluatePipeline, newFacts, typeStep, type PipelineInputs, type PipelineStep, type Shape } from '../src/shared/composition/pipeline';
import { scalarText } from '../src/shared/composition/pipeline/text';
import { defaultFieldFor, newStep, stepsThatFit } from '../src/workspace2/data/flow';
import type { Json } from '../src/shared/types';

const item = { type: 'item', path: ['v'] } as const;
const step: PipelineStep = { id: 'mean', op: 'average', value: { ...item, path: [...item.path] } };
const numbers: Shape = { kind: 'array', of: { kind: 'object', fields: { v: { shape: { kind: 'number' } } } } };
const inputs: PipelineInputs = {
  title: 'Mean', parameters: [],
  request: { type: 'entity-attribute', entityId: { type: 'literal', value: 'sensor.demo_values' }, path: ['values'], responseShape: numbers },
  refresh: { on: ['open'], staleAfterSeconds: 300 }, steps: [step], output: { kind: 'scalar' },
  schema: { kind: 'number' },
};
const context = { clock: { now: '2026-11-18T12:00:00', utcOffsetMinutes: 0 } };

describe('average typing', () => {
  it('has the min/max nullable-number typing and its own capability, not flow-extras', () => {
    const facts = newFacts();
    expect(typeStep(step, numbers, new Map(), '/mean', facts)).toEqual({ kind: 'union', of: [{ kind: 'null' }, { kind: 'number' }] });
    expect(facts.issues).toEqual([]);
    const compiled = checkPipelineSource({ id: 'mean', kind: 'model', model: 'pipeline@1', inputs }, '');
    expect(compiled.issues).toEqual([]);
    expect(compiled.capabilities).toContain('sh.flow-average@1');
    expect(compiled.capabilities).not.toContain('sh.flow-extras@1');
  });

  it('refuses typed text and a non-list, rather than coercing or repairing either', () => {
    const facts = newFacts();
    typeStep({ ...step, value: { type: 'literal', value: '12' } }, numbers, new Map(), '/mean', facts);
    expect(facts.issues).toEqual([{ code: 'binding_type', pointer: '/mean/value' }]);
    const single = newFacts();
    typeStep(step, { kind: 'number' }, new Map(), '/mean', single);
    expect(single.issues).toContainEqual({ code: 'binding_type', pointer: '/mean/op' });
  });

  it('starts on a numeric field in the existing step catalog', () => {
    const shape: Shape = { kind: 'array', of: { kind: 'object', fields: { label: { shape: { kind: 'string' } }, v: { shape: { kind: 'number' } } } } };
    expect(stepsThatFit(shape)).toContain('average');
    expect(newStep('average', 'mean', defaultFieldFor('average', shape))).toEqual(step);
  });
});

describe('average evaluation', () => {
  it.each<[string, Json[], number | null]>([
    ['mixed numbers, null and numeric text', [2, null, '10', 6, true, {}], 4],
    ['all non-numbers', [null, '10', false, []], null],
    ['empty list', [], null],
    ['no rounding', [1, 2, 2], 1.6666666666666667],
    ['negative values', [-4, 1], -1.5],
    ['non-finite values', [Infinity, NaN, -Infinity, 4], 4],
    ['overflowing total', [Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE],
    ['negative zero', [-0], 0],
  ])('%s', (_name, parts, expected) => {
    const result = evaluatePipeline(inputs, parts.map(v => ({ v })), context);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.output).toBe(expected);
  });

  it('charges one plus each item and its operand nodes, and uses the contract printer', () => {
    const run = evaluatePipeline(inputs, [{ v: 1 }, { v: 2 }, { v: 2 }], context, 7);
    expect(run.status).toBe('ok');
    if (run.status === 'ok') {
      expect(run.visits).toBe(7);
      expect(scalarText(run.output)).toBe('1.6666666666666667');
    }
    expect(evaluatePipeline(inputs, [{ v: 1 }, { v: 2 }, { v: 2 }], context, 6).status).toBe('over-budget');
    const nested: PipelineInputs = { ...inputs, steps: [{ ...step, value: { type: 'math', op: 'add', args: [step.value, { type: 'literal', value: 1 }] } }] };
    const computed = evaluatePipeline(nested, [{ v: 1 }, { v: 3 }], context);
    expect(computed.status === 'ok' && computed.visits).toBe(9);
  });
});
