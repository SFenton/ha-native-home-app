import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import { allowsSplit, contentSize, isRegularWidth, previewWindows, splitGeometry, splitReadout, usesFlyout, windowLabel, withPose } from '../src/preview2';
import { fillTabGroups, groupWithRoom, tabGroups, type TabGroup } from '../src/workspace2/capacity';
import { compilerIssues, runChecks } from '../src/workspace2/checks';
import { addPage, addSheet, addTab, deleteSurface, duplicateSurface, openerCount, renameSurface, tabRoom } from '../src/workspace2/navigation/edit';

const fixture = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const base = fixture.document;
const compiles = (document: CompositionDocument) => expect(compilerIssues(document)).toEqual([]);

describe('creating pages, sheets and tabs', () => {
  it('adds a page and its navigation tile in one new document', () => {
    const { document, id } = addPage(base, 'Garage', { kind: 'page', id: 'page-home' });
    compiles(document);
    expect(document.pages.some(page => page.id === id && page.title === 'Garage')).toBe(true);
    const home = document.pages.find(page => page.id === 'page-home')!;
    const tile = home.components.at(-1)!;
    expect(tile).toMatchObject({ type: 'navigation-tile', title: 'Garage', action: { type: 'push', pageId: id } });
    expect(openerCount(document, { kind: 'page', id })).toBe(1);
  });

  it('adds a page with no link when it comes from "Nothing yet", and keeps names apart', () => {
    const { document, id } = addPage(base, 'Home');
    compiles(document);
    expect(document.pages.find(page => page.id === id)?.title).toBe('Home 2');
    expect(document.pages.find(page => page.id === 'page-home')?.components.length).toBe(base.pages.find(page => page.id === 'page-home')?.components.length);
  });

  it('links from a sheet too', () => {
    const { document } = addPage(base, 'More', { kind: 'modal', id: 'hc-weather-sheet' });
    compiles(document);
  });

  it('adds a sheet that opens presented', () => {
    const fitted = addSheet(base, 'Quick Look', 'fitted'), full = addSheet(base, 'Everything', 'full');
    compiles(fitted.document); compiles(full.document);
    expect(fitted.document.modals.find(modal => modal.id === fitted.id)?.presentation.height.type).toBe('fitted');
    expect(full.document.modals.find(modal => modal.id === full.id)?.presentation.height.type).toBe('full');
  });

  it('adds a tab with a new page, and stops at five with the reason', () => {
    let document = base;
    expect(tabRoom(document).room).toBe(true);
    for (let at = 0; at < 2; at++) { const made = addTab(document, { label: `Extra ${at}`, icon: 'star' }); document = made.document; compiles(document); }
    expect(document.navigation.tabs).toHaveLength(5);
    expect(tabRoom(document)).toEqual({ room: false, reason: 'The tab bar holds 5.' });
    expect(() => addTab(document, { label: 'Sixth', icon: 'star' })).toThrow('The tab bar holds 5.');
  });

  it('adds a tab onto an existing page', () => {
    const made = addTab(base, { label: 'Again', icon: 'house', pageId: 'page-security-system' });
    compiles(made.document);
    expect(made.document.pages).toHaveLength(base.pages.length);
  });
});

describe('renaming, duplicating and deleting', () => {
  it('renames and duplicates with fresh ids', () => {
    const renamed = renameSurface(base, { kind: 'page', id: 'page-home' }, 'Start');
    expect(renamed.pages[0].title).toBe('Start');
    const copy = duplicateSurface(base, { kind: 'page', id: 'page-security-system' });
    compiles(copy.document);
    const original = base.pages.find(page => page.id === 'page-security-system')!, made = copy.document.pages.find(page => page.id === copy.id)!;
    expect(made.title).toBe('Security System copy');
    expect(made.components.map(node => node.id)).not.toEqual(original.components.map(node => node.id));
  });

  it('deletes a page, its tab and the actions that opened it, and still compiles', () => {
    const climate = { kind: 'page', id: 'page-climate' } as const;
    const result = deleteSurface(base, climate);
    compiles(result.document);
    expect(result.tabs).toBe(1);
    expect(result.document.pages.some(page => page.id === 'page-climate')).toBe(false);
    expect(JSON.stringify(result.document)).not.toContain('page-climate');
  });

  it('deletes a sheet and the tiles that only opened it', () => {
    const result = deleteSurface(base, { kind: 'modal', id: 'hc-weather-sheet' });
    compiles(result.document);
    expect(result.actions).toBeGreaterThan(0);
    expect(JSON.stringify(result.document)).not.toContain('hc-weather-sheet');
  });

  it('moves the first page on when it is deleted, and keeps the last page', () => {
    const result = deleteSurface(base, { kind: 'page', id: 'page-home' });
    compiles(result.document);
    expect(result.document.navigation.initialPageId).not.toBe('page-home');
    let only = base;
    for (const page of base.pages.slice(1)) only = { ...only, pages: only.pages.filter(item => item.id !== page.id) };
    expect(() => deleteSurface(only, { kind: 'page', id: only.pages[0].id })).toThrow('At least one page is required');
  });
});

describe('windows and the split rule', () => {
  const [iphone, folded, duoUpright, duoSideways, ipadUpright, ipadSideways] = previewWindows;

  it('ports SplitPolicy.allowsSplit and agrees with the app on the six known windows', () => {
    // Expectations are the table in SplitPolicy.swift: iPhone, Duo folded, Duo unfolded portrait and iPad portrait never; Duo landscape and iPad landscape allowed.
    const decided = previewWindows.map(win => [win.name, allowsSplit(contentSize(win), isRegularWidth(win.width))]);
    expect(decided).toEqual([
      ['iPhone', false], ['Duo folded', false], ['Duo open, upright', false], ['Duo open, sideways', true], ['iPad upright', false], ['iPad sideways', true],
    ]);
    expect(previewWindows).toHaveLength(6);
  });

  it('follows the rule at its edges: regular, wider than tall, each half 360', () => {
    expect(allowsSplit({ width: 720, height: 700 }, true)).toBe(true);
    expect(allowsSplit({ width: 719, height: 700 }, true)).toBe(false);
    expect(allowsSplit({ width: 800, height: 800 }, true)).toBe(false);
    expect(allowsSplit({ width: 1200, height: 800 }, false)).toBe(false);
  });

  it('reads the split out in points, from the midpoint or the hinge', () => {
    expect(splitReadout(iphone)).toBe('Split view: off');
    expect(splitReadout(folded)).toBe('Split view: off');
    expect(splitReadout(duoUpright)).toBe('Split view: off');
    expect(splitReadout(ipadUpright)).toBe('Split view: off');
    expect(splitReadout(duoSideways)).toBe('Split view: on, 433 and 434 pt');
    expect(splitReadout(withPose(duoSideways, 'book'))).toBe('Split view: on, 455 and 372 pt');
    expect(splitReadout(ipadSideways)).toBe('Split view: on, 596 and 597 pt');
    expect(splitGeometry(withPose(duoSideways, 'book'))).toMatchObject({ hinge: true });
    expect(splitGeometry(ipadSideways)).toMatchObject({ hinge: false, band: 1 });
  });

  it('shows the flyout at regular width with no hinge and no rail (the iPad), and the tab bar or its rail otherwise', () => {
    expect(previewWindows.map(win => usesFlyout(win))).toEqual([false, false, false, false, true, true]);
    expect(usesFlyout(withPose(duoSideways, 'book'))).toBe(false);
  });

  it('lists the windows by size', () => {
    expect(previewWindows.map(windowLabel)).toEqual([
      'iPhone · 402 × 874', 'Duo folded · 466 × 678', 'Duo open, upright · 669 × 951', 'Duo open, sideways · 951 × 669', 'iPad upright · 834 × 1194', 'iPad sideways · 1194 × 834',
    ]);
  });
});

describe('the tab capacity table', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  it('has one group of five today', () => {
    expect(tabGroups).toHaveLength(1);
    expect(fillTabGroups(tabs.slice(0, 5)).map(item => item.tabs.length)).toEqual([5]);
    expect(groupWithRoom(tabs.slice(0, 5))).toBeUndefined();
    expect(groupWithRoom(tabs.slice(0, 4))?.id).toBe('bar');
  });

  it('takes a second group "More in the iPad sidebar" through data alone', () => {
    const groups: TabGroup[] = [...tabGroups, { id: 'sidebar', title: 'More in the iPad sidebar' }];
    const filled = fillTabGroups(tabs, groups);
    expect(filled.map(item => [item.group.title, item.tabs.length])).toEqual([['Tab bar', 5], ['More in the iPad sidebar', 2]]);
    expect(groupWithRoom(tabs, groups)?.id).toBe('sidebar');
    expect(groupWithRoom(tabs.slice(0, 5), groups)?.id).toBe('sidebar');
  });
});

describe('navigation lints', () => {
  const place = (document: CompositionDocument, row: { select?: string }) => row.select ? buildDocumentIndex(document).get(row.select as never) : undefined;
  const suggestions = (document: CompositionDocument) => runChecks(document).suggestions;

  it('names a page with no way in, and the row goes to it', () => {
    const { document, id } = addPage(base, 'Island');
    const row = suggestions(document).find(item => item.sentence === 'Island has no way in.');
    expect(row?.select).toBe(`page:${id}`);
    expect(place(document, row!)?.kind).toBe('page');
    expect(suggestions(base).some(item => item.sentence === 'Island has no way in.')).toBe(false);
  });

  it('names a columns page that links to none', () => {
    const { document, id } = addPage(base, 'Split');
    const next = { ...document, pages: document.pages.map(page => page.id === id ? { ...page, navigation: { type: 'navigation-columns', placeholder: 'Pick one', standalone: false } } : page) } as CompositionDocument;
    const row = suggestions(next).find(item => item.sentence === 'Split opens pages beside it but links to none.');
    expect(row?.select).toBe(`page:${id}`);
    expect(place(next, row!)?.kind).toBe('page');
  });

  it('names an adaptive sheet whose page is not a columns page', () => {
    const next = { ...base, modals: base.modals.map(modal => modal.id === 'hc-weather-sheet' ? { ...modal, presentation: { ...modal.presentation, adaptive: true } } : modal) } as CompositionDocument;
    const row = suggestions(next).find(item => item.sentence === 'Weather opens beside a list, but its page does not.');
    expect(row?.select).toBe('modal:hc-weather-sheet');
    expect(place(next, row!)?.kind).toBe('modal');
  });

  it('names two links that use one path, and the row goes to the page', () => {
    const route = (id: string, pageId: string) => ({ id, path: 'garage', pageId, title: 'Garage', summary: 'Garage', icon: 'house' });
    const next = { ...base, extensions: { type: 'native-extensions@1', watch: 'stub@1', routes: [route('r1', 'page-home'), route('r2', 'page-climate')], cameras: [] } } as CompositionDocument;
    const rows = suggestions(next).filter(item => item.sentence === 'Two links use the path garage.');
    expect(rows).toHaveLength(1);
    expect(rows[0].select).toBe('page:page-climate');
    expect(place(next, rows[0])?.kind).toBe('page');
  });

  it('says the tab bar holds five and goes to the sixth tab', () => {
    const tab = (at: number) => ({ id: `t${at}`, label: `Tab ${at}`, icon: base.navigation.tabs[0].icon, pageId: 'page-home', arguments: {} });
    const next = { ...base, navigation: { ...base.navigation, tabs: [...base.navigation.tabs, tab(4), tab(5), tab(6)] } } as CompositionDocument;
    const row = suggestions(next).find(item => item.id === 'tab-bar');
    expect(row?.sentence).toBe('The tab bar holds 5.');
    expect(row?.select).toBe('tab:t6');
    expect(place(next, row!)?.kind).toBe('tab');
  });
});
