import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { replaceAt } from '../../composition-editor';
import type { Operand, Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import type { PipelineStep, Shape } from '../../shared/composition/pipeline';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import { useDraftDocument, type Draft } from '../editors/draft';
import { ComparisonControls } from '../expr/ComparisonControls';
import LogicBuilder from '../expr/LogicBuilder';
import SortList from '../expr/SortList';
import { ValuePickerRow } from '../expr/ValuePicker';
import { closeLeaf, openLeaf, operandName, type Leaf } from '../expr/condition';
import { Segmented } from '../expr/ui';
import { useNameContext } from '../expr/useExpr';
import { words } from '../expr/words';
import { useViewport } from '../kit';
import { exclusive, layoutTier } from '../layout';
import ShapeOutline from './ShapeOutline';
import { FlowScopeProvider, itemInfoOf, type FlowScope } from './flowScope';
import { flowById, flowShapes, itemFields, kindWords } from './flow';
import { filterResult, useStepOutcome } from './StepResult';

/** What a step page needs: the flow's place in the draft, the step, and the data arriving at it (from the saved flow, so a half-made edit never changes what is offered). */
export interface StepContext { draft: Draft; flowId: string; stepId: string; arriving: Shape; params: FlowScope['params'] }
const flowIndex = (draft: Draft, flowId: string) => draft.get().dataSources.findIndex(source => source.id === flowId);

/** The draft's copy of the step, its path, and a way to write it. */
function useStep({ draft, flowId, stepId }: StepContext) {
  const document = useDraftDocument(draft);
  const at = flowIndex(draft, flowId);
  const source = flowById(document, flowId);
  const index = source ? source.inputs.steps.findIndex(step => step.id === stepId) : -1;
  const path = ['dataSources', at, 'inputs', 'steps', index];
  const step = source?.inputs.steps[index];
  const set = (next: PipelineStep, typing?: string) => draft.set(replaceAt(draft.get(), path, next as unknown as Json), typing);
  return { document, source, index, path, step, set, at };
}

/** A fold with "Fields After This Step": the outline at this step, in the tiers where the Data panel cannot sit beside the inspector. */
function FieldsAfter({ ctx, shape }: { ctx: StepContext; shape: Shape }) {
  const { width, height } = useViewport();
  const tier = layoutTier(width, height);
  const { source } = useStep(ctx);
  if (!(tier === 'phone' || exclusive(tier, width)) || !source) return null;
  return <details className="w2-data-fold"><summary>Fields After This Step</summary>
    <ShapeOutline shape={shape} hide={false} label="Fields after this step" rows={source.inputs.output.kind === 'rows'} onStep={() => {}} onRow={() => {}}/></details>;
}

// MARK: Filter

const SIMPLE_COMPARISONS = ['is', 'is not', 'is one of', 'is not one of', 'is above', 'is below', 'is before', 'is after', 'has a value', 'has no value'] as const;
/** Whether a condition is one comparison of a field of the item (what Simple can draw). */
export const fitsSimpleFilter = (where: Predicate): boolean => { const leaf = openLeaf(where); return Boolean(leaf && leaf.left.type === 'item'); };

/** Simple: a field of the item, a comparison and a value. The first group of the picker is This Item's Fields, each with its kind and its values as chips. */
function SimpleFilter({ ctx, scope }: { ctx: StepContext; scope: FlowScope }) {
  const { document, path, step, set } = useStep(ctx);
  const names = useNameContext(document);
  if (!step || step.op !== 'filter') return null;
  const leaf = openLeaf(step.where);
  const info = leaf ? itemInfoOf(scope, leaf.left) : undefined;
  const write = (next: Leaf) => set({ ...step, where: closeLeaf(next, () => false) });
  void path;
  return <div className="w2-expr-simple" data-testid="flow-simple-filter">
    <ValuePickerRow draft={ctx.draft} title="Field" label="Field" stacked primary={leaf ? operandName(leaf.left, names) : 'Choose'} secondary={info ? `This item · ${info.words}${info.values ? ` · ${info.values.length} Values` : ''}` : undefined}
      onPick={picked => write({ left: picked.operand, comparison: picked.kind === 'number' ? 'is above' : picked.kind === 'date' ? 'is before' : 'is', right: picked.kind === 'number' ? [{ type: 'literal', value: 0 }] : picked.closed?.length ? [{ type: 'literal', value: picked.closed[0] }] : [] })}/>
    {leaf && <ComparisonControls leaf={leaf} kind={info?.kind ?? 'text'} closed={info?.values} numeric={info?.kind === 'number'} allowed={SIMPLE_COMPARISONS} onChange={write}/>}
  </div>;
}

/** The Filter page: "Keep items when", Simple or Logic over the same condition, the Result line, and the fold of fields after the step. No "If it can't tell": a missing value is "no". */
function FilterPage({ ctx }: { ctx: StepContext }) {
  const { document, source, index, path, step } = useStep(ctx);
  const [chosen, choose] = useState<'simple' | 'logic'>();
  const scope = useMemo<FlowScope>(() => ({ item: ctx.arriving, params: ctx.params }), [ctx.arriving, ctx.params]);
  const outcome = useStepOutcome(ctx.flowId, source?.inputs, index);
  if (!step || step.op !== 'filter') return null;
  const fits = fitsSimpleFilter(step.where), mode = chosen === 'logic' || !fits ? 'logic' : 'simple';
  const leaf = openLeaf(step.where), left = leaf?.left;
  const optional = left?.type === 'item' ? itemFields(ctx.arriving).find(field => field.name === left.path[0])?.optional ? left.path[0] : undefined : undefined;
  const result = filterResult(outcome, optional);
  void document;
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-expr-editor w2-data-step" data-testid="filter-page">
      <h3 className="w2-group-title">Keep items when</h3>
      <Segmented label="Condition view" value={mode} options={[{ value: 'simple', label: words.simple, dimmed: !fits }, { value: 'logic', label: words.logic }]} onChange={choose}/>
      {!fits && <p className="w2-caption">This condition has more than one part, so it can only be edited as Logic.</p>}
      {mode === 'simple' ? <SimpleFilter ctx={ctx} scope={scope}/> : <LogicBuilder draft={ctx.draft} path={[...path, 'where']} place="filter" scope="flow" inlineDepth={2}/>}
      <section aria-label="Result" className="w2-data-result"><h3 className="w2-group-title">Result</h3>
        <p role="status" aria-live="polite" data-testid="filter-result"><strong>{result.head}</strong>{result.note ? ` ${result.note}` : ''}</p></section>
      <FieldsAfter ctx={ctx} shape={source ? flowShapes(source.inputs).after[index] ?? ctx.arriving : ctx.arriving}/>
    </div>
  </FlowScopeProvider>;
}

// MARK: Sort

/** Sort: up to 4 fields, each a value, its kind and its direction; a later field breaks ties in the ones before it. */
function SortPage({ ctx }: { ctx: StepContext }) {
  const { source, index, path, step } = useStep(ctx);
  const outcome = useStepOutcome(ctx.flowId, source?.inputs, index);
  if (!step || step.op !== 'sort') return null;
  const first = outcome?.first && typeof outcome.first === 'object' && !Array.isArray(outcome.first) ? Object.values(outcome.first).find(value => typeof value === 'string') : undefined;
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-expr-editor w2-data-step" data-testid="sort-page">
      <h3 className="w2-group-title">{words.sortBy}</h3>
      <SortList draft={ctx.draft} path={[...path, 'by']}/>
      <section aria-label="Result" className="w2-data-result"><h3 className="w2-group-title">Result</h3>
        <p role="status" aria-live="polite"><strong>{outcome?.after === null || outcome === undefined ? 'No data yet.' : `${outcome.after} ${outcome.after === 1 ? 'item' : 'items'}.`}</strong>{typeof first === 'string' ? ` First: ${first}.` : ''}</p></section>
      <FieldsAfter ctx={ctx} shape={ctx.arriving}/>
    </div>
  </FlowScopeProvider>;
}

// MARK: The others

/** One value field of the item (a Group by, a Remove Duplicates by, an Add Up value): the value picker over the item's fields. */
function ValueStep({ ctx, label, field }: { ctx: StepContext; label: string; field: 'by' | 'value' }) {
  const { document, path, step } = useStep(ctx);
  const names = useNameContext(document);
  if (!step) return null;
  const operand = (step as { by?: Operand; value?: Operand })[field] as Operand;
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-data-step"><ValuePickerRow draft={ctx.draft} label={label} title={label} stacked primary={operandName(operand, names)}
      onPick={picked => ctx.draft.set(replaceAt(ctx.draft.get(), [...path, field], picked.operand as unknown as Json))}/>
    <FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>
  </FlowScopeProvider>;
}

/** Set Fields: a list of fields; each value is a value field over the item (a field of it, Today, Now or an input). */
function MapPage({ ctx }: { ctx: StepContext }) {
  const { document, path, step, set } = useStep(ctx);
  const names = useNameContext(document);
  if (!step || step.op !== 'map') return null;
  const entries = Object.entries(step.fields);
  const write = (next: [string, Operand][]) => set({ ...step, fields: Object.fromEntries(next) });
  const rename = (at: number, name: string) => write(entries.map((entry, index) => index === at ? [name, entry[1]] : entry));
  const taken = (name: string) => entries.some(([key]) => key === name);
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-data-step" data-testid="map-page">
      <h3 className="w2-group-title">Fields</h3>
      <ol className="w2-expr-rules">{entries.map(([name, value], at) => <li key={at} className="w2-expr-rule" role="group" aria-label={`Field ${at + 1} of ${entries.length}`}>
        <div className="w2-picker-row"><span className="w2-row-label">Name</span><TextInput label={`Name of field ${at + 1}`} value={name} onCommit={text => { if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(text) && !taken(text)) rename(at, text); }}/></div>
        <ValuePickerRow draft={ctx.draft} label="Value" title={`Value of ${name}`} stacked primary={operandName(value, names)} onPick={picked => draft_set(ctx, [...path, 'fields', name], picked.operand)}/>
        <button type="button" className="w2-expr-remove" disabled={entries.length < 2} onClick={() => write(entries.filter((_, index) => index !== at))}>Remove Field</button>
      </li>)}</ol>
      <button type="button" className="w2-expr-add" disabled={entries.length >= 32} onClick={() => { let n = entries.length + 1; while (taken(`field${n}`)) n += 1; write([...entries, [`field${n}`, { type: 'literal', value: '' }]]); }}><Plus size={14} aria-hidden/>Add Field</button>
      {entries.length >= 32 && <p className="w2-caption">32 fields at most.</p>}
      <FieldsAfter ctx={ctx} shape={ctx.arriving}/>
    </div>
  </FlowScopeProvider>;
}
const draft_set = (ctx: StepContext, path: (string | number)[], operand: Operand) => ctx.draft.set(replaceAt(ctx.draft.get(), path, operand as unknown as Json));

// MARK: The extra steps (`sh.flow-extras@1`)

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Running Total: the value added up so far, written into a field of each item; a gap either ends the total for good or adds nothing. */
function RunningSumPage({ ctx }: { ctx: StepContext }) {
  const { document, path, step, set } = useStep(ctx);
  const names = useNameContext(document);
  if (!step || step.op !== 'running-sum') return null;
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-data-step" data-testid="running-sum-page">
      <ValuePickerRow draft={ctx.draft} label="Add up" title="Add up" stacked primary={operandName(step.value, names)}
        onPick={picked => ctx.draft.set(replaceAt(ctx.draft.get(), [...path, 'value'], picked.operand as unknown as Json))}/>
      <div className="w2-picker-row"><span className="w2-row-label">Write total into</span>
        <TextInput label="Field for the total" value={step.into} onCommit={text => { if (FIELD_NAME.test(text)) set({ ...step, into: text }, 'into'); }}/></div>
      <div className="w2-picker-row"><span className="w2-row-label">An unknown value</span>
        <SelectMenu label="An unknown value" value={step.nullPropagates ? 'ends' : 'skips'} options={[{ value: 'ends', label: 'Ends the total' }, { value: 'skips', label: 'Adds nothing' }]}
          onChange={next => set({ ...step, nullPropagates: next === 'ends' })}/></div>
      <p className="w2-caption">Each item keeps its fields and gains the total so far. Ending the total makes every later total unknown.</p>
      <FieldsAfter ctx={ctx} shape={ctx.arriving}/>
    </div>
  </FlowScopeProvider>;
}

/** Add List-wide Fields: for each field, the smallest or largest value over the whole list, written onto every item. */
function AnnotatePage({ ctx }: { ctx: StepContext }) {
  const { document, path, step, set } = useStep(ctx);
  const names = useNameContext(document);
  if (!step || step.op !== 'annotate') return null;
  const entries = Object.entries(step.fields);
  const taken = (name: string) => entries.some(([key]) => key === name);
  const write = (next: [string, { aggregate: 'min' | 'max'; value: Operand }][]) => set({ ...step, fields: Object.fromEntries(next) });
  return <FlowScopeProvider item={ctx.arriving} params={ctx.params}>
    <div className="w2-editor-section w2-data-step" data-testid="annotate-page">
      <h3 className="w2-group-title">Fields</h3>
      <ol className="w2-expr-rules">{entries.map(([name, field], at) => <li key={at} className="w2-expr-rule" role="group" aria-label={`Field ${at + 1} of ${entries.length}`}>
        <div className="w2-picker-row"><span className="w2-row-label">Name</span><TextInput label={`Name of field ${at + 1}`} value={name}
          onCommit={text => { if (FIELD_NAME.test(text) && !taken(text)) write(entries.map((entry, index) => index === at ? [text, entry[1]] : entry)); }}/></div>
        <div className="w2-picker-row"><span className="w2-row-label">Of the list</span>
          <SelectMenu label={`List-wide value of ${name}`} value={field.aggregate} options={[{ value: 'min', label: 'Smallest' }, { value: 'max', label: 'Largest' }]}
            onChange={next => write(entries.map((entry, index) => index === at ? [name, { ...field, aggregate: next as 'min' | 'max' }] : entry))}/></div>
        <ValuePickerRow draft={ctx.draft} label="Value" title={`Value of ${name}`} stacked primary={operandName(field.value, names)}
          onPick={picked => ctx.draft.set(replaceAt(ctx.draft.get(), [...path, 'fields', name, 'value'], picked.operand as unknown as Json))}/>
        <button type="button" className="w2-expr-remove" disabled={entries.length < 2} onClick={() => write(entries.filter((_, index) => index !== at))}>Remove Field</button>
      </li>)}</ol>
      <button type="button" className="w2-expr-add" disabled={entries.length >= 8} onClick={() => {
        let n = entries.length + 1; while (taken(`field${n}`)) n += 1;
        write([...entries, [`field${n}`, { aggregate: 'min', value: { type: 'literal', value: 0 } }]]);
      }}><Plus size={14} aria-hidden="true"/>Add Field</button>
      <FieldsAfter ctx={ctx} shape={ctx.arriving}/>
    </div>
  </FlowScopeProvider>;
}

/** A choice among the fields of what arrives (Go Into, Choose Entry, Fill In Missing's field, Flatten). */
function FieldChoice({ ctx, label, value, kinds, onChange }: { ctx: StepContext; label: string; value: string; kinds?: string[]; onChange: (name: string) => void }) {
  const base = ctx.arriving.kind === 'object' ? Object.entries(ctx.arriving.fields).map(([name, field]) => ({ name, shape: field.shape })) : itemFields(ctx.arriving).map(field => ({ name: field.name, shape: field.shape }));
  const options = base.filter(field => !kinds || kinds.includes(kindWords(field.shape).kind)).map(field => ({ value: field.name, label: field.name }));
  const choices = options.some(option => option.value === value) ? options : [{ value, label: value || 'Choose' }, ...options];
  return <div className="w2-picker-row"><span className="w2-row-label">{label}</span><SelectMenu label={label} value={value} options={choices} onChange={onChange}/></div>;
}

/** The page of a step that has no Filter or Sort grammar: its own few rows. */
function PlainPage({ ctx }: { ctx: StepContext }) {
  const { step, path, set } = useStep(ctx);
  if (!step) return null;
  switch (step.op) {
    case 'limit': return <div className="w2-editor-section w2-data-step"><div className="w2-picker-row"><span className="w2-row-label">Keep the first</span>
      <TextInput label="Count" number value={String(step.count)} onCommit={text => { const count = Math.floor(Number(text)); if (Number.isFinite(count) && count >= 1 && count <= 1000) set({ ...step, count }, 'count'); }}/></div>
      <p className="w2-caption">Up to 1000.</p><FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    case 'count': return <div className="w2-editor-section w2-data-step"><p className="w2-caption">Counts the items that arrive. It gives one number.</p></div>;
    case 'first': return <div className="w2-editor-section w2-data-step"><p className="w2-caption">Keeps the first item and drops the rest. It gives one item, or none when the list is empty.</p><FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    case 'get': return <div className="w2-editor-section w2-data-step"><FieldChoice ctx={ctx} label="Go into" value={step.path[0] ?? ''} onChange={name => set({ ...step, path: [name] })}/><FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    case 'select-key': return <div className="w2-editor-section w2-data-step"><FieldChoice ctx={ctx} label="Entry" value={step.key.type === 'literal' ? String(step.key.value) : ''} onChange={name => set({ ...step, key: { type: 'literal', value: name } })}/><FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    case 'flatten': return <div className="w2-editor-section w2-data-step"><FieldChoice ctx={ctx} label="Lists in" value={step.path[0] ?? ''} kinds={['List']} onChange={name => set({ ...step, path: name ? [name] : [] })}/><FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    case 'default': return <div className="w2-editor-section w2-data-step"><FieldChoice ctx={ctx} label="When missing" value={step.path[0] ?? ''} onChange={name => set({ ...step, path: [name] })}/>
      <div className="w2-picker-row"><span className="w2-row-label">Fill in</span><TextInput label="Fill in" value={step.value.type === 'literal' ? String(step.value.value ?? '') : ''} onCommit={text => ctx.draft.set(replaceAt(ctx.draft.get(), [...path, 'value'], { type: 'literal', value: text } as unknown as Json), 'fill')}/></div>
      <FieldsAfter ctx={ctx} shape={ctx.arriving}/></div>;
    default: return null;
  }
}

/** The page a step pushes: Filter and Sort have their own grammar, Set Fields a list of value fields, the rest a few rows. */
export default function StepPage({ ctx }: { ctx: StepContext }) {
  const { step } = useStep(ctx);
  if (!step) return null;
  switch (step.op) {
    case 'filter': return <FilterPage ctx={ctx}/>;
    case 'sort': return <SortPage ctx={ctx}/>;
    case 'map': return <MapPage ctx={ctx}/>;
    case 'group': return <ValueStep ctx={ctx} label="Group by" field="by"/>;
    case 'unique': return <ValueStep ctx={ctx} label="One for each" field="by"/>;
    case 'sum': return <ValueStep ctx={ctx} label="Add up" field="value"/>;
    // The extra steps (`sh.flow-extras@1`).
    case 'min': return <ValueStep ctx={ctx} label="Smallest of" field="value"/>;
    case 'max': return <ValueStep ctx={ctx} label="Largest of" field="value"/>;
    case 'running-sum': return <RunningSumPage ctx={ctx}/>;
    case 'annotate': return <AnnotatePage ctx={ctx}/>;
    default: return <PlainPage ctx={ctx}/>;
  }
}
