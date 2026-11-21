import { memo, type KeyboardEvent, type ReactNode } from 'react';
import { Eye, Move, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { GraphNode } from '../../shared/composition/graph';
import type { CanvasFocus } from './edit';
import type { ConnectionRequest } from './ConnectionDialog';
import type { BlockPresentation, PortPresentation } from './presentation';
import BlockIcon from './BlockIcon';
import PortGlyph from './PortGlyph';
import PortReading, { describeObservation, type BlockObservation } from './observations';
import { wireKind } from './theme';
import Tooltip from './Tooltip';
import { formatObservation, sourceText } from './value-format';

export interface BlockActions {
  register(target: CanvasFocus): (element: HTMLButtonElement | null) => void;
  remember(target: CanvasFocus): void;
  reveal(node: GraphNode): void;
  select(node: GraphNode): void;
  peek(node: GraphNode, keyboard: boolean): void;
  annotate(node: GraphNode): void;
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
  annotationEditor?: ReactNode;
}
export default memo(function CanvasBlock({ model, observation, active, controls, tabStop, positioned, x, y, actions, visible, position, count, annotationEditor }: Props) {
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
    return <Tooltip key={`${direction}:${port.id}`} text={<><strong>{name} / {label}</strong><div>Type: {type}</div><div>{formatObservation(reading, node.catalogKey === 'output.rows' && direction === 'output')}</div>{reading && <div>{sourceText(reading)}</div>}</>}><button type="button" ref={actions.register(target)} tabIndex={controls ? 0 : -1}
      className="w2-canvas-port" data-port-id={port.id} data-direction={direction} data-wire-type={kind === 'unknown' ? 'record' : kind} data-observation-state={reading?.state}
      aria-label={`${name}, ${label} ${direction}, ${type}, ${port.type.representation}${port.type.nullable ? ', nullable' : ''}, ${links ? `connected to ${links}` : direction === 'input' && port.required ? 'required, unconnected' : 'unconnected'}${describeObservation(reading, direction === 'output', node.catalogKey === 'output.rows')}`}
      onFocus={() => actions.remember(target)}
      onClick={() => actions.connect({ socket: { nodeId: node.id, portId: port.id }, direction })}
      onKeyDown={event => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && disconnect) { event.preventDefault(); actions.disconnect(disconnect); }
      }}>
      <PortGlyph kind={kind} itemKind={itemKind}/><span>{label}</span><PortReading observation={reading} output={direction === 'output'} rows={node.catalogKey === 'output.rows' && direction === 'output'}/>
      {direction === 'input' && port.required && !connected && <span className="w2-canvas-error" aria-hidden>!</span>}
    </button></Tooltip>;
  };
  return <li className="w2-canvas-node" aria-posinset={position} aria-setsize={count} data-selected={active || undefined} data-node-id={node.id} data-scenario-pinned={observation?.scenarioPinned || undefined} style={positioned ? { left: x, top: y } : undefined} onKeyDown={event => actions.nodeKeys(event, node)}>
    <div className="w2-canvas-node-header"><button type="button" ref={actions.register({ nodeId: node.id })} className="w2-canvas-node-head" aria-label={`Select ${name} ${model.ordinal}`} aria-description={observation?.scenarioPinned ? 'Pinned by scenario.' : undefined} aria-pressed={active}
      tabIndex={tabStop ? 0 : -1} onFocus={() => actions.remember({ nodeId: node.id })} onClick={event => { actions.select(node); actions.peek(node, event.detail === 0); }} onKeyDown={event => actions.headerKeys(event, node)}>
      <span className="w2-canvas-block-icon" data-wire-type={node.outputs[0] ? wireKind(node.outputs[0].type) : 'record'}><BlockIcon catalogKey={node.catalogKey}/></span>
      <span className="w2-canvas-node-title"><strong>{node.annotation?.label ?? name}</strong>{node.annotation?.label && <small>{model.generated}</small>}{model.root && <small>Output</small>}</span>
    </button><Tooltip text={`Show data peek for ${name}`}><button type="button" className="w2-canvas-eye" tabIndex={controls ? 0 : -1} aria-label={`Show data peek for ${name}`} onClick={event => actions.peek(node, event.detail === 0)}><Eye size={16}/></button></Tooltip></div>
    {node.annotation?.note && <p className="w2-canvas-node-note w2-canvas-clamp">{node.annotation.note}</p>}
    {detail && <div className="w2-canvas-node-detail">{detail}</div>}
    {annotationEditor}
    {model.ports.map(renderPort)}
    {(active || controls) && <div className="w2-canvas-node-actions">
      <Tooltip text={`Move ${name}`}><button type="button" tabIndex={controls ? 0 : -1} aria-label={`Move ${name}`} onClick={() => actions.move(node)}><Move size={16}/></button></Tooltip>
      <Tooltip text={`Inspect ${name}`}><button type="button" tabIndex={controls ? 0 : -1} aria-label={`Inspect ${name}`} onClick={actions.inspect}><SlidersHorizontal size={16}/></button></Tooltip>
      <Tooltip text={`Rename or describe ${name}`}><button type="button" tabIndex={controls ? 0 : -1} data-annotation-origin aria-label={`Rename or describe ${name}`} onClick={() => actions.annotate(node)}><Pencil size={16}/></button></Tooltip>
      <Tooltip text={`Delete ${name}`}><button type="button" tabIndex={controls ? 0 : -1} aria-label={`Delete ${name}`} onClick={() => actions.remove(node)}><Trash2 size={16}/></button></Tooltip>
    </div>}
  </li>;
});
