import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { replaceAt } from '../src/composition-editor';
import { collapseCrumbs, countWords, isLevel, levelRows, levelTitle, openingLevel, pathTo, rowContext, searchLevel, surfaceWordOf, survivingLevel, trailTo, typeGlyph, typeGlyphs, type Crumb } from '../src/workspace2/levels';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { demoDocument } from './preview2-gc-fixture';
import { listedSurface, survivingSurface } from '../src/workspace2/selection';

const home = homeDomains.document as unknown as CompositionDocument;
const index = buildDocumentIndex(home);
const root = `page:${home.navigation.initialPageId}` as SelectionKey;
const guests = 'node:hc-home-guests' as SelectionKey, grid = 'node:hc-home-guest-grid' as SelectionKey, tile = 'node:hc-home-guest-0' as SelectionKey, conditional = 'node:hc-home-guests-visible' as SelectionKey;
const crumbs = (...titles: string[]): Crumb[] => titles.map((title, at) => ({ key: `node:c${at}` as SelectionKey, title }));
const titles = (path: ReturnType<typeof collapseCrumbs>) => path.map(item => 'crumb' in item ? item.crumb.title : '…');

describe('levelRows', () => {
  it('lists the root: the page\'s own children, with the words of each', () => {
    const rows = levelRows(home, index, root);
    expect(rows.map(row => row.title)).toEqual(['Status', 'Weather', 'Conditional content', 'Cameras']);
    expect(rows.map(row => row.container)).toEqual([true, false, true, true]);
    expect(rows[0].context).toBe('Status rail · 6 chips');
    expect(rows[1].context).toBe('Weather');
    expect(rows[2]).toMatchObject({ key: conditional, type: 'room-section', count: 1, context: 'Room section · 1 item' });
  });

  it('lists a nested container: its children only, one level down', () => {
    expect(levelRows(home, index, guests).map(row => [row.title, row.context])).toEqual([['Guests', 'Tile grid · 2 tiles']]);
    const tiles = levelRows(home, index, grid);
    expect(tiles.map(row => row.title)).toEqual(['Demo Guests 1', 'Demo Guests 2']);
    expect(tiles.every(row => !row.container && row.count === 0 && row.context === 'Action tile')).toBe(true);
    expect(tiles[0].icon).toBeTruthy();
  });

  it('says "Shown by a rule" where a Visible-when rule decides, and counts an empty container as empty', () => {
    const ruled = replaceAt(home, ['pages', 0, 'components', 1, 'visibleWhen'], { type: 'always' }) as CompositionDocument;
    expect(levelRows(ruled, buildDocumentIndex(ruled), root)[1].context).toBe('Weather · Shown by a rule');
    const emptied = replaceAt(home, ['pages', 0, 'components', 2, 'children', 0, 'children', 0, 'children'], []) as CompositionDocument;
    const rows = levelRows(emptied, buildDocumentIndex(emptied), guests);
    expect(rows[0]).toMatchObject({ container: true, count: 0, context: 'Tile grid · No tiles' });
    expect(isLevel(buildDocumentIndex(emptied), rows[0].key)).toBe(true);
  });

  it('shows each tab of local tabs as a level of its own', () => {
    const tabs = { id: 'tabs-1', type: 'local-tabs', title: 'Modes', layout: { span: 2 }, tabs: [{ id: 'one', label: 'One', children: [{ ...home.pages[0].components[1], id: 'weather-copy' }] }, { id: 'two', label: 'Two', children: [] }] };
    const doc = replaceAt(home, ['pages', 0, 'components'], [...home.pages[0].components, tabs]) as CompositionDocument;
    const at = buildDocumentIndex(doc);
    const row = levelRows(doc, at, root).find(item => item.title === 'Modes')!;
    expect(row).toMatchObject({ container: true, count: 2, context: 'Tabs · 2 tabs' });
    const inside = levelRows(doc, at, row.key);
    expect(inside.map(item => [item.title, item.type, item.context])).toEqual([['One', 'local-tab', 'Tab · 1 item'], ['Two', 'local-tab', 'Tab · No items']]);
    // A tab is a level, and the level's path runs through the node that holds the tabs.
    expect(isLevel(at, inside[0].key)).toBe(true);
    expect(pathTo(doc, at, inside[0].key).map(crumb => crumb.title)).toEqual(['Home', 'Modes']);
  });
});

describe('the words', () => {
  it('counts a container in its own unit', () => {
    expect(countWords('tile-grid', 9)).toBe('9 tiles');
    expect(countWords('tile-grid', 1)).toBe('1 tile');
    expect(countWords('section', 3)).toBe('3 items');
    expect(countWords('status-rail', 0)).toBe('No chips');
    expect(rowContext('tile-grid', 9, true, false)).toBe('Tile grid · 9 tiles');
    expect(rowContext('action-tile', 0, false, true)).toBe('Action tile · Shown by a rule');
  });

  it('titles a level: "This Page" or "This Sheet" at the root, else the container\'s name', () => {
    expect(levelTitle(home, index, root)).toBe('This Page');
    expect(levelTitle(home, index, `modal:${home.modals[0].id}` as SelectionKey)).toMatch(/^This /);
    expect(levelTitle(home, index, guests)).toBe('Guests Staying Over');
  });
});

describe('pathTo', () => {
  it('is the page itself at the root, where there is no level above', () => {
    expect(pathTo(home, index, root)).toEqual([{ key: root, title: 'Home' }]);
  });
  it('runs from the page down to the level\'s parent, never repeating the level\'s own name', () => {
    expect(pathTo(home, index, conditional).map(crumb => crumb.title)).toEqual(['Home']);
    expect(pathTo(home, index, guests).map(crumb => crumb.title)).toEqual(['Home', 'Conditional content']);
    expect(pathTo(home, index, grid).map(crumb => crumb.title)).toEqual(['Home', 'Conditional content', 'Guests Staying Over']);
    expect(pathTo(home, index, grid)[0].key).toBe(root);
  });
  it('gives the trail of levels, page first and the level last', () => {
    expect(trailTo(index, grid)).toEqual([root, conditional, guests, grid]);
    expect(trailTo(index, root)).toEqual([root]);
  });
});

describe('opening and surviving', () => {
  it('opens at the selected node\'s own level, else at the root', () => {
    expect(openingLevel(index, root, undefined)).toBe(root);
    expect(openingLevel(index, root, tile)).toBe(grid);
    expect(openingLevel(index, root, root)).toBe(root);
    expect(openingLevel(index, root, 'page:elsewhere')).toBe(root);
    // A node of another page does not move the sheet off this one's root.
    expect(openingLevel(index, `page:${home.pages[1].id}` as SelectionKey, tile)).toBe(`page:${home.pages[1].id}`);
  });
  it('goes up to the nearest level that is left when the open one is deleted or moved away', () => {
    const trail = trailTo(index, grid);
    expect(survivingLevel(index, trail)).toBe(grid);
    const without = replaceAt(home, ['pages', 0, 'components', 2, 'children', 0, 'children'], []) as CompositionDocument;
    expect(survivingLevel(buildDocumentIndex(without), trail)).toBe(guests);
    const none = replaceAt(home, ['pages', 0, 'components'], []) as CompositionDocument;
    expect(survivingLevel(buildDocumentIndex(none), trail)).toBe(root);
  });
});

describe('collapseCrumbs', () => {
  const four = crumbs('Home', 'Conditional content', 'Guests Staying Over', 'Climate Rooms');
  it('shows a path that fits whole', () => {
    expect(titles(collapseCrumbs(four, 200))).toEqual(['Home', 'Conditional content', 'Guests Staying Over', 'Climate Rooms']);
  });
  it('keeps the first and last crumb and folds the middle into one "…" that lists what it hid', () => {
    const shown = collapseCrumbs(four, 40);
    expect(titles(shown)).toEqual(['Home', '…', 'Climate Rooms']);
    expect(shown[1]).toEqual({ hidden: [four[1], four[2]] });
  });
  it('keeps the nearest levels while they fit, and never returns more than fits', () => {
    for (const room of [20, 30, 40, 50, 60, 70, 80, 100, 130]) {
      const shown = collapseCrumbs(four, room);
      expect(shown.length).toBeLessThanOrEqual(4);
      expect(titles(shown)[0]).toBe('Home');
      expect(titles(shown).at(-1)).toBe('Climate Rooms');
      const text = titles(shown).join(' › ');
      // Whatever is shown fits, unless it is already down to its first, "…" and last.
      if (shown.length > 3) expect(text.length).toBeLessThanOrEqual(room);
      if (shown.length === 3 && titles(shown)[1] !== '…') expect(text.length).toBeLessThanOrEqual(room);
    }
  });
  it('has nothing to hide in a path of one or two crumbs', () => {
    expect(titles(collapseCrumbs(crumbs('Home'), 1))).toEqual(['Home']);
    expect(titles(collapseCrumbs(crumbs('Home', 'A very long page name indeed'), 5))).toEqual(['Home', 'A very long page name indeed']);
  });
  it('measures in whatever unit the caller uses', () => {
    const wide = collapseCrumbs(four, 120, () => 40, 10);
    expect(titles(wide)).toEqual(['Home', '…', 'Climate Rooms']);
    expect(titles(collapseCrumbs(four, 190, () => 40, 10))).toEqual(['Home', 'Conditional content', 'Guests Staying Over', 'Climate Rooms']);
  });
});

describe('searchLevel', () => {
  it('finds rows at any depth by title or type words, each with the titles down to its parent', () => {
    const hits = searchLevel(home, index, root, 'guest');
    expect(hits.map(hit => hit.row.key)).toContain(tile);
    const nested = hits.find(hit => hit.row.key === tile)!;
    expect(nested.path[0]).toBe(home.pages.find(page => page.id === home.navigation.initialPageId)!.title);
    expect(nested.path.length).toBeGreaterThan(1);
    expect(searchLevel(home, index, root, 'STATUS RAIL').length).toBeGreaterThan(0);
  });
  it('finds nothing for an empty or unmatched search, and stays inside the level', () => {
    expect(searchLevel(home, index, root, '   ')).toEqual([]);
    expect(searchLevel(home, index, root, 'zzzz-none')).toEqual([]);
    expect(searchLevel(home, index, conditional, 'weather')).toEqual([]);
  });
});

describe('surfaceWordOf and typeGlyph', () => {
  it('names a page, a sheet and a modal, and nothing for a node', () => {
    expect(surfaceWordOf(home, index, root)).toBe('Page');
    expect(surfaceWordOf(home, index, 'modal:hc-weather-sheet' as SelectionKey)).toBe('Sheet');
    const full = { ...home, modals: home.modals.map(modal => modal.id === 'hc-weather-sheet' ? { ...modal, presentation: { ...modal.presentation, fullScreen: true } } : modal) } as CompositionDocument;
    expect(surfaceWordOf(full, buildDocumentIndex(full), 'modal:hc-weather-sheet' as SelectionKey)).toBe('Modal');
    expect(surfaceWordOf(home, index, guests)).toBe('');
  });
  it('gives each known type its glyph and any other the Component glyph; the surface words have their own', () => {
    for (const [type, glyph] of Object.entries(typeGlyphs)) expect(typeGlyph(type)).toBe(glyph);
    expect(typeGlyph('unknown-type')).toBe('Component');
    expect([typeGlyph('tab'), typeGlyph('page'), typeGlyph('sheet'), typeGlyph('modal')].every(glyph => glyph !== 'Component')).toBe(true);
  });
});

describe('a level as a surface of the Studio (sh.sheet-levels@1)', () => {
  const doc = demoDocument();
  const withLevels = buildDocumentIndex(doc);
  const level = 'level:demo_level_a' as SelectionKey;

  it('lists the rows of a level, names it and takes its words', () => {
    expect(levelRows(doc, withLevels, level).map(row => row.key)).toEqual(['node:demo_level_a_to_demo_level_b', 'node:demo_level_a_to_demo_plain']);
    expect(isLevel(withLevels, level)).toBe(true);
    expect(surfaceWordOf(doc, withLevels, level)).toBe('Level');
    expect(levelTitle(doc, withLevels, level)).toBe('This Level');
  });

  it('opens at the level for a node inside it, and the path of a node starts at the level', () => {
    const node = 'node:demo_level_a_to_demo_level_b' as SelectionKey;
    expect(openingLevel(withLevels, level, node)).toBe(level);
    expect(pathTo(doc, withLevels, node).map(crumb => crumb.title)).toEqual(['Demo Level A']);
    expect(trailTo(withLevels, node)).toEqual([level, node]);
  });

  it('keeps a level on show while the document holds it, and falls back to its sheet when it is gone', () => {
    const shown = { kind: 'level' as const, id: 'demo_level_a', sheetId: 'demo_sheet' };
    expect(survivingSurface(shown, doc)).toBe(shown);
    const without = { ...doc, levels: doc.levels!.filter(item => item.id !== 'demo_level_a') } as CompositionDocument;
    expect(survivingSurface(shown, without)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(survivingSurface({ kind: 'level', id: 'demo_level_a' }, without)).toBeUndefined();
    expect(survivingSurface({ kind: 'page', id: 'gone' }, doc)).toBeUndefined();
    expect(survivingSurface({ kind: 'modal', id: 'demo_sheet' }, doc)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(survivingSurface(undefined, doc)).toBeUndefined();
  });

  it('stands a level for the sheet it is shown in, in the panels that list pages and sheets', () => {
    expect(listedSurface({ kind: 'level', id: 'demo_level_b', sheetId: 'demo_sheet' }, doc)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(listedSurface({ kind: 'level', id: 'demo_level_b' }, doc)).toEqual({ kind: 'modal', id: 'demo_sheet' });
    expect(listedSurface({ kind: 'level', id: 'nowhere' }, doc)).toBeUndefined();
    expect(listedSurface({ kind: 'page', id: 'page-home' }, doc)).toEqual({ kind: 'page', id: 'page-home' });
    expect(listedSurface(undefined, doc)).toBeUndefined();
  });
});
