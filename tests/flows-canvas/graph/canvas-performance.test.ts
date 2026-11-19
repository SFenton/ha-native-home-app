import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { lift, lowerValidated, validateForLowering, type LogicGraph } from '../../../src/shared/composition/graph';
import * as compiler from '../../../src/shared/composition/compiler';
import * as adapter from '../../../src/shared/composition/graph/compile';
import { largeGraphFlow } from './fixtures/native';

it('C-meter preserves one compilation and <=50ms median validate plus lower for 2341 nodes / 32 steps', () => {
  const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
  const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
  const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.id === first.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) };
  expect(graph.nodes).toHaveLength(2341);
  for (let i = 0; i < 5; i++) lowerValidated(validateForLowering(edited));
  const check = vi.spyOn(compiler, 'checkCompositionPipelineSource'), samples: number[] = [], validationTimes: number[] = [], lowerTimes: number[] = [], adapterTimes: number[] = [];
  const compile = adapter.compileGraphValue;
  const observeAdapter = vi.spyOn(adapter, 'compileGraphValue').mockImplementation((...args) => {
    const start = performance.now();
    try { return compile(...args); }
    finally { adapterTimes.push(performance.now() - start); }
  });
  try {
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      const validated = validateForLowering(edited), middle = performance.now();
      const diagnostics = validated.diagnostics, result = lowerValidated(validated);
      samples.push(performance.now() - start);
      validationTimes.push(middle - start); lowerTimes.push(performance.now() - middle);
      expect(diagnostics.filter(issue => issue.severity === 'error')).toEqual([]); expect(result.ok).toBe(true);
    }
    expect(check).toHaveBeenCalledTimes(15);
  } finally { check.mockRestore(); observeAdapter.mockRestore(); }
  samples.sort((a, b) => a - b);
  process.stdout.write(`Canvas performance: ${graph.nodes.length} nodes, 32 steps; median ${samples[7].toFixed(2)} ms; min ${samples[0].toFixed(2)}; max ${samples[14].toFixed(2)}; 15 samples, 5 warmups.\n`);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[7].toFixed(2);
  process.stdout.write(`Canvas stages: validate ${median(validationTimes)} ms; lower (validated handoff) ${median(lowerTimes)} ms; adapter ${median(adapterTimes)} ms.\n`);
  expect(samples[7]).toBeLessThanOrEqual(50);
});
