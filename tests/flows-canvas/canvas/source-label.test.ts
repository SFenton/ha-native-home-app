import { describe, expect, it } from 'vitest';
import { lift } from '../../../src/shared/composition/graph/lift';
import { nodeDetail, nodeName, nodeTitle } from '../../../src/workspace2/canvas/blocks';
import { indexGraph } from '../../../src/workspace2/canvas/graph-index';
import type { Json } from '../../../src/shared/types';

const sources = [{ id: 'demo-bed', name: 'Demo Bed' }] as never;
// A field read that keeps its own fallback lifts whole, as one text slot block that names its source inline.
const slotRead = { type: 'read', from: { type: 'source', sourceId: 'demo-bed', path: ['attributes', 'line'] }, as: 'string', missing: 'unavailable', fallback: 'Unavailable' };

describe('block source labels', () => {
  it('names the source a whole-lifted block reads instead of asking to choose one', () => {
    const { graph } = lift(slotRead as never);
    const index = indexGraph(graph);
    expect(graph.nodes).toHaveLength(1);
    expect(nodeDetail(graph.nodes[0], sources, graph, index)).toBe('Demo Bed · attributes · line');
    expect(nodeDetail(graph.nodes[0], [], graph, index)).toBe('demo-bed · attributes · line');
  });

  it('follows the wired source block when the source is its own block', () => {
    const { graph } = lift({ type: 'raw-state', sourceId: 'demo-bed' } as never, { kind: 'operand' });
    const index = indexGraph(graph);
    const reader = graph.nodes.find(node => node.payload.kind !== 'source-selection')!;
    expect(graph.nodes.some(node => node.payload.kind === 'source-selection')).toBe(true);
    expect(nodeDetail(reader, sources, graph, index)).toBe('Demo Bed');
  });

  it('still asks for a source when a wired source port is disconnected', () => {
    const { graph } = lift({ type: 'raw-state', sourceId: 'demo-bed' } as never, { kind: 'operand' });
    const disconnected = { ...graph, edges: [] };
    const reader = disconnected.nodes.find(node => node.payload.kind !== 'source-selection')!;
    expect(nodeDetail(reader, sources, disconnected, indexGraph(disconnected))).toBe('Choose an entity');
  });
  it.each([
    [{ type: 'raw-state', sourceId: { type: 'hole', name: 'mode' } }, 'Effective mode'],
    [{ type: 'state', sourceId: { type: 'hole', name: 'mode' }, path: ['state'], in: ['on'] }, 'Effective mode · State is on'],
    [{ type: 'read', from: { type: 'source', sourceId: { type: 'hole', name: 'mode' }, path: ['attributes', 'line'] }, as: 'string', missing: 'unavailable' }, 'Effective mode · attributes · line'],
  ] satisfies [Json, string][])('labels a source wired from a template setting: %j', (body, detail) => {
    const document = { logicLibrary: [{ id: 'demo_template', params: [{ name: 'mode', label: 'Effective mode', kind: 'source-id', sample: 'demo_mode' }], body }] };
    const { graph } = lift(body, { kind: body.type === 'state' ? 'condition' : 'operand',
      anchor: { kind: 'logic', id: 'demo_template', field: '/body' }, context: { document, pointer: '/logicLibrary/0/body' } });
    const reader = graph.nodes[0], setting = graph.nodes.find(node => node.payload.kind === 'hole')!;
    expect(nodeDetail(reader, [], graph, indexGraph(graph))).toBe(detail);
    expect(nodeTitle(setting, graph)).toBe('Effective mode');
    expect(nodeName(setting, graph)).toBe('Effective mode, Template Setting');
    const renamed = { ...setting, annotation: { label: 'Renamed input' } };
    const renamedGraph = { ...graph, nodes: graph.nodes.map(node => node.id === setting.id ? renamed : node) };
    expect(nodeTitle(renamed, renamedGraph)).toBe('Renamed input');
    expect(nodeName(renamed, renamedGraph)).toBe('Renamed input, Template Setting');
    expect(nodeDetail(reader, [], renamedGraph, indexGraph(renamedGraph))).toBe(detail.replace('Effective mode', 'Renamed input'));
    const disconnected = { ...graph, edges: [] };
    if (body.type === 'raw-state') expect(nodeDetail(reader, [], disconnected, indexGraph(disconnected))).toBe('Choose an entity');
  });
});
