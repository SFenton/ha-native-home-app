// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { PipelineInputs, PipelineSource } from '../src/shared/composition/pipeline';
import type { NativeState } from '../src/shared/native-state';
import RunBar, { runWords } from '../src/workspace2/data/RunBar';
import { defaultInputs, settleFlow } from '../src/workspace2/data/flow';
import { RUN_DEBOUNCE_MS, resetLiveRuns } from '../src/workspace2/data/liveRun';
import { flowData, resetSamples } from '../src/workspace2/data/samples';
import FlowsPanel from '../src/workspace2/flows/FlowsPanel';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import { useLibrary } from '../src/workspace2/useLibrary';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
const flowId = 'demo-empty-flow';
const lightIds = ['light.demo_one', 'light.demo_two', 'light.demo_three', 'light.demo_four'];
const lights = settleFlow({
  ...defaultInputs('group', 'Lights on', { entityIds: lightIds }),
  steps: [
    { id: 'filter-on', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['state'] }, right: { type: 'literal', value: 'on' } } },
    { id: 'titles', op: 'map', fields: { id: { type: 'item', path: ['entityId'] }, title: { type: 'item', path: ['entityId'] } } },
  ],
  output: { kind: 'rows', max: 50, row: { id: { type: 'item', path: ['id'] }, title: { type: 'item', path: ['title'] } } },
});
const todo = defaultInputs('live-list', 'To-do list', { entityId: 'todo.demo_list' });
const states = (state = 'off') => new Map(lightIds.map(entityId => [entityId, { entityId, name: 'Demo light', state }]));
const listState = (state = '0'): ReadonlyMap<string, NativeState> => new Map([['todo.demo_list', { entityId: 'todo.demo_list', name: 'Demo list', state }]]);
const context = { clock: { now: '2026-11-21T12:00:00', utcOffsetMinutes: 0 } };
const at = '2026-11-21T20:00:00.000Z';
const timeout = RUN_DEBOUNCE_MS + 2500;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = (items: unknown[] = []) => response({ at, response: { items }, items: items.length, output: [], source: 'live' });
const lightsSummary = 'Live · Read 4 lights · none left after Filter (state is on) · Output 0 items';
const todoSummary = 'Live · Read 0 items from the list · Output 0 items';

function Surface({ inputs, held }: { inputs: PipelineInputs; held?: ReadonlyMap<string, NativeState> }) {
  const source: PipelineSource = { id: flowId, kind: 'model', model: 'pipeline@1', inputs };
  const document = { ...home, dataSources: [...home.dataSources, source] };
  const library = useLibrary('docked', 1440);
  const ws = Project.workspace(document, undefined, { extra: { flowId, openFlow: vi.fn() } });
  return <WorkspaceDataProvider document={document} house={{ states: held }}>
    <RunBar flowId={flowId} inputs={inputs} onSample={() => {}}/>
    <FlowsPanel ws={ws} library={library} onKeepPanel={() => {}} onError={vi.fn()}/>
  </WorkspaceDataProvider>;
}
const bar = () => screen.getByTestId('run-bar');
const panel = () => within(screen.getByTestId('flows-panel'));

beforeEach(() => { localStorage.clear(); resetSamples(); resetLiveRuns(); });
afterEach(() => { cleanup(); resetLiveRuns(); vi.unstubAllGlobals(); });

describe('an empty live flow explains the read, the first empty step and the output', () => {
  it('shows the four lights read, not no data, when all are filtered out in both surfaces', () => {
    const data = flowData(lights, { states: states(), context });
    expect(data.response).toHaveLength(4);
    expect(data.result).toMatchObject({ status: 'ok', trace: [{ id: 'filter-on', size: 0 }, { id: 'titles', size: 0 }], output: [] });
    render(<Surface inputs={lights} held={states()}/>);
    expect(within(bar()).getByRole('status').getAttribute('aria-label')).toContain(lightsSummary);
    expect(panel().getByTestId('empty-live-summary').textContent).toBe(lightsSummary);
    expect(panel().getByText('Output · 0 items')).toBeTruthy();
    expect(bar().textContent).not.toContain('Nothing to run');
    expect(within(bar()).getByTestId('empty-live-hint').textContent).toContain('Edit Flow in Canvas, then Simulation · Studio only');
    expect(panel().getByText(/^Try it:/)).toBeTruthy();
  });

  it('says the to-do list answered with zero items, without blaming Go Into', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer()));
    render(<Surface inputs={todo} held={listState()}/>);
    await waitFor(() => expect(bar().textContent).toContain(todoSummary), { timeout });
    expect(panel().getByTestId('empty-live-summary').textContent).toBe(todoSummary);
    expect(bar().textContent).not.toContain('none left after');
    expect(within(bar()).getByTestId('empty-live-hint')).toBeTruthy();
  });

  it('does not call an unanswered request an empty live list while loading', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    render(<Surface inputs={todo} held={listState()}/>);
    await waitFor(() => expect(release).toBeDefined(), { timeout });
    expect(bar().textContent).toContain('Loading');
    expect(bar().textContent).toContain('not a live answer yet');
    expect(panel().getByText('Loading')).toBeTruthy();
    expect(screen.queryByTestId('empty-live-summary')).toBeNull();
    expect(screen.queryByTestId('empty-live-hint')).toBeNull();
    expect(panel().queryByText('Output · 0 items')).toBeNull();
    await act(async () => { release(answer()); });
    await waitFor(() => expect(bar().textContent).toContain(todoSummary));
  });

  it.each(['unknown', 'unavailable'])('keeps %s entity states distinct from lights all being off', state => {
    render(<Surface inputs={lights} held={states(state)}/>);
    expect(bar().textContent).toContain("Can't tell yet");
    expect(bar().textContent).toContain('Requested 4 lights. 4 are unavailable or unknown.');
    expect(screen.queryByTestId('empty-live-summary')).toBeNull();
    expect(screen.queryByTestId('empty-live-hint')).toBeNull();
    expect(panel().queryByText('Output · 0 items')).toBeNull();
  });

  it('does not infer an empty list from a response with an unavailable list value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ at, response: { items: null } })));
    render(<Surface inputs={todo} held={listState()}/>);
    await waitFor(() => expect(bar().textContent).toContain('The request did not return a list of items.'), { timeout });
    expect(bar().textContent).toContain("Can't tell yet");
    expect(screen.queryByTestId('empty-live-summary')).toBeNull();
    expect(panel().queryByText('Output · 0 items')).toBeNull();
  });

  it('shows a failed first request as an error, not a live empty answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'The list could not be read.', code: 'unavailable' }, 503)));
    render(<Surface inputs={todo} held={listState()}/>);
    await waitFor(() => expect(bar().textContent).toContain('The list could not be read.'), { timeout });
    expect(bar().textContent).toContain('Error');
    expect(within(bar()).getByRole('alert').textContent).toBe('The list could not be read.');
    expect(panel().getByRole('alert').textContent).toBe('The list could not be read.');
    expect(screen.queryByTestId('empty-live-summary')).toBeNull();
    expect(screen.queryByTestId('empty-live-hint')).toBeNull();
  });

  it('labels a kept empty answer as the last answer during refresh, then stale on failure', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer()).mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })));
    const view = render(<Surface inputs={todo} held={listState()}/>);
    await waitFor(() => expect(bar().textContent).toContain(todoSummary), { timeout });
    view.rerender(<Surface inputs={todo} held={listState('1')}/>);
    await waitFor(() => expect(release).toBeDefined(), { timeout });
    expect(bar().textContent).toContain('Live · Last answer: Read 0 items from the list');
    expect(bar().textContent).toContain('Refreshing from Home Assistant');
    await act(async () => { release(response({ error: 'Home Assistant did not answer.', code: 'timeout' }, 504)); });
    await waitFor(() => expect(bar().textContent).toContain('Stale · Last answer: Read 0 items from the list'));
    expect(bar().textContent).toContain('Last answer kept; it may be out of date.');
    expect(panel().getByTestId('empty-live-summary').textContent).toBe('Stale · Last answer: Read 0 items from the list · Output 0 items');
    expect(within(bar()).getByRole('alert').textContent).toBe('Home Assistant did not answer.');
  });

  it('preserves the non-empty live run and output preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer([{ uid: 'demo-item', summary: 'Demo chore', status: 'needs_action' }])));
    render(<Surface inputs={todo} held={listState('1')}/>);
    await waitFor(() => expect(bar().textContent).toContain('Live · 1 item'), { timeout });
    expect(bar().textContent).toContain('Home Assistant answered at');
    expect(panel().getByText('Output · 1 item')).toBeTruthy();
    expect(screen.queryByTestId('empty-live-summary')).toBeNull();
    expect(screen.queryByTestId('empty-live-hint')).toBeNull();
  });

  it('uses the request count and first reducing step even when a later step is also empty', () => {
    const inputs = settleFlow({ ...lights, steps: [
      { id: 'two-lights', op: 'filter', where: { type: 'in', value: { type: 'item', path: ['entityId'] }, in: lightIds.slice(0, 2).map(value => ({ type: 'literal', value })) } }, ...lights.steps,
    ] });
    const data = flowData(inputs, { states: states(), context });
    expect(data.result).toMatchObject({ trace: [{ size: 2 }, { size: 0 }, { size: 0 }] });
    expect(runWords(inputs, data).head).toBe(lightsSummary);
  });

  it('does not turn an unavailable attribute into an empty list when Filter coerces it', () => {
    const inputs = settleFlow({ ...defaultInputs('attribute', 'Attribute items', { entityId: 'sensor.demo_items' }), steps: [{ id: 'filter', op: 'filter', where: { type: 'exists', value: { type: 'item', path: ['name'] } } }] });
    const held = new Map([['sensor.demo_items', { entityId: 'sensor.demo_items', name: 'Demo items', state: 'unknown', items: null }]]);
    const data = flowData(inputs, { states: held, context });
    expect(data.source).toBe('live');
    expect(data.items).toBe(0);
    expect(runWords(inputs, data)).toMatchObject({ head: "Can't tell yet", tone: 'none' });
  });

  it('keeps Nothing to run only for a flow with no request configured', () => {
    const inputs = defaultInputs('none', 'Fixed value');
    expect(runWords(inputs, flowData(inputs, { context })).note).toBe('Worked out on the phone. Nothing to run.');
    expect(runWords(lights, flowData(lights, { context })).note).not.toContain('Nothing to run');
  });
});
