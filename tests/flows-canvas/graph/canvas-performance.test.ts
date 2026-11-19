import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { lift, lower, validateGraph, type LogicGraph } from '../../../src/shared/composition/graph';
import * as compiler from '../../../src/shared/composition/compiler';
import { largeGraphFlow } from './fixtures/native';

it('C-meter preserves one compilation and <=50ms median validate plus lower for 2341 nodes / 32 steps', () => {
  const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
  const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
  const edited: LogicGraph = { ...graph, nodes: graph.nodes.map(node => node.id === first.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) };
  expect(graph.nodes).toHaveLength(2341);
  for (let i = 0; i < 5; i++) { validateGraph(edited); lower(edited); }
  const check = vi.spyOn(compiler, 'checkCompositionPipelineSource'), samples: number[] = [];
  try {
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      const diagnostics = validateGraph(edited), result = lower(edited);
      samples.push(performance.now() - start);
      expect(diagnostics.filter(issue => issue.severity === 'error')).toEqual([]); expect(result.ok).toBe(true);
    }
    expect(check).toHaveBeenCalledTimes(15);
  } finally { check.mockRestore(); }
  samples.sort((a, b) => a - b);
  console.info(`Canvas performance: ${graph.nodes.length} nodes, 32 steps; median ${samples[7].toFixed(2)} ms; min ${samples[0].toFixed(2)}; max ${samples[14].toFixed(2)}; 15 samples, 5 warmups.`);
  expect(samples[7]).toBeLessThanOrEqual(50);
});
