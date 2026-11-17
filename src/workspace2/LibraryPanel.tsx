import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown, X } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import type { SelectionKey } from '../preview2/model';
import LibraryPalette from './LibraryPalette';
import LibraryTree from './LibraryTree';
import DataPanel from './data/DataPanel';
import RepeatsLevel from './repeats/RepeatsLevel';
import { categoryInfo } from './LibraryRail';
import { categories, isTreeCategory, type Category, type Tier } from './layout';
import type { Library } from './useLibrary';
import type { LibraryTrail } from './useLibraryTrail';
import type { Workspace2 } from './useWorkspace2';

/** The rail button of a category, for returning focus to it. */
const railButton = (category: Category) => window.document.querySelector<HTMLElement>(`.w2-lib-rail [data-category="${category}"]`);

/**
 * The library panel. Docked it is 272 px beside the rail; as a flyout it is 300 px over the rail with a 56 px first row (a pop-up button that shows the
 * open category and lists all seven, and Close). The surfaces (Tabs, Pages, Sheets, Modals) are a tree that goes one level at a time
 * (`LibraryTree`); Components and Controls are palettes. It never traps focus: a press on the simulator leaves it open, Close and Escape
 * close it and focus goes back to the rail button.
 */
export default function LibraryPanel({ ws, document, tier, category, open, shown, library, trailApi, onCategory, onKeepPanel, onError, onClose }: {
  ws: Workspace2; document: CompositionDocument; tier: Exclude<Tier, 'phone'>; category: Category; open: boolean; /** Whether it sits in its open place; false while it slides out. */ shown: boolean;
  library: Library; trailApi: LibraryTrail; onCategory: (category: Category) => void; onKeepPanel: (key: SelectionKey) => void; onError: (message: string) => void; onClose: () => void;
}) {
  const flyout = tier === 'flyout';
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  // The flyout takes focus in when it opens, to its category button; closing it by Close or Escape (below) gives it back to the rail.
  useEffect(() => {
    if (flyout && open && !wasOpen.current) window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.w2-lib-picker')?.focus());
    wasOpen.current = open;
  }, [flyout, open]);
  const close = () => { ws.repeats?.setOpen(false); onClose(); railButton(category)?.focus(); };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const typing = event.target instanceof HTMLInputElement && event.target.value !== '';
    if (event.key === 'Escape' && !event.defaultPrevented && !typing) { event.stopPropagation(); close(); }
  };
  const info = categoryInfo[category];
  const tree = isTreeCategory(category);
  const repeats = ws.repeats;
  const repeatsOpen = category === 'components' && Boolean(repeats?.open);
  // The level belongs to Components: leaving that rail item leaves it.
  useEffect(() => { if (category !== 'components' && repeats?.open) repeats.setOpen(false); }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  const backToRow = () => { repeats?.setOpen(false); window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-testid="find-repeats"]')?.focus()); };
  const content = repeatsOpen ? <RepeatsLevel ws={ws} onBack={backToRow} onClose={flyout ? undefined : close}/>
    : isTreeCategory(category)
    ? <LibraryTree ws={ws} category={category} library={library} trailApi={trailApi} onCategory={onCategory} onKeepPanel={onKeepPanel} onError={onError} onClose={flyout ? undefined : close}/>
    : category === 'data' ? <DataPanel ws={ws} onError={onError}/> : <LibraryPalette ws={ws} kind={category} library={library}/>;
  void document;
  return <aside ref={panel} className="w2-lib-panel" data-tier={tier} data-open={shown ? '' : undefined} aria-label={info.label} onKeyDown={keys} inert={!open} data-testid="library-panel">
    {flyout && <header className="w2-lib-head w2-lib-flyout-head">
      <Menu.Root>
        <Menu.Trigger className="w2-lib-picker" aria-label={`Library: ${info.label}`} aria-haspopup="menu">{info.icon(20)}<span>{info.label}</span><ChevronDown size={16} aria-hidden/></Menu.Trigger>
        <Menu.Portal><Menu.Positioner sideOffset={4} align="start" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu" aria-label="Library">
          {categories.map(item => <Menu.Item key={item} className="w2-menu-item w2-lib-pick" onClick={() => onCategory(item)}>{categoryInfo[item].icon(18)}<span>{categoryInfo[item].label}</span>{item === category && <Check size={16} aria-hidden className="w2-lib-check"/>}</Menu.Item>)}
        </Menu.Popup></Menu.Positioner></Menu.Portal>
      </Menu.Root>
      <button type="button" className="w2-icon-button" aria-label="Close" onClick={close}><X size={18} aria-hidden/></button>
    </header>}
    {!flyout && !tree && !repeatsOpen && <header className="w2-lib-head"><h2>{info.label}</h2><button type="button" className="w2-icon-button" aria-label="Close" onClick={close}><X size={18} aria-hidden/></button></header>}
    <div className="w2-lib-body" id="w2-lib-body">{content}</div>
  </aside>;
}
