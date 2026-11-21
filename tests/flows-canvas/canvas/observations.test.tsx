// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import * as core from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas } from '../../../src/workspace2/canvas/FlowCanvas';
import PortReading, { type CanvasHostWithObservations, type PortObservation } from '../../../src/workspace2/canvas/observations';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, number } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const ast = { type: 'math' as const, op: 'add' as const, args: [number(21), number(3)] };
  const graph = arrangeCanvas(core.lift(ast, { kind: 'operand', anchor }).graph);
  const host: CanvasHostWithObservations = {
    snapshot: () => ({ document: ast, revision: '1' }), apply: vi.fn(), save: vi.fn(), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities, open: vi.fn(), openOutput: vi.fn(), uses: () => [], preview: vi.fn(),
  };
  const props = { graph, title: 'Observation test', theme: deriveTheme({}, false), onClose: vi.fn() };
  return { graph, host, props };
}
it('shows no port values without observation input, even for configured and connected literals', () => {
  const { host, props } = fixture();
  const { container } = render(<FlowCanvas {...props} host={host}/>);
  expect(container.querySelectorAll('.w2-canvas-port-value')).toHaveLength(0);
  expect(screen.getByRole('button', { name: /^Add, Value input/ }).getAttribute('aria-label')).not.toContain('value 21');
});
it('maps only supplied block/port observations, distinguishes scenario pins and never fills missing input observations', () => {
  const { host, props, graph } = fixture();
  const observations = {
    [graph.nodes[0].id]: { inputs: { '/args/0': { state: 'known', source: 'live', value: 0 } } },
    [graph.nodes[1].id]: { outputs: { value: { state: 'known', source: 'pinned', value: 25 } } },
    [graph.nodes[2].id]: { scenarioPinned: true, outputs: { value: { state: 'unavailable', source: 'scenario' } } },
  } as const;
  render(<FlowCanvas {...props} host={{ ...host, observations }}/>);
  expect(within(screen.getByRole('button', { name: /^Add, Value input/ })).getByText('0')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Add, Plus input/ }).querySelector('.w2-canvas-port-value')).toBeNull();
  const pinned = screen.getByRole('button', { name: /^Number, Result output.*known, pinned, value 25$/ });
  expect(pinned.querySelector('.w2-canvas-port-value')?.getAttribute('data-source')).toBe('pinned');
  const offline = screen.getByRole('button', { name: /^Number, Result output.*unavailable, scenario$/ });
  expect(within(offline).getByText('Unavailable')).toBeTruthy();
  expect(offline.closest('li')?.getAttribute('data-scenario-pinned')).toBe('true');
  expect(screen.getByRole('button', { name: 'Select Number 3' }).getAttribute('aria-description')).toBe('Pinned by scenario.');
});
it("updates can't-tell wires without recompiling, changing the draft, or evaluating missing downstream values", () => {
  const { host, props, graph } = fixture(), compile = vi.spyOn(core, 'lower');
  const { container, rerender } = render(<FlowCanvas {...props} host={host}/>);
  const header = screen.getByRole('button', { name: 'Select Add 1' });
  act(() => header.focus());
  const observations = { [graph.nodes[1].id]: { outputs: { value: { state: 'cant-tell', source: 'live' } } } } as const;
  rerender(<FlowCanvas {...props} host={{ ...host, observations }}/>);
  expect(compile).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(header);
  expect(container.querySelectorAll('.w2-canvas-wire[data-observation-state=cant-tell]')).toHaveLength(1);
  expect(screen.getByRole('button', { name: /^Add, Value input/ }).querySelector('.w2-canvas-port-value')).toBeNull();
  expect(screen.getByRole('button', { name: /^Number, Result output.*can't tell, live$/ }).textContent).toContain("Can't tell");
  expect(host.apply).not.toHaveBeenCalled(); expect(host.save).not.toHaveBeenCalled();
  rerender(<FlowCanvas {...props} host={host}/>);
  expect(container.querySelectorAll('.w2-canvas-wire[data-observation-state=cant-tell]')).toHaveLength(0);
  expect(container.querySelectorAll('.w2-canvas-port-value')).toHaveLength(0);
});
it.each([[false, 'No'], [null, 'Null'], ['', 'Empty text']] as const)('renders known %j without treating it as absent or unknown', (value, text) => {
  render(<PortReading observation={{ state: 'known', source: 'live', value }} output/>);
  expect(screen.getByText(text)).toBeTruthy();
});
it('marks only outputs kept, and displays a retained value only when explicitly supplied', () => {
  const observation: PortObservation = { state: 'cant-tell', source: 'live', kept: true, value: 'Previous answer' };
  const { rerender } = render(<PortReading observation={observation} output/>);
  expect(screen.getByText("Can't tell; Kept: Previous answer")).toBeTruthy(); expect(screen.getByText('kept')).toBeTruthy();
  rerender(<PortReading observation={observation} output={false}/>);
  expect(screen.queryByText('kept')).toBeNull();
  rerender(<PortReading observation={{ state: 'cant-tell', source: 'live' }} output/>);
  expect(screen.queryByText('Previous answer')).toBeNull();
  expect(screen.getByText("Can't tell")).toBeTruthy();
});
