import { useEffect, useMemo, useState } from 'react';
import PhoneLogicRow from '../data/logic/PhoneLogicRow';
import { usePush } from '../kit';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useRows } from '../rows';
import { PushRow } from '../dialogs/parts';
import FlowEditor from '../data/FlowEditor';
import { canAddFlow, flowSources, newFlow, requestKinds, requestWords, usedCount, type RequestKind } from '../data/flow';
import LogicEditor from '../data/logic/LogicEditor';
import { addEntry, canAddEntry, entryOf, libraryOf, useCounts } from '../data/logic/logicModel';
import { setHeldLogicScope } from '../data/logic/logicScope';
import { logicWords } from '../data/logic/logicWords';
import type { Workspace2 } from '../useWorkspace2';

/** Existing pushed editors, now reached through Project > Flows instead of the read-only Data sheet. */
export default function PhoneFlows({ ws }: { ws: Workspace2 }) {
  const { document, onChange, onError } = useRows(), push = usePush(), { entities } = useWorkspaceData();
  const [query, setQuery] = useState('');
  const uses = useMemo(() => new Map(flowSources(document).map(source => [source.id, usedCount(document, source.id)])), [document]), counts = useMemo(() => useCounts(document), [document]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const flows = flowSources(document).filter(source => words.every(word => source.inputs.title.toLowerCase().includes(word)));
  const library = libraryOf(document), templates = library.filter(entry => words.every(word => entry.name.toLowerCase().includes(word)));
  useEffect(() => { setHeldLogicScope(undefined); }, []);
  const add = (kind: RequestKind) => {
    const made = newFlow(document, kind, { entityId: entities.find(row => row.domain === (kind === 'group' ? 'light' : kind === 'attribute' ? 'sensor' : 'todo'))?.entityId });
    onChange(made.document);
    push?.push({ title: 'Data Flow', body: <FlowEditor ws={ws} id={made.id}/> });
  };
  const addLogic = (kind: 'value' | 'condition') => {
    try {
      const made = addEntry(document, kind);
      onChange(made.document); setHeldLogicScope({ entryId: made.id });
      push?.push({ title: entryOf(made.document, made.id)!.name, body: <LogicEditor ws={ws} id={made.id}/>, guard: () => { setHeldLogicScope(undefined); return true; } });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="w2-data">
    <label className="w2-search"><span className="w2-sr">Find a flow</span><input type="search" placeholder="Find a flow" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {flows.length > 0 && <section aria-label="Data Flows"><h3 className="w2-group-title">Data Flows</h3><ul className="w2-list">{flows.map(source =>
      <PushRow key={source.id} title={source.inputs.title} detail="Data Flow" plain tags={<span className="w2-summary w2-used">Used by {uses.get(source.id) ?? 0}</span>}
        onOpen={() => push?.push({ title: source.inputs.title, body: <FlowEditor ws={ws} id={source.id}/> })}/>
    )}</ul></section>}
    {templates.length > 0 && <section aria-label={logicWords.group} data-testid="logic-group"><h3 className="w2-group-title">{logicWords.group}</h3><ul className="w2-list" aria-label={logicWords.group}>{templates.map(entry => <PhoneLogicRow key={entry.id} ws={ws} entry={entry} uses={counts.get(entry.id) ?? 0} onError={onError}/>)}</ul></section>}
    {!library.length && <p className="w2-caption" data-testid="logic-empty">{logicWords.empty}</p>}
    <div className="w2-actions">
      <button type="button" disabled={!canAddFlow(document)} onClick={() => push?.push({ title: 'Get Data From', body: <ul className="w2-list">{requestKinds.map(kind => <li key={kind}><button type="button" className="w2-list-row" onClick={() => { push?.pop(); add(kind); }}>{requestWords[kind].title}<span className="w2-page-via">{requestWords[kind].note}</span></button></li>)}</ul> })}>Data Flow</button>
      <button type="button" disabled={!canAddEntry(document)} onClick={() => push?.push({ title: logicWords.addTemplate, body: <ul className="w2-list"><li><button type="button" className="w2-list-row" onClick={() => { push?.pop(); addLogic('value'); }}>{logicWords.addValue}</button></li><li><button type="button" className="w2-list-row" onClick={() => { push?.pop(); addLogic('condition'); }}>{logicWords.addCondition}</button></li></ul> })}>{logicWords.addTemplate}</button>
    </div>
  </div>;
}
