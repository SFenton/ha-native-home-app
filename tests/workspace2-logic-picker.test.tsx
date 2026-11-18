// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { houseFrom } from '../src/preview2/projections';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import CountCases, { type CountResult } from '../src/workspace2/data/logic/CountCases';
import LogicUseSettings from '../src/workspace2/data/logic/LogicUse';
import { LogicScopeProvider } from '../src/workspace2/data/logic/logicScope';
import { COUNT_MAX_ENTITIES, countCases, defaultArgs, entryOf, howManyAre, makeUse } from '../src/workspace2/data/logic/logicModel';
import { createDraft } from '../src/workspace2/editors/draft';
import ValuePicker from '../src/workspace2/expr/ValuePicker';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import { RowsProvider } from '../src/workspace2/rowsContext';
import { ToastHost } from '../src/workspace2/toasts';
import { Project } from './support/workspace2-surfaces';
import gallery from '../src/preview2/fixtures/logic-gallery.json';

afterEach(cleanup);
type J = Record<string, any>;
const logic = gallery.document as unknown as CompositionDocument;
const states = [['switch.demo_light_1', 'on'], ['switch.demo_light_2', 'on'], ['switch.demo_light_3', 'on'], ['switch.demo_door', 'on'], ['switch.demo_window', 'off'], ['person.demo_sam', 'home'], ['person.demo_alex', 'home']]
  .map(([entityId, state]) => ({ entityId, name: entityId.split('.')[1].replace('demo_', '').replace(/^./, letter => letter.toUpperCase()), state }));
const house = houseFrom({ states });

/** The gallery with "Many", a value template that has `count` Entity settings, for the count starter. */
function withMany(count: number): CompositionDocument {
  const names = ['demo-light-1', 'demo-light-2', 'demo-light-3', 'demo-door', 'demo-window'].slice(0, count);
  const entry = { id: 'many', name: 'Many', kind: 'operand' as const, params: names.map((sample, at) => ({ name: `entity${at + 1}`, kind: 'source-id' as const, label: `Entity ${at + 1}`, sample })), body: { type: 'literal', value: '' } };
  return { ...logic, logicLibrary: [...logic.logicLibrary!, entry] } as CompositionDocument;
}
function Shell({ document, children }: { document: CompositionDocument; children: React.ReactNode }) {
  return <ToastHost><WorkspaceDataProvider document={document} house={house}><RowsProvider value={{ document, onChange: () => {}, onError: () => {} }}>{children}</RowsProvider></WorkspaceDataProvider></ToastHost>;
}

describe('How Many Are… (the count starter)', () => {
  const open = async (document: CompositionDocument, onCases: (result: CountResult) => void) => {
    const draft = createDraft(document);
    const view = render(<Shell document={document}><LogicScopeProvider value={{ entryId: 'many' }}><CountCases draft={draft} onCases={onCases}/></LogicScopeProvider></Shell>);
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Which value is counted?' })); });
    return await waitFor(() => { const found = document_().querySelector<HTMLElement>('[data-testid=how-many]'); expect(found).not.toBeNull(); return found!; });
  };
  const document_ = () => globalThis.document;

  it('ticks the first three Entity settings, disables a fourth, and says it counts up to three', async () => {
    const group = await open(withMany(5), () => {});
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    expect(boxes.map(box => box.checked)).toEqual([true, true, true, false, false]);
    expect(boxes.map(box => box.disabled)).toEqual([false, false, false, true, true]);
    expect(within(group).getByTestId('count-limit').textContent).toBe('Counts up to three entities.');
    await act(async () => { fireEvent.click(boxes[2]); });
    expect((within(group).getAllByRole('checkbox') as HTMLInputElement[]).map(box => box.disabled)).toEqual([false, false, false, false, false]);
  });
  it('Use This Count writes three rules, is 0, is 1 and is more than 1, over the ticked entities', async () => {
    const onCases = vi.fn();
    const group = await open(withMany(3), onCases);
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Use This Count' })); });
    expect(onCases).toHaveBeenCalledOnce();
    const result = onCases.mock.calls[0][0] as CountResult;
    expect(result.cases.map(rule => (rule.when as J).op + ':' + (rule.when as J).right.value)).toEqual(['eq:0', 'eq:1', 'above:1']);
    expect(JSON.stringify(result.cases[0].when)).toContain('"type":"hole"');
    expect((result.otherwise as J).value).toBe('');
  });
  it('shows nothing when the template has no Entity setting', async () => {
    const draft = createDraft(logic);
    const view = render(<Shell document={logic}><LogicScopeProvider value={{ entryId: 'night-hours' }}><CountCases draft={draft} onCases={() => {}}/></LogicScopeProvider></Shell>);
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Which value is counted?' })); });
    expect(globalThis.document.querySelector('[data-testid=how-many]')).toBeNull();
  });
});

describe('the 3-entity count against the 64-node operand limit', () => {
  const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
  /** A page with one text whose value is a use of a template that counts `n` entities through `math add` of `choose`, with the three rules. */
  function counting(n: number): J {
    const doc = structuredClone(base.document);
    const sources = Array.from({ length: n }, (_, at) => ({ id: `cnt-${at + 1}`, kind: 'ha-entity', entityId: { type: 'literal', value: `switch.demo_count_${at + 1}` } }));
    doc.dataSources.push(...sources);
    const names = sources.map((_, at) => `entity${at + 1}`);
    // `howManyAre` refuses a fourth entity, so a fourth is built by hand to see what the compiler does with it.
    const one = (name: string): J => ({ type: 'choose', cases: [{ when: { type: 'state', sourceId: { type: 'hole', name }, path: ['state'], in: ['on'] }, then: { type: 'literal', value: 1 } }], otherwise: { type: 'literal', value: 0 } });
    const count = n === 1 ? one(names[0]) : { type: 'math', op: 'add', args: names.map(one) };
    const body = { type: 'choose', ...countCases(count) };
    doc.logicLibrary = [{ id: 'many', name: 'Many', kind: 'operand', params: names.map(name => ({ name, kind: 'source-id', label: name })), body }];
    doc.pages[2].components = [{ id: 'say', title: 'Say', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: { type: 'logic-ref', logicId: 'many', args: Object.fromEntries(names.map((name, at) => [name, sources[at].id])) } }, style: 'body', unavailableText: 'None' } }];
    return doc;
  }
  it('compiles with three entities and the plain operand holds 63 of its 64 nodes', () => {
    expect(COUNT_MAX_ENTITIES).toBe(3);
    const compiled = compileCompositionDocument(counting(3) as CompositionDocument);
    const operand = (compiled.expanded as J).pages[2].components[0].props.value.value;
    const nodes = (value: unknown): number => Array.isArray(value) ? value.reduce((sum: number, item) => sum + nodes(item), 0)
      : value && typeof value === 'object' ? ('type' in value ? 1 : 0) + Object.values(value).reduce((sum: number, item) => sum + nodes(item), 0) : 0;
    expect(nodes(operand)).toBe(63);
    expect(JSON.stringify(compiled.expanded)).not.toMatch(/logic-ref|"hole"/);
  });
  it('refuses a fourth entity at the operand limit, and howManyAre refuses it first', () => {
    let issues: J[] = [];
    try { compileCompositionDocument(counting(4) as CompositionDocument); } catch (error) { issues = (error as { issues: J[] }).issues; }
    expect(issues.map(issue => issue.code)).toContain('limit_exceeded');
    expect(() => howManyAre(['a', 'b', 'c', 'd'], ['on'])).toThrow('This is more than one rule can hold.');
  });
});

describe('the Person picker and the Settings group', () => {
  const use = () => { const entry = entryOf(logic, 'yours-or-theirs')!; return makeUse(entry, defaultArgs(entry)); };

  it('a use shows a Person setting as a choice among the people, and choosing one writes that person', async () => {
    const onChange = vi.fn(), draft = createDraft(logic);
    const view = render(<Shell document={logic}><LogicUseSettings draft={draft} use={use()} kind="value" removeLabel="Remove Value" onChange={onChange} onUnlink={() => {}} onRemove={() => {}}/></Shell>);
    const person = within(view.getByRole('group', { name: 'Yours or Theirs' })).getByRole('combobox', { name: 'Person' });
    expect(person.textContent).toContain('Sam');
    await act(async () => { fireEvent.click(person); });
    const alex = await waitFor(() => view.getByRole('option', { name: 'Alex' }));
    await act(async () => { fireEvent.pointerDown(alex); fireEvent.pointerUp(alex); fireEvent.mouseDown(alex); fireEvent.mouseUp(alex); fireEvent.click(alex); });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].args.person).toBe('person.demo_alex');
  });

  const picker = (entryId: string | undefined, conditions: boolean, onPick = vi.fn()) => {
    const draft = createDraft(logic);
    const inner = <ValuePicker draft={draft} conditions={conditions} groups={['templateSettings', 'logic', 'person']} onPick={onPick}/>;
    const view = render(<Shell document={logic}>{entryId ? <LogicScopeProvider value={{ entryId }}>{inner}</LogicScopeProvider> : inner}</Shell>);
    return { view, onPick };
  };
  it('inside a template the Settings group is first and lists every setting by its label', () => {
    const { view } = picker('yours-or-theirs', false);
    const settings = view.getByRole('region', { name: 'Settings' });
    expect(within(settings).getAllByRole('button').map(button => button.textContent)).toEqual(['Person', 'Name', 'Thing']);
    expect(view.queryByRole('region', { name: 'Logic Templates' })).toBeNull();
  });
  it('picking a setting writes a setting token: a text hole for a Person, a bare hole for a Value', async () => {
    const first = picker('yours-or-theirs', false);
    await act(async () => { fireEvent.click(within(first.view.getByRole('region', { name: 'Settings' })).getByRole('button', { name: 'Person' })); });
    expect((first.onPick.mock.calls[0][0] as J).operand).toEqual({ type: 'literal', value: { type: 'hole', name: 'person' } });
    cleanup();
    const second = picker('count-or-all', false);
    await act(async () => { fireEvent.click(within(second.view.getByRole('region', { name: 'Settings' })).getByRole('button', { name: 'Count' })); });
    expect((second.onPick.mock.calls[0][0] as J).operand).toEqual({ type: 'hole', name: 'count' });
  });
  it('in a condition, a Person setting is offered as "Is Person" and writes the viewer comparison', async () => {
    const { view, onPick } = picker('yours-or-theirs', true);
    await act(async () => { fireEvent.click(within(view.getByRole('region', { name: 'Settings' })).getByRole('button', { name: 'Is Person' })); });
    expect((onPick.mock.calls[0][0] as J).predicate).toEqual({ type: 'compare', op: 'eq', left: { type: 'viewer', field: 'personEntityId' }, right: { type: 'literal', value: { type: 'hole', name: 'person' } } });
  });
  it('outside a template the same picker lists the templates, not settings', () => {
    const { view } = picker(undefined, false);
    expect(view.queryByRole('region', { name: 'Settings' })).toBeNull();
    expect(within(view.getByRole('region', { name: 'Logic Templates' })).getAllByRole('button').map(button => button.textContent?.slice(0, 12))).toEqual(['Count or All', 'Yours or The']);
  });
  it('a template body that holds a setting names it by its label', async () => {
    const say = { id: 'say-thing', name: 'Say Thing', kind: 'operand' as const, params: [{ name: 'thing', kind: 'text' as const, label: 'Thing', sample: 'Chores' }], body: { type: 'literal', value: { type: 'hole', name: 'thing' } } };
    const document = { ...logic, logicLibrary: [...logic.logicLibrary!, say] } as CompositionDocument;
    const ws = Project.workspace(document, { kind: 'logic', id: 'say-thing' } as never);
    const view = render(<ToastHost><WorkspaceDataProvider document={document} house={house}><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></WorkspaceDataProvider></ToastHost>);
    await waitFor(() => expect(view.container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    expect(view.getByTestId('logic-body').textContent).toContain('Thing');
    expect(view.getByTestId('logic-body').textContent).not.toContain('[object');
  });
});
