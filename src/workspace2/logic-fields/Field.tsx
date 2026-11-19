import { useMemo, useState, type ReactNode } from 'react';
import { valueAt, replaceAt, type EditorPath } from '../../composition-editor';
import type { Operand, Predicate } from '../../shared/composition/expression';
import { useDraftDocument, type Draft } from '../editors/draft';
import SimpleCondition from '../expr/SimpleCondition';
import { fitsSimple, operandName, sentence } from '../expr/condition';
import { useNameContext } from '../expr/useExpr';
import { ConditionResult } from '../expr/ResultLine';
import { writeRule } from '../expr/useRule';
import LogicUseSettings from '../data/logic/LogicUse';
import { isUse } from '../data/logic/logicModel';
import SaveAsLogic from '../data/logic/SaveLogicDialog';
import { useLogicFields } from './LogicFields';
import { fieldAdapters, liftField, type LogicFieldKind } from './registry';
import { TemplatePicker } from './TemplatePicker';
import { unlinkTemplate } from './templates';
import type { Json } from '../../shared/types';
import { operandSlot } from '../expr/tokens';
import { blockName } from '../canvas/blocks';

function MiniMap({ draft, path, kind, description }: { draft: Draft; path: EditorPath; kind: LogicFieldKind; description: string }) {
  const document = useDraftDocument(draft);
  const result = useMemo(() => {
    try { return { graph: liftField(document, path, kind).graph }; }
    catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [document, path.join('/'), kind]);
  if (!result.graph) return <p role="alert" className="w2-error-text">{result.error}</p>;
  const graph = result.graph;
  const width = Math.max(100, ...graph.nodes.map(node => (node.position?.x ?? 0) + 60));
  const height = Math.max(60, ...graph.nodes.map(node => (node.position?.y ?? 0) + 30));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  return <svg viewBox={`-8 -8 ${width + 16} ${height + 16}`} role="img" aria-label={`Logic mini-map: ${description}`}>
    {graph.edges.map(edge => {
      const from = nodes.get(edge.from.nodeId)?.position, to = nodes.get(edge.to.nodeId)?.position;
      return from && to ? <path key={edge.id} d={`M${from.x + 60},${from.y + 15} L${to.x},${to.y + 15}`} fill="none" stroke="currentColor" strokeWidth="4"/> : null;
    })}
    {graph.nodes.map(node => <rect key={node.id} x={node.position?.x ?? 0} y={node.position?.y ?? 0} width="60" height="30" rx="6" fill="currentColor"/>)}
  </svg>;
}

export function LogicField({ draft, path, kind, label, inline, children }: {
  draft: Draft; path: EditorPath; kind: LogicFieldKind; label: string; inline?: ReactNode; children?: ReactNode;
}) {
  const api = useLogicFields(), document = useDraftDocument(draft), ctx = useNameContext(document);
  const [error, setError] = useState('');
  const value = valueAt(document, path);
  const adapter = fieldAdapters[kind];
  const predicate = kind === 'condition' ? value as Predicate | undefined : undefined;
  const simple = kind === 'condition' && (inline !== undefined || fitsSimple(predicate, ctx).fits);
  const slot = kind === 'slot' ? value as { type?: string; value?: unknown } | undefined : undefined;
  const textSlot = slot && ['literal', 'read', 'expr'].includes(String(slot.type));
  const use = isUse(value) ? value : slot?.type === 'expr' && isUse(slot.value) ? slot.value : undefined;
  const usePath = use === value ? path : [...path, 'value'];
  const operand = kind === 'operand' ? value as Operand | undefined : undefined;
  const description = kind === 'condition' ? predicate ? sentence(predicate, ctx) : 'No check'
    : kind === 'operand' ? operand?.type === 'math' ? blockName(`operand.math.${operand.op}`) : operand ? operandName(operand, ctx) : 'No value'
      : kind === 'flow' ? 'Request, steps and typed output' : 'A value built from logic';
  const open = (combine?: 'all' | 'any') => api?.open({ draft, path, kind, label, combine });
  const run = (change: () => void) => { try { change(); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  return <section className="w2-logic-field" data-testid="logic-field" data-field-kind={kind} data-field-path={path.join('/')}>
    <span className="w2-row-label">{label}</span>
    {use ? <LogicUseSettings draft={draft} path={usePath} use={use} kind={kind === 'condition' ? 'condition' : 'value'} removeLabel="Remove use"
      onChange={(next, base) => draft.set(replaceAt(base ?? draft.get(), usePath, next))}
      onUnlink={() => run(() => draft.set(unlinkTemplate(draft.get(), usePath)))}
      onRemove={kind === 'condition' ? () => run(() => draft.set(writeRule(draft.get(), path, undefined)))
        : textSlot ? () => run(() => draft.set(replaceAt(draft.get(), path, { type: 'literal', value: '' }))) : undefined}/>
      : simple ? inline ?? <SimpleCondition draft={draft} rule={predicate} ctx={ctx} write={(next, base, typing) => draft.set(writeRule(base ?? draft.get(), path, next), typing)}/>
        : <figure className="w2-logic-summary" aria-label={`${label} summary`} data-testid="logic-field-summary">
          <figcaption>{description}</figcaption>
          {value !== undefined && <MiniMap draft={draft} path={path} kind={kind} description={description}/>}
        </figure>}
    <div className="w2-logic-commands">
      {simple && predicate && <><button type="button" onClick={() => open('all')}>+ And</button><button type="button" onClick={() => open('any')}>+ Or</button></>}
      {value !== undefined && <button type="button" onClick={() => open()} disabled={!api}>Edit in Canvas</button>}
      {(kind === 'condition' || kind === 'operand' || textSlot) && <TemplatePicker document={document} kind={kind === 'condition' ? 'condition' : 'operand'} onUse={use => draft.set(replaceAt(draft.get(), path, textSlot ? operandSlot(use as unknown as Operand, slot) : use))}/>}
      {(kind === 'condition' || kind === 'operand' || textSlot) && value !== undefined && <SaveAsLogic draft={draft} path={path} kind={kind === 'slot' ? 'value' : kind === 'condition' ? 'condition' : 'operand'}/>}
    </div>
    {kind === 'condition' && <ConditionResult document={document} predicate={predicate} place="rule"/>}
    {adapter.output === 'yes/no' && !predicate && <p className="w2-caption">One check edits here. Add And or Or to build a flow.</p>}
    {children}
    {error && <p role="alert" className="w2-error-text">{error}</p>}
  </section>;
}
