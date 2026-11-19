import { Plus } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import { sortKinds } from '../../shared/composition/pipeline/schema';
import type { Json } from '../../shared/types';
import { useDraftDocument, type Draft } from '../editors/draft';
import { ValuePickerRow } from './ValuePicker';
import { operandName } from './condition';
import { Segmented } from './ui';
import { useNameContext } from './useExpr';
import { words } from './words';
import { useLogicFields } from '../logic-fields/LogicFields';
import { DraftField } from '../logic-fields/AddressedField';

/** One sort field: the value the list is ordered by, how to compare it, and which way. */
export interface SortKey { value: Operand; direction: 'ascending' | 'descending'; kind: typeof sortKinds[number] }
/** The most sort fields a list has (`PIPELINE_LIMITS.sortKeys`). */
export const MAX_SORT_KEYS = 4;
const kindWords: Record<SortKey['kind'], string> = { text: 'Text', number: 'Number', date: 'Date' };

/**
 * The Sort step's list (spec "List sort"): up to 4 sort fields, each a value, a kind and a direction. `path` is the step's `by`. The host
 * page (the Data tab's Sort step) gives it the draft it edits, so wiring is one line.
 */
export default function SortList({ draft, path }: { draft: Draft; path: EditorPath }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document);
  const canvas = useLogicFields();
  const keys = (valueAt(document, path) as SortKey[] | undefined) ?? [];
  const write = (next: SortKey[]) => draft.set(replaceAt(draft.get(), path, next as unknown as Json));
  const change = (index: number, patch: Partial<SortKey>) => write(keys.map((key, i) => i === index ? { ...key, ...patch } : key));
  return <div className="w2-expr-editor" data-testid="sort-list">
    <ol className="w2-expr-rules">{keys.map((key, index) => <li key={index} className="w2-expr-rule" role="group" aria-label={`Sort field ${index + 1} of ${keys.length}`}>
      {canvas ? <DraftField draft={draft} path={[...path, index, 'value']} kind="operand" label={words.sortBy}/>
        : <ValuePickerRow draft={draft} label={words.sortBy} title={words.sortBy} stacked primary={operandName(key.value, ctx)}
          onPick={picked => { draft.set(replaceAt(picked.document, [...path, index, 'value'], picked.operand as unknown as Json)); }}/>}
      <Segmented label={`Compare field ${index + 1} as`} value={key.kind} options={sortKinds.map(kind => ({ value: kind, label: kindWords[kind] }))} onChange={kind => change(index, { kind })}/>
      <Segmented label={`Direction of field ${index + 1}`} value={key.direction} options={[{ value: 'ascending', label: words.ascending }, { value: 'descending', label: words.descending }]} onChange={direction => change(index, { direction })}/>
      <button type="button" className="w2-expr-remove" disabled={keys.length < 2} onClick={() => write(keys.filter((_, i) => i !== index))}>{words.removeSortField}</button>
    </li>)}</ol>
    <button type="button" className="w2-expr-add" disabled={keys.length >= MAX_SORT_KEYS} onClick={() => write([...keys, { value: { type: 'literal', value: '' }, direction: 'ascending', kind: 'text' }])}><Plus size={14} aria-hidden/>{words.addSortField}</button>
    {keys.length >= MAX_SORT_KEYS && <p className="w2-caption">{words.fourSortFields}</p>}
  </div>;
}
