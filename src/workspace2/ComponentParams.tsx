import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { valueAt } from '../composition-editor';
import type { IndexEntry } from '../preview2/model';
import type { ComponentEntry, ComponentRefNode, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { TextInput, LabeledRow } from './editors/controls';
import { pairingOf, pairSource, sourceEntity } from './add/sources';
import { sourceName } from './dialogs/sources';
import { mechanicalLabel } from './labels';
import { ownStateField } from './linked';
import { bindingWords, defaultOf, kindWords, labelValid, PARAM_LABEL_MAX, paramLabel, removeParameter, setArgument, setParamLabel } from './params';
import PlaceValueRow from './PlaceValueRow';
import { ChooseFieldsButton } from './ChooseFields';
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
 * - On any node of the template: {@link TemplateParameters}, the author's list of what each place sets, each opening in place to its label and Remove
 *   Setting. Fields are marked from Choose Fields (`ChooseFields.tsx`). Changing the list changes the template, so it goes through the edit question.
 */
export default function ComponentParams({ ws, document, entry, onError }: { ws: Workspace2; document: CompositionDocument; entry: IndexEntry; onError: (message: string) => void }) {
  const component = document.componentLibrary?.find(item => item.id === entry.component);
  if (!component) return null;
  const path = entry.bodyPath ?? entry.path, node = valueAt(document, path) as CompositionNode | undefined;
  return ws.mode === 'edit' ? <>
    {node && node.type !== 'component-ref' && <ChooseFieldsButton document={document} component={component} node={node} path={path}/>}
    <TemplateParameters ws={ws} document={document} component={component} entry={entry} onError={onError}/>
  </> : null;
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
      if (param.kind === 'value') return <PlaceValueRow key={param.name} document={document} component={component} refPath={refPath} param={param} say={ws.linked.say} onChange={next => ws.studio.apply(next)} onError={onError}/>;
      if (param.kind === 'text') return <LabeledRow key={param.name} label={label}><TextInput label={label} value={value} maxLength={240} onCommit={next => set(param.name, next)}/></LabeledRow>;
      if (param.kind === 'symbol') return <IconField key={param.name} label={label} symbol={value} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
      if (param.kind === 'entity-id') return <EntitySetting key={param.name} label={label} value={value} domains={domainOf(defaultOf(component, param.name))} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
      if (param.kind === 'state-id') return <StateSetting key={param.name} ws={ws} document={document} component={component} refPath={refPath} name={param.name} label={label} value={value} onError={onError}/>;
      const pairing = param.kind === 'source-id' ? pairingOf(document, component, param.name) : undefined;
      if (pairing) {
        // The pairing step: the place names an entity, and the Studio finds or makes the model source that reads it (one document, one undo step).
        const only = params.filter(item => item.kind === 'source-id' && pairingOf(document, component, item.name)).length === 1;
        const entityId = sourceEntity(document.dataSources.find(source => source.id === value)) ?? '';
        const pair = (picked: string) => {
          try { const made = pairSource(document, component, param.name, picked); ws.studio.apply(setArgument(made.document, refPath, param.name, made.sourceId)); }
          catch (error) { onError(error instanceof Error ? error.message : String(error)); }
        };
        const preset = pairing.domains ? [...pairing.domains] : domainOf(sourceEntity(document.dataSources.find(source => source.id === defaultOf(component, param.name))) ?? '');
        return <EntitySetting key={param.name} label={only ? 'Entity' : `${label} Entity`} title={only ? 'Entity' : `Entity for ${label}`} value={entityId} domains={preset} restrict={pairing.domains} onPick={pair} path={`args/${param.name}`}/>;
      }
      const choices: Choice[] = param.kind === 'source-id' ? document.dataSources.map(source => ({ id: source.id, label: sourceName(source), detail: source.id }))
        : (param.kind === 'page-id' ? document.pages : document.modals).map(item => ({ id: item.id, label: item.title }));
      return <ChoiceField key={param.name} label={label} title={`${kindWords[param.kind]} for ${label}`} choices={choices} value={value} onPick={next => set(param.name, next)} path={`args/${param.name}`}/>;
    })}
  </section>;
}

/** The Studio's entity row (the name over the id) and its picker page; the template default's domain chip is pressed on, not restricted. */
function EntitySetting({ label, title, value, domains, restrict, onPick, path }: { label: string; /** The picker's title; defaults to "Entity for <label>". */ title?: string; value: string; domains: string[]; /** Only these domains may be picked: what a paired source's model accepts. */ restrict?: readonly string[]; onPick: (entityId: string) => void; path: string }) {
  const { entities } = useWorkspaceData();
  const row = entities.find(item => item.entityId === value);
  const name = row?.name ?? value;
  return <PickerRow label={label} title={title ?? (label === 'Entity' ? label : `Entity for ${label}`)} path={path} primary={value ? name : <span className="w2-placeholder">Choose</span>} secondary={value && name !== value ? value : undefined}>
    {close => <EntityList domains={domains} restrict={restrict} kind="template" onPick={picked => { onPick(picked.entityId); close(); }}/>}
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

// MARK: - Settings (authoring)

/** What each place sets: the template's settings, each opening in place to its label and Remove Setting. They are made from Choose Fields. */
export function TemplateParameters({ document, component, onError, ws }: { ws: Workspace2; document: CompositionDocument; component: ComponentEntry; entry: IndexEntry; onError: (message: string) => void }) {
  const [opened, setOpened] = useState<string>();
  const params = component.params ?? [];
  const run = (change: () => CompositionDocument) => { try { ws.studio.apply(change()); return true; } catch (error) { onError(error instanceof Error ? error.message : String(error)); return false; } };
  if (!params.length) return null;
  return <section className="w2-group" data-group="component-parameters" aria-label="Each place sets" data-testid="component-parameters">
    <h3 className="w2-group-title">{`Each place sets (${params.length})`}</h3>
    <ul className="w2-param-list">
      {params.map(param => <ParameterRow key={param.name} component={component} param={param} open={opened === param.name} onToggle={() => setOpened(opened === param.name ? undefined : param.name)}
        onLabel={label => run(() => setParamLabel(document, component.id, param.name, label))} onRemove={() => { run(() => removeParameter(document, component.id, param.name)); setOpened(undefined); }}/>)}
    </ul>
  </section>;
}

/**
 * One setting: its label over what it fills ("Entity · Entity of Light and 1 more", "Icon color of Light"). Pressed, it opens in place to a Label field,
 * the line that says what it fills, and Remove Setting.
 */
function ParameterRow({ component, param, open, onToggle, onLabel, onRemove }: { component: ComponentEntry; param: NonNullable<ComponentEntry['params']>[number]; open: boolean; onToggle: () => void; onLabel: (label: string) => void; onRemove: () => void }) {
  const body = useId(), labelId = useId(), errorId = useId();
  const [text, setText] = useState(param.label ?? '');
  const invalid = text.trim().length > 0 && !labelValid(text);
  const where = bindingWords(component, param.name);
  const commit = () => { if (!invalid && text.trim() !== (param.label ?? '')) onLabel(text); };
  return <li className="w2-param-item" data-param={param.name} data-open={open || undefined}>
    <button type="button" className="w2-param-row w2-param-head" aria-expanded={open} aria-controls={body} onClick={onToggle}>
      <span className="w2-param-text"><span className="w2-param-name">{paramLabel(param)}</span><span className="w2-param-where">{param.kind === 'value' ? where : `${kindWords[param.kind]} · ${where}`}</span></span>
      {open ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {open && <div id={body} className="w2-param-open">
      <label className="w2-param-field" htmlFor={labelId}><span className="w2-row-label">Label</span>
        <input id={labelId} value={text} maxLength={PARAM_LABEL_MAX} placeholder={paramLabel({ name: param.name })} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
          onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}/></label>
      {invalid && <p id={errorId} role="alert" className="w2-field-error">{`Name the setting in 1 to ${PARAM_LABEL_MAX} characters`}</p>}
      <p className="w2-caption">{`Fills ${where}`}</p>
      <button type="button" className="w2-danger" onClick={onRemove}>Remove Setting</button>
    </div>}
  </li>;
}
