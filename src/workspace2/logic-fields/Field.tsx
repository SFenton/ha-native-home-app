import { useMemo, useState, type ReactNode } from 'react';
import { valueAt, replaceAt, type EditorPath } from '../../composition-editor';
import type { Predicate } from '../../shared/composition/expression';
import { lower } from '../../shared/composition/graph';
import { resolveLogicUseBindings } from '../../shared/composition/studio-logic/bindings';
import { useDraftDocument, type Draft } from '../editors/draft';
import SimpleCondition from '../expr/SimpleCondition';
import { fitsSimple, markerOf, openSimple } from '../expr/condition';
import { useDraftEnvironment, useNameContext } from '../expr/useExpr';
import { ResultLine } from '../expr/ResultLine';
import { stateLabel } from '../expr/ComparisonControls';
import { writeRule } from '../expr/useRule';
import LogicUseSettings from '../data/logic/LogicUse';
import { isUse } from '../data/logic/logicModel';
import { evaluateOperand, evaluatePredicate } from '../data/logic/logicEval';
import SaveAsLogic from '../data/logic/SaveLogicDialog';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { fieldUsage } from '../canvas/LimitsMeter';
import { useLogicFields } from './LogicFields';
import { fieldAdapters, liftField, type LogicFieldKind } from './registry';
import { TemplatePicker } from './TemplatePicker';
import { editBoundField, unlinkTemplate } from './templates';
import { operandSlot } from '../expr/tokens';
import type { Operand } from '../../shared/composition/expression';
import { describeLogic, graphSentence, sourceLabel } from './presentation';
import { MiniMap } from './MiniMap';
import { hasMultipleChecks, inlineCheck } from './checks';
import { LeafEditor, ViewerEditor } from '../expr/ConditionRow';
import { ValuePickerRow } from '../expr/ValuePicker';
import { defaultFor } from '../expr/LogicBuilder';

function InlineResult({ draft, predicate }: { draft: Draft; predicate: Predicate | undefined }) {
  const document = useDraftDocument(draft), env = useDraftEnvironment(document), ctx = useNameContext(document);
  const { connected, tried } = useWorkspaceData();
  if (!predicate) return null;
  const tri = env ? evaluatePredicate(predicate, env) : 'unknown';
  const leaf = openSimple(inlineCheck(predicate));
  const answer = env && leaf ? evaluateOperand(leaf.left, env) : undefined;
  const reason = answer?.status === 'value' && leaf
    ? `${describeLogic(leaf.left, ctx)} is ${typeof answer.value === 'string' ? stateLabel(answer.value) : describeLogic(answer.value, ctx)} right now`
    : undefined;
  return <ResultLine marker={markerOf(tri)} head={tri === 'unknown' ? 'Waiting for Home Assistant' : `${tri === 'yes' ? 'Yes' : 'No'}${reason ? ' ·' : ''}`} tag={tried.count ? 'Test' : connected ? 'Live' : undefined}>
    {reason}
  </ResultLine>;
}

export function LogicField({ draft, path, kind, label, inline, children, showLabel = true }: {
  draft: Draft; path: EditorPath; kind: LogicFieldKind; label: string; inline?: ReactNode; children?: ReactNode; showLabel?: boolean;
}) {
  const api = useLogicFields(), document = useDraftDocument(draft), ctx = useNameContext(document);
  const [error, setError] = useState(''), [settings, setSettings] = useState(false);
  const value = valueAt(document, path), adapter = fieldAdapters[kind];
  const predicate = kind === 'condition' ? value as Predicate | undefined : undefined;
  const check = predicate ? inlineCheck(predicate) : undefined;
  const compound = kind === 'condition' && hasMultipleChecks(value);
  const simple = kind === 'condition' && !compound;
  const leaf = check ? openSimple(check) : undefined;
  const readLeaf = (current: typeof document) => {
    const predicate = valueAt(current, path) as Predicate | undefined;
    return predicate ? openSimple(inlineCheck(predicate)) : undefined;
  };
  const slot = kind === 'slot' ? value as { type?: string; value?: unknown } | undefined : undefined;
  const textSlot = slot && ['literal', 'read', 'expr'].includes(String(slot.type));
  const use = isUse(value) ? value : slot?.type === 'expr' && isUse(slot.value) ? slot.value : undefined;
  const usePath = use === value ? path : [...path, 'value'];
  const entry = use ? document.logicLibrary?.find(entry => entry.id === use.logicId) : undefined;
  const resolved = use ? valueAt(resolveLogicUseBindings(document).document, usePath) : undefined;
  const effectiveUse = isUse(resolved) ? resolved : use;
  const summary = useMemo(() => {
    if (!compound || value === undefined) return undefined;
    try {
      const graph = liftField(document, path, kind).graph, compiled = lower(graph, { accounting: true });
      const meter = compiled.budgets[0] ? fieldUsage(compiled.budgets[0]).base : undefined;
      return { graph, description: graphSentence(graph, ctx), meter };
    } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [document, path.join('/'), kind, compound, ctx, value]);
  const open = (combine?: 'all' | 'any') => api?.open({ draft, path, kind, label, combine });
  const run = (change: () => void) => { try { change(); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  return <section className="w2-logic-field" data-testid="logic-field" data-field-kind={kind} data-field-path={path.join('/')}>
    {showLabel && <span className="w2-row-label">{label}</span>}
    {simple ? <>
      {inline ?? (fitsSimple(check, ctx).fits
        ? <SimpleCondition compact draft={draft} rule={check} ctx={ctx} readLeaf={readLeaf} write={(next, base, typing) => draft.set(writeRule(base ?? draft.get(), path, next), typing)}/>
        : leaf ? <LeafEditor compact draft={draft} leaf={leaf} ctx={ctx} readLeaf={readLeaf} write={(next, base, typing) => draft.set(writeRule(base ?? draft.get(), path, next), typing)}/>
          : check?.type === 'viewer' || check?.type === 'viewer-person' ? <ViewerEditor predicate={check} write={next => draft.set(writeRule(draft.get(), path, next))}/>
            : !use ? predicate ? <p className="w2-caption">{describeLogic(predicate, ctx)}</p>
              : <ValuePickerRow draft={draft} title="Value" primary="Choose a value" conditions onPick={picked => draft.set(writeRule(picked.document, path, defaultFor(picked)))}/> : null)}
      <InlineResult draft={draft} predicate={predicate}/>
    </> : summary?.graph ? <>
      <figure className="w2-logic-summary" aria-label={`${label} summary`} data-testid="logic-field-summary">
        <MiniMap graph={summary.graph} ctx={ctx} description={summary.description}/>
        <figcaption>{summary.description}</figcaption>
      </figure>
      {summary.meter && <div className="w2-logic-status" aria-label="Logic status">
        Uses {summary.meter.used} block{summary.meter.used === 1 ? '' : 's'}
      </div>}
    </> : summary?.error ? <p role="alert" className="w2-error-text">{summary.error}</p> : null}
    {use && <div className="w2-logic-template" data-testid={settings ? undefined : 'logic-use'}>
      <p>From the template: <strong>{entry?.name ?? 'Missing template'}</strong></p>
      {entry && <p className="w2-caption">{entry.params.map(param => `${param.label ?? param.name}: ${param.kind === 'source-id' ? sourceLabel(effectiveUse?.args[param.name], ctx) : describeLogic(effectiveUse?.args[param.name], ctx)}`).join(' · ')}</p>}
      {settings && <LogicUseSettings draft={draft} path={usePath} use={use} kind={kind === 'condition' ? 'condition' : 'value'} removeLabel="Remove use"
        onChange={(next, base) => draft.set(editBoundField(base ?? draft.get(), [...usePath, 'args'], document => replaceAt(document, usePath, next)))}
        onUnlink={() => run(() => draft.set(unlinkTemplate(draft.get(), usePath)))}
        onRemove={kind === 'condition' ? () => run(() => draft.set(writeRule(draft.get(), path, undefined)))
          : textSlot ? () => run(() => draft.set(editBoundField(draft.get(), path, document => replaceAt(document, path, { type: 'literal', value: '' })))) : undefined}/>}
    </div>}
    <div className="w2-logic-commands">
      {simple && predicate && <><button type="button" onClick={() => open('all')}>+ And…</button><button type="button" onClick={() => open('any')}>+ Or…</button></>}
      {use && <button type="button" onClick={() => run(() => draft.set(unlinkTemplate(draft.get(), usePath)))}>Unlink</button>}
      {(compound || use) && value !== undefined && <button type="button" aria-expanded={use ? settings : undefined} onClick={() => use ? setSettings(!settings) : open()}>Change Settings</button>}
      {value !== undefined && <button type="button" className={simple ? undefined : 'w2-logic-primary'} onClick={() => open()} disabled={!api}>Edit in Canvas</button>}
    </div>
    {(kind === 'condition' || kind === 'operand' || textSlot) && <div className="w2-logic-commands w2-logic-secondary">
      <TemplatePicker document={document} kind={kind === 'condition' ? 'condition' : 'operand'} onUse={use => draft.set(editBoundField(draft.get(), path, document => replaceAt(document, path, textSlot ? operandSlot(use as unknown as Operand, slot) : use)))}/>
      {value !== undefined && <SaveAsLogic draft={draft} path={path} kind={kind === 'slot' ? 'value' : kind === 'condition' ? 'condition' : 'operand'}/>}
    </div>}
    {adapter.output === 'yes/no' && !predicate && <p className="w2-caption">One check edits here. Add And or Or to build a flow.</p>}
    {children}
    {error && <p role="alert" className="w2-error-text">{error}</p>}
  </section>;
}
