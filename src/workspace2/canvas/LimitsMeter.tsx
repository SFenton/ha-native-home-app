import { Check } from 'lucide-react';
import type { BudgetMeter, GraphBudget } from '../../shared/composition/graph';

function worst(meters: readonly BudgetMeter[]): BudgetMeter | undefined {
  return meters.reduce<BudgetMeter | undefined>((held, meter) => meter.limit === null || held && (held.ratio ?? 0) >= (meter.ratio ?? 0) ? held : meter, undefined);
}
export function fieldUsage(budget: GraphBudget) {
  const limiting = worst(budget.meters);
  const base = limiting?.kind.endsWith(' depth') ? budget.meters.find(meter => meter.pointer === limiting.pointer && meter.kind === limiting.kind.replace(' depth', ' nodes')) : limiting;
  const depth = base?.kind.endsWith(' nodes') ? budget.meters.find(meter => meter.pointer === base.pointer && meter.kind === base.kind.replace(' nodes', ' depth')) : undefined;
  return { base, depth, limiting, visible: Boolean(limiting?.visible) };
}
function fieldName(budget: GraphBudget): string {
  const part = budget.anchor.field.split('/').filter(Boolean).at(-1);
  return !part || part === 'body' ? 'Result' : part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, text => text.toUpperCase());
}
export default function LimitsMeter({ budgets, outputNames = [], onLocate }: {
  budgets: readonly GraphBudget[]; outputNames?: readonly string[]; onLocate?: (pointer: string) => void;
}) {
  const outputs = [...new Map(budgets.map(budget => [`${budget.anchor.kind}:${budget.anchor.id}:${budget.anchor.field}`, budget])).values()];
  const shown = outputs.filter(budget => fieldUsage(budget).visible);
  return <section className="w2-canvas-limits" aria-label="Fits in the phone app">
    <h3>Fits in the phone app</h3>
    {!!shown.length && <div aria-label="Limits above 75 percent">{shown.map(budget => {
      const { base, depth, limiting } = fieldUsage(budget), name = outputNames[outputs.indexOf(budget)] ?? fieldName(budget);
      return <div key={`${budget.anchor.id}:${budget.anchor.field}`} className="w2-canvas-field-fit" data-exceeded={limiting?.exceeded || undefined}>
        <div><span>{name}</span><span>{base?.used} of {base?.limit} {base?.kind === 'Rule cases' ? 'choices' : 'steps'}{depth?.limit !== null && depth && ` · ${depth.used} of ${depth.limit} deep`}</span></div>
        <meter aria-label={`${name} fit`} min={0} max={1} value={Math.min(limiting?.ratio ?? 0, 1)}/>
      </div>;
    })}<p className="w2-canvas-caption">The app limits each field separately, including shared blocks; only fields above 75% are shown.</p></div>}
    {!shown.length && outputs.length > 0 && outputs.every(budget => budget.accounting !== 'unavailable' && budget.accepted) && <p className="w2-canvas-fit-quiet"><Check size={12} aria-hidden/> Fits</p>}
    <details>
      <summary>Details</summary>
      <p>These are compiler entry attempts and depth, including the first refused entry. Unvisited descendants are not estimated. Each counter keeps its own scope and limit.</p>
      {!outputs.length && <p>Accounting unavailable until the required connections can be compiled.</p>}
      {outputs.map((budget, index) => <section key={`${budget.anchor.id}:${budget.anchor.field}`} aria-label={`Limits for ${outputNames[index] ?? fieldName(budget)}`}>
        <h4>{outputNames[index] ?? fieldName(budget)}</h4><code>{budget.anchor.id}{budget.anchor.field}</code>
        <p>{budget.accepted ? 'Compiler accepted this output.' : 'Compiler refused this output.'}</p>
        {budget.accounting === 'unavailable' && <p>Accounting unavailable pending observer integration. No usage is estimated.</p>}
        <p>{budget.accountingUnavailableReason}</p>
        <ul className="w2-canvas-accounting-scopes">{budget.scopes.map(scope => <li key={scope.id}>
          <strong>{scope.kind === 'predicate' ? 'Check' : 'Value'}</strong> <code>{scope.pointer || 'Output'}</code>
          <span>{scope.nodes ?? 'Unavailable'}{scope.nodeLimit === null ? ' steps (uncapped)' : ` of ${scope.nodeLimit} steps`} · {scope.depth ?? 'Unavailable'}{scope.depthLimit === null ? ' deep (uncapped)' : ` of ${scope.depthLimit} deep`}</span>
        </li>)}</ul>
        {budget.meters.filter(meter => meter.kind === 'Flow steps' || meter.kind === 'Rule cases').map(meter => <p key={`${meter.kind}:${meter.pointer}`}>{meter.used} of {meter.limit} {meter.kind === 'Flow steps' ? 'flow steps' : 'choices'} <code>{meter.pointer}</code></p>)}
        {budget.compilerIssues.map((issue, i) => <p key={i} className="w2-canvas-error">{issue.code}: <button type="button" onClick={() => onLocate?.(issue.pointer)}>{issue.pointer || 'Output'}</button></p>)}
        {!!budget.counterResets?.length && <><h4>Checker counter resets</h4><ul>{budget.counterResets.map((reset, i) => <li key={i}>{reset.kind}: <code>{reset.pointer || 'Output'}</code></li>)}</ul></>}
        <p>Runtime budget: {budget.runtimeLimit.toLocaleString('en-US')}, separate from field steps.</p>
        <p>Capabilities: {budget.capabilities.join(', ') || 'None'}</p>
        {budget.duplicatedUseCost === null && <p>Per-use duplication cost: unavailable.</p>}
      </section>)}
    </details>
  </section>;
}
