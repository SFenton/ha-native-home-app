// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { NativeState } from '../src/shared/native-state';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import RunBar, { runWords } from '../src/workspace2/data/RunBar';
import { flowById, newFlow } from '../src/workspace2/data/flow';
import { flowData, keepSample, resetSamples, sampleOf } from '../src/workspace2/data/samples';
import { RUN_DEBOUNCE_MS, requestKeyOf, resetLiveRuns, watchedEntities } from '../src/workspace2/data/liveRun';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const home = homeDomains.document as unknown as CompositionDocument;
const chores = newFlow(home, 'live-list', { entityId: 'todo.example_chores', title: 'Chores' });
const inputs = flowById(chores.document, chores.id)!.inputs;
const context = { clock: { now: '2026-11-12T09:41:00', utcOffsetMinutes: 0 } };
const state = (value: string): NativeState => ({ entityId: 'todo.example_chores', state: value, name: 'Chores' });
const answer = (titles: string[]) => ({ source: 'live', at: '2026-11-12T17:41:00.000Z', output: [], items: titles.length, response: { items: titles.map((summary, at) => ({ uid: `u${at}`, summary, status: 'needs_action' })) } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The run bar over a house whose to-do entity is in `states` (none: Home Assistant is not connected). */
function bar(states: ReadonlyMap<string, NativeState> | undefined) {
  return <WorkspaceDataProvider document={home} house={{ states }}><RunBar flowId={chores.id} inputs={inputs} onSample={() => {}}/></WorkspaceDataProvider>;
}
const connected = (value: string) => new Map([['todo.example_chores', state(value)], ['sensor.example_other', { ...state('1'), entityId: 'sensor.example_other' }]]);

beforeEach(() => { localStorage.clear(); resetSamples(); resetLiveRuns(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the live run of a Data Flow', () => {
  it('asks only for what the answer depends on, and watches the entities it reads', () => {
    expect(watchedEntities(inputs)).toEqual(['todo.example_chores']);
    const edited = { ...inputs, steps: [{ id: 'l', op: 'limit' as const, count: 3 }] };
    expect(requestKeyOf(edited)).toBe(requestKeyOf(inputs));
  });

  it('draws what the server returned as Live, ahead of a kept sample, and demo data when Hide Values is on', () => {
    keepSample(chores.id, { items: [] });
    const live = { items: [{ uid: 'a', summary: 'Water the plants', status: 'needs_action' }] };
    const data = flowData(inputs, { context, sample: sampleOf(chores.id), live });
    expect(data.source).toBe('live');
    expect(data.response).toEqual(live);
    expect(flowData(inputs, { context, sample: sampleOf(chores.id), live, hide: true }).source).toBe('demo');
    expect(flowData(inputs, { context }).source).toBe('demo');
  });

  it('says Live, when Home Assistant answered, and what is on its way', () => {
    const live = { source: 'live' as const, items: 2, run: { at: '2026-11-12T17:41:00.000Z', running: false } };
    expect(runWords(inputs, live)).toMatchObject({ head: 'Live · 2 items', tone: 'live' });
    expect(runWords(inputs, live).note).toMatch(/^Home Assistant answered at /);
    expect(runWords(inputs, { ...live, run: { ...live.run, running: true } }).note).toBe('Refreshing from Home Assistant…');
    expect(runWords(inputs, { source: 'demo', items: 3 })).toMatchObject({ head: 'Demo Data · 3 items', tone: 'demo' });
  });

  it('shows Live once Home Assistant answers, keeps the rows through a refresh, and reruns when its entity changes', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(answer(['Water the plants', 'Take out the trash'])))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(bar(connected('2')));
    const runBar = () => screen.getByTestId('run-bar');
    expect(runBar().textContent).toContain('Demo Data');
    await waitFor(() => expect(runBar().textContent).toContain('Live · 2'), { timeout: RUN_DEBOUNCE_MS + 2500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('./native/api/ha/flow-run');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).inputs.request.kind).toBe('todo-items');
    // An entity this flow does not read changes: nothing runs.
    view.rerender(bar(new Map([...connected('2'), ['sensor.example_other', { ...state('9'), entityId: 'sensor.example_other' }]])));
    await new Promise(resolve => setTimeout(resolve, RUN_DEBOUNCE_MS + 200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The to-do entity changes: a run, and the rows stay while it is on its way.
    view.rerender(bar(connected('3')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: RUN_DEBOUNCE_MS + 2500 });
    expect(runBar().textContent).toContain('Live · 2');
    expect(runBar().textContent).toContain('Refreshing from Home Assistant…');
    await act(async () => { release(json(answer(['One', 'Two', 'Three']))); });
    await waitFor(() => expect(runBar().textContent).toContain('Live · 3'));
  });

  it('keeps the last rows and says why when a run fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(answer(['A']))).mockResolvedValueOnce(json({ error: "Home Assistant didn't answer in 10 seconds.", code: 'timeout' }, 504)));
    const view = render(bar(connected('1')));
    await waitFor(() => expect(screen.getByTestId('run-bar').textContent).toContain('Live · 1'), { timeout: RUN_DEBOUNCE_MS + 2500 });
    view.rerender(bar(connected('2')));
    const alert = await screen.findByRole('alert', undefined, { timeout: RUN_DEBOUNCE_MS + 2500 });
    expect(alert.textContent).toBe("Home Assistant didn't answer in 10 seconds.");
    expect(screen.getByTestId('run-bar').textContent).toContain('Live · 1');
  });

  it('falls back to demo data and the sample when Home Assistant is not connected, and never asks the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(bar(undefined));
    expect(screen.getByTestId('run-bar').textContent).toContain('Demo Data');
    expect(screen.getByTestId('run-bar').textContent).not.toContain('Live');
    await new Promise(resolve => setTimeout(resolve, RUN_DEBOUNCE_MS + 300));
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
    const service = newFlow(home, 'service', { title: 'Service' });
    const serviceInputs = flowById(service.document, service.id)!.inputs;
    keepSample(service.id, { kept: true });
    render(<WorkspaceDataProvider document={home} house={{ states: undefined }}><RunBar flowId={service.id} inputs={serviceInputs} onSample={() => {}}/></WorkspaceDataProvider>);
    expect(screen.getByTestId('run-bar').textContent).toContain('Sample');
    expect(screen.getByRole('button', { name: /Paste a Sample/ })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
