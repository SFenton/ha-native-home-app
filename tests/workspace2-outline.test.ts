import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { libraryGroups, surfaceWord } from '../src/workspace2/outline';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
/** The fixture with one sheet made a Modal (Full Screen on). */
const withModal = (): CompositionDocument => ({ ...home, modals: home.modals.map(modal => modal.id === 'hc-weather-sheet' ? { ...modal, presentation: { ...modal.presentation, fullScreen: true } } : modal) }) as CompositionDocument;

describe('surfaceWord', () => {
  it('calls a modals[] entry a Modal when it is full screen, else a Sheet', () => {
    expect(surfaceWord({ presentation: { fullScreen: true } } as never)).toBe('Modal');
    expect(surfaceWord({ presentation: { fullScreen: false } } as never)).toBe('Sheet');
    expect(surfaceWord({ presentation: {} } as never)).toBe('Sheet');
  });
});

describe('libraryGroups', () => {
  it('Tabs lists the tab bar in order, one row per tab, naming the tab and standing for its page', () => {
    const [group] = libraryGroups(home, 'tabs');
    expect(group.id).toBe('tabs');
    expect(group.rows.map(row => row.title)).toEqual(['Home', 'Security', 'Climate']);
    expect(group.rows.map(row => row.key)).toEqual(['tab:hc-tab-home', 'tab:hc-tab-security', 'tab:hc-tab-climate']);
    expect(group.rows[1].surface).toEqual({ kind: 'page', id: 'page-security' });
  });

  it('Tabs lists the start page alone, under Start, when there is no tab bar', () => {
    const none = { ...home, navigation: { ...home.navigation, tabs: [] } } as CompositionDocument;
    const groups = libraryGroups(none, 'tabs');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'start', title: 'Start' });
    expect(groups[0].rows.map(row => row.key)).toEqual([`page:${home.navigation.initialPageId}`]);
    expect(libraryGroups({ ...none, navigation: { ...none.navigation, initialPageId: 'missing' } } as CompositionDocument, 'tabs')).toEqual([]);
  });

  it('Pages keeps out every page a tab shows and groups the rest by where they are reached from', () => {
    const groups = libraryGroups(home, 'pages');
    const rows = groups.flatMap(group => group.rows);
    expect(rows.some(row => ['page-home', 'page-security', 'page-climate'].includes(row.surface.id))).toBe(false);
    expect(groups.every(group => group.rows.length > 0)).toBe(true);
    expect(groups.map(group => group.title).some(title => title.startsWith('From '))).toBe(true);
    expect(new Set(groups.map(group => group.id)).size).toBe(groups.length);
    expect(rows.every(row => row.key.startsWith('page:'))).toBe(true);
  });

  it('Sheets lists the modals[] entries that are not full screen; Modals the ones that are', () => {
    const doc = withModal();
    const sheets = libraryGroups(doc, 'sheets').flatMap(group => group.rows), modals = libraryGroups(doc, 'modals').flatMap(group => group.rows);
    expect(modals.map(row => row.surface.id)).toEqual(['hc-weather-sheet']);
    expect(sheets.some(row => row.surface.id === 'hc-weather-sheet')).toBe(false);
    expect(sheets.length + modals.length).toBe(doc.modals.length);
    expect(libraryGroups(home, 'modals')).toEqual([]);
  });

  it('a sheet no control opens is under Not Linked and carries the No Way In tag', () => {
    const groups = libraryGroups(home, 'sheets');
    const loose = groups.find(group => group.id === 'loose');
    if (loose) expect(loose.rows.every(row => row.tags.includes('No Way In'))).toBe(true);
    expect(groups.filter(group => group.id !== 'loose').flatMap(group => group.rows).every(row => !row.tags.includes('No Way In'))).toBe(true);
  });
});
