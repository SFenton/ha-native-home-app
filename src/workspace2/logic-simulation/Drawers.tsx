import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { IterationRow } from '../../shared/composition/graph-observation';
import type { OutputAnswer } from './engine';
import { SelectMenu } from '../SelectMenu';
import type { SimulationProgram } from './program';
import { anchorKey } from './contracts';
import { describeResult, type SimulationPresentation } from './presentation';
import { formatValue, nodeValueOptions } from '../canvas/value-format';
import { resultText } from './words';
import type { SimulationClock, SimulationResult } from '../../shared/composition/graph/types';

function Iterations({ rows, label, entities }: { rows: readonly IterationRow[]; label: string; entities?: Readonly<Record<string, string>> }) {
  const scroller = useRef<HTMLDivElement>(null), [selected, setSelected] = useState<IterationRow>();
  const name = (row: IterationRow) => row.item && typeof row.item === 'object' && !Array.isArray(row.item) && typeof row.item.summary === 'string' ? row.item.summary
    : entities?.[row.identity ?? ''] ?? `Item ${row.index + 1}`;
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 88, overscan: 5, initialRect: { width: 360, height: 360 } });
  return <>
    <div ref={scroller} className="w2-sim-iterations" role="list" aria-label={label} tabIndex={0} data-total={rows.length}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map(row => {
          const item = rows[row.index];
          return <div key={row.key} role="listitem" aria-posinset={row.index + 1} aria-setsize={rows.length}
            style={{ position: 'absolute', insetInline: 0, top: row.start, height: row.size }}>
            <button type="button" className="w2-sim-iteration" onClick={() => setSelected(item)}>
              <strong>{item.index + 1}. {name(item)}</strong>
              <span>{item.reason}</span>
            </button>
          </div>;
        })}
      </div>
    </div>
    {rows.length === 0 && <p>No iterations were observed.</p>}
    {selected && <section aria-label="Iteration details">
      <h4>{name(selected)}</h4>
      <p>{selected.reason}</p><pre>{selected.item === undefined ? 'No item value was observed.' : JSON.stringify(selected.item, null, 2)}</pre>
      {selected.reads && <div><h4>Actual raw reads</h4><pre>{JSON.stringify(selected.reads, null, 2)}</pre></div>}
      {selected.tested && <div><h4>Actual tested results</h4><pre>{JSON.stringify(selected.tested, null, 2)}</pre></div>}
    </section>}
  </>;
}
export function SimulationDrawers({ outputs, program, presentation, blockNames, clock, timeZone }: { outputs: readonly OutputAnswer[]; program: SimulationProgram; presentation?: SimulationPresentation; blockNames: Readonly<Record<string, string>>; clock?: SimulationClock; timeZone?: string }) {
  const [drawer, setDrawer] = useState<'each' | 'items' | 'trace'>('each');
  const [filter, setFilter] = useState('all');
  const name = (id: string) => presentation?.blocks?.[id]?.name ?? blockNames[id] ?? 'Value';
  const stepName = (op: string) => ({ filter: 'Keep Where', sort: 'Sort', limit: 'First Few', count: 'How Many', get: 'Items', map: 'Map', group: 'Group' })[op] ?? 'Step';
  const value = (result: SimulationResult | undefined, blockId: string, observedClock = clock) => {
    const node = program.roots.flatMap(root => root.graph.nodes).find(node => node.id === blockId);
    const options = { clock: observedClock, timeZone, ...(node ? nodeValueOptions(node) : {}) };
    const exact = describeResult(result, options);
    const text = result?.kind === 'operand' && result.answer.status === 'value' ? formatValue(result.answer.value, options) : resultText(result);
    return <span title={exact} aria-description={exact}>{text}</span>;
  };
  return <section className="w2-sim-drawers" aria-label="Run evidence">
    <div className="w2-segment-pill" aria-label="Evidence drawers">
      <button type="button" aria-pressed={drawer === 'each'} onClick={() => setDrawer('each')}>Each Run</button>
      <button type="button" aria-pressed={drawer === 'items'} onClick={() => setDrawer('items')}>Items</button>
      <button type="button" aria-pressed={drawer === 'trace'} onClick={() => setDrawer('trace')}>Trace</button>
    </div>
    {drawer === 'items' && <SelectMenu label="Show items" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All items' }, { value: 'kept', label: 'Kept' }, { value: 'dropped', label: 'Dropped' }]} popupClassName="w2-simulation-surface" />}
    {outputs.map((output, index) => {
      const { trace } = output;
      const outputName = presentation?.outputs?.[anchorKey(output.output)]?.name ?? (program.roots[index].name === output.output.id ? `Output ${index + 1}` : program.roots[index].name);
      return <section key={index} aria-label={`${outputName} ${drawer} evidence`}>
        <h3>{outputName}</h3>
        {trace.truncated && <p role="note">Trace truncated. Unrecorded values and iterations are not evidence.</p>}
        {drawer === 'each' && <>
          <p>Actual output: {value(output.result, program.roots[index].graph.roots[0].nodeId)}</p>
          {[...new Set(trace.iterations.map(row => row.blockId))].map(blockId => {
            const rows = trace.iterations.filter(row => row.blockId === blockId), step = trace.steps.find(step => step.blockId === blockId);
            const actual = step ? { kind: 'operand' as const, answer: { status: 'value' as const, value: step.output } }
              : trace.events.filter(event => event.blockId === blockId).slice(-1)[0]?.output;
            return <section key={blockId} aria-label={`${step ? stepName(step.op) : outputName} reducer`}>
              <h4>{step ? stepName(step.op) : name(blockId)}</h4>
              <p>Observed rows: {rows.length}. Included: {rows.filter(row => row.included).length}. Actual result: {value(actual, blockId)}</p>
              <Iterations rows={rows} label={`${outputName}${step ? ` ${stepName(step.op)}` : ''} iterations`} entities={presentation?.entities} />
            </section>;
          })}
          {trace.iterations.length === 0 && <p>No iterations were observed.</p>}
        </>}
        {drawer === 'items' && <>
          {trace.steps.map(step => {
            const rows = trace.iterations.filter(row => row.blockId === step.blockId);
            return <section key={step.id} aria-label={`Step ${stepName(step.op)}`}>
              <h4>{stepName(step.op)}</h4>
              <p>{step.before === null ? 'One value' : `${step.before} before`} / {step.after === null ? 'One value' : `${step.after} after`}</p>
              {step.truncated && <p>Displayed values truncated; counts above are actual.</p>}
              {step.op === 'limit' && <p>First Few cut: {(step.before ?? 0) - (step.after ?? 0)}. Earlier counts are unchanged.</p>}
              {(step.op === 'filter' || step.op === 'sort') && <Iterations label={`${stepName(step.op)} items`} rows={rows.filter(row => filter === 'all' || (filter === 'kept' ? row.included : !row.included))} entities={presentation?.entities} />}
              {!['filter', 'sort', 'limit'].includes(step.op) && <details><summary>Observed input and output</summary><pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre></details>}
            </section>;
          })}
          {trace.steps.length === 0 && <p>No pipeline steps were observed.</p>}
        </>}
        {drawer === 'trace' && <ol>{trace.events.slice(0, 100).map((event, at) => <li key={at}>
          <strong>{name(event.blockId)}</strong> - {event.state} - {event.provenance === 'pin' ? 'Pinned' : event.provenance === 'live' ? 'Live' : event.provenance}
          <p>{event.output ? value(event.output, event.blockId, event.clock) : 'No value observed.'} {event.reason}</p>
          {event.item && <p>Iteration {event.item.index + 1}</p>}
          <details><summary>Inputs and frozen clock</summary><pre>{JSON.stringify({ inputs: event.inputs, clock: event.clock }, null, 2)}</pre></details>
          <small>{event.cost.used} {event.cost.limit ? `/ ${event.cost.limit} budget` : 'node visits (no document runtime cap)'}</small>
        </li>)}</ol>}
        {drawer === 'trace' && trace.events.length > 100 && <p>Showing 100 of {trace.events.length} observed events.</p>}
      </section>;
    })}
  </section>;
}
