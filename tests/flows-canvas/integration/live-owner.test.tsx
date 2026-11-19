// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { LogicFieldsProvider, useFieldDraft, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { useWorkspaceFlowData } from '../../../src/workspace2/logic-fields/live';
import { newFlow, flowSources } from '../../../src/workspace2/data/flow';
import { resetLiveRuns } from '../../../src/workspace2/data/liveRun';
import { deriveTheme } from '../../../src/workspace2/theme';
import { Project } from '../../support/workspace2-surfaces';
import { integrationDocument } from './fixture';
import type { CompositionDocument } from '../../../src/shared/composition/schema';

beforeEach(() => {
  vi.useFakeTimers(); resetLiveRuns();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); resetLiveRuns(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('hands legacy readers to one grouped canvas owner, makes simulation fetch-free, and rejects late close responses', async () => {
  const first = newFlow(integrationDocument(), 'service', { title: 'First request', entityId: 'todo.example_chores' });
  const second = newFlow(first.document, 'service', { title: 'Second request', entityId: 'todo.example_chores' });
  const document = second.document, live = new LiveHouse();
  const state = { entityId: 'todo.example_chores', name: 'Fixture list', state: '1' };
  live.applySnapshot([state]);
  const resolvers: ((response: Response) => void)[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { resolvers.push(resolve); }));
  const pending = { current: document };
  function Reader({ id }: { id: string }) {
    const flow = flowSources(document).find(source => source.id === id)!;
    const { run } = useWorkspaceFlowData(id, flow.inputs);
    return <output data-testid={`answer-${id}`}>{JSON.stringify(run.answer?.response ?? null)}</output>;
  }
  function Controls({ document }: { document: CompositionDocument }) {
    const canvas = useLogicFields()!;
    const draft = useFieldDraft(document, next => { pending.current = next; });
    return <button type="button" onClick={() => canvas.open({ draft, path: ['logicLibrary', 1, 'body'], kind: 'operand', label: 'Fixture value' })}>Open canvas</button>;
  }
  const ws = Project.workspace(document);
  render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
    <LogicFieldsProvider ws={ws} theme={deriveTheme({}, false)}>
      <Controls document={document}/><Reader id={first.id}/><Reader id={second.id}/>
    </LogicFieldsProvider>
  </WorkspaceDataProvider>);
  await act(() => vi.advanceTimersByTimeAsync(599));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open canvas' }));
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe('./native/api/ha/flow-run');
  fireEvent.click(screen.getByText('Simulation · Studio only', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Simulated' }));
  await act(() => live.applyStream([{ ...state, state: '2' }]));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => resolvers[0](Response.json({ response: { retired: true }, at: '2026-11-18T16:00:00Z' })));
  expect(screen.queryByText(/retired/)).toBeNull();
  fireEvent.click(screen.getByRole('group', { name: 'Simulation mode' }).querySelector('button')!);
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Close canvas' }));
  await act(async () => resolvers[1](Response.json({ response: { lateCanvas: true }, at: '2026-11-18T16:00:01Z' })));
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(screen.getByTestId(`answer-${first.id}`).textContent).toBe('null');
  expect(screen.getByTestId(`answer-${second.id}`).textContent).toBe('null');
  await act(async () => {
    resolvers[2](Response.json({ response: { current: true }, at: '2026-11-18T16:00:02Z' }));
    resolvers[3](Response.json({ response: { current: true }, at: '2026-11-18T16:00:02Z' }));
  });
  expect(screen.getByTestId(`answer-${first.id}`).textContent).toContain('"current":true');
  expect(screen.getByTestId(`answer-${second.id}`).textContent).toContain('"current":true');
  expect(pending.current).toBe(document);
  expect(fetch.mock.calls.every(([url]) => url === './native/api/ha/flow-run')).toBe(true);
});
