import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Braces, X } from 'lucide-react';
import { z } from 'zod/v4';
import type { CanvasHost, GraphBudget, GraphNode, LogicGraph } from '../../shared/composition/graph';
import { compareOperations } from '../../shared/composition/expression';
import { parseCompositionJSON } from '../../shared/composition/json';
import { copy, record } from '../../shared/composition/graph/json';
import { blockCatalog } from '../../shared/composition/graph';
import { blockGroup, nodeName, portLabel } from './blocks';
import type { EditCommand } from './edit';
import BlockIcon from './BlockIcon';
import LimitsMeter from './LimitsMeter';
import { indexGraph, type CanvasGraphIndex } from './graph-index';
import { branchLabel, inspectorDescription } from './inspector-copy';
import { formatValue } from './value-format';

export default function Inspector({ graph, index: providedIndex, node, host, send, close, locate, move, remove, budgets, onLocate, outputNames, annotationEditor }: {
  graph: LogicGraph; index?: CanvasGraphIndex; node: GraphNode; host: CanvasHost; send: (command: EditCommand) => void; close: () => void; locate: (nodeId: string) => void; move: () => void; remove: () => void;
  budgets: readonly GraphBudget[]; onLocate: (pointer: string) => void; outputNames?: readonly string[];
  annotationEditor?: ReactNode;
}) {
  const [error, setError] = useState('');
  const [rawFields, setRawFields] = useState(false);
  const index = useMemo(() => providedIndex ?? indexGraph(graph), [graph, providedIndex]);
  const value = copy(node.payload.value);
  const update = (patch: Record<string, import('../../shared/types').Json>) => record(value) && send({ type: 'update', nodeId: node.id, value: { ...value, ...patch } });
  const combined = record(value) && (value.type === 'all' || value.type === 'any');
  const name = nodeName(node, graph, index);
  const branches = node.inputs.map(input => {
    const source = index.source(node.id, input.id);
    return { input, source, label: source ? branchLabel(source, graph, index, host.data.sources) : `Unconnected ${portLabel(input.id, node, graph, index)}` };
  });
  const destination = graph.roots.findIndex(root => root.nodeId === node.id);
  const entry = blockCatalog.find(entry => entry.key === node.catalogKey);
  return <aside className="w2-canvas-inspector" aria-label="Block inspector">
    <div className="w2-canvas-panel-head"><span className="w2-canvas-block-icon"><BlockIcon catalogKey={node.catalogKey}/></span><div><strong>{name}</strong><small>Block · {entry ? blockGroup(entry) : 'Preserved data'}</small></div><button type="button" aria-label="Close block inspector" onClick={close}><X size={16}/></button></div>
    <section>{annotationEditor}</section>
    <section aria-label="Rule summary">
      {combined ? <>
        <figure className="w2-canvas-summary-map" aria-label={`${name}, ${branches.length} checks`} style={{ '--branches': Math.max(1, branches.length) } as CSSProperties}>
          {branches.map(({ input, source, label }, position) => <span className="w2-canvas-summary-branch" key={input.id} style={{ gridRow: position + 1 }}>
            {source && <BlockIcon catalogKey={source.catalogKey} size={14}/>} {label}
          </span>)}
          <div className="w2-canvas-summary-join" style={{ gridRow: `1 / span ${Math.max(1, branches.length)}` }}><strong>{value.type === 'all' ? 'And' : 'Or'}</strong></div>
          <span className="w2-canvas-summary-output" style={{ gridRow: `1 / span ${Math.max(1, branches.length)}` }}>{destination >= 0 && outputNames?.[destination] || portLabel(node.outputs[0]?.id ?? 'value', node, graph, index)}</span>
        </figure>
        <p>{inspectorDescription(node, graph, index, host.data.sources)}</p>
        <button type="button" className="w2-canvas-primary" onClick={() => locate(node.id)}>Edit in Canvas</button>
      </> : <p>{inspectorDescription(node, graph, index, host.data.sources)}</p>}
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
        : typeof value.value === 'object' ? <span>{formatValue(value.value)}</span> : <input name="literal" type={typeof value.value === 'number' ? 'number' : 'text'} step="any" defaultValue={String(value.value)}/>}</label>
      {typeof value.value !== 'object' && <button type="submit">Update value</button>}
    </form></section>}
    {record(value) && value.type === 'compare' && <section><label>Check<select value={String(value.op)} onChange={event => update({ op: event.target.value })}>{compareOperations.map(op => <option key={op} value={op}>{({ eq: 'Is', ne: 'Is not', above: 'Above', below: 'Below', before: 'Before', after: 'After' })[op]}</option>)}</select></label></section>}
    {record(value) && (value.type === 'state' || value.type === 'viewer-person') && <section><form onSubmit={event => {
      event.preventDefault(); const text = String(new FormData(event.currentTarget).get('states') ?? '');
      update({ in: text.split(',').map(state => state.trim()) });
    }}><label>State<input name="states" defaultValue={Array.isArray(value.in) ? value.in.join(', ') : ''}/></label><p className="w2-canvas-caption">Comma-separated accepted states.</p><button type="submit">Update check</button></form></section>}
    {record(value) && value.type === 'choose' && <section aria-label="Rules">
      <h3>Rules</h3><p>Edit the connected If and Then blocks on canvas; reordering a rule preserves both connections.</p>
      <ol>{(Array.isArray(value.cases) ? value.cases : []).map((_, index) => <li key={index}>{branches.find(branch => branch.input.id === `/cases/${index}/when`)?.label ?? 'Unconnected If'} → {branches.find(branch => branch.input.id === `/cases/${index}/then`)?.label ?? 'Unconnected Then'}
        <button type="button" disabled={index === 0} aria-label={`Move rule ${index + 1} up`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'up', index })}>Move up</button>
        <button type="button" disabled={!Array.isArray(value.cases) || index === value.cases.length - 1} aria-label={`Move rule ${index + 1} down`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'down', index })}>Move down</button>
        <button type="button" disabled={!Array.isArray(value.cases) || value.cases.length === 1} aria-label={`Remove rule ${index + 1}`} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'remove', index })}>Remove</button></li>)}</ol>
      <button type="button" disabled={Array.isArray(value.cases) && value.cases.length >= 16} onClick={() => send({ type: 'rule', nodeId: node.id, action: 'add', index: 0 })}>Add rule</button>
    </section>}
    {!!branches.length && <section><h3>Inputs</h3><ul>{branches.map(({ input, source, label }) => <li key={input.id}>{portLabel(input.id, node, graph, index)}: {source ? <button type="button" onClick={() => locate(source.id)}>{label}</button> : input.required ? 'Required, unconnected' : 'Optional, unconnected'}</li>)}</ul></section>}
    {node.outputs[0]?.type.representation === 'condition' && <section className="w2-canvas-actions">
      <button type="button" onClick={() => send({ type: 'combine', nodeId: node.id, operation: 'all' })}>+ And</button>
      <button type="button" onClick={() => send({ type: 'combine', nodeId: node.id, operation: 'any' })}>+ Or</button>
    </section>}
    <LimitsMeter budgets={budgets} onLocate={onLocate} outputNames={outputNames}/>
    <section><details><summary>Position</summary><form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      send({ type: 'move', nodeId: node.id, x: Number(data.get('x')), y: Number(data.get('y')) });
    }}><div className="w2-canvas-actions"><label>X<input name="x" type="number" step="any" defaultValue={node.position?.x ?? 0}/></label><label>Y<input name="y" type="number" step="any" defaultValue={node.position?.y ?? 0}/></label></div><button type="submit">Set position</button></form>
      <button type="button" onClick={move}>Move with arrow keys</button>
    </details></section>
    {node.payload.kind !== 'opaque' && <section><details onToggle={event => setRawFields(event.currentTarget.open)}><summary><Braces size={14} aria-hidden/> Advanced block fields · Raw JSON {rawFields ? 'On' : 'Off'}</summary><p>Edit {name} settings as JSON.{node.inputs.length ? ` Its ${node.inputs.length} child values remain connected through the canvas ports.` : ' This block has no child connections.'}</p>
      {rawFields && <form onSubmit={event => {
        event.preventDefault();
        try {
          const data = z.json().parse(parseCompositionJSON(new TextEncoder().encode(String(new FormData(event.currentTarget).get('fields')))));
          send({ type: 'update', nodeId: node.id, value: data }); setError('');
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}><label>Block fields<textarea name="fields" defaultValue={JSON.stringify(value, null, 2)} spellCheck={false}/></label><button type="submit">Update fields</button></form>}
    </details></section>}
    {error && <p role="alert" className="w2-canvas-error">{error}</p>}
    <section className="w2-canvas-actions"><button type="button" onClick={() => send({ type: 'output', nodeId: node.id })}>Use as output</button><button type="button" onClick={remove}>Delete block</button></section>
  </aside>;
}
