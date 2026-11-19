import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Draft } from '../editors/draft';
import { useDraftDocument } from '../editors/draft';
import { useRows } from '../rowsContext';
import { TextInput, Switch } from '../editors/controls';
import { useFieldDraft } from './LogicFields';
import { LogicField } from './Field';
import { fieldAdapters, type LogicFieldKind } from './registry';
import { ValuePickerRow } from '../expr/ValuePicker';
import { useNameContext } from '../expr/useExpr';
import { useLogicFields } from './LogicFields';
import { describeLogic } from './presentation';

export function AddressedField({ path, kind, label }: { path: EditorPath; kind: LogicFieldKind; label: string }) {
  const { document, onChange } = useRows();
  const draft = useFieldDraft(document, onChange);
  return <DraftField draft={draft} path={path} kind={kind} label={label}/>;
}
export function DraftField({ draft, path, kind, label }: { draft: Draft; path: EditorPath; kind: LogicFieldKind; label: string }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document), canvas = useLogicFields();
  const value = valueAt(document, path) as { type?: string; value?: unknown } | undefined;
  const literal = kind === 'operand' && value?.type === 'literal' && ['string', 'number', 'boolean'].includes(typeof value.value);
  const set = (next: string | number | boolean) => draft.set(replaceAt(draft.get(), path, { ...value, value: next }));
  const control = literal && (typeof value.value === 'boolean' ? <Switch label={label} checked={value.value} onChange={set}/>
    : <TextInput label={label} number={typeof value.value === 'number'} value={String(value.value)} onCommit={text => {
      if (typeof value.value === 'number') { if (text.trim() !== '' && Number.isFinite(Number(text))) set(Number(text)); }
      else set(text);
    }}/>);
  if (kind === 'operand') return <section className="w2-logic-field" data-testid="logic-field" data-field-kind={kind} data-field-path={path.join('/')}>
    <span className="w2-row-label">{label}</span>
    {control}
    {!literal && <ValuePickerRow draft={draft} title={label} primary={value ? describeLogic(value, ctx) : 'Choose a value'}
      onPick={picked => draft.set(fieldAdapters.operand.write(picked.document, path, picked.operand))}/>}
    <div className="w2-logic-commands"><button type="button" onClick={() => canvas?.open({ draft, path, kind, label })} disabled={!canvas}>Edit in Canvas</button></div>
  </section>;
  return <LogicField draft={draft} path={path} kind={kind} label={label}>
    {control}
  </LogicField>;
}
