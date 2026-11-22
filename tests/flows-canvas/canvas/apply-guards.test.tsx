// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasHost } from '../../../src/shared/composition/graph';
import { supportedCompositionCapabilities } from '../../../src/shared/composition/compiler';
import FlowCanvas from '../../../src/workspace2/canvas/FlowCanvas';
import { edit, initialEditState } from '../../../src/workspace2/canvas/edit';
import { deriveTheme } from '../../../src/workspace2/theme';
import { lightsGraph } from './lights-fixture';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function options(graph = lightsGraph()) {
  const snapshot = { document: {}, revision: 'r1' };
  const host: CanvasHost = {
    snapshot: () => snapshot, apply: vi.fn<CanvasHost['apply']>(async () => ({ status: 'applied', snapshot })),
    save: vi.fn<CanvasHost['save']>(async () => ({ status: 'saved', snapshot })), compareConflict: vi.fn(),
    data: { sources: [] }, targetCapabilities: supportedCompositionCapabilities,
    open: vi.fn(), openOutput: vi.fn(), uses: () => [], preview: vi.fn(),
  };
  return { graph, host, title: 'Selected Lights On', theme: deriveTheme({}, false), onClose: vi.fn() };
}
it('names each detached block instead of silently dropping it or refusing without an explanation', () => {
  let state = initialEditState(lightsGraph());
  state = edit(state, { type: 'add', scopeId: state.graph.scopes[0].id, seed: { kind: 'operand', value: { type: 'literal', value: 'Unused' } } });
  const props = options(state.graph);
  render(<FlowCanvas {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByRole('dialog', { name: 'Canvas problems' }).textContent).toContain('Text (block 21) is not connected to an output. Connect or delete these blocks.');
  expect(props.host.apply).not.toHaveBeenCalled();
});
it('shows the compiler failure and its location when an incomplete flow cannot apply', () => {
  const graph = lightsGraph(), edge = graph.edges.find(edge => edge.binding === '/inputs')!;
  const props = options({ ...graph, edges: graph.edges.filter(held => held !== edge) });
  render(<FlowCanvas {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByRole('dialog', { name: 'Canvas problems' }).textContent).toContain('A required input is disconnected. Output');
  expect(props.host.apply).not.toHaveBeenCalled();
});
it('explains a canvas with no output rather than reporting compiler acceptance', () => {
  render(<FlowCanvas {...options({ ...lightsGraph(), nodes: [], edges: [], roots: [] })}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByRole('dialog', { name: 'Canvas problems' }).textContent).toContain('A graph must have an output.');
  expect(screen.queryByText('No Problems. Compiler accepted the current connections.')).toBeNull();
});
it('keeps unsent details and an in-progress move local, with a specific refusal for each', () => {
  const props = options();
  render(<FlowCanvas {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: /^Select Match Value / });
  fireEvent.click(header);
  fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Match Value' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Unsaved details' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByRole('status', { name: '' }).textContent).toContain('Apply or cancel the block details');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move Match Value' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
  expect(screen.getByRole('status', { name: '' }).textContent).toContain('Finish or cancel the block move');
  expect(props.host.apply).not.toHaveBeenCalled();
});
it('explains duplicate Apply attempts and sends only one transaction while the write is pending', async () => {
  const props = options();
  let finish!: (result: Awaited<ReturnType<CanvasHost['apply']>>) => void;
  props.host.apply = vi.fn<CanvasHost['apply']>(() => new Promise(resolve => { finish = resolve; }));
  render(<FlowCanvas {...props}/>);
  const apply = screen.getByRole('button', { name: 'Apply to draft' });
  fireEvent.click(apply); fireEvent.click(apply);
  expect(screen.getByRole('status', { name: '' }).textContent).toContain('already in progress');
  expect(props.host.apply).toHaveBeenCalledOnce();
  await act(async () => finish({ status: 'applied', snapshot: props.host.snapshot() }));
  expect(screen.getByRole('status', { name: '' }).textContent).toBe('Edits applied to the draft. Not published.');
});
it('selects the annotation owner even when its controls outlive a host selection change', () => {
  const props = options();
  function Controlled() {
    const [selected, select] = useState<string | null>(null);
    return <><button onClick={() => select(props.graph.roots[0].nodeId)}>Select output from host</button>
      <FlowCanvas {...props} selectedNodeId={selected} onSelectionChange={select}/></>;
  }
  render(<Controlled/>);
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  const header = screen.getByRole('button', { name: /^Select Match Value / });
  fireEvent.click(header);
  fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select output from host' }));
  expect(header.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Match Value' }));
  expect(header.getAttribute('aria-pressed')).toBe('true');
  const form = screen.getByRole('form', { name: 'Block details' });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Label' }), { target: { value: 'Friendly lights' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Apply details' }));
  expect(screen.queryByRole('form', { name: 'Block details' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Select Rows / }));
  expect(screen.getByRole('button', { name: /^Select Rows / }).getAttribute('aria-pressed')).toBe('true');
});
