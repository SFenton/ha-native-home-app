import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, Info, ScanSearch, Search } from 'lucide-react';
import { templateWords } from './templateWords';
import { Icon } from '../ui';
import { lucide } from './add/AddPicker';
import { useAdd } from './add/AddHost';
import { paletteGroups, paletteTypes, tileType, type PaletteKind } from './add/catalog';
import { useDrag } from './dnd/DragLayer';
import './repeats/repeats.css';
import SavedComponents, { savedRows } from './SavedComponents';
import type { Library } from './useLibrary';
import { libraryOf } from './data/logic/logicModel';
import { logicWords } from './data/logic/logicWords';
import type { Workspace2 } from './useWorkspace2';

/** A drag starts after this many pixels, as everywhere else in the Studio. */
const SLOP = 4;
/** The row at the foot of the Templates group that opens the Repeated Pieces level. */
export const FIND_REPEATS = 'Find Repeated Pieces';

/**
 * The Components and Controls palettes: two columns of 64 px cells. A click adds after the selection, or at the end of the page; a drag onto
 * the simulator adds at the drop cue. A type that needs an entity opens the Add picker on its Entities segment instead, and cannot be dragged.
 * In Use the cells stay where they are at 40% opacity, `aria-disabled` and described by a notice with a Switch to Edit button.
 */
export default function LibraryPalette({ ws, kind, library }: { ws: Workspace2; kind: PaletteKind; library?: Library }) {
  const add = useAdd(), drag = useDrag();
  const [query, setQuery] = useState('');
  const dragged = useRef(false);
  const noticeId = useId(), gridRef = useRef<HTMLDivElement>(null), focusFirst = useRef(false);
  const noun = kind === 'controls' ? 'controls' : 'components';
  const types = useMemo(() => paletteTypes[kind].flatMap(type => { const found = tileType(type); return found ? [found] : []; }), [kind]);
  const needle = query.trim().toLowerCase();
  const shown = types.filter(type => !needle || type.name.toLowerCase().includes(needle));
  const disabled = ws.mode !== 'edit';
  const grouped = Boolean(library);
  const saved = useMemo(() => grouped ? savedRows(ws.document) : [], [grouped, ws.document]);
  const logicHits = useMemo(() => needle && ws.document ? libraryOf(ws.document).filter(entry => entry.name.toLowerCase().includes(needle)) : [], [needle, ws.document]);
  const repeats = ws.repeats;
  const found = repeats?.result ? repeats.result.classes.length + repeats.result.tiles.length : 0;
  const savedMatch = saved.filter(row => !needle || row.entry.name.toLowerCase().includes(needle)).length;
  const savedOpen = library?.groupOpen('saved', true) ?? true, builtOpen = library?.groupOpen('built-in', true) ?? true;
  // The button leaves focus on the first cell once Edit has drawn.
  useEffect(() => { if (focusFirst.current && ws.mode === 'edit') { focusFirst.current = false; gridRef.current?.querySelector<HTMLElement>('.w2-palette-grid button')?.focus(); } }, [ws.mode, shown.length]);
  const down = (type: string, needsEntity: boolean) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    if (!drag || disabled || needsEntity || event.button !== 0 || event.pointerType === 'touch') return;
    const cell = event.currentTarget, start = { x: event.clientX, y: event.clientY };
    let started = false;
    const moved = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < SLOP) return;
        started = true; dragged.current = true;
        drag.begin({ key: 'node:__new__', carry: type, mode: 'mouse', point: start, locate: drag.locateNew(type), ghostOf: cell });
      }
      drag.move(e.clientX, e.clientY);
    };
    const stop = (commit: boolean) => () => { window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); if (started) (commit ? drag.end() : drag.cancel()); };
    const up = stop(true), cancel = stop(false);
    window.addEventListener('pointermove', moved); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  const typeGrid = (list: typeof shown, title = kind === 'controls' ? 'Controls' : 'Components') => (
    <ul className="w2-palette-grid" aria-label={title}>
        {list.map(type => <li key={type.key}><button type="button" className="w2-palette-cell" data-type={type.key} aria-disabled={disabled || undefined} aria-describedby={disabled ? noticeId : undefined}
          onPointerDown={down(type.key, Boolean(type.domains || type.asks))}
          onClick={event => { if (disabled) return; if (dragged.current) { dragged.current = false; return; } add?.addType(type.key, event.currentTarget); }}>
          <Icon name={lucide[type.glyph] ?? 'grid'} size={20}/><span>{type.name}</span></button></li>)}
      </ul>
  );
  return <div className="w2-palette" data-kind={kind}>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={`Find in ${kind === 'controls' ? 'controls' : 'components'}`} aria-label={`Find in ${kind === 'controls' ? 'controls' : 'components'}`} value={query} onChange={event => setQuery(event.target.value)}/></label>
    {kind === 'components' && needle && logicHits.length > 0 && <div className="w2-logic-hits" data-testid="logic-hits">{logicHits.map(entry => <p key={entry.id} className="w2-caption">{entry.name} is a logic template. <button type="button" className="w2-link-button" onClick={() => { library?.press('data'); ws.openLogic(entry.id); }}>{logicWords.searchShow}</button></p>)}</div>}
    {disabled && <div className="w2-lib-notice" id={noticeId} data-testid="library-notice"><Info size={16} aria-hidden/><p>{`Switch to Edit to add ${noun}.`}</p>
      <button type="button" onClick={() => { focusFirst.current = true; ws.setMode('edit'); }}>Switch to Edit</button></div>}
    <div className="w2-lib-scroll" ref={gridRef}>
      {grouped && library ? <>
        {needle && shown.length === 0 && savedMatch === 0 ? <p className="w2-empty">Nothing matches.</p> : <>
          {kind === 'components' && <section className="w2-palette-group" data-group="saved">
            <h3 className="w2-group-title w2-tree-group"><button type="button" className="w2-tree-group-button" aria-expanded={savedOpen} onClick={() => library.setGroup('saved', !savedOpen)}><ChevronDown size={12} aria-hidden data-open={savedOpen || undefined}/><span>Templates</span><span className="w2-tree-count">{saved.length}</span></button>
            </h3>
            {savedOpen && <SavedComponents ws={ws} query={query} disabled={disabled} describedBy={disabled ? noticeId : undefined}/>}
            {savedOpen && saved.length === 0 && repeats && <button type="button" className="w2-link-button w2-tpl-emptycta" onClick={() => repeats.setOpen(true)}>{FIND_REPEATS}</button>}
          </section>}
          {paletteGroups[kind].map(group => {
            const here = shown.filter(type => group.keys.includes(type.key));
            if (here.length === 0) return null;
            const open = library.groupOpen(group.id, true);
            return <section key={group.id} className="w2-palette-group" data-group={group.id}>
              <h3 className="w2-group-title w2-tree-group"><button type="button" className="w2-tree-group-button" aria-expanded={open} onClick={() => library.setGroup(group.id, !open)}><ChevronDown size={12} aria-hidden/>{group.title}<span className="w2-tree-count">{here.length}</span></button></h3>
              {open && typeGrid(here, group.title)}
            </section>;
          })}
        </>}
      </> : shown.length === 0 ? <p className="w2-empty">Nothing matches.</p> : typeGrid(shown)}
    </div>
    {kind === 'components' && repeats
      ? <footer className="w2-lib-foot" aria-label="Templates"><button type="button" data-testid="find-repeats" aria-label={found ? `${FIND_REPEATS}, ${found} found` : FIND_REPEATS} onClick={() => repeats.setOpen(true)}><ScanSearch size={16} aria-hidden/>{FIND_REPEATS}{found ? <span className="w2-tree-count" data-testid="find-repeats-count">{found}</span> : null}</button>
        {!disabled && <p className="w2-caption w2-tpl-foothint">{templateWords.footHint}</p>}</footer>
      : !disabled && <p className="w2-lib-hint">Drag onto the page, or click to add after the selection.</p>}
  </div>;
}
