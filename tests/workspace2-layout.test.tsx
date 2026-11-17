// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { TabsNode } from '../src/shared/composition/layout-blocks';
import { compositionErrors } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { insertType } from '../src/workspace2/add/insert';
import { Project } from './support/workspace2-surfaces';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const page = home.pages[0];

/** A document with a fresh tab container (from the Add picker's factory) at the end of the first page. */
function withTabs(): { document: CompositionDocument; id: string } {
  const added = insertType(home, { owner: `page:${page.id}`, list: ['pages', 0, 'components'], index: page.components.length } as never, 'local-tabs');
  return { document: added.document, id: added.key.replace('node:', '') };
}
const entryOf = (document: CompositionDocument, id: string) => [...buildDocumentIndex(document).entries.values()].find(entry => entry.node?.id === id)!;

function mount(start: CompositionDocument, pick: (document: CompositionDocument) => Workspace2['target']) {
  const seen = { document: start };
  render(<Project.Live document={start} seen={next => { seen.document = next; }}>{ws =>
    <PropertiesPanel ws={{ ...ws, target: pick(ws.document!) } as Workspace2} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>}</Project.Live>);
  return seen;
}
const press = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const tabsNode = (document: CompositionDocument, id: string) => entryOf(document, id).node as unknown as TabsNode;

describe('the Add picker makes a tab container that compiles', () => {
  it('adds two tabs and the choice field that mirrors them', () => {
    const { document, id } = withTabs();
    expect(compositionErrors(document)).toEqual([]);
    expect(tabsNode(document, id).tabs.map(tab => tab.label)).toEqual(['One', 'Two']);
    expect(document.localState?.find(field => field.id === tabsNode(document, id).props.stateId)).toMatchObject({ type: 'choice', initial: 'tab-one' });
  });
});

describe('the Tabs list and the Tab Bar group', () => {
  const open = () => {
    const { document, id } = withTabs();
    const seen = mount(document, doc => { const entry = entryOf(doc, id); return { kind: 'node', key: entry.key, path: entry.path }; });
    return { seen, id };
  };
  it('adds a tab, keeps the choice field in step, and refuses a sixth', async () => {
    const { seen, id } = open();
    await press('Add Tab');
    expect(tabsNode(seen.document, id).tabs.map(tab => tab.label)).toEqual(['One', 'Two', 'Tab 3']);
    const field = seen.document.localState!.find(item => item.id === tabsNode(seen.document, id).props.stateId) as { options: { label: string }[] };
    expect(field.options.map(option => option.label)).toEqual(['One', 'Two', 'Tab 3']);
    await press('Add Tab'); await press('Add Tab');
    expect(screen.getByRole('button', { name: 'Add Tab' }).hasAttribute('disabled')).toBe(true);
    expect(compositionErrors(seen.document)).toEqual([]);
  });
  it('removes a tab down to two and no further', async () => {
    const { seen, id } = open();
    expect(screen.getByRole('button', { name: 'Remove One' }).hasAttribute('disabled')).toBe(true);
    await press('Add Tab');
    await press('Remove One');
    expect(tabsNode(seen.document, id).tabs.map(tab => tab.label)).toEqual(['Two', 'Tab 3']);
    expect(compositionErrors(seen.document)).toEqual([]);
  });
  it('writes nothing for Top with Automatic labels, and pinned for Bottom', async () => {
    const { seen, id } = open();
    expect(tabsNode(seen.document, id).props).not.toHaveProperty('tabBar');
    await press('Bottom');
    expect(tabsNode(seen.document, id).props).toMatchObject({ pinned: true });
    expect(tabsNode(seen.document, id).props).not.toHaveProperty('tabBar');
    await press('Top');
    expect(tabsNode(seen.document, id).props).not.toHaveProperty('pinned');
  });
  it('says every tab needs an icon for a bottom bar', async () => {
    open();
    await press('Bottom');
    expect(screen.getByRole('note').textContent).toMatch(/needs an icon/);
  });
  it('adds a Shared Area, which is stored as blocks', async () => {
    const { seen, id } = open();
    await press('Add Shared Area');
    const node = tabsNode(seen.document, id);
    expect(node.blocks?.at(-1)?.tabs).toBe('all');
    expect(node.tabs.every(tab => tab.children.length === 0)).toBe(true);
  });
});

describe('the area inspector', () => {
  it('shows Shows On for a shared area and turns it into a tab area', async () => {
    const { document, id } = withTabs();
    const node = tabsNode(document, id);
    const withShared = { ...document, pages: document.pages.map((item, at) => at === 0 ? { ...item, components: item.components.map(component => component.id === id
      ? { ...node, tabs: node.tabs, blocks: [{ id: 'bar', tabs: 'all', children: [] }, ...node.tabs.map(tab => ({ id: tab.id, tabs: [tab.id], children: [] }))] } : component) } : item) } as CompositionDocument;
    const seen = mount(withShared, doc => { const key = `local-tab:${id}/bar` as const; const entry = buildDocumentIndex(doc).get(key)!; return { kind: 'area', key, path: entry.path }; });
    expect(screen.getByRole('heading', { name: 'Shared Area' })).toBeTruthy();
    const all = screen.getByRole('switch', { name: 'All Tabs' }) as HTMLInputElement;
    expect(all.checked).toBe(true);
    await act(async () => { fireEvent.click(all); });
    expect((tabsNode(seen.document, id).blocks![0].tabs)).toEqual(['tab-one']);
    expect(screen.getByRole('switch', { name: 'Two' })).toBeTruthy();
  });
});

describe('the overlay', () => {
  it('shows a Position row for each child above the base', () => {
    const added = insertType(home, { owner: `page:${page.id}`, list: ['pages', 0, 'components'], index: 0 } as never, 'overlay');
    const id = added.key.replace('node:', '');
    const withTop = { ...added.document, pages: added.document.pages.map((item, at) => at === 0 ? { ...item, components: item.components.map(component => component.id === id
      ? { ...component, children: [...(component as { children: unknown[] }).children, { id: 'top-text', title: 'Badge', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hi' }, style: 'body', unavailableText: 'None' } }], props: { anchors: [{ childId: 'top-text', anchor: 'top-trailing', inset: { type: 'token', name: 'm' } }] } } : component) } : item) } as CompositionDocument;
    mount(withTop, doc => { const entry = entryOf(doc, id); return { kind: 'node', key: entry.key, path: entry.path }; });
    expect(screen.getByRole('heading', { name: 'Position' })).toBeTruthy();
    expect(screen.getByText('Badge')).toBeTruthy();
  });
});
