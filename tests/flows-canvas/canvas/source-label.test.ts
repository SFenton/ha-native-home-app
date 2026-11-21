import { describe, expect, it } from 'vitest';
import { lift } from '../../../src/shared/composition/graph/lift';
import { nodeDetail } from '../../../src/workspace2/canvas/blocks';
import { indexGraph } from '../../../src/workspace2/canvas/graph-index';

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
});
