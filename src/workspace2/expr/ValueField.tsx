import { useRef } from 'react';
import { ChevronRight, ListChecks, Link2 } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { evaluateOperand, scalarText } from '../data/logic/logicEval';
import EditorRow from '../editors/EditorRow';
import { TextInput } from '../editors/controls';
import { useRows } from '../rowsContext';
import LookControl, { LookGlyph, type LookKind } from './LookControl';
import ValueEditor, { type ValueMode } from './ValueEditor';
import { operandName } from './condition';
import { modeOf, rulesOf, rulesProblem, ruleStatus, type Kind, type RulesDraft } from './value';
import { parseLine, slotOperand } from './tokens';
import { ValueButton } from './ui';
import { useDataTag, useDraftEnvironment, useNameContext } from './useExpr';
import { words } from './words';
import { thenName } from './RulesList';

type Slot = { type: string } & Record<string, unknown>;

/** Props of {@link ValueField}: where the slot is, what it holds, and which modes the place may use (spec "Where the fields are wired"). */
export interface ValueFieldProps {
  /** The row's label ("Title"). */
  label: string;
  /** The slot's path in the document. */
  path: EditorPath;
  kind: Kind;
  /** For an icon or a color: which. */
  look?: LookKind;
  /** The edited item's name, for the dialog header and the Undo title. */
  itemName: string;
  /** The modes the place offers. A color or an icon offers From Entity only once the contract has it (asks 3 and 4). */
  modes?: readonly ValueMode[];
  maxLength?: number;
}

const menuChoices = [{ value: 'fixed', label: words.fixed }, { value: 'entity', label: `${words.fromEntity}…` }, { value: 'rules', label: `${words.rules}…` }] as const;

/** The face of a value that is not Fixed: a leading glyph, line 1 the source or the rules count, line 2 what it gives now. */
function ValueFace({ slot, kind, look, label, onOpen }: { slot: Slot; kind: Kind; look?: LookKind; label: string; onOpen: () => void }) {
  const { document } = useRows();
  const env = useDraftEnvironment(document), ctx = useNameContext(document), tag = useDataTag();
  const mode = modeOf(slot, kind);
  let glyph: React.ReactNode, line1: string, line2 = '', name: string;
  if (mode === 'rules') {
    const rules = rulesOf(slot, kind) as RulesDraft<Operand | Json>, status = ruleStatus(rules, env, kind);
    const used = status.used, now = used === undefined ? undefined : used === 'otherwise' ? rules.otherwise : rules.cases[used]?.then;
    line1 = `${rules.cases.length} rule${rules.cases.length === 1 ? '' : 's'}`;
    line2 = used === undefined ? '' : `Now: ${used === 'otherwise' ? words.otherwise : `Rule ${used + 1}`}${env ? ` · ${tag}` : ''}`;
    glyph = kind === 'text' || now === undefined ? <ListChecks size={18} aria-hidden/> : <LookGlyph look={look ?? 'fill'} value={now as Json}/>;
    name = `${label}: ${line1}.${line2 ? ` ${line2.replace(' · ', ', ')}` : ''}${used !== undefined && now !== undefined ? ` ${thenName(kind, look, now, ctx)}.` : ''}`;
  } else if (mode === 'custom') {
    glyph = <Link2 size={18} aria-hidden/>; line1 = words.customValue; line2 = words.customNote; name = `${label}: ${line1}. ${line2}`;
  } else {
    const bound = kind !== 'text' && (slot.type === 'bound-color' || slot.type === 'bound-symbol');
    const operand = bound ? slot.value as Operand : slotOperand(slot), parts = operand && !bound ? parseLine(operand) : undefined;
    line1 = bound ? (operand ? operandName(operand, ctx) : label) : parts ? parts.map(part => 'text' in part ? part.text : operandName(part.token.operand, ctx)).join('') || label : words.customValue;
    const result = operand && env ? evaluateOperand(operand, env) : undefined;
    line2 = result ? result.status === 'value' ? `Now: ${scalarText(result.value) ?? ''} · ${tag}` : "Can't tell yet" : '';
    glyph = <Link2 size={18} aria-hidden/>; name = `${label}: ${line1}.${line2 ? ` ${line2.replace(' · ', ', ')}` : ''}`;
  }
  return <button type="button" className="w2-expr-fieldbtn" data-testid="value-field" data-mode={mode} data-two-line aria-label={name} title={line1} onClick={onOpen}>
    <span className="w2-expr-faceglyph">{glyph}</span>
    <span className="w2-expr-fieldtext"><span className="w2-expr-line1">{line1}</span>{line2 && <span className="w2-expr-line2">{line2}</span>}</span><ChevronRight size={16} aria-hidden/>
  </button>;
}

/**
 * The value field (spec "The value field"): a text, a color or an icon that is Fixed, From Entity or Rules. At rest, Fixed is the field's own
 * control and the value button; the other two are one two-line button. Pressing opens {@link ValueEditor} on a draft; Done is one step.
 */
export default function ValueField({ label, path, kind, look, itemName, modes = ['fixed', 'entity', 'rules'], maxLength }: ValueFieldProps) {
  const { document, onChange } = useRows();
  const slot = valueAt(document, path) as Slot | undefined;
  const mode = modeOf(slot, kind);
  const pending = useRef<ValueMode | undefined>(undefined);
  const choices = menuChoices.filter(choice => modes.includes(choice.value));
  const key = path.join('/');
  const blocked = (doc: typeof document) => { const rules = rulesOf(valueAt(doc, path) as Slot | undefined, kind); return rules ? rulesProblem(rules as RulesDraft<Operand | Json>, kind) : undefined; };
  return <EditorRow label={label} summary="" itemName={itemName} document={document} onApply={onChange} path={key} blocked={blocked}
    head={start => <div className="w2-expr-valuerow" data-field-path={key} data-mode={mode}>
      {mode === 'fixed' && slot && <>
        {kind === 'text'
          ? <div className="w2-picker-row"><span className="w2-row-label">{label}</span><TextInput label={label} value={String(slotOperand(slot)?.type === 'literal' ? (slotOperand(slot) as { value: unknown }).value : '')} maxLength={maxLength} onCommit={text => onChange(replaceAt(document, path, { type: 'literal', value: text }))}/></div>
          : <LookControl look={look ?? 'fill'} value={slot as unknown as Json} label={label} path={key} onChange={(next, live) => onChange(replaceAt(document, path, next), live ? `look:${key}` : undefined)}/>}
        {choices.length > 1 && <ValueButton label={label} mode={mode as ValueMode} choices={choices} onPick={next => { if (next === 'fixed') return; pending.current = next; start(); }}/>}
      </>}
      {mode !== 'fixed' && slot && <div className="w2-picker-row" data-stacked><ValueFace slot={slot} kind={kind} look={look} label={label} onOpen={() => { pending.current = undefined; start(); }}/></div>}
    </div>}>
    {draft => <ValueEditor draft={draft} path={path} kind={kind} look={look} modes={modes} label={label} initialMode={pending.current} maxLength={maxLength}/>}
  </EditorRow>;
}
