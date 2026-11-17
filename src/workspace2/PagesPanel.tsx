import { useMemo, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChangeListIconItem } from './ListIconPicker';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { GlyphByName } from '../preview2/nodes/shared';
import { buildOutline, libraryGroups, surfaceWord, type LibraryRow, type ListKind, type SurfaceRef } from './outline';
import { categoryInfo } from './LibraryRail';
import { categoryOfSurface } from './useLibraryTrail';
import { selectionKey } from '../preview2/model';
import type { TreeCategory } from './layout';
import { Tag } from './kit';
import type { Workspace2 } from './useWorkspace2';
import { createPage, createSheet, createTab, deleteSurfaceDialog, renameSurfaceDialog } from './navigation/controller';
import { duplicateSurface, tabRoom } from './navigation/edit';

/** What the Pages overlay does to the rest of the workspace. Everything here is optional so the panel can be drawn on its own. */
export interface PagesActions {
  /** Closes the overlay; the creation dialogs open over the preview, never over a sheet. */
  onDismiss?: () => void;
  /** Opens a page's or sheet's settings in the properties surface. */
  onSettings?: (surface: SurfaceRef) => void;
  /** Opens the Tabs panel (the "Tabs" group header). */
  onTabs?: () => void;
  /** Applies a changed document (Duplicate). */
  onChange?: (document: CompositionDocument) => void;
  /** Moves the preview to a surface. */
  onShow?: (surface: SurfaceRef) => void;
}

/** The overlay's footer: "Page", "Sheet" and "Tab", each with a plus, each opening the one creation dialog (spec 5.6). */
const scopes: readonly ListKind[] = ['tabs', 'pages', 'sheets', 'modals'];

export function PagesFooter({ onDismiss, tabReason }: { onDismiss?: () => void; /** Why no tab can be added, when the bar is full; it shows beside the disabled Tab button. */ tabReason?: string }) {
  const open = (start: () => Promise<string | undefined>) => () => { onDismiss?.(); void start(); };
  return <footer className="w2-pages-foot" aria-label="Add">
    <button type="button" onClick={open(() => createPage())}><Plus size={14} aria-hidden/>Page</button>
    <button type="button" onClick={open(() => createSheet())}><Plus size={14} aria-hidden/>Sheet</button>
    <button type="button" disabled={Boolean(tabReason)} aria-describedby={tabReason ? 'w2-pages-tab-reason' : undefined} onClick={open(() => createTab())}><Plus size={14} aria-hidden/>Tab</button>
    {tabReason && <p id="w2-pages-tab-reason" className="w2-caption w2-pages-foot-reason">{tabReason}</p>}
  </footer>;
}

/**
 * The library panel's footer for a list (studio-ux2 lib3, L-tax): Tabs adds a tab and opens the Tabs panel, Pages adds a page, Sheets a sheet
 * and Modals a modal. Each opens the one creation dialog.
 */
export function LibraryFooter({ scope, tabReason, onEditTabs, disabled }: { scope: TreeCategory; tabReason?: string; onEditTabs?: () => void; /** Use mode: the buttons stay where they are, disabled. */ disabled?: boolean }) {
  const open = (start: () => Promise<string | undefined>) => () => { void start(); };
  return <footer className="w2-lib-foot" aria-label="Add">
    {scope === 'tabs' && <>
      <button type="button" disabled={disabled || Boolean(tabReason)} aria-describedby={tabReason ? 'w2-lib-tab-reason' : undefined} onClick={open(() => createTab())}><Plus size={14} aria-hidden/>Tab</button>
      <button type="button" disabled={disabled} onClick={onEditTabs}>Edit Tabs</button>
      {tabReason && <p id="w2-lib-tab-reason" className="w2-caption w2-pages-foot-reason">{tabReason}</p>}
    </>}
    {scope === 'pages' && <button type="button" disabled={disabled} onClick={open(() => createPage())}><Plus size={14} aria-hidden/>Page</button>}
    {scope === 'sheets' && <button type="button" disabled={disabled} onClick={open(() => createSheet())}><Plus size={14} aria-hidden/>Sheet</button>}
    {scope === 'modals' && <button type="button" disabled={disabled} onClick={open(() => createSheet({ fullScreen: true }))}><Plus size={14} aria-hidden/>Modal</button>}
  </footer>;
}

/** The items of a surface's menu: Rename, Duplicate, Page, Sheet or Modal Settings, Delete. One list for the ••• button and the right-click menu. */
export function SurfaceMenuItems({ document, surface, actions }: { document: CompositionDocument; surface: SurfaceRef; actions: PagesActions }) {
  const modal = surface.kind === 'modal' ? document.modals.find(item => item.id === surface.id) : undefined;
  const word = surface.kind === 'page' ? 'Page' : modal ? surfaceWord(modal) : 'Sheet';
  const last = surface.kind === 'page' && document.pages.length <= 1;
  return <>
    <Menu.Item className="w2-menu-item" onClick={() => { actions.onDismiss?.(); renameSurfaceDialog(surface); }}>Rename</Menu.Item>
    <Menu.Item className="w2-menu-item" onClick={() => {
      const copy = duplicateSurface(document, surface);
      actions.onChange?.(copy.document);
      actions.onShow?.({ kind: surface.kind, id: copy.id });
    }}>Duplicate</Menu.Item>
    <Menu.Item className="w2-menu-item" onClick={() => { actions.onSettings?.(surface); actions.onDismiss?.(); }}>{word} Settings</Menu.Item>
    <ChangeListIconItem rowKey={selectionKey(surface.kind, surface.id)}/>
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item w2-danger-item" disabled={last} onClick={() => { actions.onDismiss?.(); deleteSurfaceDialog(surface); }}>Delete</Menu.Item>
  </>;
}

/** A row's More menu. */
export function RowMenu({ document, surface, title, actions, className = 'w2-icon-button' }: { document: CompositionDocument; surface: SurfaceRef; title: string; actions: PagesActions; className?: string }) {
  // A long list holds a menu per row; each is built on its first press, so a change to the document does not pay for all of them.
  const [armed, setArmed] = useState(false), [open, setOpen] = useState(false);
  if (!armed) return <button type="button" className={className} aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded="false" onClick={() => { setArmed(true); setOpen(true); }}><MoreHorizontal size={18} aria-hidden/></button>;
  return <Menu.Root open={open} onOpenChange={setOpen}>
    <Menu.Trigger className={className} aria-label={`More for ${title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <SurfaceMenuItems document={document} surface={surface} actions={actions}/>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The phone's Pages sheet (spec 5.3): search, the four lists (Tabs, Pages, Sheets, Modals, the same as the wide library's rail items) and the footer that adds a page, sheet or tab. A row picks
 * a page; its More menu renames, duplicates, opens settings or deletes it. "This Page" is its own sheet (`phone/LevelSheet.tsx`); the
 * wide library has its own lists (`LibraryTree.tsx`).
 */
export default function PagesPanel({ document, current, onPick, actions = {} }: { document: CompositionDocument; current: SurfaceRef | undefined; onPick: (surface: SurfaceRef) => void; actions?: PagesActions; ws?: Workspace2 }) {
  const [query, setQuery] = useState('');
  // Opens on the list that holds the page or sheet on show, so the row for "here" is in view.
  const [scope, setScope] = useState<ListKind>(() => current ? categoryOfSurface(document, selectionKey(current.kind, current.id)) : 'tabs');
  const groups = useMemo(() => libraryGroups(document, scope), [document, scope]);
  const same = (surface: SurfaceRef) => current?.kind === surface.kind && current.id === surface.id;
  const render = (row: LibraryRow): ReactNode => <li key={row.key}>
    <div className="w2-page-item">
      <button type="button" className="w2-page-row" style={{ paddingInlineStart: 16 }} data-current={same(row.surface) || undefined}
        aria-current={same(row.surface) ? 'page' : undefined} onClick={() => onPick(row.surface)}>
        <GlyphByName name={row.icon} size={18}/>
        <span className="w2-page-text"><span className="w2-page-title">{row.title}</span>{row.via && <span className="w2-page-via">{row.via}</span>}</span>
        {row.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}
      </button>
      <RowMenu document={document} surface={row.surface} title={row.title} actions={actions}/>
    </div>
  </li>;
  // The tab bar's heading keeps its count ("Tabs · 3 of 5") and still opens the Tabs panel.
  const tabsTitle = useMemo(() => buildOutline(document).groups.find(group => group.id === 'tabs')?.title ?? 'Tabs', [document]);
  const tabsHeading = actions.onTabs
    ? <h3 className="w2-group-title"><button type="button" className="w2-group-button" onClick={() => { actions.onTabs?.(); actions.onDismiss?.(); }}>{tabsTitle}</button></h3>
    : <h3 className="w2-group-title">{tabsTitle}</h3>;
  const noun = scope === 'tabs' ? 'tab' : scope === 'pages' ? 'page' : scope === 'sheets' ? 'sheet' : 'modal';
  const list = (text: string): ReactNode => {
    const needle = text.trim().toLowerCase();
    const shown = groups.map(group => ({ ...group, rows: group.rows.filter(row => !needle || row.title.toLowerCase().includes(needle)) })).filter(group => group.rows.length);
    return shown.length === 0 ? <p className="w2-empty">{needle ? `No ${noun}s match.` : `No ${noun}s yet.`}</p> : shown.map(group => <section key={group.id} aria-label={group.title}>
      {scope === 'tabs' ? tabsHeading : <h3 className="w2-group-title">{group.title}</h3>}
      <ul>{group.rows.map(render)}</ul>
    </section>);
  };
  return <div className="w2-pages">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={`Find a ${noun}`} aria-label={`Find a ${noun}`} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-pages-scope" role="group" aria-label="List">
      {scopes.map(item => <button key={item} type="button" aria-pressed={scope === item} onClick={() => setScope(item)}>{categoryInfo[item].label}</button>)}
    </div>
    <div className="w2-pages-scroll">{list(query)}</div>
    <PagesFooter onDismiss={actions.onDismiss} tabReason={tabRoom(document).reason}/>
  </div>;
}
