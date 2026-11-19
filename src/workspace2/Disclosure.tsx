import { useContext, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Rows } from './rowsContext';
import type { Library } from './useLibrary';

/** A library group, initially closed; revealing an item remembers its group as open. Search expansion is temporary. */
export function LibraryGroup({ id, title, names, library, reveal, searching, children, testId }: {
  id: string; title: string; names: readonly string[]; library: Library; reveal?: string; searching?: boolean; children: ReactNode; testId?: string;
}) {
  useEffect(() => { if (reveal) library.setGroup(id, true); }, [id, reveal]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = Boolean(searching && names.length) || library.groupOpen(id, false);
  const preview = names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : '');
  return <section className="w2-data-group" aria-label={title} data-testid={testId}>
    <h3 className="w2-group-title w2-tree-group"><button type="button" className="w2-tree-group-button" aria-expanded={open} aria-label={`${title}, ${names.length}`}
      onClick={() => library.setGroup(id, !open)}>
      <ChevronDown size={12} aria-hidden data-open={open || undefined}/><span>{title}</span>
      {!open && preview && <span className="w2-group-preview">· {preview}</span>}
      <span className="w2-tree-count">{names.length}</span>
    </button></h3>
    {open && children}
  </section>;
}

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
