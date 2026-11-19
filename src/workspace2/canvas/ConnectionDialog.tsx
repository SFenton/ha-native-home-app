import { useState } from 'react';
import type { LogicGraph } from '../../shared/composition/graph';
import { nodeName, portLabel } from './blocks';
import { canConnect, type Socket } from './edit';

export interface ConnectionRequest { readonly socket: Socket; readonly direction: 'input' | 'output' }
export default function ConnectionDialog({ graph, request, onConnect, announce }: {
  graph: LogicGraph; request: ConnectionRequest; onConnect: (from: Socket, to: Socket, replace: boolean) => void; announce: (message: string) => void;
}) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<Socket>();
  const [refusal, setRefusal] = useState('');
  const node = graph.nodes.find(node => node.id === request.socket.nodeId)!;
  const candidates = graph.nodes.flatMap(candidate => (request.direction === 'output' ? candidate.inputs : candidate.outputs).map(port => {
    const socket = { nodeId: candidate.id, portId: port.id }, from = request.direction === 'output' ? request.socket : socket, to = request.direction === 'output' ? socket : request.socket;
    const check = canConnect(graph, from, to, true);
    return { socket, from, to, check, label: `${nodeName(candidate)} ${graph.nodes.indexOf(candidate) + 1}, ${request.direction === 'output' ? portLabel(port.id) : port.label} ${request.direction === 'output' ? 'input' : 'output'}, ${port.type.valueType}` };
  })).filter(candidate => candidate.label.toLowerCase().includes(query.toLowerCase()));
  const choice = candidates.find(candidate => candidate.socket.nodeId === selected?.nodeId && candidate.socket.portId === selected.portId);
  return <>
    <p>Connect {nodeName(node)}. {request.direction === 'output' ? 'Choose an input.' : 'Connect from an output.'} Incompatible ports explain why.</p>
    <label>Find a port<input type="search" autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(undefined); }}/></label>
    <ul className="w2-canvas-candidates" aria-label="Connection candidates">{candidates.map(candidate => <li key={`${candidate.socket.nodeId}:${candidate.socket.portId}`}>
      <button type="button" aria-disabled={!candidate.check.allowed || undefined} aria-pressed={candidate === choice} onClick={() => {
        if (!candidate.check.allowed) { setRefusal(candidate.check.reason!); announce(candidate.check.reason!); return; }
        setSelected(candidate.socket); setRefusal('');
      }}><span>{candidate.label}</span><small>{candidate.check.allowed ? candidate.check.occupied ? 'Occupied - explicit replacement required' : 'Compatible' : candidate.check.reason}</small></button>
    </li>)}</ul>
    {refusal && <p role="alert">{refusal}</p>}
    {choice && <p role="status">{choice.check.occupied ? 'Replace connection? The previous wire can be restored with Undo.' : 'Preview: '}{choice.label}</p>}
    <button type="button" className="w2-canvas-primary" disabled={!choice?.check.allowed} onClick={() => choice && onConnect(choice.from, choice.to, Boolean(choice.check.occupied))}>{choice?.check.occupied ? 'Replace connection' : 'Confirm connection'}</button>
  </>;
}
