// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lift, type CanvasHost } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas } from '../../../src/workspace2/canvas/FlowCanvas';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, number } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(conflict = false) {
  const snapshot = { document: { body: number(21) }, revision: 'r1' };
  const host: CanvasHost = {
    snapshot: vi.fn(() => snapshot),
    apply: vi.fn(async () => conflict ? { status: 'conflict' as const, remote: { ...snapshot, revision: 'r2' } } : { status: 'applied' as const, snapshot }),
    save: vi.fn(async () => ({ status: 'saved' as const, snapshot })), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities, open: vi.fn(), openOutput: vi.fn(),
    uses: () => [], preview: vi.fn(),
  };
  const graph = arrangeCanvas(lift({ type: 'math', op: 'add', args: [number(21), number(3)] }, { kind: 'operand', anchor }).graph);
  render(<FlowCanvas graph={graph} host={host} title="Test canvas" theme={deriveTheme({}, false)} onClose={vi.fn()}/>);
  return host;
}
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
  expect(screen.getByRole('button', { name: 'Select Add 1' }).getAttribute('aria-pressed')).toBe('true');
});
it('restores Plus after Select Add, Enter, ArrowDown, Delete and Undo', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: 'Select Add 1' });
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
