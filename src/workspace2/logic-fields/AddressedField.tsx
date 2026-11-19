import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Draft } from '../editors/draft';
import { useDraftDocument } from '../editors/draft';
import { useRows } from '../rowsContext';
import { TextInput, Switch } from '../editors/controls';
import { useFieldDraft } from './LogicFields';
import { LogicField } from './Field';
import type { LogicFieldKind } from './registry';

export function AddressedField({ path, kind, label }: { path: EditorPath; kind: LogicFieldKind; label: string }) {
  const { document, onChange } = useRows();
  const draft = useFieldDraft(document, onChange);
  return <DraftField draft={draft} path={path} kind={kind} label={label}/>;
}
export function DraftField({ draft, path, kind, label }: { draft: Draft; path: EditorPath; kind: LogicFieldKind; label: string }) {
  const document = useDraftDocument(draft);
  const value = valueAt(document, path) as { type?: string; value?: unknown } | undefined;
  const literal = kind === 'operand' && value?.type === 'literal' && ['string', 'number', 'boolean'].includes(typeof value.value);
  const set = (next: string | number | boolean) => draft.set(replaceAt(draft.get(), path, { ...value, value: next }));
  return <LogicField draft={draft} path={path} kind={kind} label={label}>
    {literal && (typeof value.value === 'boolean' ? <Switch label={label} checked={value.value} onChange={set}/>
      : <TextInput label={label} number={typeof value.value === 'number'} value={String(value.value)} onCommit={text => {
        if (typeof value.value === 'number') { if (text.trim() !== '' && Number.isFinite(Number(text))) set(Number(text)); }
        else set(text);
      }}/>)}
  </LogicField>;
}
