import type { ReactNode } from 'react';
import type { Operand } from '../../shared/composition/expression';
import { elementOf, hasObject, kindsOf, withoutNull, type PipelineInputs } from '../../shared/composition/pipeline';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import { ValuePickerRow } from '../expr/ValuePicker';
import { operandName } from '../expr/condition';
import { useNameContext } from '../expr/useExpr';
import { createDraft } from '../editors/draft';
import { useRows } from '../rowsContext';
import { FlowScopeProvider } from './flowScope';
import { fillsRow, flowShapes, itemFields, kindWords, rowSlotWords, type RowSlot } from './flow';
import { setPickSlot } from './focus';
import { AddressedField } from '../logic-fields/AddressedField';
import { useLogicFields } from '../logic-fields/LogicFields';

const givesWords = { rows: 'Rows', records: 'Records', record: 'One Record', scalar: 'One Value' } as const;

/** Focus on a field slot turns the Data panel into pick mode: a click on a field fills the slot ("Choose a field for Title. Esc cancels."). Focus leaving the slot (not into the outline) ends it. */
function PickFocus({ label, onPick, children }: { label: string; onPick: (path: string[]) => void; children: ReactNode }) {
  return <div className="w2-data-pick" onFocusCapture={() => setPickSlot({ label, accepts: kind => fillsRow(kind), onPick })}
    onBlurCapture={event => { const to = event.relatedTarget as Element | null; if (!to || !to.closest('.w2-outline, .w2-data-pick')) setPickSlot(undefined); }}>{children}</div>;
}

/**
 * The Output section: what the flow gives (Rows, One Record or One Value) and, for Rows, the Title, Subtitle, Value and ID of a row and "Up to". The slots are value
 * pickers over the item's fields; a focused slot also takes a click on a field of the Data panel's outline.
 */
export default function OutputSection({ inputs, edit, flowId }: { inputs: PipelineInputs; edit: (change: (inputs: PipelineInputs) => PipelineInputs) => void; flowId?: string }) {
  const { document } = useRows();
  const canvas = useLogicFields(), at = document.dataSources.findIndex(source => source.id === flowId);
  const names = useNameContext(document);
  const shapes = flowShapes(inputs), final = shapes.final, core = withoutNull(final), kinds = kindsOf(core);
  const options = [...(kinds.has('array') ? ['rows'] : []), ...(kinds.has('array') && elementOf(core) && hasObject(elementOf(core)!) ? ['records'] : []), ...(kinds.has('object') ? ['record'] : []), ...(core.kind !== 'any' && !kinds.has('array') && !kinds.has('object') ? ['scalar'] : [])] as (keyof typeof givesWords)[];
  const gives = inputs.output.kind;
  const choices = options.includes(gives) ? options : [gives, ...options];
  const fields = itemFields(final), scalar = fields.filter(field => fillsRow(kindWords(field.shape).kind));
  const setGives = (next: keyof typeof givesWords) => edit(held => next === 'records' ? { ...held, output: { kind: 'records', max: held.output.kind === 'rows' ? held.output.max : 24 } } : next === 'rows' ? { ...held, output: { kind: 'rows', max: 50, row: { id: { type: 'item', path: [scalar[0]?.name ?? ''] }, title: { type: 'item', path: [(scalar[1] ?? scalar[0])?.name ?? ''] } } } }
    : { ...held, output: { kind: next } });
  const draft = createDraft(document);
  const slot = (key: RowSlot, optional: boolean) => {
    if (inputs.output.kind !== 'rows') return null;
    const operand = inputs.output.row[key] as Operand | undefined;
    const set = (next: Operand | undefined) => edit(held => held.output.kind !== 'rows' ? held : { ...held, output: { ...held.output, row: Object.fromEntries(Object.entries({ ...held.output.row, [key]: next }).filter(([, value]) => value !== undefined)) as typeof held.output.row } });
    return <PickFocus key={key} label={rowSlotWords[key]} onPick={path => set({ type: 'item', path })}>
      <FlowScopeProvider item={final} params={inputs.parameters.map(item => ({ name: item.name, type: item.type }))}>
        {canvas && at >= 0 && operand
          ? <AddressedField path={['dataSources', at, 'inputs', 'output', 'row', key]} kind="operand" label={rowSlotWords[key]}/>
          : <ValuePickerRow draft={draft} label={rowSlotWords[key]} title={rowSlotWords[key]} stacked primary={operand ? operandName(operand, names) : <span className="w2-placeholder">None</span>}
            onPick={picked => set(picked.operand)}/>}
      </FlowScopeProvider>
      {optional && operand && <button type="button" className="w2-link w2-data-clear" onClick={() => set(undefined)}>{`Remove ${rowSlotWords[key]}`}</button>}
    </PickFocus>;
  };
  return <section className="w2-group w2-data-section" aria-label="Output" data-testid="output-section">
    <h3 className="w2-group-title">Output</h3>
    <div className="w2-picker-row"><span className="w2-row-label">Gives</span>
      <SelectMenu label="Gives" value={gives} options={choices.map(value => ({ value, label: givesWords[value] }))} onChange={next => setGives(next as keyof typeof givesWords)}/></div>
    {inputs.output.kind === 'rows' && <>
      {slot('title', false)}{slot('subtitle', true)}{slot('value', true)}{slot('id', false)}
      <div className="w2-picker-row"><span className="w2-row-label">Up to</span>
        <TextInput label="Up to" number value={String(inputs.output.max)} onCommit={text => { const max = Math.floor(Number(text)); if (Number.isFinite(max) && max >= 1 && max <= 100) edit(held => held.output.kind === 'rows' ? { ...held, output: { ...held.output, max } } : held); }}/></div>
    </>}
    {inputs.output.kind === 'records' && <div className="w2-picker-row"><span className="w2-row-label">Up to</span>
      <TextInput label="Up to" number value={String(inputs.output.max)} onCommit={text => { const max = Math.floor(Number(text)); if (Number.isFinite(max) && max >= 1 && max <= 100) edit(held => held.output.kind === 'records' ? { ...held, output: { ...held.output, max } } : held); }}/></div>}
    {options.length === 0 && <p className="w2-caption">The steps do not give anything to use yet.</p>}
  </section>;
}
