// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { resetLiveRuns } from '../../../src/workspace2/data/liveRun';
import { SimulationFlowBridge, sharedFlowRequests, useSimulationSnapshot, type FlowState } from '../../../src/workspace2/logic-simulation/live';
import { runSimulation, type HeldSnapshot } from '../../../src/workspace2/logic-simulation/engine';
import { SimulationFlowBridges } from '../../../src/workspace2/logic-simulation/BridgeOwner';
import { SimulationHost } from '../../../src/workspace2/logic-simulation/SimulationHost';
import { FIXTURE_CLOCK, simulationFixture } from './fixture';
import type { PipelineInputs } from '../../../src/shared/composition/pipeline';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe('S-live shared owner and request path', () => {
  let root: Root, container: HTMLDivElement;
  const fixture = simulationFixture(), live = new LiveHouse();
  beforeEach(() => {
    vi.useFakeTimers(); resetLiveRuns();
    live.applySnapshot(fixture.states, fixture.held.base.viewer);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(() => root.unmount()); container.remove(); resetLiveRuns(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async (children: ReactNode) => {
    await act(() => root.render(<WorkspaceDataProvider document={fixture.document} house={live.house} live={live}>{children}</WorkspaceDataProvider>));
  };
  it('shares identical requests, reruns steps locally, cancels debounce and ignores late responses when simulated', async () => {
    const requests = sharedFlowRequests(fixture.program);
    expect(requests).toHaveLength(1); expect(requests[0].ids).toEqual(['chores-count', 'chores-display']);
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const observed: FlowState[] = [], onRun = (_ids: readonly string[], state: FlowState) => { observed.push(state); };
    const bridge = (inputs: PipelineInputs, enabled = true) => <SimulationFlowBridge {...requests[0]} inputs={inputs} enabled={enabled} onRun={onRun} />;
    await render(bridge(requests[0].inputs)); await act(() => vi.advanceTimersByTimeAsync(599)); expect(fetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('./native/api/ha/flow-run');
    await render(bridge({ ...requests[0].inputs, steps: [] })); await act(() => vi.advanceTimersByTimeAsync(1000)); expect(fetch).toHaveBeenCalledTimes(1);
    await render(bridge(requests[0].inputs, false));
    await act(async () => resolve(new Response(JSON.stringify({ response: { items: [] }, at: '2026-11-18T16:00:00Z' }))));
    expect(observed.some(state => state.run.answer)).toBe(false);
    await render(bridge(requests[0].inputs)); await render(bridge(requests[0].inputs, false));
    await act(() => vi.advanceTimersByTimeAsync(1000)); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects request races and labels retained answers stale after a failed refresh', async () => {
    const request = sharedFlowRequests(fixture.program)[0];
    const resolvers: ((response: Response) => void)[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { resolvers.push(resolve); }));
    let state: FlowState | undefined, held: HeldSnapshot | undefined;
    function Probe({ inputs }: { inputs: PipelineInputs }) {
      const current = state;
      const program = { ...fixture.program, flows: new Map(fixture.program.flows).set(request.id, inputs) };
      held = useSimulationSnapshot(program, fixture.document, current ? Object.fromEntries(request.ids.map(id => [id, current])) : {}, { clock: FIXTURE_CLOCK });
      return <SimulationFlowBridge {...request} inputs={inputs} enabled onRun={(_ids, next) => { state = next; }} />;
    }
    const first = request.inputs, changed = { ...first, parameters: [{ name: 'changed', type: 'number' as const, value: { type: 'literal' as const, value: 1 } }] };
    await render(<Probe inputs={first} />); await act(() => vi.advanceTimersByTimeAsync(600));
    await render(<Probe inputs={changed} />); await act(() => vi.advanceTimersByTimeAsync(600));
    await act(async () => resolvers[0](new Response(JSON.stringify({ response: { old: true }, at: '2026-11-18T16:00:00Z' }))));
    expect(state?.run.answer).toBeUndefined();
    await act(async () => resolvers[1](new Response(JSON.stringify({ response: { current: true }, at: '2026-11-18T16:00:01Z' }))));
    expect(state?.run.answer?.response).toEqual({ current: true });
    await act(() => live.applyStream([{ entityId: 'todo.example_chores', name: 'Fake chores', state: '1' }]));
    await act(() => vi.advanceTimersByTimeAsync(600));
    await act(async () => resolvers[2](new Response(JSON.stringify({ error: 'Fixture refresh failed' }), { status: 503 })));
    await render(<Probe inputs={changed} />);
    expect(held?.stale).toBe(true); expect(held?.error).toBe('Fixture refresh failed');
    expect(state?.run.answer?.response).toEqual({ current: true });
  });
  it('tracks entity and viewer versions despite stable mutable map identity, with no socket or fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No requests allowed'));
    let held: HeldSnapshot | undefined;
    function Probe() { held = useSimulationSnapshot(fixture.program, fixture.document, {}, { clock: FIXTURE_CLOCK }); return null; }
    await render(<Probe />);
    const states = live.states, bedroom = live.states.get('sensor.demo_bedroom_temperature')!;
    await act(() => live.applyStream([{ ...bedroom, state: '25' }]));
    expect(live.states).toBe(states);
    expect(runSimulation(fixture.program, held!).outputs.find(output => output.output.id === 'subtitle')?.result).toEqual({ kind: 'operand', answer: { status: 'value', value: 'Too Warm' } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retires a removed group before its debounce fires and refreshes when restored', async () => {
    const requests = sharedFlowRequests(fixture.program);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    const onRun = vi.fn();
    await render(<SimulationFlowBridges requests={requests} enabled onRun={onRun} />);
    await act(() => vi.advanceTimersByTimeAsync(599));
    await render(<SimulationFlowBridges requests={[]} enabled onRun={onRun} />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();
    await render(<SimulationFlowBridges requests={requests} enabled onRun={onRun} />);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('drops removed in-flight answers, retires changed identities and never reuses their late answers', async () => {
    const requests = sharedFlowRequests(fixture.program), resolvers: ((response: Response) => void)[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { resolvers.push(resolve); }));
    const observed: FlowState[] = [], onRun = (_ids: readonly string[], state: FlowState) => { observed.push(state); };
    const pool = (current = requests) => <SimulationFlowBridges requests={current} enabled onRun={onRun} />;
    await render(pool()); await act(() => vi.advanceTimersByTimeAsync(600));
    await render(pool([]));
    await act(async () => resolvers[0](Response.json({ response: { removed: true }, at: '2026-11-18T16:00:00Z' })));
    await render(pool());
    expect(observed.some(state => state.run.answer)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(600)); expect(fetch).toHaveBeenCalledTimes(2);
    const changed = requests.map(request => ({ ...request, inputs: { ...request.inputs,
      parameters: [{ name: 'changed', type: 'number' as const, value: { type: 'literal' as const, value: 1 } }] } }));
    await render(pool(changed));
    await act(async () => resolvers[1](Response.json({ response: { oldIdentity: true }, at: '2026-11-18T16:00:01Z' })));
    await act(() => vi.advanceTimersByTimeAsync(600)); expect(fetch).toHaveBeenCalledTimes(3);
    expect(observed.some(state => state.run.answer)).toBe(false);
    await act(async () => resolvers[2](Response.json({ response: { fresh: true }, at: '2026-11-18T16:00:02Z' })));
    expect(observed.at(-1)?.run.answer?.response).toEqual({ fresh: true });
  });
  it.each(['pending', 'in flight'] as const)('retires a directly unmounted host with a request %s', async phase => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const host = <SimulationHost program={fixture.program} document={fixture.document} canvasId="direct-unmount"
      liveClock={FIXTURE_CLOCK} blockNames={fixture.blockNames} />;
    await render(host);
    await act(() => vi.advanceTimersByTimeAsync(phase === 'pending' ? 599 : 600));
    await render(null);
    if (phase === 'in flight') await act(async () => resolve(Response.json({ response: { late: true }, at: '2026-11-18T16:00:00Z' })));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).toHaveBeenCalledTimes(phase === 'pending' ? 0 : 1);
    const observed: FlowState[] = [];
    await render(<SimulationFlowBridges requests={sharedFlowRequests(fixture.program)} enabled onRun={(_ids, state) => { observed.push(state); }} />);
    expect(observed.some(state => state.run.answer)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetch).toHaveBeenCalledTimes(phase === 'pending' ? 1 : 2);
  });
  it.each(['same group', 'renamed group'])('retires replaced owners during a Strict Mode handoff: %s', async identity => {
    const requests = sharedFlowRequests(fixture.program), resolvers: ((response: Response) => void)[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { resolvers.push(resolve); }));
    const observed: FlowState[] = [], onRun = (_ids: readonly string[], state: FlowState) => { observed.push(state); };
    const pool = (key: string, current = requests) => <StrictMode><SimulationFlowBridges key={key} requests={current} enabled onRun={onRun} /></StrictMode>;
    await render(pool('first')); await act(() => vi.advanceTimersByTimeAsync(599));
    await render(pool('second', identity === 'same group' ? requests : requests.map(request => ({ ...request, id: 'renamed-group', ids: ['renamed-group'] }))));
    await act(() => vi.advanceTimersByTimeAsync(599)); expect(fetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(1);
    await render(pool('third'));
    await act(async () => resolvers[0](Response.json({ response: { retired: true }, at: '2026-11-18T16:00:00Z' })));
    await act(() => vi.advanceTimersByTimeAsync(600)); expect(fetch).toHaveBeenCalledTimes(2);
    expect(observed.some(state => state.run.answer)).toBe(false);
    await act(async () => resolvers[1](Response.json({ response: { fresh: true }, at: '2026-11-18T16:00:01Z' })));
    expect(observed.at(-1)?.run.answer?.response).toEqual({ fresh: true });
  });
  it('lets an active canvas refresh after an inactive owner releases the same store', async () => {
    const requests = sharedFlowRequests(fixture.program), onRun = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    const canvases = (first: boolean, second: boolean) => <>
      <SimulationFlowBridges requests={requests} enabled={first} onRun={onRun} />
      <SimulationFlowBridges requests={requests} enabled={second} onRun={onRun} />
    </>;
    await render(canvases(true, false)); await act(() => vi.advanceTimersByTimeAsync(599));
    await render(canvases(false, true)); await act(() => vi.advanceTimersByTimeAsync(599));
    expect(fetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1)); expect(fetch).toHaveBeenCalledTimes(1);
    await render(canvases(false, false)); await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
