import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addArea, removeArea, syncTabState, addTab, moveTab, removeTab, setAreaTabs, areaTabIds, areasOf, areasOnTab, areasToNode, firstTabOf, fitsShippedTabs, tabBarOf, tabBarToProps, type TabsNode } from '../src/shared/composition/layout-blocks';
import { blocksToTabs, tabsToBlocks } from '../src/shared/composition/migrate';
import { corpusCaseFile } from './corpusCase';
import { sameJson } from '../src/sameJson';
import type { CompositionDocument } from '../src/shared/composition/schema';

const directory = path.resolve(__dirname, '../contract/corpus');
const containerOf = (name: string): TabsNode => {
  const envelope = JSON.parse(readFileSync(corpusCaseFile(directory, name), 'utf8'));
  return envelope.document.pages[2].components[0] as TabsNode;
};
const text = (id: string) => ({ id, title: id, type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: id }, style: 'body', unavailableText: 'None' } }) as never;
const tabsNode = (): TabsNode => ({
  id: 'tabs', title: 'tabs', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'panel', transition: 'canonical-swap@1' },
  tabs: [{ id: 'a', label: 'A', children: [text('one')] }, { id: 'b', label: 'B', children: [text('two')] }, { id: 'c', label: 'C', children: [] }],
});

describe('areas of a tab container', () => {
  it('reads the shipped shape as one area per tab, named by the tab', () => {
    const areas = areasOf(tabsNode());
    expect(areas.map(area => [area.id, area.tabs])).toEqual([['a', ['a']], ['b', ['b']], ['c', ['c']]]);
    expect(areas[0].children).toHaveLength(1);
  });
  it.each(['pending-tab-blocks-shared-tab-shared-tab', 'pending-tab-blocks-all-tabs', 'pending-tab-blocks-two-tabs', 'pending-tab-blocks-block-visible-when'])(
    'areasOf then areasToNode is the identity on %s', name => {
      const node = containerOf(name);
      expect(sameJson(areasToNode(node, areasOf(node)), node)).toBe(true);
    });
  it('writes the shipped shape (no blocks, no capability) while the areas fit it', () => {
    const node = tabsNode();
    const areas = areasOf(node);
    const next = areasToNode(node, areas);
    expect(next.blocks).toBeUndefined();
    expect(sameJson(next, node)).toBe(true);
    // Adding a child to the area for tab c keeps the shipped shape.
    const more = areas.map(area => area.id === 'c' ? { ...area, children: [text('three')] } : area);
    expect(areasToNode(node, more).tabs[2].children).toHaveLength(1);
    expect(areasToNode(node, more).blocks).toBeUndefined();
  });
  it('writes blocks at the first shared area, with every tab\'s own children empty, and the shipped shape again when it is removed', () => {
    const node = tabsNode();
    const shared = { id: 'map', tabs: 'all' as const, children: [text('map')] };
    const withShared = areasToNode(node, [shared, ...areasOf(node)]);
    expect(withShared.blocks?.map(area => area.id)).toEqual(['map', 'a', 'b', 'c']);
    expect(withShared.tabs.every(tab => tab.children.length === 0)).toBe(true);
    const removed = areasToNode(withShared, areasOf(withShared).filter(area => area.id !== 'map'));
    expect(removed.blocks).toBeUndefined();
    expect(removed.tabs[0].children).toHaveLength(1);
  });
  it('needs blocks for a second area on one tab, a multi-tab area, another order and an area rule', () => {
    const ids = ['a', 'b', 'c'];
    const area = (id: string, tabs: string[], rest = {}) => ({ id, tabs, children: [], ...rest });
    expect(fitsShippedTabs([area('a', ['a']), area('b', ['b'])], ids)).toBe(true);
    expect(fitsShippedTabs([area('a', ['a']), area('a2', ['a'])], ids)).toBe(false);
    expect(fitsShippedTabs([area('a', ['a', 'b'])], ids)).toBe(false);
    expect(fitsShippedTabs([area('b', ['b']), area('a', ['a'])], ids)).toBe(false);
    expect(fitsShippedTabs([area('a', ['a'], { visibleWhen: { type: 'viewer', isAdmin: true } })], ids)).toBe(false);
    expect(fitsShippedTabs([{ id: 'x', tabs: 'all', children: [] }], ids)).toBe(false);
  });
  it('finds the areas on a tab in draw order, and the first tab of an area', () => {
    const node = containerOf('pending-tab-blocks-shared-tab-shared-tab');
    const areas = areasOf(node);
    expect(areasOnTab(areas, 'rooms').map(area => area.id)).toEqual(['map', 'readouts', 'rooms-only']);
    expect(areasOnTab(areas, 'dock').map(area => area.id)).toEqual(['map', 'readouts', 'dock-only']);
    expect(areaTabIds(areas[0], node)).toEqual(['controls', 'rooms', 'dock']);
    expect(firstTabOf(areas[3], node)).toBe('rooms');
  });
  it('migrates both ways, pure and idempotent, listing each change', () => {
    const document = { pages: [{ components: [tabsNode()] }] } as unknown as CompositionDocument;
    const to = tabsToBlocks(document);
    expect(to.changes).toHaveLength(1);
    expect((to.document as any).pages[0].components[0].blocks).toHaveLength(3);
    expect(tabsToBlocks(to.document).changes).toEqual([]);
    const back = blocksToTabs(to.document);
    expect(back.changes).toHaveLength(1);
    expect(sameJson(back.document, document)).toBe(true);
    expect(blocksToTabs(back.document).changes).toEqual([]);
    expect(document.pages[0].components[0]).toEqual(tabsNode());
  });
  it('leaves areas that do not fit the shipped shape as blocks', () => {
    const node = containerOf('pending-tab-blocks-all-tabs');
    expect(blocksToTabs({ x: node }).changes).toEqual([]);
  });
});

describe('the tab bar settings (D8)', () => {
  const props = { stateId: 'panel', transition: 'canonical-swap@1' as const };
  it.each([
    ['top', 'by-size', {}],
    ['bottom', 'by-size', { pinned: true }],
    ['top', 'titles', { tabBar: { placement: 'top', labels: 'titles' } }],
    ['top', 'icons', { tabBar: { placement: 'top', labels: 'icons' } }],
    ['top', 'icons-and-titles', { tabBar: { placement: 'top', labels: 'icons-and-titles' } }],
    ['bottom', 'titles', { pinned: true, tabBar: { placement: 'bottom', labels: 'titles' } }],
    ['bottom', 'icons', { pinned: true, tabBar: { placement: 'bottom', labels: 'icons' } }],
    ['bottom', 'icons-and-titles', { pinned: true, tabBar: { placement: 'bottom', labels: 'icons-and-titles' } }],
  ] as const)('%s with %s writes the stored table', (placement, labels, extra) => {
    const written = tabBarToProps(props, placement, labels);
    expect(written).toEqual({ ...props, ...extra });
    expect(tabBarOf(written)).toEqual({ placement, labels });
  });
  it('drops an earlier pinned or tabBar and keeps every other prop', () => {
    const before = { ...props, pinned: true, tabBar: { placement: 'bottom' as const, labels: 'icons' as const }, resetOnPresentation: true };
    expect(tabBarToProps(before, 'top', 'by-size')).toEqual({ ...props, resetOnPresentation: true });
  });
  it('reads pinned alone as the bottom bar with automatic labels', () => {
    expect(tabBarOf({ ...props, pinned: true })).toEqual({ placement: 'bottom', labels: 'by-size' });
    expect(tabBarOf(props)).toEqual({ placement: 'top', labels: 'by-size' });
  });
});

describe('tab operations', () => {
  it('adds a tab, and refuses a sixth', () => {
    let node = tabsNode();
    node = addTab(node, { id: 'd', label: 'D' });
    node = addTab(node, { id: 'e', label: 'E' });
    expect(node.tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(() => addTab(node, { id: 'f', label: 'F' })).toThrow();
  });
  it('removes a tab with its references, and refuses a container below two', () => {
    const base = { ...tabsNode(), props: { stateId: 'panel', transition: 'canonical-swap@1' as const, fallbackTabId: 'b' } };
    const withBlocks: TabsNode = { ...base, tabs: base.tabs.map(tab => ({ ...tab, children: [] })), blocks: areasOf(base) };
    const gone = removeTab(withBlocks, 'b');
    expect(gone.tabs.map(tab => tab.id)).toEqual(['a', 'c']);
    expect(gone.props.fallbackTabId).toBeUndefined();
    expect(gone.blocks?.map(block => block.id)).toEqual(['a', 'c']);
    expect(() => removeTab(gone, 'a')).toThrow();
  });
  it('moves a tab and ignores a move off the end', () => {
    expect(moveTab(tabsNode(), 0, 1).tabs.map(tab => tab.id)).toEqual(['b', 'a', 'c']);
    expect(moveTab(tabsNode(), 0, -1).tabs.map(tab => tab.id)).toEqual(['a', 'b', 'c']);
  });
  it('sets an area to all tabs and back to the shipped shape', () => {
    const shared = setAreaTabs(tabsNode(), 'a', 'all');
    expect(shared.blocks?.[0].tabs).toBe('all');
    const back = setAreaTabs(shared, 'a', ['a']);
    expect(back.blocks).toBeUndefined();
  });
});

describe('area and state operations', () => {
  it('adds a shared area as blocks and removes it again to the shipped shape', () => {
    const node = addArea(tabsNode(), { id: 'bar', shared: true });
    expect(node.blocks?.map(block => [block.id, block.tabs])).toEqual([['a', ['a']], ['b', ['b']], ['c', ['c']], ['bar', 'all']]);
    expect(node.tabs.every(tab => tab.children.length === 0)).toBe(true);
    const back = removeArea(node, 'bar');
    expect(back.blocks).toBeUndefined();
    expect(back.tabs[0].children).toHaveLength(1);
  });
  it('refuses to remove the only area of a tab', () => {
    const base = tabsNode();
    const node: TabsNode = { ...base, tabs: base.tabs.map(tab => ({ ...tab, children: [] })), blocks: [...areasOf(base), { id: 'a-two', tabs: ['a'], children: [] }] };
    expect(() => removeArea(node, 'c')).toThrow('Every tab needs an area');
    expect(removeArea(node, 'a-two').blocks).toBeUndefined();
  });
  it('refuses to remove an area that holds controls', () => {
    expect(() => removeArea(tabsNode(), 'a')).toThrow('Move or delete');
  });
  it('mirrors tabs into the choice field the container names', () => {
    const node = tabsNode();
    const document = { localState: [{ id: 'panel', type: 'choice', initial: 'gone', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] } as unknown as CompositionDocument;
    const next = syncTabState({ ...document }, { ...node, props: { ...node.props, stateId: 'panel' } });
    const field = next.localState![0] as { initial: string; options: { id: string }[] };
    expect(field.options.map(option => option.id)).toEqual(['a', 'b', 'c']);
    expect(field.initial).toBe('a');
    expect(syncTabState(next, { ...node, props: { ...node.props, stateId: 'panel' } })).toBe(next);
  });
});
