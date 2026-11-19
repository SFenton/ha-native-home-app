import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lift, lower, lowerValidated, prepareGraphRevision, readGraphValidation, validateForLowering, validateGraph } from '../../../src/shared/composition/graph';
import { corpusCases, performanceParitySnapshot } from './fixtures/performance-parity';

const baseline: { head: string; snapshots: Record<string, string> } = JSON.parse(readFileSync(new URL('./fixtures/performance-baseline.json', import.meta.url), 'utf8'));
it.each([...corpusCases.map(test => test.file), 'large-flow', 'large-flow-edited'])('preserves ordered diagnostics and every output byte from the pre-optimization baseline: %s', file => {
  expect(performanceParitySnapshot(file)).toBe(baseline.snapshots[file]);
});
it('keeps the explicit validation handoff and direct lower identical, including invalid graphs', () => {
  const graph = lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph;
  for (const revision of [graph, { ...graph, edges: [] }, { ...graph, edges: [...graph.edges, graph.edges[0]] }]) {
    expect(lowerValidated(validateForLowering(revision))).toEqual(lower(revision));
  }
});
it('rejects spread, re-wrapped and diagnostic-swapped validation handoffs at runtime', () => {
  const graph = lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph;
  const broken = { ...graph, edges: [] }, valid = validateForLowering(graph), invalid = validateForLowering(broken);
  expect(lower(broken).ok).toBe(false);
  // @ts-expect-error Spreading the token loses its private runtime state.
  expect(() => lowerValidated({ ...valid })).toThrow(TypeError);
  // @ts-expect-error A spread cannot retain the private validation state.
  expect(() => lowerValidated({ ...valid, graph: broken })).toThrow(TypeError);
  // @ts-expect-error A new wrapper is not a validated revision, even with the same fields.
  expect(() => lowerValidated({ graph: { ...graph }, diagnostics: valid.diagnostics })).toThrow(TypeError);
  // @ts-expect-error Replacing diagnostics does not create a trusted handoff.
  expect(() => lowerValidated({ ...invalid, diagnostics: [] })).toThrow(TypeError);
  expect(() => lowerValidated(Object.create(Object.getPrototypeOf(valid)))).toThrow(TypeError);
  expect(() => lowerValidated(new Proxy(valid, {}))).toThrow(TypeError);
  expect(Object.isFrozen(invalid.diagnostics)).toBe(true);
  expect(lowerValidated(invalid)).toEqual(lower(broken));
});
it('reuses an exact revision index without exposing mutable trusted maps or accepting forged indexes', () => {
  const graph = lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph;
  const index = prepareGraphRevision(graph), valid = validateForLowering(graph, index);
  expect(readGraphValidation(valid).index).toBe(index);
  expect(readGraphValidation(valid)).toBe(readGraphValidation(valid));
  expect(validateGraph(graph, { index })).toEqual(validateGraph(graph));
  expect(lower(graph, { index })).toEqual(lower(graph));
  expect(index.nodes.get(graph.nodes[0].id)).toBe(graph.nodes[0]);
  // @ts-expect-error The public map is a runtime-readonly view, not a mutable Map.
  expect(() => index.nodes.set('forged', graph.nodes[0])).toThrow(TypeError);
  const edge = graph.edges[0], incoming = index.incoming(edge.to.nodeId, edge.to.portId);
  expect(() => Array.prototype.pop.call(incoming)).toThrow(TypeError);
  expect(() => validateForLowering({ ...graph, edges: [] }, index)).toThrow(TypeError);
  expect(() => validateForLowering({ ...graph }, index)).toThrow(TypeError);
  // @ts-expect-error A spread loses the private revision identity and indexes.
  expect(() => validateForLowering(graph, { ...index })).toThrow(TypeError);
  expect(() => validateForLowering(graph, Object.create(Object.getPrototypeOf(index)))).toThrow(TypeError);
  expect(() => validateForLowering(graph, new Proxy(index, {}))).toThrow(TypeError);
});
