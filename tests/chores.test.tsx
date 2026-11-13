// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeChores, ChoresSimulationProvider } from '../src/NativeChores';
import { choreDue, choreLinkPresentation, choreListIds, choreTitle, readChoreList } from '../src/shared/native-chores';
import { importNativeHome } from '../src/shared/native-preview';
import { resolveCollection } from '../src/shared/collection';
import { validateDocument } from '../src/shared/schema';
import { choreDescendants, choresDocument, choresSnapshot, legacyChoresDocument } from './fixtures/chores';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const getPage = (document = choresDocument()) => document.pages.find(page => page.id === 'chores')!.components.find(node => node.props.nativeTodoPage)!;
const renderPage = (document = choresDocument(), props = {}) => render(<ChoresSimulationProvider identityKey="fixture"><NativeChores component={getPage(document)} document={document} editing={false} {...props}/></ChoresSimulationProvider>);

describe('configured Chores contract and safe native simulations', () => {
  it('uses explicit menu confirmation and immediately deletes only after confirmation is removed', () => {
    const document = choresDocument(), root = getPage(document);
    root.children![0].rowActions = { leading: [], trailing: [{ id: 'custom-delete', label: 'Remove task', icon: '', action: { type: 'todo-row', operation: 'delete' }, confirmation: { title: 'Remove this task?', confirmLabel: 'Remove', cancelLabel: 'Keep' } }] };
    const { rerender } = render(<NativeChores component={root} document={document} editing={false}/>);
    const menu = () => {
      const row = screen.getByRole('button', { name: 'Complete Task Alpha' }).closest('.chore-row')!;
      fireEvent.click(within(row as HTMLElement).getByLabelText('Actions for Task Alpha'));
      fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Remove task' }));
    };
    menu();
    expect(screen.getByRole('alertdialog', { name: 'Remove this task?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByText('Task Alpha')).toBeTruthy();
    delete root.children![0].rowActions.trailing[0].confirmation;
    rerender(<NativeChores component={root} document={document} editing={false}/>);
    menu();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete Task Alpha' })).toBeNull();
    expect(JSON.stringify(document.dataSources)).toContain('Task Alpha');
  });
  it('cancels custom confirmations and edit forms on identity or capability loss', () => {
    const document = choresDocument(), root = getPage(document);
    root.children![0].rowActions = { leading: [], trailing: [{ id: 'custom-delete', label: 'Remove task', icon: '', action: { type: 'todo-row', operation: 'delete' }, confirmation: { title: 'Remove?', confirmLabel: 'Remove now', cancelLabel: 'Keep' } }] };
    const { rerender } = render(<NativeChores component={root} document={document} editing={false}/>);
    const row = screen.getByRole('button', { name: 'Complete Task Alpha' }).closest('.chore-row') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('Actions for Task Alpha'));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove task' }));
    const staleConfirm = screen.getByRole('button', { name: 'Remove now' });
    const other = structuredClone(document);
    other.dataSources.find(source => source.id === 'native-profile')!.sample = { id: 'user-two' };
    rerender(<NativeChores component={getPage(other)} document={other} editing={false}/>);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(staleConfirm);
    rerender(<NativeChores component={root} document={document} editing={false}/>);
    expect(screen.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Task Alpha' }));
    const staleSave = screen.getByRole('button', { name: 'Save' });
    fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'Stale change' } });
    root.children![0].props.disabled = true;
    rerender(<NativeChores component={root} document={document} editing={false}/>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(staleSave);
    expect(screen.queryByText('Stale change')).toBeNull();
  });
  it('keeps intrinsic completion, Undo and edit accessories when both configured edges are empty', () => {
    const document = choresDocument(), root = getPage(document);
    root.children![0].rowActions = { leading: [], trailing: [] };
    render(<NativeChores component={root} document={document} editing={false}/>);
    expect(screen.queryByLabelText('Actions for Task Alpha')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Task Alpha' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Complete Task Alpha' }));
    expect(screen.getByRole('button', { name: 'Mark Not Done Task Alpha' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
  });
  it('preserves Add input when choosing another ready list and cancels only when that target becomes unavailable', () => {
    const document = choresDocument(), root = getPage(document);
    const { rerender } = render(<NativeChores component={root} document={document} editing={false}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'Keep this draft' } });
    fireEvent.change(screen.getByLabelText('Simulated list'), { target: { value: 'todo.fixture_today' } });
    expect((screen.getByLabelText('Task Name') as HTMLInputElement).value).toBe('Keep this draft');
    root.children![0].props.disabled = true;
    rerender(<NativeChores component={root} document={document} editing={false}/>);
    expect((screen.getByLabelText('Task Name') as HTMLInputElement).value).toBe('Keep this draft');
    root.children![1].props.disabled = true;
    rerender(<NativeChores component={root} document={document} editing={false}/>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Keep this draft')).toBeNull();
  });
  it('cannot grant grocery editing or admin deletion through explicit descriptors', () => {
    const document = choresDocument();
    for (const [capability, operation, label] of [['groceryItem', 'edit', 'Forbidden edit'], ['adminTodo', 'delete', 'Forbidden delete']] as const) {
      const root = choreDescendants([...document.pages, ...document.modals].flatMap(page => page.components)).find(node => node.props.nativeTodoPage && JSON.stringify(node.props.addAction).includes(capability))!;
      root.children![0].rowActions = { leading: [], trailing: [{ id: 'forbidden', label, icon: '', action: { type: 'todo-row', operation } }] };
      render(<NativeChores component={root} document={document} editing={false}/>);
      fireEvent.click(screen.getByLabelText(/^Actions for /));
      const forbidden = screen.getByRole('button', { name: new RegExp(label) });
      expect((forbidden as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(forbidden);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      cleanup();
    }
  });
  it('uses existing requiredData placeholders without reimport, ID changes or persisted simulation records', () => {
    const document = legacyChoresDocument(), root = getPage(document);
    const summary = choreDescendants(document.modals.flatMap(modal => modal.components)).find(node => node.props.collectionKind === 'resident-todo-items')!;
    root.children!.push({ id: 'legacy-custom-help', type: 'text', title: 'User-owned Chores help', props: {} });
    root.children![0].children = [{ id: 'legacy-nested-help', type: 'text', title: 'User-owned nested help', props: {} }];
    summary.children = [{ id: 'summary-nested-help', type: 'text', title: 'Profile nested help', props: {} }];
    const original = JSON.stringify(document);
    expect(validateDocument(document)).toEqual(document);
    expect(root.children![0].props.requiredData).toBe('todo-items');
    expect(root.children![0].binding).toEqual({ sourceId: 'native-states' });
    expect(root.children![0].props.profileSourceId).toBeUndefined();
    expect(root.props.addAction).toBeUndefined();
    render(<ChoresSimulationProvider identityKey="legacy"><div data-testid="root"><NativeChores component={root} document={document} editing={false} renderOther={node => <p key={node.id}>{node.title}</p>}/></div><div data-testid="summary"><NativeChores component={summary} document={document} editing={false} renderOther={node => <p key={node.id}>{node.title}</p>}/></div></ChoresSimulationProvider>);
    const page = within(screen.getByTestId('root')), profile = within(screen.getByTestId('summary'));
    expect(page.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    expect(page.queryByText('Other assignment')).toBeNull();
    expect(page.queryByRole('heading', { name: 'No Due Date' })).toBeNull();
    expect(page.queryByRole('heading', { name: root.title })).toBeNull();
    expect(page.getByText('User-owned Chores help')).toBeTruthy();
    expect(page.getByText('User-owned nested help')).toBeTruthy();
    expect(profile.getAllByText('Profile nested help')).toHaveLength(1);
    fireEvent.click(page.getByRole('button', { name: 'Complete Task Alpha' }));
    expect(profile.getByRole('button', { name: 'Mark Not Done Task Alpha' })).toBeTruthy();
    fireEvent.click(profile.getByRole('button', { name: 'Undo' }));
    fireEvent.click(page.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(page.getByLabelText('Task Name'), { target: { value: 'Legacy simulated addition' } });
    fireEvent.click(page.getByRole('button', { name: 'Add' }));
    expect(page.getByRole('button', { name: 'Complete Legacy simulated addition' })).toBeTruthy();
    expect(JSON.stringify(document)).toBe(original);
  });
  it('imports only configured sections in order, no duplicate page heading, no captured tasks or identity', () => {
    const snapshot = choresSnapshot(), { document, warnings } = importNativeHome(snapshot);
    const page = getPage(document);
    expect(page.title).toBe('');
    expect(page.children?.map(node => node.title)).toEqual(['Past Due', 'Due Today', 'No Due Date', 'Other Past Due']);
    expect(document.pages.find(page => page.id === 'chores')!.components[0].children?.map(node => node.title)).not.toContain('Missing page');
    expect(JSON.stringify(document)).not.toMatch(/Task Alpha|Authenticated fixture|Synthetic apples/);
    expect(warnings.join(' ')).not.toMatch(/todo-items requires/);
    expect(validateDocument(document)).toEqual(document);
    const userLink = document.pages.find(page => page.id === 'chores')!.components[0].children![0];
    expect(choreLinkPresentation(userLink, choresDocument(), snapshot.states)).toEqual({ title: 'Your Chores', subtitle: '3 open \u00b7 2 overdue' });
  });
  it('uses the authenticated ID for root assignments and summary lists; another resident and no mapping are explicit', () => {
    const document = choresDocument(), root = getPage(document);
    renderPage(document);
    expect(screen.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    expect(screen.queryByText('Other assignment')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No Due Date' })).toBeNull();
    cleanup();
    document.dataSources.find(source => source.id === 'native-profile')!.sample = { id: 'user-two', name: 'Authenticated fixture' };
    renderPage(document);
    expect(screen.getByRole('button', { name: 'Complete Other assignment' })).toBeTruthy();
    expect(screen.queryByText('Task Alpha')).toBeNull();
    const summary = choreDescendants(document.modals.flatMap(modal => modal.components)).find(node => node.props.collectionKind === 'resident-todo-items')!;
    expect(choreListIds(summary, document).map(list => list.entityId)).toEqual(['todo.fixture_other']);
    cleanup();
    document.dataSources.find(source => source.id === 'native-profile')!.sample = { id: 'unmapped', name: 'Resident One' };
    expect(choreListIds(summary, document)).toEqual([]);
    expect(choreListIds(root.children![0], document)).toEqual([]);
    renderPage(document);
    expect(screen.getByText('Nothing assigned.')).toBeTruthy();
    expect(screen.queryByText('Task Alpha')).toBeNull();
  });
  it('distinguishes truly empty, missing identity, loading, read failure and missing capability', () => {
    const document = choresDocument();
    document.dataSources.find(source => source.id === 'native-profile')!.sample = null;
    renderPage(document);
    expect(screen.getByRole('alert').textContent).toContain('Signed-in user unavailable');
    cleanup();
    renderPage(choresDocument(), { dataState: 'loading' });
    expect(screen.getByRole('status').textContent).toContain('Loading chores');
    expect(screen.queryByText('Nothing assigned.')).toBeNull();
    cleanup();
    renderPage(choresDocument(), { dataState: 'error' });
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    cleanup();
    const states = document.dataSources[0].sample;
    expect(readChoreList(states, 'todo.missing').status).toBe('unavailable');
    expect(readChoreList(states, 'todo.fixture_undated')).toEqual({ status: 'ready', items: [] });
  });
  it('never promotes an unimplemented collection or raw entity feed to todo records', () => {
    const document = choresDocument(), component = getPage(document).children![0];
    expect(resolveCollection(component, [{ entityId: 'todo.fixture_overdue', state: '2' }], {})).toEqual([]);
    expect(resolveCollection({ ...component, props: { collectionKind: 'recipes', requiredData: 'recipes' } }, document.dataSources[0].sample, {})).toEqual([]);
    expect(resolveCollection(component, document.dataSources[0].sample, {}).map(row => typeof row.value === 'object' && row.value && !Array.isArray(row.value) ? row.value.summary : undefined)).toEqual(['Task Alpha', 'Task Beta']);
    const invalid = structuredClone(document);
    getPage(invalid).children![0].props.entityId = 'sensor.not_a_list';
    expect(() => validateDocument(invalid)).toThrow();
  });
  it('renders a genuinely empty authorized household, supports simulated additions, and keeps vacation copy in summaries', () => {
    const document = choresDocument();
    document.dataSources.find(source => source.id === 'native-states')!.sample = choresSnapshot().states.map(state => ({
      ...state, state: '0', todoList: { status: 'ready', items: [] },
    }));
    renderPage(document);
    expect(screen.getByText('Nothing assigned.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Past Due' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'First simulated task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('heading', { name: 'Past Due' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete First simulated task' })).toBeTruthy();
    cleanup();
    const summary = choreDescendants(document.modals.flatMap(modal => modal.components)).find(node => node.props.collectionKind === 'resident-todo-items')!;
    render(<NativeChores component={summary} document={document} editing={false} entities={{ [String(summary.props.vacationEntityId)]: 'on' }}/>);
    expect(screen.getByText('Enjoy vacation!')).toBeTruthy();
    expect(screen.getByText('No Chores Due')).toBeTruthy();
  });
  it('keeps completed rows in place for five seconds, shares undo across destinations, and resets without persisting', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const document = choresDocument(), original = JSON.stringify(document);
    const root = getPage(document), summary = choreDescendants(document.modals.flatMap(modal => modal.components)).find(node => node.props.collectionKind === 'resident-todo-items')!;
    render(<ChoresSimulationProvider identityKey="fixture"><div data-testid="root"><NativeChores component={root} document={document} editing={false}/></div><div data-testid="summary"><NativeChores component={summary} document={document} editing={false}/></div></ChoresSimulationProvider>);
    const page = within(screen.getByTestId('root')), profile = within(screen.getByTestId('summary'));
    fireEvent.click(page.getByRole('button', { name: 'Complete Task Alpha' }));
    expect(profile.getByRole('button', { name: 'Mark Not Done Task Alpha' }).getAttribute('aria-pressed')).toBe('true');
    expect(page.getAllByRole('button', { name: /Task (Alpha|Beta)/ }).map(button => button.getAttribute('aria-label')).filter(label => label?.startsWith('Mark') || label?.startsWith('Complete'))).toEqual(['Mark Not Done Task Alpha', 'Complete Task Beta']);
    fireEvent.click(profile.getByRole('button', { name: 'Undo' }));
    expect(page.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    fireEvent.click(page.getByRole('button', { name: 'Complete Task Alpha' }));
    act(() => vi.advanceTimersByTime(5001));
    expect(page.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(page.getByRole('button', { name: 'Reset Chores simulation' }));
    expect(page.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    expect(JSON.stringify(document)).toBe(original);
  });
  it('adds, edits and deletes only simulated records, with accessible non-swipe alternatives', () => {
    const document = choresDocument(), original = JSON.stringify(document);
    renderPage(document);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'New synthetic task' } });
    fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Complete New synthetic task' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit New synthetic task' }));
    fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'Edited synthetic task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const actions = screen.getByLabelText('Actions for Edited synthetic task').closest('details')!;
    fireEvent.click(within(actions).getByRole('button', { name: 'Show edit/delete swipe' }));
    expect(actions.closest('.chore-row')?.getAttribute('data-swipe')).toBe('trailing');
    fireEvent.keyDown(actions, { key: 'Escape' });
    expect(actions.closest('.chore-row')?.hasAttribute('data-swipe')).toBe(false);
    fireEvent.click(within(actions).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('status').textContent).toContain('Simulated changes only');
    expect(JSON.stringify(document)).toBe(original);
  });
  it('retains sorted row positions through multiple completions and Undo in an unsorted response', () => {
    const document = choresDocument(), snapshot = choresSnapshot();
    snapshot.states[0].state = '4';
    snapshot.states[0].todoList = { status: 'ready', items: ['Delta', 'Charlie', 'Bravo', 'Alpha'].map((name, index) => ({
      uid: `${14 - index}--fixture`, summary: name, status: 'needs_action', due: `2020-01-0${4 - index}`,
    })) };
    document.dataSources.find(source => source.id === 'native-states')!.sample = snapshot.states;
    renderPage(document);
    const order = () => screen.getAllByRole('button', { name: /^(Complete|Mark Not Done) (Alpha|Bravo|Charlie|Delta)$/ })
      .map(button => button.getAttribute('aria-label')?.replace(/^(Complete|Mark Not Done) /, ''));
    const original = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    expect(order()).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Complete Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Charlie' }));
    expect(order()).toEqual(original);
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(order()).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(order()).toEqual(original);
  });
  it.each(['edit', 'delete', 'swipe'] as const)('cancels identity-bound %s state without replaying it for another identity', action => {
    const document = choresDocument();
    const content = (identity: string) => {
      const next = structuredClone(document);
      next.dataSources.find(source => source.id === 'native-profile')!.sample = { id: identity };
      return <ChoresSimulationProvider identityKey={identity}><NativeChores component={getPage(next)} document={next} editing={false}/></ChoresSimulationProvider>;
    };
    const rendered = render(content('user-one'));
    let staleForm: HTMLElement | null = null, staleDelete: HTMLElement | null = null;
    if (action === 'edit') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit Task Alpha' }));
      fireEvent.change(screen.getByLabelText('Task Name'), { target: { value: 'Stale identity edit' } });
      staleForm = screen.getByRole('dialog');
    } else {
      const actions = screen.getByLabelText('Actions for Task Alpha').closest('details')!;
      fireEvent.click(within(actions).getByRole('button', { name: action === 'delete' ? 'Delete' : 'Show edit/delete swipe' }));
      if (action === 'delete') staleDelete = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' });
    }
    rendered.rerender(content('user-two'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rendered.container.querySelector('.chore-row[data-swipe]')).toBeNull();
    if (staleForm) fireEvent.submit(staleForm);
    if (staleDelete) fireEvent.click(staleDelete);
    expect(screen.getByRole('button', { name: 'Complete Other assignment' })).toBeTruthy();
    expect(screen.queryByText('Simulated changes only')).toBeNull();
    rendered.rerender(content('user-one'));
    expect(screen.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    expect(screen.queryByText('Stale identity edit')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('does not expose admin delete or edit grocery items, and respects page list-header settings', () => {
    const document = choresDocument();
    const pages = document.pages.map(page => page.components).flat();
    const grocery = pages.find(node => node.props.nativeTodoPage && node.props.hideListHeaders)!;
    render(<NativeChores component={grocery} document={document} editing={false}/>);
    expect(screen.queryByRole('heading', { name: 'Groceries' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Synthetic apples' })).toBeNull();
    cleanup();
    const admin = pages.find(node => node.props.nativeTodoPage && node.props.addAction && JSON.stringify(node.props.addAction).includes('adminTodo'))!;
    render(<NativeChores component={admin} document={document} editing={false}/>);
    expect(screen.getByRole('button', { name: 'Edit Synthetic admin item' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
  it('formats native due-distance units and warning/error thresholds', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(choreDue('2026-01-01T10:00:00Z', now)).toEqual({ text: '2 hours overdue', tone: 'warning' });
    expect(choreDue('2025-12-30T12:00:00Z', now)).toEqual({ text: '2 days overdue', tone: 'error' });
    expect(choreDue('2026-01-29T12:00:00Z', now)?.text).toBe('Due in 4 weeks');
    expect(choreDue('2026-04-01T12:00:00Z', now)?.text).toBe('Due in 3 months');
  });
  it('resets simulated mutations permanently when the authenticated identity changes', () => {
    const document = choresDocument(), root = getPage(document);
    const content = (identityKey: string) => <ChoresSimulationProvider identityKey={identityKey}><NativeChores component={root} document={document} editing={false}/></ChoresSimulationProvider>;
    const rendered = render(content('one'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Task Alpha' }));
    rendered.rerender(content('two'));
    expect(screen.getByRole('button', { name: 'Complete Task Alpha' })).toBeTruthy();
    rendered.rerender(content('one'));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
  it('uses the native battery-maintenance title only with its explicit description marker', () => {
    const item = { uid: '1', summary: 'Replace battery', status: 'needs_action' as const, description: 'Battery is at 18.5%. Maintenance reference: BATT-A12' };
    expect(choreTitle(item)).toBe('Replace Battery \u00b7 18.5%');
    expect(choreTitle({ ...item, summary: 'Replace battery (18.5%)' })).toBe('Replace Battery (18.5%)');
    expect(choreTitle({ ...item, description: 'Battery is at 18.5%.' })).toBe('Replace battery');
  });
});
