import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

/** A row for one layer of a look. An overridden layer has a dot before its label and a Reset button after its field. */
export function LayerRow({ label, field, edited, onReset, resetLabel = `Reset ${label} to the style`, note, children }: {
  label: string; field: string; edited: boolean; onReset: () => void; resetLabel?: string; note?: ReactNode; children: ReactNode;
}) {
  return <div className="w2-row w2-layer-row" data-field-path={field} data-edited={edited || undefined}>
    <div className="field"><span>{edited && <i className="w2-edited-dot" aria-hidden/>}{label}</span>
      <div className="w2-layer-control">{children}{edited && <button type="button" className="w2-reset" aria-label={resetLabel} onClick={onReset}><RotateCcw size={14} aria-hidden/></button>}</div></div>
    {note && <p className="w2-caption">{note}</p>}
  </div>;
}
