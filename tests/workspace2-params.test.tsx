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
  addParameter, bindableFields, bindingWords, defaultOf, labelValid, nameProblem, paramLabel, perPlaceParam, perPlaceTarget, removeParameter, sameEverywhere, setArgument, setParamLabel, setPerPlace, suggestName,
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

describe('marking a field as a parameter', () => {
  it('lists the fields of one node a parameter may fill, with their kinds', () => {
    const { document } = twoPlaces();
    const entry = document.componentLibrary![0];
    const found = bindableFields(entry.node, entry);
    expect(found.map(item => [item.field, item.kind])).toEqual(expect.arrayContaining([['title', 'text'], ['icon/name', 'symbol'], ['action/pageId', 'page-id'], ['props/subtitle/value', 'text']]));
    expect(found.find(item => item.field === 'icon/name')!.label).toBe('Icon');
  });

  it('adds the parameter and its binding, and gives every place the field\'s value, so the document still compiles', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const next = addParameter(document, entryId, bodyId, 'action/pageId', 'target_page');
    const entry = next.componentLibrary![0];
    expect(entry.params).toEqual([{ name: 'target_page', kind: 'page-id' }]);
    expect(entry.bindings).toEqual([{ param: 'target_page', nodeId: bodyId, field: 'action/pageId' }]);
    expect(componentReferences(next).map(use => use.ref.args)).toEqual([{ target_page: 'page-lattice' }, { target_page: 'page-lattice' }]);
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('a place\'s own value reaches the expanded node and no other place', () => {
    const { document, entryId, bodyId } = twoPlaces();
    let next = addParameter(document, entryId, bodyId, 'title', 'label');
    const use = componentReferences(next)[1];
    next = setArgument(next, use.path, 'label', 'Back Door');
    const titles = expandDocument(next).pages[2].components.map(node => (node as J).title);
    expect(titles).toEqual(['Door Tile', 'Back Door']);
    expect(() => compileCompositionDocument(next)).not.toThrow();
  });

  it('refuses a bad or clashing name, a field of the wrong kind and a seventeenth parameter', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const one = addParameter(document, entryId, bodyId, 'title', 'label');
    const entry = one.componentLibrary![0];
    expect(nameProblem(entry, 'has space', 'text')).toMatch(/letters, numbers/);
    expect(nameProblem(entry, 'label', 'page-id')).toMatch(/already holds a text/);
    expect(nameProblem(entry, 'label', 'text')).toBeUndefined();
    expect(() => addParameter(one, entryId, bodyId, 'title', 'other')).toThrow(/already a parameter/);
    expect(() => addParameter(one, entryId, bodyId, 'type', 'kind')).toThrow(/cannot be a parameter/);
    const full = { ...entry, params: Array.from({ length: 16 }, (_, at) => ({ name: `p${at}`, kind: 'text' as const })) };
    expect(nameProblem(full, 'seventeenth', 'text')).toMatch(/16 parameters/);
  });

  it('a name an existing parameter has fills one more field and leaves the places\' values alone', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const one = addParameter(document, entryId, bodyId, 'title', 'words');
    const set = setArgument(one, componentReferences(one)[0].path, 'words', 'Front');
    const two = addParameter(set, entryId, bodyId, 'props/subtitle/value', 'words');
    expect(two.componentLibrary![0].params).toHaveLength(1);
    expect(two.componentLibrary![0].bindings).toHaveLength(2);
    expect(componentReferences(two)[0].ref.args).toEqual({ words: 'Front' });
    expect(bindingWords(two.componentLibrary![0], 'words')).toBe('Title of Door Tile and 1 more');
  });

  it('removes the parameter, its bindings and each place\'s value, and the document compiles', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const added = addParameter(document, entryId, bodyId, 'title', 'label');
    const removed = removeParameter(added, entryId, 'label');
    expect(removed.componentLibrary![0].params).toBeUndefined();
    expect(removed.componentLibrary![0].bindings).toBeUndefined();
    expect(componentReferences(removed).every(use => use.ref.args === undefined)).toBe(true);
    expect(() => compileCompositionDocument(removed)).not.toThrow();
  });

  it('suggests a free name from the field\'s label', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const entry = document.componentLibrary![0];
    const title = bindableFields(entry.node, entry).find(item => item.field === 'title')!;
    expect(suggestName(entry, title)).toBe('title');
    const next = addParameter(document, entryId, bodyId, 'title', 'title');
    expect(suggestName(next.componentLibrary![0], title)).toBe('title_2');
  });

  it('Save as New keeps the other places as they were when the change added a parameter', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const first = componentReferences(document)[0].ref.id;
    const next = addParameter(document, entryId, bodyId, 'title', 'label');
    const [, result] = settleHeld(document, next, first, { kind: 'new', name: 'Door Tile Two' });
    const uses = componentReferences(result);
    expect(uses.find(use => use.ref.id === second)!.ref.args).toBeUndefined();
    expect(uses.find(use => use.ref.id === first)!.ref.args).toEqual({ label: 'Door Tile' });
    expect(() => compileCompositionDocument(result)).not.toThrow();
  });
});

describe('the parameter rows in the inspector', () => {
  function mount(document: CompositionDocument, key: string, mode: 'edit' | 'use' = 'edit') {
    const index = buildDocumentIndex(document);
    const entry = index.get(key as never)!;
    const apply = vi.fn(), onError = vi.fn();
    const ws = { mode, studio: { apply } } as never;
    const component = document.componentLibrary!.find(item => item.id === entry.component)!;
    // What the inspector composes for a place's root: the settings, then (in Edit) the parameters inside the template row.
    const view = render(<RowsProvider value={{ document, onChange: apply, onError, problems: new Map() }}>
      {entry.bodyPath && component.params?.length ? <TemplateSettings ws={ws} document={document} component={component} refPath={entry.path} onError={onError}/> : null}
      {mode === 'edit' && <TemplateParameters ws={ws} document={document} component={component} entry={entry} onError={onError}/>}
    </RowsProvider>);
    return { apply, onError, view };
  }

  it('shows nothing for a component with no parameter until the author may add one', () => {
    const { document, second } = twoPlaces();
    mount(document, `node:${second}`);
    expect(screen.queryByTestId('component-settings')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Parameter…' })).toBeTruthy();
  });

  it('shows a row for each parameter at a place, edits its own value, and nothing else', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = addParameter(addParameter(document, entryId, bodyId, 'title', 'label'), entryId, bodyId, 'action/pageId', 'target_page');
    const { apply } = mount(withParam, `node:${second}`);
    const settings = screen.getByTestId('component-settings');
    expect(within(settings).getByRole('textbox', { name: 'Label' })).toBeTruthy();
    expect(within(settings).getByRole('button', { name: /Target page/ })).toBeTruthy();
    fireEvent.change(within(settings).getByRole('textbox', { name: 'Label' }), { target: { value: 'Side Door' } });
    expect(apply).toHaveBeenCalledTimes(1);
    const written = apply.mock.calls[0][0] as CompositionDocument;
    expect(componentReferences(written).find(use => use.ref.id === second)!.ref.args!.label).toBe('Side Door');
    expect(written.componentLibrary).toBe(withParam.componentLibrary);
  });

  it('adds a parameter through the form: Field, Name, Add', () => {
    const { document, second } = twoPlaces();
    const { apply } = mount(document, `node:${second}`);
    fireEvent.click(screen.getByRole('button', { name: 'Add Parameter…' }));
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'action/pageId' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'go_to' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const written = apply.mock.calls[0][0] as CompositionDocument;
    expect(written.componentLibrary![0].params).toEqual([{ name: 'go_to', kind: 'page-id' }]);
  });

  it('says why a name does not work and keeps Add off', () => {
    const { document, second } = twoPlaces();
    mount(document, `node:${second}`);
    fireEvent.click(screen.getByRole('button', { name: 'Add Parameter…' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'no good' } });
    expect(screen.getByRole('alert').textContent).toMatch(/letters, numbers/);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the parameters with where they are, and Remove writes the removal', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = addParameter(document, entryId, bodyId, 'title', 'label');
    const { apply } = mount(withParam, `node:${second}`);
    const list = screen.getByTestId('component-parameters');
    expect(list.textContent).toContain('Label');
    // A row opens in place to its label, what it fills, and Remove Parameter.
    fireEvent.click(within(list).getByRole('button', { name: /Label/ }));
    expect(list.textContent).toContain('Fills Title of Door Tile');
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Parameter' }));
    expect((apply.mock.calls[0][0] as CompositionDocument).componentLibrary![0].params).toBeUndefined();
  });

  it('shows the author nothing in Use, and the settings still show', () => {
    const { document, entryId, bodyId, second } = twoPlaces();
    const withParam = addParameter(document, entryId, bodyId, 'title', 'label');
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
  it('finds the entity field of a tile and nothing for a field of another kind', () => {
    const { document, entryId } = lampTemplate();
    const entry = document.componentLibrary![0], first = entry.node.type === 'section' ? (entry.node as J).children[0] : undefined;
    expect(perPlaceTarget(document, entry, first as never, FIELD)).toMatchObject({ kind: 'entity-id', label: 'Entity', value: 'switch.demo_lamp' });
    expect(perPlaceTarget(document, entry, first as never, 'title')).toBeUndefined();
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
    expect(() => setPerPlace(document, entryId, first.id, 'title')).toThrow(/cannot be set per place/);
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
    expect(() => setPerPlace(full, entryId, first.id, FIELD)).toThrow('A template holds 16 parameters.');
  });

  it('an entity a tile reads through a source becomes a setting the template owns a copy of', () => {
    const doc = compileCompositionDocument(structuredClone(homeDomains.document)).document;
    const key = 'node:hc-open-contact-0' as never;
    const found = buildDocumentIndex(doc).get(key)!;
    const sourceId = (found.node as J).binding.sourceId as string;
    const entity = (doc.dataSources.find(source => source.id === sourceId) as J).entityId.value as string;
    const saved = saveAsComponent(doc, found.path, 'Window Card');
    const entry = saved.document.componentLibrary![0];
    const target = perPlaceTarget(saved.document, entry, entry.node, 'binding/sourceId');
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
    const withParam = addParameter(document, entryId, bodyId, 'title', 'label');
    const named = setParamLabel(withParam, entryId, 'label', '  Door Name ');
    expect(named.componentLibrary![0].params).toEqual([{ name: 'label', kind: 'text', label: 'Door Name' }]);
    expect(() => compileCompositionDocument(named)).not.toThrow();
    expect(setParamLabel(named, entryId, 'label', '').componentLibrary![0].params).toEqual([{ name: 'label', kind: 'text' }]);
  });

  it('holds a label to the contract: 80 characters, nothing a control or format character', () => {
    const { document, entryId, bodyId } = twoPlaces();
    const withParam = addParameter(document, entryId, bodyId, 'title', 'label');
    expect(labelValid('x'.repeat(80))).toBe(true);
    expect(labelValid('x'.repeat(81))).toBe(false);
    expect(labelValid('a​b')).toBe(false);
    expect(() => setParamLabel(withParam, entryId, 'label', 'x'.repeat(81))).toThrow(/1 to 80/);
  });
});
