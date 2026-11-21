// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import type { CompositionDocument } from '../../../src/shared/composition/schema';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { LogicFieldsProvider, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { deriveTheme } from '../../../src/workspace2/theme';
import { Project } from '../../support/workspace2-surfaces';
import { effectiveAwayDocument, effectiveAwaySnapshot, integrationDocument, integrationSnapshot } from './fixture';
import { lift } from '../../../src/shared/composition/graph';
import ResultSummary from '../../../src/workspace2/logic-fields/ResultSummary';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';
import { canvasObservations } from '../../../src/workspace2/logic-simulation/observations';
import { captureScenario, runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { simulationFixture } from '../simulation/fixture';

const preferenceKey = 'sh-studio.canvas.preview-collapsed';
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(document = integrationDocument(), index = 0, kind: 'operand' | 'condition' = 'operand', snapshot = integrationSnapshot) {
  const draft = createDraft(document), live = new LiveHouse();
  live.applySnapshot(snapshot.states);
  const ws = Project.workspace(document);
  function Controls() {
    const fields = useLogicFields()!;
    return <button type="button" onClick={() => fields.open({
      draft, path: ['logicLibrary', index, 'body'], kind, label: 'Fixture value',
    })}>Open canvas</button>;
  }
  const rendered = render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
    <LogicFieldsProvider ws={ws} theme={deriveTheme({}, false)}><Controls/></LogicFieldsProvider>
  </WorkspaceDataProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open canvas' }));
  const closePalette = screen.queryByRole('button', { name: 'Close block palette' });
  if (closePalette) fireEvent.click(closePalette);
  const session = screen.getByRole('dialog', { name: 'Fixture value' });
  return { ...rendered, draft, live, session, work: session.querySelector('.w2-logic-work')! };
}
async function choose(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label });
  fireEvent.click(trigger);
  const item = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(item);
  fireEvent.click(item);
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
}
function collapse() { fireEvent.click(screen.getByRole('button', { name: 'Collapse Preview' })); }
function expand() { fireEvent.click(screen.getByRole('button', { name: 'Expand Preview' })); }

it('shows the result, provenance and named live inputs above the controls with Simulation still collapsed', async () => {
  const { live, draft, session } = setup(effectiveAwayDocument(), 2, 'condition', effectiveAwaySnapshot);
  const before = draft.get();
  const summary = screen.getByRole('region', { name: 'Result summary' });
  await waitFor(() => expect(within(summary).getByLabelText('Result value').textContent).toBe('No'));
  expect(within(summary).getByText('Live')).toBeTruthy();
  expect(summary.querySelector('dl')?.textContent).toBe('Effective modeHomeAway fallbackNo');
  const simulationDisclosure = screen.getByText('Simulation · Studio only', { exact: true }).closest('details')!;
  expect(simulationDisclosure.open).toBe(false);
  expect(summary.closest('details')).toBeNull();
  expect(summary.compareDocumentPosition(session.querySelector('.w2-logic-lens')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const setting = screen.getAllByRole('button', { name: /^Select Effective mode, Template Setting/ })[0];
  expect(setting.querySelector('strong')?.textContent).toBe('Effective mode');
  expect(setting.querySelector('small')?.textContent).toBe('Template Setting');
  const raw = session.querySelectorAll('.w2-canvas-node-detail');
  expect([...raw].some(detail => detail.textContent === 'Effective mode')).toBe(true);
  expect([...raw].some(detail => detail.textContent === 'Choose an entity')).toBe(false);
  for (const text of ['unknown', 'unavailable']) {
    expect(screen.getByRole('button', { name: new RegExp(`^Text, Result output.*known, live, value ${text}$`) }).textContent).toContain(text);
  }
  act(() => live.applyStream([{ entityId: 'input_select.demo_mode', name: 'Demo mode', state: 'Away' }]));
  await waitFor(() => expect(within(summary).getByLabelText('Result value').textContent).toBe('Yes'));
  expect(simulationDisclosure.open).toBe(false);
  expect(draft.get()).toBe(before);
});
it('shows completed flow outputs and declared parameter inputs, including zero, unused parameters and scenario provenance', () => {
  const graph = lift({
    title: 'Demo flow', parameters: [
      { name: 'Offset', type: 'number', value: { type: 'literal', value: 0 } },
      { name: 'Unused', type: 'number', value: { type: 'literal', value: 4 } },
    ],
    request: { type: 'none', value: { type: 'param', name: 'Offset' } }, steps: [], output: { kind: 'scalar' }, schema: { kind: 'number' },
  }, { kind: 'flow-inputs', sourceId: 'demo_flow', anchor: { kind: 'flow', id: 'demo_flow', field: '/inputs' } }).graph;
  const program = createSimulationProgram([graph]), held = simulationFixture().held;
  const observation = canvasObservations(program, runSimulation(program, held));
  const { rerender } = render(<ResultSummary graph={graph} program={program} observations={observation} blockNames={{}}/>);
  const summary = screen.getByRole('region', { name: 'Result summary' });
  expect(within(summary).getByLabelText('Result value').textContent).toBe('0');
  expect(summary.querySelector('dl')?.textContent).toBe('Offset0Unused4');
  expect(within(summary).getByText('Live')).toBeTruthy();
  const scenario = captureScenario(program, held, { id: 'demo_scenario', name: 'Demo scenario' });
  const captured = canvasObservations(program, runSimulation(program, held, { scenario }), { scenario });
  rerender(<ResultSummary graph={graph} program={program} observations={captured} blockNames={{}}/>);
  expect(within(summary).getByText('Scenario')).toBeTruthy();
  expect(within(summary).getByLabelText('Result value').textContent).toBe('0');
});
it('keeps real unknown/unavailable readings distinct from literal text without changing their condition answer', async () => {
  const { live } = setup(effectiveAwayDocument(), 2, 'condition', effectiveAwaySnapshot);
  const summary = screen.getByRole('region', { name: 'Result summary' });
  act(() => live.applyStream([
    { entityId: 'input_select.demo_mode', name: 'Demo mode', state: 'unknown' },
    { entityId: 'input_boolean.demo_away_fallback', name: 'Demo away fallback', state: 'unavailable' },
  ]));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Raw State, Result output.*can't tell, live$/ }).length).toBe(2));
  expect(within(summary).getByLabelText('Result value').textContent).toBe('No');
  expect(screen.getByRole('button', { name: /^Text, Result output.*known, live, value unknown$/ }).textContent).toContain('unknown');
  expect(screen.getByRole('button', { name: /^Text, Result output.*known, live, value unavailable$/ }).textContent).toContain('unavailable');
});
it('shows an unanswered root value and badge explicitly without an invented default', () => {
  const graph = lift({ type: 'state', sourceId: 'demo_missing', path: ['state'], in: ['on'] }, { kind: 'condition' }).graph;
  const program = createSimulationProgram([graph], { sourceEntities: { demo_missing: 'input_boolean.demo_missing' } });
  const held = simulationFixture().held;
  const missing = { ...held, base: { ...held.base, reads: [] } };
  const observation = canvasObservations(program, runSimulation(program, missing));
  render(<ResultSummary graph={graph} program={program} observations={observation} blockNames={{}}/>);
  const summary = screen.getByRole('region', { name: 'Result summary' });
  expect(within(summary).getByLabelText('Result value').textContent).toBe("Can't tell");
  expect(within(summary).getByText("Can't tell", { selector: '.w2-tag' })).toBeTruthy();
});
it('keeps the compact result visible when Simulation closes and reflects pinned values without changing the draft', async () => {
  const { draft } = setup();
  const before = draft.get();
  const summary = screen.getByRole('region', { name: 'Result summary' });
  fireEvent.click(screen.getByText('Simulation · Studio only', { exact: true }));
  fireEvent.click(screen.getByRole('radio', { name: /^Pin a state/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /^State for/ }), { target: { value: 'pinned fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply pin' }));
  await waitFor(() => expect(within(summary).getByLabelText('Result value').textContent).toBe('pinned fixture'));
  expect(within(summary).getByText('Pinned')).toBeTruthy();
  fireEvent.click(screen.getByText('Simulation · Studio only', { exact: true }));
  expect(summary.closest('details')).toBeNull();
  expect(summary.closest('[hidden]')).toBeNull();
  expect(within(summary).getByText('Pinned')).toBeTruthy();
  expect(draft.get()).toBe(before);
});
it('toggles with no selection or a selection, hides controls accessibly, and transfers focus', () => {
  const { work, draft } = setup(), before = draft.get();
  const panel = screen.getByRole('complementary', { name: 'Canvas preview' });
  const collapseButton = screen.getByRole('button', { name: 'Collapse Preview' });
  expect(collapseButton.getAttribute('aria-expanded')).toBe('true');
  expect(collapseButton.getAttribute('aria-controls')).toBe(panel.id);
  expect(work.getAttribute('data-preview-collapsed')).toBe('false');
  act(() => collapseButton.focus());
  collapse();
  const expandButton = screen.getByRole('button', { name: 'Expand Preview' });
  expect(document.activeElement).toBe(expandButton);
  expect(expandButton.textContent).toBe('Preview');
  expect(expandButton.getAttribute('aria-expanded')).toBe('false');
  expect(expandButton.getAttribute('aria-controls')).toBe(panel.id);
  expect(work.getAttribute('data-preview-collapsed')).toBe('true');
  expect(panel.hidden).toBe(true);
  expect(panel.hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('complementary', { name: 'Canvas preview' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Preview lens' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Collapse Preview' })).toBeNull();
  expand();
  expect(document.activeElement).toBe(collapseButton);
  expect(panel.hidden).toBe(false);
  expect(panel.hasAttribute('inert')).toBe(false);
  expect(work.getAttribute('data-preview-collapsed')).toBe('false');
  const block = screen.getByRole('button', { name: /^Select Attribute/ });
  fireEvent.click(block);
  expect(block.getAttribute('aria-pressed')).toBe('true');
  collapse();
  expect(block.getAttribute('aria-pressed')).toBe('true');
  expand();
  expect(block.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('combobox', { name: 'Preview lens' })).toBeTruthy();
  expect(draft.get()).toBe(before);
});

it('preserves the lens, Try with values and mounted observation producer while hidden', async () => {
  const { live, draft } = setup(), before = draft.get();
  await choose('Preview lens', 'Stand-in');
  fireEvent.click(screen.getByText(/^Try with/));
  await choose('Try with Entity', 'Living Room');
  fireEvent.click(screen.getByText('Simulation · Studio only', { exact: true }));
  const simulation = screen.getByRole('region', { name: 'Flow simulation' });
  const preview = screen.getByRole('article', { name: 'Stand-in field preview' });
  await waitFor(() => expect(preview.querySelector('output')?.textContent).toContain('23.6'));
  collapse();
  act(() => live.applyStream([{ ...integrationSnapshot.states[1], state: '24.2' }]));
  await waitFor(() => expect(preview.querySelector('output')?.textContent).toContain('24.2'));
  expect(screen.queryByRole('region', { name: 'Flow simulation' })).toBeNull();
  expand();
  expect(screen.getByRole('region', { name: 'Flow simulation' })).toBe(simulation);
  expect(screen.getByRole('combobox', { name: 'Preview lens' }).textContent).toBe('Stand-in');
  expect(screen.getByRole('combobox', { name: 'Try with Entity' }).textContent).toBe('Living Room');
  expect(screen.getByRole('article', { name: 'Stand-in field preview' })).toBe(preview);
  expect(preview.querySelector('output')?.textContent).toContain('24.2');
  expect(draft.get()).toBe(before);
});

it('retains simulation mode and pins across collapse and expansion', () => {
  setup();
  fireEvent.click(screen.getByText('Simulation · Studio only', { exact: true }));
  fireEvent.click(screen.getByRole('radio', { name: /^Pin a state/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /^State for/ }), { target: { value: 'pinned fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply pin' }));
  expect(screen.getByText('1 pinned')).toBeTruthy();
  collapse();
  expand();
  expect(screen.getByText('1 pinned')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Simulated' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('textbox', { name: /^State for/ }) as HTMLInputElement).value).toBe('pinned fixture');
});

it('keeps invalid-layout warnings and their reset action visible while collapsed', () => {
  const document: CompositionDocument = { ...integrationDocument(), studioCanvas: { version: 400 } };
  const { draft } = setup(document);
  collapse();
  expect(screen.getByRole('alert').textContent).toBe("Saved layout can't be used.");
  expect(draft.get().studioCanvas).toEqual({ version: 400 });
  fireEvent.click(screen.getByRole('button', { name: 'Reset saved layout' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(draft.get().studioCanvas).toBeUndefined();
  expect(draft.get().logicLibrary).toEqual(document.logicLibrary);
  expect(screen.getByRole('button', { name: 'Expand Preview' })).toBeTruthy();
});

it('keeps conflict guidance and local canvas edits visible with Preview collapsed', async () => {
  const { draft } = setup(integrationDocument(), 1);
  fireEvent.click(screen.getAllByRole('button', { name: /^Select Number/ })[0]);
  // A header click opens the data peek; the inspector opens from the block's Inspect action.
  fireEvent.click(screen.getAllByRole('button', { name: /^Inspect Number/ })[0]);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update value' }));
  act(() => draft.set({ ...draft.get(), name: 'Concurrent local draft' }));
  collapse();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  const warning = await screen.findByText(/The saved revision changed\. Local canvas edits are retained/);
  expect(warning.getAttribute('role')).toBe('alert');
  expect(warning.closest('[hidden]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Expand Preview' })).toBeTruthy();
  expect((screen.getByRole('spinbutton', { name: 'Value' }) as HTMLInputElement).value).toBe('9');
  expect(draft.get().name).toBe('Concurrent local draft');
});

it('persists the preference across session and provider remounts', () => {
  const first = setup();
  collapse();
  expect(localStorage.getItem(preferenceKey)).toBe('true');
  first.unmount();
  const second = setup();
  expect(screen.queryByRole('button', { name: 'Collapse Preview' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Expand Preview' })).toBeTruthy();
  expand();
  expect(localStorage.getItem(preferenceKey)).toBe('false');
  second.unmount();
  setup();
  expect(screen.getByRole('button', { name: 'Collapse Preview' })).toBeTruthy();
});

it.each(['read/write', 'write', 'access'])('keeps toggling in memory when localStorage %s throws', kind => {
  const first = setup();
  if (kind === 'access') {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
  } else {
    if (kind !== 'write') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  }
  collapse();
  expect(screen.getByText(/Browser storage is unavailable/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Expand Preview' })).toBeTruthy();
  first.unmount();
  setup();
  expect(screen.getByRole('button', { name: 'Expand Preview' })).toBeTruthy();
  expand();
  expect(screen.getByRole('button', { name: 'Collapse Preview' })).toBeTruthy();
  expect(within(screen.getByRole('dialog', { name: 'Fixture value' })).getByText(/Browser storage is unavailable/)).toBeTruthy();
});
