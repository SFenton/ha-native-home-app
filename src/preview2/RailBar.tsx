import { Ellipsis } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CompositionActionSlot, CompositionDocument, CompositionGroups } from '../shared/composition/schema';
import { ButtonItem, Circle, ProfileCircle, railItems, TabBar, useShownTabCount } from './Chrome';
import { FOLD_POSE } from './fold-motion';
import { GlyphByName } from './nodes/shared';
import { BADGE, RAIL } from './rail-constants';
import { moreMenuVars } from './rail-style';
import { moreMenuBox, railLayout, type RailGroupInput, type RailPriority } from './rail-layout';
import { useRender } from './render-context';
import { railSideOf, type PreviewWindow } from './windows';

type Item = CompositionGroups[number]['items'][number];

/** One thing the rail can show: a circle of the header, which can fold into More. */
interface Entry {
  key: string;
  priority: RailPriority;
  item: Item;
  part: 'links' | 'profile' | 'button';
  /** The menu row's words, glyph and action when it is folded. */
  label: string;
  glyph: string;
  action: CompositionActionSlot | undefined;
}

/** The entries of an item: the `shell-header` is two (Quick Links, Your Summary), a button is one. */
function entriesOf(item: Item): Entry[] {
  if (item.type === 'shell-header') return [
    { key: `${item.id}/links`, priority: 'normal', item, part: 'links', label: 'Quick Links', glyph: 'square.grid.2x2', action: item.quickLinksAction },
    { key: `${item.id}/profile`, priority: 'normal', item, part: 'profile', label: 'Your Summary', glyph: 'person.crop.circle', action: item.profileAction },
  ];
  if (item.type === 'button') return [{ key: item.id, priority: item.priority, item, part: 'button', label: item.menuLabel, glyph: item.icon.name, action: item.action }];
  return [];
}

function EntryView({ entry }: { entry: Entry }) {
  const item = entry.item;
  if (entry.part === 'links' && item.type === 'shell-header') return <Circle selKey={`chrome-item:${item.id}`} label="Quick Links" icon="square.grid.2x2" action={item.quickLinksAction} glyph={RAIL.glyph.quickLinks}/>;
  if (entry.part === 'profile' && item.type === 'shell-header') return <ProfileCircle item={item} rail/>;
  return item.type === 'button' ? <ButtonItem item={item}/> : null;
}

/**
 * The Duo's vertical bar (the folded Duo and the unfolded Duo sideways), `ui-rail` in the mockup kit: a 48.5 pt column on the camera's centre
 * line with the header items in a glass pill under the keep-clear region and the tabs in a pill at the other end (`rail-layout.ts` places them).
 * When they do not all fit, items fold into a More circle, lowest priority first, and More opens a menu of them. The camera is at one end of
 * the rail, and the order never flips. No menu button. The title is in the header row.
 */
export function RailBar({ document, tabId, groups, root, window: win }: { document: CompositionDocument; tabId?: string; groups: CompositionGroups; root: boolean; window: PreviewWindow }) {
  const ctx = useRender();
  const side = railSideOf(win);
  const ordered = useMemo(() => ['leading', 'trailing'].flatMap(placement => groups.filter(group => group.placement === placement))
    .map(group => ({ group, entries: railItems(group, root).flatMap(entriesOf) })).filter(entry => entry.entries.length), [groups, root]);
  const tabCount = useShownTabCount(document);
  const layout = useMemo(() => railLayout({
    width: win.width, length: win.height, side, tabs: tabCount,
    camera: win.camera ? { end: win.camera.corner.vertical, reach: win.camera.reach } : undefined,
    groups: ordered.map(({ group, entries }): RailGroupInput => ({ id: group.id, shared: group.vertical !== 'separate@1', items: entries.map(({ key, priority }) => ({ key, priority })) })),
  }), [win, side, tabCount, ordered]);

  const entries = ordered.flatMap(({ entries: list }) => list);
  // The menu lists the folded items in the rail's own order; the priority decided what folds, never the order.
  const rows = entries.filter(entry => layout.folded.includes(entry.key));
  const [open, setOpen] = useState(false), [leaving, setLeaving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus = false) => { setOpen(false); setLeaving(true); if (refocus) button.current?.focus(); };
  // The menu closes with the exit animation, and a fold, an unfold or a rotate (a new window) closes it.
  useEffect(() => { if (!leaving) return; const timer = setTimeout(() => setLeaving(false), FOLD_POSE.settleMs); return () => clearTimeout(timer); }, [leaving]);
  useEffect(() => { setOpen(false); setLeaving(false); }, [win]);
  useEffect(() => { if (!rows.length) { setOpen(false); setLeaving(false); } }, [rows.length]);

  const box = moreMenuBox(layout, side, rows.length);
  const style = { '--rail-cx': `${layout.centre}px`, '--rail-pill': `${RAIL.pill}px`, '--rail-circle': `${RAIL.circle}px`, '--rail-gap': `${RAIL.gap}px`, '--badge-dx': `${BADGE.dx}px`, '--badge-dy': `${BADGE.dy}px`, '--badge-h': `${BADGE.height}px`, '--badge-pad': `${BADGE.padX}px`, '--badge-wide': `${BADGE.wide}px`, '--tabs-top': `${layout.tabs.top}px`, '--tabs-h': `${layout.tabs.height}px`, '--tabs-w': `${layout.tabs.width}px`,
    '--held-top': `${layout.held.top}px`, '--held-h': `${layout.held.height}px`, '--held-w': `${layout.held.width}px`, '--held-pitch': `${layout.held.pitch}px`, '--tab-pitch': `${layout.tabs.pitch}px` } as CSSProperties;
  return <div className="sh-rail-bar" data-rail-bar="" data-compressed={layout.compressed ? '' : undefined} style={style}>
    {layout.header && <div className="sh-rail-header" style={{ top: layout.header.top }}>
      {layout.groups.map(group => <div key={group.id} className={group.shared ? 'sh-group sh-shared sh-rail-group' : 'sh-group sh-rail-circles'}>
        {entries.filter(entry => group.keys.includes(entry.key)).map(entry => <EntryView key={entry.key} entry={entry}/>)}</div>)}
    </div>}
    {layout.more && <button ref={button} type="button" className="sh-circle sh-rail-more" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open} data-passthrough="" style={{ top: layout.more.top }}
      onClick={() => { if (open) close(); else { setLeaving(false); setOpen(true); } }}><Ellipsis size={RAIL.glyph.more}/></button>}
    <TabBar document={document} tabId={tabId} vertical/>
    {(open || leaving) && box && <>
      <div className="sh-more-catch" data-passthrough="" aria-hidden="true" onClick={() => close()} onContextMenu={event => { event.preventDefault(); close(); }}/>
      <MoreMenu rows={rows} box={box} side={side} closing={!open} onClose={refocus => close(refocus)} mode={ctx.mode} run={ctx.run}/>
    </>}
  </div>;
}

/** The More menu: a glass menu on the More circle's corner, no scrim, one row per folded item, each a title and a symbol (A5, A6). */
function MoreMenu({ rows, box, side, closing, onClose, mode, run }: {
  rows: Entry[]; box: { left: number; top: number; width: number; height: number }; side: 'leading' | 'trailing'; closing: boolean;
  onClose: (refocus: boolean) => void; mode: 'edit' | 'use'; run: (action: CompositionActionSlot) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  // A press that began in the menu is in progress: the selection layer focuses its own layer on pointerdown, which blurs the row, and closing then would drop the menu before the click lands.
  const pressing = useRef(false);
  useEffect(() => {
    const release = () => { pressing.current = false; };
    window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true);
    return () => { window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true); };
  }, []);
  useEffect(() => { if (!closing) menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true }); }, [closing]);
  const keys = (event: KeyboardEvent) => {
    const items = [...menu.current!.querySelectorAll<HTMLElement>('[role=menuitem]')], at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    // In Edit the selection layer takes the click, so a keyboard choice closes the menu here.
    else if ((event.key === 'Enter' || event.key === ' ') && mode === 'edit') setTimeout(() => onClose(true), 0);
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus(); }
  };
  return <div ref={menu} className="sh-more-menu" role="menu" aria-label="More" data-side={side} data-closing={closing ? '' : undefined} inert={closing || undefined}
    style={{ left: box.left, top: box.top, width: box.width, height: box.height, ...moreMenuVars() } as CSSProperties}
    onKeyDown={keys} onPointerDownCapture={() => { pressing.current = true; }}
    onBlur={event => { if (!pressing.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) onClose(false); }}>
    {rows.map(entry => <button key={entry.key} type="button" role="menuitem" className="sh-more-row" data-sel={`chrome-item:${entry.item.id}`}
      // Choosing a row closes the menu, then runs the item's action (Use). In Edit the selection layer takes the click, so the release closes it.
      onClick={() => { onClose(true); if (mode === 'use' && entry.action) run(entry.action); }}
      onPointerUp={() => { if (mode === 'edit') setTimeout(() => onClose(true), 0); }}>
      <span className="sh-more-glyph"><GlyphByName name={entry.glyph} size={RAIL.glyph.quickLinks}/></span><span className="sh-more-label">{entry.label}</span>
    </button>)}
  </div>;
}
