import { memo, type KeyboardEvent } from 'react';
import { Move, Trash2 } from 'lucide-react';
import type { CanvasHost, GraphNode, GraphPort, LogicGraph } from '../../shared/composition/graph';
import type { CanvasFocus } from './edit';
import type { CanvasGraphIndex } from './graph-index';
import type { ConnectionRequest } from './ConnectionDialog';
import { nodeDetail, portLabel } from './blocks';
import BlockIcon from './BlockIcon';
import PortGlyph from './PortGlyph';
import PortReading, { describeObservation, type BlockObservation } from './observations';
import { wireKind } from './theme';

export interface BlockActions {
  register(target: CanvasFocus): (element: HTMLButtonElement | null) => void;
  remember(target: CanvasFocus): void;
  select(node: GraphNode): void;
  headerKeys(event: KeyboardEvent<HTMLButtonElement>, node: GraphNode): void;
  nodeKeys(event: KeyboardEvent<HTMLLIElement>, node: GraphNode): void;
  connect(request: ConnectionRequest): void;
  disconnect(edgeId: string): void;
  move(node: GraphNode): void;
  inspect(): void;
  remove(node: GraphNode): void;
}
interface Props {
  node: GraphNode;
  graph: LogicGraph;
  index: CanvasGraphIndex;
  names: ReadonlyMap<string, string>;
  sources: CanvasHost['data']['sources'];
  observation?: BlockObservation;
  active: boolean;
  controls: boolean;
  tabStop: boolean;
  positioned: boolean;
  x: number;
  y: number;
  actions: BlockActions;
}
export default memo(function CanvasBlock({ node, graph, index, names, sources, observation, active, controls, tabStop, positioned, x, y, actions }: Props) {
  const name = names.get(node.id)!, detail = nodeDetail(node, sources, graph, index);
  const renderPort = (port: GraphPort, direction: 'input' | 'output') => {
    const edges = index.edges(node.id, port.id, direction), target = { nodeId: node.id, portId: port.id, direction };
    const links = edges.map(edge => {
      const endpoint = direction === 'input' ? edge.from : edge.to, other = index.nodes.get(endpoint.nodeId);
      return `${other ? names.get(other.id) : 'missing block'} ${direction === 'input' ? 'output' : portLabel(endpoint.portId, other, graph, index) + ' input'}`;
    }).join(', ');
    const type = port.type.valueType === 'unresolved' ? 'Unresolved type' : port.type.valueType;
    const label = portLabel(port.id, node, graph, index), reading = observation?.[direction === 'input' ? 'inputs' : 'outputs']?.[port.id];
    const source = direction === 'input' && edges[0] ? index.nodes.get(edges[0].from.nodeId)?.outputs.find(held => held.id === edges[0].from.portId) : undefined;
    const socketType = port.type.valueType === 'unresolved' && source ? source.type : port.type;
    return <button key={`${direction}:${port.id}`} type="button" ref={actions.register(target)} tabIndex={controls ? 0 : -1}
      className="w2-canvas-port" data-direction={direction} data-wire-type={wireKind(socketType)} data-observation-state={reading?.state} title={`${label} · ${type}${describeObservation(reading, direction === 'output')}`}
      aria-label={`${name}, ${label} ${direction}, ${type}, ${port.type.representation}${port.type.nullable ? ', nullable' : ''}, ${links ? `connected to ${links}` : direction === 'input' && port.required ? 'required, unconnected' : 'unconnected'}${describeObservation(reading, direction === 'output')}`}
      onFocus={() => actions.remember(target)}
      onClick={() => actions.connect({ socket: { nodeId: node.id, portId: port.id }, direction })}
      onKeyDown={event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && edges.length === 1) { event.preventDefault(); actions.disconnect(edges[0].id); }
      }}>
      <PortGlyph kind={socketType.valueType === 'unresolved' ? 'unknown' : wireKind(socketType)}/><span>{label}</span><PortReading observation={reading} output={direction === 'output'}/>
      {direction === 'input' && port.required && !edges.length && <span className="w2-canvas-error" aria-hidden>!</span>}
    </button>;
  };
  return <li className="w2-canvas-node" data-selected={active || undefined} data-node-id={node.id} data-scenario-pinned={observation?.scenarioPinned || undefined} style={positioned ? { left: x, top: y } : undefined} onKeyDown={event => actions.nodeKeys(event, node)}>
    <button type="button" ref={actions.register({ nodeId: node.id })} className="w2-canvas-node-head" aria-label={`Select ${name} ${index.ordinals.get(node.id)}`} aria-description={observation?.scenarioPinned ? 'Pinned by scenario.' : undefined} aria-pressed={active}
      tabIndex={tabStop ? 0 : -1} onFocus={() => actions.remember({ nodeId: node.id })} onClick={() => actions.select(node)} onKeyDown={event => actions.headerKeys(event, node)}>
      <span className="w2-canvas-block-icon" data-wire-type={wireKind(node.outputs[0].type)}><BlockIcon catalogKey={node.catalogKey}/></span><strong>{name}</strong>{index.roots.has(node.id) && <small>Output</small>}
    </button>
    {detail && <div className="w2-canvas-node-detail">{detail}</div>}
    {node.inputs.map(input => renderPort(input, 'input'))}
    {node.outputs.map(output => renderPort(output, 'output'))}
    {controls && <div className="w2-canvas-node-actions">
      <button type="button" aria-label={`Move ${name}`} onClick={() => actions.move(node)}><Move size={14}/> Move</button>
      <button type="button" aria-label={`Inspect ${name}`} onClick={actions.inspect}>Inspect</button>
      <button type="button" aria-label={`Delete ${name}`} onClick={() => actions.remove(node)}><Trash2 size={14}/></button>
    </div>}
  </li>;
});
