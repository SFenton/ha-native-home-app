import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { standaloneToWideOpen } from '../src/shared/composition/migrate';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { runChecks, sentenceFor } from '../src/workspace2/checks';
import { buildOutline, hideCount } from '../src/workspace2/outline';
import { blankPage } from '../src/workspace2/navigation/edit';
import {
  chromeItems, chromeSummary, customWithoutQuickLinks, hideRows, hiddenWords, linkResult, newPageWideOpen, newerAppCaption, quickLinksFirstPageOnly,
  resultParts, setHideItem, setHideTabs, setWideOpen, sheetOfLevel, tabsHiddenOnFirstPage, tabsShow, wideOpenOf, withHides, withoutHiddenItems,
  PAGE_CHROME_HIDE_CAPABILITY, PAGE_WIDE_OPEN_CAPABILITY,
} from '../src/workspace2/navigation/chromeRules';

type J = Record<string, any>;

// MARK: - Fixtures (made-up names; ids with the demo_ prefix)

const header = (visibility = 'always'): J => ({
  id: 'demo_quick', type: 'shell-header', visibility,
  quickLinksAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }, profileAction: { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' },
});
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
/** The first-slice document with a Quick Links and Profile pair added to the header: tabs `page-orbit` and `page-lattice`, buttons `chrome-inspect` (first page only) and `chrome-palette`. */
function base(): J {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  // The contract holds Quick Links and Profile alone in the one trailing group.
  const groups = document.navigation.chrome.groups;
  groups[0].items.push(...groups[1].items);
  groups[1].items = [header()];
  return document;
}
const as = (document: J) => document as CompositionDocument;
/** A level, taken from page-echo. */
function levelOf(document: J, id: string): J {
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  return { ...surface, id, title: 'Demo Level', toolbar: { type: 'replace', groups: [] }, components: [{ ...surface.components[0], id: `${id}_text` }] };
}
const compiles = (document: J) => { try { compileCompositionDocument(document); return true; } catch (error) { if (error instanceof CompositionValidationError) return false; throw error; } };

// MARK: - What a page hides

describe('chrome items and what a page hides', () => {
  it('lists the buttons and the Quick Links and Profile pair, never the shell menu', () => {
    expect(chromeItems(as(base())).map(item => [item.id, item.name, item.shows])).toEqual([['demo_quick', 'Quick Links and Profile', 'every'], ['chrome-inspect', 'Inspect', 'first'], ['chrome-palette', 'Palette', 'every']]);
  });

  it('writes hides, and removes the key when nothing is hidden', () => {
    let document = as(base());
    document = setHideTabs(document, 0, true);
    expect(document.pages[0].hides).toEqual({ tabs: true });
    document = setHideItem(document, 0, 'demo_quick', true);
    document = setHideItem(document, 0, 'chrome-palette', true);
    expect(document.pages[0].hides).toEqual({ tabs: true, items: ['demo_quick', 'chrome-palette'] });
    expect(hideCount(document.pages[0])).toBe(3);
    document = setHideItem(document, 0, 'demo_quick', false);
    expect(document.pages[0].hides).toEqual({ tabs: true, items: ['chrome-palette'] });
    document = setHideTabs(document, 0, false);
    expect(document.pages[0].hides).toEqual({ items: ['chrome-palette'] });
    document = setHideItem(document, 0, 'chrome-palette', false);
    expect('hides' in document.pages[0]).toBe(false);
    expect(compiles(document as J)).toBe(true);
  });

  it('does not change its input, ignores a repeat, and leaves a missing page alone', () => {
    const document = as(base());
    const once = setHideItem(document, 1, 'chrome-palette', true);
    expect('hides' in document.pages[1]).toBe(false);
    expect(setHideItem(once, 1, 'chrome-palette', true).pages[1].hides).toEqual({ items: ['chrome-palette'] });
    expect(setHideTabs(document, 99, true)).toBe(document);
    expect(withHides(document.pages[0], { tabs: false, items: [] })).not.toHaveProperty('hides');
  });

  it('writes a document the compiler accepts, declaring the capability', () => {
    const document = setHideItem(setHideTabs(as(base()), 2, true), 2, 'demo_quick', true);
    expect(compileCompositionDocument(document as J).capabilities).toContain(PAGE_CHROME_HIDE_CAPABILITY);
  });

  it('drops the hidden items for Custom, which the compiler refuses beside them, and keeps the Tabs switch', () => {
    const hidden = setHideItem(setHideTabs(as(base()), 2, true), 2, 'chrome-palette', true);
    const custom = { ...hidden.pages[2], toolbar: { type: 'replace' as const, groups: [] } };
    expect(compiles({ ...hidden, pages: [...hidden.pages.slice(0, 2), custom] } as J)).toBe(false);
    const fixed = withoutHiddenItems(custom);
    expect(fixed.hides).toEqual({ tabs: true });
    expect(compiles({ ...hidden, pages: [...hidden.pages.slice(0, 2), fixed] } as J)).toBe(true);
    expect('hides' in withoutHiddenItems({ ...custom, hides: { items: ['chrome-palette'] } })).toBe(false);
  });
});

describe('the rows of Hide on this page', () => {
  it('Same as app: Tabs, Quick Links and Profile, and each button', () => {
    const document = as(base());
    expect(hideRows(document, document.pages[2]).map(row => [row.id, row.label, row.on, row.disabled, row.caption])).toEqual([
      ['tabs', 'Tabs', false, false, undefined],
      ['demo_quick', 'Quick Links and Profile', false, false, undefined],
      ['chrome-inspect', 'Inspect (button)', false, true, 'First page only'],
      ['chrome-palette', 'Palette (button)', false, false, undefined],
    ]);
  });

  it('on a tab\'s first page a First page only row is an ordinary switch that shows what hides says', () => {
    const document = setHideItem(as(base()), 0, 'chrome-inspect', true);
    expect(hideRows(document, document.pages[0]).find(item => item.id === 'chrome-inspect')).toEqual({ id: 'chrome-inspect', label: 'Inspect (button)', on: true, disabled: false, caption: undefined });
    const tabs = { ...document, navigation: { ...document.navigation, tabsVisibility: 'root-only' as const } };
    const hidden = setHideTabs(tabs, 0, true);
    expect(hideRows(hidden, hidden.pages[0])[0]).toMatchObject({ id: 'tabs', on: true, disabled: false });
  });

  it('a row the app shows on First page only is off, disabled and captioned, even when a hide was written for it', () => {
    const document = setHideItem(as(base()), 2, 'chrome-inspect', true);
    const row = hideRows(document, document.pages[2]).find(item => item.id === 'chrome-inspect');
    expect(row).toMatchObject({ on: false, disabled: true, caption: 'First page only' });
  });

  it('Tabs the app shows on the first page only is off and disabled', () => {
    const document = { ...setHideTabs(as(base()), 2, true), navigation: { ...base().navigation, tabsVisibility: 'root-only' as const } } as CompositionDocument;
    expect(tabsShow(document)).toBe('first');
    expect(hideRows(document, document.pages[2])[0]).toMatchObject({ id: 'tabs', on: false, disabled: true, caption: 'First page only' });
  });

  it('with Custom only the Tabs switch remains', () => {
    const document = as(base());
    const custom = { ...document.pages[2], toolbar: { type: 'replace' as const, groups: [] } };
    expect(hideRows(document, custom).map(row => row.id)).toEqual(['tabs']);
  });
});

// MARK: - The app panel's result line

describe('the app panel result line', () => {
  it('counts the Show rows and the pages that hide', () => {
    let document = as(base());
    expect(chromeSummary(document)).toEqual({ every: 3, first: 1, hidden: [] });
    expect(resultParts(chromeSummary(document))).toEqual(['3 shown on every page', '1 on the first page only']);
    document = setHideTabs(setHideTabs(setHideItem(document, 0, 'demo_quick', true), 1, true), 2, true);
    const summary = chromeSummary(document);
    expect(summary.hidden.map(page => [page.id, page.count])).toEqual([['page-orbit', 1], ['page-lattice', 1], ['page-echo', 1]]);
    expect(resultParts(summary)).toEqual(['3 shown on every page', '1 on the first page only', 'Hidden on 3 pages']);
  });

  it('counts Tabs on the first page only, leaves out a part that counts nothing, and says "1 page" once', () => {
    const document = as({ ...base(), navigation: { ...base().navigation, tabsVisibility: 'root-only' }, });
    const summary = chromeSummary(document);
    expect(summary).toMatchObject({ every: 2, first: 2 });
    const alone = chromeSummary(as({ ...base(), navigation: { ...base().navigation, chrome: { groups: [] } } }));
    expect(resultParts(alone)).toEqual(['1 shown on every page']);
    expect(hiddenWords(1)).toBe('Hidden on 1 page');
    expect(hiddenWords(3)).toBe('Hidden on 3 pages');
  });
});

describe('the library tag', () => {
  it('tags a page that hides "Hides 2", and no other', () => {
    const document = setHideItem(setHideTabs(as(base()), 2, true), 2, 'demo_quick', true);
    const rows = buildOutline(document).groups.flatMap(group => group.rows).flatMap(function walk(row): typeof row[] { return [row, ...row.children.flatMap(walk)]; });
    expect(rows.find(row => row.surface.id === 'page-echo')?.tags).toContain('Hides 2');
    expect(rows.filter(row => row.tags.some(tag => tag.startsWith('Hides'))).map(row => row.surface.id)).toEqual(['page-echo']);
  });
});

// MARK: - In a wide window

describe('how a page opens in a wide window', () => {
  const columns = (standalone: boolean): J => ({ ...base().pages[0], navigation: { type: 'navigation-columns', placeholder: 'Pick one', standalone } });

  it('reads Automatic for a page that says nothing, and Full width for the old "new column set"', () => {
    const document = as(base());
    expect(wideOpenOf(document.pages[0])).toBe('automatic');
    expect(wideOpenOf(columns(true) as CompositionDocument['pages'][number])).toBe('full');
    expect(wideOpenOf(columns(false) as CompositionDocument['pages'][number])).toBe('automatic');
    expect(wideOpenOf({ ...columns(true), wideOpen: 'beside' } as CompositionDocument['pages'][number])).toBe('beside');
  });

  it('writes the choice, declares the capability, and clears standalone on a columns page', () => {
    const document = { ...base(), pages: [columns(true), ...base().pages.slice(1)] } as CompositionDocument;
    const beside = setWideOpen(document, 0, 'beside');
    expect(beside.pages[0]).toMatchObject({ wideOpen: 'beside', navigation: { type: 'navigation-columns', standalone: false } });
    expect(compileCompositionDocument(beside as J).capabilities).toContain(PAGE_WIDE_OPEN_CAPABILITY);
    expect(setWideOpen(beside, 0, 'full').pages[0].wideOpen).toBe('full');
    expect(setWideOpen(as(base()), 1, 'full').pages[1].wideOpen).toBe('full');
  });

  it('Automatic on a page that never said writes nothing, so the project needs no newer app; once chosen away it can be chosen back', () => {
    const document = as(base());
    expect(setWideOpen(document, 1, 'automatic')).toEqual(document);
    expect(setWideOpen(setWideOpen(document, 1, 'beside'), 1, 'automatic').pages[1].wideOpen).toBe('automatic');
    // A standalone page choosing Automatic does write it: it said Full width before.
    const standalone = { ...base(), pages: [columns(true), ...base().pages.slice(1)] } as CompositionDocument;
    expect(setWideOpen(standalone, 0, 'automatic').pages[0]).toMatchObject({ wideOpen: 'automatic', navigation: { standalone: false } });
    expect(setWideOpen(document, 99, 'full')).toBe(document);
  });

  it('a new page starts on Automatic only once the app has the capability', () => {
    expect(pendingCompositionCapabilities).toContain(PAGE_WIDE_OPEN_CAPABILITY);
    expect(newPageWideOpen()).toEqual({});
    expect(newPageWideOpen(false)).toEqual({ wideOpen: 'automatic' });
    const document = as(base());
    expect('wideOpen' in blankPage(document, 'Demo')).toBe(false);
  });

  it('says "Needs a newer app" while the capability is pending, and not once it ships', () => {
    expect(newerAppCaption(PAGE_WIDE_OPEN_CAPABILITY)).toBe('Needs a newer app. Publishing it waits for an app update.');
    expect(newerAppCaption('sh.composition@1')).toBeUndefined();
  });

  it('the migration already writes wideOpen "full" for standalone (Studio #23)', () => {
    const { document, changes } = standaloneToWideOpen({ pages: [columns(true)] });
    expect((document as J).pages[0].wideOpen).toBe('full');
    expect(changes).toHaveLength(1);
  });
});

// MARK: - Link results

describe('link result lines', () => {
  const withSheetLinks = (): J => {
    const document = base();
    document.levels = [levelOf(document, 'demo_level')];
    document.modals[0].components[1] = tile('demo_tile_a', push('demo_level'));
    document.modals[0].components[0] = tile('demo_tile_b', push('page-echo'));
    return document;
  };

  it('a tile in a sheet to a page closes the sheet first', () => {
    expect(linkResult(as(withSheetLinks()), ['modals', 0, 'components', 0, 'action'], { kind: 'page', id: 'page-echo' })).toEqual({
      lead: 'Opens the Sample Detail page.', rest: 'The sheet closes first. Back returns to the page under the sheet.' });
  });

  it('a tile in a sheet to a level stays in the sheet, and names the sheet', () => {
    expect(linkResult(as(withSheetLinks()), ['modals', 0, 'components', 1, 'action'], { kind: 'page', id: 'demo_level' })).toEqual({ lead: 'Stays in this sheet.', rest: 'Demo Level is a level of Palette.' });
  });

  it('a tile in a level names the sheet that reaches the level, and a level reached by none says "this sheet"', () => {
    const document = withSheetLinks();
    document.levels[0].components[0] = tile('demo_tile_c', push('page-echo'));
    expect(sheetOfLevel(as(document), 'demo_level')).toBe('Palette');
    expect(linkResult(as(document), ['levels', 0, 'components', 0, 'action'], { kind: 'page', id: 'page-echo' })?.lead).toBe('Opens the Sample Detail page.');
    document.levels.push({ ...levelOf(document, 'demo_level_b'), title: 'Demo Deeper' });
    document.levels[0].components[0] = tile('demo_tile_d', push('demo_level_b'));
    expect(linkResult(as(document), ['levels', 0, 'components', 0, 'action'], { kind: 'page', id: 'demo_level_b' })).toEqual({ lead: 'Stays in this sheet.', rest: 'Demo Deeper is a level of Palette.' });
    expect(linkResult(as(document), ['pages', 0, 'components', 0, 'action'], { kind: 'page', id: 'demo_level_b' })).toBeUndefined();
    expect(sheetOfLevel(as(document), 'demo_missing')).toBeUndefined();
    document.modals[0].components = [];
    expect(linkResult(as(document), ['levels', 1, 'components', 0, 'action'], { kind: 'page', id: 'demo_level_b' })?.rest).toBe('Demo Deeper is a level of this sheet.');
  });

  it('a tile to a sheet or a modal says what it opens, from a page or a sheet', () => {
    const document = base();
    document.modals.push({ ...structuredClone(document.modals[0]), id: 'demo_modal', title: 'Demo Full', presentation: { ...document.modals[0].presentation, fullScreen: true } });
    expect(linkResult(as(document), ['pages', 0, 'components', 0, 'action'], { kind: 'modal', id: 'modal-swatch' })).toEqual({ lead: 'Opens the Palette sheet.', rest: '' });
    expect(linkResult(as(document), ['modals', 0, 'components', 0, 'action'], { kind: 'modal', id: 'demo_modal' })).toEqual({ lead: 'Opens Demo Full full screen.', rest: '' });
    expect(linkResult(as(document), ['pages', 0, 'components', 0, 'action'], { kind: 'modal', id: 'demo_gone' })).toBeUndefined();
  });

  it('a link from a page to a page is the plain push and says nothing; unknown targets say nothing', () => {
    const document = as(withSheetLinks());
    expect(linkResult(document, ['pages', 0, 'components', 0, 'action'], { kind: 'page', id: 'page-echo' })).toBeUndefined();
    expect(linkResult(document, ['modals', 0, 'components', 0, 'action'], { kind: 'page', id: 'demo_gone' })).toBeUndefined();
    expect(linkResult(document, ['navigation', 'chrome', 'groups', 0], { kind: 'page', id: 'page-echo' })).toBeUndefined();
    expect(linkResult(document, ['pages', 99], { kind: 'page', id: 'page-echo' })).toBeUndefined();
  });
});

// MARK: - Checks

describe('chrome checks', () => {
  /** The first page of the first tab with nothing on it that goes anywhere. */
  const quiet = (document: J): J => { document.pages[0].components = [{ ...document.pages[2].components[0], id: 'demo_quiet' }]; return document; };

  it('a tab first page that hides Tabs is a warning, in the proposal words', () => {
    const document = setHideTabs(as(quiet(base())), 0, true);
    expect(tabsHiddenOnFirstPage(document).map(check => check.sentence)).toEqual([
      'Tabs are hidden on Canvas, the first page of a tab, so nothing on it leads to another tab. Show Tabs there, or add a button that goes to another page.']);
    const checks = runChecks(document);
    expect(checks.suggestions.find(row => row.id === 'tabs-hidden-page-orbit')).toMatchObject({ place: 'Canvas', select: 'page:page-orbit' });
  });

  it('is not raised for a page that is no tab\'s first page, or that has a way on', () => {
    expect(tabsHiddenOnFirstPage(setHideTabs(as(base()), 2, true))).toEqual([]);
    const document = quiet(base());
    document.pages[0].hides = { tabs: true };
    document.pages[0].components[0] = tile('demo_tile_way', push('page-echo'));
    expect(tabsHiddenOnFirstPage(as(document))).toEqual([]);
    document.pages[0].components[0] = tile('demo_tile_tab', { type: 'select-tab', tabId: 'tab-beta' });
    expect(tabsHiddenOnFirstPage(as(document))).toEqual([]);
    document.pages[0].components[0] = tile('demo_tile_self', push('page-orbit'));
    expect(tabsHiddenOnFirstPage(as(document))).toHaveLength(1);
    // A link to a page that hides Tabs too, or the app showing Tabs on the first page only, leads nowhere.
    document.pages[0].components[0] = tile('demo_tile_way', push('page-echo'));
    document.pages[2].hides = { tabs: true };
    expect(tabsHiddenOnFirstPage(as(document))).toHaveLength(1);
    delete document.pages[2].hides;
    document.navigation.tabsVisibility = 'root-only';
    expect(tabsHiddenOnFirstPage(as(document))).toHaveLength(1);
  });

  it('Custom without Quick Links and Profile is a warning; with them, or Same as app, it is not', () => {
    const document = base();
    document.pages[2].toolbar = { type: 'replace', groups: [] };
    expect(customWithoutQuickLinks(as(document)).map(check => check.sentence)).toEqual(['Sample Detail: Custom has no Quick Links and Profile, so this page will not show them. Add them, or choose Same as app.']);
    document.pages[2].toolbar = { type: 'replace', groups: [{ id: 'demo_group', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [header()] }] };
    expect(customWithoutQuickLinks(as(document))).toEqual([]);
    const none = base();
    none.pages[2].toolbar = { type: 'replace', groups: [] };
    none.navigation.chrome.groups.pop();
    expect(customWithoutQuickLinks(as(none))).toEqual([]);
  });

  it('Quick Links and Profile on the first page only is a note', () => {
    expect(quickLinksFirstPageOnly(as(base()))).toBeUndefined();
    const document = base();
    document.navigation.chrome.groups[1].items[0].visibility = 'root-only';
    expect(quickLinksFirstPageOnly(as(document))).toBe('Quick Links and Profile show on the first page of each tab only.');
    expect(runChecks(as(document)).suggestions.find(row => row.id === 'quick-links-first-page')).toMatchObject({ go: { panel: 'header' } });
  });

  it('a level linked from a page is an error, in the proposal words', () => {
    const document = base();
    document.levels = [levelOf(document, 'demo_level')];
    document.pages[2].components[0] = tile('demo_tile_bad', push('demo_level'));
    const problems = runChecks(as(document)).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0].sentence).toBe('Sample Detail links to Demo Level, a level. A page cannot open a level. Move Demo Level to Pages, or open it from a sheet.');
  });

  it('other invalid combinations keep the compiler words', () => {
    const document = base();
    document.pages[0].hides = { items: ['chrome-menu'] };
    const [issue] = runChecks(as(document)).problems;
    expect(issue.sentence).not.toContain('a level');
    expect(sentenceFor(as(document), { code: 'invalid_combination', pointer: '/document/pages/0/title' } as never).sentence).not.toContain('a level');
  });
});
