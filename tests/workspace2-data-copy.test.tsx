// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { newFlow, updateFlow } from '../src/workspace2/data/flow';
import { copyOf, voiceIssues } from './support/copy';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const dir = './snapshots/copy';

/** The fixture with an invented live to-do flow that keeps unfinished items. No house data. */
function withFlow() {
  const made = newFlow(home, 'live-list', { entityId: 'todo.example_chores', title: 'Chores' });
  const document = updateFlow(made.document, made.id, inputs => ({ ...inputs, steps: [...inputs.steps, { id: 'filter-1', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['status'] }, right: { type: 'literal', value: 'needs_action' } } }] }));
  return { document, id: made.id };
}

describe('copy snapshots: the Data tab (spec 10)', () => {
  it('the flow editor, and its Filter page', async () => {
    const { document, id } = withFlow();
    const ws = Project.workspace(document, { kind: 'flow', id } as never);
    const { container } = render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
    await waitFor(() => expect(container.querySelector('[data-testid=flow-editor]')).not.toBeNull());
    expect(voiceIssues(container)).toEqual([]);
    await expect(copyOf(container)).toMatchFileSnapshot(`${dir}/data-flow-editor.txt`);
    const step = container.querySelector<HTMLElement>('button[aria-label^="Step 2, Filter"]');
    expect(step).toBeTruthy();
    await act(async () => { fireEvent.click(step!); });
    expect(voiceIssues(container)).toEqual([]);
    expect(copyOf(container)).not.toMatch(/If it can.t tell/);
    await expect(copyOf(container)).toMatchFileSnapshot(`${dir}/data-flow-filter.txt`);
  });
});
