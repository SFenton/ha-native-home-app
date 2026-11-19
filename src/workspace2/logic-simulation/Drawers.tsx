import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { IterationRow } from '../../shared/composition/graph-observation';
import type { OutputAnswer } from './engine';
import { resultText } from './words';

function Iterations({ rows, label }: { rows: readonly IterationRow[]; label: string }) {
  const scroller = useRef<HTMLDivElement>(null), [selected, setSelected] = useState<IterationRow>();
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 88, overscan: 5, initialRect: { width: 360, height: 360 } });
  return <>
    <div ref={scroller} className="w2-sim-iterations" role="list" aria-label={label} tabIndex={0} data-total={rows.length}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map(row => {
          const item = rows[row.index];
          return <div key={row.key} role="listitem" aria-posinset={row.index + 1} aria-setsize={rows.length}
            style={{ position: 'absolute', insetInline: 0, top: row.start, height: row.size }}>
            <button type="button" className="w2-sim-iteration" onClick={() => setSelected(item)}>
              <strong>{item.index + 1}. {item.identity ?? `Item ${item.index + 1}`}</strong>
              <span>{item.reason}</span>
            </button>
          </div>;
        })}
      </div>
    </div>
    {rows.length === 0 && <p>No iterations were observed.</p>}
    {selected && <section aria-label="Iteration details">
      <h4>{selected.identity ?? `Item ${selected.index + 1}`}</h4>
      <p>{selected.reason}</p><pre>{selected.item === undefined ? 'No item value was observed.' : JSON.stringify(selected.item, null, 2)}</pre>
      {selected.reads && <div><h4>Actual raw reads</h4><pre>{JSON.stringify(selected.reads, null, 2)}</pre></div>}
      {selected.tested && <div><h4>Actual tested results</h4><pre>{JSON.stringify(selected.tested, null, 2)}</pre></div>}
    </section>}
  </>;
}
export function SimulationDrawers({ outputs }: { outputs: readonly OutputAnswer[] }) {
  const [drawer, setDrawer] = useState<'each' | 'items' | 'trace'>('each');
  const [filter, setFilter] = useState('all');
  return <section className="w2-sim-drawers" aria-label="Run evidence">
    <div className="w2-sim-actions" aria-label="Evidence drawers">
      <button type="button" aria-pressed={drawer === 'each'} onClick={() => setDrawer('each')}>Each Run</button>
      <button type="button" aria-pressed={drawer === 'items'} onClick={() => setDrawer('items')}>Items</button>
      <button type="button" aria-pressed={drawer === 'trace'} onClick={() => setDrawer('trace')}>Trace</button>
    </div>
    {drawer === 'items' && <label>Show items <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All</option><option value="kept">Kept</option><option value="dropped">Dropped</option></select></label>}
    {outputs.map((output, index) => {
      const { trace } = output;
      return <section key={index} aria-label={`${output.output.id} ${drawer} evidence`}>
        <h3>{output.output.id}</h3>
        {trace.truncated && <p role="note">Trace truncated. Unrecorded values and iterations are not evidence.</p>}
        {drawer === 'each' && <>
          <p>Actual output: {resultText(output.result)}</p>
          {[...new Set(trace.iterations.map(row => row.blockId))].map(blockId => {
            const rows = trace.iterations.filter(row => row.blockId === blockId), step = trace.steps.find(step => step.blockId === blockId);
            const actual = step ? { kind: 'operand' as const, answer: { status: 'value' as const, value: step.output } }
              : trace.events.filter(event => event.blockId === blockId).slice(-1)[0]?.output;
            return <section key={blockId} aria-label={`${step?.id ?? output.output.id} reducer`}>
              <h4>{step ? `${step.id} - ${step.op}` : blockId}</h4>
              <p>Observed rows: {rows.length}. Included: {rows.filter(row => row.included).length}. Actual result: {resultText(actual)}</p>
              <Iterations rows={rows} label={`${output.output.id}${step ? ` ${step.id}` : ''} iterations`} />
            </section>;
          })}
          {trace.iterations.length === 0 && <p>No iterations were observed.</p>}
        </>}
        {drawer === 'items' && <>
          {trace.steps.map(step => {
            const rows = trace.iterations.filter(row => row.blockId === step.blockId);
            return <section key={step.id} aria-label={`Step ${step.id}`}>
              <h4>{step.id} - {step.op}</h4>
              <p>{step.before === null ? 'One value' : `${step.before} before`} / {step.after === null ? 'One value' : `${step.after} after`}</p>
              {step.truncated && <p>Displayed values truncated; counts above are actual.</p>}
              {step.op === 'limit' && <p>First Few cut: {(step.before ?? 0) - (step.after ?? 0)}. Earlier counts are unchanged.</p>}
              {(step.op === 'filter' || step.op === 'sort') && <Iterations label={`${step.id} items`} rows={rows.filter(row => filter === 'all' || (filter === 'kept' ? row.included : !row.included))} />}
              {!['filter', 'sort', 'limit'].includes(step.op) && <details><summary>Observed input and output</summary><pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre></details>}
            </section>;
          })}
          {trace.steps.length === 0 && <p>No pipeline steps were observed.</p>}
        </>}
        {drawer === 'trace' && <ol>{trace.events.slice(0, 100).map((event, at) => <li key={at}>
          <strong>{event.blockId}</strong> {event.pointer || '/'} - {event.state} - {event.provenance}
          <p>{event.output ? resultText(event.output) : 'No value observed.'} {event.reason}</p>
          {event.item && <p>Iteration {event.item.index + 1}{event.item.identity ? ` - ${event.item.identity}` : ''}</p>}
          <details><summary>Inputs and frozen clock</summary><pre>{JSON.stringify({ inputs: event.inputs, clock: event.clock }, null, 2)}</pre></details>
          <small>{event.cost.used} {event.cost.limit ? `/ ${event.cost.limit} budget` : 'node visits (no document runtime cap)'}</small>
        </li>)}</ol>}
        {drawer === 'trace' && trace.events.length > 100 && <p>Showing 100 of {trace.events.length} observed events.</p>}
      </section>;
    })}
  </section>;
}
