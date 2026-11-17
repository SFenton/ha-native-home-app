import { useState } from 'react';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { SelectMenu } from '../SelectMenu';
import { TextInput } from '../editors/controls';
import { comparisonsFor, closeLeaf, kindOf, readOf, timeWords, weekdayNames, type Leaf, type NameContext, type ValueKind } from './condition';
import { comparisonWords, words, type Comparison } from './words';

const COMMON_STATES = ['on', 'off', 'home', 'not_home', 'locked', 'unlocked', 'open', 'closed', 'unavailable'] as const;
export { closeLeaf };
const lit = (value: Json): Operand => ({ type: 'literal', value });
const valueOf = (operand: Operand | undefined) => operand?.type === 'literal' ? operand.value : undefined;

/** The kind of the left side of a comparison, given what Home Assistant says its state looks like now. */
export function leftKind(leaf: Leaf, ctx: NameContext, state?: string, asKind?: ValueKind): ValueKind {
  if (asKind) return asKind;
  const read = readOf(leaf.left);
  if (read?.as === 'number') return 'number';
  if (read?.as === 'boolean') return 'yesno';
  if (read?.from.path.at(-1) === 'today') return 'date';
  // A raw state is text, a list count a number, "includes" yes or no.
  if (leaf.left.type === 'raw-state' || leaf.left.type === 'last-changed' || leaf.left.type === 'list-count' || leaf.left.type === 'list-includes') return kindOf(leaf.left);
  if (state !== undefined && Number.isFinite(Number(state)) && state.trim() !== '' && (leaf.comparison === 'is above' || leaf.comparison === 'is below')) return 'number';
  return leaf.left.type === 'clock' ? 'date' : leaf.left.type === 'viewer' && leaf.left.field === 'isAdmin' ? 'yesno' : 'text';
}

/** Whether a state ("18", "21.5 °F") starts with a number. */
export const numericState = (state?: string) => { const word = state?.trim().split(' ')[0] ?? ''; return word !== '' && Number.isFinite(Number(word)); };

/** Switches a comparison, keeping what it can of the other side: a number comparison starts at 0, a word comparison at nothing. */
export function withComparison(leaf: Leaf, comparison: Comparison): Leaf {
  const wasNumber = leaf.comparison === 'is above' || leaf.comparison === 'is below', isNumber = comparison === 'is above' || comparison === 'is below';
  const left = isNumber && leaf.left.type === 'read' ? { ...leaf.left, as: 'number' as const } : !isNumber && wasNumber && leaf.left.type === 'read' ? { ...leaf.left, as: 'string' as const } : leaf.left;
  if (comparison === 'has a value' || comparison === 'has no value') return { left, comparison, right: [] };
  if (isNumber && !wasNumber) return { left, comparison, right: [lit(0)] };
  if (!isNumber && wasNumber) return { left, comparison, right: [] };
  const multi = comparison === 'is one of' || comparison === 'is not one of';
  return { left, comparison, right: multi ? leaf.right : leaf.right.slice(0, 1) };
}

/** The comparison pop-up and the other side (chips of states, a number with its unit, a time, weekdays, yes or no), for one comparison. */
export function ComparisonControls({ leaf, onChange, kind, states = [], unit, closed, label = 'Comparison', allowed, numeric }: {
  leaf: Leaf; onChange: (leaf: Leaf, typing?: string) => void; kind: ValueKind; /** Words the entity can be now, current first. */ states?: readonly string[]; unit?: string; closed?: readonly string[]; label?: string; allowed?: readonly Comparison[];
  /** The entity's state reads as a number now, so "is above" and "is below" are offered beside the words. */ numeric?: boolean;
}) {
  const base = comparisonsFor(kind, leaf.left), more: Comparison[] = numeric && kind === 'text' ? (['is above', 'is below'] as const).filter(item => !base.includes(item)) : [];
  const all = [...base.slice(0, 3), ...more, ...base.slice(3)];
  const options = allowed ? all.filter(item => allowed.includes(item)) : all;
  const choices = options.includes(leaf.comparison) ? options : [leaf.comparison, ...options];
  const field = readOf(leaf.left)?.from.path.at(-1);
  const multi = leaf.comparison === 'is one of' || leaf.comparison === 'is not one of';
  return <>
    <div className="w2-expr-control"><SelectMenu label={label} value={leaf.comparison} options={choices.map(item => ({ value: item, label: comparisonWords[item] }))} onChange={next => onChange(withComparison(leaf, next as Comparison))}/></div>
    <OtherSide leaf={leaf} onChange={onChange} kind={kind} states={leaf.left.type === 'raw-state' ? ['unknown', 'unavailable', ...states] : states} unit={unit} closed={closed} multi={multi} field={field}/>
  </>;
}

function OtherSide({ leaf, onChange, kind, states, unit, closed, multi, field }: { leaf: Leaf; onChange: (leaf: Leaf, typing?: string) => void; kind: ValueKind; states: readonly string[]; unit?: string; closed?: readonly string[]; multi: boolean; field?: string }) {
  const [typed, setTyped] = useState('');
  const set = (right: Operand[], typing?: string) => onChange({ ...leaf, right }, typing);
  if (leaf.comparison === 'has a value' || leaf.comparison === 'has no value') return null;
  const first = leaf.right[0];
  if (first && first.type !== 'literal') return <p className="w2-caption">{`Compared with ${first.type === 'read' ? 'another value' : 'a custom value'}.`}</p>;
  if (leaf.comparison === 'is above' || leaf.comparison === 'is below' || (kind === 'number' && valueOf(first) !== undefined && typeof valueOf(first) === 'number') || kind === 'number') {
    const current = valueOf(first);
    return <div className="w2-expr-number" data-testid="condition-number">
      <TextInput label="Number" value={current === undefined ? '' : String(current)} number onCommit={text => { const value = Number(text); if (text.trim() !== '' && Number.isFinite(value)) set([lit(value)], 'number'); }}/>
      {unit && <span className="w2-expr-unit">{unit}</span>}
    </div>;
  }
  if (kind === 'yesno') {
    const chosen = valueOf(first);
    return <div className="w2-expr-chips" role="group" aria-label="Value">{[true, false].map(item => <button type="button" key={String(item)} className="w2-chip" aria-pressed={chosen === item} onClick={() => set([lit(item)])}>{item ? 'Yes' : 'No'}</button>)}</div>;
  }
  if (field === 'minuteOfDay') {
    const minutes = typeof valueOf(first) === 'number' ? valueOf(first) as number : 0;
    const text = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return <div className="w2-expr-time"><input type="time" aria-label={`Time, now ${timeWords(minutes)}`} value={text} onChange={event => { const [h, m] = event.target.value.split(':').map(Number); if (Number.isFinite(h) && Number.isFinite(m)) set([lit(h * 60 + m)]); }}/></div>;
  }
  if (field === 'weekday') {
    const chosen = leaf.right.map(valueOf);
    return <div className="w2-expr-chips" role="group" aria-label="Days">{weekdayNames.map((day, at) => <button type="button" key={day} className="w2-chip" aria-pressed={chosen.includes(at)}
      onClick={() => { const next = multi ? chosen.includes(at) ? chosen.filter(item => item !== at) : [...chosen, at] : [at]; if (next.length) set(next.map(item => lit(item as number))); }}>{day}</button>)}</div>;
  }
  if (kind === 'date') {
    const current = valueOf(first);
    return <div className="w2-expr-time"><input type="date" aria-label="Date" value={typeof current === 'string' ? current : ''} onChange={event => { if (event.target.value) set([lit(event.target.value)]); }}/></div>;
  }
  const chosen = leaf.right.map(valueOf).filter((item): item is string => typeof item === 'string');
  const options = [...new Set([...(closed ?? [...states, ...COMMON_STATES]), ...chosen])];
  const toggle = (item: string) => { const next = multi ? chosen.includes(item) ? chosen.filter(part => part !== item) : [...chosen, item] : [item]; if (next.length) set(next.map(lit)); };
  return <div className="w2-expr-chips" role="group" aria-label="Value">
    {options.map(item => <button type="button" key={item} className="w2-chip" aria-pressed={chosen.includes(item)} onClick={() => toggle(item)}>{item}</button>)}
    {!closed && <input aria-label="Other value" placeholder={words.other} className="w2-chip-input" value={typed} onChange={event => setTyped(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && typed.trim()) { toggle(typed.trim()); setTyped(''); } }}/>}
  </div>;
}
