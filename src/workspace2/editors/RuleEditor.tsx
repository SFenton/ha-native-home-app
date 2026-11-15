/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { predicateSchema, whenUnknownPolicies, type Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { evaluatePredicate } from '../../preview2/evaluate';
import { Tag } from '../kit';
import { ensureSource, sourceEntity } from '../add/sources';
import { EntityField, PickerRow } from '../pickers/PickerField';
import EntityList from '../pickers/EntityList';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { changeOperator, closeRule, entityCondition, openRule, ruleProblem, ruleSummary, rowKind, type RowKind, type RuleRoot } from './rule';
import { useDraftDocument, type Draft } from './draft';
import EditorRow from './EditorRow';
import JsonBlock from './JsonBlock';
import { useRows } from '../rows';

const operators = ['is', 'is not', 'is above', 'is below'] as const;
const commonStates = ['on', 'off', 'home', 'not_home', 'locked', 'unlocked', 'open', 'closed', 'unavailable'];
const operatorOf = (kind: RowKind) => kind === 'state' ? 'is' : kind === 'not-state' ? 'is not' : kind === 'numeric-above' ? 'is above' : 'is below';

/** A multi-select of chips with a field for a value that is not listed. */
function ChipSet({ label, options, value, onChange }: { label: string; options: readonly string[]; value: readonly string[]; onChange: (next: string[]) => void }) {
  const [typed, setTyped] = useState('');
  const all = [...new Set([...options, ...value])];
  const toggle = (item: string) => { const next = value.includes(item) ? value.filter(part => part !== item) : [...value, item]; if (next.length) onChange(next); };
  return <div className="w2-chipset" role="group" aria-label={label}>
    {all.map(item => <button type="button" key={item} className="w2-chip" aria-pressed={value.includes(item)} onClick={() => toggle(item)}>{item}</button>)}
    <input aria-label={`Another ${label.toLowerCase()}`} placeholder="Other" className="w2-chip-input" value={typed} onChange={event => setTyped(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && typed.trim()) { toggle(typed.trim()); setTyped(''); } }}/>
  </div>;
}

/** One condition drawn as a sentence: [source] [operator] [value]. */
function Condition({ draft, predicate, kind, level, onChange, onRemove }: { draft: Draft; predicate: Predicate; kind: RowKind; level: number; onChange: (next: Predicate) => void; onRemove: () => void }) {
  const doc = useDraftDocument(draft);
  const { entities } = useWorkspaceData();
  const inner = predicate.type === 'not' ? predicate.of : predicate;
  const entityOf = (p: Predicate) => (p.type === 'state' || p.type === 'numeric') ? sourceEntity(doc.dataSources.find(source => source.id === p.sourceId)) : undefined;
  const entityId = entityOf(inner);
  const row = entities.find(item => item.entityId === entityId);
  const rebind = (id: string) => {
    const made = ensureSource(draft.get(), id);
    draft.set(made.document);
    const next = { ...inner, sourceId: made.sourceId } as Predicate;
    onChange(predicate.type === 'not' ? { type: 'not', of: next } : next);
  };
  let sentence: React.ReactNode;
  switch (kind) {
    case 'state': case 'not-state': case 'numeric-above': case 'numeric-below': {
      const numeric = kind === 'numeric-above' || kind === 'numeric-below';
      sentence = <>
        <EntityField label="Entity" entityId={entityId} onPick={picked => rebind(picked.entityId)}/>
        <select aria-label="Operator" value={operatorOf(kind)} onChange={event => onChange(changeOperator(predicate, event.target.value as typeof operators[number]))}>{operators.map(item => <option key={item} value={item}>{item}</option>)}</select>
        {numeric && inner.type === 'numeric' ? <input type="number" aria-label="Number" defaultValue={Number(((inner.above ?? inner.below) as { value?: number } | undefined)?.value ?? 0)}
          onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onChange({ ...inner, [kind === 'numeric-above' ? 'above' : 'below']: { type: 'literal', value } } as Predicate); }}/>
          : inner.type === 'state' ? <ChipSet label="States" options={[...(row?.state ? [row.state] : []), ...commonStates]} value={inner.in} onChange={next => { const updated = { ...inner, in: next }; onChange(predicate.type === 'not' ? { type: 'not', of: updated } : updated); }}/> : null}
      </>; break;
    }
    case 'viewer-admin': sentence = <><span>The person using the app</span><select aria-label="The person" value={String((predicate as any).isAdmin)} onChange={event => onChange({ type: 'viewer', isAdmin: event.target.value === 'true' })}><option value="true">is an admin</option><option value="false">is not an admin</option></select></>; break;
    case 'viewer-users': sentence = <><span>The person using the app is one of</span><input aria-label="User IDs" defaultValue={((predicate as any).userIds as string[]).join(', ')} onBlur={event => { const ids = event.target.value.split(',').map(part => part.trim()).filter(Boolean); if (ids.length) onChange({ type: 'viewer', userIds: ids }); }}/></>; break;
    case 'viewer-person': sentence = <><span>The person using the app is</span><ChipSet label="People" options={entities.filter(item => item.domain === 'person').map(item => item.entityId)} value={(predicate as any).in} onChange={next => onChange({ type: 'viewer-person', in: next })}/></>; break;
    default: sentence = <JsonBlock label="Edit as JSON" value={predicate as unknown as Json} onChange={next => onChange(next as unknown as Predicate)} validate={value => predicateSchema.safeParse(value).success ? undefined : 'That is not a valid rule.'}/>;
  }
  return <div className="w2-rule-sentence" data-rule-kind={kind} data-level={level}><div className="w2-rule-parts">{sentence}</div>
    <button type="button" className="w2-icon-button" aria-label="Remove condition" onClick={onRemove}><X size={16} aria-hidden/></button></div>;
}

/** A group block: "Show when [all|any] of these are true", its rows, and the Add buttons. */
function Group({ draft, items, mode, level, onChange, root }: { draft: Draft; items: Predicate[]; mode: 'all' | 'any'; level: number; onChange: (items: Predicate[], mode: 'all' | 'any') => void; root?: boolean }) {
  const set = (at: number, next: Predicate | undefined) => onChange(next ? items.map((item, i) => i === at ? next : item) : items.filter((_, i) => i !== at), mode);
  const addPredicate = (predicate: Predicate) => onChange([...items, predicate], mode);
  return <div className={root ? 'w2-rule-root' : 'w2-rule-group'} data-level={level}>
    <div className="w2-rule-head"><span>{root ? 'Show when' : 'When'}</span>
      <select aria-label="All or any" value={mode} onChange={event => onChange(items, event.target.value as 'all' | 'any')}><option value="all">all</option><option value="any">any</option></select><span>of these are true</span></div>
    {items.map((item, at) => {
      const kind = rowKind(item, level);
      return kind === 'group' ? <div key={at} className="w2-rule-nested"><Group draft={draft} items={(item as { of: Predicate[] }).of} mode={item.type as 'all' | 'any'} level={level + 1}
        onChange={(next, nextMode) => next.length ? set(at, { type: nextMode, of: next }) : set(at, undefined)}/></div>
        : <Condition key={at} draft={draft} predicate={item} kind={kind} level={level} onChange={next => set(at, next)} onRemove={() => set(at, undefined)}/>;
    })}
    <div className="w2-rule-actions">
      <PickerRow stacked title="Add Condition" primary={<><Plus size={14} aria-hidden/> Add Condition</>}>
        {close => <div className="w2-rule-add">
          <button type="button" className="w2-choice" onClick={() => { addPredicate({ type: 'viewer', isAdmin: true }); close(); }}>The person using the app</button>
          <EntityList onPick={row => { const made = entityCondition(draft.get(), row.entityId); draft.set(made.document); addPredicate(made.predicate); close(); }} height={300}/>
        </div>}
      </PickerRow>
      {level < 2 && <button type="button" onClick={() => addPredicate({ type: 'all', of: [{ type: 'viewer', isAdmin: true }] })}>Add Group</button>}
    </div>
  </div>;
}

/** The rule builder's body (spec 8.5). */
export function RuleBody({ draft, path }: { draft: Draft; path: EditorPath }) {
  const doc = useDraftDocument(draft);
  const { environment } = useWorkspaceData();
  const rule = valueAt(doc, path) as Predicate | undefined;
  const root = openRule(rule);
  const parent = path.slice(0, -1);
  const write = (next: RuleRoot) => {
    const closed = closeRule(next), current = draft.get();
    const holder = valueAt(current, parent) as Record<string, unknown>;
    if (closed) { draft.set(replaceAt(current, path, closed)); return; }
    const { [String(path.at(-1))]: _rule, whenUnknown: _policy, ...rest } = holder;
    draft.set(replaceAt(current, parent, rest));
  };
  const policy = (valueAt(doc, parent) as { whenUnknown?: string } | undefined)?.whenUnknown ?? 'show';
  const problem = ruleProblem(rule);
  const now = rule && environment ? evaluatePredicate(rule, environment) : undefined;
  return <div className="w2-editor-section" data-testid="rule-editor">
    <p className="w2-rule-summary">{ruleSummary(rule)}</p>
    <Group draft={draft} root items={root.items} mode={root.mode} level={1} onChange={(items, mode) => write({ mode, items, wrapped: root.wrapped && items.length <= 1 && mode === 'all' })}/>
    {problem && <p role="alert" className="w2-error-text">{problem}</p>}
    {path.at(-1) === 'visibleWhen' && <div className="w2-field-row"><span className="w2-field-label">While the state is unknown</span><div className="w2-segment w2-field-control" role="group" aria-label="While the state is unknown">
      {whenUnknownPolicies.map(value => <button type="button" key={value} aria-pressed={policy === value} onClick={() => draft.set(replaceAt(draft.get(), [...parent, 'whenUnknown'], value))}>{value === 'show' ? 'Show' : value === 'hide' ? 'Hide' : 'Keep last'}</button>)}</div></div>}
    {now && now !== 'unknown' && <Tag tone="neutral">{now === 'yes' ? 'Shown now' : 'Hidden now'}</Tag>}
  </div>;
}

/** The "Visible when" row: it opens the rule builder. */
export function RuleRow({ label, path, itemName }: { label: string; path: EditorPath; itemName: string }) {
  const { document, onChange } = useRows();
  const rule = valueAt(document, path) as Predicate | undefined;
  return <EditorRow label={label} summary={ruleSummary(rule)} itemName={itemName} document={document} onApply={onChange} path={path.join('/')}
    remove={rule ? { label: 'Remove Rule', run: draft => { const parent = path.slice(0, -1); const holder = valueAt(draft.get(), parent) as Record<string, unknown>; const { [String(path.at(-1))]: _rule, whenUnknown: _policy, ...rest } = holder; draft.set(replaceAt(draft.get(), parent, rest)); } } : undefined}>
    {draft => <RuleBody draft={draft} path={path}/>}
  </EditorRow>;
}
export type { CompositionDocument };
