import { useEffect, useRef, useState } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { TextInput } from '../editors/controls';
import { useDraftDocument, type Draft } from '../editors/draft';
import FromEntity from './FromEntity';
import LookFromEntity from './LookFromEntity';
import LookControl, { type LookKind } from './LookControl';
import RulesList from './RulesList';
import TryValues from './TryValues';
import { Segmented } from './ui';
import { inputsOf, operandInputs } from './condition';
import { fixedOf, modeOf, rulesOf, seedRules, toSlot, type Kind, type Mode, type RulesDraft } from './value';
import { slotOperand, wordingFor01, type Part } from './tokens';
import { words } from './words';
import SaveAsLogic from '../data/logic/SaveLogicDialog';

type Slot = { type: string } & Record<string, unknown>;
/** The words a Fixed field shows for a slot: its own text, or the text of a literal operand; nothing for logic that is not a plain value (a use, a rule, a read). */
const fixedText = (slot: unknown): string => {
  const held = slot as { type?: string; value?: unknown } | undefined;
  if (!held) return '';
  if (held.type === 'literal') return typeof held.value === 'object' ? '' : String(held.value ?? '');
  const operand = slotOperand(held as never) as { type?: string; value?: unknown } | undefined;
  return operand?.type === 'literal' && typeof operand.value !== 'object' ? String(operand.value ?? '') : '';
};
type Memo = { mode?: Exclude<Mode, 'custom'>; fixed?: Operand | Json; entity?: Operand; rules?: RulesDraft<Operand | Json>; entered?: boolean };
/** What each mode last held while the page is open (spec "Changing mode keeps work"); it is the page's, never the document's. */
const memory = new WeakMap<Draft, Map<string, Memo>>();
const memoOf = (draft: Draft, key: string): Memo => {
  const all = memory.get(draft) ?? new Map<string, Memo>();
  memory.set(draft, all);
  return all.get(key) ?? all.set(key, {}).get(key)!;
};

/** The words of the three modes. */
const modeWords = { fixed: words.fixed, entity: words.fromEntity, rules: words.rules } as const;
export type ValueMode = keyof typeof modeWords;

/**
 * The value editor's body (spec "The value field"): Fixed | From Entity | Rules, then the mode's own controls. Changing mode keeps each
 * mode's last content and seeds the first time (Rules gets the current value as Otherwise and one empty rule). Done stores the mode on show.
 */
export default function ValueEditor({ draft, path, kind, modes, look, label, initialMode, maxLength }: {
  draft: Draft; path: EditorPath; kind: Kind; modes: readonly ValueMode[]; look?: LookKind; label: string; initialMode?: ValueMode; maxLength?: number;
}) {
  const document = useDraftDocument(draft);
  const slot = valueAt(document, path) as Slot | undefined;
  const key = path.join('/'), memo = memoOf(draft, key);
  const derived = modeOf(slot, kind);
  const [mode, setModeState] = useState<ValueMode>(() => memo.mode ?? (derived === 'custom' ? 'fixed' : derived));
  const entered = useRef(false);
  const setMode = (next: ValueMode) => {
    const current = draft.get(), now = valueAt(current, path) as Slot, was = memo.mode ?? mode;
    // What the mode on show holds now goes into memory.
    if (was === 'fixed') memo.fixed = fixedOf(now, kind);
    else if (was === 'entity') { memo.entity = kind === 'text' ? slotOperand(now) : (now as unknown as { value: Operand }).value; if (kind !== 'text') memo.fixed = fixedOf(now, kind); }
    else memo.rules = rulesOf(now, kind);
    const currentValue = was === 'rules' ? memo.rules!.otherwise : was === 'entity' ? (kind === 'text' ? memo.entity! : memo.fixed!) : memo.fixed!;
    memo.mode = next; setModeState(next);
    let written: Slot;
    if (next === 'rules') { memo.rules ??= seedRules(currentValue); written = toSlot('rules', { rules: memo.rules }, kind); }
    else if (next === 'entity') { memo.entity ??= (kind === 'text' ? (was === 'fixed' ? memo.fixed : currentValue) as Operand : { type: 'literal', value: '' }); if (kind !== 'text') memo.fixed ??= currentValue; written = toSlot('entity', { entity: memo.entity, fixed: memo.fixed }, kind); }
    else { memo.fixed ??= was === 'rules' ? memo.rules!.otherwise : currentValue; written = toSlot('fixed', { fixed: memo.fixed }, kind); }
    draft.set(replaceAt(current, path, written as unknown as Json));
  };
  // Opening in a mode the row's value button chose is one step, made once.
  useEffect(() => {
    if (entered.current || !initialMode || initialMode === mode) return;
    entered.current = true;
    setMode(initialMode);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** "Wording for 0 and 1…": the line becomes Rules (one step in the draft). */
  const wording = (parts: Part[], at: number) => {
    const made = wordingFor01(parts, at);
    if (!made) return;
    memo.entity = slotOperand(valueAt(draft.get(), path) as Slot);
    memo.rules = { cases: made.cases, otherwise: made.otherwise } as RulesDraft<Operand | Json>;
    memo.mode = 'rules'; setModeState('rules');
    draft.set(replaceAt(draft.get(), path, toSlot('rules', { rules: memo.rules }, kind) as unknown as Json));
  };
  const inputs = mode === 'rules' ? (rulesOf(slot, kind)?.cases ?? []).flatMap(entry => inputsOf(entry.when)) : kind === 'text' && slot ? (() => { const operand = slotOperand(slot); return operand ? operandInputs(operand) : []; })() : mode === 'entity' && slot && 'value' in slot ? operandInputs(slot.value as Operand) : [];
  const unique = [...new Map(inputs.map(input => [`${input.sourceId}|${input.path.join('/')}`, input])).values()];
  return <div className="w2-editor-section w2-expr-editor" data-testid="value-editor" data-mode={mode}>
    {kind === 'text' && <SaveAsLogic draft={draft} path={path} kind="value" onSaved={() => { memo.mode = 'entity'; setModeState('entity'); }}/>}
    {modes.length > 1 && <Segmented label={`${label} value`} value={mode} options={modes.map(item => ({ value: item, label: modeWords[item] }))} onChange={setMode}/>}
    {mode === 'fixed' && <>
      {kind === 'text'
        ? <div className="w2-picker-row" data-stacked><TextInput label={label} value={fixedText(slot)} maxLength={maxLength}
          onCommit={text => draft.set(replaceAt(draft.get(), path, { type: 'literal', value: text }), `fixed:${key}`)}/></div>
        : <LookControl look={look ?? 'fill'} value={slot as unknown as Json} label={label} onChange={(next, live) => draft.set(replaceAt(draft.get(), path, next), live ? `look:${key}` : undefined)}/>}
      <p className="w2-caption">{words.sameValue}</p></>}
    {mode === 'entity' && kind === 'text' && <FromEntity draft={draft} path={path} label={label} onWording={wording}/>}
    {mode === 'entity' && kind !== 'text' && <LookFromEntity draft={draft} path={path} kind={kind} look={look ?? 'fill'} label={label}/>}
    {mode === 'rules' && <RulesList draft={draft} path={path} kind={kind} look={look} label={label}/>}
    <TryValues document={document} inputs={unique}/>
  </div>;
}
