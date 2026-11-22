// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { LogicFieldsProvider, useLogicFields } from '../../../src/workspace2/logic-fields/LogicFields';
import { createDraft } from '../../../src/workspace2/editors/draft';
import { deriveTheme } from '../../../src/workspace2/theme';
import { readStudioCanvas } from '../../../src/shared/composition/studio-logic/layout';
import { lift } from '../../../src/shared/composition/graph';
import { fieldAdapters, liftField } from '../../../src/workspace2/logic-fields/registry';
import { prepareDraft } from '../../../server/studio-logic/prepare';
import { Project } from '../../support/workspace2-surfaces';
import { demoLights, lightsDocument, lightsPath } from '../canvas/lights-fixture';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['annotations', 'layout', 'both'])('applies %s on a whole data flow and restores every block after document reload', async change => {
  const document = lightsDocument(), draft = createDraft(document), live = new LiveHouse();
  live.applySnapshot(demoLights.map(entityId => ({ entityId, name: entityId, state: 'on' })));
  const prepare = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (url === './native/api/draft/prepare') return Response.json(prepareDraft(JSON.parse(String(init?.body)).document));
    if (url === './native/api/ha/flow-run') return Response.json({ response: [], at: '2026-11-21T22:00:00Z' });
    throw new Error(`Unexpected request: ${url}`);
  });
  function Controls() {
    const canvas = useLogicFields()!;
    return <button onClick={() => canvas.open({ draft, path: lightsPath, kind: 'flow', label: 'Selected Lights On' })}>Open data flow</button>;
  }
  render(<WorkspaceDataProvider document={document} house={live.house} live={live}>
    <LogicFieldsProvider ws={Project.workspace(document)} theme={deriveTheme({}, false)}><Controls/></LogicFieldsProvider>
  </WorkspaceDataProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open data flow' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close block palette' }));
  if (change !== 'layout') {
    fireEvent.click(screen.getByRole('button', { name: /^Select Match Value / }));
    fireEvent.click(screen.getByRole('button', { name: 'Close data peek' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename or describe Match Value' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Friendly lights' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Names for the four selected lights.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply details' }));
  }
  if (change !== 'annotations') fireEvent.click(screen.getByRole('button', { name: 'Tidy Up' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' })));
  await waitFor(() => expect(screen.getByText('Edits applied to the draft. Not published.')).toBeTruthy());
  expect(prepare.mock.calls.filter(([url]) => url === './native/api/draft/prepare')).toHaveLength(1);
  const saved = JSON.parse(JSON.stringify(draft.get()));
  expect(saved.dataSources).toEqual(document.dataSources);
  const metadata = readStudioCanvas(saved);
  expect(metadata.warnings).toEqual([]);
  expect(saved.studioCanvas.canvases[0].nodes).toHaveLength(liftField(document, lightsPath, 'flow').graph.nodes.length);
  const restored = lift(fieldAdapters.flow.read(saved, lightsPath), {
    anchor: liftField(saved, lightsPath, 'flow').graph.roots[0].anchor, kind: 'flow',
    metadata: metadata.metadata,
  }).graph;
  expect(restored.nodes.find(node => node.catalogKey === 'operand.map.value')?.annotation).toEqual(change === 'layout' ? undefined : { label: 'Friendly lights', note: 'Names for the four selected lights.' });
  expect(restored.nodes.map(node => node.position)).toEqual(saved.studioCanvas.canvases[0].nodes.map((node: { x: number; y: number }) => ({ x: node.x, y: node.y })));
});
