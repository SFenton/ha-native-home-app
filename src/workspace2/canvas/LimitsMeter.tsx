import { AlertTriangle, Gauge } from 'lucide-react';
import type { BudgetMeter, GraphBudget } from '../../shared/composition/graph';

function Meter({ meter }: { meter: BudgetMeter }) {
  return <div className="w2-canvas-meter" data-exceeded={meter.exceeded || undefined}>
    <div><span>{meter.kind}</span><strong>{meter.used}{meter.limit === null ? ' (uncapped)' : ` / ${meter.limit}`}</strong></div>
    {meter.limit !== null && <meter aria-label={`${meter.kind}, ${meter.pointer || 'output'}`} min={0} max={meter.limit} value={Math.min(meter.used, meter.limit)}/>}
    <code>{meter.pointer || 'Output'}</code>
  </div>;
}
export default function LimitsMeter({ budgets, onLocate }: { budgets: readonly GraphBudget[]; onLocate?: (pointer: string) => void }) {
  const compact = budgets.flatMap((budget, output) => budget.meters.filter(meter => meter.visible).map((meter, index) => ({ meter, key: `${output}:${index}` })));
  const worst = compact.reduce<BudgetMeter | undefined>((held, entry) => !held || (entry.meter.ratio ?? 0) > (held.ratio ?? 0) ? entry.meter : held, undefined);
  return <section className="w2-canvas-limits" aria-label="Compiler limits">
    {worst && <div className="w2-canvas-compact" aria-label="Limits above 75 percent"><Gauge size={16} aria-hidden/><strong>{worst.kind}: {worst.used} / {worst.limit}</strong>
      <span>Worst output</span></div>}
    <details>
      <summary>Limits</summary>
      <p className="w2-canvas-caption">Compiler entry attempts and depth, including the first refused entry. Unvisited descendants are not estimated. Each counter keeps its own scope and limit.</p>
      <p>Compiler accounting only. The compact meter appears strictly above 75% of an applicable limit. Apply is not Publish.</p>
      {!budgets.length && <p>Accounting unavailable until the required connections can be compiled.</p>}
      {budgets.map((budget, index) => <section key={index} aria-label={`Limits for ${budget.anchor.id} ${budget.anchor.field}`}>
        <h3>{budget.anchor.id} <small>{budget.anchor.field || 'Output'}</small></h3>
        <p>{budget.accepted ? 'Compiler accepted this output.' : 'Compiler refused this output.'}</p>
        {budget.accounting === 'unavailable' && <p>Accounting unavailable pending observer integration. No usage is estimated.</p>}
        <p>{budget.accountingUnavailableReason}</p>
        {budget.meters.map((meter, i) => <Meter key={`${meter.kind}:${meter.pointer}:${i}`} meter={meter}/>)}
        {budget.compilerIssues.map((issue, i) => <p key={i} className="w2-canvas-error"><AlertTriangle size={14} aria-hidden/> {issue.code}: <button type="button" onClick={() => onLocate?.(issue.pointer)}>{issue.pointer || 'Output'}</button></p>)}
        {!!budget.counterResets?.length && <details><summary>Checker counter resets</summary><ul>{budget.counterResets.map((reset, i) => <li key={i}>{reset.kind}: <code>{reset.pointer || 'Output'}</code></li>)}</ul></details>}
        <p>Runtime budget: {budget.runtimeLimit.toLocaleString('en-US')}, separate from expression nodes and flow steps.</p>
        <p>Capabilities: {budget.capabilities.join(', ') || 'None'}</p>
        {budget.duplicatedUseCost === null && <p>Per-use duplication cost: unavailable.</p>}
      </section>)}
    </details>
  </section>;
}
