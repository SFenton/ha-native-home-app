import { describe, expect, it } from 'vitest';
import { createComponent } from '../src/shared/catalog';
import { createSampleDocument } from '../src/shared/sample';
import { allComponents, assertCanRemoveComponent, deleteSurface, duplicateComponent, duplicatePage, findComponent, insertComponent, interactionReferences, moveComponent, reorderComponent, safeHttpUrl } from '../src/editor';
import { validateDocument } from '../src/shared/schema';

describe('editor structural operations', () => {
  it('remaps copied sheet self-destinations and clears copied-sheet controls when the sheet is deleted', () => {
    const document = createSampleDocument(), sheet = document.modals[0], stack = createComponent('section'), detail = createComponent('section'), link = createComponent('action-tile');
    stack.props.presentation = 'navigation-stack'; stack.children = [createComponent('section'), detail];
    link.action = { type: 'modal', modalId: sheet.id }; link.props.initialDestinationId = detail.id;
    sheet.components = [stack, link];
    sheet.floatingButtons = [{ id: 'reopen-sheet', label: 'Open', icon: '', action: { type: 'modal', modalId: sheet.id } }];
    const copy = duplicatePage(sheet);
    document.modals.push(copy);
    const externalLink = structuredClone(link);
    externalLink.id = 'external-sheet-link';
    document.pages[0].components.push(externalLink);
    expect(copy.components[1].action).toEqual({ type: 'modal', modalId: copy.id });
    expect(copy.components[1].props.initialDestinationId).toBe(copy.components[0].children![1].id);
    document.pages[0].floatingButtons = [{ id: 'open-copy', label: 'Open', icon: '', action: { type: 'modal', modalId: copy.id } }];
    const list = createComponent('list');
    document.dataSources.push({ id: 'row-records', name: 'Records', kind: 'static', refreshSeconds: 30, sample: [{ key: 'one' }] });
    list.binding = { sourceId: 'row-records' };
    list.rowActions = { keyPath: 'key', leading: [{ id: 'open-copy-row', label: 'Open', icon: '', action: { type: 'modal', modalId: copy.id } }], trailing: [] };
    document.pages[0].components.push(list);
    expect(() => validateDocument(document)).not.toThrow();
    deleteSurface(document, { kind: 'modal', id: copy.id });
    expect(document.pages[0].floatingButtons[0].action).toEqual({ type: 'none' });
    expect(list.rowActions.leading[0].action).toEqual({ type: 'none' });
    deleteSurface(document, { kind: 'modal', id: sheet.id });
    expect(externalLink.action).toEqual({ type: 'none' });
    expect(externalLink.props.initialDestinationId).toBeUndefined();
    expect(() => validateDocument(document)).not.toThrow();
  });
  it('duplicates surface interaction IDs and remaps only internal component targets', () => {
    const document = createSampleDocument(), page = document.pages[0], root = createComponent('section'), list = createComponent('list');
    root.props.nativeTodoPage = true; root.children = [list];
    list.rowActions = { leading: [{ id: 'old-row', label: 'Go', icon: '', action: { type: 'navigate', pageId: document.pages[1].id } }], trailing: [] };
    page.components = [root];
    page.floatingButtons = [{ id: 'old-floating', label: 'Add', icon: '', action: { type: 'todo-add', componentId: root.id } }];
    page.search = { id: 'old-search', label: 'Find', placeholder: 'Find', mode: 'filter', queryVariable: 'query', paths: ['summary'], targetComponentIds: [root.id] };
    const copy = duplicatePage(page);
    expect(copy.id).not.toBe(page.id);
    expect(copy.search!.id).not.toBe(page.search.id);
    expect(copy.search).toMatchObject({ targetComponentIds: [copy.components[0].id] });
    expect(copy.floatingButtons![0].action).toEqual({ type: 'todo-add', componentId: copy.components[0].id });
    expect(copy.floatingButtons![0].id).not.toBe('old-floating');
    expect(copy.components[0].children![0].rowActions!.leading[0].id).not.toBe('old-row');
    expect(copy.components[0].children![0].rowActions!.leading[0].action).toEqual(list.rowActions.leading[0].action);
  });
  it('guards dependent deletion and reports source/variable references in new controls', () => {
    const document = createSampleDocument(), page = document.pages[0], list = createComponent('list');
    list.binding = { sourceId: 'records' };
    page.components = [list];
    page.search = { id: 'search', label: 'Find', placeholder: 'Find', mode: 'filter', queryVariable: 'query', targetComponentIds: [list.id], paths: ['title'] };
    expect(() => assertCanRemoveComponent(page, list.id)).toThrow('floating actions or search');
    expect(interactionReferences(document, 'variable', 'query')).toBe(true);
    page.search = { id: 'search', label: 'Find', placeholder: 'Find', mode: 'endpoint', sourceId: 'records' };
    expect(interactionReferences(document, 'source', 'records')).toBe(true);
    expect(() => assertCanRemoveComponent(page, list.id)).toThrow('last bound component');
    delete page.search;
    page.floatingButtons = [{ id: 'float', label: 'Set', icon: '', action: { type: 'set', variable: 'query', value: '' } }];
    expect(interactionReferences(document, 'variable', 'query')).toBe(true);
    expect(() => assertCanRemoveComponent(page, list.id)).not.toThrow();
  });
  it('uses the indicated before/after edge regardless of movement direction or nesting', () => {
    const [first, middle, last] = [createComponent('text'), createComponent('text'), createComponent('text')];
    const components = [first, middle, last];
    expect(moveComponent(components, first.id, last.id, false, 'before')).toBe(true);
    expect(components).toEqual([middle, first, last]);
    expect(moveComponent(components, last.id, middle.id, false, 'after')).toBe(true);
    expect(components).toEqual([middle, last, first]);
    const group = createComponent('section'); group.children = [createComponent('text')]; components.push(group);
    expect(moveComponent(components, first.id, group.children[0].id, false, 'before')).toBe(true);
    expect(group.children[0]).toBe(first);
    const added = createComponent('text');
    insertComponent(components, added, first.id, false, 'before');
    expect(group.children.slice(0, 2)).toEqual([added, first]);
  });
  it('inserts after the selection at its own nesting level, including selected containers', () => {
    const group = createComponent('section');
    const first = createComponent('text');
    const last = createComponent('text');
    group.children = [first, last];
    const components = [group];
    const nested = createComponent('status-chip');
    insertComponent(components, nested, first.id);
    expect(group.children).toEqual([first, nested, last]);
    const sibling = createComponent('heading');
    insertComponent(components, sibling, group.id);
    expect(components).toEqual([group, sibling]);
    const child = createComponent('text');
    insertComponent(components, child, group.id, true);
    expect(group.children.at(-1)).toBe(child);
    const root = createComponent('text');
    insertComponent(components, root);
    expect(components.at(-1)).toBe(root);
  });
  it('duplicates a nested subtree without reusing IDs or mutating its source', () => {
    const section = createComponent('section');
    const child = createComponent('tile-grid');
    child.children = [createComponent('action-tile')];
    section.children = [child];
    const duplicate = duplicateComponent(section);
    expect(duplicate.id).not.toBe(section.id);
    expect(duplicate.children?.[0].id).not.toBe(child.id);
    expect(duplicate.children?.[0].children?.[0].id).not.toBe(child.children[0].id);
    duplicate.children![0].title = 'Edited copy';
    expect(section.children[0].title).toBe('Tile grid');
  });

  it('moves complete subtrees between containers and rejects ancestor cycles', () => {
    const left = createComponent('section');
    const right = createComponent('section');
    const nested = createComponent('tile-grid');
    nested.children = [createComponent('text')];
    left.children = [nested];
    const components = [left, right];
    const before = structuredClone(components);
    expect(moveComponent(components, left.id, nested.children[0].id, true)).toBe(false);
    expect(components).toEqual(before);
    expect(moveComponent(components, nested.id, right.id, true)).toBe(true);
    expect(left.children).toEqual([]);
    expect(right.children).toEqual([nested]);
    expect(findComponent(components, nested.children[0].id)).toBe(nested.children[0]);
  });

  it('reorders downward correctly and keeps keyboard boundary moves harmless', () => {
    const components = [createComponent('text'), createComponent('heading'), createComponent('profile')];
    const [first, second, third] = components;
    expect(moveComponent(components, first.id, third.id)).toBe(true);
    expect(components.map(item => item.id)).toEqual([second.id, third.id, first.id]);
    reorderComponent(components, first.id, 1);
    expect(components[2]).toBe(first);
    reorderComponent(components, first.id, -1);
    expect(components[1]).toBe(first);
  });

  it('deletes page references across components, activities, chrome, and tabs', () => {
    const document = createSampleDocument();
    const deleted = document.pages[0].id;
    const remaining = document.pages[1];
    remaining.toolbar.push({ id: 'test-toolbar', label: 'Back', icon: 'House', placement: 'leading', action: { type: 'navigate', pageId: deleted } });
    const activityItem = createComponent('action-tile');
    activityItem.action = { type: 'navigate', pageId: deleted };
    document.liveActivities[0].variants.expanded.push(activityItem);
    deleteSurface(document, { kind: 'page', id: deleted });
    expect(document.pages.some(page => page.id === deleted)).toBe(false);
    expect(document.navigation.initialPageId).toBe(remaining.id);
    expect(document.navigation.tabs.some(tab => tab.pageId === deleted)).toBe(false);
    expect(remaining.toolbar.at(-1)?.action).toEqual({ type: 'none' });
    expect(activityItem.action).toEqual({ type: 'none' });
    expect(allComponents(document).some(item => item.action?.type === 'navigate' && item.action.pageId === deleted)).toBe(false);
    while (document.pages.length > 1) deleteSurface(document, { kind: 'page', id: document.pages[1].id });
    expect(() => deleteSurface(document, { kind: 'page', id: remaining.id })).toThrow('Keep at least one page');
  });
});

describe('preview web links', () => {
  it('allows only complete HTTP(S) addresses without embedded credentials', () => {
    expect(safeHttpUrl('https://example.com/help')).toBe('https://example.com/help');
    for (const address of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com', '/relative', 'https://user:secret@example.com']) {
      expect(safeHttpUrl(address)).toBeUndefined();
    }
  });
  it('resolves validated root-relative actions against the browser origin, never an external host', () => {
    const document = createSampleDocument();
    document.pages[0].components[0].action = { type: 'url', url: '/help?from=studio' };
    expect(() => validateDocument(document)).not.toThrow();
    const base = 'https://studio.example/api/hassio_ingress/session/';
    expect(safeHttpUrl('/help?from=studio', base)).toBe('https://studio.example/help?from=studio');
    for (const url of ['//elsewhere.example/help', '/\\elsewhere.example', 'https://user:pass@elsewhere.example', '/\nhelp']) {
      expect(safeHttpUrl(url, base)).toBeUndefined();
    }
  });
});
