// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lower, type CanvasHost, type LogicGraph } from '../../../src/shared/composition/graph';
import { compileCompositionDocument, supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas, { arrangeCanvas, type FlowCanvasProps } from '../../../src/workspace2/canvas/FlowCanvas';
import { deriveTheme } from '../../../src/workspace2/theme';
import { fieldAdapters, liftField } from '../../../src/workspace2/logic-fields/registry';
import { saveCanvasLayout } from '../../../src/workspace2/logic-fields/layout';
import { readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { draftDocument } from '../draft/fixtures';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const path = ['logicLibrary', 0, 'body'];
function setup(props: Partial<FlowCanvasProps> = {}) {
  const document = compileCompositionDocument(draftDocument()).document;
  const graph = arrangeCanvas(liftField(document, path, 'operand').graph);
  const snapshot = { document: document as unknown as import('../../../src/shared/types').Json, revision: 'r1' };
  const host: CanvasHost = {
    snapshot: () => snapshot, apply: vi.fn(async () => ({ status: 'applied' as const, snapshot })),
    save: vi.fn(async () => ({ status: 'saved' as const, snapshot })), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities,
    open: vi.fn(), openOutput: vi.fn(), uses: () => [], preview: vi.fn(),
  };
  const options = { graph, host, title: 'Template body', theme: deriveTheme({}, false), onClose: vi.fn(), ...props };
  return { document, graph, host, options };
}
it('notifies with the same sealed graph used by Apply, without copying or notifying for selection', async () => {
  const onGraphChange = vi.fn(), onApply = vi.fn<NonNullable<FlowCanvasProps['onApply']>>();
  const { options } = setup({ onGraphChange, onApply });
  onApply.mockResolvedValue({ status: 'applied', snapshot: options.host.snapshot() });
  render(<FlowCanvas {...options}/>);
  expect(onGraphChange).toHaveBeenCalledTimes(1);
  const initial: LogicGraph = onGraphChange.mock.calls[0][0];
  expect(Object.isFrozen(initial)).toBe(true);
  expect(Object.isFrozen(initial.nodes)).toBe(true);
  expect(onGraphChange.mock.calls[0][1]).toEqual({ revision: 0, reason: 'initial' });
  fireEvent.click(screen.getByRole('button', { name: /^Select Attribute/ }));
  expect(onGraphChange).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  expect(onApply.mock.calls[0][1].graph).toBe(initial);
  expect(onApply.mock.calls[0][1].positions).toEqual(Object.fromEntries(initial.nodes.map(node => [node.id, node.position])));
  expect(options.host.apply).not.toHaveBeenCalled();
});
it('round-trips controlled selection from the host and back from canvas focus', () => {
  const { options, graph } = setup();
  const change = vi.fn();
  function Controlled() {
    const [selected, setSelected] = useState<string | null>(null);
    return <><button type="button" onClick={() => setSelected(graph.roots[0].nodeId)}>Select from host</button>
      <button type="button" onClick={() => setSelected(null)}>Clear from host</button>
      <FlowCanvas {...options} selectedNodeId={selected} onSelectionChange={id => { change(id); setSelected(id); }}/></>;
  }
  render(<Controlled/>);
  expect(screen.getAllByRole('button', { name: /^Select / }).filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Select from host' }));
  const root = screen.getByRole('button', { name: /^Select Attribute/ });
  expect(root.getAttribute('aria-pressed')).toBe('true');
  const other = screen.getAllByRole('button', { name: /^Select / }).find(button => button !== root && button.textContent !== 'Select from host')!;
  fireEvent.focus(other);
  expect(change).toHaveBeenCalledOnce();
  expect(other.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Clear from host' }));
  expect(screen.getAllByRole('button', { name: /^Select / }).filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
  expect(change).toHaveBeenCalledOnce();
});
it('notifies once per working revision with the edit reason and exact sealed graph', () => {
  const onGraphChange = vi.fn(), { options } = setup({ onGraphChange });
  render(<FlowCanvas {...options}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const root = screen.getByRole('button', { name: /^Select Attribute/ });
  fireEvent.click(root);
  fireEvent.click(screen.getByRole('button', { name: 'Move with arrow keys' }));
  fireEvent.keyDown(root, { key: 'ArrowRight' });
  expect(onGraphChange).toHaveBeenCalledOnce();
  fireEvent.keyDown(root, { key: 'Enter' });
  expect(onGraphChange).toHaveBeenCalledTimes(2);
  expect(onGraphChange.mock.calls[1][1]).toEqual({ revision: 1, reason: 'move' });
  expect(Object.isFrozen(onGraphChange.mock.calls[1][0])).toBe(true);
  expect(onGraphChange.mock.calls[1][0]).not.toBe(onGraphChange.mock.calls[0][0]);
});
it('hands moved positions through Apply, canonical save and reopen with bindings intact', async () => {
  const { document, options } = setup();
  let saved = document;
  render(<FlowCanvas {...options} onApply={async (transaction, handoff) => {
    let next = fieldAdapters.operand.write(document, path, transaction.replacements[0].ast as import('../../../src/shared/types').Json);
    next = saveCanvasLayout(next, transaction.replacements, handoff, { document, paths: [path] });
    saved = compileCompositionDocument(JSON.parse(JSON.stringify(next))).document;
    return { status: 'applied', snapshot: { ...options.host.snapshot(), document: saved as unknown as import('../../../src/shared/types').Json } };
  }}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const root = screen.getByRole('button', { name: /^Select Attribute/ });
  fireEvent.click(root);
  fireEvent.click(screen.getByRole('button', { name: 'Move with arrow keys' }));
  fireEvent.keyDown(root, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(root, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  await waitFor(() => expect(saved.studioCanvas).toBeDefined());
  expect(saved.logicUseBindings).toEqual(document.logicUseBindings);
  const metadata = readStudioCanvas(saved);
  expect(metadata.warnings).toEqual([]);
  const reopened = liftField(saved, path, 'operand');
  const positioned = import('../../../src/shared/composition/graph/lift');
  const restored = (await positioned).lift(fieldAdapters.operand.read(saved, path), {
    anchor: reopened.graph.roots[0].anchor, kind: 'operand', metadata: metadata.metadata,
    context: reopened.graph.roots[0].destination.context,
  }).graph;
  expect(restored.nodes[0].position!.x).toBe(options.graph.nodes[0].position!.x + 32);
  expect(lower(restored).ok).toBe(true);
});
