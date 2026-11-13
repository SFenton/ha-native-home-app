// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DevicePreview, { initialPreview } from '../src/DevicePreview';
import { InteractionSurface, ListInteractionEditor, PageInteractionEditor, RowInteractions, SurfaceSearch } from '../src/InteractionControls';
import { ChoresSimulationProvider, NativeChores } from '../src/NativeChores';
import { resolveCollection } from '../src/shared/collection';
import { collectionKeys, matchesSearch, searchTargets } from '../src/shared/interactions';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';
import type { Component, PageSearch, RowActions } from '../src/shared/types';
import { choreDescendants, choresDocument } from './fixtures/chores';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function listDocument() {
  const document = createSampleDocument();
  document.variables.query = '';
  document.dataSources = [{ id: 'records', name: 'Records', kind: 'static', refreshSeconds: 30, sample: [
    { key: 'first', title: 'Apples', group: 'fruit', rank: 2 },
    { key: 'second', title: 'Carrots', group: 'vegetable', rank: 1 },
  ] }];
  const list: Component = { id: 'search-list', type: 'list', title: 'Records', props: { titlePath: 'title' }, binding: { sourceId: 'records' } };
  document.pages[0].components = [list];
  document.pages[0].toolbar = [];
  document.modals = []; document.liveActivities = [];
  document.pages = [document.pages[0]];
  document.navigation.initialPageId = document.pages[0].id;
  document.navigation.tabs = [];
  document.pages[0].floatingButtons = [];
  document.pages[0].search = { id: 'record-search', mode: 'filter', label: 'Find records', placeholder: 'Search records', queryVariable: 'query', paths: ['title'], targetComponentIds: [list.id] };
  return document;
}

describe('local collection filtering', () => {
  it('normalizes scalar search and composes exact filtering and sorting without mutating samples', () => {
    const component: Component = { id: 'list', type: 'list', title: '', props: { filterPath: 'group', filterVariable: 'group', sortBy: 'rank' } };
    const sample = [{ title: 'ＡＰＰＬＥ', group: 'fruit', rank: 2 }, { title: 'Apple pie', group: 'fruit', rank: 1 }, { title: 'Apple soup', group: 'veg', rank: 0 }];
    const original = JSON.stringify(sample);
    expect(resolveCollection(component, sample, { group: 'fruit' }, { query: ' apple ', paths: ['title'] }).map(record => record.sourceIndex)).toEqual([1, 0]);
    expect(resolveCollection(component, sample, { group: 'fruit' }, { query: '', paths: ['title'] })).toHaveLength(2);
    expect(matchesSearch({ nested: { hidden: 'apple' } }, 'apple', ['nested'])).toBe(false);
    expect(matchesSearch({ count: 42, enabled: true }, '42', ['count'])).toBe(true);
    expect(JSON.stringify(sample)).toBe(original);
    expect(() => collectionKeys([{ key: 'x' }, { key: 'x' }], 'key')).toThrow('unique');
  });
  it('filters the actual generic preview offline and restores rows when cleared', () => {
    const document = listDocument(), original = JSON.stringify(document.dataSources);
    function Harness() {
      const [query, setQuery] = useState('');
      return <DndContext><DevicePreview document={document} target={{ kind: 'page', id: document.pages[0].id }} editing={false} previewPage={document.pages[0].id}
        settings={initialPreview} onSettings={vi.fn()} onDismiss={vi.fn()} onTarget={vi.fn()} dataModes={{}} entities={{}}
        variables={{ ...document.variables, query }} onSelect={vi.fn()} onAction={vi.fn()} onSearchVariable={(_key, value) => setQuery(value)}/></DndContext>;
    }
    render(<Harness/>);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find records' }), { target: { value: 'carrot' } });
    expect(screen.queryByText('Apples')).toBeNull();
    expect(screen.getByText('Carrots')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching results')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Find records' }));
    expect(screen.getByText('Apples')).toBeTruthy();
    expect(JSON.stringify(document.dataSources)).toBe(original);
  });
  it('filters only identity-authorized Chores after resolving the native group', () => {
    const document = choresDocument(), root = choreDescendants(document.pages.find(page => page.id === 'chores')!.components).find(node => node.props.nativeTodoPage)!;
    const ids = searchTargets({ id: 'search', label: 'Search', placeholder: '', mode: 'filter', queryVariable: 'query', paths: ['summary'], targetComponentIds: [root.id] }, [root]);
    const props = { component: root, document, editing: false, onSelect: vi.fn() };
    const { rerender } = render(<NativeChores {...props} search={{ query: 'alpha', paths: ['summary'], targetIds: ids }}/>);
    expect(screen.getByText('Task Alpha')).toBeTruthy();
    expect(screen.queryByText('Task Beta')).toBeNull();
    rerender(<NativeChores {...props} search={{ query: 'Other assignment', paths: ['summary'], targetIds: ids }}/>);
    expect(screen.queryByText('Other assignment')).toBeNull();
    expect(screen.getByText('No matching results')).toBeTruthy();
    rerender(<NativeChores {...props} search={{ query: '', paths: ['summary'], targetIds: ids }}/>);
    expect(screen.getByText('Task Beta')).toBeTruthy();
  });
  it('blocks malformed runtime action keys without reporting loading data as malformed', () => {
    const document = listDocument(), list = document.pages[0].components[0];
    list.rowActions = { keyPath: 'key', leading: [{ id: 'inspect', label: 'Inspect', icon: '', action: { type: 'none' } }], trailing: [] };
    const props = { document, target: { kind: 'page' as const, id: document.pages[0].id }, previewPage: document.pages[0].id, editing: false, settings: initialPreview, onSettings: vi.fn(), onDismiss: vi.fn(), onTarget: vi.fn(), onSelect: vi.fn(), onAction: vi.fn(), variables: document.variables, entities: {} };
    document.dataSources[0].sample = null;
    const { rerender } = render(<DndContext><DevicePreview {...props} dataModes={{ records: 'loading' }}/></DndContext>);
    expect(screen.queryByText(/Row actions require/)).toBeNull();
    document.dataSources[0].sample = [{ key: 'duplicate', title: 'First bad row' }, { key: 'duplicate', title: 'Second bad row' }];
    rerender(<DndContext><DevicePreview {...props} dataModes={{ records: 'live' }}/></DndContext>);
    expect(screen.getByRole('alert').textContent).toContain('unique nonblank string keys');
    expect(screen.queryByRole('button', { name: /First bad row/ })).toBeNull();
    expect(screen.queryByLabelText('Actions for First bad row')).toBeNull();
  });
});

describe('shared row dispatch', () => {
  const actions: RowActions = { keyPath: 'key', leading: [{ id: 'open', label: 'Open', icon: '', action: { type: 'none' } }], trailing: [{
    id: 'remove', label: 'Remove', icon: '', color: '#D93025', fullSwipe: true, action: { type: 'none' }, confirmation: { title: 'Remove this record?', message: 'A preview only.', confirmLabel: 'Confirm removal', cancelLabel: 'Keep', destructive: true },
  }] };
  const props = { actions, title: 'Record', generation: 'user-one', disabled: false, onInvoke: vi.fn() };
  it('uses the same confirmation for keyboard menus, revealed buttons, and full swipes', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const invoke = vi.fn();
    const { container } = render(<RowInteractions {...props} onInvoke={invoke}><span>Record</span></RowInteractions>);
    fireEvent.click(screen.getByLabelText('Actions for Record'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('A preview only.');
    expect(globalThis.document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Actions for Record'));
    fireEvent.click(screen.getByRole('button', { name: 'Show trailing swipe' }));
    fireEvent.click(within(container.querySelector('.chore-swipe-actions') as HTMLElement).getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    const front = container.querySelector('.chore-row-front')!;
    fireEvent.pointerDown(front, { button: 0, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(front, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(front, { clientX: 20, clientY: 10 });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('does not execute a full swipe without a marked target or use a disabled target fallback', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const invoke = vi.fn(), noFull = structuredClone(actions);
    noFull.trailing[0].fullSwipe = false;
    const { container, rerender } = render(<RowInteractions {...props} actions={noFull} onInvoke={invoke}><span>Record</span></RowInteractions>);
    const swipe = () => {
      const front = container.querySelector('.chore-row-front')!;
      fireEvent.pointerDown(front, { button: 0, clientX: 300, clientY: 10 });
      fireEvent.pointerMove(front, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(front, { clientX: 10, clientY: 10 });
    };
    swipe();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    rerender(<RowInteractions {...props} actions={actions} onInvoke={invoke} reason={() => 'Unavailable for this row'}><span>Record</span></RowInteractions>);
    swipe();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('cancels pending confirmation on identity, descriptor, or capability changes', () => {
    const invoke = vi.fn();
    const { rerender } = render(<RowInteractions {...props} onInvoke={invoke}><span>Record</span></RowInteractions>);
    const open = () => { fireEvent.click(screen.getByLabelText('Actions for Record')); fireEvent.click(screen.getByRole('button', { name: 'Remove' })); };
    open();
    const stale = screen.getByRole('button', { name: 'Confirm removal' });
    rerender(<RowInteractions {...props} generation="user-two" onInvoke={invoke}><span>Record</span></RowInteractions>);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(stale);
    expect(invoke).not.toHaveBeenCalled();
    open();
    rerender(<RowInteractions {...props} generation="user-two" disabled onInvoke={invoke}><span>Record</span></RowInteractions>);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('floating surface controls', () => {
  it('ports one legacy Add dock outside scrolling content and honors an explicit empty override', () => {
    const document = choresDocument(), page = document.pages.find(page => page.id === 'chores')!, root = choreDescendants(page.components).find(node => node.props.nativeTodoPage)!;
    function Surface({ disable = false }) {
      return <ChoresSimulationProvider identityKey="one"><div className="native-app"><div className="native-scroll"><InteractionSurface page={{ ...page, floatingButtons: disable ? [] : undefined }} active editing={false} onAction={vi.fn()} onSelect={vi.fn()}>
        <main className="native-page-content"><NativeChores component={root} document={document} editing={false} onSelect={vi.fn()}/></main>
      </InteractionSurface></div></div></ChoresSimulationProvider>;
    }
    const { rerender } = render(<Surface/>);
    const add = screen.getByRole('button', { name: 'Add Task' });
    expect(add.closest('.native-scroll')).toBeNull();
    expect(add.closest('.native-app')).toBeTruthy();
    fireEvent.click(add);
    expect(screen.getByRole('dialog', { name: 'New Task simulation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Task' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<Surface disable/>);
    expect(screen.queryByRole('button', { name: 'Add Task' })).toBeNull();
  });
  it('renders configured order, contrast, standard simulated actions, and inactive gating', () => {
    const document = listDocument(), page = document.pages[0], invoke = vi.fn();
    page.floatingButtons = [
      { id: 'first', label: 'First', icon: '', color: '#fff', action: { type: 'set', variable: 'query', value: 'test' } },
      { id: 'second', label: 'Second', icon: '', color: '#000', action: { type: 'none' } },
    ];
    const view = (active: boolean) => <div className="native-app"><div className="native-scroll"><InteractionSurface page={page} active={active} editing={false} onSelect={vi.fn()} onAction={invoke}/></div></div>;
    const { rerender } = render(view(true));
    const buttons = within(globalThis.document.querySelector('.interaction-dock') as HTMLElement).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['First', 'Second']);
    expect(buttons[0].style.color).toBe('rgb(0, 0, 0)');
    expect(buttons[1].style.color).toBe('rgb(255, 255, 255)');
    fireEvent.click(buttons[0]);
    expect(invoke).toHaveBeenCalledWith(page.floatingButtons[0].action);
    rerender(view(false));
    expect(globalThis.document.querySelector('.interaction-dock')).toBeNull();
  });
});

describe('endpoint search controls', () => {
  function endpoint() {
    const document = listDocument();
    document.dataSources[0] = { ...document.dataSources[0], kind: 'endpoint', endpoint: 'registered-search', queryVariable: 'query' };
    const search: PageSearch = { id: 'endpoint', label: 'Find endpoint', placeholder: 'Type a query', mode: 'endpoint', sourceId: 'records' };
    return { document, search };
  }
  it('requires explicit consent and uses the source variable, Enter submit and blank cancellation callbacks', () => {
    const { document, search } = endpoint(), enable = vi.fn(), variable = vi.fn(), submit = vi.fn();
    function Harness({ enabled = false }: { enabled?: boolean }) {
      const [query, setQuery] = useState('');
      return <SurfaceSearch search={search} document={document} variables={{ query }} editing={false} active onSelect={vi.fn()} queryLiveEnabled={enabled} onEnable={enable} onSubmit={submit}
        onVariable={(id, value) => { variable(id, value); setQuery(value); }}/>;
    }
    const { rerender } = render(<Harness/>);
    expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('sample');
    fireEvent.click(screen.getByRole('button', { name: 'Enable endpoint search reads' }));
    expect(enable).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    rerender(<Harness enabled/>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'apples' } });
    expect(variable).toHaveBeenLastCalledWith('query', 'apples');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith('records');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Find endpoint' }));
    expect(variable).toHaveBeenLastCalledWith('query', '');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('does not publish composing text and exposes loading and errors without stale-result claims', () => {
    const { document, search } = endpoint(), variable = vi.fn(), submit = vi.fn();
    const props = { search, document, variables: { query: '' }, editing: false, active: true, onSelect: vi.fn(), queryLiveEnabled: true, onVariable: variable, onSubmit: submit };
    const { rerender } = render(<SurfaceSearch {...props} mode="loading"/>);
    expect(screen.getByRole('status').textContent).toBe('Searching...');
    const input = screen.getByRole('searchbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'composing' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(variable).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: 'composing' });
    expect(variable).toHaveBeenCalledWith('query', 'composing');
    rerender(<SurfaceSearch {...props} mode="error" error="Sign in again"/>);
    expect(screen.getByRole('alert').textContent).toContain('Sign in again');
    expect(screen.getByRole('alert').textContent).not.toContain('results');
  });
});

describe('visible interaction authoring', () => {
  it('adds, edits, reorders and removes floating descriptors and authors/removes search without JSON', () => {
    let latest = listDocument();
    delete latest.pages[0].search; delete latest.pages[0].floatingButtons;
    function Harness() {
      const [document, setDocument] = useState(latest);
      latest = document;
      return <PageInteractionEditor page={document.pages[0]} document={document}
        update={edit => setDocument(previous => { const next = structuredClone(previous); edit(next.pages[0]); return next; })}
        createFilterVariable={(search, variable) => setDocument(previous => { const next = structuredClone(previous); next.pages[0].search = search; next.variables[variable] = ''; return next; })}/>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Customize floating actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add floating action' }));
    const first = globalThis.document.querySelector('.chrome-editor') as HTMLElement;
    fireEvent.change(within(first).getByLabelText('Floating label'), { target: { value: 'Find apples' } });
    fireEvent.change(within(first).getByLabelText('Icon'), { target: { value: 'apple' } });
    fireEvent.change(within(first).getByLabelText('Action hex color'), { target: { value: '#ffffff' } });
    fireEvent.change(within(first).getByLabelText('On tap'), { target: { value: 'set' } });
    expect(latest.pages[0].floatingButtons![0]).toMatchObject({ label: 'Find apples', icon: 'apple', color: '#ffffff', action: { type: 'set' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add floating action' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Move action up', hidden: true })[1]);
    expect(latest.pages[0].floatingButtons![1].label).toBe('Find apples');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove action', hidden: true })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Enable search' }));
    expect(structuredClone(latest).pages[0].search?.mode).toBe('filter');
    fireEvent.change(screen.getByLabelText('Search label'), { target: { value: 'Find food' } });
    fireEvent.change(screen.getByLabelText('Search placeholder'), { target: { value: 'Name' } });
    fireEvent.change(screen.getByLabelText('Search path 1'), { target: { value: 'title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove search path 2' }));
    expect(latest.pages[0].search).toMatchObject({ label: 'Find food', placeholder: 'Name', paths: ['title'], targetComponentIds: ['search-list'] });
    const searchId = structuredClone(latest).pages[0].search!.id;
    fireEvent.change(screen.getByLabelText('Search mode'), { target: { value: 'endpoint' } });
    fireEvent.change(screen.getByLabelText('Search mode'), { target: { value: 'filter' } });
    expect(latest.pages[0].search).toMatchObject({ id: searchId, label: 'Find food', placeholder: 'Name' });
    expect(() => validateDocument(latest)).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'Remove search' }));
    expect(latest.pages[0].search).toBeUndefined();
  });
  it('authors both row edges, full swipe, confirmation, contextual operation and explicit disable', () => {
    const document = choresDocument(), root = choreDescendants(document.pages.find(page => page.id === 'chores')!.components).find(node => node.props.nativeTodoPage)!;
    let latest = root.children![0];
    function Harness() {
      const [component, setComponent] = useState(latest);
      latest = component;
      return <ListInteractionEditor component={component} document={document} update={edit => setComponent(previous => { const next = structuredClone(previous); edit(next); return next; })}/>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Customize row actions' }));
    const leading = screen.getByText('Leading edge').closest('section')!;
    fireEvent.change(within(leading).getByLabelText('Swipe/menu label'), { target: { value: 'Finish' } });
    fireEvent.change(within(leading).getByLabelText('Completed label (optional)'), { target: { value: 'Restart' } });
    fireEvent.change(within(leading).getByLabelText('Action hex color'), { target: { value: '#abc' } });
    fireEvent.click(within(leading).getByLabelText('Full swipe target'));
    expect(latest.rowActions!.leading[0]).toMatchObject({ label: 'Finish', completedLabel: 'Restart', color: '#abc', fullSwipe: false });
    const trailing = screen.getByText('Trailing edge').closest('section')!;
    const deleteEditor = trailing.querySelector('.chrome-editor') as HTMLElement;
    fireEvent.change(within(deleteEditor).getByLabelText('Confirmation title'), { target: { value: 'Really remove?' } });
    fireEvent.change(within(deleteEditor).getByLabelText('Confirm label'), { target: { value: 'Remove it' } });
    fireEvent.change(within(deleteEditor).getByLabelText('Cancel label'), { target: { value: 'Keep it' } });
    expect(latest.rowActions!.trailing[0].confirmation).toMatchObject({ title: 'Really remove?', confirmLabel: 'Remove it', cancelLabel: 'Keep it' });
    fireEvent.click(within(deleteEditor).getByLabelText('Confirm this swipe/menu action'));
    expect(latest.rowActions!.trailing[0].confirmation).toBeUndefined();
    fireEvent.change(within(deleteEditor).getByLabelText('Action side'), { target: { value: 'leading' } });
    expect(latest.rowActions!.leading).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Disable row actions' }));
    expect(latest.rowActions).toEqual({ leading: [], trailing: [] });
  });
});
