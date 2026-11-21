import { useMemo, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChangeListIconItem } from './ListIconPicker';
import { AlertTriangle, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { GlyphByName } from '../preview2/nodes/shared';
import { buildOutline, libraryGroups, matchGroups, surfaceWord, type LibraryRow, type ListKind, type SurfaceRef } from './outline';
import { categoryInfo } from './LibraryRail';
import { categoryOfSurface } from './useLibraryTrail';
import { selectionKey } from '../preview2/model';
import type { TreeCategory } from './layout';
import { Tag } from './kit';
import type { Workspace2 } from './useWorkspace2';
import { askFirstLevel, createLevel, createPage, createSheet, createTab, deleteLevelDialog, deleteSurfaceDialog, renameLevelDialog, renameSurfaceDialog } from './navigation/controller';
import { duplicateSurface, moveToPages, moveToSheets, tabRoom } from './navigation/edit';
import { isPending, NEWER_APP_WORDS, SHEET_LEVELS_CAPABILITY } from './navigation/chromeRules';

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
  /** Says a line the person has to read: why "Move to Sheets" was refused. */
  onNotice?: (text: string) => void;
}

/** The overlay's footer: "Page", "Sheet" and "Tab", each with a plus, each opening the one creation dialog (spec 5.6). */
const scopes: readonly ListKind[] = ['tabs', 'pages', 'sheets', 'modals'];

export function PagesFooter({ onDismiss, tabReason, levelSheet, levelWord, notice }: {
  /** The line a refused move says: it sticks with the footer, so it is never below the fold of the sheet. */ notice?: string;
  onDismiss?: () => void; /** Why no tab can be added, when the bar is full; it shows beside the disabled Tab button. */ tabReason?: string;
  /** On a Sheets or Modals list: the sheet on show, which "Level" adds a level to (null while none is, so the button is disabled). Undefined elsewhere: no Level button. */ levelSheet?: { id: string; title: string } | null; /** "sheet" or "modal": the word the level note uses. */ levelWord?: 'sheet' | 'modal';
}) {
  const open = (start: () => Promise<string | undefined>) => () => { onDismiss?.(); void start(); };
  return <footer className="w2-pages-foot" aria-label="Add">
    {notice && <p role="status" className="w2-pages-notice" data-refusal><AlertTriangle size={14} className="w2-tone-warning" aria-hidden/>{notice}</p>}
    <button type="button" onClick={open(() => createPage())}><Plus size={14} aria-hidden/>Page</button>
    <button type="button" onClick={open(() => createSheet())}><Plus size={14} aria-hidden/>Sheet</button>
    <button type="button" disabled={Boolean(tabReason)} aria-describedby={tabReason ? 'w2-pages-tab-reason' : undefined} onClick={open(() => createTab())}><Plus size={14} aria-hidden/>Tab</button>
    {levelSheet !== undefined && <button type="button" disabled={levelSheet === null} aria-describedby={levelSheet === null ? 'w2-pages-level-reason' : undefined} title={levelSheet ? `Add a level to ${levelSheet.title}` : undefined} onClick={() => { if (levelSheet) { onDismiss?.(); void createLevel(levelSheet.id); } }}><Plus size={14} aria-hidden/>Level</button>}
    {tabReason && <p id="w2-pages-tab-reason" className="w2-caption w2-pages-foot-reason">{tabReason}</p>}
    {levelSheet === null && <p id="w2-pages-level-reason" className="w2-caption w2-pages-foot-reason">{LEVEL_REASON}</p>}
    {levelSheet !== undefined && <p className="w2-caption w2-pages-foot-reason">{levelFooter(levelWord)}</p>}
  </footer>;
}

/**
 * The library panel's footer for a list (studio-ux2 lib3, L-tax): Tabs adds a tab and opens the Tabs panel, Pages adds a page, Sheets a sheet
 * and Modals a modal. Each opens the one creation dialog.
 */
export function LibraryFooter({ scope, tabReason, onEditTabs, disabled, sheet }: {
  scope: TreeCategory; tabReason?: string; onEditTabs?: () => void; /** Use mode: the buttons stay where they are, disabled. */ disabled?: boolean;
  /** The sheet or modal on show, which "+ Level" adds a level to; without one the button is disabled. */ sheet?: { id: string; title: string };
}) {
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
    {(scope === 'sheets' || scope === 'modals') && <>
      <button type="button" disabled={disabled || !sheet} aria-describedby={sheet ? 'w2-lib-level-note' : 'w2-lib-level-reason w2-lib-level-note'} title={sheet ? `Add a level to ${sheet.title}` : undefined} onClick={() => { if (sheet) void createLevel(sheet.id); }}><Plus size={14} aria-hidden/>Level</button>
      {!sheet && <p id="w2-lib-level-reason" className="w2-caption w2-pages-foot-reason">{LEVEL_REASON}</p>}
      <p id="w2-lib-level-note" className="w2-caption w2-lib-level-note">{levelFooter(scope === 'modals' ? 'modal' : 'sheet')}</p>
    </>}
  </footer>;
}

/** The Sheets and Modals footer's line about levels (proposal section 3). */
export const levelFooter = (word: 'sheet' | 'modal' = 'sheet') => `A level opens inside its ${word}, with Back and Close. Move it to Pages and it opens as a page, with the tabs and header buttons.`;
/** Why "+ Level" is disabled: it adds to the sheet on show. */
export const LEVEL_REASON = 'Choose a sheet first';

/** "Move to Sheets" for the page: the document with it a level, the refusal said, or (for the document's first level) the question first. One undo step. */
function moveToSheetsAction(document: CompositionDocument, id: string, actions: PagesActions) {
  const moved = moveToSheets(document, id);
  // The first level changes what every sheet's push does: the Studio asks, and the answer applies the move (`NavigationHost`).
  if (!moved.ok && moved.first) { askFirstLevel(id, () => actions.onDismiss?.()); return; }
  // A refusal keeps the Pages sheet open, so its line is read where it was caused; a move closes it, as every other row action does.
  if (moved.ok) { actions.onDismiss?.(); actions.onChange?.(moved.document); } else actions.onNotice?.(moved.reason);
}

/** "Move to Pages" for the level: the document with it a page, or the refusal said (the sheet stays open, as for Move to Sheets). */
function moveToPagesAction(document: CompositionDocument, id: string, actions: PagesActions) {
  const moved = moveToPages(document, id);
  if (moved.ok) { actions.onDismiss?.(); actions.onChange?.(moved.document); } else actions.onNotice?.(moved.reason);
}

/** The items of a level's menu: Rename, Move to Pages, Delete. A level has no settings page of its own, so it has no duplicate or icon either. */
export function LevelMenuItems({ document, levelId, actions }: { document: CompositionDocument; levelId: string; actions: PagesActions }) {
  return <>
    <Menu.Item className="w2-menu-item" onClick={() => { actions.onDismiss?.(); renameLevelDialog(levelId); }}>Rename</Menu.Item>
    <Menu.Item className="w2-menu-item" onClick={() => moveToPagesAction(document, levelId, actions)}>Move to Pages</Menu.Item>
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item w2-danger-item" onClick={() => { actions.onDismiss?.(); deleteLevelDialog(levelId); }}>Delete</Menu.Item>
  </>;
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
    {surface.kind === 'page' && <Menu.Item className="w2-menu-item" onClick={() => moveToSheetsAction(document, surface.id, actions)}>Move to Sheets</Menu.Item>}
    <ChangeListIconItem rowKey={selectionKey(surface.kind, surface.id)}/>
    <Menu.Separator className="w2-menu-sep"/>
    <Menu.Item className="w2-menu-item w2-danger-item" disabled={last} onClick={() => { actions.onDismiss?.(); deleteSurfaceDialog(surface); }}>Delete</Menu.Item>
  </>;
}

/** A row's More menu. */
export function RowMenu({ document, surface, title, actions, className = 'w2-icon-button', level }: { document: CompositionDocument; surface: SurfaceRef; title: string; actions: PagesActions; className?: string; /** The level's id when the row is a level: its menu is Rename, Move to Pages, Delete. */ level?: string }) {
  // A long list holds a menu per row; each is built on its first press, so a change to the document does not pay for all of them.
  const [armed, setArmed] = useState(false), [open, setOpen] = useState(false);
  if (!armed) return <button type="button" className={className} aria-label={`More for ${title}`} aria-haspopup="menu" aria-expanded="false" onClick={() => { setArmed(true); setOpen(true); }}><MoreHorizontal size={18} aria-hidden/></button>;
  return <Menu.Root open={open} onOpenChange={setOpen}>
    <Menu.Trigger className={className} aria-label={`More for ${title}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
    <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
      {level ? <LevelMenuItems document={document} levelId={level} actions={actions}/> : <SurfaceMenuItems document={document} surface={surface} actions={actions}/>}
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
  const [notice, setNotice] = useState<string>();
  // Opens on the list that holds the page or sheet on show, so the row for "here" is in view.
  const [scope, setScope] = useState<ListKind>(() => current ? categoryOfSurface(document, selectionKey(current.kind, current.id)) : 'tabs');
  const groups = useMemo(() => libraryGroups(document, scope), [document, scope]);
  const same = (surface: SurfaceRef) => current?.kind === surface.kind && current.id === surface.id;
  const say: PagesActions = { ...actions, onChange: next => { setNotice(undefined); actions.onChange?.(next); }, onNotice: text => { setNotice(text); actions.onNotice?.(text); } };
  const newerApp = isPending(SHEET_LEVELS_CAPABILITY) ? NEWER_APP_WORDS : undefined;
  const render = (row: LibraryRow, depth = 0): ReactNode => <li key={row.key}>
    <div className="w2-page-item">
      <button type="button" className="w2-page-row" style={{ paddingInlineStart: 16 + depth * 16 }} data-current={(!row.level && same(row.surface)) || undefined}
        aria-current={!row.level && same(row.surface) ? 'page' : undefined} onClick={() => { setNotice(undefined); if (!row.level || row.level.sheetId) onPick(row.surface); }}>
        <GlyphByName name={row.icon} size={18}/>
        <span className="w2-page-text"><span className="w2-page-title">{row.title}</span>{(row.level ? newerApp : row.via) && <span className="w2-page-via">{row.level ? newerApp : row.via}</span>}</span>
        {row.tags.map(tag => <Tag key={tag} tone={tag === 'No Way In' ? 'warning' : 'neutral'}>{tag}</Tag>)}
      </button>
      <RowMenu document={document} surface={row.surface} title={row.title} actions={say} level={row.level?.id}/>
    </div>
    {row.levels && row.levels.length > 0 && <ul>{row.levels.map(level => render(level, depth + 1))}</ul>}
  </li>;
  // The tab bar's heading keeps its count ("Tabs · 3 of 5") and still opens the Tabs panel.
  const tabsTitle = useMemo(() => buildOutline(document).groups.find(group => group.id === 'tabs')?.title ?? 'Tabs', [document]);
  const tabsHeading = actions.onTabs
    ? <h3 className="w2-group-title"><button type="button" className="w2-group-button" onClick={() => { actions.onTabs?.(); actions.onDismiss?.(); }}>{tabsTitle}</button></h3>
    : <h3 className="w2-group-title">{tabsTitle}</h3>;
  const noun = scope === 'tabs' ? 'tab' : scope === 'pages' ? 'page' : scope === 'sheets' ? 'sheet' : 'modal';
  const list = (text: string): ReactNode => {
    const needle = text.trim().toLowerCase();
    const shown = matchGroups(groups, needle);
    return shown.length === 0 ? <p className="w2-empty">{needle ? `No ${noun}s match.` : `No ${noun}s yet.`}</p> : shown.map(group => <section key={group.id} aria-label={group.title}>
      {scope === 'tabs' ? tabsHeading : <h3 className="w2-group-title">{group.title}</h3>}
      <ul>{group.rows.map(row => render(row))}</ul>
    </section>);
  };
  return <div className="w2-pages" onPointerDownCapture={() => setNotice(undefined)} onKeyDownCapture={() => setNotice(undefined)}>
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder={`Find a ${noun}`} aria-label={`Find a ${noun}`} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className="w2-pages-scope" role="group" aria-label="List">
      {scopes.map(item => <button key={item} type="button" aria-pressed={scope === item} onClick={() => setScope(item)}>{categoryInfo[item].label}</button>)}
    </div>
    <div className="w2-pages-scroll">{list(query)}</div>
    <PagesFooter notice={notice} onDismiss={actions.onDismiss} tabReason={tabRoom(document).reason} levelWord={scope === 'modals' ? 'modal' : 'sheet'} levelSheet={scope === 'sheets' || scope === 'modals' ? (() => { const sheet = current?.kind === 'modal' ? document.modals.find(item => item.id === current.id) : undefined; return sheet ? { id: sheet.id, title: sheet.title } : null; })() : undefined}/>
  </div>;
}
