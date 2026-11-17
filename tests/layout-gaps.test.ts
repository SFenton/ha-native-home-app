import { describe, expect, it } from 'vitest';
import { addTab, areasOf, type TabsNode } from '../src/shared/composition/layout-blocks';
import { bottomRefusal, overlaysWithStackedControls, tabsWithCutTitles, tabsWithoutIcon } from '../src/workspace2/layout/tabBarRules';
import { removedWords } from '../src/workspace2/layout/LayoutEditors';
import { runChecks } from '../src/workspace2/checks';
import { buildDocumentIndex } from '../src/preview2/model';
import { levelRows, isOverlayLevel, OVERLAY_SLOT } from '../src/workspace2/levels';
import { documentWithTabs } from './support/layout-fixture';

const text = (id: string) => ({ id, title: id, type: 'text', layout: {}, props: { value: { type: 'literal', value: id }, style: 'body', unavailableText: 'x' } });
const withPage = (components: unknown[]) => { const base = documentWithTabs() as never as { pages: { components: unknown[] }[] }; return { ...base, pages: [{ ...base.pages[0], components }, ...base.pages.slice(1)] } as never; };
const overlay = (anchors: unknown[], kids: unknown[]) => ({ id: 'ov', title: 'Overlay', type: 'overlay', layout: {}, props: { anchors }, children: kids });

describe('tab page extras', () => {
  it('a new tab in a container drawn from blocks gets its own empty Tab Area', () => {
    const node = { id: 'c', tabs: [{ id: 'a', label: 'A', children: [] }, { id: 'b', label: 'B', children: [] }], props: {}, blocks: [{ id: 'sh', tabs: 'all', children: [] }] } as unknown as TabsNode;
    const next = addTab(node, { id: 'c3', label: 'C' });
    expect(areasOf(next).map(area => [area.id, area.tabs])).toEqual([['sh', 'all'], ['c3', ['c3']]]);
  });
  it('says what a removed tab took with it', () => {
    expect(removedWords('Rooms', 1)).toBe('Removed Rooms and 1 area.');
    expect(removedWords('Rooms', 3)).toBe('Removed Rooms and 3 areas.');
    expect(removedWords('Rooms', 0)).toBe('Removed Rooms.');
  });
  it('names the tabs with no icon', () => {
    expect(tabsWithoutIcon({ tabs: [{ label: 'Dock' }, { label: 'Home', icon: {} }] } as unknown as TabsNode)).toEqual(['Dock']);
  });
});

describe('Bottom reasons', () => {
  const tabs = (id: string, pinned = false) => ({ id, title: id, type: 'local-tabs', layout: {}, props: { pinned }, tabs: [{ id: 'a', label: 'A', children: [] }, { id: 'b', label: 'B', children: [] }] });
  it('refuses a bar not directly on the page, a second bottom bar, and a page with a form', () => {
    const doc = withPage([{ ...text('sec'), type: 'section', children: [tabs('inner')] }, tabs('one', true), tabs('two')]);
    expect(bottomRefusal(doc, ['pages', 0, 'components', 0, 'children', 0])).toMatch(/directly on the page/);
    expect(bottomRefusal(doc, ['pages', 0, 'components', 2])).toBe('A page holds one bottom bar.');
    expect(bottomRefusal(withPage([tabs('only'), { id: 'f', title: 'f', type: 'form', layout: {}, props: {} }]), ['pages', 0, 'components', 0])).toMatch(/form or an action bar/);
    expect(bottomRefusal(withPage([tabs('only')]), ['pages', 0, 'components', 0])).toBeUndefined();
  });
  it('finds a bar whose titles a phone may cut', () => {
    const many = { ...tabs('t'), tabs: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id, children: [] })) };
    expect(tabsWithCutTitles(withPage([many]))).toHaveLength(1);
    expect(tabsWithCutTitles(withPage([tabs('t')]))).toHaveLength(0);
  });
});

describe('overlay words', () => {
  const doc = withPage([overlay([{ childId: 'p', anchor: 'center', inset: { type: 'points', value: 12 } }, { childId: 'q', anchor: 'center', inset: { type: 'points', value: 12 } }], [text('base'), text('p'), text('q')])]);
  it('tags the base and the position, and the Checks say two share a place', () => {
    const index = buildDocumentIndex(doc);
    const page = `page:${(doc as never as { pages: { id: string }[] }).pages[0].id}` as const;
    const rows = levelRows(doc, index, index.children(page)[0]);
    expect(rows.map(row => row.tags)).toEqual([['Base'], ['Center'], ['Center']]);
    expect(overlaysWithStackedControls(doc)).toHaveLength(1);
    expect(runChecks(doc).suggestions.some(row => /same place/.test(row.sentence))).toBe(true);
  });
  it('an empty overlay level is a drop slot', () => {
    const empty = withPage([overlay([], [])]);
    const index = buildDocumentIndex(empty);
    const key = index.children(`page:${(empty as never as { pages: { id: string }[] }).pages[0].id}`)[0];
    expect(isOverlayLevel(index, key)).toBe(true);
    expect(OVERLAY_SLOT).toBe('Drop a map or a tile here.');
  });
});
