import type { CompositionDocument, CompositionGroups } from '../shared/composition/schema';

type Page = CompositionDocument['pages'][number];

/**
 * Whether the tab navigator hides while a page is on top of the selected stack (`ServerUIChromeHide.hidesTabs`, `sh.page-chrome-hide@1` and
 * `sh.tabs-visibility@1`): the page hides it itself, or the document shows it on a root page only and the page is pushed.
 * `depth` is how many pages sit below the page in its stack; 0 is a root page.
 */
export function hidesTabs(hides: Page['hides'], visibility: CompositionDocument['navigation']['tabsVisibility'], depth: number): boolean {
  if (hides?.tabs === true) return true;
  return visibility === 'root-only' && depth > 0;
}

/**
 * The chrome groups a page shows at `depth` (proposal `global-chrome`, section 2). An item is hidden when either the app or the page says so: the
 * app by `visibility: root-only` on a pushed page, the page by naming it in `hides.items` (`ServerUIChromeHide.groups`). The shell menu cannot be
 * hidden by a page, a page that replaces the toolbar has no inherited items to drop, and a group left with no item is dropped. Back and a sheet's
 * Close are not items of any group, so nothing here can name them.
 */
export function chromeGroups(document: CompositionDocument, page: Page, depth: number): CompositionGroups {
  const own = page.toolbar.type === 'replace' ? page.toolbar.groups : undefined;
  const groups: CompositionGroups = own ?? document.navigation.chrome.groups;
  const dropped = new Set(own ? [] : page.hides?.items ?? []);
  const shown = (item: CompositionGroups[number]['items'][number]) => {
    if (item.type === 'shell-menu') return true;
    if (item.visibility === 'root-only' && depth > 0) return false;
    return !dropped.has(item.id);
  };
  return groups.map(group => ({ ...group, items: group.items.filter(shown) })).filter(group => group.items.length > 0);
}
