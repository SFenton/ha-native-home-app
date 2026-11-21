import type { CompositionDocument } from '../../shared/composition/schema';

/**
 * What a page hides and where the app shows its chrome (proposal `build/design/global-chrome/proposal.md` in native-home, section 2). Pure and free of the outline, so the
 * outline's "Hides N" tag and the editor's rules read the same answer.
 */

type Page = CompositionDocument['pages'][number];
/** Where the app shows an item: on every page, or on a tab's first page only. */
export type Where = 'every' | 'first';

/** One app chrome item the app panel and a page's "Hide on this page" group list: the Quick Links and Profile pair, or a header button. The shell menu is not one: it cannot be hidden. */
export interface ChromeItem { id: string; type: 'button' | 'shell-header'; name: string; /** Where the app shows it. */ shows: Where }

/** The app's chrome items a page may hide: the `shell-header`, then each `button` in the order the header lists them. */
export function chromeItems(document: CompositionDocument): ChromeItem[] {
  const items: ChromeItem[] = [];
  for (const group of document.navigation.chrome.groups) for (const item of group.items) {
    if (item.type === 'shell-menu') continue;
    items.push({ id: item.id, type: item.type, name: item.type === 'shell-header' ? 'Quick Links and Profile' : item.label || 'Button', shows: item.visibility === 'root-only' ? 'first' : 'every' });
  }
  // Quick Links and Profile leads, the buttons follow in header order (proposal section 2: "Tabs · Quick Links and Profile · <button>").
  return [...items.filter(item => item.type === 'shell-header'), ...items.filter(item => item.type === 'button')];
}

/** Where the app shows the tab bar: every page unless `navigation.tabsVisibility` says the root only. */
export const tabsShow = (document: CompositionDocument): Where => document.navigation.tabsVisibility === 'root-only' ? 'first' : 'every';

/** What a page hides, whole: the tab bar and the item ids. Items the app no longer has are kept (the compiler names them). */
export function pageHides(page: Pick<Page, 'hides'>): { tabs: boolean; items: string[] } {
  return { tabs: page.hides?.tabs === true, items: [...(page.hides?.items ?? [])] };
}

/**
 * Whether a page is the first page of a tab: the one place the app's "First page only" items do show. A document with no tabs has one first page, `initialPageId`,
 * which is where the preview draws those items.
 */
export const isTabFirstPage = (document: CompositionDocument, page: Pick<Page, 'id'>): boolean =>
  document.navigation.tabs.length === 0 ? page.id === document.navigation.initialPageId : document.navigation.tabs.some(tab => tab.pageId === page.id);

/**
 * How many things a page hides that are in force: the tab bar, unless the app already hides it there (`First page only` on a page that is not a tab's first); and each header button
 * or Quick Links and Profile the app still has, unless the app already hides it there. A page with Custom header buttons has none of the app's items to hide, so its list counts nothing.
 * An id the app no longer lists counts nothing (the compiler names it).
 */
export function hidesInForce(document: CompositionDocument, page: Pick<Page, 'id' | 'hides' | 'toolbar'>): number {
  const hides = pageHides(page), root = isTabFirstPage(document, page);
  const tabs = hides.tabs && !(tabsShow(document) === 'first' && !root) ? 1 : 0;
  if (page.toolbar.type === 'replace') return tabs;
  const have = new Map(chromeItems(document).map(item => [item.id, item]));
  const items = new Set(hides.items.filter(id => { const item = have.get(id); return item !== undefined && !(item.shows === 'first' && !root); }));
  return tabs + items.size;
}
