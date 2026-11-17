import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { Drawer } from '@base-ui/react/drawer';
import { Search } from 'lucide-react';
import { PushStack, usePush } from '../kit';
import type { Workspace2 } from '../useWorkspace2';
import RepeatProposal from './RepeatProposal';
import RepeatsList, { WORKING_TEXT } from './RepeatsList';
import { pieceText, summaryText } from './repeatWords';
import './repeats.css';

/** The sheet's two heights, as `LevelSheet`'s: half the screen on open, the whole of it on drag. */
const HALF = 0.5, FULL = 1;
const snapPoints = [HALF, FULL];
const covered = (snap: number) => window.innerHeight * snap;

/** The workspace, for the pages this sheet pushes: a pushed page is kept as an element, so it reads the live workspace from here and not from props. */
const Live = createContext<Workspace2 | undefined>(undefined);

/** The page a row pushes: the proposal for the open piece. It goes back by itself when the piece is gone (saved, or edited away). */
function Pushed({ onError }: { onError: (message: string) => void }) {
  const ws = useContext(Live)!;
  const push = usePush();
  const gone = !ws.repeats.selected;
  useEffect(() => { if (gone) push?.pop(); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps
  return <RepeatProposal ws={ws} onError={onError} onSaved={() => push?.pop()}/>;
}

/** The sheet's first page: the title with its summary, Done, the search and the rows. A row opens the piece and pushes its proposal. */
function Root({ ws, onError }: { ws: Workspace2; onError: (message: string) => void }) {
  const repeats = ws.repeats, push = usePush();
  const [query, setQuery] = useState('');
  return <>
    <header className="w2-level-head">
      <div className="w2-level-lead"/>
      <div className="w2-level-titles"><h2 className="w2-level-title-text">Repeated Pieces</h2><p className="w2-lib-sub" data-testid="repeats-summary">{repeats.result ? summaryText(repeats.result) : WORKING_TEXT}</p></div>
      <div className="w2-level-trail"><button type="button" className="w2-level-done" onClick={() => repeats.setOpen(false)}>Done</button></div>
    </header>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find in repeated pieces" aria-label="Find in repeated pieces" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {repeats.note && <p className="w2-repeats-note" role="status" data-testid="repeats-note">{repeats.note}</p>}
    <div className="w2-level-scroll" data-base-ui-swipe-ignore>
      <RepeatsList ws={ws} query={query} onPick={cls => {
        repeats.pick(cls.id, 'sheet');
        push?.push({ title: ws.document ? pieceText(ws.document, cls) : 'Repeated piece', body: <Pushed onError={onError}/>, guard: () => { repeats.pick(undefined); return true; } });
      }}/>
    </div>
  </>;
}


/**
 * Repeated Pieces on a phone (templates spec 5, "On a phone: Project > Repeated Pieces"): a bottom sheet, half height on open and full on drag, that
 * leaves the page visible above it so the canvas can mark the piece. A row pushes the proposal inside the sheet. Done closes it; so does a selection on
 * the canvas.
 */
export default function RepeatsSheet({ ws, onError }: { ws: Workspace2; onError: (message: string) => void }) {
  const repeats = ws.repeats;
  const [snap, setSnap] = useState(HALF);
  if (!repeats.open || !ws.document) return null;
  return <Drawer.Root open modal={false} snapPoints={snapPoints} snapPoint={snap} onSnapPointChange={next => setSnap(typeof next === 'number' ? next : HALF)}
    onOpenChange={(open, details) => { if (!open && (details.reason === 'escape-key' || details.reason === 'swipe' || details.reason === 'close-watcher' || details.reason === 'close-press')) repeats.setOpen(false); }}>
    <Drawer.Portal><Drawer.Viewport className="w2-props-viewport"><Drawer.Popup className="w2-scope w2-sheet w2-props-sheet w2-level-sheet w2-repeats-sheet" aria-label="Repeated Pieces" data-testid="repeats-sheet"
      style={{ '--w2-sheet-hidden': `${Math.max(0, window.innerHeight - covered(snap))}px` } as CSSProperties}>
      <div className="w2-grabber" aria-hidden/>
      <div className="w2-level-content">
        <Live.Provider value={ws}><PushStack rootTitle="Repeated Pieces" root={<Root ws={ws} onError={onError}/>}/></Live.Provider>
      </div>
    </Drawer.Popup></Drawer.Viewport></Drawer.Portal>
  </Drawer.Root>;
}
