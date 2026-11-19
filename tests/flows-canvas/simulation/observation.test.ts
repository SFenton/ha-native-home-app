import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluateOperand, value } from '../../../src/shared/composition/evaluator';
import { evaluatePipeline, type PipelineInputs } from '../../../src/shared/composition/pipeline';
import { baselineDirectory } from './baseline';
import { createObservation } from '../../../src/shared/composition/graph-observation';
describe('read-only observation', () => {
  it('is byte-identical to origin/main across every pipeline and evaluation corpus case, with and without observation', () => {
    const baseline = baselineDirectory();
    try {
      const run = (root: string, observe: boolean): { answers: Record<string, string>; events: number } =>
        JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'tests/flows-canvas/simulation/corpus-runner.ts', root, ...(observe ? ['observe'] : [])], { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));
      const original = run(baseline, false), originalObserved = run(baseline, true), current = run(process.cwd(), false), observed = run(process.cwd(), true);
      expect(Object.keys(original.answers).length).toBeGreaterThan(900);
      expect(current.answers).toEqual(original.answers);
      expect(observed.answers).toEqual(original.answers);
      expect(originalObserved.answers).toEqual(original.answers);
      expect(observed.events).toBeGreaterThan(1000);
    } finally { rmSync(baseline, { recursive: true, force: true }); }
  }, 60_000);
  it('does not visit skipped branches, change reads/costs, or let observer errors change an answer', () => {
    const reads = vi.fn(() => value('on')), observe = vi.fn();
    const operand: Parameters<typeof evaluateOperand>[0] = { type: 'choose', cases: [{ when: { type: 'state', sourceId: 'sensor', path: ['state'], in: ['on'] }, then: { type: 'literal', value: 'yes' } }], otherwise: { type: 'read', from: { type: 'source', sourceId: 'never', path: ['state'] }, as: 'string', missing: 'unavailable' } };
    const plain = structuredClone(operand);
    const visits: string[] = [];
    expect(evaluateOperand(plain, { read: reads, observe, spend: () => { visits.push('visit'); } })).toEqual(value('yes'));
    expect(reads).toHaveBeenCalledTimes(1); expect(visits).toHaveLength(3); expect(observe).toHaveBeenCalledTimes(3);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(evaluateOperand({ type: 'literal', value: 4 }, { read: reads, observe: () => { throw new Error('test'); } })).toEqual(value(4));
      expect(warn).toHaveBeenCalledWith('Studio evaluation observation failed; the answer is unchanged.');
    } finally { warn.mockRestore(); }
  });
  it('observes filter, sort and per-step values from the actual run, including partial over-budget evidence', () => {
    const inputs: PipelineInputs = {
      title: 'Observation', parameters: [], request: { type: 'none', value: { type: 'list', items: [3, 1, 2].map(value => ({ type: 'literal', value })) } },
      steps: [{ id: 'keep', op: 'filter', where: { type: 'compare', op: 'above', left: { type: 'item', path: [] }, right: { type: 'literal', value: 1 } } },
        { id: 'sort', op: 'sort', by: [{ value: { type: 'item', path: [] }, kind: 'number', direction: 'ascending' }] }],
      output: { kind: 'scalar' }, schema: { kind: 'null' },
    };
    const events: import('../../../src/shared/composition/pipeline/operands').PipelineObservation[] = [];
    const context = { clock: { now: '2026-11-18T12:00:00', utcOffsetMinutes: 0 } };
    const original = evaluatePipeline(inputs, null, context);
    expect(evaluatePipeline(inputs, null, { ...context, observe: { pipeline: event => events.push(event) } })).toEqual(original);
    expect(events.filter(event => event.kind === 'filter').map(event => event.kept)).toEqual([true, false, true]);
    expect(events.filter(event => event.kind === 'sort').map(event => [event.index, event.position])).toEqual([[1, 0], [0, 1]]);
    expect(evaluatePipeline(inputs, null, { ...context, observe: { pipeline: event => events.push(event) } }, 8))
      .toEqual(evaluatePipeline(inputs, null, context, 8));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { expect(evaluatePipeline(inputs, null, { ...context, observe: { pipeline: () => { throw new Error('test'); } } })).toEqual(original); }
    finally { warn.mockRestore(); }
  });
  it('records actual map/group values and each numeric reducer membership, not inferred drawer answers', () => {
    const context = { clock: { now: '2026-11-18T12:00:00', utcOffsetMinutes: 0 } };
    const events: import('../../../src/shared/composition/pipeline/operands').PipelineObservation[] = [];
    const inputs: PipelineInputs = {
      title: 'Iterations', parameters: [], request: { type: 'none', value: { type: 'literal', value: [{ v: 2, g: 'a' }, { v: 4, g: 'a' }, { v: 7, g: 'b' }] } },
      steps: [{ id: 'map', op: 'map', fields: { g: { type: 'item', path: ['g'] } } }, { id: 'group', op: 'group', by: { type: 'item', path: ['g'] } },
        { id: 'sum', op: 'sum', value: { type: 'item', path: ['count'] } }],
      output: { kind: 'scalar' }, schema: { kind: 'number' },
    };
    expect(evaluatePipeline(inputs, null, { ...context, observe: { pipeline: event => events.push(event) } })).toEqual(evaluatePipeline(inputs, null, context));
    expect(events.filter(event => event.kind === 'item').filter(event => event.step.id === 'map').map(event => event.value)).toEqual([{ g: 'a' }, { g: 'a' }, { g: 'b' }]);
    expect(events.filter(event => event.kind === 'item').filter(event => event.step.id === 'group').map(event => event.value)).toEqual(['a', 'a', 'b']);
    for (const op of ['sum', 'average', 'min', 'max'] as const) {
      events.length = 0;
      const reducer: PipelineInputs = { ...inputs, request: { type: 'none', value: { type: 'literal', value: [2, null, 'bad', 4] } },
        steps: [{ id: op, op, value: { type: 'item', path: [] } }] };
      expect(evaluatePipeline(reducer, null, { ...context, observe: { pipeline: event => events.push(event) } })).toEqual(evaluatePipeline(reducer, null, context));
      expect(events.filter(event => event.kind === 'item').map(event => event.included)).toEqual([true, false, false, true]);
    }
  });
  it.each(['step', 'iteration'] as const)('marks the entire report incomplete when bounded %s evidence is cut', kind => {
    const values = Array.from({ length: 60 }, (_, index) => index);
    const inputs = {
      title: 'Bounded evidence', parameters: [], request: { type: 'none', value: { type: 'literal', value: kind === 'step' ? values : [{ values }] } },
      steps: [{ id: 'map', op: 'map', fields: { value: { type: 'item', path: [] } } }],
      output: { kind: 'scalar' }, schema: { kind: 'null' },
    } satisfies PipelineInputs;
    const clock = { now: '2026-11-18T12:00:00', utcOffsetMinutes: 0 };
    const observation = createObservation({ ast: inputs, clock, root: { kind: 'flow', id: 'bounded', field: 'inputs' },
      runId: 'bounded', locate: pointer => ({ blockId: pointer }), provenance: () => 'live' });
    const plain = evaluatePipeline(inputs, null, { clock });
    const observed = evaluatePipeline(inputs, null, { clock, observe: { pipeline: event => {
      if (kind === 'step' ? event.kind === 'step' : event.kind === 'item') observation.pipeline(event);
    } } });
    expect(observed).toEqual(plain);
    expect(observation.report.truncated).toBe(true);
    if (kind === 'step') expect(observation.report.steps[0]).toMatchObject({ before: 60, after: 60, truncated: true, output: expect.any(Array) });
    else expect(observation.report.iterations).toHaveLength(1);
  });
});
