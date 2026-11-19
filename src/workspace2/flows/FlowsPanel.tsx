import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Plus, Search } from 'lucide-react';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { LibraryGroup } from '../Disclosure';
import type { Library } from '../useLibrary';
import type { Workspace2 } from '../useWorkspace2';
import type { SelectionKey } from '../../preview2/model';
import { focusField } from '../focusField';
import { MoreMenu } from '../expr/ui';
import { canAddFlow, flowLimits, flowShapes, flowSources, kindWords, newFlow, requestKind, requestKinds, requestWords, usedCount, type RequestKind } from '../data/flow';
import { pickActive, setFlowFocus, setPickSlot } from '../data/focus';
import { addEntry, canAddEntry, libraryOf, useCounts, usesOf } from '../data/logic/logicModel';
import { LogicUses } from '../data/logic/LogicRow';
import { logicWords } from '../data/logic/logicWords';
import { focusLogicName, useLogicActions } from '../data/logic/useLogicActions';
import OutputGlyph from './OutputGlyph';
import OpenFlow from './OpenFlow';
import { fieldsWithLogic, fieldSummary, matches, outputKind, outputWords, type OutputKind } from './model';
import '../data/data.css';

const domainFor: Partial<Record<RequestKind, string>> = { service: 'todo', 'live-list': 'todo', group: 'light', attribute: 'sensor' };

export default function FlowsPanel({ ws, library, onKeepPanel, onError }: { ws: Workspace2; library: Library; onKeepPanel: (key: SelectionKey) => void; onError: (message: string) => void }) {
  const document = ws.document!, { entities } = useWorkspaceData();
  const [query, setQuery] = useState(''), [showUses, setShowUses] = useState<string>();
  const rows = useRef(new Map<string, HTMLLIElement>());
  const uses = useMemo(() => new Map(flowSources(document).map(source => [source.id, usedCount(document, source.id)])), [document]);
  const counts = useMemo(() => useCounts(document), [document]);
  const fields = useMemo(() => fieldsWithLogic(document), [document]);
  const names = useMemo(() => new Map(entities.map(row => [row.entityId, row.name])), [entities]);
  const templates = libraryOf(document), flows = flowSources(document);
  const actions = useLogicActions(ws, onError);
  const shownTemplates = templates.filter(entry => matches(query, entry.name));
  const shownFlows = flows.filter(source => matches(query, source.inputs.title));
  const shownFields = fields.filter(field => matches(query, field.title, field.field, fieldSummary(field.value, document, names)));
  const makeLogic = (kind: 'value' | 'condition') => {
    try { const made = addEntry(document, kind); ws.studio.apply(made.document); ws.openLogic(made.id); focusLogicName(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const make = (kind: RequestKind) => {
    try {
      const domain = domainFor[kind], first = domain ? entities.find(row => row.domain === domain)?.entityId : undefined;
      const made = newFlow(document, kind, { entityId: first });
      ws.studio.apply(made.document); setFlowFocus({ flowId: made.id, step: null }); ws.openFlow(made.id);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape' && pickActive()) { event.stopPropagation(); setPickSlot(undefined); } };
  return <div className="w2-data-panel w2-flows-panel" data-testid="flows-panel" onKeyDown={keys}>
    <p className="w2-data-count">{templates.length} {templates.length === 1 ? 'template' : 'templates'} · {flows.length} {flows.length === 1 ? 'flow' : 'flows'} · {fields.length} {fields.length === 1 ? 'field' : 'fields'} with logic</p>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find a flow" aria-label="Find a flow" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-lib-scroll">
      {(!query || shownTemplates.length > 0) && <LibraryGroup id="flows.templates" title="Templates" names={shownTemplates.map(entry => entry.name)} library={library} reveal={ws.logicId} searching={Boolean(query.trim())} testId="logic-group">
        {!templates.length ? <p className="w2-caption" data-testid="logic-empty">{logicWords.empty}</p> : <ul className="w2-data-list" aria-label="Logic Templates">
          {shownTemplates.map(entry => {
            const kind = entry.kind === 'condition' ? 'boolean' : outputKind(entry.body, document, entry.params);
            return <li key={entry.id} ref={node => { if (node) rows.current.set(entry.id, node); else rows.current.delete(entry.id); }} className="w2-flow-template" data-testid="logic-row">
              <div className="w2-data-plain">
                <button type="button" className="w2-data-row" aria-current={ws.logicId === entry.id || undefined} aria-label={`${entry.name}, logic template, ${outputWords[kind]}, Used by ${counts.get(entry.id) ?? 0}`}
                  onClick={() => ws.openLogic(ws.logicId === entry.id ? undefined : entry.id)}>
                  <OutputGlyph kind={kind}/><span className="w2-flow-rowtext"><span className="w2-flow-name"><span className="w2-data-name">{entry.name}</span><span className="w2-data-tag">Template</span></span><small>{outputWords[kind]} · Used by {counts.get(entry.id) ?? 0}</small></span>
                </button>
                <MoreMenu label={`More for ${entry.name}`} commands={[
                  { label: logicWords.rename, run: () => actions.rename(entry.id) }, { label: logicWords.showUses, run: () => setShowUses(showUses === entry.id ? undefined : entry.id) },
                  { label: logicWords.duplicate, run: () => actions.duplicate(entry.id) }, { label: logicWords.delete, run: () => actions.remove(entry.id), danger: true, separatorBefore: true },
                ]}/>
              </div>
              {showUses === entry.id && <LogicUses ws={ws} uses={usesOf(document, entry.id)} anchor={rows.current.get(entry.id) ?? null} onClose={() => setShowUses(undefined)}/>}
            </li>;
          })}
        </ul>}
      </LibraryGroup>}
      {(!query || shownFlows.length > 0) && <LibraryGroup id="flows.flows" title="Flows" names={shownFlows.map(source => source.inputs.title)} library={library} reveal={flows.some(source => source.id === ws.flowId) ? ws.flowId : undefined} searching={Boolean(query.trim())}>
        <ul className="w2-data-list">{shownFlows.map(source => {
          const open = ws.flowId === source.id, shapeKind = kindWords(flowShapes(source.inputs).final).kind;
          const kind: OutputKind = source.inputs.output.kind === 'rows' || shapeKind === 'List' ? 'list' : shapeKind === 'Number' ? 'number' : shapeKind === 'Yes or No' ? 'boolean' : shapeKind.startsWith('Date') ? 'time' : 'words';
          const live = ['group', 'none', 'live-list'].includes(requestKind(source.inputs.request));
          return <li key={source.id} className="w2-data-flow" data-open={open || undefined}>
            <button type="button" className="w2-data-row" aria-current={open || undefined} aria-expanded={open}
              aria-label={`${source.inputs.title}, data flow, used by ${uses.get(source.id) ?? 0}${live ? ', live' : ''}`}
              onClick={() => { setFlowFocus({ flowId: source.id, step: null }); ws.openFlow(open ? undefined : source.id); }}>
              <OutputGlyph kind={kind}/><span className="w2-flow-rowtext"><span className="w2-data-name">{source.inputs.title}</span><small>{outputWords[kind]} · Used by {uses.get(source.id) ?? 0}</small></span>
            </button>
            {open && <OpenFlow ws={ws} source={source} onError={onError}/>}
          </li>;
        })}</ul>
      </LibraryGroup>}
      {(!query || shownFields.length > 0) && <LibraryGroup id="flows.fields" title="Inside a Field" names={shownFields.map(field => `${field.title} · ${field.field}`)} library={library}
        reveal={fields.some(field => field.key && field.key === ws.selection || field.templateId && field.templateId === ws.templateId) ? ws.selection ?? ws.templateId : undefined} searching={Boolean(query.trim())}>
        <ul className="w2-data-list">{shownFields.map(field => <li key={field.id}>
          <button type="button" className="w2-data-row" aria-current={Boolean(field.key && field.key === ws.selection || field.templateId && field.templateId === ws.templateId) || undefined}
            onClick={() => { if (field.key) { onKeepPanel(field.key); ws.selectAnywhere(field.key); } else ws.openTemplate(field.templateId); focusField(field.path); }}>
            <OutputGlyph kind={field.kind}/><span className="w2-flow-rowtext"><span className="w2-data-name">{field.title} · {field.field}</span><small>{fieldSummary(field.value, document, names)}</small></span>
          </button>
        </li>)}</ul>
      </LibraryGroup>}
      {query && !shownTemplates.length && !shownFlows.length && !shownFields.length && <p className="w2-empty">Nothing matches.</p>}
    </div>
    <footer className="w2-data-foot">
      <Menu.Root><Menu.Trigger className="w2-data-add" disabled={!canAddFlow(document)}><Plus size={16} aria-hidden/>New Flow</Menu.Trigger>
        <Menu.Portal><Menu.Positioner side="top" sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label="Get data from">
          {requestKinds.map(kind => <Menu.Item key={kind} className="w2-menu-item" onClick={() => make(kind)}><span className="w2-choice-text">{requestWords[kind].title}<small className="w2-choice-note">{requestWords[kind].note}</small></span></Menu.Item>)}
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
      <Menu.Root><Menu.Trigger className="w2-data-add" disabled={!canAddEntry(document)}><Plus size={16} aria-hidden/>{logicWords.addTemplate}</Menu.Trigger>
        <Menu.Portal><Menu.Positioner side="top" sideOffset={6} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label={logicWords.addMenu}>
          <Menu.Item className="w2-menu-item" onClick={() => makeLogic('value')}>{logicWords.addValue}</Menu.Item><Menu.Item className="w2-menu-item" onClick={() => makeLogic('condition')}>{logicWords.addCondition}</Menu.Item>
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
      {!canAddFlow(document) && <p className="w2-caption" role="note">{flowLimits.flows.words}</p>}
      {!canAddEntry(document) && <p className="w2-caption" role="note">{logicWords.limitTemplates}</p>}
      {actions.dialog}
    </footer>
  </div>;
}
