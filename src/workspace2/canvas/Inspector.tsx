import { useState } from 'react';
import { Braces, X } from 'lucide-react';
import { z } from 'zod/v4';
import type { CanvasHost, GraphNode, LogicGraph } from '../../shared/composition/graph';
import { compareOperations } from '../../shared/composition/expression';
import { parseCompositionJSON } from '../../shared/composition/json';
import { copy, record } from '../../shared/composition/graph/json';
import { nodeName, portLabel } from './blocks';
import type { EditCommand } from './edit';

export default function Inspector({ graph, node, host, send, close, locate, move, remove }: {
  graph: LogicGraph; node: GraphNode; host: CanvasHost; send: (command: EditCommand) => void; close: () => void; locate: (nodeId: string) => void; move: () => void; remove: () => void;
}) {
  const [error, setError] = useState('');
  const value = copy(node.payload.value);
  const update = (patch: Record<string, import('../../shared/types').Json>) => record(value) && send({ type: 'update', nodeId: node.id, value: { ...value, ...patch } });
  const combined = record(value) && (value.type === 'all' || value.type === 'any');
  const connected = graph.edges.filter(edge => edge.to.nodeId === node.id);
  return <aside className="w2-canvas-inspector" aria-label="Block inspector">
    <div className="w2-canvas-panel-head"><div><strong>{nodeName(node)}</strong><small>Block · {node.payload.kind}</small></div><button type="button" aria-label="Close block inspector" onClick={close}><X size={16}/></button></div>
    <section aria-label="Rule summary">
      {combined ? <>
        <div className="w2-canvas-summary-map" aria-hidden><span>Check</span><span>Check</span><strong>{value.type === 'all' ? 'And' : 'Or'}</strong><span>Result</span></div>
        <p>{value.type === 'all' ? 'All connected checks must match.' : 'Any connected check can match.'} And / Or are edited on the canvas, never as condition cards.</p>
        <button type="button" className="w2-canvas-primary" onClick={() => locate(node.id)}>Edit in Canvas</button>
      </> : <p>{node.payload.kind === 'condition' ? 'One check. Connect its typed values on the canvas.' : 'A typed output can feed any compatible field.'}</p>}
      <p className="w2-canvas-caption">Result: Can't Tell - this interaction harness does not run live evaluation or devices.</p>
    </section>
    {node.payload.kind === 'source-selection' && <section><label>Entity<select value={typeof value === 'string' ? value : ''} onChange={event => send({ type: 'update', nodeId: node.id, value: event.target.value })}>
      {!host.data.sources.some(source => source.id === value) && <option value={String(value)}>{String(value)}</option>}
      {host.data.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
    </select></label></section>}
    {record(value) && value.type === 'literal' && <section><form onSubmit={event => {
      event.preventDefault();
      const field = new FormData(event.currentTarget).get('literal');
      if (typeof value.value === 'number') {
        const number = typeof field === 'string' && field.trim() ? Number(field) : NaN;
        if (!Number.isFinite(number)) { setError('Enter a finite number.'); return; }
        update({ value: number });
      } else if (typeof value.value === 'boolean') update({ value: field === 'yes' });
      else if (typeof value.value === 'string') update({ value: String(field) });
      setError('');
    }}>
      <label>Value{typeof value.value === 'boolean' ? <select name="literal" defaultValue={value.value ? 'yes' : 'no'}><option value="yes">Yes</option><option value="no">No</option></select>
        : <input name="literal" type={typeof value.value === 'number' ? 'number' : 'text'} step="any" defaultValue={typeof value.value === 'object' ? JSON.stringify(value.value) : String(value.value)}/>}</label>
      {typeof value.value !== 'object' && <button type="submit">Update value</button>}
    </form></section>}
    {record(value) && value.type === 'compare' && <section><label>Check<select value={String(value.op)} onChange={event => update({ op: event.target.value })}>{compareOperations.map(op => <option key={op} value={op}>{({ eq: 'Is', ne: 'Is not', above: 'Above', below: 'Below', before: 'Before', after: 'After' })[op]}</option>)}</select></label></section>}
    {record(value) && (value.type === 'state' || value.type === 'viewer-person') && <section><form onSubmit={event => {
      event.preventDefault(); const text = String(new FormData(event.currentTarget).get('states') ?? '');
      update({ in: text.split(',').map(state => state.trim()) });
    }}><label>State<input name="states" defaultValue={Array.isArray(value.in) ? value.in.join(', ') : ''}/></label><p className="w2-canvas-caption">Comma-separated accepted states.</p><button type="submit">Update check</button></form></section>}
    {record(value) && value.type === 'choose' && <section aria-label="Rules">
      <h3>Rules</h3><p>First matching If wins. Edit each If and Then through its canvas port. Otherwise is always retained.</p>
      <ol>{(Array.isArray(value.cases) ? value.cases : []).map((_, index) => <li key={index}>Rule {index + 1}
        <button type="button" disabled={index === 0} aria-label={`Move rule ${index + 1} up`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'up', index })}>Move up</button>
        <button type="button" disabled={!Array.isArray(value.cases) || index === value.cases.length - 1} aria-label={`Move rule ${index + 1} down`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'down', index })}>Move down</button>
        <button type="button" disabled={!Array.isArray(value.cases) || value.cases.length === 1} aria-label={`Remove rule ${index + 1}`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'remove', index })}>Remove</button></li>)}</ol>
      <button type="button" disabled={Array.isArray(value.cases) && value.cases.length >= 16} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'add', index: 0 })}>Add rule</button>
    </section>}
    {!!node.inputs.length && <section><h3>Inputs</h3><ul>{node.inputs.map(port => {
      const edge = connected.find(edge => edge.to.portId === port.id), source = graph.nodes.find(held => held.id === edge?.from.nodeId);
      return <li key={port.id}>{portLabel(port.id)}: {source ? <button type="button" onClick={() => locate(source.id)}>{nodeName(source)}</button> : 'Required, unconnected'}</li>;
    })}</ul></section>}
    {node.outputs[0]?.type.representation === 'condition' && <section className="w2-canvas-actions">
      <button type="button" onClick={() => send({ type: 'combine', nodeId: node.id, operation: 'all' })}>+ And</button>
      <button type="button" onClick={() => send({ type: 'combine', nodeId: node.id, operation: 'any' })}>+ Or</button>
    </section>}
    <section><h3>Position</h3><form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      send({ type: 'move', nodeId: node.id, x: Number(data.get('x')), y: Number(data.get('y')) });
    }}><div className="w2-canvas-actions"><label>X<input name="x" type="number" step="any" defaultValue={node.position?.x ?? 0}/></label><label>Y<input name="y" type="number" step="any" defaultValue={node.position?.y ?? 0}/></label></div><button type="submit">Set position</button></form>
      <button type="button" onClick={move}>Move with arrow keys</button>
    </section>
    {node.payload.kind !== 'opaque' && <section><details><summary><Braces size={14} aria-hidden/> Advanced block fields</summary><p>Data only. Required child expressions still use the visible ports; disconnected inputs are never silently repaired.</p>
      <form onSubmit={event => {
        event.preventDefault();
        try {
          const data = z.json().parse(parseCompositionJSON(new TextEncoder().encode(String(new FormData(event.currentTarget).get('fields')))));
          send({ type: 'update', nodeId: node.id, value: data }); setError('');
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}><label>Block fields<textarea name="fields" defaultValue={JSON.stringify(value, null, 2)} spellCheck={false}/></label><button type="submit">Update fields</button></form>
    </details></section>}
    {error && <p role="alert" className="w2-canvas-error">{error}</p>}
    <section className="w2-canvas-actions"><button type="button" onClick={() => send({ type: 'output', nodeId: node.id })}>Use as output</button><button type="button" onClick={remove}>Delete block</button></section>
  </aside>;
}
