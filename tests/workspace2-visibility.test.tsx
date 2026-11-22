// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceAt, valueAt, type EditorPath } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument, CompositionNode, Predicate } from '../src/shared/composition/schema';
import { compositionSymbol, createCompositionDocument } from '../src/shared/composition/workspace';
import { useCompositionStudio } from '../src/useCompositionStudio';
import { resetAdvancedFold } from '../src/workspace2/AdvancedFold';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { useOpenDraft, releaseDraft, type Draft } from '../src/workspace2/editors/draft';
import { allowsStateVisibility, writeStateVisibility } from '../src/workspace2/expr/VisibilityField';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import { Project } from './support/workspace2-surfaces';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', async original => ({ ...await original<typeof import('../src/api')>(), request }));
beforeEach(() => { request.mockReset(); resetAdvancedFold(); });
let openEditor: Draft | undefined;
afterEach(() => { if (openEditor) releaseDraft(openEditor); openEditor = undefined; cleanup(); vi.unstubAllGlobals(); });
const path: EditorPath = ['pages', 0, 'components', 0];
const stateRule = { sourceId: 'occupancy-source', states: ['on', 'not_home'] };
const condition: Predicate = { type: 'state', sourceId: 'door-source', path: ['state'], in: ['open'] };
const section = (): Extract<CompositionNode, { type: 'room-section' }> => ({
  id: 'room', type: 'room-section', title: 'Living Room', layout: { span: 1 },
  props: { arrangement: 'grid', leadJoinsAtRegularWidth: false, visibility: stateRule }, children: [],
});
function documentFor(node: CompositionNode = section()): CompositionDocument {
  const document = createCompositionDocument('visibility-test');
  return {
    ...document,
    dataSources: [
      { id: 'occupancy-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'binary_sensor.demo_occupancy' } },
      { id: 'door-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'binary_sensor.demo_door' } },
      { id: 'window-source', kind: 'model', model: 'app-state@1', inputs: { topic: 'window' } },
    ],
    pages: [{ ...document.pages[0], components: [node] }],
  };
}
const house = { states: new Map([
  ['binary_sensor.demo_occupancy', { entityId: 'binary_sensor.demo_occupancy', name: 'Living Room Occupancy', state: 'on' }],
  ['binary_sensor.demo_door', { entityId: 'binary_sensor.demo_door', name: 'Patio Door', state: 'open' }],
  ['binary_sensor.demo_unbound', { entityId: 'binary_sensor.demo_unbound', name: 'Unbound Entity', state: 'off' }],
]) };

async function mount(start = documentFor(), connected = true, nodeId = 'room') {
  const seen = { document: start, studio: undefined as ReturnType<typeof useCompositionStudio> | undefined, draft: undefined as Draft | undefined, changes: 0, errors: [] as string[] };
  request.mockImplementation(async (url: string) => {
    if (url === '/native/api/draft') return { envelopeVersion: '2.0', document: start, revision: 1 };
    if (url.startsWith('/native/api/ha/entity-states')) {
      const entityId = new URL(url, 'http://studio.test').searchParams.get('entityId');
      return { entityId, states: [{ state: 'open', name: 'Open' }, { state: 'closed', name: 'Closed' }, { state: 'on' }, { state: 'off' }], history: ['ajar'], openEnded: false };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  function Harness() {
    const studio = useCompositionStudio(), draft = useOpenDraft();
    seen.studio = studio; seen.draft = draft; openEditor = draft;
    if (!studio.document) return null;
    seen.document = studio.document;
    const apply = (next: CompositionDocument) => { seen.changes++; studio.apply(next); };
    const ws = Project.workspace(studio.document, { kind: 'node', key: `node:${nodeId}`, path }, { extra: { studio: { ...studio, apply }, linked: { session: undefined, say: vi.fn() } } }, apply);
    return <WorkspaceDataProvider document={studio.document} house={connected ? house : {}}>
      <PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={message => seen.errors.push(message)}/>
    </WorkspaceDataProvider>;
  }
  const mounted = render(<Harness/>);
  await screen.findByRole('button', { name: /^Only show when:/ });
  return { ...mounted, seen };
}
const visibility = (document: CompositionDocument, at: EditorPath = path) => valueAt(document, [...at, 'props', 'visibility']);
const disclosure = () => screen.getByRole('button', { name: /^Only show when:/ });
const open = () => fireEvent.click(disclosure());
const undoDraft = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
const redoDraft = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });

describe('state-based show rules in the inspector', () => {
  it.each(['room-section', 'room-card', 'room-chip'] as const)('shows a %s state rule instead of Always', async type => {
    const node: CompositionNode = type === 'room-section' ? section() : {
      id: 'room', type, title: 'Living Room', layout: { span: 1 }, icon: compositionSymbol(),
      binding: { sourceId: 'occupancy-source', projection: 'room-state@1' },
      props: { kind: 'occupancy', showState: true, subtitleSourceIds: [], activeStates: ['on'], disabledStates: [], stateLabels: [], visibility: stateRule },
    };
    await mount(documentFor(node));
    expect(disclosure().getAttribute('aria-label')).toBe('Only show when: Living Room Occupancy is On or Not home.');
    expect(disclosure().textContent).not.toContain('Always');
    expect(within(screen.getByRole('region', { name: 'Behavior' })).getByRole('button', { name: /^Only show when:/ })).toBeTruthy();
  });

  it('shows the state rule and the condition together, and keeps both editors on the page', async () => {
    await mount(documentFor({ ...section(), visibleWhen: condition }));
    expect(disclosure().getAttribute('aria-label')).toBe('Only show when: Living Room Occupancy is On or Not home and Patio Door is open.');
    open();
    expect(screen.getByRole('region', { name: 'State Rule' }).textContent).toContain('Living Room Occupancy is On or Not home');
    expect(screen.getByRole('region', { name: 'Additional Condition' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Condition view' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Condition' })).toBeTruthy();
  });

  it('changes the existing source and states in single undoable draft steps, then applies once', async () => {
    const { seen } = await mount();
    open();
    const initial = seen.draft!.get();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.queryByRole('option', { name: 'Unbound Entity' })).toBeNull();
    expect(within(screen.getByRole('listbox', { name: 'Sources' })).getAllByRole('option')).toHaveLength(2);
    fireEvent.click(await screen.findByRole('option', { name: 'Patio Door' }));
    expect(visibility(seen.draft!.get())).toEqual({ ...stateRule, sourceId: 'door-source' });
    undoDraft();
    expect(seen.draft!.get()).toBe(initial);
    redoDraft();
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/ha/entity-states?entityId=binary_sensor.demo_door'));
    const states = within(screen.getByRole('group', { name: 'States' }));
    const beforeStates = seen.draft!.get();
    fireEvent.click(await states.findByRole('button', { name: 'Closed' }));
    expect(states.getByRole('button', { name: 'Ajar' })).toBeTruthy();
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'door-source', states: ['on', 'not_home', 'closed'] });
    undoDraft();
    expect(seen.draft!.get()).toBe(beforeStates);
    redoDraft();
    fireEvent.change(screen.getByRole('textbox', { name: 'Other state' }), { target: { value: 'waiting_for_guest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'door-source', states: ['on', 'not_home', 'closed', 'waiting_for_guest'] });
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    expect(seen.changes).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(1);
    expect(visibility(seen.document)).toEqual({ sourceId: 'door-source', states: ['on', 'not_home', 'closed', 'waiting_for_guest'] });
    act(() => seen.studio!.undo());
    expect(seen.document).toBe(initial);
    act(() => seen.studio!.redo());
    expect(visibility(seen.document)).toEqual({ sourceId: 'door-source', states: ['on', 'not_home', 'closed', 'waiting_for_guest'] });
  });

  it('shows and edits a template-private rule, with private sources shadowing globals and no other template sources offered', async () => {
    const start = documentFor({ id: 'room-use', type: 'component-ref', layout: { span: 1 }, componentId: 'room-template' });
    start.componentLibrary = [
      { id: 'room-template', name: 'Room Template', node: section(), sources: [
        { id: 'occupancy-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'binary_sensor.demo_door' } },
        { id: 'private-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'binary_sensor.demo_unbound' } },
      ] },
      { id: 'other-template', name: 'Other Template', node: { ...section(), id: 'other-room' }, sources: [
        { id: 'other-private-source', kind: 'ha-entity', entityId: { type: 'literal', value: 'binary_sensor.demo_other' } },
      ] },
    ];
    const templatePath: EditorPath = ['componentLibrary', 0, 'node'];
    expect(() => compileCompositionDocument(start)).not.toThrow();
    const { seen } = await mount(start, true, 'room-use');
    expect(disclosure().getAttribute('aria-label')).toBe('Only show when: Patio Door is On or Not home.');
    open();
    expect(screen.getByRole('region', { name: 'State Rule' }).textContent).toContain('Patio Door is On or Not home');
    expect(screen.getByRole('button', { name: 'Done' }).hasAttribute('disabled')).toBe(false);
    await waitFor(() => expect(request).toHaveBeenCalledWith('/native/api/ha/entity-states?entityId=binary_sensor.demo_door'));
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.queryByRole('option', { name: 'Living Room Occupancy' })).toBeNull();
    expect(screen.queryByRole('option', { name: /demo_other/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Unbound Entity' }));
    fireEvent.click(await within(screen.getByRole('group', { name: 'States' })).findByRole('button', { name: 'Off' }));
    expect(visibility(seen.draft!.get(), templatePath)).toEqual({ sourceId: 'private-source', states: ['on', 'not_home', 'off'] });
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    expect(seen.draft!.get().dataSources).toBe(start.dataSources);
    expect(seen.draft!.get().componentLibrary![1]).toBe(start.componentLibrary[1]);
    expect(() => writeStateVisibility(replaceAt(start, path, section()), path, { ...stateRule, sourceId: 'private-source' })).toThrow('Choose a source already in this document.');
    expect(() => writeStateVisibility(start, templatePath, { ...stateRule, sourceId: 'other-private-source' })).toThrow('Choose a source already in this document.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(1);
    expect(visibility(seen.document, templatePath)).toEqual({ sourceId: 'private-source', states: ['on', 'not_home', 'off'] });
    expect(seen.errors).toEqual([]);
  });

  it('creates and retargets a home-status model rule using suggested states, without offering unsupported models', async () => {
    const start = writeStateVisibility(documentFor(), path, undefined);
    start.dataSources.push(
      { id: 'lights-status', kind: 'model', model: 'home-status@1',
        inputs: { projection: 'lights', format: 'summary', entityIds: [{ type: 'literal', value: 'light.demo_status' }], awayEntityIds: [] },
        labels: { idle: 'Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'Empty', hidden: 'Hidden' } },
      { id: 'occupancy-status', kind: 'model', model: 'home-status@1',
        inputs: { projection: 'occupancy', format: 'summary', entityIds: [{ type: 'literal', value: 'binary_sensor.demo_occupancy' }], awayEntityIds: [] },
        labels: { idle: 'Unoccupied', active: 'Occupied', countSuffix: '', loading: 'Loading', unavailable: 'Unavailable', empty: 'Empty', hidden: 'Hidden' } },
    );
    const { seen } = await mount(start, false);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.queryByRole('option', { name: 'App state' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /^Home status.*lights$/ }));
    expect(visibility(seen.draft!.get())).toBeUndefined();
    expect(seen.draft!.canUndo()).toBe(false);
    const states = within(screen.getByRole('group', { name: 'States' }));
    expect(states.getByRole('button', { name: 'Idle' })).toBeTruthy();
    expect(states.getByRole('button', { name: 'Unavailable' })).toBeTruthy();
    fireEvent.click(states.getByRole('button', { name: 'Active' }));
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'lights-status', states: ['active'] });
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    const created = seen.draft!.get();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    fireEvent.click(screen.getByRole('option', { name: /^Home status.*occupancy$/ }));
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'occupancy-status', states: ['active'] });
    undoDraft();
    expect(seen.draft!.get()).toBe(created);
    redoDraft();
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(1);
    expect(visibility(seen.document)).toEqual({ sourceId: 'occupancy-status', states: ['active'] });
    expect(request.mock.calls.some(([url]) => url.includes('entity-states'))).toBe(false);
    expect(seen.errors).toEqual([]);
  });

  it('removes just the state rule and undoes it without losing the condition or other props', async () => {
    const start = documentFor({ ...section(), visibleWhen: condition, whenUnknown: 'hide' });
    const { seen } = await mount(start);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove State Rule' }));
    expect(visibility(seen.draft!.get())).toBeUndefined();
    expect(valueAt(seen.draft!.get(), [...path, 'visibleWhen'])).toEqual(condition);
    expect(valueAt(seen.draft!.get(), [...path, 'whenUnknown'])).toBe('hide');
    expect(valueAt(seen.draft!.get(), [...path, 'props', 'arrangement'])).toBe('grid');
    undoDraft();
    expect(seen.draft!.get()).toBe(start);
    redoDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(disclosure().textContent).toBe('Patio Door is open');
    expect(seen.changes).toBe(1);
    act(() => seen.studio!.undo());
    expect(seen.document).toBe(start);
  });

  it('keeps the condition removable separately and undoable on the same page', async () => {
    const start = documentFor({ ...section(), visibleWhen: condition, whenUnknown: 'hide' });
    const { seen } = await mount(start);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Condition' }));
    expect(valueAt(seen.draft!.get(), [...path, 'visibleWhen'])).toBeUndefined();
    expect(valueAt(seen.draft!.get(), [...path, 'whenUnknown'])).toBeUndefined();
    expect(visibility(seen.draft!.get())).toEqual(stateRule);
    undoDraft();
    expect(seen.draft!.get()).toBe(start);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('creates a rule only once an existing source and a non-empty state are chosen, offline too', async () => {
    const start = writeStateVisibility(documentFor(), path, undefined);
    const { seen } = await mount(start, false);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Occupancy' }));
    expect(seen.draft!.canUndo()).toBe(false);
    expect(visibility(seen.draft!.get())).toBeUndefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Other state' }), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'occupancy-source', states: ['on'] });
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    undoDraft();
    expect(seen.draft!.get()).toBe(start);
    expect(seen.draft!.canUndo()).toBe(false);
    expect(request.mock.calls.some(([url]) => url.includes('entity-states'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('keeps a new rule source when the phone picker pushes a page and returns', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const start = writeStateVisibility(documentFor(), path, undefined);
    const { seen } = await mount(start, false);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getByRole('heading', { name: 'Source' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('option', { name: 'Occupancy' }));
    expect(screen.getByRole('button', { name: 'Source' }).textContent).toBe('Occupancy');
    fireEvent.change(screen.getByRole('textbox', { name: 'Other state' }), { target: { value: 'on' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(visibility(seen.draft!.get())).toEqual({ sourceId: 'occupancy-source', states: ['on'] });
    undoDraft();
    expect(seen.draft!.get()).toBe(start);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('refuses empty and oversized states, including removing the last selected state', async () => {
    const start = replaceAt(documentFor(), [...path, 'props', 'visibility', 'states'], ['on']);
    const { seen } = await mount(start);
    open();
    fireEvent.click(within(screen.getByRole('group', { name: 'States' })).getByRole('button', { name: 'On' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose 1 to 32 states, each with 1 to 160 characters.');
    expect(seen.draft!.get()).toBe(start);
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(seen.draft!.get()).toBe(start);
    fireEvent.change(screen.getByRole('textbox', { name: 'Other state' }), { target: { value: 'x'.repeat(161) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(seen.draft!.get()).toBe(start);
    expect(seen.draft!.canUndo()).toBe(false);
    expect(seen.errors).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(0);
  });

  it('refuses oversized original input before trimming, preserves the draft, and accepts the exact limit', async () => {
    const { seen } = await mount(documentFor(), false);
    open();
    const initial = seen.draft!.get();
    const other = screen.getByRole('textbox', { name: 'Other state' }) as HTMLInputElement;
    const oversized = `${'x'.repeat(160)} `;
    fireEvent.change(other, { target: { value: oversized } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose 1 to 32 states, each with 1 to 160 characters.');
    expect(other.value).toBe(oversized);
    expect(seen.draft!.get()).toBe(initial);
    expect(seen.draft!.canUndo()).toBe(false);
    expect(seen.changes).toBe(0);
    expect(seen.errors).toEqual(['Choose 1 to 32 states, each with 1 to 160 characters.']);
    fireEvent.change(other, { target: { value: 'x'.repeat(160) } });
    fireEvent.keyDown(other, { key: 'Enter' });
    expect(visibility(seen.draft!.get())).toEqual({ ...stateRule, states: [...stateRule.states, 'x'.repeat(160)] });
    fireEvent.change(other, { target: { value: ' waiting ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(visibility(seen.draft!.get())).toEqual({ ...stateRule, states: [...stateRule.states, 'x'.repeat(160), 'waiting'] });
    expect(() => compileCompositionDocument(seen.draft!.get())).not.toThrow();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(1);
  });

  it('reports a failed state lookup without losing the rule or preventing free entry', async () => {
    const { seen } = await mount();
    request.mockRejectedValueOnce(new Error('offline'));
    open();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Home Assistant's states could not be read.");
    expect(visibility(seen.draft!.get())).toEqual(stateRule);
    fireEvent.change(screen.getByRole('textbox', { name: 'Other state' }), { target: { value: 'ajar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(visibility(seen.draft!.get())).toEqual({ ...stateRule, states: [...stateRule.states, 'ajar'] });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('leaves nodes without this prop on the existing condition editor', async () => {
    const node: CompositionNode = { id: 'room', type: 'text', title: 'Caption', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hello' }, style: 'body', unavailableText: 'Unavailable' } };
    const start = documentFor(node);
    expect(allowsStateVisibility(start, path)).toBe(false);
    const { seen } = await mount(start);
    expect(disclosure().getAttribute('aria-label')).toBe('Only show when: Always.');
    open();
    expect(screen.queryByRole('region', { name: 'State Rule' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Condition view' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(seen.changes).toBe(0);
    expect(seen.document).toBe(start);
  });

  it('rejects missing or inappropriate sources and unsupported nodes rather than changing them', () => {
    const start = documentFor();
    expect(() => writeStateVisibility(start, path, { ...stateRule, sourceId: 'missing-source' })).toThrow('Choose a source already in this document.');
    expect(() => writeStateVisibility(start, path, { ...stateRule, sourceId: 'window-source' })).toThrow('Choose an entity or Home status source.');
    expect(() => writeStateVisibility(start, path, { ...stateRule, states: Array.from({ length: 33 }, (_, i) => `state-${i}`) })).toThrow('Choose 1 to 32 states');
    const unsupported = replaceAt(start, path, { id: 'room', type: 'text', title: 'Caption', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hello' }, style: 'body', unavailableText: 'Unavailable' } });
    expect(() => writeStateVisibility(unsupported, path, stateRule)).toThrow('This item cannot have a state rule.');
    expect(visibility(start)).toBe(stateRule);
  });

  it('blocks Done if a draft receives an invalid rule by another editor path', async () => {
    const { seen } = await mount();
    open();
    act(() => seen.draft!.set(replaceAt(seen.draft!.get(), [...path, 'props', 'visibility', 'sourceId'], 'missing-source')));
    expect(screen.getByRole('button', { name: 'Done' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Done' }).title).toBe('Choose a source already in this document.');
    expect(seen.changes).toBe(0);
    act(() => seen.draft!.undo());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  });
});
