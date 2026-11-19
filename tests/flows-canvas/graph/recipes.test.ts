import { describe, expect, it } from 'vitest';
import { evaluateOperand, evaluatePredicate, type Environment } from '../../../src/shared/composition/evaluator';
import { operandBase, predicateBase, type Operand } from '../../../src/shared/composition/expression';
import { evaluatePipeline } from '../../../src/shared/composition/pipeline/evaluate';
import { pipelineSourceSchema } from '../../../src/shared/composition/pipeline/schema';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import { averageFixed, checkGraphPipeline, graphSourceSchema, lift, lower, lowerFlowBranches, lowerForEach, lowerListAverage, type FixedForEach, type RecipeResult } from '../../../src/shared/composition/graph';
import type { Json } from '../../../src/shared/types';
import { brightnessPrefix, downstairsLights } from './fixtures';

const capabilities = [...supportedCompositionCapabilities, 'sh.flow-average@1', 'sh.text-keep@1'];
const item: Operand = { type: 'item', path: ['value'] };
const fixed = (count: number, reducer: FixedForEach['reducer'] = 'count'): FixedForEach => ({
  mode: 'fixed', reducer, sourceParameter: 'source',
  selection: Array.from({ length: count }, (_, i) => ({ sourceId: `light-${i}` })),
  test: { type: 'state', sourceId: { type: 'hole', name: 'source' }, path: ['state'], in: ['on'] },
});
function value(result: RecipeResult) { if (!result.ok) throw new Error(JSON.stringify(result.errors)); return result.value; }
const env: Environment = { read: () => ({ status: 'unavailable' }) };

describe('explicit For Each and strict arithmetic recipes', () => {
  it('materializes source substitutions, preserving duplicates and count semantics', () => {
    const recipe = fixed(5);
    const result = value(lowerForEach({ ...recipe, selection: ['a', 'b', 'c', 'd', 'e'].map(letter => ({ sourceId: `light-${letter}` })) }));
    expect(result.ast).toEqual(downstairsLights);
    expect(result.sources).toEqual([]);
    expect(result.budgets[0]).toMatchObject({ nodes: null, depth: null, accepted: true });
    const duplicate = value(lowerForEach({ ...fixed(2), selection: [{ sourceId: 'light-0' }, { sourceId: 'light-0' }] }));
    expect(evaluateOperand(operandBase.parse(duplicate.ast), { read: () => ({ status: 'value', value: 'on' }) })).toEqual({ status: 'value', value: 2 });
    expect(evaluateOperand(operandBase.parse(duplicate.ast), { read: () => ({ status: 'value', value: 'unavailable' }) })).toEqual({ status: 'value', value: 0 });
    expect(evaluateOperand(operandBase.parse(duplicate.ast), env)).toEqual({ status: 'unavailable' });
    expect(evaluateOperand(operandBase.parse(duplicate.ast), { read: () => ({ status: 'loading' }) })).toEqual({ status: 'loading' });
  });
  it('uses explicit count comparisons for Any/All and viewer-eligible denominators', () => {
    for (const reducer of ['any', 'all'] as const) {
      const result = value(lowerForEach(fixed(3, reducer)));
      expect(result.budgets[0].accepted).toBe(true);
      expect(evaluatePredicate(predicateBase.parse(result.ast), { read: () => ({ status: 'value', value: 'on' }) })).toBe('yes');
    }
    const result = value(lowerForEach({ ...fixed(1, 'all'), selection: [{ sourceId: 'light-0', viewer: { personEntityIds: ['person.demo'] } }] }));
    expect(result.ast).toMatchObject({ type: 'compare', right: { type: 'count' } });
    expect(evaluatePredicate(predicateBase.parse(result.ast), { read: () => ({ status: 'value', value: 'off' }), viewer: { personEntityId: 'person.demo_someone_else' } })).toBe('yes');
    expect(evaluatePredicate(predicateBase.parse(result.ast), { read: () => ({ status: 'value', value: 'off' }) })).toBe('unknown');
  });
  it('rejects larger/empty fixed selections, oversized expansion and silently converting duplicate entities', () => {
    expect(lowerForEach(fixed(0)).ok).toBe(false);
    expect(lowerForEach(fixed(33))).toMatchObject({ ok: false });
    expect(lowerForEach({ ...fixed(32), test: { type: 'not', of: fixed(1).test } })).toMatchObject({ ok: false });
    expect(lowerForEach({ mode: 'flow', id: 'lights', entityIds: ['light.demo_a', 'light.demo_a'], attributes: [], reducer: 'count' })).toMatchObject({ ok: false });
    const large = value(lowerForEach({ mode: 'flow', id: 'lights', entityIds: Array.from({ length: 64 }, (_, i) => `light.demo_e_${i}`), attributes: [], reducer: 'all' }));
    expect(large.sources).toHaveLength(2);
    for (const source of large.sources) expect(checkGraphPipeline(source, '').issues).toEqual([]);
  });
  it('includes compiler requirements from generated filters in the recipe requirements', () => {
    const result = value(lowerForEach({
      mode: 'flow', id: 'exists', entityIds: ['light.demo_a'], attributes: [], reducer: 'count',
      test: { type: 'exists', value: { type: 'item', path: [] } },
    }));
    expect(checkGraphPipeline(result.sources[0], '').capabilities).toContain('sh.pipeline-operands@1');
    expect(result.budgets[1].capabilities).toContain('sh.pipeline-operands@1');
    expect(result.capabilities).toContain('sh.pipeline-operands@1');
    for (const source of result.sources) for (const capability of checkGraphPipeline(source, '').capabilities) expect(result.capabilities).toContain(capability);
  });
  it.each(['count', 'any', 'all'] as const)('declares scalar output for %s on a valid records-output prefix', reducer => {
    const prefix = pipelineSourceSchema.parse({
      id: 'prefix', kind: 'model', model: 'pipeline@1',
      inputs: {
        title: 'Records', parameters: [], request: { type: 'none', value: { type: 'literal', value: [{ n: 3 }] } },
        steps: [], output: { kind: 'records', max: 100 }, schema: { kind: 'array', of: { kind: 'object', fields: { n: { shape: { kind: 'number' } } } } },
      },
    });
    expect(checkGraphPipeline(prefix, '').issues).toEqual([]);
    const result = value(lowerForEach({ mode: 'flow', id: 'records', prefix: prefix.inputs, reducer }));
    for (const source of result.sources) {
      expect(checkGraphPipeline(source, '').issues).toEqual([]);
      expect(source.inputs).toMatchObject({ output: { kind: 'scalar' }, schema: { kind: 'number' } });
      const run = evaluatePipeline(pipelineSourceSchema.parse(source).inputs, null, { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
      expect(run).toMatchObject({ status: 'ok', value: 1 });
    }
  });
  it('strict fixed averages do not skip missing inputs or coerce text sockets', () => {
    const result = value(averageFixed([{ type: 'literal', value: 23.6 }, { type: 'literal', value: 25 }]));
    expect(result.budgets[0].accepted).toBe(true);
    expect(evaluateOperand(operandBase.parse(result.ast), env)).toEqual({ status: 'value', value: 24.3 });
    expect(averageFixed([{ type: 'literal', value: '2' }, { type: 'literal', value: 4 }]).ok).toBe(false);
    const missing = value(averageFixed([{ type: 'read', from: { type: 'source', sourceId: 'temp', path: ['state'] }, as: 'number', missing: 'unavailable' }, { type: 'literal', value: 4 }]));
    expect(evaluateOperand(operandBase.parse(missing.ast), env)).toEqual({ status: 'unavailable' });
  });
});

describe('G-average target-gated step and finite-total two-flow fallback', () => {
  const recipe = (strategy: 'step' | 'two-flow') => value(lowerListAverage({ id: 'brightness', prefix: brightnessPrefix, value: item, targetCapabilities: capabilities, strategy }));
  it('emits the supported step without silently migrating an authored average', () => {
    const result = recipe('step');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].inputs.steps.at(-1)).toEqual({ id: 'average', op: 'average', value: item });
    expect(result.diagnostics).toEqual([]);
    expect(checkGraphPipeline(result.sources[0], '').issues).toEqual([]);
    expect(lowerListAverage({ id: 'brightness', prefix: brightnessPrefix, value: item, targetCapabilities: [], strategy: 'step' })).toMatchObject({ ok: false });
    const graph = lift(graphSourceSchema.parse(result.sources[0]), { kind: 'flow' }).graph;
    expect(lower(graph, { targetCapabilities: capabilities }).ok).toBe(true);
    expect(lower(graph, { targetCapabilities: capabilities.filter(capability => capability !== 'sh.flow-average@1') }).ok).toBe(false);
  });
  it.each(['any', 'all'] as const)('gives empty generic lists their explicit flow %s semantics', reducer => {
    const recipe = value(lowerForEach({
      mode: 'flow', id: 'empty', reducer,
      prefix: { title: 'Empty', parameters: [], request: { type: 'none', value: { type: 'literal', value: [] } }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'number' } },
    }));
    const reads = new Map<string, Json>();
    for (const source of recipe.sources) {
      const run = evaluatePipeline(pipelineSourceSchema.parse(source).inputs, [], { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
      expect(run.status).toBe('ok');
      if (run.status === 'ok') reads.set(source.id, run.value);
    }
    expect(evaluatePredicate(predicateBase.parse(recipe.ast), { read: id => ({ status: 'value', value: reads.get(id)! }) })).toBe(reducer === 'all' ? 'yes' : 'no');
  });
  it.each([[128, true], [129, false]] as const)('materializes %i terminal flows within the shared source limit=%s', (count, accepted) => {
    const inputs = pipelineSourceSchema.parse(recipe('two-flow').sources[0]).inputs;
    expect(lowerFlowBranches(Array.from({ length: count }, (_, i) => ({ id: `branch-${i}`, inputs }))).ok).toBe(accepted);
  });
  it('duplicates the exact request and preprocessing and filters normalized values before count', () => {
    const result = recipe('two-flow');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].inputs.request).toEqual(result.sources[1].inputs.request);
    expect(result.sources[0].inputs.steps[0]).toEqual(result.sources[1].inputs.steps[0]);
    expect(result.sources.map(source => source.inputs.steps.length)).toEqual([2, 3]);
    expect(result.sources[1].inputs.steps.slice(-2)).toEqual([{ id: 'valid', op: 'filter', where: { type: 'exists', value: item } }, { id: 'count', op: 'count' }]);
    expect(result.budgets[0].generatedFlowCount).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'average_fallback_overflow', message: expect.stringContaining('Parity requires every running total to stay finite.') }));
  });
  it.each<{ rows: Json[]; expected: number | null }>([
    { rows: [], expected: null },
    { rows: [{ brightness: null }, {}], expected: null },
    { rows: [{ brightness: 255 }, {}, { brightness: 0 }], expected: 50 },
    { rows: [{ brightness: 204 }, { brightness: 140 }, { brightness: 130 }, { brightness: null }, {}], expected: (204 + 140 + 130) / 255 * 100 / 3 },
  ])('matches Average when normalized running totals stay finite for $rows', ({ rows, expected }) => {
    const fallback = recipe('two-flow'), reads = new Map<string, Json>();
    for (const source of fallback.sources) {
      const baseline = pipelineSourceSchema.parse(source);
      const run = evaluatePipeline(baseline.inputs, rows, { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
      expect(run.status).toBe('ok');
      if (run.status === 'ok') reads.set(source.id, run.value);
    }
    const actual = evaluateOperand(operandBase.parse(fallback.ast), { read: id => ({ status: 'value', value: reads.get(id)! }) });
    if (expected === null) expect(actual).toEqual({ status: 'unavailable' });
    else { expect(actual.status).toBe('value'); if (actual.status === 'value') expect(actual.value).toBeCloseTo(expected, 12); }
    const supported = pipelineSourceSchema.parse(recipe('step').sources[0]);
    const run = evaluatePipeline(supported.inputs, rows, { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
    expect(run.status).toBe('ok');
    if (run.status === 'ok') {
      if (expected === null) expect(run.value).toBeNull();
      else expect(run.value).toBeCloseTo(expected, 12);
    }
  });
  it.each([
    { numbers: [1e308, 1e308], mean: 1e308 },
    { numbers: [1e308, 1e308, -1e308], mean: 1e308 / 3 },
    { numbers: [-1e308, -1e308], mean: -1e308 },
  ])('discloses that an overflowing running total gives unavailable for $numbers', ({ numbers, mean }) => {
    const prefix = pipelineSourceSchema.parse(recipe('step').sources[0]).inputs;
    prefix.request = { type: 'none', value: { type: 'literal', value: numbers } };
    prefix.steps = [];
    const build = (strategy: 'step' | 'two-flow') => value(lowerListAverage({ id: 'large', prefix, value: { type: 'item', path: [] }, targetCapabilities: capabilities, strategy }));
    const step = build('step'), fallback = build('two-flow'), reads = new Map<string, Json>();
    for (const source of fallback.sources) {
      const run = evaluatePipeline(pipelineSourceSchema.parse(source).inputs, null, { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
      expect(run.status).toBe('ok');
      if (run.status === 'ok') reads.set(source.id, run.value);
    }
    expect(evaluateOperand(operandBase.parse(fallback.ast), { read: id => ({ status: 'value', value: reads.get(id)! }) })).toEqual({ status: 'unavailable' });
    expect(fallback.diagnostics).toContainEqual(expect.objectContaining({ code: 'average_fallback_overflow', severity: 'warning' }));
    const run = evaluatePipeline(pipelineSourceSchema.parse(step.sources[0]).inputs, null, { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } });
    expect(run.status).toBe('ok');
    if (run.status === 'ok') expect(run.value).toBe(mean);
  });
  it('surfaces A-number-state refusal and rejects untyped/text averages', () => {
    expect(lowerListAverage({ id: 'temp', prefix: brightnessPrefix, value: item, targetCapabilities: capabilities, inputKind: 'entity-state' })).toMatchObject({
      ok: false, errors: [{ code: 'recipe_disabled', pointer: '/steps/0/fields/value/args/0', message: expect.stringContaining('A-number-state') }],
    });
    expect(lowerListAverage({ id: 'temp', prefix: { ...brightnessPrefix, steps: [] }, value: { type: 'item', path: ['state'] }, targetCapabilities: capabilities })).toMatchObject({ ok: false });
  });
  it('materializes forks rather than sharing a hidden network execution', () => {
    const branches = recipe('two-flow').sources.map(source => ({ id: source.id, inputs: source.inputs }));
    const result = lowerFlowBranches(branches);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sources.map(source => source.id)).toEqual(['brightness-sum', 'brightness-valid-count']);
    expect(lowerFlowBranches(branches, ['brightness-sum']).ok).toBe(false);
  });
});
