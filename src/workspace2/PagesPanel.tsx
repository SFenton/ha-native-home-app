import { useMemo, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { Icon } from '../ui';
import { buildOutline, type OutlineGroup, type OutlineRow, type SurfaceRef } from './outline';
import { Tag } from './kit';
import ThisPage from './ThisPage';
import type { Workspace2 } from './useWorkspace2';
import { createPage, createSheet, createTab, deleteSurfaceDialog, renameSurfaceDialog } from './navigation/controller';
import { duplicateSurface } from './navigation/edit';

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

/** One view of the overlay. "This Page" is added to this list by the editing lane; the segment shows once there are two. */
interface PagesView { id: string; title: string; render: (query: string) => ReactNode }

/** The overlay's footer: "Page", "Sheet" and "Tab", each with a plus, each opening the one creation dialog (spec 5.6). */
export function PagesFooter({ onDismiss }: { onDismiss?: () => void }) {
  const open = (start: () => Promise<string | undefined>) => () => { onDismiss?.(); void start(); };
  return <footer className="w2-pages-foot" aria-label="Add">
    <button type="button" onClick={open(() => createPage())}><Plus size={14} aria-hidden/>Page</button>
    <button type="button" onClick={open(() => createSheet())}><Plus size={14} aria-hidden/>Sheet</button>
    <button type="button" onClick={open(() => createTab())}><Plus size={14} aria-hidden/>Tab</button>
  </footer>;
}

/** A row's More menu: Rename, Duplicate, Page Settings (Sheet Settings on a sheet), Delete. */
function RowMenu({ document, row, actions }: { document: CompositionDocument; row: OutlineRow; actions: PagesActions }) {
  const { surface } = row, sheet = surface.kind === 'modal';
  const last = !sheet && document.pages.length <= 1;
  return <Menu.Root>
    <Menu.Trigger className="w2-icon-button" aria-label={`More for ${row.title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      <Menu.Item className="w2-menu-item" onClick={() => { actions.onDismiss?.(); renameSurfaceDialog(surface); }}>Rename</Menu.Item>
      <Menu.Item className="w2-menu-item" onClick={() => {
        const copy = duplicateSurface(document, surface);
        actions.onChange?.(copy.document);
        actions.onShow?.({ kind: surface.kind, id: copy.id });
      }}>Duplicate</Menu.Item>
      <Menu.Item className="w2-menu-item" onClick={() => { actions.onSettings?.(surface); actions.onDismiss?.(); }}>{sheet ? 'Sheet Settings' : 'Page Settings'}</Menu.Item>
      <Menu.Separator className="w2-menu-sep"/>
      <Menu.Item className="w2-menu-item w2-danger-item" disabled={last} onClick={() => { actions.onDismiss?.(); deleteSurfaceDialog(surface); }}>Delete</Menu.Item>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

/**
 * The Pages overlay's content (spec 5.3): search, the derived outline and the footer that adds a page, sheet or tab. A row picks
 * a page; its More menu renames, duplicates, opens settings or deletes it.
 */
export default function PagesPanel({ document, current, onPick, actions = {}, ws }: { document: CompositionDocument; current: SurfaceRef | undefined; onPick: (surface: SurfaceRef) => void; actions?: PagesActions; ws?: Workspace2 }) {
  const outline = useMemo(() => buildOutline(document), [document]);
  const [query, setQuery] = useState('');
  const [viewId, setViewId] = useState('pages');
  const same = (surface: SurfaceRef) => current?.kind === surface.kind && current.id === surface.id;
  const matches = (row: OutlineRow, needle: string): boolean => !needle || row.title.toLowerCase().includes(needle) || row.children.some(child => matches(child, needle));
  const render = (row: OutlineRow, depth: number, needle: string): ReactNode => !matches(row, needle) ? null : <li key={`${row.surface.kind}:${row.surface.id}`}>
    <div className="w2-page-item">
      <button type="button" className="w2-page-row" style={{ paddingInlineStart: 12 + depth * 18 }} data-current={same(row.surface) || undefined}
        aria-current={same(row.surface) ? 'page' : undefined} onClick={() => onPick(row.surface)}>
        <Icon name={row.icon} size={18}/>
        <span className="w2-page-text"><span className="w2-page-title">{row.title}</span>{row.via && <span className="w2-page-via">{row.via}</span>}</span>
        {row.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}
      </button>
      <RowMenu document={document} row={row} actions={actions}/>
    </div>
    {row.children.length > 0 && <ul>{row.children.map(child => render(child, depth + 1, needle))}</ul>}
  </li>;
  const heading = (group: OutlineGroup) => group.id === 'tabs' && actions.onTabs
    ? <h3 className="w2-group-title"><button type="button" className="w2-group-button" onClick={() => { actions.onTabs?.(); actions.onDismiss?.(); }}>{group.title}</button></h3>
    : <h3 className="w2-group-title">{group.title}</h3>;
  const views: PagesView[] = [{
    id: 'pages', title: 'Pages', render: text => {
      const needle = text.trim().toLowerCase();
      const groups = outline.groups.map(group => ({ ...group, rows: group.rows.filter(row => matches(row, needle)) })).filter(group => group.rows.length);
      return groups.length === 0 ? <p className="w2-empty">{needle ? 'No pages match.' : 'No sheets yet.'}</p> : groups.map(group => <section key={group.id} aria-label={group.title}>
        {heading(group)}
        <ul>{group.rows.map(row => render(row, 0, needle))}</ul>
      </section>);
    },
  }];
  if (ws) views.push({ id: 'this-page', title: 'This Page', render: () => <ThisPage ws={ws} onPick={actions.onDismiss}/> });
  const view = views.find(item => item.id === viewId) ?? views[0];
  return <div className="w2-pages">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find a page" aria-label="Find a page" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {views.length > 1 && <div className="w2-segment-pill w2-pages-views" role="radiogroup" aria-label="View">
      {views.map(item => <button key={item.id} type="button" role="radio" aria-checked={item.id === view.id} onClick={() => setViewId(item.id)}>{item.title}</button>)}
    </div>}
    <div className="w2-pages-scroll">{view.render(query)}</div>
    <PagesFooter onDismiss={actions.onDismiss}/>
  </div>;
}
