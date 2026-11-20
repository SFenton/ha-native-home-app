import { useMemo } from 'react';
import type { Json } from '../../shared/types';
import { forecastTypes, inferShapeFromSamples, type PipelineInputs } from '../../shared/composition/pipeline';
import { SelectMenu } from '../SelectMenu';
import { EntityField, ServiceField, PickerRow } from '../pickers/PickerField';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { TextInput } from '../editors/controls';
import { heldEntity } from './samples';
import EntitiesChooser from './EntitiesChooser';
import { defaultInputs, flowLimits, requestKind, requestKinds, requestWords, type RequestKind } from './flow';
import { AddressedField } from '../logic-fields/AddressedField';
import { useRows } from '../rowsContext';
import { useLogicFields } from '../logic-fields/LogicFields';

const forecastWords: Record<typeof forecastTypes[number], string> = { daily: 'Daily', hourly: 'Hourly', twice_daily: 'Twice Daily' };
const feedWords = { 'todo-items': 'To-do Items', 'weather-forecast': 'Weather Forecast' } as const;
const entityOf = (request: PipelineInputs['request']): string | undefined => request.type === 'service-response' ? (request.target?.entity_id?.type === 'literal' && typeof request.target.entity_id.value === 'string' ? request.target.entity_id.value : undefined)
  : request.type === 'entity-attribute' || request.type === 'ha-subscription' ? request.entityId.value : undefined;

/** What a request teaches the flow when a sample arrives: the shape of the answer, so the steps are typed against what Home Assistant sends. */
export const withSampleShape = (inputs: PipelineInputs, json: Json): PipelineInputs => {
  const request = inputs.request;
  return request.type === 'service-response' || request.type === 'entity-attribute' ? { ...inputs, request: { ...request, responseShape: inferShapeFromSamples([json]) } } : inputs;
};

/**
 * The Request section: "Get data from" with its five choices, then the rows each choice needs (studio-ux2 L-data, "A Group of Entities, and Nothing"). Changing the
 * choice starts the flow again from that choice, keeping its name.
 */
export default function RequestSection({ inputs, edit, flowId }: { inputs: PipelineInputs; edit: (change: (inputs: PipelineInputs) => PipelineInputs) => void; flowId?: string }) {
  const { entities, house } = useWorkspaceData();
  const rows = useRows(), canvas = useLogicFields();
  const at = rows.document.dataSources.findIndex(source => source.id === flowId);
  const request = inputs.request, kind = requestKind(request), entity = entityOf(request);
  const setKind = (next: RequestKind) => {
    const domain = next === 'service' || next === 'live-list' ? 'todo' : next === 'group' ? 'light' : 'sensor';
    edit(held => defaultInputs(next, held.title, { entityId: entities.find(row => row.domain === domain)?.entityId }));
  };
  const attributes = useMemo(() => {
    if (request.type !== 'entities') return [] as string[];
    const names = new Set<string>();
    for (const id of request.entityIds) for (const name of Object.keys(heldEntity(house?.states?.get(id.value))?.attributes ?? {})) names.add(name);
    return [...names].sort();
  }, [request, house?.states]);
  return <section className="w2-group w2-data-section" aria-label="Request" data-testid="request-section">
    <h3 className="w2-group-title">Request</h3>
    <div className="w2-picker-row"><span className="w2-row-label">Get data from</span>
      <SelectMenu label="Get data from" value={kind} options={requestKinds.map(item => ({ value: item, label: requestWords[item].title }))} onChange={next => setKind(next as RequestKind)}/></div>
    {request.type === 'service-response' && <>
      <ServiceField domain={request.domain} service={request.service} onPick={(domain, service) => edit(held => held.request.type === 'service-response' ? { ...held, request: { ...held.request, domain, service } } : held)}/>
      <EntityField label="Entity" entityId={entity} onPick={row => edit(held => held.request.type === 'service-response' ? { ...held, request: { ...held.request, target: { entity_id: { type: 'literal', value: row.entityId } } } } : held)}/>
      {request.domain === 'todo' && request.service === 'get_items' && <p className="w2-data-offer">To-do Items can also arrive live. <button type="button" className="w2-link" onClick={() => edit(held => ({ ...defaultInputs('live-list', held.title, { entityId: entity }) }))}>Use the Live List</button></p>}
    </>}
    {request.type === 'entity-attribute' && <>
      <EntityField label="Entity" entityId={entity} onPick={row => edit(held => held.request.type === 'entity-attribute' ? { ...held, request: { ...held.request, entityId: { type: 'literal', value: row.entityId } } } : held)}/>
      <div className="w2-picker-row"><span className="w2-row-label">Attribute</span>
        <TextInput label="Attribute" value={request.path.join('.')} placeholder="expired_list" onCommit={text => { const path = text.split('.').map(part => part.trim()).filter(Boolean); if (path.length && path.every(part => /^[A-Za-z0-9_-]+$/.test(part))) edit(held => held.request.type === 'entity-attribute' ? { ...held, request: { ...held.request, path } } : held); }}/></div>
    </>}
    {request.type === 'ha-subscription' && <>
      <div className="w2-picker-row"><span className="w2-row-label">Feed</span>
        <SelectMenu label="Feed" value={request.kind} options={Object.entries(feedWords).map(([value, label]) => ({ value, label }))}
          onChange={next => edit(held => defaultInputs('live-list', held.title, { feed: next as 'todo-items' | 'weather-forecast', entityId: entities.find(row => row.domain === (next === 'todo-items' ? 'todo' : 'weather'))?.entityId }))}/></div>
      <EntityField label="Entity" entityId={entity} domains={[request.kind === 'todo-items' ? 'todo' : 'weather']} onPick={row => edit(held => held.request.type === 'ha-subscription' ? { ...held, request: { ...held.request, entityId: { type: 'literal', value: row.entityId } } } : held)}/>
      {request.kind === 'weather-forecast' && <div className="w2-picker-row"><span className="w2-row-label">Forecast</span>
        <SelectMenu label="Forecast" value={request.forecastType} options={forecastTypes.map(value => ({ value, label: forecastWords[value] }))}
          onChange={next => edit(held => held.request.type === 'ha-subscription' && held.request.kind === 'weather-forecast' ? { ...held, request: { ...held.request, forecastType: next as typeof forecastTypes[number] } } : held)}/></div>}
    </>}
    {request.type === 'entities' && <>
      <EntitiesChooser label="Entities" ids={request.entityIds.map(item => item.value)} path="request/entities"
        onChange={ids => edit(held => held.request.type === 'entities' ? { ...held, request: { ...held.request, entityIds: ids.map(value => ({ type: 'literal', value })) } } : held)}/>
      <PickerRow label="Also read" title="Also read" stacked primary={request.attributes.length ? request.attributes.join(', ') : <span className="w2-placeholder">None</span>}>
        {() => <div className="w2-data-entities">
          <p role="status" aria-live="polite" className="w2-caption">{`${request.attributes.length} of ${flowLimits.attributes.max} chosen`}{request.attributes.length >= flowLimits.attributes.max ? ` · ${flowLimits.attributes.words}` : ''}</p>
          <ul className="w2-data-chips" aria-label="Attributes">{[...new Set([...attributes, ...request.attributes])].map(name => {
            const on = request.attributes.includes(name);
            return <li key={name}><button type="button" className="w2-chip" aria-pressed={on} disabled={!on && request.attributes.length >= flowLimits.attributes.max}
              onClick={() => edit(held => held.request.type === 'entities' ? { ...held, request: { ...held.request, attributes: on ? held.request.attributes.filter(item => item !== name) : [...held.request.attributes, name] } } : held)}>{name}</button></li>;
          })}</ul>
          {attributes.length === 0 && <p className="w2-caption">Home Assistant reports no attributes for these entities.</p>}
        </div>}
      </PickerRow>
    </>}
    {request.type === 'none' && canvas && at >= 0
      ? <AddressedField path={['dataSources', at, 'inputs', 'request', 'value']} kind="operand" label="Value"/>
      : request.type === 'none' && <div className="w2-picker-row"><span className="w2-row-label">Value</span>
      <TextInput label="Value" value={request.value.type === 'literal' ? String(request.value.value ?? '') : ''} placeholder="A fixed value"
        onCommit={text => edit(held => held.request.type === 'none' ? { ...held, request: { type: 'none', value: { type: 'literal', value: text } } } : held)}/></div>}
  </section>;
}
