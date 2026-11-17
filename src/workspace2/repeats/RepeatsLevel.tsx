import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Search, X } from 'lucide-react';
import type { Workspace2 } from '../useWorkspace2';
import RepeatsList, { WORKING_TEXT } from './RepeatsList';
import { summaryText } from './repeatWords';
import './repeats.css';

/**
 * The Repeated Pieces level of the library (templates spec 5, option B): Back, the title with "49 found in 218 places", a search field, and the
 * rows. A row marks the first place on the canvas and opens the proposal in the inspector. The 56 px header is the same height as the library's other
 * levels, so the list never jumps. It opens from the Find Repeated Pieces row of the Templates group; Back returns focus to that row.
 */
export default function RepeatsLevel({ ws, onBack, onClose }: { ws: Workspace2; onBack: () => void; onClose?: () => void }) {
  const repeats = ws.repeats;
  const [query, setQuery] = useState('');
  const head = useRef<HTMLHeadingElement>(null);
  // The level takes focus when it opens, on its title, so a keyboard person lands in it and not on the row that opened it.
  useEffect(() => { head.current?.focus(); }, []);
  const summary = repeats.result ? summaryText(repeats.result) : WORKING_TEXT;
  return <section className="w2-repeats-level" aria-label="Repeated Pieces" data-testid="repeats-level">
    <header className="w2-lib-head w2-lib-level-head">
      <button type="button" className="w2-icon-button w2-lib-back" aria-label="Back to Components" onClick={onBack}><ChevronLeft size={20} aria-hidden/></button>
      <div className="w2-lib-titles">
        <h2 className="w2-lib-title" ref={head} tabIndex={-1}>Repeated Pieces</h2>
        <p className="w2-lib-sub" data-testid="repeats-summary">{summary}</p>
      </div>
      {onClose && <button type="button" className="w2-icon-button" aria-label="Close" onClick={onClose}><X size={18} aria-hidden/></button>}
    </header>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find in repeated pieces" aria-label="Find in repeated pieces" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {repeats.note && <p className="w2-repeats-note" role="status" data-testid="repeats-note">{repeats.note}</p>}
    <div className="w2-lib-scroll">
      <RepeatsList ws={ws} query={query} onPick={cls => repeats.pick(cls.id, 'inspector')}/>
    </div>
  </section>;
}
