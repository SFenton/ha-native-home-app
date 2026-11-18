/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlainSelect } from '../../ui';
import { kindWords as stateKindWords, newLocalState } from '../dialogs/states';
import { useEffect, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import type { CallService, CompositionDocument, Operand } from '../../shared/composition/schema';
import { operandSchema } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { replaceAt, valueAt, type EditorPath, type SchemaField } from '../../composition-editor';
import { OperandEditor } from '../../GrammarEditors';
import { PushStack, usePush } from '../kit';
import { ensureSource } from '../add/sources';
import ChoiceField from '../pickers/ChoiceField';
import EntityList from '../pickers/EntityList';
import { EntityField, PickerRow, ServiceField } from '../pickers/PickerField';
import { loadServices, sampleServices, type ServiceField as ServiceFieldSpec, type ServiceRow } from '../pickers/services';
import { useWorkspaceData, type CreateFlow } from '../pickers/WorkspaceData';
import { ObjectRows, RowsProvider, summarize, useEntityNames, useRows } from '../rows';
import AdvancedFold from '../AdvancedFold';
import { acceptsRules, acceptedKinds, askProblem, dataOf, defaultAction, kindOf, kindWords, operandDepth, operandFor, sourceOf, sourceWords, targetEntities, withDataField, withService, withTargetEntities, type ActionKind, type ValueSource } from './action';
import { useDraftDocument, type Draft } from './draft';
import EditorRow from './EditorRow';
import JsonBlock from './JsonBlock';
import { LabeledRow, TextInput } from './controls';
import { AskFirstRow } from './AskFirst';
import ActionRules, { ActionModeSwitch } from '../expr/ActionRules';

// MARK: Value rows

/** The stoppers of the dial control a call sits in (by id and name), or `undefined` when the call is not inside one. */
function dialOf(document: CompositionDocument, path: EditorPath): { id: string; label: string }[] | undefined {
  for (let depth = path.length; depth > 0; depth -= 1) {
    const node = valueAt(document, path.slice(0, depth)) as { type?: string; props?: { stoppers?: { id: string; label?: { value?: unknown } }[] } } | undefined;
    if (node?.type === 'dial-control') return (node.props?.stoppers ?? []).map(item => ({ id: item.id, label: typeof item.label?.value === 'string' ? item.label.value : item.id }));
  }
  return undefined;
}

/** How a service's field reads as an operand `as`. */
const readType = (kind: ServiceFieldSpec['kind'] | undefined): 'string' | 'number' | 'boolean' => kind === 'number' ? 'number' : kind === 'boolean' ? 'boolean' : 'string';

/** The formula page (spec 5.5): the operand editor, as one more push; a tree deeper than two levels is edited as JSON. */
function FormulaPage({ draft, path }: { draft: Draft; path: EditorPath }) {
  const doc = useDraftDocument(draft);
  const operand = valueAt(doc, path) as Operand | undefined;
  if (!operand) return null;
  const set = (next: Json) => draft.set(replaceAt(draft.get(), path, next));
  return <div className="w2-editor-page">{operandDepth(operand) > 2
    ? <JsonBlock label="Edit as JSON" value={operand as unknown as Json} onChange={set} validate={value => operandSchema.safeParse(value).success ? undefined : 'That is not a valid formula.'}/>
    : <OperandEditor label="Formula" value={operand as any} document={doc} allowControl onChange={set}/>}</div>;
}

/** One data value of a service call: its control for the chosen source, and the value source menu at the trailing edge. */
function DataRow({ draft, path, name, spec, operand, onRemove }: { draft: Draft; path: EditorPath; name: string; spec?: ServiceFieldSpec; operand?: Operand; onRemove: () => void }) {
  const push = usePush();
  const doc = useDraftDocument(draft);
  const callPath = path.slice(0, -3);
  const setOperand = (next: Operand | undefined) => draft.set(replaceAt(draft.get(), callPath, withDataField(valueAt(draft.get(), callPath) as CallService, name, next)));
  const source: ValueSource = operand ? sourceOf(operand) : 'fixed';
  // Inside a dial control (`sh.dial-control@1`) the control's value is a stopper's: the dial's one call names which, a stopper's own call is its value.
  const dial = dialOf(doc, path);
  const named = dial && !path.includes('stoppers') ? dial : undefined;
  const literal = operand?.type === 'literal' ? operand.value : undefined;
  const commit = (value: Json | undefined) => setOperand(value === undefined || value === '' ? undefined : { type: 'literal', value });
  let control: React.ReactNode;
  if (source === 'fixed') {
    if (spec?.kind === 'boolean') control = <input type="checkbox" role="switch" aria-label={spec.name} checked={literal === true} onChange={event => commit(event.target.checked)}/>;
    else if (spec?.kind === 'choice' && spec.options) control = <PlainSelect label={spec.name} value={String(literal ?? '')} options={[{ value: '', label: 'Not set' }, ...spec.options.map(option => ({ value: String(option), label: String(option) }))]} onChange={commit}/>;
    else if (spec?.kind === 'number') control = <TextInput number label={spec.name} value={literal === undefined ? '' : String(literal)} placeholder={spec.unit} onCommit={text => commit(text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text))}/>;
    else control = <TextInput label={spec?.name ?? name} value={literal === undefined ? '' : String(literal)} onCommit={text => { const trimmed = text.trim(); commit(trimmed === '' ? undefined : !spec && Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed); }}/>;
  } else if (source === 'entity' && operand?.type === 'read') {
    const entity = (doc.dataSources.find(item => item.id === operand.from.sourceId) as { entityId?: { value?: string } } | undefined)?.entityId?.value;
    control = <EntityField label={spec?.name ?? name} entityId={entity} onPick={row => { const made = ensureSource(draft.get(), row.entityId); draft.set(made.document); setOperand(operandFor('entity', undefined, made.sourceId)); }}/>;
  } else if (source === 'control' && named) control = <PlainSelect label="Stopper" value={operand?.type === 'control' && operand.stopper ? operand.stopper : named[0].id}
    options={named.map(item => ({ value: item.id, label: item.label }))} onChange={next => setOperand({ type: 'control', stopper: next })}/>;
  else if (source === 'control') control = <span className="w2-summary">{dial ? 'This stopper’s value' : 'The control’s value'}</span>;
  else if (source === 'viewer' && operand?.type === 'viewer') control = <PlainSelect label="Person" value={operand.field} options={[{ value: 'userId', label: 'Their user ID' }, { value: 'isAdmin', label: 'Whether they are an admin' }, { value: 'personEntityId', label: 'Their person entity' }]} onChange={field => setOperand({ type: 'viewer', field: field as 'userId' | 'isAdmin' | 'personEntityId' })}/>;
  else control = <button type="button" className="w2-picker-button" onClick={() => push?.push({ title: 'Formula', body: <FormulaPage draft={draft} path={[...path, name]}/> })}><span className="w2-picker-primary">Formula</span></button>;
  return <LabeledRow label={spec?.name ?? name} keyName={name} trailing={<Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label={`Value source for ${spec?.name ?? name}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <Menu.RadioGroup value={source} onValueChange={next => {
        const to = next as ValueSource;
        if (to === source) return;
        setOperand(to === 'control' && named ? { type: 'control', stopper: named[0].id } : operandFor(to, operand));
        if (to === 'formula') push?.push({ title: 'Formula', body: <FormulaPage draft={draft} path={[...path, name]}/> });
      }}>
        {(Object.keys(sourceWords) as ValueSource[]).map(item => <Menu.RadioItem key={item} value={item} className="w2-menu-item">{item === 'control' && dial ? (named ? 'This Dial' : 'This Stopper') : sourceWords[item]}</Menu.RadioItem>)}
      </Menu.RadioGroup>
      <Menu.Separator className="w2-menu-sep"/>
      <Menu.Item className="w2-menu-item w2-danger-item" onClick={onRemove}>Remove</Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>}>{control}</LabeledRow>;
}

// MARK: Service call

/** The service Home Assistant (or the sample list) describes for a call, when it does. */
function useServiceSpec(domain: string, service: string): ServiceRow | undefined {
  const [rows, setRows] = useState<readonly ServiceRow[]>(sampleServices);
  useEffect(() => { let live = true; void loadServices().then(list => { if (live && list?.length) setRows(list); }); return () => { live = false; }; }, []);
  return rows.find(row => row.domain === domain && row.service === service);
}

function CallBody({ draft, path, itemName }: { draft: Draft; path: EditorPath; itemName: string }) {
  const doc = useDraftDocument(draft);
  const call = valueAt(doc, path) as CallService;
  const spec = useServiceSpec(call.domain, call.service);
  const [custom, setCustom] = useState('');
  const set = (next: CallService) => draft.set(replaceAt(draft.get(), path, next));
  const targets = targetEntities(call);
  const { entities } = useWorkspaceData();
  const fields = dataOf(call), known = Object.entries(spec?.fields ?? {});
  const extra = Object.keys(fields).filter(key => !spec?.fields[key]);
  return <div className="w2-editor-section">
    <ServiceField domain={call.domain} service={call.service} onPick={(domain, service) => set(withService(call, domain, service))}/>
    {spec?.description && <p className="w2-caption">{spec.description}</p>}
    <div className="w2-field-row" data-field-key="target"><span className="w2-field-label"><span>Target</span></span><div className="w2-target-chips w2-field-control">
      {targets === undefined ? <span className="w2-summary">From a value</span> : targets.map(id => <span className="w2-chip w2-chip-static" key={id} data-target={id}>{entities.find(row => row.entityId === id)?.name ?? id}
        <button type="button" className="w2-chip-remove" aria-label={`Remove ${id}`} onClick={() => set(withTargetEntities(call, targets.filter(item => item !== id)))}><X size={12} aria-hidden/></button></span>)}
      {targets !== undefined && <PickerRow title="Target" primary={<><Plus size={14} aria-hidden/> Add</>}>
        {close => <EntityList onPick={row => { set(withTargetEntities(call, [...new Set([...targets, row.entityId])])); close(); }}/>}
      </PickerRow>}
    </div></div>
    {known.map(([key, field]) => <DataRow key={key} draft={draft} path={[...path, 'data', 'fields']} name={key} spec={field} operand={fields[key]} onRemove={() => set(withDataField(call, key, undefined))}/>)}
    {extra.map(key => <DataRow key={key} draft={draft} path={[...path, 'data', 'fields']} name={key} operand={fields[key]} onRemove={() => set(withDataField(call, key, undefined))}/>)}
    <div className="w2-field-row"><span className="w2-field-label"><span>Field name</span></span>
      <div className="w2-field-control"><input aria-label="Field name" value={custom} onChange={event => setCustom(event.target.value.trim())} onKeyDown={event => { if (event.key === 'Enter') { add(); } }}/></div>
      <button type="button" disabled={!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(custom) || custom in fields} onClick={add}>Add Field</button></div>
    <AskFirstRow draft={draft} path={path} itemName={itemName}/>
    {/* "Show change at once" belongs to the call: it sits in the call's own Advanced fold. */}
    <AdvancedFold type="call-service">
      <RowsProvider value={{ document: doc, onChange: next => draft.set(next), onError: () => {} }}>
        <ObjectRows path={path} owner="call-service" groups={['advanced']} skip={at => at.length === path.length + 1 && at.at(-1) !== 'optimistic'}/>
      </RowsProvider>
    </AdvancedFold>
  </div>;
  function add() { if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(custom) || custom in fields) return; set(withDataField(call, custom, { type: 'literal', value: '' })); setCustom(''); }
}

// MARK: The editor

/** Props shared by the action editor's body and its row. */
export interface ActionEditorProps {
  /** The path of the action field in the document. */
  path: EditorPath;
  /** The schema that governs the field (its variants are the chips). */
  schema: SchemaField;
  /** Whether the field may be absent ("Nothing" is then a chip). */
  optional: boolean;
  /** The data source a power action toggles, when the node has one. */
  boundSourceId?: string;
}

/** The action editor's body (spec 5.5, "When tapped"): kind chips, then the form for the kind. */
export function ActionBody({ draft, path, schema, optional, boundSourceId, itemName = '' }: ActionEditorProps & { draft: Draft; /** The tile's title, for Ask first's starting words. */ itemName?: string }) {
  const doc = useDraftDocument(draft);
  const { onCreatePage, onCreateSheet } = useWorkspaceData();
  const action = valueAt(doc, path) as Record<string, any> | undefined;
  const kind = kindOf(action as Json | undefined);
  const kinds = acceptedKinds(schema, optional);
  const set = (next: unknown) => {
    const current = draft.get();
    if (next !== undefined) { draft.set(replaceAt(current, path, next)); return; }
    const parent = valueAt(current, path.slice(0, -1)) as Record<string, unknown>;
    const { [String(path.at(-1))]: _gone, ...rest } = parent;
    draft.set(replaceAt(current, path.slice(0, -1), rest));
  };
  const disabled = (item: ActionKind) => item === 'present' ? doc.modals.length === 0 && !onCreateSheet : item === 'select-tab' ? doc.navigation.tabs.length === 0 : false;
  const present = (schema && JSON.stringify(schema).includes('"replace"')) || false;
  const pages = doc.pages.map(page => ({ id: page.id, label: page.title }));
  /** Runs a creation flow, then copies what it made into this draft (the document has it already), so Done keeps it. */
  const adopt = (flow: CreateFlow, list: 'pages' | 'modals') => (done: (id: string) => void) => flow(made => {
    const have = new Set(draft.get()[list].map(item => item.id));
    const added = made.document[list].filter(item => !have.has(item.id));
    draft.set({ ...draft.get(), [list]: [...draft.get()[list], ...added] });
    done(made.id);
  });
  const withDraftValue = (patch: Record<string, unknown>) => set({ ...action, ...patch });
  const localField = doc.localState?.find(field => field.id === action?.stateId);
  const rules = acceptsRules(schema), byRule = kind === ('conditional' as ActionKind);
  const inner = (d: Draft, at: EditorPath, sub: SchemaField, name: string) => <ActionBody draft={d} path={at} schema={sub} optional={false} boundSourceId={boundSourceId} itemName={name}/>;
  if (byRule) return <div className="w2-editor-section" data-testid="action-editor"><ActionModeSwitch draft={draft} path={path} byRule/><ActionRules draft={draft} path={path} schema={schema} itemName={itemName} action={inner}/></div>;
  return <div className="w2-editor-section" data-testid="action-editor">
    {rules && doc && action && <ActionModeSwitch draft={draft} path={path} byRule={false}/>}
    <div className="w2-kind-chips" role="group" aria-label="Kind">{kinds.map(item => <button type="button" key={item} className="w2-chip" aria-pressed={item === kind} disabled={disabled(item)}
      onClick={() => item !== kind && set(defaultAction(item, doc, boundSourceId))}>{kindWords[item]}</button>)}</div>
    {kind === 'call-service' && action && <CallBody draft={draft} path={path} itemName={itemName}/>}
    {kind === 'push' && action && <ChoiceField label="Page" choices={pages} value={action.pageId} onPick={id => withDraftValue({ pageId: id })} create={onCreatePage ? { label: 'New Page…', run: adopt(onCreatePage, 'pages') } : undefined}/>}
    {kind === 'dismiss-then-push' && action && <ChoiceField label="Page" choices={pages} value={action.destination?.pageId} onPick={id => withDraftValue({ destination: { ...action.destination, pageId: id } })} create={onCreatePage ? { label: 'New Page…', run: adopt(onCreatePage, 'pages') } : undefined}/>}
    {kind === 'present' && action && <>
      <ChoiceField label="Sheet" choices={doc.modals.map(modal => ({ id: modal.id, label: modal.title }))} value={action.modalId} onPick={id => withDraftValue({ modalId: id })} create={onCreateSheet ? { label: 'New Sheet…', run: adopt(onCreateSheet, 'modals') } : undefined}/>
      {present && <div className="w2-field-row"><span className="w2-field-label">If a sheet is already open</span><div className="w2-segment w2-field-control" role="group" aria-label="If a sheet is already open">
        {(['reject', 'replace'] as const).map(value => <button type="button" key={value} aria-pressed={action.ifPresented === value} onClick={() => withDraftValue({ ifPresented: value })}>{value === 'reject' ? 'Do nothing' : 'Replace it'}</button>)}</div></div>}
    </>}
    {kind === 'select-tab' && action && <ChoiceField label="Tab" choices={doc.navigation.tabs.map(tab => ({ id: tab.id, label: tab.label }))} value={action.tabId} onPick={id => withDraftValue({ tabId: id })}/>}
    {kind === 'set-local' && action && <>
      <ChoiceField label="State" choices={(doc.localState ?? []).map(field => ({ id: field.id, label: field.id, detail: stateKindWords[field.type] }))} value={action.stateId}
        create={{ label: 'New…', run: done => { const made = newLocalState(draft.get()); draft.set({ ...draft.get(), localState: [...(draft.get().localState ?? []), made] }); done(made.id); } }} onPick={id => {
        const field = draft.get().localState?.find(item => item.id === id);
        withDraftValue({ stateId: id, value: field?.type === 'boolean' ? { type: 'boolean', value: field.initial } : field?.type === 'number' ? { type: 'number', value: field.initial } : { type: 'string', value: field?.initial ?? '' } });
      }}/>
      <LabeledRow label="Value">{localField?.type === 'boolean' ? <input type="checkbox" role="switch" aria-label="Value" checked={action.value?.value === true} onChange={event => withDraftValue({ value: { type: 'boolean', value: event.target.checked } })}/>
        : localField?.type === 'choice' ? <PlainSelect label="Value" value={String(action.value?.value ?? '')} options={localField.options.map(option => ({ value: option.id, label: option.label }))} onChange={choice => withDraftValue({ value: { type: 'string', value: choice } })}/>
        : localField?.type === 'number' ? <TextInput number label="Value" value={String(action.value?.value ?? '')} onCommit={text => Number.isFinite(Number(text)) && text !== '' && withDraftValue({ value: { type: 'number', value: Number(text) } })}/>
        : <TextInput label="Value" value={String(action.value?.value ?? '')} onCommit={text => withDraftValue({ value: { type: 'string', value: text } })}/>}</LabeledRow></>}
    {kind === 'domain' && action && <AskFirstRow draft={draft} path={path} itemName={itemName}/>}
  </div>;
}

/** The "When tapped" row: it opens the action editor (a dialog when wide, a push inside the sheet when narrow). */
export function ActionRow({ label, path, schema, optional, boundSourceId, itemName }: ActionEditorProps & { label: string; itemName: string }) {
  const { document, onChange } = useRows();
  const value = valueAt(document, path) as Json | undefined;
  const names = useEntityNames();
  return <EditorRow label={label} summary={summarize(document, String(path.at(-1)), value, names)} itemName={itemName} document={document} onApply={onChange} path={path.join('/')} blocked={doc => askProblem(valueAt(doc, path) as Json)}
    remove={optional && value ? { label: 'Remove Action', run: draft => { const parent = valueAt(draft.get(), path.slice(0, -1)) as Record<string, unknown>; const { [String(path.at(-1))]: _gone, ...rest } = parent; draft.set(replaceAt(draft.get(), path.slice(0, -1), rest)); } } : undefined}>
    {draft => <ActionBody draft={draft} path={path} schema={schema} optional={optional} boundSourceId={boundSourceId} itemName={itemName}/>}
  </EditorRow>;
}
export type { CompositionDocument };
