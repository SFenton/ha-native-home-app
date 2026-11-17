import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNarrow } from './kit';
import IdRow from './IdRow';

/** Whether the fold is open, remembered per node type for the session, so stepping through tiles of one type keeps it open. */
const openByType = new Map<string, boolean>();
/** Forgets what was remembered (a test starts clean). */
export const resetAdvancedFold = () => openByType.clear();

/**
 * The Advanced fold (pick 7A): a 44 px header at the foot of the properties body that opens in place. Open, it shows the ID with
 * Copy, the node's advanced fields (`children`), then one line naming what the app fixes. Closed by default; on a phone, opening
 * scrolls the header to the top of the sheet's visible part.
 */
export default function AdvancedFold({ type, id, idPath, fixed, children }: { type: string; id?: string; idPath?: string; fixed?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(() => openByType.get(type) ?? false);
  const narrow = useNarrow();
  const body = useId();
  const head = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => { if (opened.current && open && narrow) head.current?.scrollIntoView?.({ block: 'start' }); opened.current = false; }, [open, narrow]);
  const toggle = () => { const next = !open; openByType.set(type, next); opened.current = next; setOpen(next); };
  return <section className="w2-group w2-advanced" data-open={open || undefined}>
    <button type="button" ref={head} className="w2-disclosure-head w2-advanced-row" aria-expanded={open} aria-controls={body} onClick={toggle}>
      <span className="w2-row-label">Advanced</span><span className="w2-summary"/>{open ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {open && <div id={body} className="w2-advanced-body">
      {id !== undefined && idPath !== undefined && <IdRow id={id} path={idPath}/>}
      {children}
      {fixed && <p className="w2-caption w2-fixed-line" data-testid="fixed-line">{fixed}</p>}
    </div>}
  </section>;
}
