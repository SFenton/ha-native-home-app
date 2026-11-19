import { describe, expect, it, vi } from 'vitest';
import { blockCatalog, lift, lower, portType, type LogicGraph } from '../../../src/shared/composition/graph';
import { blockSeed, paletteAvailability } from '../../../src/workspace2/canvas/blocks';
import { canConnect, edit, initialEditState } from '../../../src/workspace2/canvas/edit';
import { anchor, number } from './fixtures';

const graph = () => lift({ type: 'math', op: 'add', args: [number(21), number(3)] }, { kind: 'operand', anchor }).graph;
describe('C-wire and atomic editing transactions', () => {
  it('refuses occupied inputs, representation/type mismatch and cycles with actionable reasons', () => {
    const value = graph(), root = value.nodes[0], left = value.nodes[1];
    expect(canConnect(value, { nodeId: left.id, portId: 'value' }, { nodeId: root.id, portId: '/args/0' })).toMatchObject({ allowed: false, reason: expect.stringContaining('already has') });
    expect(canConnect(value, { nodeId: root.id, portId: 'value' }, { nodeId: root.id, portId: '/args/0' }, true)).toMatchObject({ allowed: false, reason: expect.stringContaining('cycle') });
    const text: LogicGraph = { ...value, nodes: value.nodes.map(node => node.id === left.id ? { ...node, outputs: [{ ...node.outputs[0], type: portType({ kind: 'string' }) }] } : node) };
    expect(canConnect(text, { nodeId: left.id, portId: 'value' }, { nodeId: root.id, portId: '/args/0' }, true)).toMatchObject({ allowed: false, reason: expect.stringContaining('Types do not match') });
    const condition: LogicGraph = { ...value, nodes: value.nodes.map(node => node.id === left.id ? { ...node, outputs: [{ ...node.outputs[0], type: portType({ kind: 'boolean' }, 'condition') }] } : node) };
    expect(canConnect(condition, { nodeId: left.id, portId: 'value' }, { nodeId: root.id, portId: '/args/0' }, true).reason).toContain('Representations differ');
  });
  it('replaces a wire in one undoable transaction, restores selection/focus, and preserves the original graph', () => {
    const initial = graph(), state = initialEditState(initial), root = initial.nodes[0], right = initial.nodes[2];
    const changed = edit(state, { type: 'connect', from: { nodeId: right.id, portId: 'value' }, to: { nodeId: root.id, portId: '/args/0' }, replace: true });
    expect(changed.graph.edges.filter(edge => edge.to.portId === '/args/0')).toHaveLength(1);
    expect(changed.focus).toEqual({ nodeId: root.id, portId: '/args/0', direction: 'input' });
    expect(changed.past).toHaveLength(1);
    expect(lower(changed.graph)).toMatchObject({ ok: true, ast: { type: 'math', op: 'add', args: [number(3), number(3)] } });
    const undone = edit(changed, { type: 'undo' });
    expect(undone.graph).toBe(initial); expect(undone.focus).toEqual(state.focus);
    expect(edit(undone, { type: 'redo' }).graph).toBe(changed.graph);
    expect(initial.edges[0].from.nodeId).not.toBe(right.id);
  });
  it('adds over LAN HTTP without crypto.randomUUID, moves atomically, and restores a deleted neighbor on undo', () => {
    let state = initialEditState(graph());
    const seed = blockSeed(blockCatalog.find(entry => entry.key === 'operand.math.multiply')!)!;
    state = edit(state, { type: 'add', seed, scopeId: state.graph.scopes[0].id });
    const added = state.graph.nodes.at(-1)!;
    expect(added.id).toBeTruthy(); expect(added.inputs).toHaveLength(2);
    expect(state.graph.edges).toHaveLength(2); // No hidden default children repair the disconnected inputs.
    state = edit(state, { type: 'move', nodeId: added.id, x: 8, y: 32 });
    expect(state.graph.nodes.at(-1)?.position).toEqual({ x: 8, y: 32 });
    const deleted = edit(state, { type: 'delete', nodeId: added.id });
    expect(deleted.graph.nodes).toHaveLength(3); expect(deleted.focus?.nodeId).toBe(deleted.graph.nodes.at(-1)?.id);
    expect(edit(deleted, { type: 'undo' }).focus).toEqual({ nodeId: added.id });
  });
  it('wraps And/Or on the canvas without changing the existing check and restores the wrapper with Undo', () => {
    const original = lift({ type: 'viewer', isAdmin: true }, { kind: 'condition', anchor }).graph;
    const combined = edit(initialEditState(original), { type: 'combine', nodeId: original.nodes[0].id, operation: 'all' });
    expect(combined.graph.nodes[0]).toBe(original.nodes[0]);
    expect(combined.graph.edges[0].from.nodeId).toBe(original.nodes[0].id);
    expect(combined.graph.roots[0].nodeId).toBe(combined.graph.nodes.at(-1)?.id);
    expect(lower(combined.graph).ok).toBe(false); // The second check must be explicitly connected.
    expect(edit(combined, { type: 'undo' }).graph).toBe(original);
  });
  it('inserts the complete native Average Fixed Values recipe as one transaction, without ID collisions', () => {
    const original = graph(), seed = blockSeed(blockCatalog.find(entry => entry.key === 'recipe.average-fixed')!)!;
    const added = edit(initialEditState(original), { type: 'add', seed, scopeId: original.scopes[0].id });
    expect(added.graph.nodes).toHaveLength(original.nodes.length + 5);
    expect(added.graph.edges).toHaveLength(original.edges.length + 4);
    expect(new Set(added.graph.nodes.map(node => node.id)).size).toBe(added.graph.nodes.length);
    const average = added.graph.nodes.find(node => node.id === added.focus?.nodeId)!;
    const projected = lower({ ...added.graph, roots: [{ ...original.roots[0], nodeId: average.id }] });
    expect(projected).toMatchObject({ ok: true, ast: { type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [number(0), number(0)] }, number(2)] } });
    expect(added.past).toHaveLength(1);
    expect(edit(added, { type: 'undo' }).graph).toBe(original);
    expect(edit(edit(added, { type: 'undo' }), { type: 'redo' }).graph).toBe(added.graph);
    expect(paletteAvailability(blockCatalog.find(entry => entry.key === 'recipe.average-fixed')!, 'document', [])).toEqual({ enabled: true });
  });
  it.each(['number', 'text'])('preserves %s Choose branch wiring, output type and Otherwise across rule editing', kind => {
    const literal = (index: number) => ({ type: 'literal' as const, value: kind === 'number' ? index : `Text ${index}` });
    const cases = [true, false].map((isAdmin, index) => ({ when: { type: 'viewer' as const, isAdmin }, then: literal(index + 1) }));
    const value = { type: 'choose' as const, cases, otherwise: literal(0) };
    const original = lift(value, { kind: 'operand', anchor }).graph, nodeId = original.roots[0].nodeId;
    const reordered = edit(initialEditState(original), { type: 'rule', nodeId, action: 'up', index: 1 });
    expect(reordered.graph.nodes.find(node => node.id === nodeId)?.outputs).toEqual(original.nodes[0].outputs);
    expect(lower(reordered.graph)).toMatchObject({ ok: true, ast: { ...value, cases: [cases[1], cases[0]] } });
    const removed = edit(reordered, { type: 'rule', nodeId, action: 'remove', index: 0 });
    expect(lower(removed.graph)).toMatchObject({ ok: true, ast: { ...value, cases: [cases[0]] } });
    expect(edit(removed, { type: 'undo' }).graph).toBe(reordered.graph);
    const added = edit(removed, { type: 'rule', nodeId, action: 'add', index: 0 });
    expect(added.graph.nodes.find(node => node.id === nodeId)?.inputs).toHaveLength(5);
    expect(lower(added.graph).ok).toBe(false);
    expect(added.graph.edges).toEqual(removed.graph.edges);
  });
  it('disables unsupported scopes, pending capabilities and host-dependent blocks with reasons', () => {
    expect(paletteAvailability(blockCatalog.find(entry => entry.key === 'operand.count.value')!, 'flow-step', []).reason).toContain('Not available');
    expect(paletteAvailability(blockCatalog.find(entry => entry.key === 'step.average')!, 'flow-step', ['sh.pipeline@1']).reason).toContain('sh.flow-average@1');
    expect(paletteAvailability(blockCatalog.find(entry => entry.key === 'recipe.A-number-state')!, 'flow-step', []).reason).toContain('A-number-state');
  });
  it('allocates block and wire IDs with the LAN HTTP API and no randomUUID', () => {
    const crypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const original = graph();
      const added = edit(initialEditState(original), { type: 'add', seed: { kind: 'operand', value: number(7) }, scopeId: original.scopes[0].id });
      const connected = edit(added, { type: 'connect', from: { nodeId: added.graph.nodes.at(-1)!.id, portId: 'value' }, to: { nodeId: original.roots[0].nodeId, portId: '/args/0' }, replace: true });
      expect(connected.past).toHaveLength(2);
      expect(lower(connected.graph)).toMatchObject({ ok: true, ast: { type: 'math', op: 'add', args: [number(7), number(3)] } });
    } finally { vi.unstubAllGlobals(); }
  });
});
