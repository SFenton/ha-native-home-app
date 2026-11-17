import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex, type SelectionKey } from '../src/preview2/model';
import { categoryOfSurface, emptyTrail, enterLevel, followSelection, leaveLevel, rowKeyFor, setTrail, toggleOpen, trailOf, validTrail } from '../src/workspace2/useLibraryTrail';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
const index = buildDocumentIndex(home);
const page = 'page:page-home' as SelectionKey, status = 'node:hc-status-rail' as SelectionKey;
const key = (value: string) => value as SelectionKey;

describe('the library trail', () => {
  it('starts empty at every root', () => {
    expect(trailOf(emptyTrail, 'tabs')).toEqual([]);
    expect(trailOf(emptyTrail, 'sheets')).toEqual([]);
  });

  it('goes into a container as the path down to it, per rail item, and keeps the others', () => {
    const inside = enterLevel(emptyTrail, 'tabs', index, key('node:hc-home-guest-grid'));
    expect(trailOf(inside, 'tabs')[0]).toBe(page);
    expect(trailOf(inside, 'tabs').at(-1)).toBe('node:hc-home-guest-grid');
    expect(trailOf(inside, 'pages')).toEqual([]);
  });

  it('leaves one level at a time, and from a level directly on a surface to the root', () => {
    const deep = enterLevel(emptyTrail, 'tabs', index, key('node:hc-home-guest-grid'));
    const up = leaveLevel(deep, 'tabs');
    expect(trailOf(up, 'tabs').length).toBe(trailOf(deep, 'tabs').length - 1);
    const onSurface = setTrail(emptyTrail, 'tabs', [page, status]);
    expect(trailOf(leaveLevel(onSurface, 'tabs'), 'tabs')).toEqual([]);
  });

  it('opens and closes a row in place, and with a family opens them all', () => {
    const opened = toggleOpen(emptyTrail, status);
    expect(opened.open).toEqual([status]);
    expect(toggleOpen(opened, status).open).toEqual([]);
    expect(toggleOpen(opened, status, true).open).toEqual([status]);
    expect(toggleOpen(emptyTrail, page, true, [status]).open).toEqual([page, status]);
    expect(toggleOpen(toggleOpen(emptyTrail, page, true, [status]), page, false, [status]).open).toEqual([]);
  });

  it('makes a trail valid again: a gone surface empties it, a gone level goes up to the nearest one left', () => {
    expect(validTrail(index, [])).toEqual([]);
    expect(validTrail(index, [key('page:gone')])).toEqual([]);
    expect(validTrail(index, [page, status])).toEqual([page, status]);
    expect(validTrail(index, [page, key('node:gone')])).toEqual([]);
  });

  it('names the rail item that owns a surface', () => {
    expect(categoryOfSurface(home, page)).toBe('tabs');
    expect(categoryOfSurface(home, key('page:page-security'))).toBe('tabs');
    expect(categoryOfSurface(home, key('modal:hc-weather-sheet'))).toBe('sheets');
    const full = { ...home, modals: home.modals.map(modal => modal.id === 'hc-weather-sheet' ? { ...modal, presentation: { ...modal.presentation, fullScreen: true } } : modal) } as CompositionDocument;
    expect(categoryOfSurface(full, key('modal:hc-weather-sheet'))).toBe('modals');
    expect(categoryOfSurface(home, key('modal:missing'))).toBe('sheets');
    const loose = home.pages.find(item => !home.navigation.tabs.some(tab => tab.pageId === item.id))!;
    expect(categoryOfSurface(home, key(`page:${loose.id}`))).toBe('pages');
  });

  it('follows a selection to its rail item, level and row; nothing for a surface or a missing key', () => {
    const direct = followSelection(home, index, status);
    expect(direct).toMatchObject({ category: 'tabs', surface: page, trail: [] });
    const nested = followSelection(home, index, key('node:hc-home-guest-0'));
    expect(nested?.category).toBe('tabs');
    expect(nested?.trail[0]).toBe(page);
    expect(followSelection(home, index, page)).toBeUndefined();
    expect(followSelection(home, index, undefined)).toBeUndefined();
    expect(followSelection(home, index, key('node:gone'))).toBeUndefined();
  });

  it('stands a tab row in for its page under Tabs only', () => {
    expect(rowKeyFor(home, 'tabs', page)).toBe('tab:hc-tab-home');
    expect(rowKeyFor(home, 'pages', page)).toBe(page);
    expect(rowKeyFor(home, 'tabs', key('page:page-orphan'))).toBe('page:page-orphan');
  });
});
