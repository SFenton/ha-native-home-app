import { useEffect, useState } from 'react';
import { Field, NumberField, SelectField, TextField } from '../../ui';
import { replaceAt } from '../../composition-editor';
import { usePush } from '../kit';
import { useRows } from '../rows';
import { Disclosure } from '../Disclosure';
import { createId as uid } from '../../shared/ids';
import type { LocalField } from '../../shared/composition/shell';
import { FieldRow, PushRow } from './parts';
import { kindOrder, kindWords, newLocalState, renameLocalState, startingState, startingValue } from './states';

const validName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/** A state's name: typed freely, applied (with every place that names it) only when it is a valid name nothing else has. */
function NameRow({ id }: { id: string }) {
  const { document, onChange } = useRows();
  const [text, setText] = useState(id);
  useEffect(() => setText(id), [id]);
  const taken = text !== id && (document.localState ?? []).some(field => field.id === text);
  const hint = !validName.test(text) ? 'Use letters, numbers, dots, dashes and underscores.' : taken ? 'Another state has this name.' : undefined;
  const index = (document.localState ?? []).findIndex(field => field.id === id);
  return <FieldRow path={['localState', index, 'id']}>
    <Field label="Name" hint={hint}><input value={text} aria-invalid={Boolean(hint) || undefined} onChange={event => {
      setText(event.target.value);
      if (validName.test(event.target.value) && !(document.localState ?? []).some(field => field.id === event.target.value)) onChange(renameLocalState(document, id, event.target.value));
    }}/></Field>
  </FieldRow>;
}

/** One state's fields: Name, Kind, Options (for a choice), Starting value, and the limits under Advanced. */
function StateFields({ id }: { id: string }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const index = (document.localState ?? []).findIndex(field => field.id === id);
  const field = (document.localState ?? [])[index];
  if (!field) return null;
  const set = (next: LocalField) => onChange(replaceAt(document, ['localState', index], next));
  const options = field.type === 'choice' ? field.options : [];
  return <>
    <NameRow id={id}/>
    <FieldRow path={['localState', index, 'type']}><SelectField label="Kind" value={field.type} options={kindOrder.map(kind => ({ value: kind, label: kindWords[kind] }))}
      onChange={kind => set(startingState(id, kind as LocalField['type']))}/></FieldRow>
    {field.type === 'choice' && <FieldRow path={['localState', index, 'options']}>
      <div className="w2-subform" role="group" aria-label="Options"><h3 className="w2-group-title">Options</h3>
        {options.map((option, at) => <div key={option.id} className="w2-option-row">
          <TextField label={`Option ${at + 1}`} value={option.label} maxLength={80} onChange={label => set({ ...field, options: options.map((item, i) => i === at ? { ...item, label } : item) })}/>
          <button type="button" aria-label={`Remove ${option.label}`} disabled={options.length <= 2} onClick={() => {
            const rest = options.filter((_, i) => i !== at);
            set({ ...field, options: rest, initial: field.initial === option.id ? rest[0].id : field.initial });
            }}>Remove</button>
        </div>)}
        <button type="button" disabled={options.length >= 12} onClick={() => set({ ...field, options: [...options, { id: uid('option'), label: `Option ${options.length + 1}` }] })}>Add Option</button>
      </div></FieldRow>}
    <FieldRow path={['localState', index, 'initial']}>
      {field.type === 'boolean' && <label className="w2-switch-row"><span className="w2-row-label">Starting value</span><input type="checkbox" role="switch" checked={field.initial} onChange={event => set({ ...field, initial: event.target.checked })}/></label>}
      {field.type === 'choice' && <SelectField label="Starting value" value={field.initial} options={options.map(option => ({ value: option.id, label: option.label }))} onChange={initial => set({ ...field, initial })}/>}
      {field.type === 'number' && <NumberField label="Starting value" value={field.initial} min={field.minimum} max={field.maximum} step={field.step} onChange={initial => set({ ...field, initial })}/>}
      {field.type === 'string' && <TextField label="Starting value" value={field.initial} maxLength={field.maxLength} onChange={initial => set({ ...field, initial })}/>}
    </FieldRow>
    {(field.type === 'number' || field.type === 'string') && <Disclosure label="Advanced" path={`localState/${index}/limits`}>
      {field.type === 'number' && <>
        <FieldRow path={['localState', index, 'minimum']}><NumberField label="Smallest" value={field.minimum} min={-1000000} max={1000000} step={0.000001} onChange={minimum => set({ ...field, minimum })}/></FieldRow>
        <FieldRow path={['localState', index, 'maximum']}><NumberField label="Largest" value={field.maximum} min={-1000000} max={1000000} step={0.000001} onChange={maximum => set({ ...field, maximum })}/></FieldRow>
        <FieldRow path={['localState', index, 'step']}><NumberField label="Step" value={field.step} min={0.000001} max={1000000} step={0.000001} onChange={step => set({ ...field, step })}/></FieldRow>
      </>}
      {field.type === 'string' && <FieldRow path={['localState', index, 'maxLength']}><NumberField label="Longest" value={field.maxLength} min={1} max={16384} step={1} onChange={maxLength => set({ ...field, maxLength })}/></FieldRow>}
    </Disclosure>}
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => { onChange({ ...document, localState: (document.localState ?? []).filter(item => item.id !== id) }); push?.pop(); }}>Remove State</button></div>
  </>;
}

/** Project > Local State (spec 5.7): each state's name, kind and starting value; a row pushes its fields. */
export default function LocalState() {
  const { document, onChange } = useRows();
  const push = usePush();
  const states = document.localState ?? [];
  const add = () => {
    const made = newLocalState(document);
    onChange({ ...document, localState: [...states, made] });
    push?.push({ title: made.id, body: <StateFields id={made.id}/> });
  };
  return <div className="w2-local-state">
    <p className="w2-caption">Kept on this device while a page is open. Not saved to Home Assistant.</p>
    {states.length === 0 ? <p className="w2-empty">No local state.</p> : <ul className="w2-list">{states.map(field =>
      <PushRow key={field.id} title={field.id} detail={`${kindWords[field.type]} · ${startingValue(field)}`} plain onOpen={() => push?.push({ title: field.id, body: <StateFields id={field.id}/> })}/>)}</ul>}
    <div className="w2-actions"><button type="button" onClick={add}>Add State</button></div>
  </div>;
}
