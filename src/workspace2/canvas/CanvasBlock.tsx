import { memo, type KeyboardEvent } from 'react';
import { Move, Trash2 } from 'lucide-react';
import type { GraphNode } from '../../shared/composition/graph';
import type { CanvasFocus } from './edit';
import type { ConnectionRequest } from './ConnectionDialog';
import type { BlockPresentation, PortPresentation } from './presentation';
import BlockIcon from './BlockIcon';
import PortGlyph from './PortGlyph';
import PortReading, { describeObservation, type BlockObservation } from './observations';
import { wireKind } from './theme';

export interface BlockActions {
  register(target: CanvasFocus): (element: HTMLButtonElement | null) => void;
  remember(target: CanvasFocus): void;
  reveal(node: GraphNode): void;
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
  model: BlockPresentation;
  observation?: BlockObservation;
  active: boolean;
  controls: boolean;
  tabStop: boolean;
  positioned: boolean;
  x: number;
  y: number;
  actions: BlockActions;
  visible: boolean;
  position: number;
  count: number;
}
export default memo(function CanvasBlock({ model, observation, active, controls, tabStop, positioned, x, y, actions, visible, position, count }: Props) {
  const { node, name, detail } = model;
  if (!visible) return <li className="w2-canvas-sr" data-node-id={node.id} data-windowed aria-posinset={position} aria-setsize={count}>
    <button type="button" ref={actions.register({ nodeId: node.id })} tabIndex={-1} aria-label={`Select ${name} ${model.ordinal}`}
      aria-description="Off-screen block. Select to bring it into view and edit its ports." onFocus={() => actions.reveal(node)} onClick={() => actions.reveal(node)}
      onKeyDown={event => actions.headerKeys(event, node)}>{name}</button>
  </li>;
  const renderPort = ({ port, direction, label, links, kind, itemKind, connected, disconnect }: PortPresentation) => {
    const target = { nodeId: node.id, portId: port.id, direction };
    const type = port.type.valueType === 'unresolved' ? 'Unresolved type' : port.type.valueType;
    const reading = observation?.[direction === 'input' ? 'inputs' : 'outputs']?.[port.id];
    return <button key={`${direction}:${port.id}`} type="button" ref={actions.register(target)} tabIndex={controls ? 0 : -1}
      className="w2-canvas-port" data-direction={direction} data-wire-type={kind === 'unknown' ? 'record' : kind} data-observation-state={reading?.state} title={`${label} · ${type}${describeObservation(reading, direction === 'output')}`}
      aria-label={`${name}, ${label} ${direction}, ${type}, ${port.type.representation}${port.type.nullable ? ', nullable' : ''}, ${links ? `connected to ${links}` : direction === 'input' && port.required ? 'required, unconnected' : 'unconnected'}${describeObservation(reading, direction === 'output')}`}
      onFocus={() => actions.remember(target)}
      onClick={() => actions.connect({ socket: { nodeId: node.id, portId: port.id }, direction })}
      onKeyDown={event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && disconnect) { event.preventDefault(); actions.disconnect(disconnect); }
      }}>
      <PortGlyph kind={kind} itemKind={itemKind}/><span>{label}</span><PortReading observation={reading} output={direction === 'output'}/>
      {direction === 'input' && port.required && !connected && <span className="w2-canvas-error" aria-hidden>!</span>}
    </button>;
  };
  return <li className="w2-canvas-node" aria-posinset={position} aria-setsize={count} data-selected={active || undefined} data-node-id={node.id} data-scenario-pinned={observation?.scenarioPinned || undefined} style={positioned ? { left: x, top: y } : undefined} onKeyDown={event => actions.nodeKeys(event, node)}>
    <button type="button" ref={actions.register({ nodeId: node.id })} className="w2-canvas-node-head" aria-label={`Select ${name} ${model.ordinal}`} aria-description={observation?.scenarioPinned ? 'Pinned by scenario.' : undefined} aria-pressed={active}
      tabIndex={tabStop ? 0 : -1} onFocus={() => actions.remember({ nodeId: node.id })} onClick={() => actions.select(node)} onKeyDown={event => actions.headerKeys(event, node)}>
      <span className="w2-canvas-block-icon" data-wire-type={wireKind(node.outputs[0].type)}><BlockIcon catalogKey={node.catalogKey}/></span><strong>{name}</strong>{model.root && <small>Output</small>}
    </button>
    {detail && <div className="w2-canvas-node-detail">{detail}</div>}
    {model.ports.map(renderPort)}
    {controls && <div className="w2-canvas-node-actions">
      <button type="button" aria-label={`Move ${name}`} onClick={() => actions.move(node)}><Move size={14}/> Move</button>
      <button type="button" aria-label={`Inspect ${name}`} onClick={actions.inspect}>Inspect</button>
      <button type="button" aria-label={`Delete ${name}`} onClick={() => actions.remove(node)}><Trash2 size={14}/></button>
    </div>}
  </li>;
});
