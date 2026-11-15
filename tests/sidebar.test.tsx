// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import Sidebar, { type WorkspaceView } from '../src/Sidebar';
import { createSampleDocument } from '../src/shared/sample';
import { createComponent } from '../src/shared/catalog';
import type { Component, StudioDocument } from '../src/shared/types';
import { owningTabIds } from '../src/shared/navigation';
import { createSidebarPage } from '../src/sidebar-commands';
import { getComponents, insertComponent, removeComponent, reorderComponent, type Target } from '../src/editor';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

function fixture(): StudioDocument {
  const document = createSampleDocument();
  document.pages = ['Home', 'Settings', 'Child', 'Shared', 'Orphan'].map(title => createSidebarPage(title.toLowerCase(), title));
  document.navigation = { initialPageId: 'home', tabs: [
    { id: 'tab-home', label: 'Home', icon: 'home', pageId: 'home' },
    { id: 'tab-settings', label: 'Settings', icon: 'settings', pageId: 'settings' },
  ] };
  document.modals = []; document.liveActivities = []; document.dataSources = []; document.variables = {};
  document.pages[0].components = [
    { ...createComponent('section'), id: 'group', title: 'Group', children: [
      { ...createComponent('navigation-tile'), id: 'child-link', title: 'Open child', action: { type: 'navigate', pageId: 'child' } },
    ] },
    { ...createComponent('navigation-tile'), id: 'shared-link', title: 'Open shared', action: { type: 'navigate', pageId: 'shared' } },
    { ...createComponent('text'), id: 'keep', title: 'Keep me' },
    { ...createComponent('text'), id: 'other', title: 'Other component' },
  ];
  document.pages[1].components = [{ ...createComponent('navigation-tile'), id: 'other-shared', title: 'Also shared', action: { type: 'navigate', pageId: 'shared' } }];
  return document;
}

function Harness({ initial = fixture(), onAdd = vi.fn() }: { initial?: StudioDocument; onAdd?: (type: string) => void }) {
  const [document, setDocument] = useState(initial);
  const [target, setTarget] = useState<Target>({ kind: 'page', id: 'home' });
  const [selection, setSelection] = useState<string | undefined>('keep');
  const [view, setView] = useState<WorkspaceView>('design');
  const past = useRef<StudioDocument[]>([]);
  const apply = (change: (draft: StudioDocument) => void) => {
    const next = structuredClone(document);
    change(next); past.current.push(document); setDocument(next);
  };
  return <DndContext>
    <button onClick={() => { const previous = past.current.pop(); if (previous) setDocument(previous); }}>Undo change</button>
    <Sidebar document={document} target={target} selection={selection} view={view} apply={apply}
      onView={setView} onTarget={next => { setTarget(next); setSelection(undefined); }} onSelect={setSelection}
      onNewSurface={vi.fn()} onDeleteSurface={vi.fn()}
      onMove={(id, offset) => apply(draft => reorderComponent(getComponents(draft, target), id, offset))}
      onDelete={id => apply(draft => removeComponent(getComponents(draft, target), id))}
      onAdd={type => { onAdd(type); apply(draft => insertComponent(getComponents(draft, target), createComponent(type), selection)); }}/>
    <output hidden data-testid="document">{JSON.stringify(document)}</output>
    <output hidden data-testid="target">{target.id}</output>
    <output hidden data-testid="selection">{selection}</output>
  </DndContext>;
}
function currentDocument(): StudioDocument { return JSON.parse(screen.getByTestId('document').textContent!); }
function pageButton(title: string): HTMLButtonElement {
  const button = [...globalThis.document.querySelectorAll<HTMLButtonElement>('.page-row')].find(item => item.textContent?.startsWith(title));
  if (!button) throw new Error(`Missing page ${title}`);
  return button;
}
function layerButton(title: string): HTMLButtonElement {
  return screen.getByRole('button', { name: title });
}

describe('sidebar navigation and contextual editing', () => {
  it('shows root/child/shared/unassigned pages and adds a real linked page to the clicked tab, undoably', () => {
    render(<Harness/>);
    expect(within(screen.getByRole('region', { name: 'Home tab' })).getByText('Child')).toBeTruthy();
    expect(screen.getByText('SHARED PAGES')).toBeTruthy();
    expect(screen.getByText('Linked from Home, Settings')).toBeTruthy();
    expect(screen.getByText('NOT LINKED')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add page to Settings tab' }));
    const document = currentDocument();
    const created = document.pages.at(-1)!;
    expect(document.pages).toHaveLength(6);
    expect(owningTabIds(document, created.id)).toEqual(['tab-settings']);
    expect(document.pages[1].components.at(-1)?.action).toEqual({ type: 'navigate', pageId: created.id });
    expect(screen.getByTestId('target').textContent).toBe(created.id);
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    expect(currentDocument().pages).toHaveLength(5);
    expect(currentDocument().pages[1].components).toHaveLength(1);
  });

  it('preserves the immediate Create page path and makes a child of the current branch', () => {
    render(<Harness/>);
    fireEvent.click(pageButton('Child'));
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
    const document = currentDocument();
    expect(document.pages[2].components[0].action).toEqual({ type: 'navigate', pageId: document.pages.at(-1)!.id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates a new tab and root atomically and reorders the actual tabs', () => {
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    fireEvent.change(screen.getByLabelText('Tab label'), { target: { value: 'Garden' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add tab' }));
    const document = currentDocument();
    const tab = document.navigation.tabs.at(-1)!;
    expect(tab.label).toBe('Garden');
    expect(document.pages.find(page => page.id === tab.pageId)?.title).toBe('Garden');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Garden tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move tab earlier' }));
    expect(currentDocument().navigation.tabs.map(tab => tab.label)).toEqual(['Home', 'Garden', 'Settings']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    expect(currentDocument().pages).toHaveLength(5);
    expect(currentDocument().navigation.tabs).toHaveLength(2);
  });

  it('deletes the right-clicked page, not the selected one, only after confirmation and preserves undo', () => {
    render(<Harness/>);
    fireEvent.contextMenu(pageButton('Settings'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page...' }));
    expect(currentDocument().pages).toHaveLength(5);
    expect(screen.getByRole('dialog', { name: 'Delete Settings?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(currentDocument().pages.some(page => page.id === 'home')).toBe(true);
    expect(currentDocument().pages.some(page => page.id === 'settings')).toBe(false);
    expect(currentDocument().navigation.tabs.map(tab => tab.id)).toEqual(['tab-home']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    expect(currentDocument().pages.some(page => page.id === 'settings')).toBe(true);
  });

  it('supports Shift+F10/Menu, arrow navigation, Escape focus restoration, and outside dismissal', async () => {
    render(<Harness/>);
    const button = pageButton('Settings');
    button.focus();
    fireEvent.keyDown(button, { key: 'F10', shiftKey: true });
    const first = screen.getByRole('menuitem', { name: 'Edit page' });
    expect(globalThis.document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(globalThis.document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename...' }));
    fireEvent.keyDown(globalThis.document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(globalThis.document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: 'ContextMenu' });
    expect(screen.getByRole('menu', { name: 'Settings actions' })).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Undo change' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('removes just the clicked tab after confirmation and leaves its pages and content intact', () => {
    render(<Harness/>);
    const before = currentDocument().pages;
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Settings tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove tab...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(currentDocument().navigation.tabs).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Settings tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove tab...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tab' }));
    expect(currentDocument().navigation.tabs.map(tab => tab.id)).toEqual(['tab-home']);
    expect(currentDocument().pages).toEqual(before);
  });

  it('ignores a queued scroll at the opening position but closes when its origin moves', () => {
    render(<Harness/>);
    const origin = pageButton('Settings');
    let top = 100;
    vi.spyOn(origin, 'getBoundingClientRect').mockImplementation(() => new DOMRect(10, top, 180, 32));
    fireEvent.contextMenu(origin);
    fireEvent.scroll(window);
    expect(screen.getByRole('menu', { name: 'Settings actions' })).toBeTruthy();
    top = 60;
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(globalThis.document.activeElement).toBe(origin);
  });

  it('blocks deletion of the last page in both visible and contextual paths', () => {
    const initial = fixture();
    initial.pages = [createSidebarPage('home', 'Home')]; initial.navigation.tabs = [initial.navigation.tabs[0]];
    render(<Harness initial={initial}/>);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete page' }).disabled).toBe(true);
    fireEvent.contextMenu(pageButton('Home'));
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Delete page...' }).disabled).toBe(true);
  });

  it('reports the interaction dependency instead of deleting a contextual search target', () => {
    const initial = fixture();
    initial.variables.query = '';
    initial.dataSources = [{ id: 'rows', name: 'Rows', kind: 'static', sample: [], refreshSeconds: 30 }];
    initial.pages[0].components.push({ ...createComponent('list'), id: 'rows', title: 'Search results', binding: { sourceId: 'rows' } });
    initial.pages[0].search = { id: 'filter', label: 'Filter', placeholder: 'Search', mode: 'filter', queryVariable: 'query', targetComponentIds: ['rows'], paths: ['title'] };
    render(<Harness initial={initial}/>);
    fireEvent.contextMenu(layerButton('Search results'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete component' }));
    expect(screen.getByRole('alert').textContent).toContain('floating actions or search');
    expect(currentDocument()).toEqual(initial);
  });

  it('moves and deletes the contextual layer, never the stale selected layer', async () => {
    render(<Harness/>);
    fireEvent.contextMenu(layerButton('Other component'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to...' }));
    fireEvent.change(screen.getByLabelText('Insertion position'), { target: { value: 'inside' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move component' }));
    expect(currentDocument().pages[0].components[0].children?.map(item => item.id)).toEqual(['child-link', 'other']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    fireEvent.click(layerButton('Keep me'));
    fireEvent.contextMenu(layerButton('Other component'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete component' }));
    expect(currentDocument().pages[0].components.some(item => item.id === 'other')).toBe(false);
    expect(currentDocument().pages[0].components.some(item => item.id === 'keep')).toBe(true);
    await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByRole('tab', { name: 'Project' })));
  });

  it('moves a child-page link to another tab using the page menu without replacing other content', () => {
    render(<Harness/>);
    fireEvent.contextMenu(pageButton('Child'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Links…' }));
    const links = screen.getByLabelText<HTMLSelectElement>('Navigation link');
    fireEvent.change(links, { target: { value: links.options[1].value } });
    fireEvent.change(screen.getByLabelText('Link from page'), { target: { value: 'settings' } });
    fireEvent.change(screen.getByLabelText('Insertion position'), { target: { value: 'start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move link' }));
    expect(owningTabIds(currentDocument(), 'child')).toEqual(['tab-settings']);
    expect(currentDocument().pages[0].components[0].children).toEqual([]);
    expect(currentDocument().pages[1].components[0].id).toBe('child-link');
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
    expect(owningTabIds(currentDocument(), 'child')).toEqual(['tab-home']);
  });

  it('projects nested children in route order and updates that order when a link is repositioned', () => {
    const initial = fixture();
    initial.pages.push(createSidebarPage('sibling', 'Sibling'));
    initial.pages[0].components.unshift({ ...createComponent('navigation-tile'), id: 'sibling-link', title: 'Sibling link', action: { type: 'navigate', pageId: 'sibling' } });
    render(<Harness initial={initial}/>);
    const order = () => [...screen.getByRole('region', { name: 'Home tab' }).querySelectorAll('.page-row')].map(button => button.textContent);
    expect(order()).toEqual(['HomeStart', 'Sibling', 'Child']);
    fireEvent.contextMenu(pageButton('Child'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Links…' }));
    const links = screen.getByLabelText<HTMLSelectElement>('Navigation link');
    fireEvent.change(links, { target: { value: links.options[1].value } });
    fireEvent.change(screen.getByLabelText('Insertion position'), { target: { value: 'start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move link' }));
    expect(order()).toEqual(['HomeStart', 'Child', 'Sibling']);
    expect(currentDocument().pages[0].components[0].id).toBe('child-link');
  });

  it('retains palette add/drag handles and supports explicit insertion inside the selected group', () => {
    const onAdd = vi.fn();
    render(<Harness onAdd={onAdd}/>);
    fireEvent.click(layerButton('Group'));
    fireEvent.click(screen.getByRole('tab', { name: 'Components' }));
    expect(screen.getByRole('button', { name: 'Drag Text to canvas' })).toBeTruthy();
    const text = [...globalThis.document.querySelectorAll<HTMLButtonElement>('.palette-add')].find(button => button.textContent?.startsWith('Text'))!;
    fireEvent.contextMenu(text);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add inside selected group' }));
    expect(currentDocument().pages[0].components[0].children).toHaveLength(2);
    fireEvent.click(text);
    expect(onAdd).toHaveBeenCalledWith('text');
  });

  it('rejects invalid nesting without changing the document and shows the schema error', () => {
    const initial = fixture();
    const deepest = { ...createComponent('section'), id: 'level-8', title: 'Deepest', children: [] };
    let chain: Component = deepest;
    for (let depth = 7; depth >= 1; depth--) chain = { ...createComponent('section'), id: `level-${depth}`, title: `Level ${depth}`, children: [chain] };
    initial.pages[0].components.push(chain);
    render(<Harness initial={initial}/>);
    fireEvent.contextMenu(layerButton('Other component'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to...' }));
    fireEvent.change(screen.getByLabelText('Insertion position'), { target: { value: 'inside' } });
    fireEvent.change(screen.getByLabelText('Destination group'), { target: { value: 'level-8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move component' }));
    expect(screen.getByRole('alert').textContent).toContain('nesting exceeds 8 levels');
    expect(currentDocument()).toEqual(initial);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
