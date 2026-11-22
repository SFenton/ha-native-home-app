// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import { createCompositionDocument } from '../../../src/shared/composition/workspace';
import { lift } from '../../../src/shared/composition/graph';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { SimulationHost } from '../../../src/workspace2/logic-simulation/SimulationHost';
import { SimulationDrawers } from '../../../src/workspace2/logic-simulation/Drawers';
import { ScenariosDrawer } from '../../../src/workspace2/logic-simulation/Scenarios';
import { simulationClock, useSimulationClock } from '../../../src/workspace2/logic-simulation/live';
import { captureScenario, runAll, runSimulation, type HeldSnapshot } from '../../../src/workspace2/logic-simulation/engine';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';
import { formatValue } from '../../../src/workspace2/canvas/value-format';
import { editClock } from '../../../src/workspace2/logic-simulation/presentation';

const timeZone = 'America/Los_Angeles';
const clock = { now: '2026-11-21T12:00:00', utcOffsetMinutes: -480 };
const timestamp = '2026-11-21T10:00:00Z';
const document = { ...createCompositionDocument('demo_clock_document'), dataSources: [
  { id: 'demo_timestamp', kind: 'ha-entity' as const, entityId: { type: 'literal' as const, value: 'sensor.demo_timestamp' } },
] };
const graph = lift({ type: 'last-changed', sourceId: 'demo_timestamp' }, { kind: 'operand' }).graph;
const program = createSimulationProgram([graph], { sourceEntities: { demo_timestamp: 'sensor.demo_timestamp' } });
const held: HeldSnapshot = { at: '2026-11-21T20:00:00Z', base: { clock, previousText: [], flowResponses: [],
  reads: [{ sourceId: 'demo_timestamp', access: 'last-changed', answer: { status: 'value', value: timestamp } }],
} };
const originalZone = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'Asia/Tokyo';
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(held.at));
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});
function liveHouse(zone?: string, lastChanged = timestamp) {
  const live = new LiveHouse();
  live.applySnapshot([{ entityId: 'sensor.demo_timestamp', state: 'on', name: 'Demo timestamp', lastChanged }], undefined, zone);
  return live;
}
describe('live house dates with a Tokyo browser', () => {
  it('uses the house clock and reacts to a zone-only snapshot without a network read', () => {
    const live = liveHouse(timeZone);
    const { result } = renderHook(() => useSimulationClock(document), { wrapper: ({ children }) =>
      <WorkspaceDataProvider document={document} house={live.house} live={live}>{children}</WorkspaceDataProvider> });
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Tokyo');
    expect(result.current).toEqual({ liveClock: clock, clockTimeZone: timeZone });
    act(() => live.applySnapshot([...live.states.values()], undefined, 'Asia/Tokyo'));
    expect(result.current.liveClock).toEqual({ now: '2026-11-22T05:00:00', utcOffsetMinutes: 540 });
    expect(simulationClock(new Date('2026-07-21T19:00:00Z'), timeZone)).toEqual({ now: '2026-07-21T12:00:00', utcOffsetMinutes: -420 });
  });
  it('caches a browser-rejected house zone and falls back consistently in clocks, values and drawers', async () => {
    const rejectedZone = 'America/Coyhaique', DateTimeFormat = Intl.DateTimeFormat;
    const intl = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
      if (options?.timeZone === rejectedZone) throw new RangeError('Unknown browser time zone');
      return new DateTimeFormat(locales, options);
    });
    const live = liveHouse(rejectedZone);
    const { result } = renderHook(() => useSimulationClock(document), { wrapper: ({ children }) =>
      <WorkspaceDataProvider document={document} house={live.house} live={live}>{children}</WorkspaceDataProvider> });
    const browserClock = { now: '2026-11-22T05:00:00', utcOffsetMinutes: 540 };
    expect(result.current).toEqual({ liveClock: browserClock, clockTimeZone: undefined });
    expect(simulationClock(new Date(held.at), rejectedZone)).toEqual(browserClock);
    expect(editClock(browserClock, '2026-11-22', '06:00', rejectedZone)).toEqual({ ...browserClock, now: '2026-11-22T06:00:00' });
    expect(formatValue(timestamp, { clock: browserClock, timeZone: rejectedZone })).toBe('Yesterday, 7:00 PM');
    render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
      <SimulationHost document={document} canvasId="demo_rejected_zone" program={program} clockTimeZone={rejectedZone} />
    </WorkspaceDataProvider>);
    const output = screen.getByRole('region', { name: 'Just the Values' }).querySelector('output')!;
    expect(output.textContent).toBe('Yesterday, 7:00 PM');
    expect(screen.getByText("Times shown in this browser's time zone")).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Evaluation trace' })).getByRole('button', { name: 'Each Run & Items' }));
    const evidence = screen.getByRole('region', { name: 'Run evidence' });
    expect(within(evidence).getByText('Yesterday, 7:00 PM').title).toContain(timestamp);
    fireEvent.click(within(evidence).getByRole('button', { name: 'Trace' }));
    expect(within(evidence).getByText('Yesterday, 7:00 PM').title).toContain(timestamp);
    fireEvent.click(screen.getByRole('button', { name: 'Close Run evidence' }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(screen.getByRole('button', { name: 'Scenarios' }));
    const row = screen.getByRole('row', { name: /Live now/ });
    expect(within(row).getAllByRole('cell').slice(0, 2).map(cell => cell.textContent)).toEqual(['Yesterday, 7:00 PM', 'Yesterday, 7:00 PM']);
    act(() => live.applySnapshot([...live.states.values()], undefined, timeZone));
    expect(result.current).toEqual({ liveClock: clock, clockTimeZone: timeZone });
    act(() => live.applySnapshot([...live.states.values()], undefined, rejectedZone));
    expect(result.current).toEqual({ liveClock: browserClock, clockTimeZone: undefined });
    expect(intl.mock.calls.filter(([, options]) => options?.timeZone === rejectedZone)).toHaveLength(1);
  });
  it.each([
    [timeZone, timestamp, 'Today, 2:00 AM'],
    [timeZone, '2026-03-08T10:30:00Z', 'Mar 8, 3:30 AM'],
    [undefined, timestamp, 'Yesterday, 7:00 PM'],
  ])('presents %s / %s with the correct day, historical offset and fallback notice', (zone, lastChanged, expected) => {
    const live = liveHouse(zone, lastChanged);
    render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
      <SimulationHost document={document} canvasId="demo_dates" program={program} clockTimeZone={zone}
        liveClock={zone ? clock : simulationClock(new Date(held.at), 'Asia/Tokyo')} />
    </WorkspaceDataProvider>);
    const output = screen.getByRole('region', { name: 'Just the Values' }).querySelector('output')!;
    expect(output.textContent).toBe(expected);
    expect(output.title).toContain(lastChanged);
    expect(Boolean(screen.queryByText("Times shown in this browser's time zone"))).toBe(!zone);
  });
});
it('formats typed Now in Each Run and Trace, preserving its exact value in descriptions and titles', () => {
  const graph = lift({ type: 'clock', part: 'now-second' }, { kind: 'operand' }).graph;
  const program = createSimulationProgram([graph]);
  const run = runSimulation(program, held);
  render(<SimulationDrawers outputs={run.outputs} program={program} blockNames={{}} clock={clock} timeZone={timeZone} />);
  const each = screen.getByText('Today, 12:00 PM');
  expect(each.getAttribute('aria-description')).toContain(clock.now);
  expect(each.title).toContain(clock.now);
  fireEvent.click(screen.getByRole('button', { name: /^Trace$/ }));
  const trace = screen.getByText('Today, 12:00 PM');
  expect(trace.getAttribute('aria-description')).toContain(clock.now);
  expect(trace.title).toContain(clock.now);
});
it.each(['unknown', 'unavailable', 'needs_action'])('keeps literal Text %s exact in the evidence drawer', value => {
  const graph = lift({ type: 'literal', value }, { kind: 'operand' }).graph;
  const program = createSimulationProgram([graph]);
  render(<SimulationDrawers outputs={runSimulation(program, held).outputs} program={program} blockNames={{}} clock={clock} timeZone={timeZone} />);
  expect(screen.getByText(value).getAttribute('aria-description')).toBe(value);
});
it('distinguishes scenario cells differing only in seconds and preserves captured offsets rather than applying the live zone', () => {
  const first = captureScenario(program, held, { id: 'demo_first', name: 'First seconds' });
  const secondHeld = { ...held, base: { ...held.base, clock: { ...clock, utcOffsetMinutes: 60 },
    reads: [{ sourceId: 'demo_timestamp', access: 'last-changed' as const, answer: { status: 'value' as const, value: '2026-11-21T10:00:01Z' } }],
  } };
  const second = captureScenario(program, secondHeld, { id: 'demo_second', name: 'Second seconds' });
  const third = { ...second, id: 'demo_third', name: 'Third seconds', base: { ...second.base,
    reads: [{ sourceId: 'demo_timestamp', access: 'last-changed' as const, answer: { status: 'value' as const, value: '2026-11-21T10:00:02Z' } }],
  } };
  const scenarios = [first, second, third];
  const run = runSimulation(program, held);
  render(<ScenariosDrawer open onClose={() => {}} program={program} scenarios={scenarios} snapshot={held} timeZone={timeZone}
    selectedId="" savedVersionDiffers={false} run={run} results={runAll(program, scenarios, held)} inputNodes={[graph.nodes[0]]}
    blockLabel={() => ({ name: 'Timestamp input' })} outputLabel={() => ({ name: 'Timestamp output' })}
    onSelect={() => {}} onCapture={() => {}} onCreate={() => {}} onRunAll={() => {}} onEdit={() => {}} onDelete={() => {}} blocked={false} />);
  const live = screen.getByRole('row', { name: /Live now/ });
  expect(within(live).getAllByRole('cell').slice(0, 2).map(cell => cell.textContent)).toEqual(['Today, 2:00 AM', 'Today, 2:00 AM']);
  for (const [name, raw] of [['Second seconds', '2026-11-21T10:00:01Z'], ['Third seconds', '2026-11-21T10:00:02Z']]) {
    const row = screen.getByRole('row', { name: new RegExp(name) });
    for (const cell of within(row).getAllByRole('cell').slice(0, 2)) {
      expect(cell.textContent).toBe('Today, 11:00 AM');
      expect(cell.title).toContain(raw);
      expect(cell.getAttribute('aria-description')).toContain(raw);
    }
  }
});
it('uses the active clock and zone for a modified scenario output, but the captured offset for recorded inputs', () => {
  const scenario = captureScenario(program, { ...held, base: { ...held.base, clock: { ...clock, utcOffsetMinutes: 60 } } },
    { id: 'demo_modified', name: 'Modified clock' });
  render(<ScenariosDrawer open onClose={() => {}} program={program} scenarios={[scenario]} snapshot={held} timeZone={timeZone}
    activeClock={clock} activeTimeZone={timeZone} selectedId={scenario.id} savedVersionDiffers={false}
    run={runSimulation(program, held, { scenario, liveClock: true })} results={[]} inputNodes={[graph.nodes[0]]}
    blockLabel={() => ({ name: 'Timestamp input' })} outputLabel={() => ({ name: 'Timestamp output' })}
    onSelect={() => {}} onCapture={() => {}} onCreate={() => {}} onRunAll={() => {}} onEdit={() => {}} onDelete={() => {}} blocked={false} />);
  const row = screen.getByRole('row', { name: /Modified clock/ });
  expect(within(row).getAllByRole('cell').slice(0, 2).map(cell => cell.textContent)).toEqual(['Today, 11:00 AM', 'Today, 2:00 AM']);
});
