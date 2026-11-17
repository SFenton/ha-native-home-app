import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { valueAt } from '../composition-editor';
import type { IndexEntry } from '../preview2/model';
import type { ComponentEntry, ComponentRefNode, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { TextInput, LabeledRow } from './editors/controls';
import { sourceName } from './dialogs/sources';
import { mechanicalLabel } from './labels';
import { ownStateField } from './linked';
import {
  addParameter, bindableFields, bindingWords, defaultOf, kindWords, labelValid, nameProblem, PARAM_LABEL_MAX, paramLabel, removeParameter, setArgument, setParamLabel, suggestName,
} from './params';
import ChoiceField, { type Choice } from './pickers/ChoiceField';
import { PickerRow, IconField } from './pickers/PickerField';
import EntityList from './pickers/EntityList';
import { useWorkspaceData } from './pickers/WorkspaceData';
import type { Workspace2 } from './useWorkspace2';

/**
 * The settings of a template in the inspector (templates spec 3a), in the rows the inspector already has.
 *
 * - On the root of a place: {@link TemplateSettings}, one row for each parameter under its label, the place's own value, with the picker the kind
 *   already has elsewhere (entity, state, data source, page, sheet, symbol) or a text field. A change is this place's alone, so it never asks.
 * - On any node of the template: {@link TemplateParameters}, the author's list of parameters, each opening in place to its label and Remove Parameter,
 *   and Add Parameter… to mark one more field of the selected node. Changing the list changes the template, so it goes through the edit question.
 */
export default function ComponentParams({ ws, document, entry, onError }: { ws: Workspace2; document: CompositionDocument; entry: IndexEntry; onError: (message: string) => void }) {
  const component = document.componentLibrary?.find(item => item.id === entry.component);
  if (!component) return null;
  return ws.mode === 'edit' ? <TemplateParameters ws={ws} document={document} component={component} entry={entry} onError={onError}/> : null;
}

// MARK: - Settings of a place

/** The domain an entity id sits in, as a chip preset (`light.demo_lamp` is `light`); none for an id that is not one. */
const domainOf = (id: string): string[] => /^[a-z][a-z0-9_]*\./.test(id) ? [id.slice(0, id.indexOf('.'))] : [];

/**
 * One row for each parameter: this place's value, under the parameter's label. The block has no heading: these are the place's own settings, like any
 * element's fields. Entity settings list every entity with the default's domain chip pressed (a person can widen it); state settings come last.
 */
export function TemplateSettings({ ws, document, component, refPath, onError }: { ws: Workspace2; document: CompositionDocument; component: ComponentEntry; refPath: (string | number)[]; onError: (message: string) => void }) {
  const ref = valueAt(document, refPath) as ComponentRefNode;
  const set = (name: string, value: string) => { try { ws.studio.apply(setArgument(document, refPath, name, value)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const params = [...component.params!].sort((a, b) => Number(a.kind === 'state-id') - Number(b.kind === 'state-id'));
  return <section className="w2-group" data-group="parameters" aria-label="Settings" data-testid="component-settings">
    {params.map(param => {
      const label = paramLabel(param), value = ref.args?.[param.name] ?? defaultOf(component, param.name);
      if (param.kind === 'text') return <LabeledRow key={param.name} label={label}><TextInput label={label} value={value} maxLength={240} onCommit={next => set(param.name, next)}/></LabeledRow>;
      if (param.kind === 'symbol') return <IconField key={param.name} label={label} symbol={value} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
      if (param.kind === 'entity-id') return <EntitySetting key={param.name} label={label} value={value} domains={domainOf(defaultOf(component, param.name))} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
      if (param.kind === 'state-id') return <StateSetting key={param.name} ws={ws} document={document} component={component} refPath={refPath} name={param.name} label={label} value={value} onError={onError}/>;
      const choices: Choice[] = param.kind === 'source-id' ? document.dataSources.map(source => ({ id: source.id, label: sourceName(source), detail: source.id }))
        : (param.kind === 'page-id' ? document.pages : document.modals).map(item => ({ id: item.id, label: item.title }));
      return <ChoiceField key={param.name} label={label} title={`${kindWords[param.kind]} for ${label}`} choices={choices} value={value} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
    })}
  </section>;
}

/** The Studio's entity row (the name over the id) and its picker page; the template default's domain chip is pressed on, not restricted. */
function EntitySetting({ label, value, domains, onPick, path }: { label: string; value: string; domains: string[]; onPick: (entityId: string) => void; path: string }) {
  const { entities } = useWorkspaceData();
  const row = entities.find(item => item.entityId === value);
  const name = row?.name ?? value;
  return <PickerRow label={label} title={`Entity for ${label}`} path={path} primary={value ? name : <span className="w2-placeholder">Choose</span>} secondary={value && name !== value ? value : undefined}>
    {close => <EntityList domains={domains} kind="template" onPick={picked => { onPick(picked.entityId); close(); }}/>}
  </PickerRow>;
}

/** The id of the choice that stands for "This Place's Own", before the place has a field of its own. */
const OWN = '__own__';

/**
 * A state setting: "This Place’s Own" (the default; a place gets its own copy of the template's field when it is added) or another local state to share.
 * A field counts as the place's own when no other place of the template uses it and it is not the template's default.
 */
function StateSetting({ ws, document, component, refPath, name, label, value, onError }: { ws: Workspace2; document: CompositionDocument; component: ComponentEntry; refPath: (string | number)[]; name: string; label: string; value: string; onError: (message: string) => void }) {
  const base = defaultOf(component, name);
  const fields = document.localState ?? [];
  const shape = fields.find(field => field.id === base);
  const fits = (id: string) => { const field = fields.find(item => item.id === id); return Boolean(field) && (!shape || (field!.type === shape.type && JSON.stringify((field as { options?: unknown }).options) === JSON.stringify((shape as { options?: unknown }).options))); };
  const usedElsewhere = (id: string) => id === base || sharedWithOthers(document, component.id, refPath, name, id);
  const own = !usedElsewhere(value) && fits(value);
  const ownChoice: Choice = { id: own ? value : OWN, label: 'This Place’s Own' };
  const shared: Choice[] = fields.filter(field => fits(field.id) && field.id !== (own ? value : '')).map(field => ({ id: field.id, label: `Shared: ${mechanicalLabel(field.id)}` }));
  const pick = (id: string) => {
    try {
      if (id !== OWN) { ws.studio.apply(setArgument(document, refPath, name, id)); return; }
      const made = ownStateField(document, value || base);
      if (!made) return;
      ws.studio.apply(setArgument({ ...document, localState: [...fields, made.field] }, refPath, name, made.id));
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <ChoiceField label={label} title={`State for ${label}`} choices={[ownChoice, ...shared]} value={own ? value : fits(value) ? value : OWN} onPick={pick} path={`args/${name}`}/>;
}

/** Whether another place of the template holds `id` for this setting. */
function sharedWithOthers(document: CompositionDocument, entryId: string, refPath: (string | number)[], name: string, id: string): boolean {
  const here = refPath.join('/');
  const holds = (nodes: CompositionNode[], path: (string | number)[]): boolean => nodes.some((node, index) => {
    const at = [...path, index];
    if (node.type === 'component-ref') return node.componentId === entryId && at.join('/') !== here && node.args?.[name] === id;
    const kids = (node as { children?: CompositionNode[] }).children;
    const tabs = (node as { tabs?: { children: CompositionNode[] }[] }).tabs;
    return (kids ? holds(kids, [...at, 'children']) : false) || (tabs ? tabs.some((tab, position) => holds(tab.children, [...at, 'tabs', position, 'children'])) : false);
  });
  return (['pages', 'modals'] as const).some(kind => document[kind].some((surface, index) => holds(surface.components, [kind, index, 'components'])));
}

// MARK: - Parameters (authoring)

/** The template's parameters, each opening in place, and a form to mark one more field of the selected node. */
export function TemplateParameters({ ws, document, component, entry, onError }: { ws: Workspace2; document: CompositionDocument; component: ComponentEntry; entry: IndexEntry; onError: (message: string) => void }) {
  const node = valueAt(document, entry.bodyPath ?? entry.path) as CompositionNode | undefined;
  const fields = useMemo(() => node && node.type !== 'component-ref' ? bindableFields(node, component) : [], [node, component]);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<string>();
  const [field, setField] = useState('');
  const [name, setName] = useState('');
  const nameId = useId(), errorId = useId(), fieldId = useId();
  const params = component.params ?? [];
  const chosen = fields.find(item => item.field === field) ?? fields[0];
  const problem = chosen && name ? nameProblem(component, name, chosen.kind) : undefined;
  const run = (change: () => CompositionDocument) => { try { ws.studio.apply(change()); return true; } catch (error) { onError(error instanceof Error ? error.message : String(error)); return false; } };
  const begin = () => { setOpen(true); if (fields[0]) { setField(fields[0].field); setName(suggestName(component, fields[0])); } };
  const choose = (next: string) => { setField(next); const found = fields.find(item => item.field === next); if (found) setName(suggestName(component, found)); };
  if (!params.length && !fields.length) return null;
  return <section className="w2-group" data-group="component-parameters" aria-label="Parameters" data-testid="component-parameters">
    <h3 className="w2-group-title">{params.length ? `Parameters (${params.length})` : 'Parameters'}</h3>
    {params.length > 0 && <ul className="w2-param-list">
      {params.map(param => <ParameterRow key={param.name} component={component} param={param} open={opened === param.name} onToggle={() => setOpened(opened === param.name ? undefined : param.name)}
        onLabel={label => run(() => setParamLabel(document, component.id, param.name, label))} onRemove={() => { run(() => removeParameter(document, component.id, param.name)); setOpened(undefined); }}/>)}
    </ul>}
    {!open && <button type="button" className="w2-param-add" disabled={!fields.length} onClick={begin}
      title={!fields.length ? 'This element has no field a parameter can fill.' : undefined}>Add Parameter…</button>}
    {open && chosen && <form className="w2-param-form" onSubmit={event => { event.preventDefault(); if (problem || !node) return; if (run(() => addParameter(document, component.id, node.id, chosen.field, name.trim()))) setOpen(false); }}>
      <label className="w2-param-field" htmlFor={fieldId}><span className="w2-row-label">Field</span>
        <select id={fieldId} value={chosen.field} onChange={event => choose(event.target.value)}>
          {fields.map(item => <option key={item.field} value={item.field}>{`${item.label} · ${kindWords[item.kind]}`}</option>)}
        </select></label>
      <label className="w2-param-field" htmlFor={nameId}><span className="w2-row-label">Name</span>
        <input id={nameId} value={name} maxLength={80} onChange={event => setName(event.target.value)} aria-invalid={problem ? true : undefined} aria-describedby={problem ? errorId : undefined}/></label>
      {problem && <p id={errorId} role="alert" className="w2-field-error">{problem}</p>}
      <div className="w2-param-actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="w2-primary" disabled={!name || Boolean(problem)}>Add</button></div>
    </form>}
  </section>;
}

/**
 * One parameter: its label over what it fills ("Entity · Fills Entity of Light and 1 more"). Pressed, it opens in place to a Label field, the line
 * that says what it fills, and Remove Parameter.
 */
function ParameterRow({ component, param, open, onToggle, onLabel, onRemove }: { component: ComponentEntry; param: NonNullable<ComponentEntry['params']>[number]; open: boolean; onToggle: () => void; onLabel: (label: string) => void; onRemove: () => void }) {
  const body = useId(), labelId = useId(), errorId = useId();
  const [text, setText] = useState(param.label ?? '');
  const invalid = text.trim().length > 0 && !labelValid(text);
  const where = bindingWords(component, param.name);
  const commit = () => { if (!invalid && text.trim() !== (param.label ?? '')) onLabel(text); };
  return <li className="w2-param-item" data-param={param.name} data-open={open || undefined}>
    <button type="button" className="w2-param-row w2-param-head" aria-expanded={open} aria-controls={body} onClick={onToggle}>
      <span className="w2-param-text"><span className="w2-param-name">{paramLabel(param)}</span><span className="w2-param-where">{kindWords[param.kind]}</span></span>
      {open ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {open && <div id={body} className="w2-param-open">
      <label className="w2-param-field" htmlFor={labelId}><span className="w2-row-label">Label</span>
        <input id={labelId} value={text} maxLength={PARAM_LABEL_MAX} placeholder={paramLabel({ name: param.name })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
          onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}/></label>
      {invalid && <p id={errorId} role="alert" className="w2-field-error">{`Name the setting in 1 to ${PARAM_LABEL_MAX} characters`}</p>}
      <p className="w2-caption">{`Fills ${where}`}</p>
      <button type="button" className="w2-danger" onClick={onRemove}>Remove Parameter</button>
    </div>}
  </li>;
}
