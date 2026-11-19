import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { lift, lowerValidated, prepareGraphRevision, readGraphValidation, validateForLowering, type LogicGraph } from '../../../src/shared/composition/graph';
import * as compiler from '../../../src/shared/composition/compiler';
import * as adapter from '../../../src/shared/composition/graph/compile';
import { largeGraphFlow } from './fixtures/native';

it('C-meter preserves one compilation and <=50ms median validate plus lower for 2341 nodes / 32 steps', () => {
  const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
  const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
  const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.id === first.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) };
  expect(graph.nodes).toHaveLength(2341);
  const warmups = 30, measured = 31;
  const check = vi.spyOn(compiler, 'checkCompositionPipelineSource'), samples: number[] = [], indexTimes: number[] = [], validationTimes: number[] = [], lowerTimes: number[] = [], adapterTimes: number[] = [];
  const compile = adapter.compileGraphValue;
  const observeAdapter = vi.spyOn(adapter, 'compileGraphValue').mockImplementation((...args) => {
    const start = performance.now();
    try { return compile(...args); }
    finally { if (recording) adapterTimes.push(performance.now() - start); }
  });
  let recording = false;
  try {
    for (let i = 0; i < warmups; i++) lowerValidated(validateForLowering(edited, prepareGraphRevision(edited)));
    check.mockClear(); observeAdapter.mockClear();
    recording = true;
    for (let i = 0; i < measured; i++) {
      const start = performance.now();
      const index = prepareGraphRevision(edited), indexed = performance.now();
      const validated = validateForLowering(edited, index), middle = performance.now();
      const diagnostics = validated.diagnostics, result = lowerValidated(validated);
      samples.push(performance.now() - start);
      indexTimes.push(indexed - start); validationTimes.push(middle - start); lowerTimes.push(performance.now() - middle);
      expect(diagnostics.filter(issue => issue.severity === 'error')).toEqual([]); expect(result.ok).toBe(true);
    }
    expect(check).toHaveBeenCalledTimes(measured);
  } finally { check.mockRestore(); observeAdapter.mockRestore(); }
  samples.sort((a, b) => a - b);
  const middle = Math.floor(measured / 2);
  process.stdout.write(`Canvas performance: ${graph.nodes.length} nodes, 32 steps; median ${samples[middle].toFixed(2)} ms; min ${samples[0].toFixed(2)}; max ${samples.at(-1)!.toFixed(2)}; ${measured} samples, ${warmups} warmups.\n`);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[middle].toFixed(2);
  process.stdout.write(`Canvas stages: validate ${median(validationTimes)} ms; lower (validated handoff) ${median(lowerTimes)} ms; adapter ${median(adapterTimes)} ms.\n`);
  process.stdout.write(`Canvas indexes: ${median(indexTimes)} ms, included in validate and total; prepared once per measured revision.\n`);
  expect(samples[middle]).toBeLessThanOrEqual(50);
  const token = validateForLowering(edited);
  for (let i = 0; i < 10_000; i++) readGraphValidation(token);
  const start = performance.now();
  for (let i = 0; i < 1_000_000; i++) if (readGraphValidation(token).graph !== edited) throw new Error('Wrong validated revision.');
  process.stdout.write(`Canvas trust: ${(performance.now() - start).toFixed(2)} ns/call over 1000000 exact-revision WeakMap reads after 10000 warmups.\n`);
}, 30_000);
