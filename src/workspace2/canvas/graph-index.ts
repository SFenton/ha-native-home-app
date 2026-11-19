import { prepareGraphRevision, type GraphEdge, type GraphNode, type GraphRevisionIndex, type LogicGraph } from '../../shared/composition/graph';

export interface CanvasGraphIndex {
  readonly revision: GraphRevisionIndex;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly ordinals: ReadonlyMap<string, number>;
  readonly roots: ReadonlySet<string>;
  readonly incoming: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly edges: (nodeId: string, portId: string, direction: 'input' | 'output') => readonly GraphEdge[];
  readonly source: (nodeId: string, portId: string) => GraphNode | undefined;
}
export function indexGraph(graph: LogicGraph): CanvasGraphIndex {
  const revision = prepareGraphRevision(graph);
  const nodes = revision.nodes, incoming = revision.incomingNodes, outgoing = new Map<string, GraphEdge[]>();
  const outputs = new Map<string, Map<string, GraphEdge[]>>();
  const empty: readonly GraphEdge[] = [];
  const add = (byNode: Map<string, GraphEdge[]>, byPort: Map<string, Map<string, GraphEdge[]>>, endpoint: GraphEdge['to'], edge: GraphEdge) => {
    let node = byNode.get(endpoint.nodeId), ports = byPort.get(endpoint.nodeId);
    if (!node) byNode.set(endpoint.nodeId, node = []);
    if (!ports) byPort.set(endpoint.nodeId, ports = new Map());
    let port = ports.get(endpoint.portId);
    if (!port) ports.set(endpoint.portId, port = []);
    node.push(edge); port.push(edge);
  };
  for (const edge of graph.edges) {
    add(outgoing, outputs, edge.from, edge);
  }
  const edges: CanvasGraphIndex['edges'] = (nodeId, portId, direction) => direction === 'input' ? revision.incoming(nodeId, portId) : outputs.get(nodeId)?.get(portId) ?? empty;
  return {
    revision, nodes, incoming, outgoing, edges,
    ordinals: new Map(graph.nodes.map((node, index) => [node.id, index + 1])),
    roots: new Set(graph.roots.map(root => root.nodeId)),
    source: (nodeId, portId) => {
      const edge = edges(nodeId, portId, 'input')[0];
      return edge ? nodes.get(edge.from.nodeId) : undefined;
    },
  };
}
