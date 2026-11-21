import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { flatRows, hidesTag, levelOwners, libraryGroups, matchGroups } from '../src/workspace2/outline';
import { runChecks } from '../src/workspace2/checks';
import { FIRST_LEVEL_WORDS, firstLevelTitle, addLevel, blankLevel, deleteLevel, levelOpenerCount, moveRefusals, moveToPages as tryMoveToPages, moveToSheets, renameLevel } from '../src/workspace2/navigation/edit';
import { chromeSummary, hidesInForce, linkResult } from '../src/workspace2/navigation/chromeRules';

type J = Record<string, any>;

// MARK: - Fixtures (made-up names; ids with the demo_ prefix)

const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
const as = (document: J) => document as CompositionDocument;
const compiles = (document: J) => { try { compileCompositionDocument(document); return true; } catch (error) { if (error instanceof CompositionValidationError) return false; throw error; } };

/** The first-slice document: tabs `page-orbit` and `page-lattice`, a loose page `page-echo` the header's Inspect button opens, and the sheet `modal-swatch` (Palette). */
/** Move to Pages that must succeed: the document it makes. */
function moveToPages(document: CompositionDocument, id: string): CompositionDocument {
  const moved = tryMoveToPages(document, id);
  if (!moved.ok) throw new Error(moved.reason);
  return moved.document;
}
function base(): J {
  return JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
}
/** A level, taken from page-echo. */
function levelOf(document: J, id: string, title = 'Demo Level'): J {
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  return { ...surface, id, title, toolbar: { type: 'replace', groups: [] }, components: [{ ...surface.components[0], id: `${id}_text` }] };
}
/** The base document with two levels under Palette (the second reached through the first) and a third no sheet reaches. */
function withLevels(): J {
  const document = base();
  document.levels = [levelOf(document, 'demo_level_a', 'Demo Level A'), levelOf(document, 'demo_level_b', 'Demo Level B'), levelOf(document, 'demo_level_c', 'Demo Level C')];
  document.modals[0].components.push(tile('demo_open_a', push('demo_level_a')));
  document.levels[0].components.push(tile('demo_open_b', push('demo_level_b')));
  return document;
}
/** Takes out of the document every tile and header button that opens `pageId`, so the page is one nothing opens. */
function isolate(document: J, pageId = 'page-echo'): J {
  const keep = (value: unknown): boolean => !JSON.stringify(value).includes(`"pageId":"${pageId}"`);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child) && (key === 'components' || key === 'children' || key === 'items')) (value as J)[key] = child.filter(keep);
      walk((value as J)[key]);
    }
  };
  walk(document.pages); walk(document.modals); walk(document.navigation.chrome);
  return document;
}

// MARK: - The outline: levels under their sheet

describe('levels in the library', () => {
  it('lists a sheet\'s levels beneath it, in levels[] order, tagged Level, and the ones no sheet reaches under Not Linked', () => {
    const groups = libraryGroups(as(withLevels()), 'sheets');
    const sheet = groups.flatMap(group => group.rows).find(row => row.surface.id === 'modal-swatch')!;
    expect(sheet.levels!.map(row => [row.key, row.title, row.tags])).toEqual([['level:demo_level_a', 'Demo Level A', ['Level']], ['level:demo_level_b', 'Demo Level B', ['Level']]]);
    expect(sheet.levels![0]).toMatchObject({ surface: { kind: 'modal', id: 'modal-swatch' }, level: { id: 'demo_level_a', sheetId: 'modal-swatch' } });
    const loose = groups.find(group => group.id === 'loose')!;
    expect(loose.rows.map(row => [row.title, row.tags])).toEqual([['Demo Level C', ['Level', 'No Way In']]]);
    expect(loose.rows[0].level).toEqual({ id: 'demo_level_c', sheetId: undefined });
  });

  it('a level no sheet reaches has the same suggestion as a page with no way in, so Checks does not read No Problems', () => {
    const suggestions = runChecks(as(withLevels())).suggestions.filter(row => row.sentence.includes('no way in'));
    expect(suggestions.map(row => row.sentence)).toEqual(['Demo Level C has no way in.']);
    // The levels a sheet reaches have one.
    const reached = withLevels();
    reached.modals[0].components.push(tile('demo_open_c', push('demo_level_c')));
    expect(runChecks(as(reached)).suggestions.filter(row => row.sentence.includes('no way in'))).toEqual([]);
  });

  it('the Modals list carries a modal\'s levels and none of the loose ones', () => {
    const document = withLevels();
    document.modals[0].presentation.fullScreen = true;
    const groups = libraryGroups(as(document), 'modals');
    expect(flatRows(groups).map(row => row.key)).toEqual(['modal:modal-swatch', 'level:demo_level_a', 'level:demo_level_b']);
    expect(libraryGroups(as(document), 'sheets').flatMap(group => group.rows.map(row => row.key))).toEqual(['level:demo_level_c']);
  });

  it('a level two sheets reach is listed under the first and tagged Shared', () => {
    const document = withLevels();
    const second = structuredClone(document.modals[0]);
    second.id = 'demo_second'; second.title = 'Second';
    second.components = [tile('demo_open_a2', push('demo_level_a'))];
    document.modals.push(second);
    document.pages[0].components.push(tile('demo_present_second', { type: 'present', modalId: 'demo_second', arguments: {}, ifPresented: 'reject' }));
    expect(levelOwners(as(document)).shared).toEqual(new Set(['demo_level_a', 'demo_level_b']));
    const rows = flatRows(libraryGroups(as(document), 'sheets'));
    expect(rows.filter(row => row.level).map(row => [row.key, row.tags])).toEqual([['level:demo_level_a', ['Level', 'Shared']], ['level:demo_level_b', ['Level', 'Shared']], ['level:demo_level_c', ['Level', 'No Way In']]]);
    expect(rows.find(row => row.key === 'modal:demo_second')!.levels).toEqual([]);
  });

  it('a document with no levels lists its sheets with none', () => {
    expect(flatRows(libraryGroups(as(base()), 'sheets')).filter(row => row.level)).toEqual([]);
  });

  it('a search keeps a sheet whose level matches, with that level alone, and a sheet that matches with all of them', () => {
    const groups = libraryGroups(as(withLevels()), 'sheets');
    const hit = flatRows(matchGroups(groups, 'level b'));
    expect(hit.map(row => row.key)).toEqual(['modal:modal-swatch', 'level:demo_level_b']);
    expect(flatRows(matchGroups(groups, 'palette')).map(row => row.key)).toEqual(['modal:modal-swatch', 'level:demo_level_a', 'level:demo_level_b']);
    expect(matchGroups(groups, 'zzz')).toEqual([]);
    expect(matchGroups(groups, '  ')).toHaveLength(groups.length);
  });

  it('a page a sheet opens is listed in the flow of the page that opens the sheet, and Pages has no From a Sheet group, once the document declares levels', () => {
    const document = isolate(base());
    document.levels = [];
    document.pages[0].components.push(tile('demo_present', { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }));
    document.modals[0].components.push(tile('demo_open_echo', push('page-echo')));
    const groups = libraryGroups(as(document), 'pages');
    expect(groups.map(group => group.title)).not.toContain('From a Sheet');
    expect(groups.map(group => [group.title, group.rows.map(row => row.surface.id)])).toEqual([['From Canvas', ['page-echo']]]);
  });

  it('without a levels key a sheet keeps the pages it opens: they are listed From a Sheet, as the app and the simulator treat them', () => {
    const document = isolate(base());
    document.pages[0].components.push(tile('demo_present', { type: 'present', modalId: 'modal-swatch', arguments: {}, ifPresented: 'reject' }));
    document.modals[0].components.push(tile('demo_open_echo', push('page-echo')));
    expect(document.levels).toBeUndefined();
    const groups = libraryGroups(as(document), 'pages');
    expect(groups.map(group => [group.title, group.rows.map(row => row.surface.id)])).toEqual([['From a Sheet', ['page-echo']]]);
    // Declared, even empty, the same page is in the flow of the page that opens the sheet.
    document.levels = [];
    expect(libraryGroups(as(document), 'pages').map(group => group.title)).toEqual(['From Canvas']);
  });

  it('a page only a sheet nobody opens reaches is under Not Linked, and not tagged No Way In', () => {
    const document = isolate(base());
    document.levels = [];
    document.modals[0].components.push(tile('demo_open_echo', push('page-echo')));
    const groups = libraryGroups(as(document), 'pages');
    expect(groups.map(group => [group.id, group.rows.map(row => [row.surface.id, row.tags])])).toEqual([['loose', [['page-echo', []]]]]);

  });
});

// MARK: - Hides N

describe('Hides N counts the hides in force', () => {
  /** The first-slice header: Inspect shows on the first page only, Palette on every page. */
  const hidingEcho = (hides: J, mutate: (document: J) => void = () => {}): [CompositionDocument, CompositionDocument['pages'][number]] => {
    const document = base();
    document.pages[2].hides = hides;
    mutate(document);
    return [as(document), as(document).pages[2]];
  };

  it('counts the tab bar and each button the app shows there', () => {
    const [document, page] = hidingEcho({ tabs: true, items: ['chrome-palette'] });
    expect(hidesInForce(document, page)).toBe(2);
    expect(hidesTag(document, page)).toEqual(['Hides 2']);
  });

  it('does not count an item the app already hides there through First page only', () => {
    const [document, page] = hidingEcho({ items: ['chrome-inspect', 'chrome-palette'] });
    expect(hidesInForce(document, page)).toBe(1);
    // On a tab's first page the app shows it, so the page's hide is in force.
    const first = as(base()); first.pages[0].hides = { items: ['chrome-inspect'] };
    expect(hidesInForce(first, first.pages[0])).toBe(1);
  });

  it('does not count the tab bar when the app already shows it on the first page only', () => {
    const [document, page] = hidingEcho({ tabs: true }, doc => { doc.navigation.tabsVisibility = 'root-only'; });
    expect(hidesInForce(document, page)).toBe(0);
    expect(hidesTag(document, page)).toEqual([]);
    const first = as({ ...document, pages: document.pages.map((item, at) => at === 0 ? { ...item, hides: { tabs: true } } : item) });
    expect(hidesInForce(first, first.pages[0])).toBe(1);
  });

  it('does not count an item a Custom toolbar does not have, and still counts the tab bar', () => {
    const [document, page] = hidingEcho({ tabs: true, items: ['chrome-palette'] }, doc => { doc.pages[2].toolbar = { type: 'replace', groups: [] }; });
    expect(hidesInForce(document, page)).toBe(1);
  });

  it('does not count an id the app no longer has, or the same id twice', () => {
    const [document, page] = hidingEcho({ items: ['demo_gone', 'chrome-palette', 'chrome-palette'] });
    expect(hidesInForce(document, page)).toBe(1);
  });

  it('nothing in force is no tag, and the app panel line counts the same pages', () => {
    const [document] = hidingEcho({ items: ['chrome-inspect'] });
    expect(hidesTag(document, document.pages[2])).toEqual([]);
    expect(chromeSummary(document).hidden).toEqual([]);
    const shown = as(base()); shown.pages[2].hides = { items: ['chrome-palette'] };
    expect(chromeSummary(shown).hidden).toEqual([{ id: 'page-echo', title: 'Sample Detail', count: 1 }]);
  });

  it('the library rows carry the tag', () => {
    const document = base();
    document.pages[0].hides = { items: ['chrome-inspect', 'chrome-palette'] };
    document.pages[2].hides = { items: ['chrome-inspect'] };
    const tabs = libraryGroups(as(document), 'tabs')[0].rows;
    expect(tabs[0].tags).toEqual(['Hides 2']);
    const echo = libraryGroups(as(document), 'pages').flatMap(group => group.rows).find(row => row.surface.id === 'page-echo')!;
    expect(echo.tags.some(tag => tag.startsWith('Hides'))).toBe(false);
  });
});

// MARK: - + Level, rename, delete

describe('adding, renaming and deleting a level', () => {
  it('adds a level to a sheet with a tile that opens it, as one new document that compiles', () => {
    const made = addLevel(as(base()), 'modal-swatch', 'Details');
    expect(made.document.levels!.map(level => level.title)).toEqual(['Details']);
    expect(made.document.levels![0]).toMatchObject({ id: made.id, toolbar: { type: 'replace', groups: [] }, components: [] });
    const opener = made.document.modals[0].components.at(-1) as J;
    expect(opener).toMatchObject({ title: 'Details', action: { type: 'push', pageId: made.id } });
    expect(compiles(made.document)).toBe(true);
    expect(levelOwners(made.document).bySheet.get('modal-swatch')).toEqual([made.id]);
  });

  it('gives a second level of the same name a fresh one', () => {
    const first = addLevel(as(base()), 'modal-swatch', 'Details');
    expect(addLevel(first.document, 'modal-swatch', 'Details').document.levels!.map(level => level.title)).toEqual(['Details', 'Details 2']);
    expect(blankLevel(as(base()), 'X').layout).not.toHaveProperty('foldSides');
  });

  it('renames a level, ignoring an empty name or a level that is gone', () => {
    const document = as(withLevels());
    expect(renameLevel(document, 'demo_level_a', '  Wiring ').levels![0].title).toBe('Wiring');
    expect(renameLevel(document, 'demo_level_a', '  ')).toBe(document);
    expect(renameLevel(document, 'demo_gone', 'Wiring')).toBe(document);
  });

  it('deletes a level and the tile that opened it, and the last level leaves `levels: []`, which still declares them', () => {
    const made = addLevel(as(base()), 'modal-swatch', 'Details');
    expect(levelOpenerCount(made.document, made.id)).toBe(1);
    const gone = deleteLevel(made.document, made.id);
    expect(gone.actions).toBe(1);
    expect(gone.document.levels).toEqual([]);
    expect(gone.document.modals[0].components.some(node => (node as J).title === 'Details')).toBe(false);
    expect(compiles(gone.document)).toBe(true);
  });

  it('deleting one of several levels keeps the others', () => {
    const gone = deleteLevel(as(withLevels()), 'demo_level_b');
    expect(gone.document.levels!.map(level => level.id)).toEqual(['demo_level_a', 'demo_level_c']);
    expect(gone.document.levels![0].components.some(node => (node as J).id === 'demo_open_b')).toBe(false);
  });
});

// MARK: - Move to Pages

describe('Move to Pages', () => {
  it('makes the level a stack page after the others, Same as app, with its links still working', () => {
    const document = as(withLevels());
    const moved = moveToPages(document, 'demo_level_b');
    expect(moved.pages.map(page => page.id)).toEqual(['page-orbit', 'page-lattice', 'page-echo', 'demo_level_b']);
    expect(moved.pages[3]).toMatchObject({ toolbar: { type: 'inherit' }, navigation: { type: 'stack' } });
    expect(moved.levels!.map(level => level.id)).toEqual(['demo_level_a', 'demo_level_c']);
    expect(compiles(moved)).toBe(true);
    expect(moved.pages[3].components).toEqual(document.levels![1].components);
  });

  it('keeps a level\'s own header buttons, and the last level leaves `levels: []`', () => {
    const document = as(withLevels());
    document.levels = [{ ...document.levels![0], toolbar: { type: 'replace', groups: [{ id: 'demo_group', placement: 'trailing', horizontal: 'separate-circles@1', vertical: 'shared@1', items: [] }] } } as never];
    const moved = moveToPages(document, 'demo_level_a');
    expect(moved.pages.at(-1)!.toolbar.type).toBe('replace');
    expect(moved.levels).toEqual([]);
  });

  it('refuses a level that is gone', () => {
    expect(tryMoveToPages(as(withLevels()), 'demo_gone').ok).toBe(false);
  });

  it('refuses a level that opens another level, in the Move to Sheets form, and writes nothing', () => {
    const refused = tryMoveToPages(as(withLevels()), 'demo_level_a');
    expect(refused).toEqual({ ok: false, reason: 'Demo Level A opens Demo Level B, a level, so it stays in Sheets. Move Demo Level B to Pages first.' });
    expect(moveRefusals.opensLevel('A', 'B')).toBe('A opens B, a level, so it stays in Sheets. Move B to Pages first.');
  });

  it('moving the child first, then the parent, works: the parent then opens a page, not a level', () => {
    const child = moveToPages(as(withLevels()), 'demo_level_b');
    const parent = moveToPages(child, 'demo_level_a');
    expect(compiles(parent)).toBe(true);
    expect(parent.levels!.map(level => level.id)).toEqual(['demo_level_c']);
  });

  it('the safety net refuses a move that would leave a draft that does not compile, in the checks\' words, and writes nothing', () => {
    // A saved component's argument names a level from inside a level: no link shows it, and it is fine there. As a page it would name a level from a page, which a page cannot do.
    const document = withLevels();
    document.componentLibrary = [{ id: 'demo_door', name: 'Door', node: tile('demo_cmp_open', push('demo_level_b')), params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'demo_cmp_open', field: 'action/pageId' }] }];
    document.levels[2].components.push({ id: 'demo_use', type: 'component-ref', componentId: 'demo_door', layout: { span: 1 }, args: { target: 'demo_level_b' } });
    expect(compiles(document)).toBe(true);
    const before = JSON.stringify(document);
    const refused = tryMoveToPages(as(document), 'demo_level_c');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      const lead = 'Demo Level C cannot become a page, so it stays in Sheets.';
      expect(refused.reason.startsWith(lead)).toBe(true);
      expect(refused.reason).not.toMatch(/Fix its links|Choose Move/);
      expect(refused.reason.length).toBeGreaterThan(lead.length);
      expect(moveRefusals.otherPage('Demo Level C')).toBe(lead);
    }
    expect(JSON.stringify(document)).toBe(before);
  });

  it('a problem the document already has elsewhere does not refuse the move', () => {
    const document = withLevels();
    document.pages[1].hides = { items: ['demo_stale'] };
    expect(compiles(document)).toBe(false);
    const moved = tryMoveToPages(as(document), 'demo_level_b');
    expect(moved.ok).toBe(true);
  });

  it('a link from a sheet to the moved page opens it as a page: the link result says the sheet closes first', () => {
    const moved = moveToPages(moveToPages(as(withLevels()), 'demo_level_b'), 'demo_level_a');
    expect(linkResult(moved, ['modals', 0, 'components', 3, 'action'], { kind: 'page', id: 'demo_level_a' })).toEqual({ lead: 'Opens the Demo Level A page.', rest: 'The sheet closes first. Back returns to the page under the sheet.' });
  });
});

// MARK: - Move to Sheets

describe('Move to Sheets', () => {
  /** A page nothing opens, ready to become a level, with a tile in the sheet that opens it. */
  const loose = (): J => {
    const document = isolate(base());
    document.levels = [];
    document.modals[0].components.push(tile('demo_open_echo', push('page-echo')));
    return document;
  };

  it('makes the page a level after the others and drops what only a page has, keeping the sheet\'s link', () => {
    const document = loose();
    document.pages[2].hides = { tabs: true }; document.pages[2].wideOpen = 'full'; document.pages[2].layout.foldSides = 'auto';
    const moved = moveToSheets(as(document), 'page-echo');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.document.pages.map(page => page.id)).toEqual(['page-orbit', 'page-lattice']);
    const level = moved.document.levels!.at(-1)! as J;
    expect(level.id).toBe('page-echo');
    expect(level).not.toHaveProperty('hides'); expect(level).not.toHaveProperty('wideOpen'); expect(level).not.toHaveProperty('navigation'); expect(level.layout).not.toHaveProperty('foldSides');
    expect(level.toolbar).toEqual({ type: 'replace', groups: [] });
    expect(compiles(moved.document)).toBe(true);
    expect(levelOwners(moved.document).bySheet.get('modal-swatch')).toEqual(['page-echo']);
  });

  it('round trips: Move to Sheets and then Move to Pages gives a page again, Same as app', () => {
    const moved = moveToSheets(as(loose()), 'page-echo');
    if (!moved.ok) throw new Error(moved.reason);
    const back = moveToPages(moved.document, 'page-echo');
    expect(back.pages.map(page => page.id)).toEqual(['page-orbit', 'page-lattice', 'page-echo']);
    expect(back.pages[2]).toMatchObject({ toolbar: { type: 'inherit' }, navigation: { type: 'stack' } });
    expect(back.levels).toEqual([]);
    expect(compiles(back)).toBe(true);
  });

  it('refuses a page a page opens, naming the page', () => {
    expect(moveToSheets(as(base()), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail is opened from Canvas, a page. Only a sheet can open a level. Remove that link first.' });
    expect(moveRefusals.openedFromPage('A', 'B')).toBe('A is opened from B, a page. Only a sheet can open a level. Remove that link first.');
  });

  it('refuses a tab\'s page', () => {
    expect(moveToSheets(as(base()), 'page-lattice')).toEqual({ ok: false, reason: 'Shelf is a tab\'s page, so it stays in Pages.' });
  });

  it('refuses a page a link from outside the app opens, by its page', () => {
    const document = loose();
    const route = { id: 'demo_route', path: 'demo-echo', pageId: 'page-echo', title: 'Echo', summary: 'Echo', icon: 'house' };
    document.extensions = { type: 'native-extensions@1', watch: 'stub@1', routes: [route], cameras: [] };
    expect(moveToSheets(as(document), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail opens from outside the app, so it stays in Pages.' });
  });

  it('refuses the page the app opens first when no tab is', () => {
    const document = loose();
    document.navigation.tabs = []; document.navigation.initialTabId = null; document.navigation.initialPageId = 'page-echo';
    expect(moveToSheets(as(document), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail is the page the app opens first, so it stays in Pages.' });
  });

  it('refuses a page the app header opens, and a page a Close Sheet, Open Page action opens', () => {
    const original = base();
    const document = loose();
    document.navigation.chrome.groups[0].items.push(structuredClone(original.navigation.chrome.groups[0].items[1]));
    expect(moveToSheets(as(document), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail is opened from the app header, which every page shows. Only a sheet can open a level. Remove that link first.' });
    const leaving = isolate(base());
    leaving.modals[0].components.push(structuredClone(original.modals[0].components[2]));
    expect(moveToSheets(as(leaving), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail is opened from Palette by Close Sheet, Open Page, which cannot reach a level. Change that link first.' });
  });

  it('refuses a page that opens pages beside it', () => {
    const document = loose();
    document.pages[2].navigation = { type: 'navigation-columns', placeholder: 'Pick one', standalone: false };
    expect(moveToSheets(as(document), 'page-echo')).toEqual({ ok: false, reason: 'Sample Detail opens pages beside it, so it stays in Pages.' });
  });

  it('the first level is asked about, before it applies; confirmed, it goes on', () => {
    const document = loose();
    delete document.levels;
    const asked = moveToSheets(as(document), 'page-echo');
    expect(asked).toEqual({ ok: false, first: true, reason: FIRST_LEVEL_WORDS });
    expect(FIRST_LEVEL_WORDS).toBe('This will be the first level. After it, a page opened from any sheet closes that sheet first; today it opens inside the sheet.');
    expect(firstLevelTitle('Sample Detail')).toBe('Move Sample Detail to Sheets?');
    expect(JSON.stringify(document)).not.toContain('"levels"');
    const went = moveToSheets(as(document), 'page-echo', true);
    expect(went.ok).toBe(true);
    if (went.ok) expect(went.document.levels!.map(level => level.id)).toEqual(['page-echo']);
    // A document that already declares levels moves at once, with no question.
    expect(moveToSheets(as(loose()), 'page-echo').ok).toBe(true);
  });

  it('a refusal comes before the notice, so a page that cannot move is told why, not warned', () => {
    const document = isolate(base());
    expect(document.levels).toBeUndefined();
    const refused = moveToSheets(as(document), 'page-orbit');
    expect(refused.ok === false && refused.first).toBeUndefined();
  });

  it('a pre-existing problem on a later page does not refuse a valid move, and a page 10 is not taken for page 1', () => {
    const document = loose();
    // Pages after the moved one shift down by one; one has a stale hidden-item id that already fails to compile.
    const extra = structuredClone(document.pages[1]);
    for (let at = 0; at < 9; at++) document.pages.push({ ...structuredClone(extra), id: `demo_extra_${at}`, title: `Extra ${at}` });
    document.pages[2].title = 'Sample Detail';
    const moved = document.pages.splice(2, 1)[0];
    document.pages.unshift(moved);
    document.pages[document.pages.length - 1].hides = { items: ['demo_stale'] };
    const result = moveToSheets(as(document), 'page-echo');
    if (!result.ok) throw new Error(result.reason);
    expect(result.document.levels!.map(level => level.id)).toEqual(['page-echo']);
  });

  it('refuses a page that is not there, and the last page', () => {
    expect(moveToSheets(as(base()), 'demo_gone').ok).toBe(false);
    const document = loose();
    document.pages = [document.pages[2]]; document.navigation.tabs = []; document.navigation.initialTabId = null; document.navigation.initialPageId = 'demo_other';
    expect(moveToSheets(as(document), 'page-echo')).toEqual({ ok: false, reason: moveRefusals.onlyPage('Sample Detail') });
    expect(moveRefusals.onlyPage('Sample Detail')).toBe('Sample Detail is the only page, so it stays in Pages.');
  });

  it('drops a section\'s side of the hinge with the page\'s two-sided layout', () => {
    const document = loose();
    document.pages[2].layout.foldSides = 'auto';
    document.pages[2].components[0].layout = { span: 1, foldSide: 'leading' };
    const moved = moveToSheets(as(document), 'page-echo');
    expect(moved.ok).toBe(true);
    if (moved.ok) { expect((moved.document.levels!.at(-1)!.components[0] as J).layout).toEqual({ span: 1 }); expect(compiles(moved.document)).toBe(true); }
  });

  it('refuses a move that would leave a draft that does not compile, instead of writing it', () => {
    // A saved component's argument names the page from a page: no link shows it, and a level cannot be named from a page.
    const document = loose();
    document.componentLibrary = [{ id: 'demo_door', name: 'Door', node: tile('demo_cmp_open', push('page-lattice')), params: [{ name: 'target', kind: 'page-id' }], bindings: [{ param: 'target', nodeId: 'demo_cmp_open', field: 'action/pageId' }] }];
    document.pages[1].components.push({ id: 'demo_use', type: 'component-ref', componentId: 'demo_door', layout: { span: 1 }, args: { target: 'page-echo' } });
    expect(compiles(document)).toBe(true);
    const refused = moveToSheets(as(document), 'page-echo');
    expect(refused.ok).toBe(false);
    // The safety net names the page, says it stays, then gives the checks' own sentence for the first new problem; it never says "Fix its links".
    if (!refused.ok) { expect(refused.reason.startsWith('Sample Detail cannot become a level, so it stays in Pages.')).toBe(true); expect(refused.reason).not.toMatch(/Fix its links/); expect(refused.reason.length).toBeGreaterThan('Sample Detail cannot become a level, so it stays in Pages.'.length); }
  });
});

// MARK: - The error check

describe('a page that links to a level', () => {
  it('is one error, in the editor\'s words, from the check the editor built', () => {
    const document = withLevels();
    document.pages[0].components.push(tile('demo_bad', push('demo_level_a')));
    const problems = runChecks(as(document)).problems.filter(row => row.sentence.includes('a level'));
    expect(problems.map(row => row.sentence)).toEqual(['Canvas links to Demo Level A, a level. A page cannot open a level. Move Demo Level A to Pages, or open it from a sheet.']);
    expect(runChecks(as(withLevels())).problems).toEqual([]);
  });

  it('goes away once the level moves to Pages', () => {
    const document = withLevels();
    document.pages[0].components.push(tile('demo_bad', push('demo_level_b')));
    expect(runChecks(as(document)).problems).toHaveLength(1);
    expect(runChecks(moveToPages(as(document), 'demo_level_b')).problems).toEqual([]);
  });

  it('a level that opens a level cannot be moved to Pages, so the Studio never makes this error itself', () => {
    expect(tryMoveToPages(as(withLevels()), 'demo_level_a').ok).toBe(false);
  });

  it('a level only a page links to has the error and not also "has no way in"', () => {
    const document = withLevels();
    document.pages[0].components.push(tile('demo_bad', push('demo_level_c')));
    const checks = runChecks(as(document));
    expect(checks.problems.map(row => row.sentence)).toEqual(['Canvas links to Demo Level C, a level. A page cannot open a level. Move Demo Level C to Pages, or open it from a sheet.']);
    expect(checks.suggestions.filter(row => row.sentence.includes('Demo Level C'))).toEqual([]);
  });
});
