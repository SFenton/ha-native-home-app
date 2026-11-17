import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNarrow } from './kit';
import { usesText } from './linked';

/** Whether each template's fold is open, remembered per template for the session, so stepping between its places keeps it open. */
const openByTemplate = new Map<string, boolean>();
/** Forgets what was remembered (a test starts clean). */
export const resetTemplateFold = () => openByTemplate.clear();

/**
 * The template row of a placed template's inspector (templates spec 3a-B), on {@link AdvancedFold}'s pattern: a 56 px header with the template's name
 * over "Template · Used in 12 places", closed by default, that opens in place to the template's own fields. A template with no settings opens it,
 * since there is nothing else to show. Its accessible name is "Light Button, template, used in 12 places".
 */
export default function TemplateFold({ id, name, places, hasSettings, children }: { id: string; name: string; places: number; /** Whether the place has settings above; without them the fold starts open. */ hasSettings: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => openByTemplate.get(id) ?? !hasSettings);
  const narrow = useNarrow();
  const body = useId();
  const head = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => { if (opened.current && open && narrow) head.current?.scrollIntoView?.({ block: 'start' }); opened.current = false; }, [open, narrow]);
  const toggle = () => { const next = !open; openByTemplate.set(id, next); opened.current = next; setOpen(next); };
  return <section className="w2-group w2-template-fold" data-open={open || undefined} data-testid="template-fold">
    <button type="button" ref={head} className="w2-disclosure-head w2-advanced-row w2-template-row" aria-expanded={open} aria-controls={body}
      aria-label={`${name}, template, ${usesText(places).toLowerCase()}`} onClick={toggle}>
      <span className="w2-template-text"><span className="w2-template-name">{name}</span><span className="w2-template-sub">{`Template · ${usesText(places)}`}</span></span>
      {open ? <ChevronDown size={16} aria-hidden/> : <ChevronRight size={16} aria-hidden/>}
    </button>
    {open && <div id={body} className="w2-advanced-body w2-template-body">{children}</div>}
  </section>;
}
