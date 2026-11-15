import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compilerIssues } from '../src/workspace2/checks';
import { addPage, addSheet, addTab, deleteSurface, duplicateSurface, openerCount, renameSurface, tabRoom } from '../src/workspace2/navigation/edit';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
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
