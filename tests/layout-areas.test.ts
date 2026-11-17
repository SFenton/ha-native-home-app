import { describe, expect, it } from 'vitest';
import { compositionErrors } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { canHold, refusalFor } from '../src/workspace2/add/insert';
import { areaAt, duplicateArea, insertArea, moveArea, removeAreaAt } from '../src/workspace2/layout/areaOps';
import { areaWords, levelRows } from '../src/workspace2/levels';
import { documentWithTabs } from './support/layout-fixture';
import type { TabsNode } from '../src/shared/composition/layout-blocks';

const document = documentWithTabs();
const index = buildDocumentIndex(document);
const tabs = index.entries.get('node:area-tabs')!;
const areaKey = (id: string) => `local-tab:area-tabs/${id}` as never;

describe('the rows of a tab container are its areas, in draw order', () => {
  it('names a shared area "Shared" and a tab area by its tab, with the tab icon', () => {
    const rows = levelRows(document, index, 'node:area-tabs' as never);
    expect(rows.map(row => [row.title, row.type, row.count])).toEqual([['Shared', 'shared-area', 1], ['Lights', 'local-tab', 1], ['Rooms', 'local-tab', 1], ['Info', 'local-tab', 1]]);
    expect(rows[0].context).toBe('Shared Area · 1 item');
    expect(rows[1].icon).toBe('lightbulb');
    expect(rows[1].area).toEqual({ shared: false, tabIds: ['one'], labels: ['Lights'] });
  });
  it('joins the labels of an area for several tabs with commas', () => {
    const node = tabs.node as unknown as TabsNode;
    const several = { ...document, pages: document.pages.map((page, at) => at === 0 ? { ...page, components: page.components.map(item => item.id === 'area-tabs' ? { ...node, blocks: [{ id: 'both', tabs: ['two', 'three'], children: [] }, { id: 'one', tabs: ['one'], children: [] }] } : item) } : page) } as typeof document;
    const words = areaWords(several, buildDocumentIndex(several), areaKey('both'));
    expect(words?.title).toBe('Rooms, Info');
    expect(words?.icon).toBe('square.grid.2x2');
  });
});

describe('area operations', () => {
  const at = () => areaAt(document, index, areaKey('shared-top'))!;
  it('finds an area with its container', () => {
    expect(at()).toMatchObject({ areaId: 'shared-top', position: 0 });
    expect(areaAt(document, index, 'node:area-tabs' as never)).toBeUndefined();
  });
  it('moves an area down one place and keeps the document compiling', () => {
    const moved = moveArea(document, at(), 1);
    const node = buildDocumentIndex(moved).get('node:area-tabs' as never)!.node as unknown as TabsNode;
    expect(node.blocks!.map(block => block.id)).toEqual(['one', 'shared-top', 'two', 'three']);
    expect(compositionErrors(moved)).toEqual([]);
    expect(moveArea(document, at(), -1)).toBe(document);
  });
  it('duplicates an area with fresh ids for it and what it holds', () => {
    const { document: copy, areaId } = duplicateArea(document, at());
    const node = buildDocumentIndex(copy).get('node:area-tabs' as never)!.node as unknown as TabsNode;
    expect(node.blocks!.length).toBe(5);
    const duplicate = node.blocks!.find(block => block.id === areaId)!;
    expect(duplicate.children[0].id).not.toBe('shared-line');
    expect(compositionErrors(copy)).toEqual([]);
  });
  it('refuses to remove an area that holds controls', () => {
    expect(() => removeAreaAt(document, at())).toThrow('Move or delete');
  });
  it('adds a Tab Area for the tab on show, after the selected area', () => {
    const node = tabs.node as unknown as TabsNode;
    const { document: grown, areaId } = insertArea(document, tabs.path, node, { shared: false, tabId: 'two', after: 'one' });
    const next = buildDocumentIndex(grown).get('node:area-tabs' as never)!.node as unknown as TabsNode;
    expect(next.blocks!.map(block => block.id)).toEqual(['shared-top', 'one', areaId, 'two', 'three']);
    expect(next.blocks![2].tabs).toEqual(['two']);
    expect(compositionErrors(grown)).toEqual([]);
  });
  it('adds a Shared Area at the end when nothing is selected', () => {
    const node = tabs.node as unknown as TabsNode;
    const { document: grown } = insertArea(document, tabs.path, node, { shared: true });
    expect((buildDocumentIndex(grown).get('node:area-tabs' as never)!.node as unknown as TabsNode).blocks!.at(-1)!.tabs).toBe('all');
  });
});

describe('what an area can hold', () => {
  it('takes a form or an action bar only when it is for exactly one tab', () => {
    expect(canHold(document, areaKey('shared-top'), 'form')).toBe(false);
    expect(canHold(document, areaKey('shared-top'), 'pinned-actions')).toBe(false);
    expect(canHold(document, areaKey('one'), 'form')).toBe(true);
    expect(canHold(document, areaKey('shared-top'), 'text')).toBe(true);
  });
  it('says why a drag was refused', () => {
    expect(refusalFor(document, areaKey('shared-top'), 'form')).toBe('A form can only go in an area for one tab.');
    expect(refusalFor(document, areaKey('shared-top'), 'pinned-actions')).toBe('An action bar can only go in an area for one tab.');
    expect(refusalFor(document, areaKey('one'), 'form')).toBeUndefined();
  });
});
