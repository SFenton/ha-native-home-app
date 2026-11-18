// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { valueAt } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { componentReferences, expandDocument } from '../src/shared/composition/components';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import { TemplateParameters, TemplateSettings } from '../src/workspace2/ComponentParams';
import { endOf } from '../src/workspace2/add/insert';
import { defaultArgs, insertPlace, ownStateField, saveAsComponent, settleHeld } from '../src/workspace2/linked';
import { previewSources } from '../src/preview2/component-library';
import { newStateTile } from '../src/shared/composition/state-style-library';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import {
  bindingWords, defaultOf, labelValid, nameProblem, paramLabel, perPlaceParam, removeParameter, resetValue, rowTarget, sameEverywhere, setArgument, setParamLabel, setPerPlace, setValue, shareable, suggestName, uniqueLabel,
} from '../src/workspace2/params';
import { replaceAt } from '../src/composition-editor';
import { RowsProvider } from '../src/workspace2/rows';

afterEach(cleanup);
type J = Record<string, any>;
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const tile = (id: string): J => ({
  id, title: 'Door Tile', type: 'navigation-tile', layout: { span: 1 }, icon: symbol('info.circle'), props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});

/** A component with two places (invented ids only). */
function twoPlaces() {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  base.pages[2].components = [tile('door')];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Door Tile');
  const entryId = saved.document.componentLibrary![0].id;
  const added = insertPlace(saved.document, entryId, endOf(saved.document, `page:${base.pages[2].id}`)!);
  return { document: added.document, entryId, bodyId: saved.document.componentLibrary![0].node.id, second: added.key.slice(5) };
}

describe('marking a field as a setting', () => {
  it('names the kind a row takes: the seven string kinds where the whole row is one string, a value for everything else', () => {
    const { document } = twoPlaces();
    const entry = document.componentLibrary![0];
    const target = (field: string) => rowTarget(document, entry, entry.node, field);
    expect(target('title')).toMatchObject({ kind: 'text', label: 'Title' });
    expect(target('icon/name')).toMatchObject({ kind: 'symbol', label: 'Icon' });
    expect(target('action/pageId')).toMatchObject({ kind: 'page-id' });
    expect(target('props/subtitle/value')).toMatchObject({ kind: 'text' });
    expect(target('props/subtitle')).toMatchObject({ kind: 'value', value: { type: 'literal', value: 'Open' } });
    expect(target('props/selected')).toMatchObject({ kind: 'value', value: 'navigation-path' });
    expect(target('props/family')).toMatchObject({ kind: 'value' });
    expect(target('action')).toMatchObject({ kind: 'value' });
  });

  it('refuses the rows that cannot be set: the id, the type, a root\'s width and a field whose object is missing', () => {
    const { document } = twoPlaces();
    const entry = document.componentLibrary![0];
    for (const field of ['id', 'type', 'children', 'layout/span', 'props/nowhere/deeper', '']) expect(rowTarget(document, entry, entry.node, field)).toBeUndefined();
    expect(rowTarget(document, entry, entry.node, 'layout')).toBeUndefined();
  });

  it('refuses a row inside or around a row that is already set, and offers the row itself', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const entry = set.componentLibrary![0];
    expect(rowTarget(set, entry, entry.node, 'props/subtitle/value')).toBeUndefined();
    expect(rowTarget(set, entry, entry.node, 'props')).toBeUndefined();
    expect(rowTarget(set, entry, entry.node, 'props/subtitle')).toMatchObject({ kind: 'value' });
    expect(() => setPerPlace(set, entryId, bodyId, 'props/subtitle/value')).toThrow(/cannot be set per place/);
  });

  it('adds the parameter and its binding, and gives every place the field\'s value, so the document still compiles', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const next = setPerPlace(document, entryId, bodyId, 'action/pageId');
    const entry = next.componentLibrary![0], name = entry.params![0].name;
    expect(entry.params).toEqual([{ name, kind: 'page-id', label: 'Page ID' }]);
    expect(entry.bindings).toEqual([{ param: name, nodeId: bodyId, field: 'action/pageId' }]);
    expect(componentReferences(next).map(use => use.ref.args)).toEqual([{ [name]: 'page-lattice' }, { [name]: 'page-lattice' }]);
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('a value setting gives the places nothing: they follow the template, and a place\'s own value is its own', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const next = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const entry = next.componentLibrary![0], name = entry.params![0].name;
    expect(entry.params).toEqual([{ name, kind: 'value', label: 'Subtitle' }]);
    expect(componentReferences(next).every(use => use.ref.args === undefined && use.ref.values === undefined)).toBe(true);
    const use = componentReferences(next).find(item => item.ref.id === second)!;
    const set = setValue(next, use.path, name, { type: 'literal', value: 'Side' });
    expect(componentReferences(set).find(item => item.ref.id === second)!.ref.values).toEqual({ [name]: { type: 'literal', value: 'Side' } });
    const subtitles = expandDocument(set).pages[2].components.map(node => (node as J).props.subtitle.value);
    expect(subtitles).toEqual(['Open', 'Side']);
    expect(() => compileCompositionDocument(set)).not.toThrow();
    // the template's value changed: a place with no value of its own follows it, one with its own does not
    const edited = replaceAt(set, ['componentLibrary', 0, 'node', 'props', 'subtitle', 'value'], 'Shelf');
    expect(expandDocument(edited).pages[2].components.map(node => (node as J).props.subtitle.value)).toEqual(['Shelf', 'Side']);
  });

  it('setValue drops a value equal to the template\'s, resetValue takes it away, and an empty values key goes with the last entry', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const next = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const name = next.componentLibrary![0].params![0].name;
    const path = componentReferences(next).find(item => item.ref.id === second)!.path;
    const own = setValue(next, path, name, { type: 'literal', value: 'Side' });
    expect(setValue(own, path, name, { type: 'literal', value: 'Open' })).toEqual(next);
    expect(resetValue(own, path, name)).toEqual(next);
    expect(resetValue(next, path, name)).toBe(next);
    expect(componentReferences(resetValue(own, path, name)).find(item => item.ref.id === second)!.ref).not.toHaveProperty('values');
  });

  it('setValue writes a source key that names this place\'s copy as the body\'s id, and null for a field the template lacks is no entry', () => {
    const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
    const rule = (sourceId: string) => ({ type: 'state', sourceId, path: ['state'], in: ['on'] });
    const body: J = { id: 'cmp', title: 'Note', type: 'text', layout: { span: 1 }, props: { value: { type: 'literal', value: 'Hi' }, style: 'body', unavailableText: 'None' }, visibleWhen: rule('state') };
    base.componentLibrary = [{ id: 'note', name: 'Note', node: body, params: [{ name: 'shown', kind: 'value' }, { name: 'lines', kind: 'value' }],
      sources: [{ id: 'state', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_lamp' } }],
      bindings: [{ param: 'shown', nodeId: 'cmp', field: 'visibleWhen' }, { param: 'lines', nodeId: 'cmp', field: 'props/lines' }] }];
    base.pages[2].components = [{ id: 'lamp-a', type: 'component-ref', componentId: 'note', layout: { span: 1 } }];
    const document = base as CompositionDocument, path = ['pages', 2, 'components', 0];
    const off = { ...rule('lamp-a~state'), in: ['off'] };
    const own = setValue(document, path, 'shown', off);
    expect(componentReferences(own)[0].ref.values).toEqual({ shown: { ...rule('state'), in: ['off'] } });
    expect(setValue(document, path, 'shown', rule('lamp-a~state'))).toEqual(document);
    expect(setValue(document, path, 'lines', null)).toEqual(document);
    expect(componentReferences(setValue(document, path, 'lines', 2))[0].ref.values).toEqual({ lines: 2 });
  });

  it('shares a value setting only between fields of one shape, and a string setting between fields of one kind', () => {
    const { document, entryId } = lampTemplate();
    const [first, second] = (document.componentLibrary![0].node as J).children as J[];
    const one = setPerPlace(document, entryId, first.id, 'props/subtitle');
    const entry = one.componentLibrary![0], name = entry.params![0].name;
    const target = (field: string, node: J) => rowTarget(one, entry, node as never, field)!;
    expect(shareable(one, entry, target('props/subtitle', second)).map(param => param.name)).toEqual([name]);
    expect(shareable(one, entry, target('props/progress', second)).map(param => param.name)).toEqual([]);
    const joined = setPerPlace(one, entryId, second.id, 'props/subtitle', name);
    expect(joined.componentLibrary![0].bindings).toHaveLength(2);
    expect(() => setPerPlace(one, entryId, second.id, 'props/progress', name)).toThrow(/another kind of value/);
  });

  it('labels a second setting of the same name "Title of Demo Fan", cut to 80 characters', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const entry = document.componentLibrary![0];
    expect(uniqueLabel(entry, 'Title', 'Demo Fan')).toBe('Title');
    const named = { ...entry, params: [{ name: 'title', kind: 'text' as const, label: 'Title' }] };
    expect(uniqueLabel(named, 'Title', 'Demo Fan')).toBe('Title of Demo Fan');
    expect(uniqueLabel(named, 'Title', 'x'.repeat(100))).toHaveLength(80);
    void entryId; void bodyId;
  });

  it('a place\'s own value reaches the expanded node and no other place', () => {
    const { document, entryId, bodyId } = twoPlaces();
    let next = setPerPlace(document, entryId, bodyId, 'title');
    const use = componentReferences(next)[1];
    next = setArgument(next, use.path, 'title', 'Back Door');
    const titles = expandDocument(next).pages[2].components.map(node => (node as J).title);
    expect(titles).toEqual(['Door Tile', 'Back Door']);
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('refuses a bad or clashing name, and a seventeenth setting', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const one = setPerPlace(document, entryId, bodyId, 'title');
    const entry = one.componentLibrary![0];
    expect(nameProblem(entry, 'has space', 'text')).toMatch(/letters, numbers/);
    expect(nameProblem(entry, 'title', 'page-id')).toMatch(/another kind of value/);
    expect(nameProblem(entry, 'title', 'text')).toBeUndefined();
    expect(() => setPerPlace(one, entryId, bodyId, 'type')).toThrow(/cannot be set per place/);
    const full = { ...entry, params: Array.from({ length: 16 }, (_, at) => ({ name: `p${at}`, kind: 'text' as const })) };
    expect(nameProblem(full, 'seventeenth', 'text')).toMatch(/16 settings/);
  });

  it('a name an existing setting has fills one more field and leaves the places\' values alone', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const one = setPerPlace(document, entryId, bodyId, 'title');
    const set = setArgument(one, componentReferences(one)[0].path, 'title', 'Front');
    const two = setPerPlace(set, entryId, bodyId, 'props/subtitle/value', 'title');
    expect(two.componentLibrary![0].params).toHaveLength(1);
    expect(two.componentLibrary![0].bindings).toHaveLength(2);
    expect(componentReferences(two)[0].ref.args).toEqual({ title: 'Front' });
    expect(bindingWords(two.componentLibrary![0], 'title')).toBe('Title of Door Tile and 1 more');
  });

  it('removes the setting, its bindings and each place\'s value (an argument or a value), and the document compiles', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const added = setPerPlace(setPerPlace(document, entryId, bodyId, 'title'), entryId, bodyId, 'props/subtitle');
    const name = added.componentLibrary![0].params!.find(param => param.kind === 'value')!.name;
    const own = setValue(added, componentReferences(added)[0].path, name, { type: 'literal', value: 'Side' });
    const removed = removeParameter(removeParameter(own, entryId, name), entryId, 'title');
    expect(removed.componentLibrary![0].params).toBeUndefined();
    expect(removed.componentLibrary![0].bindings).toBeUndefined();
    expect(componentReferences(removed).every(use => use.ref.args === undefined && use.ref.values === undefined)).toBe(true);
    expect(() => compileCompositionDocument(removed)).not.toThrow();
  });

  it('suggests a free name from the field\'s label', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const entry = document.componentLibrary![0];
    expect(suggestName(entry, { label: 'Title' })).toBe('title');
    const next = setPerPlace(document, entryId, bodyId, 'title');
    expect(suggestName(next.componentLibrary![0], { label: 'Title' })).toBe('title_2');
  });

  it('Save as New keeps the other places as they were when the change added a setting', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const first = componentReferences(document)[0].ref.id;
    const next = setPerPlace(document, entryId, bodyId, 'title');
    const [, result] = settleHeld(document, next, first, { kind: 'new', name: 'Door Tile Two' });
    const uses = componentReferences(result);
    expect(uses.find(use => use.ref.id === second)!.ref.args).toBeUndefined();
    expect(uses.find(use => use.ref.id === first)!.ref.args).toEqual({ title: 'Door Tile' });
    expect(() => compileCompositionDocument(result)).not.toThrow();
  });

  it('new places start with no value for a value setting, and Save as New keeps the other places\' own values', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const first = componentReferences(document)[0].ref.id;
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const name = set.componentLibrary![0].params![0].name;
    const own = setValue(set, componentReferences(set).find(use => use.ref.id === second)!.path, name, { type: 'literal', value: 'Side' });
    expect(defaultArgs(own.componentLibrary![0])).toBeUndefined();
    const retitled = setPerPlace(own, entryId, bodyId, 'title');
    const [, result] = settleHeld(own, retitled, first, { kind: 'new', name: 'Door Tile Two' });
    expect(componentReferences(result).find(use => use.ref.id === second)!.ref.values).toEqual({ [name]: { type: 'literal', value: 'Side' } });
  });
});

describe('the settings rows in the inspector', () => {
  function mount(document: CompositionDocument, key: string, mode: 'edit' | 'use' = 'edit') {
    const index = buildDocumentIndex(document);
    const entry = index.get(key as never)!;
    const apply = vi.fn(), onError = vi.fn();
    const ws = { mode, studio: { apply }, linked: { say: vi.fn() } } as never;
    const component = document.componentLibrary!.find(item => item.id === entry.component)!;
    // What the inspector composes for a place's root: the settings, then (in Edit) the list of what each place sets inside the template row.
    const view = render(<RowsProvider value={{ document, onChange: apply, onError, problems: new Map() }}>
      {entry.bodyPath && component.params?.length ? <TemplateSettings ws={ws} document={document} component={component} refPath={entry.path} onError={onError}/> : null}
      {mode === 'edit' && <TemplateParameters ws={ws} document={document} component={component} entry={entry} onError={onError}/>}
    </RowsProvider>);
    return { apply, onError, view };
  }

  it('shows nothing for a template with no setting', () => {
    const { document, second } = twoPlaces();
    mount(document, `node:${second}`);
    expect(screen.queryByTestId('component-settings')).toBeNull();
    expect(screen.queryByTestId('component-parameters')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Parameter…' })).toBeNull();
  });

  it('shows a row for each setting at a place, edits its own value, and nothing else', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = setPerPlace(setPerPlace(document, entryId, bodyId, 'title'), entryId, bodyId, 'action/pageId');
    const { apply } = mount(withParam, `node:${second}`);
    const settings = screen.getByTestId('component-settings');
    expect(within(settings).getByRole('textbox', { name: 'Title' })).toBeTruthy();
    expect(within(settings).getByRole('button', { name: /Page/ })).toBeTruthy();
    fireEvent.change(within(settings).getByRole('textbox', { name: 'Title' }), { target: { value: 'Side Door' } });
    expect(apply).toHaveBeenCalledTimes(1);
    const written = apply.mock.calls[0][0] as CompositionDocument;
    expect(componentReferences(written).find(use => use.ref.id === second)!.ref.args!.title).toBe('Side Door');
    expect(written.componentLibrary).toBe(withParam.componentLibrary);
  });

  it('draws a value setting with the field\'s own editor, writes the place\'s value, and offers Reset', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const name = set.componentLibrary![0].params![0].name;
    const { apply } = mount(set, `node:${second}`);
    const row = screen.getByTestId('place-value');
    expect(row.getAttribute('aria-label')).toBe('Subtitle');
    expect(screen.queryByText('Differs from the template.')).toBeNull();
    const box = within(row).getByRole('textbox') as HTMLInputElement;
    expect(box.value).toBe('Open');
    fireEvent.change(box, { target: { value: 'Side' } });
    fireEvent.blur(box);
    const written = apply.mock.calls.at(-1)![0] as CompositionDocument;
    expect(componentReferences(written).find(use => use.ref.id === second)!.ref.values).toEqual({ [name]: { type: 'literal', value: 'Side' } });
    expect(written.componentLibrary).toBe(set.componentLibrary);
  });

  it('says a value differs from the template, and Reset takes it away', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const set = setPerPlace(document, entryId, bodyId, 'props/subtitle');
    const name = set.componentLibrary![0].params![0].name;
    const own = setValue(set, componentReferences(set).find(use => use.ref.id === second)!.path, name, { type: 'literal', value: 'Side' });
    const { apply } = mount(own, `node:${second}`);
    expect(screen.getByText('Differs from the template.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the template’s Subtitle' }));
    const written = apply.mock.calls[0][0] as CompositionDocument;
    expect(componentReferences(written).find(use => use.ref.id === second)!.ref).not.toHaveProperty('values');
  });

  it('lists the settings with where they are, and Remove writes the removal', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = setPerPlace(document, entryId, bodyId, 'title');
    const { apply } = mount(withParam, `node:${second}`);
    const list = screen.getByTestId('component-parameters');
    expect(list.textContent).toContain('Each place sets (1)');
    expect(list.textContent).toContain('Text · Title of Door Tile');
    // A row opens in place to its label, what it fills, and Remove Setting.
    fireEvent.click(within(list).getByRole('button', { name: /Title/ }));
    expect(list.textContent).toContain('Fills Title of Door Tile');
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Setting' }));
    expect((apply.mock.calls[0][0] as CompositionDocument).componentLibrary![0].params).toBeUndefined();
  });

  it('shows a value setting without its kind word', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    mount(setPerPlace(document, entryId, bodyId, 'props/subtitle'), `node:${second}`);
    expect(screen.getByTestId('component-parameters').textContent).toContain('Subtitle');
    expect(screen.getByTestId('component-parameters').textContent).not.toContain(' · ');
  });

  it('shows the author nothing in Use, and the settings still show', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = setPerPlace(document, entryId, bodyId, 'title');
    mount(withParam, `node:${second}`, 'use');
    expect(screen.queryByTestId('component-parameters')).toBeNull();
    expect(screen.getByTestId('component-settings')).toBeTruthy();
    expect(valueAt(withParam, ['componentLibrary', 0, 'params']) ).toBeTruthy();
  });
});

// MARK: - Templates: Set Per Place, parameter labels (templates spec 3b-B)

/** A template of two state tiles in a section (invented entities), with two places. */
function lampTemplate() {
  const base: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  const lamp = (id: string, entity: string): J => ({ ...newStateTile(entity, id, undefined, undefined)!, id });
  base.pages[2].components = [{
    id: 'demo-row', title: 'Demo Row', type: 'section', layout: { span: 1 },
    props: { header: 'S', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } },
    children: [lamp('demo-first', 'switch.demo_lamp'), lamp('demo-second', 'switch.demo_lamp')],
  }];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Lamp Row');
  const entryId = saved.document.componentLibrary![0].id;
  const added = insertPlace(saved.document, entryId, endOf(saved.document, `page:${base.pages[2].id}`)!);
  return { document: added.document, entryId, second: added.key.slice(5) };
}
const FIELD = 'binding/entityId';

describe('Set Per Place', () => {
  it('finds the entity field of a tile, and the title as a text setting', () => {
    const { document, entryId } = lampTemplate();
    const entry = document.componentLibrary![0], first = entry.node.type === 'section' ? (entry.node as J).children[0] : undefined;
    expect(rowTarget(document, entry, first as never, FIELD)).toMatchObject({ kind: 'entity-id', label: 'Entity', value: 'switch.demo_lamp' });
    expect(rowTarget(document, entry, first as never, 'title')).toMatchObject({ kind: 'text' });
    expect(entryId).toBe(entry.id);
  });

  it('adds a parameter named by suggestName and labelled with the field, and every place keeps its entity', () => {
    const { document, entryId } = lampTemplate();
    const entry = document.componentLibrary![0], first = (entry.node as J).children[0] as J;
    const next = setPerPlace(document, entryId, first.id, FIELD);
    const written = next.componentLibrary![0];
    expect(written.params).toEqual([{ name: 'entity', kind: 'entity-id', label: 'Entity' }]);
    expect(written.bindings).toEqual([{ param: 'entity', nodeId: first.id, field: FIELD }]);
    expect(componentReferences(next).map(use => use.ref.args)).toEqual([{ entity: 'switch.demo_lamp' }, { entity: 'switch.demo_lamp' }]);
    expect(() => compileCompositionDocument(next)).not.toThrow();
    expect(perPlaceParam(next, written, first as never, FIELD)?.name).toBe('entity');
  });

  it('a place\'s own entity reaches its expansion and not the other place', () => {
    const { document, entryId } = lampTemplate();
    const first = (document.componentLibrary![0].node as J).children[0] as J;
    let next = setPerPlace(document, entryId, first.id, FIELD);
    next = setArgument(next, componentReferences(next)[1].path, 'entity', 'switch.demo_fan');
    const [one, two] = expandDocument(next).pages[2].components as J[];
    expect(one.children[0].binding.entityId).toBe('switch.demo_lamp');
    expect(two.children[0].binding.entityId).toBe('switch.demo_fan');
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('Use fills a second field from the same setting, so one entity fills both', () => {
    const { document, entryId } = lampTemplate();
    const [first, second] = (document.componentLibrary![0].node as J).children as J[];
    const next = setPerPlace(setPerPlace(document, entryId, first.id, FIELD), entryId, second.id, FIELD, 'entity');
    const entry = next.componentLibrary![0];
    expect(entry.params).toHaveLength(1);
    expect(entry.bindings).toHaveLength(2);
    expect(bindingWords(entry, 'entity')).toBe(`Entity of ${first.title} and 1 more`);
    const use = componentReferences(next)[1];
    const changed = setArgument(next, use.path, 'entity', 'switch.demo_fan');
    const tiles = (expandDocument(changed).pages[2].components[1] as J).children;
    expect(tiles.map((tile: J) => tile.binding.entityId)).toEqual(['switch.demo_fan', 'switch.demo_fan']);
  });

  it('New Setting makes a second parameter with its own name', () => {
    const { document, entryId } = lampTemplate();
    const [first, second] = (document.componentLibrary![0].node as J).children as J[];
    const next = setPerPlace(setPerPlace(document, entryId, first.id, FIELD), entryId, second.id, FIELD);
    expect(next.componentLibrary![0].params!.map(param => param.name)).toEqual(['entity', 'entity_2']);
  });

  it('refuses a join of another kind, a field that cannot be set, and a name that is not a setting', () => {
    const { document, entryId } = lampTemplate();
    const first = (document.componentLibrary![0].node as J).children[0] as J;
    expect(() => setPerPlace(document, entryId, first.id, 'type')).toThrow(/cannot be set per place/);
    expect(() => setPerPlace(document, entryId, first.id, FIELD, 'missing')).toThrow(/another kind/);
  });

  it('Same Everywhere removes the setting and each place\'s value, and leaves the body as it was', () => {
    const { document, entryId } = lampTemplate();
    const first = (document.componentLibrary![0].node as J).children[0] as J;
    const set = setPerPlace(document, entryId, first.id, FIELD);
    const back = sameEverywhere(set, entryId, first.id, FIELD);
    expect(back.componentLibrary![0].params).toBeUndefined();
    expect(back.componentLibrary![0].bindings).toBeUndefined();
    expect(componentReferences(back).map(use => use.ref.args)).toEqual([undefined, undefined]);
    expect(back.componentLibrary![0].node).toBe(document.componentLibrary![0].node);
    expect(() => sameEverywhere(back, entryId, first.id, FIELD)).toThrow(/not set per place/);
  });

  it('Same Everywhere on one of two fields keeps the setting for the other', () => {
    const { document, entryId } = lampTemplate();
    const [first, second] = (document.componentLibrary![0].node as J).children as J[];
    const both = setPerPlace(setPerPlace(document, entryId, first.id, FIELD), entryId, second.id, FIELD, 'entity');
    const one = sameEverywhere(both, entryId, first.id, FIELD);
    expect(one.componentLibrary![0].bindings).toEqual([{ param: 'entity', nodeId: second.id, field: FIELD }]);
    expect(componentReferences(one)[0].ref.args).toEqual({ entity: 'switch.demo_lamp' });
  });

  it('refuses a seventeenth setting, and says the limit in the template\'s words', () => {
    const { document, entryId } = lampTemplate();
    const first = (document.componentLibrary![0].node as J).children[0] as J;
    const full = replaceAt(document, ['componentLibrary', 0, 'params'], Array.from({ length: 16 }, (_, at) => ({ name: `text_${at}`, kind: 'text' })));
    expect(() => setPerPlace(full, entryId, first.id, FIELD)).toThrow('A template holds 16 settings.');
  });

  it('an entity a tile reads through a source becomes a setting the template owns a copy of', () => {
    const doc = compileCompositionDocument(structuredClone(homeDomains.document)).document;
    const key = 'node:hc-open-contact-0' as never;
    const found = buildDocumentIndex(doc).get(key)!;
    const sourceId = (found.node as J).binding.sourceId as string;
    const entity = (doc.dataSources.find(source => source.id === sourceId) as J).entityId.value as string;
    const saved = saveAsComponent(doc, found.path, 'Window Card');
    const entry = saved.document.componentLibrary![0];
    const target = rowTarget(saved.document, entry, entry.node, 'binding/sourceId');
    expect(target).toMatchObject({ kind: 'entity-id', value: entity, binding: { sourceId, field: 'entityId/value' }, adopt: { sourceId } });
    const next = setPerPlace(saved.document, entry.id, entry.node.id, 'binding/sourceId');
    const written = next.componentLibrary![0];
    expect(written.sources).toEqual([{ id: sourceId, kind: 'ha-entity', entityId: { type: 'literal', value: entity } }]);
    expect(written.bindings).toEqual([{ param: 'entity', sourceId, field: 'entityId/value' }]);
    expect(perPlaceParam(next, written, written.node, 'binding/sourceId')?.name).toBe('entity');
    expect(bindingWords(written, 'entity')).toBe('Entity of Demo Window');
    expect(defaultArgs(written)).toEqual({ entity });
    const second = insertPlace(next, entry.id, endOf(next, `page:${doc.pages[0].id}`)!);
    const use = componentReferences(second.document).find(item => item.ref.id === second.key.slice(5))!;
    const other = 'binary_sensor.demo_other';
    const changed = setArgument(second.document, use.path, 'entity', other);
    const copies = expandDocument(changed).dataSources.filter(source => source.id.includes('~')).map(source => (source as J).entityId.value);
    expect([...copies].sort()).toEqual([entity, other].sort());
    // the preview reads the same copies the app does, and the very same array when no template owns a source
    expect(previewSources(changed).filter(source => source.id.includes('~')).map(source => (source as J).entityId.value).sort()).toEqual([entity, other].sort());
    expect(previewSources(changed).slice(0, changed.dataSources.length)).toEqual(changed.dataSources);
    expect(previewSources(doc)).toBe(doc.dataSources);
    expect(() => compileCompositionDocument(changed)).not.toThrow();
    // taking it back leaves the copy in the template, with nothing filling it
    const back = sameEverywhere(changed, entry.id, entry.node.id, 'binding/sourceId');
    expect(back.componentLibrary![0].params).toBeUndefined();
    expect(() => compileCompositionDocument(back)).not.toThrow();
  });
});

describe('a state setting', () => {
  it('a place added later gets a field of its own, and the document still compiles', () => {
    const doc = compileCompositionDocument(structuredClone(homeDomains.document)).document;
    const index = buildDocumentIndex(doc);
    const tabs = index.get('node:hc-climate-tabs' as never)!;
    const saved = saveAsComponent(doc, tabs.path, 'Demo Tabs');
    const entry = saved.document.componentLibrary![0];
    const page = saved.document.pages[0];
    const set = setPerPlace(saved.document, entry.id, entry.node.id, 'props/stateId');
    expect(set.componentLibrary![0].params).toEqual([{ name: 'state', kind: 'state-id', label: 'State' }]);
    const before = set.localState!.length;
    const added = insertPlace(set, entry.id, endOf(set, `page:${page.id}`)!);
    expect(added.document.localState!.length).toBe(before + 1);
    const own = componentReferences(added.document).find(use => use.ref.id === added.key.slice(5))!.ref.args!.state;
    expect(own).not.toBe(defaultOf(added.document.componentLibrary![0], 'state'));
    expect(added.document.localState!.find(field => field.id === own)).toMatchObject({ type: 'choice' });
    expect(() => compileCompositionDocument(added.document)).not.toThrow();
  });

  it('ownStateField names the copy after the field and counts up from 2', () => {
    const state = [{ id: 'bed_tab', type: 'choice', initial: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }, { id: 'bed_tab_2', type: 'choice', initial: 'a', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] as never;
    expect(ownStateField({ localState: state }, 'bed_tab_2')!.id).toBe('bed_tab_3');
    expect(ownStateField({ localState: state }, 'missing')).toBeUndefined();
  });
});

describe('parameter labels', () => {
  it('shows the label when there is one and the name in words when there is not', () => {
    expect(paramLabel({ name: 'turns_on' })).toBe('Turns on');
    expect(paramLabel({ name: 'turns_on', label: 'Light' })).toBe('Light');
  });

  it('sets, changes and clears a label, and the document compiles with it', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const withParam = setPerPlace(document, entryId, bodyId, 'title');
    const named = setParamLabel(withParam, entryId, 'title', '  Door Name ');
    expect(named.componentLibrary![0].params).toEqual([{ name: 'title', kind: 'text', label: 'Door Name' }]);
    expect(() => compileCompositionDocument(named)).not.toThrow();
    expect(setParamLabel(named, entryId, 'title', '').componentLibrary![0].params).toEqual([{ name: 'title', kind: 'text' }]);
  });

  it('holds a label to the contract: 80 characters, nothing a control or format character', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const withParam = setPerPlace(document, entryId, bodyId, 'title');
    expect(labelValid('x'.repeat(80))).toBe(true);
    expect(labelValid('x'.repeat(81))).toBe(false);
    expect(labelValid('a​b')).toBe(false);
    expect(() => setParamLabel(withParam, entryId, 'title', 'x'.repeat(81))).toThrow(/1 to 80/);
  });
});
