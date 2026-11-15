import { useEffect, useState } from 'react';
import { request } from './api';
import { Field, NumberField, SelectField, TextField } from './ui';
import type { CompositionDocument } from './shared/composition/schema';
import { callServiceWarnings } from './shared/composition/lints';
import { callTargetKeys, mathOperations } from './shared/composition/expression';
import type { Json } from './shared/types';

// Loose shapes: the schema (not these types) decides what is valid, and the compiler's issues are shown in the validation panel.
type Loose = Record<string, any>;
type Change = (value: Json) => void;
interface Context { document: CompositionDocument }

// MARK: Home Assistant entities

let entityCache: Promise<string[]> | undefined;
/** The entity ids of the Studio's own Home Assistant connection (`/api/native-home`); empty while unavailable. */
export function useHaEntities(): { entities: string[]; loaded: boolean } {
  const [state, setState] = useState<{ entities: string[]; loaded: boolean }>({ entities: [], loaded: false });
  useEffect(() => {
    let live = true;
    entityCache ??= request<{ states?: { entityId?: string }[] }>('/api/native-home')
      .then(snapshot => (snapshot.states ?? []).map(entry => String(entry.entityId)).filter(Boolean).sort())
      .catch(() => { entityCache = undefined; return []; });
    void entityCache.then(entities => { if (live) setState({ entities, loaded: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
/** Forgets the fetched entity list (tests, and a manual refresh). */
export function resetHaEntities() { entityCache = undefined; }

/** An entity id field backed by the Studio's Home Assistant entities, accepting any well-formed id typed by hand. */
export function EntityPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { entities, loaded } = useHaEntities();
  const listId = `entities-${label.replace(/\W/g, '')}`;
  const bad = value !== '' && !/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value);
  return <Field label={label} hint={bad ? 'An entity id looks like light.kitchen.' : loaded && !entities.length ? 'The Home Assistant entity list is unavailable; type an entity id.' : undefined}>
    <input value={value} list={listId} aria-invalid={bad} onChange={event => onChange(event.target.value.trim())}/>
    <datalist id={listId}>{entities.map(entity => <option key={entity} value={entity}/>)}</datalist>
  </Field>;
}

const commonServices: Record<string, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'], switch: ['turn_on', 'turn_off', 'toggle'], fan: ['turn_on', 'turn_off', 'toggle', 'set_percentage', 'set_preset_mode'],
  climate: ['set_temperature', 'set_hvac_mode', 'set_fan_mode', 'turn_on', 'turn_off'], cover: ['open_cover', 'close_cover', 'stop_cover', 'set_cover_position'],
  lock: ['lock', 'unlock', 'open'], alarm_control_panel: ['alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night', 'alarm_disarm'],
  media_player: ['media_play', 'media_pause', 'volume_set', 'volume_up', 'volume_down', 'select_source'], scene: ['turn_on'], script: ['turn_on'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'], input_number: ['set_value'], input_select: ['select_option'], button: ['press'], vacuum: ['start', 'stop', 'return_to_base'],
  notify: ['notify', 'mobile_app'], homeassistant: ['turn_on', 'turn_off', 'toggle'],
};
const haSources = (document: CompositionDocument) => document.dataSources.filter(source => source.kind === 'ha-entity');
const sourceOptions = (document: CompositionDocument) => [{ value: '', label: 'Choose a Home Assistant entity source' },
  ...haSources(document).map(source => ({ value: source.id, label: `${source.id} (${source.entityId.type === 'literal' ? source.entityId.value : 'bound'})` }))];
const csv = (items: unknown) => Array.isArray(items) ? items.join(', ') : '';
const parseCsv = (text: string) => text.split(',').map(part => part.trim()).filter(Boolean);

// MARK: Source path

/** A state or attribute read path: `["state"]` or `["attributes", name]`. */
function PathField({ value, onChange }: { value: string[]; onChange: (path: string[]) => void }) {
  const attribute = value[0] === 'attributes';
  return <div className="field-pair">
    <SelectField label="Read" value={attribute ? 'attribute' : 'state'} options={[{ value: 'state', label: 'State' }, { value: 'attribute', label: 'Attribute' }]}
      onChange={next => onChange(next === 'state' ? ['state'] : ['attributes', 'brightness'])}/>
    {attribute && <TextField label="Attribute name" value={value.slice(1).join('.')} onChange={name => onChange(['attributes', ...name.split('.').filter(Boolean)])}/>}
  </div>;
}

// MARK: Operands

const operandTypes = ['literal', 'read', 'control', 'viewer', 'format', 'map', 'math', 'object', 'list'] as const;
/** A fresh operand of `type`, valid as authored. */
export function defaultOperand(type: string, { document }: Context): Loose {
  const source = haSources(document)[0]?.id ?? '';
  switch (type) {
    case 'read': return { type, from: { type: 'source', sourceId: source, path: ['state'] }, as: 'string', missing: 'unavailable' };
    case 'control': return { type };
    case 'viewer': return { type, field: 'userId' };
    case 'format': return { type, pattern: '{value}', args: { value: { type: 'literal', value: '' } } };
    case 'map': return { type, of: { type: 'literal', value: '' }, cases: [{ equals: 'on', then: { type: 'literal', value: '' } }], otherwise: { type: 'literal', value: '' } };
    case 'math': return { type, op: 'add', args: [{ type: 'literal', value: 0 }, { type: 'literal', value: 0 }] };
    case 'object': return { type, fields: {} };
    case 'list': return { type, items: [] };
    default: return { type: 'literal', value: '' };
  }
}
const literalKind = (value: unknown) => typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'yes-no' : typeof value === 'string' ? 'text' : 'json';

/** Edits one operand: a literal, a read of an entity, the control value, a viewer fact, or a format, map, math, object or list. */
export function OperandEditor({ label, value, onChange, document, allowControl = false }: Context & { label: string; value: Loose; onChange: Change; allowControl?: boolean }) {
  const ctx = { document };
  const types = operandTypes.filter(type => allowControl || type !== 'control');
  const update = (patch: Loose) => onChange({ ...value, ...patch });
  const entries = (record: Loose, key: 'args' | 'fields') => <Entries label={key === 'args' ? 'Arguments' : 'Fields'} record={record} onChange={next => update({ [key]: next })}
    render={(name, item, set) => <OperandEditor {...ctx} label={name} value={item} allowControl={allowControl} onChange={set}/>}
    fresh={() => defaultOperand('literal', ctx)}/>;
  const list = (items: Loose[], key: 'args' | 'items', max: number) => <fieldset className="composition-fieldset"><legend>{key === 'args' ? 'Arguments' : 'Items'} ({items.length})</legend>
    {items.map((item, index) => <div key={index}>
      <OperandEditor {...ctx} label={`${label} ${index + 1}`} value={item} allowControl={allowControl} onChange={next => update({ [key]: items.map((old, i) => i === index ? next : old) })}/>
      <button type="button" aria-label={`Remove ${label} ${index + 1}`} onClick={() => update({ [key]: items.filter((_, i) => i !== index) })}>Remove</button>
    </div>)}
    <button type="button" className="add-button" disabled={items.length >= max} onClick={() => update({ [key]: [...items, defaultOperand('literal', ctx)] })}>Add {key === 'args' ? 'argument' : 'item'}</button>
  </fieldset>;
  return <fieldset className="composition-fieldset"><legend>{label}</legend>
    <SelectField label={`${label} kind`} value={value.type} options={types.map(type => ({ value: type, label: type === 'read' ? 'read (entity value)' : type === 'control' ? 'control (new value)' : type }))}
      onChange={type => onChange(type === value.type ? value : defaultOperand(type, ctx))}/>
    {value.type === 'literal' && <>
      <SelectField label={`${label} literal type`} value={literalKind(value.value)} options={['text', 'number', 'yes-no', 'json']}
        onChange={kind => update({ value: kind === 'number' ? 0 : kind === 'yes-no' ? true : kind === 'json' ? {} : '' })}/>
      {literalKind(value.value) === 'text' && <TextField label={`${label} text`} value={value.value} maxLength={2000} onChange={next => update({ value: next })}/>}
      {literalKind(value.value) === 'number' && <NumberField label={`${label} number`} value={value.value} min={-1e12} max={1e12} step={0.01} onChange={next => update({ value: next })}/>}
      {literalKind(value.value) === 'yes-no' && <label className="checkbox-field"><input type="checkbox" checked={value.value} onChange={event => update({ value: event.target.checked })}/>{label} is yes</label>}
      {literalKind(value.value) === 'json' && <JsonLiteral label={`${label} JSON`} value={value.value} onChange={next => update({ value: next })}/>}
    </>}
    {value.type === 'read' && <>
      <SelectField label={`${label} source`} value={value.from.sourceId} options={sourceOptions(document)} onChange={sourceId => update({ from: { ...value.from, sourceId } })}/>
      <PathField value={value.from.path} onChange={path => update({ from: { ...value.from, path } })}/>
      <SelectField label={`${label} as`} value={value.as} options={['string', 'number', 'boolean', 'entity-id']} onChange={as => update({ as })}/>
    </>}
    {value.type === 'viewer' && <SelectField label={`${label} viewer fact`} value={value.field} options={['userId', 'isAdmin', 'personEntityId']} onChange={field => update({ field })}/>}
    {value.type === 'format' && <>
      <TextField label={`${label} pattern`} value={value.pattern} maxLength={2000} onChange={pattern => update({ pattern })}/>
      <p className="field-note">Write {'{name}'} where an argument goes; each hole needs an argument below.</p>
      {entries(value.args, 'args')}
    </>}
    {value.type === 'map' && <>
      <OperandEditor {...ctx} label="Compare" value={value.of} allowControl={allowControl} onChange={of => update({ of })}/>
      <fieldset className="composition-fieldset"><legend>Cases ({value.cases.length})</legend>
        {value.cases.map((entry: Loose, index: number) => <div key={index}>
          <TextField label={`Case ${index + 1} equals`} value={String(entry.equals)} onChange={text => update({ cases: value.cases.map((old: Loose, i: number) => i === index ? { ...old, equals: scalar(text) } : old) })}/>
          <OperandEditor {...ctx} label={`Case ${index + 1} result`} value={entry.then} allowControl={allowControl}
            onChange={then => update({ cases: value.cases.map((old: Loose, i: number) => i === index ? { ...old, then } : old) })}/>
          <button type="button" aria-label={`Remove case ${index + 1}`} onClick={() => update({ cases: value.cases.filter((_: Loose, i: number) => i !== index) })}>Remove</button>
        </div>)}
        <button type="button" className="add-button" disabled={value.cases.length >= 32} onClick={() => update({ cases: [...value.cases, { equals: '', then: defaultOperand('literal', ctx) }] })}>Add case</button>
      </fieldset>
      <OperandEditor {...ctx} label="Otherwise" value={value.otherwise} allowControl={allowControl} onChange={otherwise => update({ otherwise })}/>
    </>}
    {value.type === 'math' && <>
      <SelectField label={`${label} operation`} value={value.op} options={[...mathOperations]} onChange={op => update({ op })}/>
      {op(value.op)}
      {list(value.args, 'args', 8)}
    </>}
    {value.type === 'object' && entries(value.fields, 'fields')}
    {value.type === 'list' && list(value.items, 'items', 64)}
  </fieldset>;
}
const op = (name: string) => <p className="field-note">{name === 'scale' ? 'scale takes value, from min, from max, to min, to max.' : name === 'clamp' ? 'clamp takes value, minimum, maximum.' : name === 'round' ? 'round takes a value and optional decimal places.' : 'Arguments are numbers (a text that reads as a number counts).'}</p>;
const scalar = (text: string): string | number | boolean => text === 'true' ? true : text === 'false' ? false : text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
function JsonLiteral({ label, value, onChange }: { label: string; value: Json; onChange: Change }) {
  const [text, setText] = useState(JSON.stringify(value));
  const [error, setError] = useState('');
  return <Field label={label} hint={error || 'A JSON object, array, number, text or yes/no.'}>
    <textarea className="code-input" value={text} aria-invalid={Boolean(error)} onChange={event => {
      setText(event.target.value);
      try { const parsed = JSON.parse(event.target.value) as Json; if (parsed === null) throw new Error('null is not allowed.'); onChange(parsed); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }}/>
  </Field>;
}

/** A name to editor dictionary with add and remove. */
function Entries({ label, record, onChange, render, fresh }: { label: string; record: Loose; onChange: Change; render: (name: string, value: Loose, set: Change) => React.ReactNode; fresh: () => Json }) {
  const [name, setName] = useState('');
  const names = Object.keys(record);
  const valid = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !names.includes(name);
  return <fieldset className="composition-fieldset"><legend>{label} ({names.length})</legend>
    {names.map(key => <div key={key}>
      {render(key, record[key], next => onChange({ ...record, [key]: next }))}
      <button type="button" aria-label={`Remove ${key}`} onClick={() => { const next = { ...record }; delete next[key]; onChange(next); }}>Remove</button>
    </div>)}
    <TextField label={`New ${label.toLowerCase().replace(/s$/, '')} name`} value={name} onChange={setName}/>
    <button type="button" className="add-button" disabled={!valid} onClick={() => { onChange({ ...record, [name]: fresh() }); setName(''); }}>Add {label.toLowerCase().replace(/s$/, '')}</button>
  </fieldset>;
}

// MARK: Conditions

const predicateTypes = ['state', 'numeric', 'viewer', 'viewer-person', 'all', 'any', 'not'] as const;
/** A fresh condition of `type`. */
export function defaultPredicate(type: string, { document }: Context): Loose {
  const sourceId = haSources(document)[0]?.id ?? '';
  switch (type) {
    case 'numeric': return { type, sourceId, path: ['state'], above: { type: 'literal', value: 0 } };
    case 'viewer': return { type, isAdmin: true };
    case 'viewer-person': return { type, in: ['home'] };
    case 'all': case 'any': return { type, of: [defaultPredicate('state', { document })] };
    case 'not': return { type, of: defaultPredicate('state', { document }) };
    default: return { type: 'state', sourceId, path: ['state'], in: ['on'] };
  }
}
const predicateLabel: Record<string, string> = { state: 'entity state is', numeric: 'entity number is', viewer: 'the person is', 'viewer-person': "the person's presence is", all: 'all of', any: 'any of', not: 'not' };

/** Builds a condition for `visibleWhen`, `selectedWhen` and a toggle's `isOn`: state, number, viewer and presence tests joined by all, any and not. */
export function PredicateBuilder({ label, value, onChange, document }: Context & { label: string; value: Loose; onChange: Change }) {
  const ctx = { document };
  const update = (patch: Loose) => onChange({ ...value, ...patch });
  return <fieldset className="composition-fieldset condition-builder"><legend>{label}</legend>
    <SelectField label={`${label} condition`} value={value.type} options={predicateTypes.map(type => ({ value: type, label: predicateLabel[type] }))}
      onChange={type => onChange(type === value.type ? value : defaultPredicate(type, ctx))}/>
    {(value.type === 'state' || value.type === 'numeric') && <>
      <SelectField label={`${label} source`} value={value.sourceId} options={sourceOptions(document)} onChange={sourceId => update({ sourceId })}/>
      <PathField value={value.path} onChange={path => update({ path })}/>
    </>}
    {value.type === 'state' && <TextField label={`${label} states (comma separated)`} value={csv(value.in)} onChange={text => update({ in: parseCsv(text) })}/>}
    {value.type === 'numeric' && (['above', 'below'] as const).map(side => value[side]
      ? <div key={side}><OperandEditor {...ctx} label={`Is ${side}`} value={value[side]} onChange={next => update({ [side]: next })}/>
        <button type="button" aria-label={`Remove ${side}`} onClick={() => { const next = { ...value }; delete next[side]; onChange(next); }}>Remove {side}</button></div>
      : <button type="button" key={side} className="add-button" onClick={() => update({ [side]: { type: 'literal', value: 0 } })}>Add {side} bound</button>)}
    {value.type === 'viewer' && <>
      <SelectField label={`${label} administrator`} value={value.isAdmin === undefined ? 'any' : String(value.isAdmin)}
        options={[{ value: 'any', label: 'Not tested' }, { value: 'true', label: 'Is an administrator' }, { value: 'false', label: 'Is not an administrator' }]}
        onChange={next => { const copy = { ...value }; if (next === 'any') delete copy.isAdmin; else copy.isAdmin = next === 'true'; onChange(copy); }}/>
      <TextField label={`${label} user ids (comma separated)`} value={csv(value.userIds)} onChange={text => { const ids = parseCsv(text), copy = { ...value }; if (ids.length) copy.userIds = ids; else delete copy.userIds; onChange(copy); }}/>
    </>}
    {value.type === 'viewer-person' && <TextField label={`${label} presence states (comma separated)`} value={csv(value.in)} onChange={text => update({ in: parseCsv(text) })}/>}
    {(value.type === 'all' || value.type === 'any') && <>
      {value.of.map((part: Loose, index: number) => <div key={index}>
        <PredicateBuilder {...ctx} label={`${label} ${index + 1}`} value={part} onChange={next => update({ of: value.of.map((old: Loose, i: number) => i === index ? next : old) })}/>
        <button type="button" aria-label={`Remove ${label} ${index + 1}`} disabled={value.of.length < 2} onClick={() => update({ of: value.of.filter((_: Loose, i: number) => i !== index) })}>Remove</button>
      </div>)}
      <button type="button" className="add-button" disabled={value.of.length >= 16} onClick={() => update({ of: [...value.of, defaultPredicate('state', ctx)] })}>Add condition</button>
    </>}
    {value.type === 'not' && <PredicateBuilder {...ctx} label={`${label} (negated)`} value={value.of} onChange={of => update({ of })}/>}
  </fieldset>;
}

// MARK: Confirmation

/** Edits a call's confirmation: none (send at once) or an alert or dialog, with the people who skip it. */
export function ConfirmationEditor({ value, onChange }: { value: Loose | undefined; onChange: (value: Json | undefined) => void }) {
  const additional = value?.type === 'additional';
  const update = (patch: Loose) => onChange({ ...value, ...patch });
  return <fieldset className="composition-fieldset"><legend>Confirmation</legend>
    <SelectField label="Ask before sending" value={additional ? 'additional' : 'none'} options={[{ value: 'none', label: 'Send at once' }, { value: 'additional', label: 'Ask first' }]}
      onChange={next => onChange(next === 'none' ? undefined : { type: 'additional', style: 'alert', title: 'Are you sure?', confirmLabel: 'Confirm', cancelLabel: 'Cancel', destructive: false })}/>
    {additional && <>
      <SelectField label="Style" value={value!.style} options={['alert', 'dialog']} onChange={style => update({ style })}/>
      <TextField label="Confirmation title" value={value!.title} maxLength={240} onChange={title => update({ title })}/>
      <TextField label="Confirmation message" value={value!.message ?? ''} maxLength={2000} onChange={message => { const copy = { ...value }; if (message) copy.message = message; else delete copy.message; onChange(copy); }}/>
      <TextField label="Confirm button" value={value!.confirmLabel} maxLength={240} onChange={confirmLabel => update({ confirmLabel })}/>
      <label className="checkbox-field"><input type="checkbox" checked={Boolean(value!.destructive)} onChange={event => update({ destructive: event.target.checked })}/>Destructive (red) confirm button</label>
      <TextField label="Skip for these user ids (comma separated)" value={csv(value!.exemptUserIds)} onChange={text => { const ids = parseCsv(text), copy = { ...value }; if (ids.length) copy.exemptUserIds = ids; else delete copy.exemptUserIds; onChange(copy); }}/>
    </>}
  </fieldset>;
}

// MARK: Service call

/** A fresh call-service action. */
export const defaultCallService = (): Loose => ({ type: 'call-service', domain: 'light', service: 'turn_on' });

/**
 * Edits an authored Home Assistant service call: any domain and service, a target (entity pick-list from the Studio's Home Assistant
 * connection, or a bound value), data fields built from operands, optimistic state and a confirmation. Runs only on a tap.
 */
export function CallServiceEditor({ label, value, onChange, document, allowControl = false }: Context & { label: string; value: Loose; onChange: Change; allowControl?: boolean }) {
  const ctx = { document };
  const update = (patch: Loose) => onChange({ ...value, ...patch });
  const without = (key: string) => { const copy = { ...value }; delete copy[key]; onChange(copy); };
  const domainListId = `domains-${label.replace(/\W/g, '')}`, serviceListId = `services-${label.replace(/\W/g, '')}`;
  const target: Loose = value.target ?? {};
  const setTarget = (next: Loose) => { if (Object.keys(next).length) update({ target: next }); else without('target'); };
  const warnings = callServiceWarnings(value);
  const optimistic: Loose[] = value.optimistic ?? [];
  return <fieldset className="composition-fieldset"><legend>{label}: call a service</legend>
    <div className="field-pair">
      <Field label="Domain"><input value={value.domain} list={domainListId} onChange={event => update({ domain: event.target.value })}/><datalist id={domainListId}>{Object.keys(commonServices).map(name => <option key={name} value={name}/>)}</datalist></Field>
      <Field label="Service"><input value={value.service} list={serviceListId} onChange={event => update({ service: event.target.value })}/><datalist id={serviceListId}>{(commonServices[value.domain] ?? []).map(name => <option key={name} value={name}/>)}</datalist></Field>
    </div>
    <p className="field-note">Any domain, service or script. Home Assistant decides what the signed-in person may call. Runs only when the person taps.</p>
    <fieldset className="composition-fieldset"><legend>Target</legend>
      {callTargetKeys.map(key => {
        const operand = target[key];
        if (!operand) return <button type="button" key={key} className="add-button" onClick={() => setTarget({ ...target, [key]: key === 'entity_id' ? { type: 'literal', value: '' } : { type: 'literal', value: '' } })}>Add {key}</button>;
        const entity = key === 'entity_id' && operand.type === 'literal' && typeof operand.value === 'string';
        return <div key={key}>
          {entity ? <EntityPicker label="Entity" value={operand.value} onChange={next => setTarget({ ...target, [key]: { type: 'literal', value: next } })}/>
            : <OperandEditor {...ctx} label={key} value={operand} allowControl={allowControl} onChange={next => setTarget({ ...target, [key]: next })}/>}
          {key === 'entity_id' && <button type="button" onClick={() => setTarget({ ...target, [key]: entity ? defaultOperand('read', ctx) : { type: 'literal', value: '' } })}>{entity ? 'Use a bound value' : 'Pick an entity'}</button>}
          <button type="button" aria-label={`Remove ${key}`} onClick={() => { const next = { ...target }; delete next[key]; setTarget(next); }}>Remove {key}</button>
        </div>;
      })}
    </fieldset>
    {value.data
      ? <><Entries label="Data fields" record={value.data.fields} onChange={fields => update({ data: { type: 'object', fields } })}
          render={(name, item, set) => <OperandEditor {...ctx} label={name} value={item} allowControl={allowControl} onChange={set}/>} fresh={() => defaultOperand('literal', ctx)}/>
        <button type="button" onClick={() => without('data')}>Remove data</button></>
      : <button type="button" className="add-button" onClick={() => update({ data: { type: 'object', fields: {} } })}>Add service data</button>}
    <fieldset className="composition-fieldset"><legend>Optimistic state ({optimistic.length})</legend>
      {optimistic.map((entry, index) => {
        const set = (patch: Loose) => update({ optimistic: optimistic.map((old, i) => i === index ? { ...old, ...patch } : old) });
        return <div key={index}>
          <SelectField label={`Show on source ${index + 1}`} value={entry.sourceId} options={sourceOptions(document)} onChange={sourceId => set({ sourceId })}/>
          <TextField label={`Shown state ${index + 1}`} value={entry.value} maxLength={160} onChange={next => set({ value: next })}/>
          <NumberField label={`Revert after seconds ${index + 1}`} value={entry.revertAfterSeconds} min={0.1} max={60} step={0.1} onChange={seconds => set({ revertAfterSeconds: seconds })}/>
          <label className="checkbox-field"><input type="checkbox" checked={entry.failsOnTimeout} onChange={event => set({ failsOnTimeout: event.target.checked })}/>Show failure when it times out</label>
          <button type="button" aria-label={`Remove optimistic ${index + 1}`} onClick={() => { const rest = optimistic.filter((_, i) => i !== index); if (rest.length) update({ optimistic: rest }); else without('optimistic'); }}>Remove</button>
        </div>;
      })}
      <button type="button" className="add-button" disabled={optimistic.length >= 16} onClick={() => update({ optimistic: [...optimistic, { sourceId: haSources(document)[0]?.id ?? '', value: 'on', revertAfterSeconds: 2, failsOnTimeout: false }] })}>Add optimistic state</button>
    </fieldset>
    <ConfirmationEditor value={value.confirmation} onChange={next => { if (next) update({ confirmation: next }); else without('confirmation'); }}/>
    {warnings.map(warning => <p key={warning.message} role="status" className="safety-note">{warning.message}</p>)}
  </fieldset>;
}
