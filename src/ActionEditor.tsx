import { useId } from 'react';
import type { Action, Condition, Json, StudioDocument } from './shared/types';
import { Field, JsonField, PrimitiveField, SelectField, TextField } from './ui';

const actionOptions = [{ value: 'none', label: 'No action' }, { value: 'navigate', label: 'Navigate to page' }, { value: 'modal', label: 'Open modal' }, { value: 'dismiss', label: 'Dismiss modal' }, { value: 'toggle', label: 'Toggle variable' }, { value: 'set', label: 'Set variable' }, { value: 'service', label: 'Call a service' }, { value: 'url', label: 'Open web link' }, { value: 'report-issue', label: 'Report an issue' }, { value: 'request-feature', label: 'Request a feature' }];
export function defaultAction(type: Action['type'], document: StudioDocument): Action {
  switch (type) {
    case 'navigate': return { type, pageId: document.pages[0]?.id ?? '' };
    case 'modal': return { type, modalId: document.modals[0]?.id ?? '' };
    case 'toggle': return { type, variable: Object.keys(document.variables).find(key => typeof document.variables[key] === 'boolean') ?? '' };
    case 'set': return { type, variable: Object.keys(document.variables)[0] ?? '', value: true };
    case 'service': return { type, domain: 'light', service: 'turn_on', entityId: '', data: {} };
    case 'url': return { type, url: 'https://' };
    default: return { type };
  }
}
export function ActionEditor({ action = { type: 'none' }, document, onChange }: { action?: Action; document: StudioDocument; onChange: (action: Action) => void }) {
  const variablesId = useId();
  return <div className="action-editor">
    <SelectField label="On tap" value={action.type} options={actionOptions} onChange={type => onChange(defaultAction(type as Action['type'], document))}/>
    {action.type === 'navigate' && <SelectField label="Destination page" value={action.pageId} options={document.pages.map(page => ({ value: page.id, label: page.title }))} onChange={pageId => onChange({ ...action, pageId })}/>}
    {action.type === 'modal' && <><SelectField label="Modal" value={action.modalId} options={document.modals.length ? document.modals.map(modal => ({ value: modal.id, label: modal.title })) : [{ value: '', label: 'Create a modal first' }]} onChange={modalId => onChange({ ...action, modalId })}/>{!document.modals.length && <p className="field-note">No modals yet. Add one in the sidebar.</p>}</>}
    {(action.type === 'toggle' || action.type === 'set') && <><Field label="Variable"><input list={variablesId} value={action.variable} onChange={event => onChange({ ...action, variable: event.target.value })}/><datalist id={variablesId}>{Object.keys(document.variables).map(key => <option value={key} key={key}/>)}</datalist></Field>{action.type === 'set' && <PrimitiveField label="Value" value={action.value} onChange={value => onChange({ ...action, value })}/>}</>}
    {action.type === 'url' && <TextField label="Web address" value={action.url} placeholder="https://example.com" onChange={url => onChange({ ...action, url })}/>}
    {action.type === 'service' && <><p className="safety-note">Simulated in the preview.</p><div className="field-pair"><TextField label="Domain" value={action.domain} onChange={domain => onChange({ ...action, domain })}/><TextField label="Service" value={action.service} onChange={service => onChange({ ...action, service })}/></div><TextField label="Entity ID" value={action.entityId} onChange={entityId => onChange({ ...action, entityId })} placeholder="light.living_room"/><JsonField label="Service data" shape="object" value={action.data ?? {}} onChange={data => { if (data && !Array.isArray(data) && typeof data === 'object') onChange({ ...action, data: data as Record<string, Json> }); }}/></>}
  </div>;
}
export function ConditionEditor({ condition, document, onChange }: { condition?: Condition; document: StudioDocument; onChange: (condition?: Condition) => void }) {
  const variablesId = useId();
  return <div><label className="checkbox-field"><input type="checkbox" checked={Boolean(condition)} onChange={event => onChange(event.target.checked ? { source: 'variable', key: Object.keys(document.variables)[0] ?? '', operator: 'truthy' } : undefined)}/> Show only when a condition matches</label>
    {condition && <div className="condition-builder"><span className="condition-label">IF</span><SelectField label="Condition source" value={condition.source} options={['variable', 'entity']} onChange={source => onChange({ ...condition, source: source as Condition['source'] })}/>{condition.source === 'variable' ? <Field label="Variable key"><input value={condition.key} list={variablesId} onChange={event => onChange({ ...condition, key: event.target.value })}/><datalist id={variablesId}>{Object.keys(document.variables).map(key => <option key={key} value={key}/>)}</datalist></Field> : <TextField label="Entity ID" value={condition.key} placeholder="binary_sensor.front_door" onChange={key => onChange({ ...condition, key })}/>}<SelectField label="Comparison" value={condition.operator} options={[{ value: 'truthy', label: 'is truthy' }, { value: 'equals', label: 'equals' }, { value: 'not-equals', label: 'does not equal' }, { value: 'greater-than', label: 'is greater than' }, { value: 'less-than', label: 'is less than' }]} onChange={operator => {
      const numeric = operator === 'greater-than' || operator === 'less-than';
      onChange({ ...condition, operator: operator as Condition['operator'], value: numeric ? typeof condition.value === 'number' ? condition.value : 0 : condition.value ?? true });
    }}/>{condition.operator !== 'truthy' && <PrimitiveField label="Compare with" value={condition.value ?? true} onChange={value => onChange({ ...condition, value })}/>}<p className="field-note">Shown when the condition is true.</p></div>}
  </div>;
}
