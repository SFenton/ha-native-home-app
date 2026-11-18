import { useContext, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Rows } from './rowsContext';

/** A row that opens into a form: label and summary leading, a chevron trailing. */
export function Disclosure({ label, summary, children, defaultOpen = false, path, lead }: { label: string; summary?: string; children: ReactNode; defaultOpen?: boolean; path?: string; /** A mark before the label on the row (an ink swatch). */ lead?: ReactNode }) {
  const openAll = useContext(Rows)?.openAll;
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || openAll;
  return <div className="w2-disclosure" data-open={shown || undefined} data-disclosure={path}>
    <button type="button" className="w2-disclosure-head" aria-expanded={Boolean(shown)} onClick={() => setOpen(!open)}>
      <span className="w2-row-label">{lead}{label}</span><span className="w2-summary">{summary}</span>{shown ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {shown && <div className="w2-disclosure-body">{children}</div>}
  </div>;
}
