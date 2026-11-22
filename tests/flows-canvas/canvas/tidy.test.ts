import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { portType, type GraphEdge, type GraphNode, type LogicGraph } from '../../../src/shared/composition/graph';
import { countCrossings, countOverlaps, tidyCanvas, type TidyMeasure } from '../../../src/workspace2/canvas/tidy';
import { groceryGraph } from './grocery-fixture';

const type = portType({ kind: 'string' });
const port = (id: string) => ({ id, label: id, type, required: true });

function graphFor(positions: readonly { x: number; y: number }[], connections: readonly (readonly [number, number])[], scoped = false): LogicGraph {
  const edges: GraphEdge[] = connections.map(([from, to], i) => ({
    id: `edge-${i}`, kind: 'operand', from: { nodeId: `node-${from}`, portId: 'value' },
    to: { nodeId: `node-${to}`, portId: `input-${i}` }, binding: `/inputs/${i}`,
  }));
  const nodes: GraphNode[] = positions.map((position, i) => ({
    id: `node-${i}`, catalogKey: 'operand.literal.text', payload: { kind: 'operand', value: { type: 'literal', value: `value-${i}` } },
    inputs: edges.filter(edge => edge.to.nodeId === `node-${i}`).map(edge => port(edge.to.portId)), outputs: [port('value')],
    scopeId: scoped && i % 3 ? i % 2 ? 'inner' : 'outer' : 'document', origins: [`/nodes/${i}`], provenance: 'authored', position,
  }));
  return {
    version: 1, nodes, edges,
    roots: nodes.filter(node => !edges.some(edge => edge.from.nodeId === node.id)).map(node => ({
      nodeId: node.id, portId: 'value', anchor: { kind: 'logic', id: node.id, field: '/body' }, destination: { kind: 'operand' },
    })),
    scopes: [{ id: 'document', kind: 'document' }, { id: 'outer', kind: 'for-each', parentId: 'document' }, { id: 'inner', kind: 'repeat', parentId: 'outer' }],
    frames: [{ id: 'frame', scopeId: 'outer', nodeIds: nodes.filter(node => node.scopeId !== 'document').map(node => node.id) }],
    original: {},
  };
}

function assertSeparated(graph: LogicGraph, measurements = new Map<string, TidyMeasure>()): void {
  for (let i = 0; i < graph.nodes.length; i++) {
    const a = graph.nodes[i], pa = a.position!, ma = measurements.get(a.id);
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const b = graph.nodes[j], pb = b.position!, mb = measurements.get(b.id);
      const overlap = pa.x < pb.x + (mb?.width ?? 190) && pb.x < pa.x + (ma?.width ?? 190)
        && pa.y < pb.y + (mb?.height ?? 64 + 29 * (b.inputs.length + b.outputs.length))
        && pb.y < pa.y + (ma?.height ?? 64 + 29 * (a.inputs.length + a.outputs.length));
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      if (pa.x === pb.x) {
        const [upper, lower, measured] = pa.y < pb.y ? [a, b, ma] : [b, a, mb];
        expect(lower.position!.y - upper.position!.y - (measured?.height ?? 64 + 29 * (upper.inputs.length + upper.outputs.length))).toBeGreaterThanOrEqual(24 - 1e-7);
      }
    }
  }
}

function assertScopes(graph: LogicGraph): void {
  const layers = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const column = layers.get(node.position!.x) ?? [];
    column.push(node); layers.set(node.position!.x, column);
  }
  for (const column of layers.values()) {
    column.sort((a, b) => a.position!.y - b.position!.y);
    for (const scope of ['document', 'outer', 'inner']) {
      const indices = column.flatMap((node, i) => node.scopeId === scope ? [i] : []);
      if (indices.length) expect(indices.at(-1)! - indices[0] + 1).toBe(indices.length);
    }
    const nested = column.flatMap((node, i) => node.scopeId !== 'document' ? [i] : []);
    if (nested.length) expect(nested.at(-1)! - nested[0] + 1).toBe(nested.length);
  }
}

function randomSource(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe('port-aware Tidy Up', () => {
  it('separates a persisted compact layout even with zero wire crossings, including measured annotation and selected chrome', () => {
    const graph = graphFor([{ x: 24, y: 24 }, { x: 24, y: 168 }, { x: 500, y: 24 }], [[0, 2], [1, 2]]);
    const measured = new Map<string, TidyMeasure>(graph.nodes.map(node => [node.id, {
      width: 190, height: node.id === 'node-0' ? 256 : 180,
      ports: Object.fromEntries([...node.inputs, ...node.outputs].map((port, i) => [port.id, {
        direction: i < node.inputs.length ? 'input' as const : 'output' as const, y: 60 + i * 29,
      }])),
    }]));
    const measure = (id: string) => measured.get(id);
    expect(countCrossings(graph, measure)).toBe(0);
    expect(countOverlaps(graph, measure)).toBe(1);
    const tidy = tidyCanvas(graph, measure);
    expect(tidy).not.toBe(graph);
    expect(countCrossings(tidy, measure)).toBe(0);
    expect(countOverlaps(tidy, measure)).toBe(0);
    assertSeparated(tidy, measured);
    expect(tidyCanvas(tidy, measure)).toBe(tidy);
  });
  it('C1 removes crossings into the grocery Flow Inputs and Rows blocks', () => {
    const graph = groceryGraph(), before = countCrossings(graph), tidy = tidyCanvas(graph), after = countCrossings(tidy);
    expect(graph.nodes).toHaveLength(10);
    expect(graph.nodes.find(node => node.payload.kind === 'flow-inputs')?.inputs.map(port => port.id)).toEqual(['/request', '/steps/0', '/steps/1', '/output']);
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(0);
    expect(tidy.nodes.find(node => node.id === graph.roots[0].nodeId)?.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    for (const node of tidy.nodes) {
      expect(node.position!.x).toBeGreaterThanOrEqual(24);
      expect(node.position!.y).toBeGreaterThanOrEqual(24);
    }
    assertSeparated(tidy);
    assertScopes(tidy);
    console.info(`C1 grocery crossings: ${before} -> ${after}`);
  });

  it('uses measured port order, widths, and tall block heights', () => {
    const graph = graphFor([{ x: 24, y: 24 }, { x: 24, y: 624 }, { x: 600, y: 24 }], [[0, 2], [1, 2]]);
    const measured = new Map<string, TidyMeasure>([
      ['node-0', { width: 310, height: 480, ports: { value: { direction: 'output', y: 450 } } }],
      ['node-1', { width: 310, height: 420, ports: { value: { direction: 'output', y: 80 } } }],
      ['node-2', {
        width: 360, height: 300, ports: {
          'input-0': { direction: 'input', y: 240 }, 'input-1': { direction: 'input', y: 55 }, value: { direction: 'output', y: 275 },
        },
      }],
    ]);
    const measure = (id: string) => measured.get(id);
    expect(countCrossings(graph, measure)).toBe(1);
    const tidy = tidyCanvas(graph, measure);
    expect(countCrossings(tidy, measure)).toBe(0);
    expect(tidy.nodes[1].position!.y).toBeLessThan(tidy.nodes[0].position!.y);
    expect(tidy.nodes[2].position!.x - tidy.nodes[0].position!.x).toBe(360 + 96);
    assertSeparated(tidy, measured);
    expect(tidyCanvas(tidy, measure)).toBe(tidy);
  });

  it('counts curved backwards wires at arbitrary positions, not just layered inversions', () => {
    const graph = graphFor([{ x: 400, y: 24 }, { x: 0, y: 24 }, { x: 0, y: 424 }, { x: 400, y: 424 }], [[0, 2], [1, 3]]);
    expect(countCrossings(graph)).toBe(1);
    const reversed = { ...graph, edges: [...graph.edges].reverse() };
    expect(countCrossings(reversed)).toBe(1);
    expect(countCrossings(tidyCanvas(graph))).toBe(0);
  });

  it.each([
    { positions: [{ x: 750, y: 150 }, { x: 600, y: 300 }, { x: 0, y: 750 }, { x: 300, y: 600 }], crossings: 1 },
    { positions: [{ x: 450, y: 0 }, { x: 0, y: 300 }, { x: 0, y: 450 }, { x: 750, y: 300 }], crossings: 0 },
  ])('measures cubic paths when their straight chords give the opposite answer ($crossings crossings)', ({ positions, crossings }) => {
    expect(countCrossings(graphFor(positions, [[0, 2], [1, 3]]))).toBe(crossings);
  });

  it('does not count shared sockets or coincident wire portions as crossings', () => {
    const graph = graphFor([{ x: 24, y: 224 }, { x: 500, y: 24 }, { x: 500, y: 424 }], [[0, 1], [0, 2], [0, 1]]);
    const coincident = { ...graph, edges: graph.edges.map((edge, i) => i === 2 ? { ...edge, to: graph.edges[0].to } : edge) };
    expect(countCrossings(coincident)).toBe(0);
    expect(tidyCanvas(coincident)).toBe(coincident);
    expect(tidyCanvas({ ...graph, nodes: [], edges: [], roots: [] }).nodes).toEqual([]);
  });

  it('keeps an already crossing-free graph unchanged rather than moving blocks gratuitously', () => {
    const graph = graphFor([{ x: 24, y: 24 }, { x: 500, y: 24 }], [[0, 1]]);
    expect(tidyCanvas(graph)).toBe(graph);
  });

  it('preserves the better arrangement and identity when remaining crossings cannot be improved', () => {
    const graph = graphFor(
      Array.from({ length: 6 }, (_, i) => ({ x: i < 3 ? 24 : 600, y: 24 + i % 3 * 240 })),
      Array.from({ length: 9 }, (_, i) => [Math.floor(i / 3), 3 + i % 3] as const),
    );
    const tidy = tidyCanvas(graph);
    expect(countCrossings(tidy)).toBeGreaterThan(0);
    expect(countCrossings(tidy)).toBeLessThanOrEqual(countCrossings(graph));
    expect(tidyCanvas(tidy)).toBe(tidy);
  });

  it('C2 is deterministic and preserves data, crossings, gaps, and nested scope groups in 200 seeded DAGs', () => {
    const random = randomSource(0x71d1);
    for (let sample = 0; sample < 200; sample++) {
      const size = 2 + Math.floor(random() * 29), connections: [number, number][] = [];
      for (let from = 0; from < size; from++) for (let to = from + 1; to < size; to++) if (random() < .13) connections.push([from, to]);
      const slots = Array.from({ length: size }, (_, i) => i);
      for (let i = size - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      const graph = graphFor(slots.map(slot => ({ x: 24 + slot % 5 * 800, y: 24 + Math.floor(slot / 5) * 1200 })), connections, sample % 2 === 0);
      const original = structuredClone(graph);
      const measurements = new Map<string, TidyMeasure>();
      for (const node of graph.nodes) if (random() < .5) {
        const height = 100 + 35 * (node.inputs.length + node.outputs.length), width = 140 + Math.floor(random() * 200);
        measurements.set(node.id, {
          width, height,
          ports: Object.fromEntries([...node.inputs, ...node.outputs].map((port, i) => [port.id, { direction: i < node.inputs.length ? 'input' : 'output', y: 60 + i * 35 }])),
        });
      }
      const measure = (id: string) => measurements.get(id), before = countCrossings(graph, measure);
      const tidy = tidyCanvas(graph, measure);
      expect(countCrossings(tidy, measure), `sample ${sample}`).toBeLessThanOrEqual(before);
      expect(tidyCanvas(graph, measure)).toEqual(tidy);
      expect(tidy.nodes.map(({ position: _, ...node }) => node)).toEqual(graph.nodes.map(({ position: _, ...node }) => node));
      expect(tidy.edges).toBe(graph.edges);
      expect(tidy.frames).toBe(graph.frames);
      expect(tidy.scopes).toBe(graph.scopes);
      expect(tidy.roots).toBe(graph.roots);
      expect(tidy.original).toBe(graph.original);
      expect(graph).toEqual(original);
      assertSeparated(tidy, measurements);
      // The untouched input is already non-overlapping but need not have grouped scopes.
      if (tidy !== graph) assertScopes(tidy);
    }
  }, 30_000);

  it('C3 tidies 250 nodes synchronously in under 200 ms', () => {
    const positions = Array.from({ length: 250 }, (_, i) => ({ x: 24 + Math.floor(i / 50) * 400, y: 24 + i * 37 % 50 * 220 }));
    const connections: [number, number][] = [];
    for (let layer = 0; layer < 4; layer++) for (let row = 0; row < 50; row++) {
      connections.push([layer * 50 + row, (layer + 1) * 50 + row], [layer * 50 + row, (layer + 1) * 50 + (row + 17) % 50]);
    }
    const graph = graphFor(positions, connections), before = countCrossings(graph);
    const start = performance.now(), tidy = tidyCanvas(graph), elapsed = performance.now() - start;
    expect(countCrossings(tidy)).toBeLessThan(before);
    expect(elapsed).toBeLessThan(200);
    assertSeparated(tidy);
    console.info(`C3 250-node layout: ${elapsed.toFixed(1)} ms`);
  });
});
