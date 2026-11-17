import type { ReactNode } from 'react';
import type { Environment, Tri } from '../../shared/composition/evaluator';
import type { Predicate } from '../../shared/composition/expression';
import { Marker } from './ui';
import { conditionCount, entityOfSource, groupOf, inputsOf, markerOf, openLeaf, operandName, resultText, sentence, type Marker as MarkerKind, type NameContext } from './condition';
import { policyEffect, words, type Place } from './words';
import { useDataTag, useDraftEnvironment, useNameContext } from './useExpr';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { evaluatePredicate } from '../../preview2/evaluate';
import type { CompositionDocument } from '../../shared/composition/schema';

/**
 * The result line (D8): a marker, the result in weight 600, the reason in plain weight and a data tag, under every condition and value
 * editor. It is `role="status"` and polite; the words only change when the answer does, so it is not announced again for the same one.
 */
export function ResultLine({ marker, head, children, tag, testId = 'result-line' }: { marker: MarkerKind; head: string; children?: ReactNode; tag?: string; testId?: string }) {
  return <p className="w2-expr-result" role="status" aria-live="polite" data-testid={testId} data-marker={marker}>
    <Marker kind={marker} size={14}/><span className="w2-expr-result-text"><strong>{head}</strong>{children ? <> {children}</> : null}</span>
    {tag && <span className="w2-expr-datatag" data-tag={tag}>{tag}</span>}
  </p>;
}

/** How many of a condition's leaves are true now, and how many it has. */
function tally(predicate: Predicate, env: Environment): { yes: number; total: number } {
  const group = groupOf(predicate);
  if (group) return group.items.reduce((sum, item) => { const part = tally(item, env); return { yes: sum.yes + part.yes, total: sum.total + part.total }; }, { yes: 0, total: 0 });
  if (predicate.type === 'not') { const part = tally(predicate.of, env); return { yes: part.total - part.yes, total: part.total }; }
  return { yes: evaluatePredicate(predicate, env) === 'yes' ? 1 : 0, total: 1 };
}
/** The first input a condition reads that gives no answer, as "Garage Door is unavailable". */
function silentInput(predicate: Predicate, env: Environment, ctx: NameContext): string | undefined {
  for (const input of inputsOf(predicate)) {
    const found = env.read(input.sourceId, input.path);
    if (found.status === 'value') continue;
    const source = ctx.document.dataSources.find(item => item.id === input.sourceId);
    const name = entityOfSource(ctx, input.sourceId) ? operandName({ type: 'read', from: { type: 'source', sourceId: input.sourceId, path: input.path }, as: 'string', missing: 'unavailable' }, ctx) : source?.id ?? 'A value';
    return `${name} ${found.status === 'loading' ? "hasn't answered yet" : 'is unavailable'}`;
  }
  return undefined;
}

/** What the condition's result line says, in the spec's words (the table of "The result line and Try Values"). */
export function conditionResult(place: Place, predicate: Predicate | undefined, env: Environment | undefined, ctx: NameContext, policy: 'show' | 'hide' | 'keep' | undefined, connected: boolean): { marker: MarkerKind; head: string; reason: string; tri: Tri | undefined } {
  if (!predicate) return { marker: 'ring', head: words.always, reason: '', tri: undefined };
  if (!env) return { marker: 'unknown', head: 'Waiting for Home Assistant…', reason: '', tri: undefined };
  const tri = evaluatePredicate(predicate, env);
  const demo = connected ? '' : ` ${'Not connected. Showing demo values.'}`;
  if (tri === 'unknown') {
    const silent = silentInput(predicate, env, ctx);
    const effect = policyEffect[place][policy ?? 'show'];
    return { marker: 'unknown', head: `${resultText(place, tri)}.`, reason: `${silent ? `${silent}, so it's ${effect}.` : `It's ${effect}.`}${demo}`, tri };
  }
  const { yes, total } = tally(predicate, env);
  const leaf = total === 1 && !groupOf(predicate) ? predicate : undefined;
  const reason = total > 1 ? `${yes} of ${total} are true.` : leaf ? (tri === 'yes' ? `${sentence(leaf.type === 'not' && !openLeaf(leaf) ? leaf : leaf, ctx)}.` : `${sentence(leaf, ctx)} isn't true.`) : `${conditionCount(predicate)} condition.`;
  return { marker: markerOf(tri), head: `${resultText(place, tri)}.`, reason: `${reason}${demo}`, tri };
}

/** The result line of a condition editor: reads the draft, the house, the overlay and Try Values. */
export function ConditionResult({ document, predicate, place, policy }: { document: CompositionDocument; predicate: Predicate | undefined; place: Place; policy?: 'show' | 'hide' | 'keep' }) {
  const env = useDraftEnvironment(document), ctx = useNameContext(document), tag = useDataTag(), { connected } = useWorkspaceData();
  if (!predicate) return null;
  const result = conditionResult(place, predicate, env, ctx, policy, connected);
  return <ResultLine marker={result.marker} head={result.head} tag={env ? tag : undefined}>{result.reason}</ResultLine>;
}
