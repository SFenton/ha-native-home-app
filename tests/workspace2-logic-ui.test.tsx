// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import FlowsPanel from '../src/workspace2/flows/FlowsPanel';
import { useLibrary } from '../src/workspace2/useLibrary';
import LogicUseSettings from '../src/workspace2/data/logic/LogicUse';
import { createDraft, useDraftDocument } from '../src/workspace2/editors/draft';
import { RowsProvider } from '../src/workspace2/rowsContext';
import { entryOf, makeUse, defaultArgs, usesOf } from '../src/workspace2/data/logic/logicModel';
import { ToastHost } from '../src/workspace2/toasts';
import { copyOf, voiceIssues } from './support/copy';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import { houseFrom } from '../src/preview2/projections';
import { Project } from './support/workspace2-surfaces';
import gallery from '../src/preview2/fixtures/logic-gallery.json';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const logic = gallery.document as unknown as CompositionDocument;
const home = homeDomains.document as unknown as CompositionDocument;
const dir = './snapshots/copy';
/** The demo house behind the gallery, so a result line has states to work out (the app draws "Shows 3 On", tagged Test while a Try With value stands in). */
const house = houseFrom({ states: ['switch.demo_light_1', 'switch.demo_light_2', 'switch.demo_light_3', 'switch.demo_door', 'switch.demo_window'].map((entityId, at) => ({ entityId, name: entityId, state: at < 4 ? 'on' : 'off' })) });

/** The workspace over a document that the test's edits change, so each edit shows in the next render. */
function Host({ document, children, target }: { document: CompositionDocument; target?: unknown; children: (ws: ReturnType<typeof Project.workspace>) => React.ReactNode }) {
  return <ToastHost><Project.Live document={document} stub={{ extra: { target, openLogic: vi.fn(), logicId: undefined, logicFrom: undefined } }}>{ws => children(ws)}</Project.Live></ToastHost>;
}
function Panel({ ws }: { ws: ReturnType<typeof Project.workspace> }) {
  const library = useLibrary('docked', 1440);
  return <FlowsPanel ws={ws} library={library} onKeepPanel={() => {}} onError={() => {}}/>;
}

describe('Logic Templates group (proposal, section 1)', () => {
  it('says what to do when there are none, and a 48 px row names its kind and uses', async () => {
    localStorage.clear();
    const { container } = render(<Host document={home}>{ws => <Panel ws={ws}/>}</Host>);
    const group = container.querySelector('[data-testid=logic-group]')!;
    fireEvent.click(within(group as HTMLElement).getByRole('button', { name: 'Templates, 0' }));
    expect(group.querySelector('h3')!.textContent).toBe('Templates0');
    expect(group.querySelector('[data-testid=logic-empty]')!.textContent).toBe('No logic templates yet. Choose Save as Logic Template from a value’s or a condition’s More menu.');
    expect(voiceIssues(container)).toEqual([]);
    expect(copyOf(group)).toContain('No logic templates yet.');
  });
  it('lists the sample templates with their kind and use counts, in a list named for the group', async () => {
    localStorage.clear();
    const { container, getByRole } = render(<Host document={logic}>{ws => <Panel ws={ws}/>}</Host>);
    fireEvent.click(getByRole('button', { name: 'Templates, 3' }));
    const list = within(container.querySelector('[data-testid=logic-group]') as HTMLElement).getByRole('list', { name: 'Logic Templates' });
    expect(within(list).getAllByRole('button', { name: /logic template/ }).map(button => button.getAttribute('aria-label'))).toEqual([
      'Count or All, logic template, Words, Used by 3', 'Yours or Theirs, logic template, Words, Used by 3', 'Night Hours, logic template, Yes or No, Used by 3']);
    expect(list.textContent).toContain('Yes or No · Used by 3');
    expect(getByRole('button', { name: 'Logic Template' })).toBeTruthy();
    expect(voiceIssues(container)).toEqual([]);
    expect(copyOf(list)).toContain('Template');
  });
  it('+ Logic Template adds a Value or a Condition, selects it and opens its editor', async () => {
    const opened = vi.fn(), applied = vi.fn();
    const { getByRole } = render(<ToastHost><Project.Live document={home} seen={applied} stub={{ extra: { openLogic: opened } }}>{ws => <Panel ws={ws}/>}</Project.Live></ToastHost>);
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Logic Template' })); });
    await act(async () => { fireEvent.click(await waitFor(() => getByRole('menuitem', { name: 'Condition' }))); });
    expect(applied).toHaveBeenCalled();
    const made = applied.mock.calls.at(-1)![0] as CompositionDocument;
    expect(made.logicLibrary!.map(entry => [entry.name, entry.kind])).toEqual([['New Condition', 'condition']]);
    expect(opened).toHaveBeenCalledWith('new-condition');
  });
});

describe('the logic template editor (proposal, section 1)', () => {
  it('shows the name, the settings with what they are tried with, the body, the result and Used by', async () => {
    const ws = Project.workspace(logic, { kind: 'logic', id: 'count-or-all' } as never);
    const { container } = render(<ToastHost><WorkspaceDataProvider document={logic} house={house}><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></WorkspaceDataProvider></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    expect(container.querySelector('header h2')!.textContent).toBe('Count or All');
    expect(container.querySelector('header p')!.textContent).toBe('Logic Template · Value · Used by 3');
    expect(container.textContent).toContain('Each use sets (3)');
    expect(container.textContent).toContain('Value · tried with 3');
    expect(container.textContent).toContain('Text · tried with On');
    expect(voiceIssues(container)).toEqual([]);
    await expect(copyOf(container)).toMatchFileSnapshot(`${dir}/logic-editor.txt`);
  });
  it('a Time setting reads as a time of day, and a setting row opens in place with Label, Kind, Try With and Remove Setting', async () => {
    const ws = Project.workspace(logic, { kind: 'logic', id: 'night-hours' } as never);
    const { container, getByRole } = render(<ToastHost><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    expect(container.textContent).toContain('Time · tried with 10:00 PM');
    const row = getByRole('button', { name: /^From, Time, tried with 10:00 PM$/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { fireEvent.click(row); });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const open = getByRole('group', { name: 'From' });
    expect(within(open).getByLabelText('Label')).toBeTruthy();
    expect(within(open).getByRole('combobox', { name: 'Kind' })).toBeTruthy();
    expect(within(open).getByRole('button', { name: 'Remove Setting' })).toBeTruthy();
    expect(within(open).getByLabelText('Try With')).toBeTruthy();
  });
  it('Add Setting is disabled at 8 settings and says why', async () => {
    const full = { ...logic, logicLibrary: logic.logicLibrary!.map(entry => entry.id === 'count-or-all' ? { ...entry, params: Array.from({ length: 8 }, (_, at) => ({ name: `text${at + 1}`, kind: 'text' as const, label: `Text ${at + 1}`, sample: 'On' })) } : entry) };
    const ws = Project.workspace(full, { kind: 'logic', id: 'count-or-all' } as never);
    const { container, getByRole } = render(<ToastHost><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    expect(getByRole('button', { name: 'Add Setting…' }).hasAttribute('disabled')).toBe(true);
    expect(container.textContent).toContain('A logic template holds 8 settings.');
    expect(getByRole('button', { name: 'Add Setting…' }).getAttribute('aria-describedby')).toBe('w2-logic-settings-limit');
  });
  it('a setting not used in the body says so', async () => {
    const unused = { ...logic, logicLibrary: logic.logicLibrary!.map(entry => entry.id === 'night-hours' ? { ...entry, params: [...entry.params, { name: 'extra', kind: 'text' as const, label: 'Spare', sample: 'x' }] } : entry) };
    const ws = Project.workspace(unused, { kind: 'logic', id: 'night-hours' } as never);
    const { container, getByRole } = render(<ToastHost><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(getByRole('button', { name: /^Spare/ })); });
    expect(container.querySelector('[data-testid=setting-unused]')!.textContent).toBe('Not used in this template.');
  });
});

describe('a use opened, and the questions', () => {
  function Use({ document, onDraft }: { document: CompositionDocument; onDraft?: (document: CompositionDocument) => void }) {
    const entry = entryOf(document, 'count-or-all')!;
    const draft = createDraft(document);
    const use = makeUse(entry, { ...defaultArgs(entry), word: 'Open' });
    function Probe() { onDraft?.(useDraftDocument(draft)); return null; }
    return <RowsProvider value={{ document, onChange: () => {}, onError: () => {} }}><Probe/>
      <LogicUseSettings draft={draft} use={use} kind="value" removeLabel="Remove Value" onChange={() => {}} onUnlink={() => {}} onRemove={() => {}}/></RowsProvider>;
  }
  it('one row per setting under the template name, then Open Template, Unlink From Template and Remove Value', async () => {
    const { container, getByRole } = render(<Use document={logic}/>);
    expect(container.querySelector('[data-testid=logic-use]')).not.toBeNull();
    expect(container.textContent).toContain('Count or All · Logic Template');
    expect(getByRole('group', { name: 'Count or All' })).toBeTruthy();
    for (const name of ['Open Template', 'Unlink From Template', 'Remove Value']) expect(getByRole('button', { name })).toBeTruthy();
    expect(within(getByRole('group', { name: 'Count or All' })).getByLabelText('Word')).toHaveProperty('value', 'Open');
    expect(voiceIssues(container)).toEqual([]);
    await expect(copyOf(container)).toMatchFileSnapshot(`${dir}/logic-use.txt`);
  });
  it('Delete asks only when the template is used; the question has no default button and Cancel keeps it', async () => {
    const applied = vi.fn();
    const ws = Project.workspace(logic, { kind: 'logic', id: 'count-or-all' } as never, undefined, applied);
    const { container } = render(<ToastHost><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(container.querySelector<HTMLElement>('[data-testid=logic-delete]')!); });
    const question = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-testid=logic-question]'); expect(found).not.toBeNull(); return found!; });
    expect(question.getAttribute('role')).toBe('alertdialog');
    expect(copyOf(question)).toBe('Delete “Count or All”?\nIt is used by 3. Each use keeps its logic, unlinked.\nCancel\nDelete Template\n');
    await expect(copyOf(question)).toMatchFileSnapshot(`${dir}/logic-questions.txt`);
    expect(applied).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(question).getByRole('button', { name: 'Cancel' })); });
    expect(applied).not.toHaveBeenCalled();
  });
  it('an unused template is deleted at once, and a used one is unlinked when the question is confirmed', async () => {
    const made = Project.workspace({ ...logic, logicLibrary: [...logic.logicLibrary!, { id: 'spare', name: 'Spare', kind: 'operand', params: [], body: { type: 'literal', value: 'x' } }] }, { kind: 'logic', id: 'spare' } as never, undefined, vi.fn());
    const first = render(<ToastHost><PropertiesPanel ws={made} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(first.container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(first.container.querySelector<HTMLElement>('[data-testid=logic-delete]')!); });
    expect(document.querySelector('[data-testid=logic-question]')).toBeNull();
    const apply = made.studio.apply as ReturnType<typeof vi.fn>;
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0][0] as CompositionDocument).logicLibrary!.map(entry => entry.id)).toEqual(['count-or-all', 'yours-or-theirs', 'night-hours']);
    cleanup();
    const used = Project.workspace(logic, { kind: 'logic', id: 'night-hours' } as never, undefined, vi.fn());
    const second = render(<ToastHost><PropertiesPanel ws={used} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(second.container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(second.container.querySelector<HTMLElement>('[data-testid=logic-delete]')!); });
    const question = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-testid=logic-question]'); expect(found).not.toBeNull(); return found!; });
    await act(async () => { fireEvent.click(within(question).getByRole('button', { name: 'Delete Template' })); });
    const after = (used.studio.apply as ReturnType<typeof vi.fn>).mock.calls[0][0] as CompositionDocument;
    expect(usesOf(after, 'night-hours')).toEqual([]);
    expect(after.logicLibrary!.map(entry => entry.id)).toEqual(['count-or-all', 'yours-or-theirs']);
    expect(JSON.stringify(after)).not.toContain('"night-hours"');
  });
});
