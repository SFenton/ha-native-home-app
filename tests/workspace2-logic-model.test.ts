import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, type Environment } from '../src/shared/composition/evaluator';
import { expandLogic } from '../src/shared/composition/logic-library';
import type { CompositionDocument } from '../src/shared/composition/schema';
import {
  addEntry, addSetting, countCases, defaultArgs, deleteEntry, duplicateEntry, entryFromLogic, entryOf, extractRows, freshName, howManyAre, libraryOf, makeUse, nameFree,
  removeSetting, renameEntry, setBody, settingKindOf, unlinkUse, updateSetting, useCount, useProblems, usesOf,
} from '../src/workspace2/data/logic/logicModel';

type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (value: unknown): J => ({ type: 'literal', value });
const sources: J[] = ['a', 'b', 'c'].map(id => ({ id: `door-${id}`, kind: 'ha-entity', entityId: lit(`binary_sensor.demo_door_${id}`) }));
const text = (value: J, id = 't'): J => ({ id, title: id, type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value }, style: 'body', unavailableText: 'None' } });
const draft = (components: J[] = []): CompositionDocument => {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...sources);
  return document;
};
const env = (states: Record<string, string>): Environment => ({ read: (id: string, p: string[]) => p[0] === 'state' && id in states ? { status: 'value', value: states[id] } : { status: 'unavailable' } } as unknown as Environment);

describe('logic templates: entries and settings', () => {
  it('adds a Value and a Condition with a valid starting body, unique names and ids', () => {
    let doc = draft();
    const first = addEntry(doc, 'value', 'Doors'); doc = first.document;
    const second = addEntry(doc, 'value', 'Doors'); doc = second.document;
    const third = addEntry(doc, 'condition', 'Night'); doc = third.document;
    expect(libraryOf(doc).map(entry => entry.name)).toEqual(['Doors', 'Doors 2', 'Night']);
    expect(new Set(libraryOf(doc).map(entry => entry.id)).size).toBe(3);
    expect(() => compileCompositionDocument(doc)).not.toThrow();
  });
  it('refuses a duplicate name and the 101st entry', () => {
    let doc = addEntry(draft(), 'value', 'One').document;
    doc = addEntry(doc, 'value', 'Two').document;
    expect(nameFree(doc, 'one', 'two')).toBe(false);
    expect(() => renameEntry(doc, 'two', 'One')).toThrow();
    expect(renameEntry(doc, 'two', 'Three').logicLibrary![1].name).toBe('Three');
    const full = { ...draft(), logicLibrary: Array.from({ length: 100 }, (_, at) => ({ id: `e${at}`, name: `E${at}`, kind: 'operand' as const, params: [], body: lit(0) })) };
    expect(() => addEntry(full, 'value')).toThrow('at most 100');
  });
  it('adds up to 8 settings, tells kinds apart, and locks the kind once the body uses a setting', () => {
    let doc = addEntry(draft(), 'value', 'Count').document;
    for (const kind of ['text', 'number', 'time', 'value', 'condition', 'text', 'number'] as const) doc = addSetting(doc, 'count', kind).document;
    doc = addSetting(doc, 'count', 'entity', 'door-a').document;
    expect(() => addSetting(doc, 'count', 'text')).toThrow('8 settings');
    const kinds = entryOf(doc, 'count')!.params.map(settingKindOf);
    expect(kinds).toEqual(['text', 'number', 'time', 'value', 'condition', 'text', 'number', 'entity']);
    doc = setBody(doc, 'count', lit({ type: 'hole', name: 'text1' }));
    expect(() => updateSetting(doc, 'count', 'text1', { kind: 'number' })).toThrow();
    expect(entryOf(updateSetting(doc, 'count', 'number2', { kind: 'text' }), 'count')!.params[6].kind).toBe('text');
    expect(entryOf(updateSetting(doc, 'count', 'text1', { label: 'Word' }), 'count')!.params[0].label).toBe('Word');
  });
  it('removing a setting puts its Try With value in the body and drops it from each use', () => {
    let doc = addEntry(draft(), 'value', 'Word').document;
    doc = addSetting(doc, 'word', 'text').document;
    doc = setBody(doc, 'word', lit({ type: 'hole', name: 'text1' }));
    const entry = entryOf(doc, 'word')!;
    doc = { ...doc, pages: doc.pages.map((page, at) => at === 2 ? { ...page, components: [text(makeUse(entry, { text1: 'Open' }))] } : page) } as CompositionDocument;
    const removed = removeSetting(doc, 'word', 'text1');
    expect(entryOf(removed, 'word')!.params).toEqual([]);
    expect(entryOf(removed, 'word')!.body).toEqual(lit('On'));
    expect(JSON.stringify(removed.pages)).toContain('"args":{}');
  });
});

describe('logic templates: uses', () => {
  const build = () => {
    let doc = addEntry(draft(), 'value', 'Count or All').document;
    doc = addSetting(doc, 'count-or-all', 'text').document;
    doc = setBody(doc, 'count-or-all', { type: 'format', pattern: '{a} X', args: { a: lit({ type: 'hole', name: 'text1' }) } });
    const entry = entryOf(doc, 'count-or-all')!;
    return { doc: { ...doc, pages: doc.pages.map((page, at) => at === 2 ? { ...page, components: [text(makeUse(entry, { text1: 'Hi' }), 'one'), text({ type: 'format', pattern: '{x}-{y}', args: { x: makeUse(entry, { text1: 'A' }), y: makeUse(entry, { text1: 'B' }) } }, 'two')] } : page) } as CompositionDocument, entry };
  };
  it('counts a use once per field, names the node and the field', () => {
    const { doc } = build();
    const uses = usesOf(doc, 'count-or-all');
    expect(uses).toHaveLength(3);
    expect(uses.map(use => use.nodeId)).toEqual(['one', 'two', 'two']);
    expect(uses[0].field).toBe('Props');
    expect(useCount(doc, 'count-or-all')).toBe(3);
  });
  it('unlink writes the same logic the expansion gives, and compiles', () => {
    const { doc } = build();
    const [first] = usesOf(doc, 'count-or-all');
    const unlinked = unlinkUse(doc, first.path);
    expect(useCount(unlinked, 'count-or-all')).toBe(2);
    const expected = (expandLogic(doc).document as J).pages[2].components[0];
    expect((unlinked as any).pages[2].components[0]).toEqual(expected);
    expect(() => compileCompositionDocument(unlinked)).not.toThrow();
  });
  it('deleting keeps every use as plain logic; without unlink the draft is refused by the engine', () => {
    const { doc } = build();
    const gone = deleteEntry(doc, 'count-or-all');
    expect(gone.logicLibrary).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain('logic-ref');
    expect(() => compileCompositionDocument(gone)).not.toThrow();
    expect((gone as any).pages[2].components[1].props.value.value.args.x).toEqual((expandLogic(doc).document as J).pages[2].components[1].props.value.value.args.x);
    expect(() => compileCompositionDocument(deleteEntry(doc, 'count-or-all', false))).toThrow();
  });
  it('duplicates with its own id and name, and reports an Entity setting that names no source', () => {
    const { doc, entry } = build();
    const copy = duplicateEntry(doc, 'count-or-all');
    expect(entryOf(copy.document, copy.id)!.name).toBe('Count or All Copy');
    expect(freshName(copy.document, 'Count or All Copy')).toBe('Count or All Copy 2');
    const withEntity = addSetting(doc, 'count-or-all', 'entity', 'door-a').document;
    expect(useProblems(withEntity, { logicId: 'count-or-all', args: { text1: 'x', entity2: 'nope' } })).toEqual(['Entity']);
    expect(defaultArgs(entry)).toEqual({ text1: 'On' });
  });
});

describe('logic templates: Save as Logic Template', () => {
  it('lists reads and stated values, ticks become settings, and the use works out to the original', () => {
    const body = { type: 'choose', cases: [{ when: { type: 'state', sourceId: 'door-a', path: ['state'], in: ['on'] }, then: lit('Open') }], otherwise: lit('Closed') };
    const rows = extractRows(body, id => `Name of ${id}`);
    expect(rows.map(row => row.key)).toEqual(['entity:door-a', 'text:Open', 'text:Closed']);
    let doc = draft();
    const made = entryFromLogic(doc, 'value', 'Door Word', body, rows.slice(0, 2));
    doc = { ...doc, logicLibrary: [made.entry] };
    expect(made.entry.params.map(param => param.kind)).toEqual(['source-id', 'text']);
    const expanded = workedUse(doc, makeUse(made.entry, made.args));
    expect(expanded).toEqual(body);
    // The unticked text stays fixed in the body.
    expect(JSON.stringify(made.entry.body)).toContain('"Closed"');
    expect(JSON.stringify(made.entry.body)).not.toContain('"Open"');
  });
});

function workedUse(doc: CompositionDocument, use: unknown) { return (expandLogic({ ...doc, x: use } as any).document as J).x; }

describe('logic templates: the count-case starter (TL1 engine answer)', () => {
  const build = () => {
    let doc = addEntry(draft(), 'value', 'Open Doors').document;
    for (const _ of [1, 2, 3]) doc = addSetting(doc, 'open-doors', 'entity', 'door-a').document;
    const names = entryOf(doc, 'open-doors')!.params.map(param => param.name);
    const count = howManyAre(names, ['on']);
    const rules = countCases(count);
    doc = setBody(doc, 'open-doors', { type: 'choose', cases: rules.cases, otherwise: rules.otherwise });
    return { doc, names };
  };
  it('compiles to math and choose only, with no capability beyond the rules and math ids', () => {
    const { doc } = build();
    const use = makeUse(entryOf(doc, 'open-doors')!, { entity1: 'door-a', entity2: 'door-b', entity3: 'door-c' });
    const withUse = { ...doc, pages: doc.pages.map((page, at) => at === 2 ? { ...page, components: [text(use)] } : page) } as CompositionDocument;
    let compiled: any; try { compiled = compileCompositionDocument(withUse); } catch (e: any) { throw new Error(JSON.stringify(e.issues)); }
    const plain = compileCompositionDocument(draft([text(workedUse(withUse, use))]));
    expect(compiled.capabilities).toEqual(plain.capabilities);
    const before = compileCompositionDocument(draft()).capabilities;
    // Only ids the grammar already has: the rules, the conditions they test and the math that adds the ones.
    expect(compiled.capabilities.filter((id: string) => !before.includes(id)).sort()).toEqual(['sh.conditions@1', 'sh.operands@1', 'sh.rules@1']);
    expect(JSON.stringify(workedUse(withUse, use))).not.toMatch(/hole|logic-ref/);
  });
  it('says None, the count, and the count for 0, 1 and several entities, driven by other entities', () => {
    const { doc } = build();
    const out = (states: Record<string, string>) => {
      const worked = workedUse(doc, makeUse(entryOf(doc, 'open-doors')!, { entity1: 'door-a', entity2: 'door-b', entity3: 'door-c' }));
      const result = evaluateOperand(worked, env(states));
      return result.status === 'value' ? result.value : result.status;
    };
    expect(out({ 'door-a': 'off', 'door-b': 'off', 'door-c': 'off' })).toBe('None');
    expect(out({ 'door-a': 'on', 'door-b': 'off', 'door-c': 'off' })).toBe('One');
    expect(out({ 'door-a': 'on', 'door-b': 'on', 'door-c': 'on' })).toBe('3');
  });
  it('one entity is a bare choose, not math', () => {
    expect(howManyAre(['x'], ['on'])).toMatchObject({ type: 'choose' });
    expect(howManyAre(['x', 'y'], ['on'])).toMatchObject({ type: 'math', op: 'add' });
  });
});
