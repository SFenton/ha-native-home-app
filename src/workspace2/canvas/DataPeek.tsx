import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { GraphJSON, GraphNode } from '../../shared/composition/graph';
import type { DerivedTheme } from '../theme';
import type { BlockPresentation } from './presentation';
import type { BlockObservation, PortObservation } from './observations';
import { formatObservation, formatValue, primaryText, sourceText } from './value-format';
import CanvasDialog from './CanvasDialog';
import { record } from '../../shared/composition/graph/json';
import { itemContextText } from '../logic-simulation/per-item';

function Source({ observation }: { observation?: PortObservation }) {
  return observation?.source && <small className="w2-canvas-source" data-source={observation.source}>{sourceText(observation)}</small>;
}
function ValueView({ observation, rows = false, full = false, output = true }: { observation?: PortObservation; rows?: boolean; full?: boolean; output?: boolean }) {
  if (!observation || observation.state !== 'known') return <p className="w2-canvas-value" data-state={observation?.state}>{formatObservation(observation, rows, full, output)}</p>;
  const value = observation.value;
  if (Array.isArray(value)) {
    const shown = full ? value : value.slice(0, 3), unit = rows ? 'rows' : 'items';
    return <><p>{value.length} {unit}</p><ol className="w2-canvas-sample">{shown.map((item, index) => <li key={index}><strong>{full ? formatValue(item, { full }) : primaryText(item)}</strong>
      {item !== null && typeof item === 'object' && !Array.isArray(item) && (item.subtitle ?? item.description) !== undefined && <small>{formatValue(item.subtitle ?? item.description)}</small>}
    </li>)}</ol>{shown.length < value.length && <p>+{value.length - shown.length} more {unit}</p>}</>;
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value), shown = full ? fields : fields.slice(0, 4);
    return <><dl className="w2-canvas-value-fields">{shown.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{formatValue(item, { depth: 1, full })}</dd></div>)}</dl>{shown.length < fields.length && <p>+{fields.length - shown.length} more fields</p>}</>;
  }
  return <p className={`w2-canvas-value${full ? '' : ' w2-canvas-clamp'}`}>{typeof value === 'string' && value === 'unavailable' && <small>Text: </small>}{formatValue(value)}</p>;
}
function ObservedPorts({ model, observation, direction, full = false }: { model: BlockPresentation; observation?: BlockObservation; direction: 'input' | 'output'; full?: boolean }) {
  const ports = model.ports.filter(port => port.direction === direction);
  const singleResult = direction === 'output' && ports.length === 1 && ports[0].label === 'Result';
  return <section><h3>{direction === 'input' ? 'Inputs' : 'Result'}</h3>
    {!ports.length && <p>No {direction} ports</p>}
    {ports.map(({ port, label }) => {
      const reading = observation?.[direction === 'input' ? 'inputs' : 'outputs']?.[port.id];
      return <div key={port.id} className="w2-canvas-observed-port" data-state={reading?.state}>
        <div className="w2-canvas-value-heading">{!singleResult && <strong>{label}</strong>}<Source observation={reading}/>{direction === 'output' && reading?.state === 'known' && reading.kept && <small>Kept</small>}</div>
        {itemContextText(reading?.item) && <small>{itemContextText(reading?.item)}</small>}
        {direction === 'input' && model.node.catalogKey === 'output.rows' && <small>Observed item</small>}
        <ValueView observation={reading} rows={direction === 'output' && model.node.catalogKey === 'output.rows'} full={full} output={direction === 'output'}/>
      </div>;
    })}
  </section>;
}
const rowRecord = (value: GraphJSON): Readonly<Record<string, GraphJSON>> | undefined => record(value) ? value : undefined;
const columnLabel = (column: string) => ({ id: 'Row Id', title: 'Row Title', subtitle: 'Subtitle' })[column] ?? column;

function Comparison({ model, captured, theme, close, returnFocus }: { model: BlockPresentation; captured?: BlockObservation; theme: DerivedTheme; close: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const [query, setQuery] = useState(''), [column, setColumn] = useState('all'), [raw, setRaw] = useState(false);
  const result = captured?.outputs?.[model.node.outputs[0]?.id], value = result && (result.state === 'known' || result.kept) ? result.value : undefined;
  const items = Array.isArray(value) ? value : undefined;
  const columns = items ? [...new Set(items.flatMap(item => Object.keys(rowRecord(item) ?? {})))] : [];
  const matches = items?.filter(item => (column === 'all' ? formatValue(item, { full: true }) : formatValue(rowRecord(item)?.[column] ?? null, { full: true })).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <CanvasDialog title={`Compare ${model.name}`} theme={theme} wide focusHeading close={close} returnFocus={returnFocus}>
    <p>Captured copy of host observations. Read-only; not a pin or a shared execution trace.</p>
    {items && <div className="w2-canvas-compare-toolbar"><label>Search result rows<input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label>Filter column<select value={column} onChange={event => setColumn(event.target.value)}><option value="all">All columns</option>{columns.map(key => <option key={key} value={key}>{columnLabel(key)}</option>)}</select></label>
      <p role="status" aria-live="polite">{matches?.length} of {items.length} matching rows</p></div>}
    <div className="w2-canvas-compare-columns"><ObservedPorts model={model} observation={captured} direction="input" full/>
      <section><h3>Result <Source observation={result}/></h3>
        {itemContextText(result?.item) && <p>{itemContextText(result?.item)}</p>}
        {result?.kept && <p>{result.state !== 'known' && `${formatObservation({ state: result.state, source: result.source })} · `}Kept</p>}
        {items ? <><p>Host supplied {items.length} rows; total unavailable.</p>{!items.length ? <p>0 rows</p> : !matches?.length ? <p>No matching rows</p> : <div className="w2-canvas-table-scroll"><table>
          <thead><tr>{(columns.length ? columns : ['Value']).map(key => <th key={key} scope="col">{columnLabel(key)}</th>)}</tr></thead>
          <tbody>{matches.map((item, i) => {
            const row = rowRecord(item);
            // A non-record item in a mixed list keeps its own observed value across the row instead of per-column blanks.
            return <tr key={i}>{columns.length && row ? columns.map(key => <td key={key}>{row[key] === undefined ? <span aria-label="No field">—</span> : formatValue(row[key], { full: true })}</td>)
              : <td colSpan={Math.max(1, columns.length)}>{formatValue(item, { full: true })}</td>}</tr>;
          })}</tbody>
        </table></div>}</> : <ValueView observation={result} full/>}
      </section></div>
    <details className="w2-canvas-raw" onToggle={event => setRaw(event.currentTarget.open)}><summary>Raw JSON · {raw ? 'On' : 'Off'}</summary>
      {raw && <><h3>Input values</h3><pre>{JSON.stringify(Object.fromEntries(model.node.inputs.flatMap(port => {
        const reading = captured?.inputs?.[port.id];
        return reading && (reading.state === 'known' || reading.kept) ? [[port.label, reading.value]] : [];
      })), null, 2)}</pre><h3>Result value</h3><pre>{value === undefined ? formatObservation(result) : JSON.stringify(value, null, 2)}</pre></>}
    </details>
    <footer className="w2-canvas-caption">Read-only captured values. No configuration changes.</footer>
  </CanvasDialog>;
}
export default function DataPeek({ model, observation, theme, phone, anchor, boundary, close, keyboard }: {
  model: BlockPresentation; observation?: BlockObservation; theme: DerivedTheme; phone: boolean; anchor: HTMLElement | null; boundary: RefObject<HTMLElement | null>; close: () => void; keyboard: boolean;
}) {
  const id = useId(), popup = useRef<HTMLDivElement>(null), compareButton = useRef<HTMLButtonElement>(null), origin = useRef(anchor);
  const focused = useRef(false);
  const [captured, setCaptured] = useState<{ observation?: BlockObservation; node: GraphNode }>(), [position, setPosition] = useState<CSSProperties>({});
  useEffect(() => {
    if (!captured) return;
    // A capture is closed when any reading it holds is withdrawn, not only when the whole block observation disappears.
    const withdrawn = !observation || (['inputs', 'outputs'] as const).some(direction =>
      Object.keys(captured.observation?.[direction] ?? {}).some(port => !observation[direction]?.[port]));
    if (withdrawn || captured.node !== model.node) setCaptured(undefined);
  }, [observation, captured, model.node]);
  useLayoutEffect(() => {
    if (phone || captured) return;
    const update = () => {
      const bounds = boundary.current?.getBoundingClientRect(), card = anchor?.closest('.w2-canvas-node')?.getBoundingClientRect(), rect = popup.current?.getBoundingClientRect();
      if (!bounds || !card) return;
      const width = Math.min(360, bounds.width - 24), height = Math.min(rect?.height || 400, bounds.height - 24);
      let left = card.right + 10;
      if (left + width > bounds.right - 12) left = card.left - width - 10;
      let top = card.top, maxHeight = bounds.height - 24;
      if (left < bounds.left + 12) {
        left = Math.max(bounds.left + 12, Math.min(card.left, bounds.right - width - 12));
        const below = bounds.bottom - card.bottom - 22, above = card.top - bounds.top - 22;
        const useBelow = below >= above;
        maxHeight = Math.max(100, useBelow ? below : above);
        top = useBelow ? card.bottom + 10 : card.top - Math.min(height, maxHeight) - 10;
      }
      // Clamp within the visible boundary, then convert to the popup's own containing block, which may be scrolled.
      const x = bounds.left + Math.max(12, left - bounds.left), y = bounds.top + Math.max(12, Math.min(top - bounds.top, bounds.height - Math.min(height, maxHeight) - 12));
      const container = popup.current?.offsetParent instanceof HTMLElement ? popup.current.offsetParent : boundary.current;
      const frame = container?.getBoundingClientRect() ?? bounds;
      const offsetX = (container?.scrollLeft ?? 0) - frame.left - (container?.clientLeft ?? 0), offsetY = (container?.scrollTop ?? 0) - frame.top - (container?.clientTop ?? 0);
      setPosition({ left: x + offsetX, top: y + offsetY, width, maxHeight: Math.max(100, maxHeight) });
    };
    update();
    const observer = new ResizeObserver(update);
    if (boundary.current) observer.observe(boundary.current);
    if (anchor) observer.observe(anchor);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener('resize', update); document.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [anchor, boundary, phone, captured, model]);
  const dismiss = (restore: boolean) => { close(); if (restore) origin.current?.focus(); };
  useEffect(() => {
    if (phone || captured) return;
    if (keyboard && !focused.current) { popup.current?.querySelector<HTMLElement>('h2')?.focus(); focused.current = true; }
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor?.closest('.w2-canvas-node-header')?.contains(event.target as Node)) dismiss(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [phone, captured, anchor, keyboard, close]);
  if (captured) return <Comparison model={model} captured={captured.observation} theme={theme} returnFocus={phone ? origin : compareButton} close={() => {
    setCaptured(undefined);
    if (!phone) requestAnimationFrame(() => compareButton.current?.focus());
  }}/>;
  const content = <><div className="w2-canvas-peek-body"><ObservedPorts model={model} observation={observation} direction="input"/><ObservedPorts model={model} observation={observation} direction="output"/></div>
    <footer className="w2-canvas-peek-footer"><button ref={compareButton} type="button" onClick={() => setCaptured({ observation: observation ? structuredClone(observation) : undefined, node: model.node })}>Compare in full</button></footer></>;
  if (phone) return <CanvasDialog title={`Data peek: ${model.name}`} theme={theme} sheet focusHeading close={() => dismiss(true)} returnFocus={origin}>{content}</CanvasDialog>;
  return <div ref={popup} className="w2-canvas-peek" role="dialog" aria-modal="false" aria-labelledby={id} style={position}>
    <div className="w2-canvas-panel-head"><h2 id={id} tabIndex={-1}>{model.name}</h2><button type="button" aria-label="Close data peek" onClick={() => dismiss(true)}><X size={18}/></button></div>{content}
  </div>;
}
