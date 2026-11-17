import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { MoreHorizontal, Search } from 'lucide-react';
import type { SelectionKey } from '../preview2/model';
import { GlyphByName } from '../preview2/nodes/shared';
import { listIcons as store, useListIcons, type ListIconStore } from './listIcons';
import { filterIcons } from './pickers/icons';

/** Opens the List Icon popover on the library row of a key; absent where there is no row to point at (the inspector, the simulator). */
const OpenListIcon = createContext<((key: SelectionKey) => void) | undefined>(undefined);

/**
 * "Change List Icon…" in a row's More menu, in its own group above Delete (studio-ux2 lib3, L-icons). Draws nothing outside the
 * library tree, where no row is there for the popover to open on.
 */
export function ChangeListIconItem({ rowKey }: { rowKey: SelectionKey }) {
  const open = useContext(OpenListIcon);
  if (!open) return null;
  return <>
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item" onClick={() => open(rowKey)}>Change List Icon…</Menu.Item>
  </>;
}

/**
 * A row's More in Use: the one command that does not change the document. The structure commands (Duplicate, Move, Delete) wait
 * for Edit, and the row says so in the menu's one disabled line.
 */
export function ListIconOnlyMenu({ rowKey, title }: { rowKey: SelectionKey; title: string }) {
  const open = useContext(OpenListIcon);
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label={`More for ${title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <Menu.Item className="w2-menu-item" onClick={() => open?.(rowKey)}>Change List Icon…</Menu.Item>
      <Menu.Item className="w2-menu-item" disabled>Switch to Edit to change the rest.</Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/** What the popover picks from: the Studio's icon list, filtered by a search. */
function IconGrid({ value, onPick }: { value?: string; onPick: (symbol: string) => void }) {
  const [query, setQuery] = useState('');
  const found = useMemo(() => filterIcons(query.trim()), [query]);
  return <>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find an icon" aria-label="Find an icon" value={query} autoFocus onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-licon-grid" role="group" aria-label="Icons">
      {found.map(choice => <button type="button" key={choice.symbol} className="w2-licon-cell" aria-label={choice.name} title={choice.name} aria-pressed={choice.symbol === value} data-symbol={choice.symbol} onClick={() => onPick(choice.symbol)}>
        <GlyphByName name={choice.symbol} size={20}/></button>)}
      {found.length === 0 && <p className="w2-empty">Nothing matches.</p>}
    </div>
  </>;
}

/**
 * Owns the one List Icon popover of the library. A choice applies at once and closes it; Use Default takes the person's icon
 * back. Only the Studio shows these icons: the document, Publish and the app never change.
 */
export default function ListIconHost({ rowOf, children, icons = store }: { rowOf: (key: SelectionKey) => HTMLElement | null; children: ReactNode; icons?: ListIconStore }) {
  const [key, setKey] = useState<SelectionKey>();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chosen = useListIcons(icons);
  const open = (next: SelectionKey) => { setAnchor(rowOf(next)); setKey(next); };
  const close = () => setKey(undefined);
  return <OpenListIcon.Provider value={open}>
    {children}
    <Popover.Root open={key !== undefined && anchor !== null} onOpenChange={next => { if (!next) close(); }} modal={false}>
      <Popover.Portal><Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} collisionPadding={8} className="w2-positioner">
        <Popover.Popup className="w2-scope w2-popover w2-licon-popup" aria-label="List Icon" data-testid="list-icon-popover">
          <Popover.Title className="w2-licon-title">List Icon</Popover.Title>
          {key && <IconGrid value={chosen[key]} onPick={symbol => { icons.set(key, symbol); close(); }}/>}
          <p className="w2-caption w2-licon-note">Only the Studio shows this icon. The app does not change.</p>
          <div className="w2-licon-foot"><button type="button" disabled={!key || !chosen[key]} onClick={() => { if (key) icons.clear(key); close(); }}>Use Default</button></div>
        </Popover.Popup>
      </Popover.Positioner></Popover.Portal>
    </Popover.Root>
  </OpenListIcon.Provider>;
}
