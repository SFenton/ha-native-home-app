import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { lift, lower, lowerValidated, prepareGraphRevision, readGraphValidation, validateForLowering, validateGraph } from '../../../src/shared/composition/graph';
import { constructGraphRevision } from '../../../src/shared/composition/graph/validate';
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
  expect(() => validateForLowering(graph, Reflect.construct(Object.getPrototypeOf(index).constructor, [graph]))).toThrow(TypeError);
});
it('does not traverse or refreeze constructed data when validating again or replacing one node', () => {
  const raw = lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph;
  const serialized = JSON.stringify(raw), graph = constructGraphRevision(raw);
  expect(JSON.stringify(graph)).toBe(serialized);
  const node = graph.nodes[1], replacement = { ...node, payload: { kind: 'operand' as const, value: { type: 'literal' as const, value: 9 } } };
  const names = vi.spyOn(Object, 'getOwnPropertyNames'), freeze = vi.spyOn(Object, 'freeze');
  try {
    expect(lowerValidated(validateForLowering(graph)).ok).toBe(true);
    expect(lower(graph).ok).toBe(true);
    expect(names.mock.calls.some(([value]) => value === graph || value === node || value === graph.original)).toBe(false);
    expect(freeze.mock.calls.some(([value]) => value === graph || value === node || value === graph.original)).toBe(false);
    const changed = constructGraphRevision({ ...graph, nodes: graph.nodes.map(held => held === node ? replacement : held) });
    expect(names.mock.calls.some(([value]) => value === replacement)).toBe(true);
    expect(names.mock.calls.some(([value]) => value === node || value === graph.original)).toBe(false);
    expect(freeze.mock.calls.some(([value]) => value === replacement)).toBe(true);
    expect(freeze.mock.calls.some(([value]) => value === node || value === graph.original)).toBe(false);
    expect(Reflect.set(replacement.payload.value, 'value', 99)).toBe(false);
    expect(lower(changed)).toMatchObject({ ok: true, ast: { type: 'math', op: 'add', args: [{ type: 'literal', value: 9 }, { type: 'literal', value: 2 }] } });
  } finally { names.mockRestore(); freeze.mockRestore(); }
});
it('rejects borrowed, proxied and fabricated construction seals rather than trusting another graph', () => {
  const graph = constructGraphRevision(lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph);
  const key = Object.getOwnPropertySymbols(graph)[0];
  if (!key) throw new Error('Expected a constructed graph.');
  const seal: unknown = Object.getOwnPropertyDescriptor(graph, key)?.value;
  if (!seal || typeof seal !== 'object') throw new Error('Expected an opaque construction seal.');
  const borrowed = { ...graph, edges: [] }, proxied = { ...graph, edges: [] };
  Object.defineProperty(borrowed, key, { value: seal });
  Object.defineProperty(proxied, key, { value: new Proxy(seal, {}) });
  expect(() => validateForLowering(borrowed)).toThrow(TypeError);
  expect(() => validateForLowering(proxied)).toThrow(TypeError);
  expect(() => Reflect.construct(Object.getPrototypeOf(seal).constructor, [borrowed, { complete: true }, Symbol()])).toThrow(TypeError);
  const replaceable = { ...graph, edges: [] };
  Object.defineProperty(replaceable, key, { value: seal, configurable: true });
  expect(lower(replaceable).ok).toBe(false);
});
it('constructs already non-extensible input without leaving writable graph fields behind', () => {
  const graph = Object.seal(lift({ type: 'literal', value: 1 }, { kind: 'operand' }).graph);
  const constructed = constructGraphRevision(graph);
  expect(Reflect.set(graph, 'nodes', [])).toBe(false);
  expect(Reflect.set(constructed, 'nodes', [])).toBe(false);
  expect(lowerValidated(validateForLowering(constructed)).ok).toBe(true);
});
it('preserves resource-boundary diagnostics when deeply nested input must be frozen before validation', () => {
  const lifted = lift({ type: 'literal', value: 1 }, { kind: 'operand' }).graph;
  let original: typeof lifted.original = null;
  for (let i = 0; i < 10_000; i++) original = [original];
  const graph = { ...lifted, original }, expected = validateGraph(graph);
  expect(expected.some(issue => issue.code === 'limit_exceeded')).toBe(true);
  expect(validateForLowering(graph).diagnostics).toEqual(expected);
  const result = lower(graph);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toEqual(expected);
});
it.each(['edges', 'nodes', 'literal'] as const)('prevents %s from changing after validation, including a shallow-frozen outer graph', part => {
  const graph = Object.freeze(lift({ type: 'math', op: 'add', args: [{ type: 'literal', value: 1 }, { type: 'literal', value: 2 }] }, { kind: 'operand' }).graph);
  const validated = validateForLowering(graph), before = lowerValidated(validated);
  if (part === 'edges') {
    expect(() => Array.prototype.pop.call(graph.edges)).toThrow(TypeError);
    expect(Reflect.set(graph.edges[0].to, 'portId', 'missing')).toBe(false);
  } else if (part === 'nodes') {
    expect(() => Array.prototype.pop.call(graph.nodes)).toThrow(TypeError);
    expect(Reflect.set(graph.nodes[0], 'inputs', [])).toBe(false);
  } else {
    const literal = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal')!;
    if (literal.payload.kind !== 'operand' || literal.payload.value.type !== 'literal') throw new Error('Expected literal fixture.');
    expect(Reflect.set(literal.payload.value, 'value', 99)).toBe(false);
    expect(Reflect.set(literal.payload, 'value', { type: 'literal', value: 99 })).toBe(false);
  }
  expect(lowerValidated(validated)).toEqual(before);
  expect(lowerValidated(validated)).toEqual(lower(graph));
  const changed = { ...graph, edges: graph.edges.slice(1) };
  expect(lower(changed).ok).toBe(false);
  expect(() => validateForLowering(changed, readGraphValidation(validated).index)).toThrow(TypeError);
});
