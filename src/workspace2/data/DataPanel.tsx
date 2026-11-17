import { useMemo, useState, type KeyboardEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Plus, Search, Workflow } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { PipelineSource } from '../../shared/composition/pipeline';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { modelChoices, sourceName, sourceUses, type Source } from '../dialogs/sources';
import type { Workspace2 } from '../useWorkspace2';
import ShapeOutline from './ShapeOutline';
import {
  addStepAt, canAddFlow, flowLimits, flowShapes, flowSources, newFlow, requestKind, requestKinds, requestWords, stepForField, stepId, updateFlow, pointRowAt, type RequestKind,
} from './flow';
import { pickActive, setFlowFocus, setPickSlot, useFlowFocus } from './focus';
import { useSample, valueAfterStep } from './samples';
import { studioClock, useFlowData } from './useFlowData';
import './data.css';

/** The words for an app topic, and the order the App group lists them in. */
export const appTopicWords: Record<string, string> = { window: 'Window', clock: 'Clock', os: 'This Phone', notifications: 'Notifications', preferences: 'App Settings' };
const matches = (query: string, ...texts: string[]) => { const words = query.toLowerCase().split(/\s+/).filter(Boolean); return words.every(word => texts.join(' ').toLowerCase().includes(word)); };
const usedWords = (count: number) => count > 0 ? `Used by ${count}` : 'Not Used';
/** The domain a new flow's entity is picked from, by request kind. */
const domainFor: Partial<Record<RequestKind, string>> = { service: 'todo', 'live-list': 'todo', group: 'light', attribute: 'sensor' };

/** One Data Flow row: its name, how many places use it, and (while it is the open flow) the outline of its data at the step the editor is on. */
function FlowRow({ ws, source, uses, onError }: { ws: Workspace2; source: PipelineSource; uses: number; onError: (message: string) => void }) {
  const open = ws.flowId === source.id, inputs = source.inputs;
  const { sample } = useSample(source.id);
  const kind = requestKind(inputs.request);
  const live = kind === 'group' || kind === 'none' || kind === 'live-list';
  const status = live ? 'live' : sample ? 'sample' : 'not run';
  return <li className="w2-data-flow" data-open={open || undefined}>
    <button type="button" className="w2-data-row" aria-current={open || undefined} aria-expanded={open}
      aria-label={`${inputs.title}, data flow, ${usedWords(uses).toLowerCase()}, ${status}`} onClick={() => { setFlowFocus({ flowId: source.id, step: null }); ws.openFlow(open ? undefined : source.id); }}>
      <Workflow size={16} aria-hidden/><span className="w2-data-name">{inputs.title}</span><span className="w2-data-used">{usedWords(uses)}</span>
    </button>
    {open && <OpenFlow ws={ws} source={source} onError={onError}/>}
  </li>;
}

/** The open flow's outline: a line saying which point it shows, a tag for where the data came from, then the fields. */
function OpenFlow({ ws, source, onError }: { ws: Workspace2; source: PipelineSource; onError: (message: string) => void }) {
  const inputs = source.inputs, focus = useFlowFocus();
  const step = focus.flowId === source.id ? focus.step : null;
  const data = useFlowData(source.id, inputs);
  const shapes = useMemo(() => flowShapes(inputs), [inputs]);
  const at = step !== null && step < shapes.after.length ? step : null;
  const shape = at === null ? shapes.final : shapes.after[at];
  const partial = useMemo(() => {
    if (!data.response || data.result?.status !== 'ok') return undefined;
    return at === null ? data.result.value : valueAfterStep(inputs, data.response, at, { clock: studioClock() });
  }, [at, data, inputs]);
  const size = at === null ? data.items : data.result?.status === 'ok' ? data.result.trace[at]?.size ?? undefined : undefined;
  const tag = data.source === 'live' ? 'Live' : data.source === 'sample' ? 'Sample' : data.source === 'demo' ? 'Demo' : 'No data yet';
  const heading = at === null ? `Output${size !== undefined && size !== null ? ` · ${size} ${size === 1 ? 'item' : 'items'}` : ''}` : `After Step ${at + 1}${size !== undefined && size !== null ? ` · ${size} items` : ''}`;
  const edit = (change: (value: typeof inputs) => typeof inputs) => { try { ws.studio.apply(updateFlow(ws.document!, source.id, change)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  return <div className="w2-data-open">
    <p className="w2-data-point"><span>{heading}</span><span className="w2-data-tag" data-source={data.source}>{tag}</span></p>
    <ShapeOutline shape={shape} value={partial} hide={data.hide} label={heading} rows={inputs.output.kind === 'rows'}
      onStep={(op, path, kind) => { setPickSlot(undefined); edit(value => { const id = stepId(value.steps, op), where = at === null ? value.steps.length : at + 1; return addStepAt(value, stepForField(op, id, path, kind), where); }); }}
      onRow={(slot, path) => edit(value => pointRowAt(value, slot, path))}/>
  </div>;
}

/**
 * The Data panel (studio-ux2 L-data, D2): "Data Flows" with the one open expanded into its typed outline, then "Entities", "App" (only the topics in use)
 * and "Models", each row with "Used by n" or "Not Used". Footer: + Data Flow (the five ways to get data) and + Source. Escape leaves pick mode.
 */
export default function DataPanel({ ws, onError }: { ws: Workspace2; onError: (message: string) => void }) {
  const document = ws.document as CompositionDocument;
  const { entities } = useWorkspaceData();
  const [query, setQuery] = useState('');
  const uses = useMemo(() => sourceUses(document), [document]);
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const flows = flowSources(document);
  const others = document.dataSources.filter(source => !(source.kind === 'model' && source.model === 'pipeline@1'));
  const apps = others.filter(source => source.kind === 'model' && source.model === 'app-state@1');
  const models = others.filter(source => source.kind === 'model' && source.model !== 'app-state@1');
  const entitySources = others.filter(source => source.kind === 'ha-entity');
  const appName = (source: Source) => appTopicWords[(source as { inputs?: { topic?: string } }).inputs?.topic ?? ''] ?? sourceName(source, names);
  const shown = { flows: flows.filter(source => matches(query, source.inputs.title)), entities: entitySources.filter(source => matches(query, sourceName(source, names), source.id)),
    apps: apps.filter(source => matches(query, appName(source))), models: models.filter(source => matches(query, sourceName(source, names), source.id)) };
  const count = flows.length;
  const room = canAddFlow(document);
  const make = (kind: RequestKind) => {
    try {
      const domain = domainFor[kind], first = domain ? entities.find(row => row.domain === domain)?.entityId : undefined;
      const made = newFlow(document, kind, { entityId: first });
      ws.studio.apply(made.document);
      setFlowFocus({ flowId: made.id, step: null });
      ws.openFlow(made.id);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const addSource = (choice: ReturnType<typeof modelChoices>[number]) => { ws.studio.apply({ ...document, dataSources: [...document.dataSources, choice.make(document)] }); };
  const keys = (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape' && pickActive()) { event.stopPropagation(); setPickSlot(undefined); } };
  const group = (title: string, items: React.ReactNode[]) => items.length > 0 && <section className="w2-data-group" aria-label={title}><h3 className="w2-group-title">{title}</h3><ul className="w2-data-list">{items}</ul></section>;
  /** An entity, app topic or model: one row that opens its fields in the inspector, where a Data Flow opens its steps. */
  const plain = (source: Source, label: string) => {
    const open = ws.flowId === source.id, kind = source.kind === 'ha-entity' ? 'entity' : 'source';
    return <li key={source.id} className="w2-data-plain">
      <button type="button" className="w2-data-row" aria-current={open || undefined} aria-label={`${label}, ${kind}, ${usedWords(uses.get(source.id) ?? 0).toLowerCase()}`} onClick={() => ws.openFlow(open ? undefined : source.id)}>
        <span className="w2-data-name">{label}</span><span className="w2-data-used">{usedWords(uses.get(source.id) ?? 0)}</span>
      </button>
    </li>;
  };
  return <div className="w2-data-panel" data-testid="data-panel" onKeyDown={keys}>
    <p className="w2-data-count">{`${count} ${count === 1 ? 'data flow' : 'data flows'} · ${others.length} ${others.length === 1 ? 'source' : 'sources'}`}</p>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find data" aria-label="Find data" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-lib-scroll">
      {document.dataSources.length === 0 && <p className="w2-empty">No data yet. Add a Data Flow to get some.</p>}
      {group('Data Flows', shown.flows.map(source => <FlowRow key={source.id} ws={ws} source={source} uses={uses.get(source.id) ?? 0} onError={onError}/>))}
      {group('Entities', shown.entities.map(source => plain(source, sourceName(source, names))))}
      {group('App', shown.apps.map(source => plain(source, appName(source))))}
      {group('Models', shown.models.map(source => plain(source, sourceName(source, names))))}
    </div>
    <footer className="w2-data-foot">
      <Menu.Root>
        <Menu.Trigger className="w2-data-add" disabled={!room} aria-describedby={room ? undefined : 'w2-data-limit'}><Plus size={16} aria-hidden/>Data Flow</Menu.Trigger>
        <Menu.Portal><Menu.Positioner side="top" sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label="Get data from">
          {requestKinds.map(kind => <Menu.Item key={kind} className="w2-menu-item" onClick={() => make(kind)}><span className="w2-choice-text">{requestWords[kind].title}<small className="w2-choice-note">{requestWords[kind].note}</small></span></Menu.Item>)}
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
      <Menu.Root>
        <Menu.Trigger className="w2-data-add"><Plus size={16} aria-hidden/>Source</Menu.Trigger>
        <Menu.Portal><Menu.Positioner side="top" sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-data-sources" aria-label="Add a source">
          {modelChoices().filter(choice => choice.model !== 'pipeline@1').map(choice => <Menu.Item key={choice.model} className="w2-menu-item" onClick={() => addSource(choice)}>{choice.name}</Menu.Item>)}
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
      {!room && <p id="w2-data-limit" className="w2-caption" role="note">{flowLimits.flows.words}</p>}
    </footer>
  </div>;
}
