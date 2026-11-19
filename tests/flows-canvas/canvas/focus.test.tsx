// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lift, type CanvasHost } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas } from '../../../src/workspace2/canvas/FlowCanvas';
import { deriveTheme } from '../../../src/workspace2/theme';
import { anchor, number } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
  fireEvent.click(screen.getByRole('button', { name: 'Add Number, number' }));
  const header = screen.getByRole('button', { name: 'Select Number 4' });
  expect(document.activeElement).toBe(header);
  fireEvent.keyDown(header, { key: 'Enter' });
  const block = header.closest('li')!;
  const output = within(block).getByRole('button', { name: /^Number, Value output/ });
  expect(document.activeElement).toBe(output);
  fireEvent.click(output);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: /Add 1, Value 1 input/ }));
  fireEvent.click(dialog.getByRole('button', { name: 'Replace connection' }));
  const input = screen.getByRole('button', { name: /^Add, Value 1 input/ });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
  expect(document.activeElement).toBe(output);
  expect(header.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(output, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('button', { name: 'Select Add 1' }).getAttribute('aria-pressed')).toBe('true');
});
it('does not steal editing keys, preserves local edits on conflict, and keeps save separate', async () => {
  const host = mount(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: 'Select Number 2' });
  fireEvent.click(header);
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
  expect(screen.getByText('25', { exact: true })).toBeTruthy();
  expect(screen.getByText(/Conflict: canvas edits are preserved/)).toBeTruthy();
  expect(host.snapshot).toHaveBeenCalledOnce();
});
