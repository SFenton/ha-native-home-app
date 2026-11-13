import { describe, expect, it } from 'vitest';
import { createComponent } from '../src/shared/catalog';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';
import type { Component, StudioDocument } from '../src/shared/types';
import { linkedPageIds, owningTabIds } from '../src/shared/navigation';
import { addLinkedPage, addPageLink, addSidebarTab, createSidebarPage, movePageLink, pageLinks, relocateComponent, removeTab, reorderTab, unlinkPage } from '../src/sidebar-commands';

function fixture(): StudioDocument {
  const document = createSampleDocument();
  document.pages = ['a', 'b', 'child', 'deep', 'shared', 'orphan'].map(id => createSidebarPage(id, id));
  document.navigation = { initialPageId: 'a', tabs: [
    { id: 'tab-a', label: 'A', icon: 'home', pageId: 'a' },
    { id: 'tab-b', label: 'B', icon: 'home', pageId: 'b' },
  ] };
  document.modals = []; document.liveActivities = []; document.dataSources = []; document.variables = {};
  return document;
}

function tile(id: string, pageId?: string): Component {
  return { ...createComponent('navigation-tile'), id, title: id, ...(pageId ? { action: { type: 'navigate', pageId } as const } : {}) };
}

describe('configured navigation ownership', () => {
  it('includes floating and row-action routes through modal links', () => {
    const document = fixture();
    document.pages[0].floatingButtons = [{ id: 'help', label: 'Help', icon: 'info', action: { type: 'modal', modalId: 'sheet' } }];
    document.modals = [{
      ...createSidebarPage('sheet', 'Sheet'), presentation: 'sheet', detent: 'large',
      floatingButtons: [{ id: 'child', label: 'Child', icon: 'home', action: { type: 'navigate', pageId: 'child' } }],
    }];
    document.pages[0].components = [{ ...createComponent('list'), id: 'rows', rowActions: {
      keyPath: 'id', leading: [{ id: 'shared', label: 'Shared', icon: 'home', action: { type: 'navigate', pageId: 'shared' } }], trailing: [],
    } }];
    expect(linkedPageIds(document, 'a')).toEqual(['child', 'shared']);
    expect(owningTabIds(document, 'shared')).toEqual(['tab-a']);
    expect(owningTabIds(document, 'child')).toEqual(['tab-a']);
  });

  it('follows nested links and page cycles without crossing another tab root', () => {
    const document = fixture();
    document.pages[0].components = [{ ...createComponent('section'), children: [tile('to-child', 'child'), tile('to-b', 'b')] }];
    document.pages[1].components = [tile('b-to-shared', 'shared')];
    document.pages[2].components = [tile('to-deep', 'deep')];
    document.pages[3].components = [tile('back-to-child', 'child'), tile('back-to-a', 'a')];
    expect(owningTabIds(document, 'a')).toEqual(['tab-a']);
    expect(owningTabIds(document, 'b')).toEqual(['tab-b']);
    expect(owningTabIds(document, 'deep')).toEqual(['tab-a']);
    expect(owningTabIds(document, 'shared')).toEqual(['tab-b']);
    expect(owningTabIds(document, 'orphan')).toEqual([]);
    expect(owningTabIds(document, 'missing')).toEqual([]);
  });

  it('handles shared pages, toolbar links, cyclic modals and multiple tabs with the same root in tab order', () => {
    const document = fixture();
    document.pages[0].toolbar = [{ id: 'open-sheet', label: 'Open', icon: 'home', placement: 'leading', action: { type: 'modal', modalId: 'sheet' } }];
    document.pages[1].components = [tile('b-shared', 'shared')];
    document.modals = [
      { ...createSidebarPage('sheet', 'Sheet'), presentation: 'sheet', detent: 'large',
        components: [{ ...createComponent('section'), children: [{ ...tile('open-other'), action: { type: 'modal', modalId: 'other' } }] }] },
      { ...createSidebarPage('other', 'Other'), presentation: 'sheet', detent: 'large',
        components: [tile('sheet-shared', 'shared'), { ...tile('cycle'), action: { type: 'modal', modalId: 'sheet' } }],
        toolbar: [{ id: 'sheet-child', label: 'Child', icon: 'home', placement: 'trailing', action: { type: 'navigate', pageId: 'child' } }] },
    ];
    document.navigation.tabs.unshift({ id: 'also-a', label: 'Also A', icon: 'home', pageId: 'a' });
    expect(linkedPageIds(document, 'a')).toEqual(['child', 'shared']);
    expect(owningTabIds(document, 'shared')).toEqual(['also-a', 'tab-a', 'tab-b']);
    expect(owningTabIds(document, 'child')).toEqual(['also-a', 'tab-a']);
    expect(owningTabIds(document, 'a')).toEqual(['also-a', 'tab-a']);
  });
});

describe('sidebar structural commands', () => {
  it('preserves search targets on cross-surface moves while allowing same-surface reordering', () => {
    const document = fixture(), source = { kind: 'page', id: 'a' } as const;
    document.variables.query = '';
    document.dataSources = [{ id: 'rows', name: 'Rows', kind: 'static', sample: [], refreshSeconds: 30 }];
    document.pages[0].components = [{ ...createComponent('list'), id: 'rows', binding: { sourceId: 'rows' } }, tile('other')];
    document.pages[0].search = { id: 'filter', label: 'Filter', placeholder: 'Search', mode: 'filter', queryVariable: 'query', targetComponentIds: ['rows'], paths: ['title'] };
    expect(() => validateDocument(document)).not.toThrow();
    const before = structuredClone(document);
    expect(() => relocateComponent(document, source, 'rows', { kind: 'page', id: 'b' }, { kind: 'end' })).toThrow('floating actions or search');
    expect(document).toEqual(before);
    relocateComponent(document, source, 'rows', source, { kind: 'end' });
    expect(document.pages[0].components.map(item => item.id)).toEqual(['other', 'rows']);
    expect(() => validateDocument(document)).not.toThrow();
  });

  it('adds a valid editable route and page together, and preserves pages when removing a tab', () => {
    const document = fixture();
    const page = createSidebarPage('new-child', 'New child');
    addLinkedPage(document, page, 'a');
    expect(document.pages[0].components.at(-1)).toMatchObject({ type: 'navigation-tile', title: 'New child', action: { type: 'navigate', pageId: page.id } });
    expect(owningTabIds(document, page.id)).toEqual(['tab-a']);
    addSidebarTab(document, { id: 'new-tab', label: 'New', icon: 'home', pageId: 'new-root' }, createSidebarPage('new-root', 'New'));
    reorderTab(document, 'new-tab', -1);
    expect(document.navigation.tabs.map(tab => tab.id)).toEqual(['tab-a', 'new-tab', 'tab-b']);
    const pages = structuredClone(document.pages);
    removeTab(document, 'tab-a');
    expect(document.pages).toEqual(pages);
    expect(owningTabIds(document, page.id)).toEqual([]);
    expect(() => validateDocument(document)).not.toThrow();
    expect(() => addLinkedPage(document, createSidebarPage('lost', 'Lost'), 'missing')).toThrow('parent page');
    expect(document.pages.some(page => page.id === 'lost')).toBe(false);
  });

  it('places components exactly before/after siblings in both directions and nests or unnests whole subtrees', () => {
    const document = fixture();
    document.pages[0].components = [tile('one'), tile('two'), tile('three'), { ...createComponent('section'), id: 'group', children: [tile('nested')] }];
    const target = { kind: 'page', id: 'a' } as const;
    relocateComponent(document, target, 'one', target, { kind: 'before', anchorId: 'three' });
    expect(document.pages[0].components.map(item => item.id)).toEqual(['two', 'one', 'three', 'group']);
    relocateComponent(document, target, 'three', target, { kind: 'after', anchorId: 'two' });
    expect(document.pages[0].components.map(item => item.id)).toEqual(['two', 'three', 'one', 'group']);
    relocateComponent(document, target, 'one', target, { kind: 'inside', anchorId: 'group' });
    expect(document.pages[0].components.at(-1)?.children?.map(item => item.id)).toEqual(['nested', 'one']);
    relocateComponent(document, target, 'nested', target, { kind: 'start' });
    expect(document.pages[0].components[0].id).toBe('nested');
    relocateComponent(document, target, 'group', { kind: 'page', id: 'b' }, { kind: 'end' });
    expect(document.pages[1].components[0].children?.map(item => item.id)).toEqual(['one']);
    expect(() => validateDocument(document)).not.toThrow();
  });

  it('rejects self/descendant cycles, non-container nesting and missing destinations before removal', () => {
    const document = fixture();
    document.pages[0].components = [{ ...createComponent('section'), id: 'outer', children: [{ ...createComponent('section'), id: 'inner', children: [] }] }, tile('plain')];
    const target = { kind: 'page', id: 'a' } as const;
    const before = structuredClone(document);
    for (const anchorId of ['outer', 'inner']) {
      expect(() => relocateComponent(document, target, 'outer', target, { kind: 'inside', anchorId })).toThrow('descendants');
      expect(document).toEqual(before);
    }
    expect(() => relocateComponent(document, target, 'outer', target, { kind: 'inside', anchorId: 'plain' })).toThrow('Only groups');
    expect(() => relocateComponent(document, target, 'outer', target, { kind: 'before', anchorId: 'missing' })).toThrow('insertion target');
    expect(document).toEqual(before);
  });

  it('moves one chosen nested route without erasing other owners, and clears only a chosen action', () => {
    const document = fixture();
    document.pages[0].components = [{ ...createComponent('section'), id: 'group', children: [tile('first', 'shared'), tile('second', 'shared')] }];
    document.pages[1].components = [tile('anchor')];
    const reference = pageLinks(document, 'shared')[0];
    movePageLink(document, 'shared', reference, 'b', { kind: 'before', anchorId: 'anchor' });
    expect(document.pages[1].components.map(item => item.id)).toEqual(['first', 'anchor']);
    expect(owningTabIds(document, 'shared')).toEqual(['tab-a', 'tab-b']);
    const remaining = pageLinks(document, 'shared').find(link => link.id === 'second')!;
    unlinkPage(document, 'shared', remaining);
    expect(document.pages[0].components[0].children?.[0]).toMatchObject({ id: 'second', action: { type: 'none' } });
    expect(owningTabIds(document, 'shared')).toEqual(['tab-b']);
    expect(() => movePageLink(document, 'shared', remaining, 'b', { kind: 'end' })).toThrow('This link changed');
    expect(() => validateDocument(document)).not.toThrow();
  });

  it('preserves toolbar placement and resolves toolbar-local ID collisions when moving a link', () => {
    const document = fixture();
    document.pages[0].toolbar = [{ id: 'local-id', label: 'Child', icon: 'home', placement: 'leading', action: { type: 'navigate', pageId: 'child' } }];
    document.pages[1].toolbar = [{ id: 'local-id', label: 'Other', icon: 'home', placement: 'trailing', action: { type: 'none' } }];
    movePageLink(document, 'child', pageLinks(document, 'child')[0], 'b', { kind: 'start' });
    expect(document.pages[0].toolbar).toEqual([]);
    expect(document.pages[1].toolbar[0]).toMatchObject({ label: 'Child', placement: 'leading', action: { type: 'navigate', pageId: 'child' } });
    expect(document.pages[1].toolbar[0].id).not.toBe('local-id');
    expect(() => validateDocument(document)).not.toThrow();
  });

  it('inserts a new page link at an explicit nested position without any persistent parent field', () => {
    const document = fixture();
    document.pages[0].components = [{ ...createComponent('section'), id: 'group', children: [] }];
    addPageLink(document, 'orphan', 'a', { kind: 'inside', anchorId: 'group' });
    expect(document.pages[0].components[0].children?.[0].action).toEqual({ type: 'navigate', pageId: 'orphan' });
    expect(owningTabIds(document, 'orphan')).toEqual(['tab-a']);
    expect(document.pages.find(page => page.id === 'orphan')).not.toHaveProperty('parent');
    expect(() => validateDocument(document)).not.toThrow();
  });
});
