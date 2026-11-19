import { useId, useState } from 'react';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import type { WhenUnknown } from '../../shared/composition/expression';
import type { Draft } from '../editors/draft';
import LogicBuilder from './LogicBuilder';
import SimpleCondition from './SimpleCondition';
import { ConditionResult } from './ResultLine';
import TryValues from './TryValues';
import { Segmented } from './ui';
import { fitsSimple, entityOfSource, inputsOf, operandName, type Scope } from './condition';
import { useNameContext } from './useExpr';
import { useRule } from './useRule';
import SaveAsLogic from '../data/logic/SaveLogicDialog';
import { policyChoices, words, type Place } from './words';
import { LogicField } from '../logic-fields/Field';
import { useLogicFields } from '../logic-fields/LogicFields';

type Mode = 'simple' | 'logic';
/** A person's choice of Logic for a simple condition is kept for that field while the page is open; it is not written to the document. */
const memory = new WeakMap<Draft, Map<string, Mode>>();

/** The "If it can't tell" row, for a place that has a policy (`visibleWhen`, `enabledWhen`). */
function PolicyRow({ draft, path, policyKey, kind, place }: { draft: Draft; path: EditorPath; policyKey: string; kind: 'show' | 'enable'; place: Place }) {
  const { document, rule } = useRule(draft, path, policyKey);
  const ctx = useNameContext(document);
  const parent = path.slice(0, -1), current = ((valueAt(document, parent) as Record<string, unknown> | undefined)?.[policyKey] as WhenUnknown | undefined) ?? 'keep';
  const first = inputsOf(rule)[0];
  const name = first ? (entityOfSource(ctx, first.sourceId) ? operandName({ type: 'read', from: { type: 'source', sourceId: first.sourceId, path: first.path }, as: 'string', missing: 'unavailable' }, ctx) : 'a value it reads') : 'a value it reads';
  void place;
  if (!rule) return null;
  return <div className="w2-expr-policy"><hr className="w2-menu-sep"/>
    <div className="w2-row-segment"><span className="w2-row-label">{words.ifUnknown}</span>
      <Segmented label={words.ifUnknown} value={current} options={policyChoices[kind]} onChange={next => draft.set(replaceAt(draft.get(), [...parent, policyKey], next))}/></div>
    <p className="w2-caption">{`Used while Home Assistant hasn't answered or ${name} is unavailable.`}</p></div>;
}

/**
 * The condition editor's body (spec "The condition editor"): Simple or Logic over one stored condition (D3), the result line, the policy
 * row where the place has one, and Try Values. Switching between Simple and Logic never rewrites the condition.
 */
export default function ConditionEditor({ draft, path, place, scope = 'document', policy, policyKey = 'whenUnknown', inlineDepth = 2, label }: {
  draft: Draft; path: EditorPath; place: Place; scope?: Scope; policy?: 'show' | 'enable'; policyKey?: string; inlineDepth?: number; label?: string;
}) {
  const { document, rule, write } = useRule(draft, path, policy ? policyKey : undefined);
  const ctx = useNameContext(document);
  const fit = fitsSimple(rule, ctx);
  const key = path.join('/'), saved = memory.get(draft)?.get(key);
  const [chosen, choose] = useState<Mode | undefined>(saved);
  const mode: Mode = chosen === 'logic' || !fit.fits ? 'logic' : chosen ?? (fit.fits ? 'simple' : 'logic');
  const setMode = (next: Mode) => { choose(next); memory.set(draft, (memory.get(draft) ?? new Map()).set(key, next)); };
  const reason = useId();
  const parentPolicy = policy ? ((valueAt(document, path.slice(0, -1)) as Record<string, unknown> | undefined)?.[policyKey] as WhenUnknown | undefined) : undefined;
  const canvas = useLogicFields();
  if (canvas) return <div className="w2-editor-section w2-expr-editor" data-testid="condition-editor">
    <LogicField draft={draft} path={path} kind="condition" label={label ?? (place === 'filter' ? 'Keep items when' : 'When')} showLabel={label === undefined}/>
    {policy && <details className="w2-data-fold"><summary>{words.ifUnknown}</summary><PolicyRow draft={draft} path={path} policyKey={policyKey} kind={policy} place={place}/></details>}
    <TryValues document={document} inputs={inputsOf(rule)}/>
  </div>;
  return <div className="w2-editor-section w2-expr-editor" data-testid="condition-editor">
    {rule && <SaveAsLogic draft={draft} path={path} kind="condition"/>}
    <Segmented label="Condition view" value={mode} options={[{ value: 'simple', label: words.simple, dimmed: !fit.fits }, { value: 'logic', label: words.logic }]} onChange={setMode} describedBy={reason}/>
    {!fit.fits && <p id={reason} className="w2-caption">{fit.reason}</p>}
    {mode === 'simple' ? <SimpleCondition draft={draft} rule={rule} ctx={ctx} write={write}/> : <LogicBuilder draft={draft} path={path} place={place} scope={scope} inlineDepth={inlineDepth} policyKey={policy ? policyKey : undefined}/>}
    <ConditionResult document={document} predicate={rule} place={place} policy={parentPolicy}/>
    {policy && <PolicyRow draft={draft} path={path} policyKey={policyKey} kind={policy} place={place}/>}
    <TryValues document={document} inputs={inputsOf(rule)}/>
  </div>;
}
