import type { CanvasHost, GraphNode, GraphPort, LogicGraph } from '../../shared/composition/graph';
import { nodeDetail, portLabel } from './blocks';
import type { CanvasGraphIndex } from './graph-index';
import { listItemKind } from './PortGlyph';
import { wireKind } from './theme';

export interface PortPresentation {
  readonly port: GraphPort;
  readonly direction: 'input' | 'output';
  readonly label: string;
  readonly links: string;
  readonly kind: string;
  readonly itemKind?: string;
  readonly connected: boolean;
  readonly disconnect?: string;
}
export interface BlockPresentation {
  readonly node: GraphNode;
  readonly name: string;
  readonly detail: string;
  readonly ordinal: number | undefined;
  readonly root: boolean;
  readonly ports: readonly PortPresentation[];
}
export function presentBlocks(graph: LogicGraph, index: CanvasGraphIndex, names: ReadonlyMap<string, string>, sources: CanvasHost['data']['sources'], previous?: ReadonlyMap<string, BlockPresentation>): ReadonlyMap<string, BlockPresentation> {
  return new Map(graph.nodes.map(node => {
    const ports = (direction: 'input' | 'output'): PortPresentation[] => node[direction === 'input' ? 'inputs' : 'outputs'].map(port => {
      const edges = index.edges(node.id, port.id, direction);
      const links = edges.map(edge => {
        const endpoint = direction === 'input' ? edge.from : edge.to, other = index.nodes.get(endpoint.nodeId);
        return `${other ? names.get(other.id) : 'missing block'} ${direction === 'input' ? 'output' : portLabel(endpoint.portId, other, graph, index) + ' input'}`;
      }).join(', ');
      const source = direction === 'input' && edges[0] ? index.nodes.get(edges[0].from.nodeId)?.outputs.find(held => held.id === edges[0].from.portId) : undefined;
      const type = port.type.valueType === 'unresolved' && source ? source.type : port.type, kind = wireKind(type);
      return {
        port, direction, label: portLabel(port.id, node, graph, index), links,
        kind: type.valueType === 'unresolved' ? 'unknown' : kind,
        itemKind: kind === 'list' ? listItemKind(type.shape) : undefined,
        connected: edges.length > 0, disconnect: edges.length === 1 ? edges[0].id : undefined,
      };
    });
    const model: BlockPresentation = {
      node, name: names.get(node.id)!, detail: nodeDetail(node, sources, graph, index),
      ordinal: index.ordinals.get(node.id), root: index.roots.has(node.id), ports: [...ports('input'), ...ports('output')],
    };
    const held = previous?.get(node.id);
    const same = held?.node === node && held.name === model.name && held.detail === model.detail && held.ordinal === model.ordinal && held.root === model.root
      && held.ports.length === model.ports.length && held.ports.every((port, i) => {
        const next = model.ports[i];
        return port.port === next.port && port.direction === next.direction && port.label === next.label && port.links === next.links
          && port.kind === next.kind && port.itemKind === next.itemKind && port.connected === next.connected && port.disconnect === next.disconnect;
      });
    return [node.id, same ? held : model];
  }));
}
export function blockLayoutKey(graph: LogicGraph, models: ReadonlyMap<string, BlockPresentation>): string {
  return JSON.stringify([
    [...models.values()].map(model => [
      model.node.id, model.node.position, model.name, model.detail, model.root,
      model.ports.map(port => [port.port.id, port.direction, port.label, port.kind, port.itemKind]),
    ]),
    graph.edges.map(edge => [edge.id, edge.from, edge.to]),
  ]);
}
