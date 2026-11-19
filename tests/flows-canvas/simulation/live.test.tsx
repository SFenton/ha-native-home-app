// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { resetLiveRuns } from '../../../src/workspace2/data/liveRun';
import { SimulationFlowBridge, sharedFlowRequests, useSimulationSnapshot, type FlowState } from '../../../src/workspace2/logic-simulation/live';
import { runSimulation, type HeldSnapshot } from '../../../src/workspace2/logic-simulation/engine';
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
});
