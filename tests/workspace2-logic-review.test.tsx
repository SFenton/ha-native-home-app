// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../src/shared/composition/evaluator';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandLogic } from '../src/shared/composition/logic-library';
import type { CompositionDocument } from '../src/shared/composition/schema';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { evaluateOperand, registerFill } from '../src/workspace2/data/logic/logicEval';
import {
  addSetting, COUNT_MAX_ENTITIES, countCases, deleteEntry, entryOf, howManyAre, makeUse, setsLine, settingKindOf, unlinkAll, useCount, useCounts, usesOf,
} from '../src/workspace2/data/logic/logicModel';
import { ToastHost } from '../src/workspace2/toasts';
import { Project } from './support/workspace2-surfaces';
import { removeUnusedSources, sourceUses } from '../src/workspace2/dialogs/sources';
import { extractRows, entryFromLogic } from '../src/workspace2/data/logic/logicModel';
import gallery from '../src/preview2/fixtures/logic-gallery.json';

afterEach(cleanup);
const logic = gallery.document as unknown as CompositionDocument;
type J = Record<string, any>;

/** The gallery with a template, "Door Words", whose body uses "Count or All": a use inside another template. */
function nested(): CompositionDocument {
  const count = entryOf(logic, 'count-or-all')!;
  const door = { id: 'door-words', name: 'Door Words', kind: 'operand' as const,
    params: [{ name: 'open', kind: 'operand' as const, label: 'Open Doors', sample: { type: 'literal', value: 1 } }],
    body: { type: 'logic-ref', logicId: 'count-or-all', args: { count: { type: 'hole', name: 'open' }, word: 'Open', whenNone: 'All Closed' } } };
  void count;
  return { ...logic, logicLibrary: [...logic.logicLibrary!, door] } as CompositionDocument;
}

describe('a template edit reaches every use (the result cache)', () => {
  const lib = (word: string) => [{ id: 'say', name: 'Say', kind: 'operand' as const, params: [], body: { type: 'literal', value: word } }];
  const env = (): Environment => ({ read: () => ({ status: 'unavailable' }) }) as unknown as Environment;
  it('answers with the library it was asked with, for the same use object', () => {
    const uses = [makeUse(lib('A')[0]), makeUse(lib('A')[0]), makeUse(lib('A')[0])];
    const read = (library: ReturnType<typeof lib>, use: unknown) => { const out = evaluateOperand(use as never, registerFill(env(), { library })); return out.status === 'value' ? out.value : out.status; };
    expect(uses.map(use => read(lib('A'), use))).toEqual(['A', 'A', 'A']);
    const edited = lib('B');
    expect(uses.map(use => read(edited, use))).toEqual(['B', 'B', 'B']);
    expect(read(lib('C'), uses[0])).toBe('C');
  });
});

describe('Delete counts the uses inside other templates', () => {
  it('lists a use in another template, once, with that template as the place', () => {
    const doc = nested();
    const uses = usesOf(doc, 'count-or-all');
    expect(uses).toHaveLength(4);
    const inside = uses.find(use => use.inLogic)!;
    expect(inside).toMatchObject({ inLogic: 'door-words', place: 'Door Words', path: ['logicLibrary', 3, 'body'] });
    expect(useCount(doc, 'count-or-all')).toBe(4);
    expect(useCounts(doc).get('count-or-all')).toBe(4);
    for (const entry of doc.logicLibrary!) expect(useCounts(doc).get(entry.id) ?? 0).toBe(usesOf(doc, entry.id).length);
  });
  it('deleting unlinks the inner use and keeps the outer template whole, holes and all', () => {
    const after = deleteEntry(nested(), 'count-or-all');
    expect(usesOf(after, 'count-or-all')).toEqual([]);
    expect(JSON.stringify(after)).not.toContain('"count-or-all"');
    const door = entryOf(after, 'door-words')!;
    expect(JSON.stringify(door.body)).toContain('"hole"');
    expect(() => compileCompositionDocument(after)).not.toThrow();
    const worked = expandLogic({ logicLibrary: after.logicLibrary, x: { type: 'logic-ref', logicId: 'door-words', args: { open: { type: 'literal', value: 2 } } } }).document as { x: J };
    expect(worked.x.type).toBe('choose');
  });
  it('unlinkAll takes the use in a template and the uses on the pages together', () => {
    const after = unlinkAll(nested(), 'count-or-all');
    expect(usesOf(after, 'count-or-all')).toEqual([]);
  });
  it('the editor asks before deleting a template that only another template uses, and counts it', async () => {
    const ws = Project.workspace(nested(), { kind: 'logic', id: 'count-or-all' } as never, undefined, vi.fn());
    const { container } = render(<ToastHost><PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(within(container.querySelector<HTMLElement>('[data-testid=used-by]')!).getByRole('button', { name: 'Show 2 More' })); });
    expect(container.textContent).toContain('Door Words · Logic Template');
    const only = { ...nested(), pages: [], modals: [] } as unknown as CompositionDocument;
    expect(usesOf(only, 'count-or-all').length).toBeGreaterThan(0);
    cleanup();
    const lone = Project.workspace({ ...logic, pages: logic.pages.map(page => ({ ...page, components: [] })), logicLibrary: nested().logicLibrary } as never, { kind: 'logic', id: 'count-or-all' } as never, undefined, vi.fn());
    const view = render(<ToastHost><PropertiesPanel ws={lone} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/></ToastHost>);
    await waitFor(() => expect(view.container.querySelector('[data-testid=logic-editor]')).not.toBeNull());
    await act(async () => { fireEvent.click(view.container.querySelector<HTMLElement>('[data-testid=logic-delete]')!); });
    const question = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-testid=logic-question]'); expect(found).not.toBeNull(); return found!; });
    expect(question.textContent).toContain('It is used by 1. Each use keeps its logic, unlinked.');
    expect(lone.studio.apply).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(question).getByRole('button', { name: 'Delete Template' })); });
    const written = (lone.studio.apply as ReturnType<typeof vi.fn>).mock.calls[0][0] as CompositionDocument;
    expect(JSON.stringify(written)).not.toContain('"count-or-all"');
  });
});

describe('the Person setting', () => {
  it('is a text setting with the person display, and reads back as Person', () => {
    const entry = entryOf(logic, 'yours-or-theirs')!;
    expect(entry.params[0]).toMatchObject({ name: 'person', kind: 'text', display: 'person' });
    expect(settingKindOf(entry.params[0])).toBe('person');
    const added = addSetting(logic, 'night-hours', 'person', 'person.demo_sam');
    const param = entryOf(added.document, 'night-hours')!.params.at(-1)!;
    expect(param).toMatchObject({ kind: 'text', display: 'person', sample: 'person.demo_sam' });
    expect(settingKindOf(param)).toBe('person');
  });
  it('carries a person entity id into the test of the person using the app, before compile', () => {
    const rows = (expandLogic(logic).document as J).pages[0].components[1].children;
    const is = (id: string) => ({ type: 'compare', op: 'eq', left: { type: 'viewer', field: 'personEntityId' }, right: { type: 'literal', value: id } });
    expect(rows[0].props.primary.value.cases[0].when).toEqual(is('person.demo_sam'));
    expect(rows[1].props.primary.value.cases[0].when).toEqual(is('person.demo_alex'));
  });
});

describe('the count starter', () => {
  it('covers up to three entities and says so; a fourth is refused with the limit sentence', () => {
    expect(COUNT_MAX_ENTITIES).toBe(3);
    expect(() => howManyAre(['a', 'b', 'c'], ['on'])).not.toThrow();
    expect(() => howManyAre(['a', 'b', 'c', 'd'], ['on'])).toThrow('This is more than one rule can hold.');
  });
  it('three entities write the three rules and still compile in a template', () => {
    const body = { type: 'choose', ...countCases(howManyAre(['e1', 'e2', 'e3'], ['on'])) };
    const entry = { id: 'many', name: 'Many', kind: 'operand' as const, params: ['e1', 'e2', 'e3'].map(name => ({ name, kind: 'source-id' as const, label: name, sample: 'demo-light-1' })), body };
    expect(() => expandLogic({ logicLibrary: [entry], x: makeUse(entry) })).not.toThrow();
    expect(body.cases).toHaveLength(3);
  });
  it('a row of the Data panel names its settings by their labels', () => {
    expect(setsLine(entryOf(logic, 'count-or-all')!)).toBe('Sets Count, Word, When None');
    expect(setsLine({ ...entryOf(logic, 'count-or-all')!, params: [] })).toBe('Sets nothing');
  });
});

describe('sources used only through a use\u2019s arguments', () => {
  it('count as used, and Remove Unused keeps them', () => {
    expect(sourceUses(logic).get('demo-door')).toBeGreaterThan(0);
    const kept = removeUnusedSources(logic).dataSources.map(source => source.id);
    for (const id of ['demo-light-1', 'demo-light-2', 'demo-light-3', 'demo-door', 'demo-window', 'app-clock']) expect(kept).toContain(id);
  });
});

describe('Save as Logic Template over a test of the person using the app', () => {
  const body = { type: 'compare', op: 'eq', left: { type: 'viewer', field: 'personEntityId' }, right: { type: 'literal', value: 'person.demo_sam' } };
  it('offers the person as a row and writes a Person setting with a hole where the person was', () => {
    const rows = extractRows(body, id => id, id => id.replace('person.demo_', '').toUpperCase());
    expect(rows).toEqual([{ key: 'person:person.demo_sam', kind: 'person', label: 'SAM', detail: 'Person', value: 'person.demo_sam' }]);
    const made = entryFromLogic(logic, 'condition', 'Is Sam', body, rows);
    expect(made.entry.params).toEqual([{ name: 'person1', kind: 'text', display: 'person', label: 'SAM', sample: 'person.demo_sam' }]);
    expect(made.entry.body).toEqual({ ...body, right: { type: 'literal', value: { type: 'hole', name: 'person1' } } });
    expect(made.args).toEqual({ person1: 'person.demo_sam' });
  });
});
