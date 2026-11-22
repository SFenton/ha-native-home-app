// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lift, type CanvasHost } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas } from '../../../src/workspace2/canvas/FlowCanvas';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, number } from './fixtures';
import { frameCanvas } from '../../../src/workspace2/canvas/framing';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(conflict = false, empty = false) {
  const snapshot = { document: { body: number(21) }, revision: 'r1' };
  const host: CanvasHost = {
    snapshot: vi.fn(() => snapshot),
    apply: vi.fn(async () => conflict ? { status: 'conflict' as const, remote: { ...snapshot, revision: 'r2' } } : { status: 'applied' as const, snapshot }),
    save: vi.fn(async () => ({ status: 'saved' as const, snapshot })), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities, open: vi.fn(), openOutput: vi.fn(),
    uses: () => [], preview: vi.fn(),
  };
  const graph = arrangeCanvas(lift({ type: 'math', op: 'add', args: [number(21), number(3)] }, { kind: 'operand', anchor }).graph);
  render(<FlowCanvas graph={empty ? { ...graph, nodes: [], edges: [], roots: [] } : graph} host={host} title="Test canvas" theme={deriveTheme({}, false)} onClose={vi.fn()}/>);
  return host;
}
it('marks the root in both the header and its accessible name', () => {
  mount();
  const header = screen.getByRole('button', { name: 'Select Add 1, result' });
  expect(within(header).getByText('Result')).toBeTruthy();
  expect(header.closest('li')?.getAttribute('data-result')).toBe('true');
  expect(screen.getByRole('button', { name: 'Select Number 2' }).closest('li')?.hasAttribute('data-result')).toBe(false);
});
it('fits the complete bounds when readable, or centers the result at 60% without going smaller', () => {
  const bounds = { x: 72, y: 72, width: 800, height: 500 };
  const full = frameCanvas(bounds, { width: 700, height: 600 });
  expect(full.zoom).toBeCloseTo(.815);
  expect(bounds.x * full.zoom - full.left).toBeGreaterThanOrEqual(24);
  expect((bounds.x + bounds.width) * full.zoom - full.left).toBeLessThanOrEqual(700 - 24);
  expect((bounds.y + bounds.height) * full.zoom - full.top).toBeLessThanOrEqual(600 - 80 - 24);
  const result = { x: 2200, y: 1600, width: 190, height: 180 };
  const large = frameCanvas({ ...bounds, width: 2400, height: 1800 }, { width: 640, height: 480 }, result);
  expect(large.zoom).toBe(.6);
  expect(result.x * large.zoom - large.left).toBeGreaterThanOrEqual(24);
  expect((result.x + result.width) * large.zoom - large.left).toBeLessThanOrEqual(640 - 24);
  expect(result.y * large.zoom - large.top).toBeGreaterThanOrEqual(24);
  expect((result.y + result.height) * large.zoom - large.top).toBeLessThanOrEqual(480 - 80 - 24);
  const tall = frameCanvas({ ...bounds, height: 2400 }, { width: 640, height: 480 }, { ...result, height: 1000 });
  expect(tall.zoom).toBe(.6);
  expect(result.y * tall.zoom - tall.top).toBe(24);
});
it('frames once on open and again after Tidy Up, preserving manual zoom and toolbar focus', () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const scroll = vi.fn();
  HTMLElement.prototype.scrollTo = scroll;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('w2-canvas-viewport') ? 350 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('w2-canvas-viewport') ? 300 : 0; });
  mount();
  act(() => callbacks.splice(0).forEach(callback => callback(0)));
  expect(screen.getByLabelText('Zoom').textContent).toBe('60%');
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByLabelText('Zoom').textContent).toBe('85%');
  const tidy = screen.getByRole('button', { name: 'Tidy Up' });
  fireEvent.click(tidy);
  act(() => callbacks.splice(0).forEach(callback => callback(0)));
  expect(screen.getByLabelText('Zoom').textContent).toBe('60%');
  expect(document.activeElement).toBe(tidy);
});
it('keeps an empty canvas at a valid zoom on open and after Tidy Up', () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const scroll = vi.fn();
  HTMLElement.prototype.scrollTo = scroll;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('w2-canvas-viewport') ? 350 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('w2-canvas-viewport') ? 300 : 0; });
  mount(false, true);
  act(() => callbacks.splice(0).forEach(callback => callback(0)));
  expect(screen.getByLabelText('Zoom').textContent).toBe('100%');
  fireEvent.click(screen.getByRole('button', { name: 'Tidy Up' }));
  act(() => callbacks.splice(0).forEach(callback => callback(0)));
  expect(screen.getByLabelText('Zoom').textContent).toBe('100%');
  expect(scroll).not.toHaveBeenCalled();
});
it('restores DOM focus and selection after add, connect/replace, undo and redo', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /^Values, \d+ blocks$/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Number, number' }));
  const header = screen.getByRole('button', { name: 'Select Number 4' });
  expect(document.activeElement).toBe(header);
  fireEvent.keyDown(header, { key: 'Enter' });
  const block = header.closest('li')!;
  const output = within(block).getByRole('button', { name: /^Number, Result output/ });
  expect(document.activeElement).toBe(output);
  fireEvent.click(output);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: /Add 1, Value input/ }));
  fireEvent.click(dialog.getByRole('button', { name: 'Replace connection' }));
  const input = screen.getByRole('button', { name: /^Add, Value input/ });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
  expect(document.activeElement).toBe(output);
  expect(header.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(output, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('button', { name: 'Select Add 1, result' }).getAttribute('aria-pressed')).toBe('true');
});
it('restores Plus after Select Add, Enter, ArrowDown, Delete and Undo', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: 'Select Add 1, result' });
  fireEvent.keyDown(header, { key: 'Enter' });
  const value = screen.getByRole('button', { name: /^Add, Value input/ });
  expect(document.activeElement).toBe(value);
  fireEvent.keyDown(value, { key: 'ArrowDown' });
  const plus = screen.getByRole('button', { name: /^Add, Plus input/ });
  expect(document.activeElement).toBe(plus);
  fireEvent.keyDown(plus, { key: 'Delete' });
  expect(plus.getAttribute('aria-label')).toContain('required, unconnected');
  fireEvent.keyDown(plus, { key: 'z', ctrlKey: true });
  expect(document.activeElement).toBe(plus);
  expect(plus.getAttribute('aria-label')).toContain('connected to Number');
});
it('restores the affected port, not the previously selected Number, after outline wire undo', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
  fireEvent.focus(screen.getByRole('button', { name: 'Select Number 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'Number Result, number, to Add Value; disconnect' }));
  const value = screen.getByRole('button', { name: /^Add, Value input/ });
  expect(value.getAttribute('aria-label')).toContain('required, unconnected');
  fireEvent.keyDown(value, { key: 'z', ctrlKey: true });
  expect(document.activeElement).toBe(value);
  expect(value.getAttribute('aria-label')).toContain('connected to Number');
});
it('does not remeasure wire or port geometry for a valid literal-only edit', async () => {
  const host = mount(), geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  fireEvent.click(screen.getByRole('button', { name: 'Select Number 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Number' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), { target: { value: '25' } });
  geometry.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Update value' }));
  expect(geometry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  await waitFor(() => expect(host.apply).toHaveBeenCalledWith(expect.objectContaining({
    replacements: [expect.objectContaining({ ast: { type: 'math', op: 'add', args: [number(25), number(3)] } })],
  })));
});
it('does not remeasure ports for unchanged initial ResizeObserver reports', () => {
  const notifications: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class {
    targets: Element[] = [];
    constructor(callback: (entries: readonly Pick<ResizeObserverEntry, 'target' | 'borderBoxSize'>[]) => void) {
      notifications.push(() => callback(this.targets.map(target => ({ target, borderBoxSize: [{ inlineSize: 190, blockSize: 160 }] }))));
    }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  });
  let portReads = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    if (this.matches('.w2-canvas-port')) portReads++;
    return new DOMRect(0, 0, 190, this.matches('.w2-canvas-node') ? 160 : 29);
  });
  mount();
  portReads = 0;
  act(() => notifications.forEach(notify => notify()));
  expect(portReads).toBe(0);
});
it('does not divide unscaled ResizeObserver sizes by the zoom and remeasure unchanged ports', () => {
  const notifications: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class {
    targets: Element[] = [];
    constructor(callback: (entries: readonly Pick<ResizeObserverEntry, 'target' | 'borderBoxSize'>[]) => void) {
      notifications.push(() => callback(this.targets.map(target => ({ target, borderBoxSize: [{ inlineSize: 190, blockSize: 160 }] }))));
    }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  });
  let portReads = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    if (this.matches('.w2-canvas-port')) portReads++;
    const scale = Number(this.closest('.w2-canvas-nodes')?.getAttribute('style')?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
    return new DOMRect(0, 0, 190 * scale, (this.matches('.w2-canvas-node') ? 160 : 29) * scale);
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  portReads = 0;
  act(() => notifications.forEach(notify => notify()));
  expect(portReads).toBe(0);
});
it('does not steal editing keys, preserves local edits on conflict, and keeps save separate', async () => {
  const host = mount(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: 'Select Number 2' });
  fireEvent.click(header);
  fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Number' }));
  const field = screen.getByRole('spinbutton', { name: 'Value' });
  fireEvent.change(field, { target: { value: '25' } });
  fireEvent.keyDown(field, { key: 'Delete' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Update value' }));
  expect(document.activeElement).toBe(header);
  expect(screen.getByRole('button', { name: 'Save draft' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Apply to draft' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  await waitFor(() => expect(host.compareConflict).toHaveBeenCalledOnce());
  expect(host.save).not.toHaveBeenCalled();
  expect(host.apply).toHaveBeenCalledWith(expect.objectContaining({ revision: 'r1', replacements: [expect.objectContaining({ ast: { type: 'math', op: 'add', args: [number(25), number(3)] } })] }));
  expect(screen.getByDisplayValue('25')).toBeTruthy();
  expect(screen.getByText(/Conflict: canvas edits are preserved/)).toBeTruthy();
  expect(host.snapshot).toHaveBeenCalledOnce();
});
