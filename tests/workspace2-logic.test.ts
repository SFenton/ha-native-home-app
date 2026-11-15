import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { fillTabGroups, groupWithRoom, tabGroups } from '../src/workspace2/capacity';
import { runChecks } from '../src/workspace2/checks';
import { labelFor, labelText, mechanicalLabel } from '../src/workspace2/labels';
import { buildDocumentIndex } from '../src/preview2/model';
import { survivingSelection } from '../src/workspace2/selection';
import { buildOutline, type OutlineRow } from '../src/workspace2/outline';
import { contrast, deriveTheme, over, parseColor, textPairs, type Rgb } from '../src/workspace2/theme';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const colour = (text: string): Rgb => parseColor(text)!;

describe('theme', () => {
  it('reads hex, rgb and rgba', () => {
    expect(parseColor('#e91e63')).toMatchObject({ r: 233, g: 30, b: 99, a: 1 });
    expect(parseColor('rgba(0,0,0,.12)')).toMatchObject({ r: 0, a: 0.12 });
    expect(parseColor('not a colour')).toBeUndefined();
  });

  for (const [name, read] of [
    ['primary only', { '--primary-color': '#e91e63' }],
    ['light', { '--primary-background-color': '#fafafa', '--card-background-color': '#fff', '--primary-text-color': '#212121', '--secondary-text-color': '#727272', '--primary-color': '#03a9f4' }],
    ['dark', { '--primary-background-color': '#111', '--card-background-color': '#1c1c1c', '--primary-text-color': '#e1e1e1', '--secondary-text-color': '#9b9b9b', '--primary-color': '#03a9f4' }],
    ['low-contrast text', { '--primary-background-color': '#fff', '--primary-text-color': '#ddd', '--secondary-text-color': '#eee', '--primary-color': '#ffeb3b' }],
  ] as const) {
    it(`keeps every text pair at 4.5:1 for a ${name} theme`, () => {
      const derived = deriveTheme(read, false);
      const bg = colour(derived.variables['--w2-bg']);
      for (const [text, ground] of textPairs) {
        const ratio = contrast(colour(derived.variables[text]), over(colour(derived.variables[ground]), bg));
        expect(ratio, `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('falls back to the scheme preference when nothing is read, and selects with the primary colour', () => {
    expect(deriveTheme({}, true).dark).toBe(true);
    expect(deriveTheme({}, false).dark).toBe(false);
    const derived = deriveTheme({ '--primary-color': '#e91e63' }, false);
    expect(derived.selection).toBe(derived.variables['--w2-primary']);
  });
});

describe('tab capacity', () => {
  it('holds five in the tab bar and offers no room after that', () => {
    expect(groupWithRoom([1, 2, 3, 4])?.id).toBe('bar');
    expect(groupWithRoom([1, 2, 3, 4, 5])).toBeUndefined();
  });
  it('gains a second group from data alone', () => {
    const groups = [...tabGroups, { id: 'more', title: 'More in the iPad sidebar' }];
    const filled = fillTabGroups([1, 2, 3, 4, 5, 6, 7], groups);
    expect(filled.map(group => group.tabs.length)).toEqual([5, 2]);
    expect(groupWithRoom([1, 2, 3, 4, 5, 6], groups)?.id).toBe('more');
  });
});

describe('outline', () => {
  it('lists every page once, with the sheets in their own group', () => {
    const outline = buildOutline(fixture.document);
    const flat = (rows: OutlineRow[]): OutlineRow[] => rows.flatMap(row => [row, ...flat(row.children)]);
    const ids = outline.groups.flatMap(group => flat(group.rows).filter(row => row.surface.kind === 'page').map(row => row.surface.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(outline.groups.map(group => group.id)).toEqual(expect.arrayContaining(['sheets']));
    for (const page of fixture.document.pages) expect(ids, page.id).toContain(page.id);
  });
  it('starts from the first page when there are no tabs', () => {
    const outline = buildOutline({ ...fixture.document, navigation: { ...fixture.document.navigation, tabs: [] } });
    expect(outline.groups.some(group => group.id === 'start')).toBe(true);
  });
});

describe('checks', () => {
  it('reports no problems for a valid fixture', () => {
    expect(runChecks(fixture.document).problems).toEqual([]);
  });
  it('names where a problem is, in words', () => {
    const broken = structuredClone(fixture.document);
    broken.navigation.tabs = [{ ...broken.navigation.tabs[0], pageId: 'no-such-page' }];
    const { problems } = runChecks(broken);
    expect(problems.length).toBeGreaterThan(0);
    for (const row of problems) { expect(row.sentence).not.toMatch(/\$|#\/|undefined/); expect(row.place.length).toBeGreaterThan(0); }
  });
});

describe('labels', () => {
  it('spells a key as words', () => {
    expect(mechanicalLabel('entityId')).toBe('Entity ID');
    expect(mechanicalLabel('some-long_name')).toBe('Some long name');
  });
  it('prefers the owner entry, then the shared path, then the last key', () => {
    expect(labelText('nothing', ['unmappedThing'])).toBe('Unmapped thing');
    expect(labelFor('project', ['dataSources'])?.add).toBe('Add Source');
  });
});

describe('selection survival across Undo and Redo', () => {
  const emptied = (document: CompositionDocument) => ({
    ...document,
    pages: document.pages.map(page => ({ ...page, components: [] })),
    modals: document.modals.map(modal => ({ ...modal, components: [] })),
  }) as unknown as CompositionDocument;
  it('keeps a selection whose node still exists and drops one the change removed', () => {
    const before = buildDocumentIndex(fixture.document);
    const key = before.keys.find(item => item.startsWith('node:'))!;
    expect(before.get(key)).toBeDefined();
    expect(survivingSelection(key, before)).toBe(key);
    const after = buildDocumentIndex(emptied(fixture.document));
    expect(after.get(key)).toBeUndefined();
    expect(survivingSelection(key, after)).toBeUndefined();
  });
  it('passes through no selection and no index', () => {
    expect(survivingSelection(undefined, undefined)).toBeUndefined();
    expect(survivingSelection('node:x', undefined)).toBe('node:x');
  });
});
