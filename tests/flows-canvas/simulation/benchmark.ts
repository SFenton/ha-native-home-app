import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { baselineDirectory } from './baseline';
import { pipelineInputsSchema, type PipelineInputs } from '../../../src/shared/composition/pipeline/schema';
import type { evaluatePipeline } from '../../../src/shared/composition/pipeline/evaluate';
import type { Json } from '../../../src/shared/types';

const response = Array.from({ length: 64 }, (_, index) => ({ entityId: `sensor.benchmark_${index}`, state: 'on', temperature: index, room: `room-${index % 8}` }));
const item = (name: string) => ({ type: 'item' as const, path: [name] });
const inputs: PipelineInputs = pipelineInputsSchema.parse({
  title: '64 entity observation benchmark', parameters: [],
  request: { type: 'entities', entityIds: response.map(row => ({ type: 'literal', value: row.entityId })), attributes: ['temperature', 'room'] },
  steps: [
    { id: 'keep-on', op: 'filter', where: { type: 'compare', op: 'eq', left: item('state'), right: { type: 'literal', value: 'on' } } },
    { id: 'map-temperature', op: 'map', fields: { room: item('room'), temperature: item('temperature') } },
    { id: 'keep-warm', op: 'filter', where: { type: 'compare', op: 'above', left: item('temperature'), right: { type: 'literal', value: 10 } } },
    { id: 'group-room', op: 'group', by: item('room') },
    { id: 'map-count', op: 'map', fields: { room: item('key'), count: item('count') } },
    { id: 'group-count', op: 'group', by: item('count') },
    { id: 'count', op: 'count' },
  ], output: { kind: 'scalar' }, schema: { kind: 'number' },
});
const baseline = baselineDirectory();
try {
  const load = async (root: string): Promise<typeof evaluatePipeline> =>
    (await import(pathToFileURL(resolve(root, 'src/shared/composition/pipeline/evaluate.ts')).href)).evaluatePipeline;
  const before = await load(baseline), after = await load(process.cwd());
  const context = { clock: { now: '2026-11-18T16:00:00', utcOffsetMinutes: 0 } };
  if (JSON.stringify(before(inputs, response, context)) !== JSON.stringify(after(inputs, response, context))) throw new Error('Benchmark answers differ.');
  const repetitions = 3000, samples = 15, timings = { before: [] as number[], after: [] as number[] };
  let visits = 0;
  const measure = (run: typeof evaluatePipeline, count: number) => {
    const start = performance.now();
    for (let index = 0; index < count; index++) visits += run(inputs, response as Json, context).visits;
    return performance.now() - start;
  };
  measure(before, 3000); measure(after, 3000);
  for (let index = 0; index < samples; index++) {
    for (const key of index % 2 ? ['after', 'before'] as const : ['before', 'after'] as const) {
      timings[key].push(measure(key === 'before' ? before : after, repetitions));
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const original = median(timings.before), current = median(timings.after);
  console.log(JSON.stringify({
    baseline: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
    node: process.version, entities: 64, steps: inputs.steps.length, samples, repetitions,
    beforeMedianMs: original, afterMedianMs: current, deltaPercent: (current / original - 1) * 100,
    beforeMs: timings.before, afterMs: timings.after, visits,
  }, null, 2));
} finally { rmSync(baseline, { recursive: true, force: true }); }
