import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronRight, GripVertical, Plus } from 'lucide-react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { usePush } from '../kit';
import { SelectMenu } from '../SelectMenu';
import { useDraftDocument, type Draft } from '../editors/draft';
import RulePage from './RulePage';
import { LookSummary, lookName, type LookKind } from './LookControl';
import { ResultLine } from './ResultLine';
import { inputsOf, moveItem, operandName, sentence, type NameContext } from './condition';
import { MAX_RULES, mixedKinds, rulesOf, ruleStatus, toSlot, type Kind, type RulesDraft } from './value';
import { parseLine } from './tokens';
import { MoreMenu } from './ui';
import { useDataTag, useDraftEnvironment, useNameContext } from './useExpr';
import { words } from './words';
import { scalarText, evaluateOperand } from '../../preview2/evaluate';

/** What a rule's Then says in a row: a look's swatch or glyph and name, or the text with its values named. */
export function ThenSummary({ kind, look, then, ctx }: { kind: Kind; look?: LookKind; then: Operand | Json | undefined; ctx: NameContext }) {
  if (kind !== 'text') return <LookSummary look={look ?? 'fill'} value={then as Json}/>;
  const parts = then ? parseLine(then as Operand) : undefined;
  if (!parts) return <span>{words.customValue}</span>;
  const text = parts.map(part => 'text' in part ? part.text : operandName(part.token.operand, ctx)).join('');
  return <span className="w2-expr-looksum">{text || '(empty)'}</span>;
}
/** The one-line words of a rule's Then, for an accessible name. */
export function thenName(kind: Kind, look: LookKind | undefined, then: Operand | Json | undefined, ctx: NameContext): string {
  if (kind !== 'text') return lookName(look ?? 'fill', then as Json);
  const parts = then ? parseLine(then as Operand) : undefined;
  return parts ? parts.map(part => 'text' in part ? part.text : operandName(part.token.operand, ctx)).join('') : words.customValue;
}

/**
 * The rules list (spec "Rules"): "The first rule that's true is used.", one row per rule with a grip, its number, its sentence and its
 * value, a fixed Otherwise row, Add Rule, and Preview. A row pushes the rule's page; the grip drags, and Space, the arrows and Space
 * move it by keyboard; More has the same moves. Waiting and Used Now come from the environment (dfexpr: a text rule that cannot tell stops the rule).
 */
export default function RulesList({ draft, path, kind, look, label }: { draft: Draft; path: EditorPath; kind: Kind; look?: LookKind; label: string }) {
  const document = useDraftDocument(draft), ctx = useNameContext(document), env = useDraftEnvironment(document), tag = useDataTag();
  const push = usePush();
  const slot = valueAt(document, path) as ({ type: string } & Record<string, unknown>) | undefined;
  const rules = rulesOf(slot, kind) as RulesDraft<Operand | Json> | undefined;
  const [preview, setPreview] = useState<number | 'otherwise' | 'live'>('live');
  const [lifted, setLifted] = useState<number>();
  const [drop, setDrop] = useState<number>();
  const [said, setSaid] = useState('');
  const list = useRef<HTMLOListElement>(null);
  if (!rules) return null;
  const count = rules.cases.length, status = ruleStatus(rules, env, kind);
  const write = (next: RulesDraft<Operand | Json>, typing?: string) => draft.set(replaceAt(draft.get(), path, toSlot('rules', { rules: next }, kind) as unknown as Json), typing);
  const open = (index: number | 'otherwise') => push?.push({ title: index === 'otherwise' ? words.otherwise : `Rule ${index + 1}`, body: <RulePage draft={draft} path={path} kind={kind} look={look} index={index} label={label}/> });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= count || to === from) return;
    write({ ...rules, cases: moveItem(rules.cases, from, to - from) });
    setSaid(`Rule ${from + 1} moved to ${to + 1} of ${count}`);
  };
  const add = () => { write({ ...rules, cases: [...rules.cases, { when: undefined, then: structuredClone(rules.otherwise) }] }); open(count); };
  const problem = kind === 'text' ? mixedKinds(rules as RulesDraft<Operand>) : undefined;
  const used = preview === 'live' ? status.used : preview;
  // Dragging: the grip follows the pointer; the row under it is where the rule lands (a 2 px accent line shows it).
  const target = (event: PointerEvent): number => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-rule-row]') ?? [])];
    const at = rows.findIndex(row => { const box = row.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
    return at < 0 ? rows.length : at;
  };
  const keys = (event: KeyboardEvent, index: number) => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setLifted(current => { const next = current === index ? undefined : index; setSaid(next === undefined ? `Rule ${index + 1} dropped` : `Rule ${index + 1} of ${count} lifted`); return next; }); return; }
    if (lifted !== index) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const to = index + (event.key === 'ArrowUp' ? -1 : 1); move(index, to); setLifted(to >= 0 && to < count ? to : index); window.requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('[data-grip]')[to >= 0 && to < count ? to : index]?.focus()); }
    if (event.key === 'Escape') { setLifted(undefined); setSaid(`Rule ${index + 1} put back`); }
  };
  const previewOptions = [{ value: 'live', label: words.live }, ...rules.cases.map((_, index) => ({ value: String(index), label: `Rule ${index + 1}` })), { value: 'otherwise', label: words.otherwise }];
  const nowLabel = used === undefined ? undefined : used === 'otherwise' ? words.otherwise : `Rule ${used + 1}`;
  const thenOf = used === undefined ? undefined : used === 'otherwise' ? rules.otherwise : rules.cases[used]?.then;
  return <div className="w2-expr-rules" data-testid="rules-list">
    <p className="w2-caption">{words.firstRule}</p>
    <ol ref={list} className="w2-expr-rulelist" aria-label={`${label} rules`}>
      {rules.cases.map((entry, index) => {
        const answer = status.answers[index], isUsed = used === index, waiting = status.waiting === index && preview === 'live';
        const tagWords = isUsed ? (preview === 'live' ? words.usedNow : words.testTag) : waiting ? words.waiting : undefined;
        const name = `Rule ${index + 1} of ${count}: if ${entry.when ? sentence(entry.when, ctx) : 'no condition yet'}, then ${thenName(kind, look, entry.then, ctx)}.${isUsed ? ' Used now.' : waiting ? ' Waiting.' : answer === 'no' ? '' : ''}`;
        return <li key={index} data-rule-row data-used={isUsed || undefined} data-waiting={waiting || undefined} data-lifted={lifted === index || undefined} data-drop-before={drop === index || undefined}>
          <button type="button" className="w2-expr-grip" data-grip aria-label={`Rule ${index + 1} of ${count}: drag to move. Space lifts, arrows move.`} aria-pressed={lifted === index} disabled={count < 2}
            onKeyDown={event => keys(event, index)}
            onPointerDown={event => { if (count < 2) return; event.currentTarget.setPointerCapture(event.pointerId); setLifted(index); setDrop(index); }}
            onPointerMove={event => { if (lifted === index && event.buttons) setDrop(target(event)); }}
            onPointerUp={event => { if (lifted !== index) return; const to = target(event); setLifted(undefined); setDrop(undefined); move(index, to > index ? to - 1 : to); }}
            onPointerCancel={() => { setLifted(undefined); setDrop(undefined); }}><GripVertical size={16} aria-hidden/></button>
          <button type="button" className="w2-expr-rulebtn" aria-label={name} onClick={() => open(index)}>
            <span className="w2-expr-num" data-filled={isUsed || undefined} aria-hidden>{index + 1}</span>
            <span className="w2-expr-ruletext"><span className="w2-expr-line1">{words.ifWord} <strong>{entry.when ? sentence(entry.when, ctx) : '…'}</strong></span>
              <span className="w2-expr-line2">{words.then} <ThenSummary kind={kind} look={look} then={entry.then} ctx={ctx}/></span></span>
            {tagWords && <span className="w2-expr-tag" data-tone={isUsed ? 'used' : 'waiting'}>{tagWords}</span>}<ChevronRight size={16} aria-hidden/>
          </button>
          <MoreMenu label={`More for Rule ${index + 1}`} commands={[
            { label: words.moveUp, run: () => move(index, index - 1), disabled: index === 0 }, { label: words.moveDown, run: () => move(index, index + 1), disabled: index === count - 1 },
            { label: words.duplicate, run: () => write({ ...rules, cases: [...rules.cases.slice(0, index + 1), structuredClone(entry), ...rules.cases.slice(index + 1)] }), disabled: count >= MAX_RULES },
            { label: words.removeRule, run: () => write({ ...rules, cases: rules.cases.filter((_, i) => i !== index) }), danger: true, separatorBefore: true, disabled: count < 2 }]}/>
        </li>;
      })}
      <li data-rule-row data-otherwise data-used={used === 'otherwise' || undefined} data-drop-before={drop === count || undefined}>
        <span className="w2-expr-grip-gap" aria-hidden/>
        <button type="button" className="w2-expr-rulebtn" aria-label={`Otherwise: then ${thenName(kind, look, rules.otherwise, ctx)}.${used === 'otherwise' ? ' Used now.' : ''}`} onClick={() => open('otherwise')}>
          <span className="w2-expr-num w2-expr-num-none" aria-hidden/>
          <span className="w2-expr-ruletext"><span className="w2-expr-line1"><strong>{words.otherwise}</strong></span>
            <span className="w2-expr-line2">{words.then} <ThenSummary kind={kind} look={look} then={rules.otherwise} ctx={ctx}/></span></span>
          {used === 'otherwise' && <span className="w2-expr-tag" data-tone="used">{preview === 'live' ? words.usedNow : words.testTag}</span>}<ChevronRight size={16} aria-hidden/>
        </button>
      </li>
    </ol>
    <button type="button" className="w2-expr-add" disabled={count >= MAX_RULES} aria-describedby={count >= MAX_RULES ? 'w2-rules-limit' : undefined} onClick={add}><Plus size={14} aria-hidden/>{words.addRule}</button>
    {count >= MAX_RULES && <p id="w2-rules-limit" className="w2-caption">{words.sixteenRules}</p>}
    {problem && <p role="alert" className="w2-error-text" data-testid="rules-kind-problem">{problem.words}</p>}
    <div className="w2-row-segment"><span className="w2-row-label">{words.preview}</span>
      <div className="w2-expr-control"><SelectMenu label={words.preview} value={String(preview)} options={previewOptions} onChange={next => setPreview(next === 'live' || next === 'otherwise' ? next : Number(next))}/></div></div>
    <RulesResult kind={kind} look={look} now={nowLabel} then={thenOf} waiting={status.waiting} preview={preview !== 'live'} tag={preview !== 'live' ? words.testTag : env ? tag : undefined} ctx={ctx} rules={rules}/>
    <p className="w2-sr" role="status" aria-live="polite">{said}</p>
  </div>;
}

function RulesResult({ kind, look, now, then, waiting, preview, tag, ctx, rules }: { kind: Kind; look?: LookKind; now?: string; then?: Operand | Json; waiting?: number; preview: boolean; tag?: string; ctx: NameContext; rules: RulesDraft<Operand | Json> }) {
  if (!now) return null;
  if (waiting !== undefined && !preview && kind === 'text') {
    const input = inputsOf(rules.cases[waiting]?.when)[0];
    const name = input ? operandName({ type: 'read', from: { sourceId: input.sourceId, path: input.path } } as Operand, ctx) : `Rule ${waiting + 1}`;
    return <ResultLine marker="unknown" head={`Waiting for ${name}.`} tag={tag}>{'The text keeps what it showed.'}</ResultLine>;
  }
  return <ResultLine marker="check" head={`Now: ${now}`} tag={tag}><ThenSummary kind={kind} look={look} then={then} ctx={ctx}/></ResultLine>;
}
export { scalarText, evaluateOperand };
