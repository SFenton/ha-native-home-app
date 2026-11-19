import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lift, lower, lowerValidated, validateForLowering } from '../../../src/shared/composition/graph';
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
