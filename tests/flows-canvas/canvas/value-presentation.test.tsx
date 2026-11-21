// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lift, type LogicGraph } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas from '../../../src/workspace2/canvas/FlowCanvas';
import ResultSummary from '../../../src/workspace2/logic-fields/ResultSummary';
import { canvasPortObservations } from '../../../src/workspace2/logic-fields/observations';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';
import { canvasObservations } from '../../../src/workspace2/logic-simulation/observations';
import { runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { deriveTheme } from '../../../src/workspace2/theme';
import type { CanvasHostWithObservations } from '../../../src/workspace2/canvas/observations';
import { groceryGraph } from './grocery-fixture';
import { nativeContext } from '../graph/fixtures/native';

const clock = { now: '2026-11-21T12:34:56', utcOffsetMinutes: -480 };
const home = { clock, timeZone: 'America/Los_Angeles' };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function mount(graph: LogicGraph, observations: CanvasHostWithObservations['observations']) {
  const host: CanvasHostWithObservations = {
    snapshot: () => ({ document: {}, revision: 'r1' }), apply: vi.fn(), save: vi.fn(), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities,
    open: vi.fn(), openOutput: vi.fn(), uses: () => [], preview: vi.fn(), observations,
  };
  return render(<FlowCanvas graph={graph} host={host} onGraphChange={vi.fn()} theme={deriveTheme({}, true)} title="Demo values" onClose={vi.fn()}/>);
}

it('projects a typed clock into chips, tooltip, peek, full view and Result summary without losing the exact wall time', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  const graph = lift({ type: 'clock', part: 'now' }, { kind: 'operand' }).graph;
  const program = createSimulationProgram([graph]);
  const run = runSimulation(program, { at: '2026-11-21T20:34:56Z', base: { clock, reads: [], flowResponses: [], previousText: [] } });
  const observations = canvasObservations(program, run, home);
  mount(graph, canvasPortObservations(observations));
  render(<ResultSummary graph={graph} program={program} observations={observations} blockNames={{}}/>);
  const port = screen.getByRole('button', { name: /Now, Result output.*Today, 12:34 PM \(2026-11-21T12:34:56\)/ });
  expect(port.querySelector('.w2-canvas-port-value')?.textContent).toBe('Today, 12:34 PM');
  fireEvent.focus(port);
  expect(screen.getByRole('tooltip').textContent).toContain('Today, 12:34 PM (2026-11-21T12:34:56)');
  fireEvent.blur(port);
  const summary = screen.getByLabelText('Result value');
  expect(summary.textContent).toBe('Today, 12:34 PM');
  expect(summary.title).toContain('2026-11-21T12:34:56');
  fireEvent.click(screen.getByRole('button', { name: 'Show data peek for Now' }));
  const peek = screen.getByRole('dialog');
  expect(within(peek).getByText('Today, 12:34 PM').title).toContain('2026-11-21T12:34:56');
  fireEvent.click(within(peek).getByRole('button', { name: 'Compare in full' }));
  const comparison = screen.getByRole('dialog', { name: 'Compare Now' });
  expect(within(comparison).getByText('Today, 12:34 PM')).toBeTruthy();
  expect(comparison.querySelector('pre')).toBeNull();
  const raw = within(comparison).getByText('Raw JSON · Off').parentElement!;
  raw.setAttribute('open', '');
  fireEvent(raw, new Event('toggle'));
  expect([...comparison.querySelectorAll('pre')].at(-1)?.textContent).toBe('"2026-11-21T12:34:56"');
});

it('formats record fields and comparison cells, searches readable words, and keeps raw enums and date-containing IDs', () => {
  const graph = groceryGraph(), node = graph.nodes.find(node => node.catalogKey === 'output.rows')!;
  const id = '240--2026-11-21 04:00:04+00:00', due = '2026-11-21T17:30:00+00:00';
  const value = [{ id, title: 'Demo task', status: 'needs_action', due }];
  mount(graph, { [node.id]: { inputs: { '/row/title': { state: 'known', source: 'live', value: value[0], valueFormat: home } },
    outputs: { value: { state: 'known', source: 'live', value, valueFormat: home } } } });
  fireEvent.click(screen.getByRole('button', { name: 'Show data peek for Rows' }));
  const peek = screen.getByRole('dialog');
  expect(within(peek).getByText('Needs action').title).toBe('Needs action (needs_action)');
  expect(within(peek).getByText('Today, 9:30 AM').title).toContain(due);
  expect(within(peek).getByText(id)).toBeTruthy();
  fireEvent.click(within(peek).getByRole('button', { name: 'Compare in full' }));
  const comparison = screen.getByRole('dialog', { name: 'Compare Rows' });
  const cells = within(comparison).getAllByRole('cell');
  expect(cells.map(cell => cell.textContent)).toEqual([id, 'Demo task', 'Needs action', 'Today, 9:30 AM']);
  expect(cells[2].title).toBe('Needs action (needs_action)');
  expect(cells[3].title).toContain(due);
  fireEvent.change(within(comparison).getByRole('searchbox'), { target: { value: 'Needs action' } });
  expect(within(comparison).getByRole('status').textContent).toBe('1 of 1 matching rows');
  const raw = within(comparison).getByText('Raw JSON · Off').parentElement!;
  raw.setAttribute('open', '');
  fireEvent(raw, new Event('toggle'));
  expect([...comparison.querySelectorAll('pre')].at(-1)?.textContent).toContain('"needs_action"');
  expect([...comparison.querySelectorAll('pre')].at(-1)?.textContent).toContain(due);
});

it.each([
  ['operand', 'needs_action'], ['operand', '2026-11-21T17:30:00Z'], ['slot', 'needs_action'],
] as const)('leaves literal %s Text unchanged on chips, peeks and Result summary: %s', (kind, value) => {
  const graph = lift({ type: 'literal', value }, { kind, ...(kind === 'slot' ? { context: nativeContext() } : {}) }).graph, program = createSimulationProgram([graph]);
  const run = runSimulation(program, { at: '2026-11-21T20:34:56Z', base: { clock, reads: [], flowResponses: [], previousText: [] } });
  const observations = canvasObservations(program, run, home);
  mount(graph, canvasPortObservations(observations));
  render(<ResultSummary graph={graph} program={program} observations={observations} blockNames={{}}/>);
  expect(screen.getByLabelText('Result value').textContent).toBe(value);
  const name = kind === 'slot' ? 'Text Slot' : 'Text';
  expect(screen.getByRole('button', { name: new RegExp(`${name}, Result output`) }).querySelector('.w2-canvas-port-value')?.textContent).toBe(value);
  fireEvent.click(screen.getByRole('button', { name: `Show data peek for ${name}` }));
  expect(within(screen.getByRole('dialog')).getByText(value)).toBeTruthy();
});
