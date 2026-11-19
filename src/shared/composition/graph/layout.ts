import type { GraphNode, LogicGraph } from './types';

/** Array order, never coordinates, breaks ties. Saved positions are only presentation. */
export function autoLayout(graph: LogicGraph, reset = false): LogicGraph {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const ranks = new Map<string, number>(), active = new Set<string>();
  const rank = (id: string): number => {
    if (ranks.has(id)) return ranks.get(id)!;
    if (active.has(id)) return 0;
    active.add(id);
    const parents = graph.edges.filter(edge => edge.to.nodeId === id && byId.has(edge.from.nodeId));
    const column = parents.length ? 1 + Math.max(...parents.map(edge => rank(edge.from.nodeId))) : 0;
    active.delete(id); ranks.set(id, column);
    return column;
  };
  const rows = new Map<number, number>();
  const nodes: GraphNode[] = graph.nodes.map(node => {
    const column = rank(node.id), row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return !reset && node.position ? node : { ...node, position: { x: column * 288, y: row * 160 } };
  });
  return { ...graph, nodes };
}
