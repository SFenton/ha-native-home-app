import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { fieldVariants, replaceAt, resolveField, valueAt, variantName, type EditorPath, type SchemaField } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import { kindWords, kindOf } from '../editors/action';
import { useDraftDocument, type Draft } from '../editors/draft';
import { usePush } from '../kit';
import ConditionEditor from './ConditionEditor';
import { sentence } from './condition';
import { useNameContext } from './useExpr';
import { words } from './words';
import { Segmented } from './ui';

type Action = { type: string } & Record<string, unknown>;
interface Case { when?: Predicate; then: Action }
interface ByRule { type: 'conditional'; cases: Case[]; otherwise: Action }
const MAX_CASES = 16;

/** The schema of one case's action: what the conditional variant's `then` accepts. */
export function caseSchema(schema: SchemaField): SchemaField | undefined {
  const rule = fieldVariants(schema).find(variant => variantName(resolveField(variant)) === 'conditional');
  const items = rule && resolveField(rule).properties?.cases ? resolveField(resolveField(rule).properties!.cases).items as SchemaField | undefined : undefined;
  return items ? resolveField(items).properties?.then : undefined;
}
const actionWords = (action: Action | undefined) => !action || action.type === 'none' ? words.doNothing : kindWords[kindOf(action as unknown as Json)] ?? action.type;

/** What the By Rule page of one rule (or Otherwise) holds: the condition (not for Otherwise) and the action it runs. */
function CasePage({ draft, path, index, schema, itemName, action }: { draft: Draft; path: EditorPath; index: number | 'otherwise'; schema: SchemaField; itemName: string; action: (draft: Draft, path: EditorPath, schema: SchemaField, itemName: string) => ReactNode }) {
  const document = useDraftDocument(draft), push = usePush();
  const rule = valueAt(document, path) as ByRule | undefined;
  if (!rule || (index !== 'otherwise' && !rule.cases[index])) return null;
  const thenPath = index === 'otherwise' ? [...path, 'otherwise'] : [...path, 'cases', index, 'then'];
  const none = index === 'otherwise' && rule.otherwise.type === 'none';
  const remove = () => { if (index === 'otherwise') return; draft.set(replaceAt(draft.get(), path, { ...rule, cases: rule.cases.filter((_, i) => i !== index) } as unknown as Json)); push?.pop(); };
  return <div className="w2-expr-rulepage" data-testid="action-rule-page">
    {index !== 'otherwise' && <>
      <div className="w2-expr-pagehead"><span className="w2-expr-grouplabel">{words.ifWord}</span></div>
      <ConditionEditor draft={draft} path={[...path, 'cases', index, 'when']} place="rule" scope="rule"/><hr className="w2-menu-sep"/></>}
    <span className="w2-expr-grouplabel">{words.then}</span>
    {index === 'otherwise' && <Segmented label="Otherwise" value={none ? 'none' : 'action'} options={[{ value: 'none', label: words.doNothing }, { value: 'action', label: words.oneAction }]}
      onChange={next => draft.set(replaceAt(draft.get(), thenPath, (next === 'none' ? { type: 'none' } : rule.cases[0]?.then ?? { type: 'back' }) as unknown as Json))}/>}
    {!none && action(draft, thenPath, schema, itemName)}
    {index !== 'otherwise' && <button type="button" className="w2-editor-remove w2-expr-removerule" disabled={rule.cases.length < 2} onClick={remove}>{words.removeRule}</button>}
  </div>;
}

/**
 * The By Rule body of an action slot (spec "Which action a tap runs"): each rule runs one action when its condition holds, and Otherwise
 * runs one or does nothing. `action` draws the action editor for one case, so a rule's Then is the same editor as One Action.
 */
export default function ActionRules({ draft, path, schema, itemName, action }: { draft: Draft; path: EditorPath; schema: SchemaField; itemName: string; action: (draft: Draft, path: EditorPath, schema: SchemaField, itemName: string) => ReactNode }) {
  const document = useDraftDocument(draft), push = usePush(), ctx = useNameContext(document);
  const rule = valueAt(document, path) as ByRule | undefined, then = caseSchema(schema);
  if (!rule || !then) return null;
  const open = (index: number | 'otherwise') => push?.push({ title: index === 'otherwise' ? words.otherwise : `Rule ${index + 1}`, body: <CasePage draft={draft} path={path} index={index} schema={then} itemName={itemName} action={action}/> });
  const add = () => {
    draft.set(replaceAt(draft.get(), path, { ...rule, cases: [...rule.cases, { then: structuredClone(rule.cases.at(-1)?.then ?? { type: 'back' }) }] } as unknown as Json));
    open(rule.cases.length);
  };
  return <div className="w2-expr-editor" data-testid="action-rules">
    <p className="w2-caption">{words.firstRuleTrue.replace('opens its tab', 'runs its action')}</p>
    <ol className="w2-expr-rules">
      {rule.cases.map((entry, index) => <li key={index} className="w2-expr-rule"><button type="button" className="w2-expr-rulebtn"
        aria-label={`Rule ${index + 1} of ${rule.cases.length}: if ${entry.when ? sentence(entry.when, ctx) : 'no condition yet'}, then ${actionWords(entry.then)}.`} onClick={() => open(index)}>
        <span className="w2-expr-num">{index + 1}</span>
        <span className="w2-expr-ruletext"><span className="w2-expr-line1">{words.ifWord} {entry.when ? sentence(entry.when, ctx) : '…'}</span><span className="w2-expr-line2">{words.then} {actionWords(entry.then)}</span></span>
        <ChevronRight size={16} aria-hidden/></button></li>)}
      <li className="w2-expr-rule"><button type="button" className="w2-expr-rulebtn" aria-label={`Otherwise: then ${actionWords(rule.otherwise)}.`} onClick={() => open('otherwise')}>
        <span className="w2-expr-num w2-expr-num-none" aria-hidden/>
        <span className="w2-expr-ruletext"><span className="w2-expr-line1"><strong>{words.otherwise}</strong></span><span className="w2-expr-line2">{words.then} {actionWords(rule.otherwise)}</span></span>
        <ChevronRight size={16} aria-hidden/></button></li>
    </ol>
    <button type="button" className="w2-expr-add" disabled={rule.cases.length >= MAX_CASES} onClick={add}><Plus size={14} aria-hidden/>{words.addRule}</button>
  </div>;
}

/** One Action or By Rule: the first control of an action slot that takes rules. Switching keeps the action as the first rule's, or the first rule's as the action. */
export function ActionModeSwitch({ draft, path, byRule }: { draft: Draft; path: EditorPath; byRule: boolean }) {
  const change = (next: string) => {
    const current = valueAt(draft.get(), path) as Action | ByRule | undefined;
    if (next === 'rules' && current && current.type !== 'conditional') draft.set(replaceAt(draft.get(), path, { type: 'conditional', cases: [{ then: structuredClone(current) }], otherwise: { type: 'none' } } as unknown as Json));
    if (next === 'one' && current?.type === 'conditional') draft.set(replaceAt(draft.get(), path, structuredClone((current as ByRule).cases[0]?.then ?? { type: 'back' }) as unknown as Json));
  };
  return <Segmented label="Action by" value={byRule ? 'rules' : 'one'} options={[{ value: 'one', label: words.oneAction }, { value: 'rules', label: words.byRule }]} onChange={change}/>;
}
