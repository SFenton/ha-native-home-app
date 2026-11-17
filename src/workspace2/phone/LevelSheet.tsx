import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Drawer } from '@base-ui/react/drawer';
import { ChevronLeft, Plus } from 'lucide-react';
import type { SelectionKey } from '../../preview2/model';
import { useAdd } from '../add/AddHost';
import { endOf } from '../add/insert';
import { PushStack, usePush } from '../kit';
import { MoveToPage } from '../PropertiesPanel';
import { RowsProvider } from '../rows';
import type { Workspace2 } from '../useWorkspace2';
import { levelRows, levelTitle, surfaceWordOf, openingLevel, pathTo, survivingLevel, trailTo } from '../levels';
import { typeName } from '../util';
import Crumbs from '../Crumbs';
import LevelList from './LevelList';
import { insertArea } from '../layout/areaOps';
import { shownTabs } from '../../preview2/shown-tabs';
import type { TabsNode } from '../../shared/composition/layout-blocks';

/** The sheet's two heights: half the screen on open, the whole of it on drag. */
const HALF = 0.5, FULL = 1;
const snapPoints = [HALF, FULL];
const covered = (snap: number) => window.innerHeight * snap;
/** "Tile grid" reads "Tile Grid" on a button. */
const titleCase = (words: string) => words.replace(/\b\w/g, letter => letter.toUpperCase());

/** The inside of the sheet: its header, the level's rows and its footer. Lives inside the push stack, so Move To… can push a page. */
function LevelPage({ ws, level, trail, direction, onEnter, onJump, onBack, onDone, onLeave, onError }: {
  ws: Workspace2; level: SelectionKey; trail: SelectionKey[]; direction?: 'forward' | 'back';
  onEnter: (key: SelectionKey) => void; onJump: (key: SelectionKey) => void; onBack: () => void; onError: (message: string) => void;
  /** Done: the selection ends with the sheet. */
  onDone: () => void;
  /** The sheet gives way to something that needs the selection (a leaf's properties, the Add picker). */
  onLeave: () => void;
}) {
  const document = ws.document!, index = ws.index!;
  const push = usePush();
  const add = useAdd();
  const root = trail[0], atRoot = level === root;
  const rows = useMemo(() => levelRows(document, index, level), [document, index, level]);
  const path = useMemo(() => pathTo(document, index, level), [document, index, level]);
  const here = index.get(level);
  const destination = endOf(document, level);
  // A local tab's settings are its tabs' node's; every other level selects itself.
  const settingsKey = level;
  const settingsEntry = index.get(settingsKey);
  const tabsHere = here?.node?.type === 'local-tabs' ? { node: here.node as TabsNode, path: here.path } : undefined;
  const addArea = (shared: boolean) => {
    if (!tabsHere) return;
    try {
      const made = insertArea(document, tabsHere.path, tabsHere.node, { shared, tabId: shownTabs.get(tabsHere.node.id) });
      ws.studio.apply(made.document);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const settings = here?.kind === 'local-tab' ? 'Area Settings' : settingsEntry?.kind === 'page' ? 'Page Settings' : settingsEntry?.kind === 'modal' ? `${surfaceWordOf(document, index, settingsKey)} Settings` : `${titleCase(typeName(settingsEntry?.node ?? 'section'))} Settings`;
  const title = levelTitle(document, index, level);
  return <>
    <header className="w2-level-head">
      <div className="w2-level-lead">{!atRoot && <button type="button" className="w2-icon-button w2-level-back" aria-label={`Back to ${path.at(-1)?.title ?? ''}`} onClick={onBack}><ChevronLeft size={22} aria-hidden/></button>}</div>
      <div className="w2-level-titles"><h2 className="w2-level-title-text">{title}</h2><Crumbs path={path} atRoot={atRoot} onJump={onJump}/></div>
      <div className="w2-level-trail"><button type="button" className="w2-level-done" onClick={onDone}>Done</button></div>
    </header>
    <div className="w2-level-scroll" data-base-ui-swipe-ignore>
      <div key={level} className="w2-level-view" data-direction={direction}>
        <LevelList ws={ws} level={level} rows={rows} direction={direction} onEnter={onEnter} onError={onError}
          onLeaf={key => { ws.select(key); onLeave(); }}
          onMoveTo={id => push?.push({ title: 'Move To…', body: <MoveToPage id={id} onDone={moved => { ws.studio.apply(moved); push.pop(); }}/> })}/>
      </div>
    </div>
    <footer className="w2-level-foot">
      {tabsHere ? <>
        <button type="button" className="w2-level-add" onClick={() => addArea(true)}><Plus size={16} aria-hidden/>Shared Area</button>
        <button type="button" className="w2-level-add" onClick={() => addArea(false)}><Plus size={16} aria-hidden/>Tab Area</button>
      </> : <button type="button" className="w2-primary w2-level-add" disabled={!add || !destination || !add.accepts(destination)}
        onClick={() => { if (!add || !destination) return; onLeave(); add.open(destination); }}><Plus size={16} aria-hidden/>Add Here</button>}
      <button type="button" className="w2-level-settings" onClick={() => { ws.select(settingsKey); onLeave(); }}>{settings}</button>
    </footer>
  </>;
}

/** The open sheet. Its state (the trail of levels, the snap) is new each time it opens, so it always opens at the selection's level. */
function LevelBody({ ws, onClose, onError }: { ws: Workspace2; onClose: () => void; onError: (message: string) => void }) {
  const document = ws.document!, index = ws.index!, surface = ws.surface!;
  const root = `${surface.kind}:${surface.id}` as SelectionKey;
  const [trail, setTrail] = useState<SelectionKey[]>(() => trailTo(index, openingLevel(index, root, ws.selection)));
  const [direction, setDirection] = useState<'forward' | 'back'>();
  const [snap, setSnap] = useState(HALF);
  const level = survivingLevel(index, trail);
  // The level's node deleted or moved away (Undo, Move To…): the sheet goes up to the nearest level that is left.
  useEffect(() => {
    if (!index.get(trail[0])) { onClose(); return; }
    const next = trailTo(index, level);
    if (next.join('|') !== trail.join('|')) { setDirection('back'); setTrail(next); }
  }, [index, level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ws.mode === 'use') onClose(); }, [ws.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { ws.select(undefined); onClose(); };
  const context = useMemo(() => ({ document, onChange: ws.studio.apply, onError }), [document, ws.studio.apply, onError]);
  const aria = levelTitle(document, index, root);
  return <Drawer.Root open modal={false} snapPoints={snapPoints} snapPoint={snap} onSnapPointChange={next => setSnap(typeof next === 'number' ? next : HALF)}
    onOpenChange={(open, details) => {
      // Only Escape, a swipe down and the back gesture close it. A press on the canvas, in a menu or on Undo is not asking to, and neither is focus moving there.
      if (!open && (details.reason === 'escape-key' || details.reason === 'swipe' || details.reason === 'close-watcher' || details.reason === 'close-press')) done();
    }}>
    <Drawer.Portal><Drawer.Viewport className="w2-props-viewport"><Drawer.Popup className="w2-scope w2-sheet w2-props-sheet w2-level-sheet" aria-label={aria} data-testid="level-sheet"
      style={{ '--w2-sheet-hidden': `${Math.max(0, window.innerHeight - covered(snap))}px` } as CSSProperties}>
      <div className="w2-grabber" aria-hidden/>
      <div className="w2-level-content">
        <RowsProvider value={context}>
          <PushStack rootTitle={aria} root={<LevelPage ws={ws} level={level} trail={trail} direction={direction} onError={onError} onDone={done} onLeave={onClose}
            onEnter={key => { setDirection('forward'); setTrail(trailTo(index, key)); if (index.get(key)?.kind === 'node') ws.select(key); }}
            onJump={key => { setDirection('back'); setTrail(trailTo(index, key)); }}
            onBack={() => { setDirection('back'); setTrail(trail.slice(0, -1)); }}/>}/>
        </RowsProvider>
      </div>
    </Drawer.Popup></Drawer.Viewport></Drawer.Portal>
  </Drawer.Root>;
}

/**
 * "This Page" on a phone (studio-ux2 pick 4): a bottom sheet, half height on open and full on drag, that shows the children of one
 * container at a time. Tapping a container goes into it, the header's Back and its breadcrumb subtitle come back out, a leaf is
 * selected and handed to the properties sheet. Add Here adds at the end of the level, and the footer's settings button opens the
 * level's own properties. It is the phone sheet only: the wide Pages panel keeps the outline tree.
 */
export default function LevelSheet({ ws, open, onOpenChange, onError }: { ws: Workspace2; open: boolean; onOpenChange: (open: boolean) => void; onError: (message: string) => void }) {
  if (!open || !ws.document || !ws.index || !ws.surface) return null;
  return <LevelBody ws={ws} onClose={() => onOpenChange(false)} onError={onError}/>;
}
