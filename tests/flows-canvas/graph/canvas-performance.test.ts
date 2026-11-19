import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { lift, lowerValidated, prepareGraphRevision, readGraphValidation, validateForLowering, type LogicGraph } from '../../../src/shared/composition/graph';
import * as compiler from '../../../src/shared/composition/compiler';
import * as adapter from '../../../src/shared/composition/graph/compile';
import { largeGraphFlow } from './fixtures/native';
import { constructGraphRevision } from '../../../src/shared/composition/graph/validate';

it('C-meter preserves one compilation and <=50ms median validate plus lower for 2341 nodes / 32 steps', () => {
  const graph = lift(largeGraphFlow(), { kind: 'flow' }).graph;
  const constructionStart = performance.now();
  constructGraphRevision(graph);
  const construction = performance.now() - constructionStart;
  const first = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal' && node.payload.value.value === 1)!;
  const editStart = performance.now();
  const edited: LogicGraph = constructGraphRevision({ ...graph, nodes: graph.nodes.map(node => node.id === first.id ? { ...node, payload: { kind: 'operand', value: { type: 'literal', value: 2 } } } : node) });
  const editConstruction = performance.now() - editStart;
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
    for (let i = 0; i < warmups; i++) lowerValidated(validateForLowering(edited, prepareGraphRevision(edited)), { accounting: true });
    check.mockClear(); observeAdapter.mockClear();
    recording = true;
    for (let i = 0; i < measured; i++) {
      const start = performance.now();
      const index = prepareGraphRevision(edited), indexed = performance.now();
      const validated = validateForLowering(edited, index), middle = performance.now();
      const diagnostics = validated.diagnostics, result = lowerValidated(validated, { accounting: true });
      samples.push(performance.now() - start);
      indexTimes.push(indexed - start); validationTimes.push(middle - start); lowerTimes.push(performance.now() - middle);
      expect(diagnostics.filter(issue => issue.severity === 'error')).toEqual([]); expect(result.ok).toBe(true);
      expect(result.budgets[0]).toMatchObject({ accounting: 'partial', nodes: expect.any(Number) });
    }
    expect(check).toHaveBeenCalledTimes(measured);
  } finally { check.mockRestore(); observeAdapter.mockRestore(); }
  samples.sort((a, b) => a - b);
  const middle = Math.floor(measured / 2);
  process.stdout.write(`Canvas performance: ${graph.nodes.length} nodes, 32 steps; median ${samples[middle].toFixed(2)} ms; min ${samples[0].toFixed(2)}; max ${samples.at(-1)!.toFixed(2)}; ${measured} samples, ${warmups} warmups.\n`);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[middle].toFixed(2);
  process.stdout.write(`Canvas stages: validate ${median(validationTimes)} ms; lower (validated handoff) ${median(lowerTimes)} ms; adapter ${median(adapterTimes)} ms.\n`);
  process.stdout.write(`Canvas indexes: ${median(indexTimes)} ms, included in validate and total; prepared once per measured revision.\n`);
  process.stdout.write(`Canvas construction: initial ${construction.toFixed(2)} ms; edited revision ${editConstruction.toFixed(2)} ms; separate from compiler samples and included in browser mount/edit.\n`);
  expect(samples[middle]).toBeLessThanOrEqual(50);
  const validated = validateForLowering(edited), plain: number[] = [], observed: number[] = [], differences: number[] = [];
  for (let i = 0; i < 30; i++) for (const accounting of [false, true]) lowerValidated(validated, { accounting });
  for (let i = 0; i < 51; i++) {
    let unobservedTime = 0, observedTime = 0;
    for (const accounting of i % 2 ? [true, false] : [false, true]) {
      const start = performance.now();
      const result = lowerValidated(validated, { accounting });
      const elapsed = performance.now() - start;
      expect(result.ok).toBe(true);
      if (accounting) { observedTime = elapsed; observed.push(elapsed); }
      else { unobservedTime = elapsed; plain.push(elapsed); }
    }
    differences.push(observedTime - unobservedTime);
  }
  const costMedian = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(2);
  process.stdout.write(`Canvas accounting: observed lower ${costMedian(observed)} ms; unobserved lower ${costMedian(plain)} ms; paired overhead ${costMedian(differences)} ms; 51 alternating pairs after 30 paired warmups, same immutable fixture; capture and meter reduction included.\n`);
  const token = validateForLowering(edited);
  for (let i = 0; i < 10_000; i++) readGraphValidation(token);
  const start = performance.now();
  for (let i = 0; i < 1_000_000; i++) if (readGraphValidation(token).graph !== edited) throw new Error('Wrong validated revision.');
  process.stdout.write(`Canvas trust: ${(performance.now() - start).toFixed(2)} ns/call over 1000000 exact-revision WeakMap reads after 10000 warmups.\n`);
  for (let i = 0; i < 10_000; i++) constructGraphRevision(edited);
  const sealStart = performance.now();
  for (let i = 0; i < 1_000_000; i++) if (constructGraphRevision(edited) !== edited) throw new Error('Wrong constructed revision.');
  process.stdout.write(`Canvas construction check: ${(performance.now() - sealStart).toFixed(2)} ns/call over 1000000 exact-object seal reads after 10000 warmups; no traversal or refreezing.\n`);
}, 30_000);
