// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LogicGraph } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas from '../../../src/workspace2/canvas/FlowCanvas';
import { edit, initialEditState } from '../../../src/workspace2/canvas/edit';
import { formatObservation, formatValue } from '../../../src/workspace2/canvas/value-format';
import { countCrossings, type TidyMeasure } from '../../../src/workspace2/canvas/tidy';
import type { CanvasHostWithObservations } from '../../../src/workspace2/canvas/observations';
import { deriveTheme } from '../../../src/workspace2/theme';
import { groceryGraph, groceryObservations } from './grocery-fixture';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function mount(observed = true) {
  const graph = groceryGraph(), onGraphChange = vi.fn();
  const host: CanvasHostWithObservations = {
    snapshot: () => ({ document: {}, revision: 'r1' }), apply: vi.fn(), save: vi.fn(), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities,
    open: vi.fn(), openOutput: vi.fn(), uses: () => [], preview: vi.fn(),
    observations: observed ? groceryObservations(graph) : undefined,
  };
  const props = { graph, host, onGraphChange, theme: deriveTheme({}, true), title: 'Grocery flow', onClose: vi.fn() };
  const view = render(<FlowCanvas {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  return { ...view, graph, host, onGraphChange, props };
}
it('B1 annotates both fields in one undoable edit, trims, and removes empty annotations', () => {
  const initial = initialEditState(groceryGraph()), nodeId = initial.graph.nodes[0].id;
  const first = edit(initial, { type: 'annotate', nodeId, label: ' Groceries ', note: ' Read-only display ' });
  expect(first.graph.nodes[0].annotation).toEqual({ label: 'Groceries', note: 'Read-only display' });
  expect(first.past).toHaveLength(1);
  expect(edit(first, { type: 'undo' }).graph).toBe(initial.graph);
  expect(edit(edit(first, { type: 'undo' }), { type: 'redo' }).graph).toBe(first.graph);
  expect(edit(first, { type: 'annotate', nodeId, label: ' ', note: ' ' }).graph.nodes[0].annotation).toBeUndefined();
  expect(first.graph.nodes[0].payload).toBe(initial.graph.nodes[0].payload);
  expect(edit(initial, { type: 'annotate', nodeId, label: 'x'.repeat(60), note: 'x'.repeat(280) }).past).toHaveLength(1);
});
it('B2 refuses pasted line breaks in either annotation field with the required message', () => {
  const { onGraphChange } = mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  for (const name of ['Label', 'Description']) {
    const field = screen.getByRole('textbox', { name });
    fireEvent.paste(field, { clipboardData: { getData: () => 'first\nsecond' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply details' }));
    expect(screen.getByRole('alert').textContent).toBe('Use a single paragraph; line breaks are not supported.');
    expect((field as HTMLInputElement).value).toBe('');
    fireEvent.change(field, { target: { value: 'Corrected paragraph' } });
    fireEvent.change(field, { target: { value: '' } });
  }
  expect(onGraphChange).toHaveBeenCalledOnce();
});
it.each([
  ['Label', 'x'.repeat(61), 'at most 60'],
  ['Description', 'x'.repeat(281), 'at most 280'],
  ['Description', 'first\nsecond', 'Use a single paragraph; line breaks are not supported.'],
  ['Description', 'first\u0001second', 'Control characters'],
  ['Description', 'first\u200bsecond', 'Control characters'],
])('B2 refuses invalid %s without losing editable text', (field, value, error) => {
  const { onGraphChange } = mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  const input = screen.getByRole('textbox', { name: field });
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply details' }));
  expect(screen.getByRole('alert').textContent).toContain(error);
  expect((input as HTMLInputElement).value).toBe(value);
  expect(onGraphChange).toHaveBeenCalledOnce();
});
it('keeps unsent annotation drafts on selection changes until Apply, Discard, or Stay', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Groceries' } });
  fireEvent.click(screen.getByRole('button', { name: /^Select Service Response / }));
  const confirm = screen.getByRole('dialog', { name: 'Unsubmitted block details' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Stay' }));
  expect(screen.getByDisplayValue('Groceries')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Select Service Response / }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Unsubmitted block details' })).getByRole('button', { name: 'Apply' }));
  expect(screen.getByRole('button', { name: /^Select Groceries, Rows / })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Select Service Response / }).getAttribute('aria-pressed')).toBe('true');
});
it('Inspector uses the same annotation transaction and Undo restores both fields', () => {
  const { onGraphChange } = mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Rows' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Groceries' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Show the observed grocery rows.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply details' }));
  expect(onGraphChange.mock.calls.at(-1)![1].reason).toBe('annotate');
  const header = screen.getByRole('button', { name: /^Select Groceries, Rows / });
  fireEvent.keyDown(header, { key: 'z', ctrlKey: true });
  expect(screen.getByRole('button', { name: /^Select Rows / })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toBe('');
});
it('B3 formats nested values and every unknown/kept distinction without JSON syntax', () => {
  expect(formatValue({ items: [{ summary: 'Milk' }, { title: 'Eggs' }, { name: 'Bread' }, { title: 'Rice' }] })).toBe('items: 4 items; Milk; Eggs; Bread; +1 more items');
  expect(formatValue({ nested: { deeper: { answer: 42 } }, a: false, b: null, c: '', d: 1 })).toBe('nested: deeper: 1 field; a: No; b: Null; c: Empty text; +1 more fields');
  expect(formatObservation()).toBe('Not observed');
  expect(formatObservation({ state: 'known', source: 'live', value: 'unavailable' })).toBe('unavailable');
  expect(formatObservation({ state: 'unavailable', source: 'live' })).toBe('Unavailable');
  expect(formatObservation({ state: 'cant-tell', source: 'scenario', kept: true, value: 0 })).toBe("Can't tell; Kept: 0");
  const { container } = mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Choose Entry / }));
  expect(screen.getByRole('dialog').textContent).toContain('Milk');
  expect(container.textContent).not.toContain('{"');
  for (const element of container.querySelectorAll('[aria-label]')) expect(element.getAttribute('aria-label')).not.toContain('{"');
  const directory = path.resolve('src/workspace2/canvas');
  const uses = readdirSync(directory).filter(file => /\.tsx?$/.test(file)).flatMap(file => readFileSync(path.join(directory, file), 'utf8').split('\n').filter(line => line.includes('JSON.stringify')).map(line => ({ file, line })));
  expect(uses.map(({ file }) => file).sort()).toEqual(['DataPeek.tsx', 'DataPeek.tsx', 'FlowCanvas.tsx', 'Inspector.tsx', 'presentation.ts'].sort());
  expect(uses.filter(({ file }) => ['FlowCanvas.tsx', 'presentation.ts'].includes(file)).every(({ line }) => !line.includes('aria-'))).toBe(true);
});
it('B4 opens one peek, preserves selection on dismissal, and captures formatted searchable full rows', async () => {
  const { rerender, props } = mount();
  const header = screen.getByRole('button', { name: /^Select Rows / });
  fireEvent.click(header);
  expect(screen.queryByRole('complementary', { name: 'Block inspector' })).toBeNull();
  let peek = screen.getByRole('dialog');
  expect(within(peek).getByText('+4 more rows')).toBeTruthy();
  expect(within(peek).getAllByText('Milk').length).toBeGreaterThan(0);
  expect(within(peek).queryByText('Apples')).toBeNull();
  fireEvent.click(within(peek).getByRole('button', { name: 'Close data peek' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(header.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Show data peek for Rows' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(header);
  fireEvent.click(screen.getByRole('button', { name: /^Select Choose Entry / }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(header);
  fireEvent.click(screen.getByRole('button', { name: 'Compare in full' }));
  const full = screen.getByRole('dialog', { name: 'Compare Rows' });
  expect(within(full).getByRole('columnheader', { name: 'Row Title' })).toBeTruthy();
  expect(within(full).getByRole('status').textContent).toBe('7 of 7 matching rows');
  expect(full.querySelector('pre')).toBeNull();
  fireEvent.change(within(full).getByRole('searchbox'), { target: { value: 'Milk' } });
  expect(within(full).getByRole('status').textContent).toBe('1 of 7 matching rows');
  fireEvent.change(within(full).getByRole('searchbox'), { target: { value: 'no match' } });
  expect(within(full).getByText('No matching rows')).toBeTruthy();
  const raw = within(full).getByText('Raw JSON · Off');
  fireEvent.click(raw);
  // jsdom does not implement native details activation consistently.
  raw.parentElement!.setAttribute('open', '');
  fireEvent(raw.parentElement!, new Event('toggle'));
  expect(await within(full).findByText('Raw JSON · On')).toBeTruthy();
  expect(full.querySelector('pre')?.textContent).toContain('{');
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: undefined }}/>);
  expect(screen.queryByRole('dialog', { name: 'Compare Rows' })).toBeNull();
  peek = screen.getByRole('dialog');
  expect(within(peek).getAllByText('Not observed').length).toBeGreaterThan(0);
});
it('shows Result once for a single Result output and preserves the no-items explanation in the full comparison', () => {
  const { props, rerender } = mount();
  const node = props.graph.nodes.find(node => node.origins[0] === '/output/row/title')!;
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: {
    [node.id]: { outputs: { value: { state: 'no-items', item: { step: 'Keep overdue tasks', count: 0 } } } },
  } }}/>);
  const port = screen.getByRole('button', { name: /^This Item, Result output.*Didn't run/ });
  expect(port.textContent).toContain('No items');
  fireEvent.click(port.closest('li')!.querySelector('.w2-canvas-eye')!);
  const peek = screen.getByRole('dialog');
  expect(within(peek).getAllByText('Result', { exact: true })).toHaveLength(1);
  expect(within(peek).getByText("Didn't run: no items reached Keep overdue tasks")).toBeTruthy();
  fireEvent.click(within(peek).getByRole('button', { name: 'Compare in full' }));
  expect(within(screen.getByRole('dialog', { name: 'Compare This Item' })).getByText("Didn't run: no items reached Keep overdue tasks")).toBeTruthy();
});
it('identifies the first item in chips, data peek and captured comparison', () => {
  const { props, rerender } = mount();
  const node = props.graph.nodes.find(node => node.origins[0] === '/output/row/title')!;
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: {
    [node.id]: { outputs: { value: { state: 'known', value: 'Milk', source: 'live', item: { step: 'Rows', count: 4, index: 0 } } } },
  } }}/>);
  const port = screen.getByRole('button', { name: /^This Item, Result output.*Item 1 of 4$/ });
  expect(within(port).getByText('Item 1 of 4')).toBeTruthy();
  fireEvent.click(port.closest('li')!.querySelector('.w2-canvas-eye')!);
  const peek = screen.getByRole('dialog');
  expect(within(peek).getByText('Item 1 of 4')).toBeTruthy();
  fireEvent.click(within(peek).getByRole('button', { name: 'Compare in full' }));
  expect(within(screen.getByRole('dialog', { name: 'Compare This Item' })).getByText('Item 1 of 4')).toBeTruthy();
});
it('M4 port tooltips delay hover, open on focus, format observations, and dismiss with Escape', async () => {
  vi.useFakeTimers();
  mount();
  const port = screen.getByRole('button', { name: /^Choose Entry, Result output/ });
  expect(port.hasAttribute('title')).toBe(false);
  fireEvent.mouseEnter(port);
  act(() => vi.advanceTimersByTime(299));
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole('tooltip').textContent).toContain('Milk');
  expect(port.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseLeave(port);
  fireEvent.focus(port);
  act(() => vi.advanceTimersByTime(0));
  expect(screen.getByRole('tooltip')).toBeTruthy();
});
it('M4 dismisses a port tooltip on blur or activation so it cannot consume a connection dialog Escape', async () => {
  mount();
  const header = screen.getByRole('button', { name: /^Select Rows / });
  fireEvent.keyDown(header, { key: 'Enter' });
  const port = screen.getByRole('button', { name: /^Rows, Row Id input/ });
  fireEvent.focus(port);
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.blur(port);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focus(port);
  fireEvent.click(port);
  expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(port);
});
it('observation updates do not steal peek control focus, and outside dismissal retains selection', () => {
  const { props, rerender } = mount();
  const header = screen.getByRole('button', { name: /^Select Rows / });
  fireEvent.click(header);
  const compare = screen.getByRole('button', { name: 'Compare in full' });
  act(() => compare.focus());
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: groceryObservations(props.graph) }}/>);
  expect(document.activeElement).toBe(compare);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Inspector' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(header.getAttribute('aria-pressed')).toBe('true');
});
it('B5 gives all four selected actions equal non-intrinsic grid columns at 190px', () => {
  const css = readFileSync(path.resolve('src/workspace2/canvas/canvas.css'), 'utf8');
  expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  const row = screen.getByRole('button', { name: 'Move Rows' }).parentElement!;
  expect(row.querySelectorAll('button')).toHaveLength(4);
});
it('B6 owner screenshot graph reaches zero crossings through real FlowCanvas Tidy Up and keeps button focus', () => {
  const { graph, onGraphChange, container } = mount();
  const button = screen.getByRole('button', { name: 'Tidy Up' }), before = countCrossings(graph);
  fireEvent.click(button);
  const next = onGraphChange.mock.calls.at(-1)![0] as LogicGraph;
  expect(next).not.toBe(graph);
  expect(countCrossings(next)).toBe(0);
  expect(container.querySelector('.w2-canvas-footer [role=status]')?.textContent).toBe(`Tidied: wire crossings ${before} → 0`);
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(container.querySelector('.w2-canvas-footer [role=status]')?.textContent).toBe('Already tidy');
  expect(onGraphChange).toHaveBeenCalledTimes(2);
  console.info('B6 FlowCanvas uses the estimate path: jsdom card/port DOM rectangles are zero.');
});
it('passes zoom-normalized real card and port measurements to Tidy Up', () => {
  const { graph, onGraphChange } = mount(false);
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  const measured = new Map<string, TidyMeasure>();
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const nodeId = this.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const node = graph.nodes.find(node => node.id === nodeId);
    if (!node) return original.call(this);
    const ports = [...node.inputs.map(port => ({ ...port, direction: 'input' as const })), ...node.outputs.map(port => ({ ...port, direction: 'output' as const }))];
    measured.set(node.id, { width: 190, height: 100 + ports.length * 38, ports: Object.fromEntries(ports.map((port, i) => [port.id, { direction: port.direction, y: 70 + i * 38 }])) });
    const portIndex = ports.findIndex(port => port.id === this.dataset.portId);
    return new DOMRect(node.position!.x * 2, (node.position!.y + (portIndex >= 0 ? 51 + portIndex * 38 : 0)) * 2, 380, (portIndex >= 0 ? 38 : 100 + ports.length * 38) * 2);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tidy Up' }));
  const next = onGraphChange.mock.calls.at(-1)![0] as LogicGraph, measure = (id: string) => measured.get(id);
  expect(measured.size).toBe(graph.nodes.length);
  expect(countCrossings(next, measure)).toBeLessThanOrEqual(countCrossings(graph, measure));
});

it('review: Compare closes when a captured reading is withdrawn from a still-present block', () => {
  const { rerender, props } = mount();
  const rows = props.graph.nodes.find(node => node.catalogKey === 'output.rows')!;
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare in full' }));
  expect(screen.getByRole('dialog', { name: 'Compare Rows' })).toBeTruthy();
  const withdrawn = { ...groceryObservations(props.graph), [rows.id]: { inputs: {}, outputs: {} } };
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: withdrawn }}/>);
  expect(screen.queryByRole('dialog', { name: 'Compare Rows' })).toBeNull();
});
it('review: Compare keeps every observed item of a mixed list instead of blanking non-record items', () => {
  const { rerender, props } = mount();
  const rows = props.graph.nodes.find(node => node.catalogKey === 'output.rows')!;
  const mixed = { ...groceryObservations(props.graph), [rows.id]: { outputs: { value: { state: 'known' as const, source: 'live' as const, value: [{ title: 'Milk' }, false, 0, 'Eggs', null] } } } };
  rerender(<FlowCanvas {...props} host={{ ...props.host, observations: mixed }}/>);
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare in full' }));
  const full = screen.getByRole('dialog', { name: 'Compare Rows' });
  const cells = within(full).getAllByRole('cell').map(cell => cell.textContent);
  expect(cells).toEqual(['Milk', formatValue(false, { full: true }), formatValue(0, { full: true }), 'Eggs', formatValue(null, { full: true })]);
});
it('review: re-activating Rename keeps the unsubmitted annotation draft', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Shopping list' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('Shopping list');
});
it('review: opening Rename does not pull focus out of Description once the owner is typing there', () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  mount();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  frames.splice(0).forEach(frame => frame(0));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  const description = screen.getByRole('textbox', { name: 'Description' });
  description.focus();
  act(() => { frames.splice(0).forEach(frame => frame(0)); });
  expect(document.activeElement).toBe(description);
  // Untouched, the deferred focus still starts at Label.
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  act(() => { frames.splice(0).forEach(frame => frame(0)); });
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Rows' }));
  act(() => { frames.splice(0).forEach(frame => frame(0)); });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Label' }));
});
