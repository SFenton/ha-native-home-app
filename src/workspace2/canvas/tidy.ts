import type { GraphNode, LogicGraph } from '../../shared/composition/graph/types';
import { nodeDetail } from './blocks';
import { indexGraph } from './graph-index';

export interface TidyMeasure {
  readonly width: number;
  readonly height: number;
  readonly ports: Readonly<Record<string, { readonly direction: 'input' | 'output'; readonly y: number }>>;
}

type Measure = (nodeId: string) => TidyMeasure | undefined;
interface Point { readonly x: number; readonly y: number }
interface Box {
  readonly width: number;
  readonly height: number;
  readonly inputs: ReadonlyMap<string, number>;
  readonly outputs: ReadonlyMap<string, number>;
}
interface Wire {
  readonly points: readonly Point[];
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
interface Vertex {
  readonly index: number;
  readonly node?: GraphNode;
  readonly height: number;
  readonly scope: readonly string[];
  readonly incoming: Link[];
  readonly outgoing: Link[];
  y: number;
}
interface Link {
  readonly from: Vertex;
  readonly to: Vertex;
  readonly output: number;
  readonly input: number;
}

const margin = 24, gap = 24, columnGap = 96, segments = 16, epsilon = 1e-7;
const median = (values: number[]) => {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

function boxesFor(graph: LogicGraph, measure?: Measure): ReadonlyMap<string, Box> {
  const index = indexGraph(graph);
  return new Map(graph.nodes.map(node => {
    const measured = measure?.(node.id), detail = nodeDetail(node, [], graph, index) ? 24 : 0;
    const ports = (direction: 'input' | 'output') => new Map(node[direction === 'input' ? 'inputs' : 'outputs'].map((port, i) => {
      const held = measured?.ports[port.id];
      return [port.id, held?.direction === direction ? held.y : 40 + detail + (i + (direction === 'output' ? node.inputs.length : 0) + .5) * 29];
    }));
    return [node.id, {
      width: measured?.width ?? 190,
      height: measured?.height ?? 64 + (node.inputs.length + node.outputs.length) * 29 + detail,
      inputs: ports('input'), outputs: ports('output'),
    }];
  }));
}

function wiresFor(graph: LogicGraph, boxes: ReadonlyMap<string, Box>): Wire[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  return graph.edges.map(edge => {
    const from = nodes.get(edge.from.nodeId), to = nodes.get(edge.to.nodeId);
    const a = boxes.get(edge.from.nodeId), b = boxes.get(edge.to.nodeId);
    const output = a?.outputs.get(edge.from.portId), input = b?.inputs.get(edge.to.portId);
    if (!from || !to || !a || !b || output === undefined || input === undefined) throw new Error(`Cannot tidy dangling wire "${edge.id}".`);
    const start = { x: (from.position?.x ?? margin) + a.width, y: (from.position?.y ?? margin) + output };
    const end = { x: to.position?.x ?? margin, y: (to.position?.y ?? margin) + input };
    const bend = Math.max(48, Math.abs(end.x - start.x) / 2);
    const points = Array.from({ length: segments + 1 }, (_, i) => {
      const t = i / segments, s = 1 - t;
      return {
        x: s * s * s * start.x + 3 * s * s * t * (start.x + bend) + 3 * s * t * t * (end.x - bend) + t * t * t * end.x,
        y: s * s * s * start.y + 3 * s * s * t * start.y + 3 * s * t * t * end.y + t * t * t * end.y,
      };
    });
    return {
      points, left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y),
    };
  }).sort((a, b) => a.left - b.left);
}

function intersects(a: Wire, b: Wire): boolean {
  if (a.points[0].x === b.points[0].x && a.points[0].y === b.points[0].y
    && a.points[segments].x === b.points[segments].x && a.points[segments].y === b.points[segments].y) return false;
  for (let i = 0; i < segments; i++) {
    const p = a.points[i], q = a.points[i + 1], dx = q.x - p.x, dy = q.y - p.y;
    for (let j = 0; j < segments; j++) {
      const r = b.points[j], s = b.points[j + 1];
      if (Math.max(p.x, q.x) < Math.min(r.x, s.x) || Math.max(r.x, s.x) < Math.min(p.x, q.x)
        || Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) continue;
      const ex = s.x - r.x, ey = s.y - r.y, determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < epsilon) continue;
      const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / determinant;
      const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / determinant;
      if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) continue;
      // Shared sockets and coincident wire portions are not crossings.
      if (i + t <= epsilon || i + t >= segments - epsilon || j + u <= epsilon || j + u >= segments - epsilon) continue;
      return true;
    }
  }
  return false;
}

function crossings(graph: LogicGraph, boxes: ReadonlyMap<string, Box>): number {
  const wires = wiresFor(graph, boxes);
  let count = 0;
  for (let i = 0; i < wires.length; i++) {
    const a = wires[i];
    for (let j = i + 1; j < wires.length && wires[j].left <= a.right; j++) {
      const b = wires[j];
      if (a.bottom < b.top || b.bottom < a.top) continue;
      if (intersects(a, b)) count++;
    }
  }
  return count;
}

/** Counts wire pairs, not individual intersections, using the canvas's cubic geometry. */
export function countCrossings(graph: LogicGraph, measure?: Measure): number {
  return crossings(graph, boxesFor(graph, measure));
}

function scopePaths(graph: LogicGraph): ReadonlyMap<string, readonly string[]> {
  const scopes = new Map(graph.scopes.map(scope => [scope.id, scope])), paths = new Map<string, readonly string[]>();
  const path = (id: string, active = new Set<string>()): readonly string[] => {
    const held = paths.get(id);
    if (held) return held;
    if (active.has(id)) throw new Error('Cannot tidy cyclic scope ancestry.');
    active.add(id);
    const parent = scopes.get(id)?.parentId;
    const result = [...(parent ? path(parent, active) : []), id];
    active.delete(id);
    paths.set(id, result);
    return result;
  };
  graph.nodes.forEach(node => path(node.scopeId));
  return paths;
}

function layered(graph: LogicGraph, boxes: ReadonlyMap<string, Box>): Vertex[][] {
  const byId = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const consumers = graph.nodes.map(() => [] as number[]), degree = graph.nodes.map(() => 0);
  for (const edge of graph.edges) {
    const from = byId.get(edge.from.nodeId)!, to = byId.get(edge.to.nodeId)!;
    consumers[from].push(to); degree[to]++;
  }
  const queue = degree.flatMap((n, i) => n ? [] : [i]);
  for (let i = 0; i < queue.length; i++) for (const to of consumers[queue[i]]) if (--degree[to] === 0) queue.push(to);
  if (queue.length !== graph.nodes.length) throw new Error('Cannot tidy a cyclic graph.');
  const distance = graph.nodes.map(() => 0);
  for (let i = queue.length - 1; i >= 0; i--) {
    const from = queue[i];
    for (const to of consumers[from]) distance[from] = Math.max(distance[from], distance[to] + 1);
  }
  // Reverse longest-path ranks put each source immediately before its earliest consumer.
  const last = Math.max(0, ...distance), scopes = scopePaths(graph);
  const layers: Vertex[][] = Array.from({ length: last + 1 }, () => []);
  const vertices: Vertex[] = graph.nodes.map((node, index) => {
    const vertex: Vertex = { node, index, height: boxes.get(node.id)!.height, scope: scopes.get(node.scopeId)!, incoming: [], outgoing: [], y: margin };
    layers[last - distance[index]].push(vertex);
    return vertex;
  });
  let nextIndex = vertices.length;
  for (const edge of graph.edges) {
    const sourceIndex = byId.get(edge.from.nodeId)!, targetIndex = byId.get(edge.to.nodeId)!;
    const source = vertices[sourceIndex], target = vertices[targetIndex];
    const common = source.scope.filter((id, i) => target.scope[i] === id);
    let from = source, output = boxes.get(edge.from.nodeId)!.outputs.get(edge.from.portId)!;
    const connect = (to: Vertex, input: number) => {
      const link = { from, to, output, input };
      from.outgoing.push(link); to.incoming.push(link);
      from = to; output = 0;
    };
    for (let rank = last - distance[sourceIndex] + 1; rank < last - distance[targetIndex]; rank++) {
      const dummy: Vertex = { index: nextIndex++, height: 0, scope: common, incoming: [], outgoing: [], y: margin };
      layers[rank].push(dummy); connect(dummy, 0);
    }
    connect(target, boxes.get(edge.to.nodeId)!.inputs.get(edge.to.portId)!);
  }
  return layers;
}

function groupedOrder(vertices: readonly Vertex[], scores: ReadonlyMap<Vertex, number>, depth = 0): Vertex[] {
  const groups = new Map<string | undefined, Vertex[]>();
  for (const vertex of vertices) {
    const key = vertex.scope[depth], group = groups.get(key);
    if (group) group.push(vertex); else groups.set(key, [vertex]);
  }
  const ordered = [...groups].map(([key, members]) => ({
    key, members, score: members.reduce((sum, vertex) => sum + scores.get(vertex)!, 0) / members.length,
    index: Math.min(...members.map(vertex => vertex.index)),
  })).sort((a, b) => a.score - b.score || a.index - b.index);
  return ordered.flatMap(group => group.key === undefined
    ? group.members.sort((a, b) => scores.get(a)! - scores.get(b)! || a.index - b.index)
    : groupedOrder(group.members, scores, depth + 1));
}

function desired(vertex: Vertex, direction?: 'input' | 'output'): number[] {
  return [
    ...(direction === 'output' ? [] : vertex.incoming.map(link => link.from.y + link.output - link.input)),
    ...(direction === 'input' ? [] : vertex.outgoing.map(link => link.to.y + link.input - link.output)),
  ];
}

function compact(layer: readonly Vertex[], direction?: 'input' | 'output'): void {
  const bases: number[] = [];
  const blocks: { start: number; end: number; total: number; weight: number }[] = [];
  let base = margin;
  for (let i = 0; i < layer.length; i++) {
    const vertex = layer[i], targets = desired(vertex, direction), weight = Math.max(1, targets.length);
    bases.push(base);
    blocks.push({ start: i, end: i, total: ((targets.length ? median(targets) : vertex.y) - base) * weight, weight });
    base += vertex.height + gap;
    // Isotonic compaction: preserve order and gaps while prioritising connected ports.
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.total / a.weight <= b.total / b.weight) break;
      blocks.splice(-2, 2, { start: a.start, end: b.end, total: a.total + b.total, weight: a.weight + b.weight });
    }
  }
  for (const block of blocks) {
    const shift = Math.max(0, block.total / block.weight);
    for (let i = block.start; i <= block.end; i++) layer[i].y = bases[i] + shift;
  }
}

function transpose(layer: Vertex[]): void {
  const cost = (a: Vertex, b: Vertex) => {
    let difference = 0;
    for (const left of a.incoming) for (const right of b.incoming) difference += Math.sign(left.from.y + left.output - right.from.y - right.output);
    for (const left of a.outgoing) for (const right of b.outgoing) difference += Math.sign(left.to.y + left.input - right.to.y - right.input);
    return difference;
  };
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i + 1 < layer.length; i++) {
      const a = layer[i], b = layer[i + 1];
      if (a.scope.length !== b.scope.length || a.scope.some((id, j) => id !== b.scope[j]) || cost(a, b) <= 0) continue;
      layer[i] = b; layer[i + 1] = a; changed = true;
    }
    if (!changed) break;
  }
}

/** Changes presentation positions only; a non-improving arrangement preserves identity. */
export function tidyCanvas(graph: LogicGraph, measure?: Measure): LogicGraph {
  if (!graph.nodes.length) return graph;
  const boxes = boxesFor(graph, measure);
  let best = graph, bestCount = crossings(graph, boxes);
  if (!bestCount) return graph;
  const layers = layered(graph, boxes), stride = Math.max(...[...boxes.values()].map(box => box.width)) + columnGap;
  for (let i = 0; i < layers.length; i++) {
    layers[i] = groupedOrder(layers[i], new Map(layers[i].map(vertex => [vertex, vertex.index])));
    let y = margin;
    for (const vertex of layers[i]) { vertex.y = y; y += vertex.height + gap; }
  }
  const retain = () => {
    const positions = new Map<string, Point>();
    layers.forEach((layer, rank) => layer.forEach(vertex => {
      if (vertex.node) positions.set(vertex.node.id, { x: margin + rank * stride, y: vertex.y });
    }));
    const candidate: LogicGraph = { ...graph, nodes: graph.nodes.map(node => ({ ...node, position: positions.get(node.id)! })) };
    const count = crossings(candidate, boxes);
    if (count < bestCount) { best = candidate; bestCount = count; }
  };
  retain();
  for (let pass = 0; pass < 8 && bestCount; pass++) {
    const downstream = pass % 2 === 1, sequence = downstream ? layers : [...layers].reverse();
    for (const layer of sequence) {
      const scores = new Map(layer.map(vertex => {
        const values = downstream ? vertex.incoming.map(link => link.from.y + link.output) : vertex.outgoing.map(link => link.to.y + link.input);
        const score = values.length ? pass % 4 < 2 ? median(values) : values.reduce((sum, n) => sum + n, 0) / values.length : vertex.y + vertex.height / 2;
        return [vertex, score] as const;
      }));
      layer.splice(0, layer.length, ...groupedOrder(layer, scores));
      compact(layer, downstream ? 'input' : 'output');
      transpose(layer);
      compact(layer, downstream ? 'input' : 'output');
    }
    for (const layer of layers) compact(layer);
    for (const layer of [...layers].reverse()) compact(layer);
    retain();
  }
  return best;
}
