import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { Operand } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { usePush } from '../kit';
import { useDraftDocument, type Draft } from '../editors/draft';
import ConditionEditor from './ConditionEditor';
import LookControl, { type LookKind } from './LookControl';
import TokenField from './TokenField';
import { GroupLabel, MoreMenu } from './ui';
import { moveItem } from './condition';
import { MAX_RULES, rulesOf, toSlot, type Kind, type RulesDraft } from './value';
import { words } from './words';
import type { CompositionDocument } from '../../shared/composition/schema';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { documentEdit } from '../editors/documentEdit';

/** The path of the rules node inside a value slot: a look is the `conditional` itself, text is the `choose` inside an `expr`. */
export const rulesPath = (path: EditorPath, kind: Kind): EditorPath => kind === 'text' ? [...path, 'value'] : path;
export function duplicateRule(document: CompositionDocument, path: EditorPath, kind: Kind, index: number): CompositionDocument {
  const rules = rulesOf(valueAt(document, path) as { type: string }, kind);
  if (!rules?.cases[index] || rules.cases.length >= MAX_RULES) throw new Error('That rule cannot be duplicated.');
  const from = [...rulesPath(path, kind), 'cases', index];
  const copy = structuredClone(valueAt(resolveLogicUseBindings(document).document, from)) as typeof rules.cases[number];
  const next = replaceAt(document, path, toSlot('rules', { rules: { ...rules, cases: [
    ...rules.cases.slice(0, index + 1), copy, ...rules.cases.slice(index + 1),
  ] } }, kind, valueAt(document, path)) as unknown as Json);
  return documentEdit(document, next, { copied: [{ from, to: [...rulesPath(path, kind), 'cases', index + 1] }] });
}

/**
 * One rule's page ("Rule 1"): "If" holds the whole condition editor (Simple or Logic, no "If it can't tell"), "Then" the field's Fixed
 * control (for text, the token line), and Remove Rule. Otherwise has only "Then". It reads and writes the draft, never a closure.
 */
export default function RulePage({ draft, path, kind, look, index, label }: { draft: Draft; path: EditorPath; kind: Kind; look?: LookKind; index: number | 'otherwise'; label: string }) {
  const document = useDraftDocument(draft), push = usePush();
  const base = rulesPath(path, kind);
  const thenPath = index === 'otherwise' ? [...base, 'otherwise'] : [...base, 'cases', index, 'then'];
  const rules = rulesOf(valueAt(document, path) as ({ type: string } & Record<string, unknown>) | undefined, kind) as RulesDraft<Operand | Json> | undefined;
  if (!rules || (index !== 'otherwise' && !rules.cases[index])) return null;
  const write = (next: RulesDraft<Operand | Json>) => draft.set(replaceAt(draft.get(), path, toSlot('rules', { rules: next }, kind, valueAt(draft.get(), path)) as unknown as Json));
  const remove = () => { if (index === 'otherwise') return; write({ ...rules, cases: rules.cases.filter((_, i) => i !== index) }); push?.pop(); };
  const then = valueAt(document, thenPath);
  return <div className="w2-expr-rulepage w2-editor-section" data-testid="rule-page">
    {index !== 'otherwise' && <>
      <div className="w2-expr-pagehead"><GroupLabel>{words.ifWord}</GroupLabel>
        <MoreMenu label={`More for Rule ${index + 1}`} commands={[
          { label: words.moveUp, run: () => write({ ...rules, cases: moveItem(rules.cases, index, -1) }), disabled: index === 0 },
          { label: words.moveDown, run: () => write({ ...rules, cases: moveItem(rules.cases, index, 1) }), disabled: index === rules.cases.length - 1 },
          { label: words.duplicate, run: () => draft.set(duplicateRule(draft.get(), path, kind, index)), disabled: rules.cases.length >= MAX_RULES },
          { label: words.removeRule, run: remove, danger: true, separatorBefore: true, disabled: rules.cases.length < 2 }]}/></div>
      <ConditionEditor draft={draft} path={[...base, 'cases', index, 'when']} place="rule" scope="rule"/>
      <hr className="w2-menu-sep"/>
    </>}
    <GroupLabel>{words.then}</GroupLabel>
    {kind === 'text'
      ? <TokenField draft={draft} address={{ path: thenPath, wrap: 'operand' }} label={`${label}, ${index === 'otherwise' ? words.otherwise : `Rule ${index + 1}`}`}/>
      : <LookControl look={look ?? 'fill'} value={then as Json} label={label} onChange={(next, live) => draft.set(replaceAt(draft.get(), thenPath, next), live ? `look:${thenPath.join('/')}` : undefined)}/>}
    {index !== 'otherwise' && <button type="button" className="w2-editor-remove w2-expr-removerule" disabled={rules.cases.length < 2} onClick={remove}>{words.removeRule}</button>}
  </div>;
}
