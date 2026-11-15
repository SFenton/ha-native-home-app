import { AlertTriangle, CheckCircle2, Lightbulb } from 'lucide-react';
import type { Checks, CheckRow } from './checks';

/** The Checks overlay's content (spec 5.8): "Problems" block publishing, "Suggestions" are lints. A failed save leads. */
export default function ChecksPanel({ checks, saveFailure, onRetry, onPick }: { checks: Checks; saveFailure?: string; onRetry: () => void; onPick: (row: CheckRow) => void }) {
  const row = (item: CheckRow, icon: React.ReactNode) => <li key={item.id}>
    <button type="button" className="w2-check-row" onClick={() => onPick(item)}>{icon}<span className="w2-check-text">{item.sentence}</span></button>
  </li>;
  const nothing = !checks.problems.length && !checks.suggestions.length && !saveFailure;
  return <div className="w2-checks">
    {saveFailure && <section aria-label="Not saved" role="alert" className="w2-save-failure">
      <p><AlertTriangle size={16} aria-hidden/> The draft was not saved. {saveFailure}</p>
      <button type="button" onClick={onRetry}>Try Again</button>
    </section>}
    {nothing && <p className="w2-empty"><CheckCircle2 size={16} aria-hidden/> No Problems</p>}
    {checks.problems.length > 0 && <section aria-label="Problems"><h3 className="w2-group-title">Problems</h3>
      <ul>{checks.problems.map(item => row(item, <AlertTriangle size={16} className="w2-tone-error" aria-hidden/>))}</ul></section>}
    {checks.suggestions.length > 0 && <section aria-label="Suggestions"><h3 className="w2-group-title">Suggestions</h3>
      <ul>{checks.suggestions.map(item => row(item, <Lightbulb size={16} className="w2-tone-warning" aria-hidden/>))}</ul></section>}
  </div>;
}
