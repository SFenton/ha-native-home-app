import type { CompositionDocument } from '../../shared/composition/schema';
import { PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY, SHEET_LEVELS_CAPABILITY, TABS_VISIBILITY_CAPABILITY } from '../../shared/composition/global-chrome';
import { pendingCompositionCapabilities } from '../../shared/composition/pending';
import { collectLinks, levelOwners } from '../outline';
import { chromeItems, hidesInForce, isTabFirstPage, pageHides, tabsShow, type ChromeItem, type Where } from './hidesInForce';
import { wideOpenOf, type WideOpen } from '../../preview2/wide-open';

/**
 * The rules behind the editor's global-chrome rows (proposal `build/design/global-chrome/proposal.md` in native-home, sections 2, 3 and 5): what a page hides for itself,
 * the app panel's result line, how a page opens in a wide window, and the words a link's result takes. Pure: no React and no I/O, so each is tested alone.
 */

type Page = CompositionDocument['pages'][number];
export { chromeItems, hidesInForce, isTabFirstPage, pageHides, tabsShow };
export type { ChromeItem, Where };

/** What the editor says under a row that writes a capability the app has not shipped yet. */
export const NEWER_APP_CAPTION = 'Needs a newer app. Publishing it waits for an app update.';
/** The short form, for a library row that has no room for the whole caption. */
export const NEWER_APP_WORDS = 'Needs a newer app';
/** The footer of "Hide on this page". */
export const HIDE_FOOTER = 'Hidden on this page only. Other pages follow the app.';
/** The footer under the app panel's Show rows. */
export const SHOW_FOOTER = 'Every page: a page shows this however it is opened, at any depth. Sheets and modals never show it. A page can hide it for itself.';

/** Whether the app has not shipped `capability` yet, so the rows that write it say "Needs a newer app". The caption goes when the id leaves the pending list. */
export const isPending = (capability: string): boolean => pendingCompositionCapabilities.includes(capability);
/** The caption a row that writes `capability` carries, or none once it ships. */
export const newerAppCaption = (capability: string): string | undefined => isPending(capability) ? NEWER_APP_CAPTION : undefined;
export { PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY, SHEET_LEVELS_CAPABILITY, TABS_VISIBILITY_CAPABILITY };

// MARK: Chrome items

/** A button's name in the "Hide on this page" group and the app panel: "Alerts (button)"; Tabs and Quick Links and Profile are named as they are. */
export const itemRowName = (item: ChromeItem): string => item.type === 'button' ? `${item.name} (button)` : item.name;

// MARK: What a page hides

/** The page with its `hides` set from `next`; the key is removed when nothing is hidden, and `items` when it is empty. Pure: the page is not changed. */
export function withHides<T extends Page>(page: T, next: { tabs: boolean; items: readonly string[] }): T {
  const { hides: _old, ...rest } = page;
  if (!next.tabs && next.items.length === 0) return rest as T;
  return { ...rest, hides: { ...(next.tabs ? { tabs: true } : {}), ...(next.items.length ? { items: [...next.items] } : {}) } } as T;
}

/** The document with the page at `index` hiding (or showing) the tab bar. */
export function setHideTabs(document: CompositionDocument, index: number, on: boolean): CompositionDocument {
  return setPage(document, index, page => withHides(page, { ...pageHides(page), tabs: on }));
}

/** The document with the page at `index` hiding (or showing) one chrome item. The order the items were hidden in is kept. */
export function setHideItem(document: CompositionDocument, index: number, id: string, on: boolean): CompositionDocument {
  return setPage(document, index, page => {
    const hides = pageHides(page);
    const items = on ? (hides.items.includes(id) ? hides.items : [...hides.items, id]) : hides.items.filter(item => item !== id);
    return withHides(page, { tabs: hides.tabs, items });
  });
}

/** The page with no hidden items: a page that replaces the toolbar has none to drop, and the compiler refuses the list (`hides/items`). It may still hide the tab bar. */
export function withoutHiddenItems<T extends Page>(page: T): T {
  return withHides(page, { tabs: pageHides(page).tabs, items: [] });
}

function setPage(document: CompositionDocument, index: number, change: (page: Page) => Page): CompositionDocument {
  const page = document.pages[index];
  if (!page) return document;
  return { ...document, pages: document.pages.map((item, at) => at === index ? change(item) : item) };
}

/** One row of a page's "Hide on this page" group. */
export interface HideRow {
  /** `tabs`, or the chrome item's id. */
  id: string;
  label: string;
  /** Whether the switch is on: the page hides it. Always off when the app already shows the item on the first page only. */
  on: boolean;
  /** Whether the switch cannot change: the app already shows the row on the first page only. */
  disabled: boolean;
  /** The caption under a disabled row. */
  caption?: string;
}

/** The caption under a row the app already hides on a pushed page. */
export const FIRST_PAGE_ONLY = 'First page only';

/**
 * The rows of "Hide on this page" for a page (a page with Custom shows only the Tabs row). A row the app shows on "First page only" is off, disabled and captioned on a page
 * that is not a tab's first page, where the app already hides it. On a tab's first page the app shows it, so the page may hide it: an ordinary switch that shows what `hides` says.
 */
export function hideRows(document: CompositionDocument, page: Page): HideRow[] {
  const hides = pageHides(page);
  const root = isTabFirstPage(document, page);
  const tabsFirst = tabsShow(document) === 'first' && !root;
  const rows: HideRow[] = [{ id: 'tabs', label: 'Tabs', on: hides.tabs && !tabsFirst, disabled: tabsFirst, caption: tabsFirst ? FIRST_PAGE_ONLY : undefined }];
  if (page.toolbar.type === 'replace') return rows;
  for (const item of chromeItems(document)) {
    const first = item.shows === 'first' && !root;
    rows.push({ id: item.id, label: itemRowName(item), on: hides.items.includes(item.id) && !first, disabled: first, caption: first ? FIRST_PAGE_ONLY : undefined });
  }
  return rows;
}

// MARK: The app panel's result line

/** What the app panel's result line counts. */
export interface ChromeSummary {
  /** Rows (Tabs, Quick Links and Profile, each button) shown on every page. */
  every: number;
  /** Rows shown on the first page only. */
  first: number;
  /** The pages that hide something, with how much. */
  hidden: { id: string; title: string; count: number }[];
}

/** Counts the Show rows and the pages that hide, for the line under the Show rows. */
export function chromeSummary(document: CompositionDocument): ChromeSummary {
  const rows: Where[] = [tabsShow(document), ...chromeItems(document).map(item => item.shows)];
  return {
    every: rows.filter(row => row === 'every').length, first: rows.filter(row => row === 'first').length,
    hidden: document.pages.map(page => ({ id: page.id, title: page.title, count: hidesInForce(document, page) })).filter(page => page.count > 0),
  };
}

/** "2 shown on every page · 1 on the first page only · Hidden on 3 pages": a part that counts nothing is left out. The last part is {@link hiddenWords}. */
export function resultParts(summary: ChromeSummary): string[] {
  const parts = [`${summary.every} shown on every page`];
  if (summary.first > 0) parts.push(`${summary.first} on the first page only`);
  if (summary.hidden.length > 0) parts.push(hiddenWords(summary.hidden.length));
  return parts;
}

/** "Hidden on 3 pages": the count that opens the list of pages. */
export const hiddenWords = (count: number): string => `Hidden on ${count} ${count === 1 ? 'page' : 'pages'}`;

// MARK: In a wide window

/** The three ways a page opens in a wide window, in the words of the row. */
export const wideChoices = [{ value: 'automatic', label: 'Automatic' }, { value: 'full', label: 'Full width' }, { value: 'beside', label: 'Beside' }] as const;
export type { WideOpen };
export { wideOpenOf };

/** The footer under each choice (proposal section 5). */
export const wideFooters: Record<WideOpen, string> = {
  automatic: 'Beside the page it came from when that page opens pages beside it, otherwise full width. Used when the window is wide enough for two.',
  full: 'Always the whole window. Back returns to the page it came from.',
  beside: 'Always beside the page it came from. That page takes the left half.',
};

/**
 * The page opening the way `value` says. `standalone` is cleared on a columns page, because the choice now says what it said; Automatic on a page that never said writes
 * nothing, so a document that does not use the setting does not need the capability.
 */
export function setWideOpen(document: CompositionDocument, index: number, value: WideOpen): CompositionDocument {
  return setPage(document, index, page => {
    const { wideOpen: _old, ...rest } = page;
    const navigation = rest.navigation.type === 'navigation-columns' && rest.navigation.standalone ? { ...rest.navigation, standalone: false } : rest.navigation;
    const stays = page.wideOpen === undefined && value === 'automatic' && wideOpenOf(page) === 'automatic';
    return (stays ? page : { ...rest, navigation, wideOpen: value }) as Page;
  });
}

/** The value a new page starts on: Automatic, written only once the app has shipped `sh.page-wide-open@1` (a field it does not know makes every publication refused). */
export const newPageWideOpen = (pending = isPending(PAGE_WIDE_OPEN_CAPABILITY)): { wideOpen: 'automatic' } | Record<string, never> => pending ? {} : { wideOpen: 'automatic' };

// MARK: Link results

/** The result line under a link's "Goes to": its bold lead and the rest. */
export interface LinkResult { lead: string; rest: string }

/** Where an action sits: a page, a sheet or a level of the document, by the first steps of its path. */
function surfaceOf(document: CompositionDocument, path: readonly (string | number)[]): { kind: 'page' | 'modal' | 'level'; id: string; title: string } | undefined {
  const [list, at] = path;
  if (typeof at !== 'number') return undefined;
  if (list === 'pages') { const page = document.pages[at]; return page && { kind: 'page', id: page.id, title: page.title }; }
  if (list === 'modals') { const modal = document.modals[at]; return modal && { kind: 'modal', id: modal.id, title: modal.title }; }
  if (list === 'levels') { const level = document.levels?.[at]; return level && { kind: 'level', id: level.id, title: level.title }; }
  return undefined;
}

/** The title of the sheet a level belongs to: the sheet whose links reach it, directly or through another level (the first sheet that does). */
export function sheetOfLevel(document: CompositionDocument, levelId: string): string | undefined {
  const sheet = [...levelOwners(document).bySheet].find(([, ids]) => ids.includes(levelId))?.[0];
  return document.modals.find(modal => modal.id === sheet)?.title;
}

/**
 * What a link's "Goes to" does, in the proposal's words (section 3), for the action at `path` that goes to a page, a level, a sheet or a modal. Only a link in a sheet or a level has a result
 * to say for a page; a link to a sheet or a modal always has one. A link from a page to a page is the plain push and says nothing.
 */
export function linkResult(document: CompositionDocument, path: readonly (string | number)[], target: { kind: 'page' | 'modal'; id: string }): LinkResult | undefined {
  const from = surfaceOf(document, path);
  if (target.kind === 'modal') {
    const modal = document.modals.find(item => item.id === target.id);
    if (!modal) return undefined;
    return modal.presentation.fullScreen ? { lead: `Opens ${modal.title} full screen.`, rest: '' } : { lead: `Opens the ${modal.title} sheet.`, rest: '' };
  }
  const level = (document.levels ?? []).find(item => item.id === target.id);
  const page = document.pages.find(item => item.id === target.id);
  const inSheet = from?.kind === 'modal' || from?.kind === 'level';
  if (level) {
    if (!inSheet) return undefined;
    const sheet = from.kind === 'modal' ? from.title : sheetOfLevel(document, from.id);
    return { lead: 'Stays in this sheet.', rest: sheet ? `${level.title} is a level of ${sheet}.` : `${level.title} is a level of this sheet.` };
  }
  if (!page || !inSheet) return undefined;
  return { lead: `Opens the ${page.title} page.`, rest: 'The sheet closes first. Back returns to the page under the sheet.' };
}

// MARK: Checks

/** A row a check adds: its id, its sentence, the page it names. */
export interface ChromeCheck { id: string; sentence: string; page: Page }

/** Pages the app's first page of a tab: the page a tab opens. */
const tabPages = (document: CompositionDocument): Set<string> => new Set(document.navigation.tabs.map(tab => tab.pageId));

/**
 * The warning for a tab's first page that hides Tabs (proposal section 2). It stays quiet only when the page has a way on to another tab: a link that switches tab, or a link to
 * another page that will show Tabs (the app shows them on every page and that page does not hide them).
 */
export function tabsHiddenOnFirstPage(document: CompositionDocument): ChromeCheck[] {
  const roots = tabPages(document);
  const links = collectLinks(document);
  const tabsEverywhere = tabsShow(document) === 'every';
  const leadsToTabs = (link: ReturnType<typeof collectLinks>[number], from: string) => link.to.kind === 'tab'
    || (link.to.kind === 'page' && link.to.id !== from && tabsEverywhere && document.pages.some(page => page.id === link.to.id && page.hides?.tabs !== true));
  return document.pages.filter(page => roots.has(page.id) && page.hides?.tabs === true
    && !links.some(link => link.from.kind === 'page' && link.from.id === page.id && leadsToTabs(link, page.id))).map(page => ({
    id: `tabs-hidden-${page.id}`, page,
    sentence: `Tabs are hidden on ${page.title}, the first page of a tab, so nothing on it leads to another tab. Show Tabs there, or add a button that goes to another page.`,
  }));
}

/** The warning for a page with Custom header buttons and no Quick Links and Profile among them. Sheets and modals never show it, so they are not asked. */
export function customWithoutQuickLinks(document: CompositionDocument): ChromeCheck[] {
  if (!chromeItems(document).some(item => item.type === 'shell-header')) return [];
  return document.pages.filter(page => page.toolbar.type === 'replace' && !page.toolbar.groups.some(group => group.items.some(item => item.type === 'shell-header'))).map(page => ({
    id: `custom-no-quick-links-${page.id}`, page,
    sentence: `${page.title}: Custom has no Quick Links and Profile, so this page will not show them. Add them, or choose Same as app.`,
  }));
}

/** The note for the app showing Quick Links and Profile on the first page of each tab only. */
export function quickLinksFirstPageOnly(document: CompositionDocument): string | undefined {
  return chromeItems(document).some(item => item.type === 'shell-header' && item.shows === 'first') ? 'Quick Links and Profile show on the first page of each tab only.' : undefined;
}
