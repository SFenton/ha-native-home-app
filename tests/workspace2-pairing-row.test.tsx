// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentIndex } from '../src/preview2/model';
import type { ComponentEntry, CompositionDocument } from '../src/shared/composition/schema';
import { TemplateSettings } from '../src/workspace2/ComponentParams';
import { pairingOf, pairSource } from '../src/workspace2/add/sources';
import { RowsProvider } from '../src/workspace2/rows';
import { WorkspaceDataProvider } from '../src/workspace2/pickers/WorkspaceData';
import { convertTiles } from '../src/workspace2/repeats/convertTiles';

afterEach(cleanup);
type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });

/** A page of two light tiles over their own sources, made into a Light Tile template. */
function lightTiles(): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  ['one', 'two'].forEach(name => document.dataSources.push({ id: `light-${name}`, kind: 'model', model: 'home-light@1', inputs: { entityId: lit(`light.demo_${name}`) } }));
  document.pages[2].components = ['one', 'two'].map(name => ({ id: `tile-${name}`, title: `Light ${name}`, layout: { span: 1 }, type: 'light-group-tile', props: { sourceId: `light-${name}` } }));
  return convertTiles(document as CompositionDocument, { name: 'Light Tile', nodeIds: ['tile-one', 'tile-two'], labels: { title: 'Name', 'props/sourceId': 'Light' } }).document;
}

describe('the Entity row of a place', () => {
  it('shows an Entity row for the Source setting, with the entity its source reads, and a Name row; no data source list', () => {
    const document = lightTiles();
    const entry = buildDocumentIndex(document).get('node:tile-two' as never)!;
    const component = document.componentLibrary![0];
    render(<RowsProvider value={{ document, onChange: vi.fn(), onError: vi.fn(), problems: new Map() }}>
      <TemplateSettings ws={{ mode: 'edit', studio: { apply: vi.fn() }, linked: { say: vi.fn() } } as never} document={document} component={component} refPath={entry.path} onError={vi.fn()}/>
    </RowsProvider>);
    const settings = screen.getByTestId('component-settings');
    const row = within(settings).getByRole('button', { name: 'Entity' });
    expect(row.textContent).toContain('light.demo_two');
    expect(within(settings).queryByRole('button', { name: /Data source/ })).toBeNull();
    expect(within(settings).getByRole('textbox', { name: 'Name' })).toBeTruthy();
  });
});

function mount(document: CompositionDocument, component: ComponentEntry, tile: string) {
  const entry = buildDocumentIndex(document).get(`node:${tile}` as never)!;
  const apply = vi.fn(), onError = vi.fn();
  render(<WorkspaceDataProvider document={document} house={{} as never}><RowsProvider value={{ document, onChange: apply, onError, problems: new Map() }}>
    <TemplateSettings ws={{ mode: 'edit', studio: { apply }, linked: { say: vi.fn() } } as never} document={document} component={component} refPath={entry.path} onError={onError}/>
  </RowsProvider></WorkspaceDataProvider>);
  return { apply, onError };
}

describe('picking an entity in the Entity row', () => {
  it('makes the source and writes the setting in one apply (one undo step)', () => {
    const document = lightTiles();
    const { apply } = mount(document, document.componentLibrary![0], 'tile-two');
    fireEvent.click(screen.getByRole('button', { name: 'Entity' }));
    const search = screen.getByRole('searchbox', { name: 'Search entities' });
    fireEvent.change(search, { target: { value: 'light.demo_new' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(apply).toHaveBeenCalledTimes(1);
    const written = apply.mock.calls[0][0] as CompositionDocument;
    const made = written.dataSources.find(source => (source as J).inputs?.entityId?.value === 'light.demo_new') as J;
    expect(made).toMatchObject({ kind: 'model', model: 'home-light@1' });
    const place = (written.pages[2].components as J[]).find(node => node.id === 'tile-two') as J;
    expect(place.args.light).toBe(made.id);
    // The other place and the template are untouched.
    expect((written.pages[2].components as J[]).find(node => node.id === 'tile-one')).toEqual((document.pages[2].components as J[]).find(node => node.id === 'tile-one'));
    expect(written.componentLibrary).toEqual(document.componentLibrary);
  });

  it('names the rows "<label> Entity" and the pickers "Entity for <label>" when a template has two paired settings', () => {
    const document = lightTiles();
    const base = document.componentLibrary![0];
    const component: ComponentEntry = { ...base, params: [...base.params!, { name: 'status', kind: 'source-id', label: 'Status' }], bindings: [...base.bindings!, { param: 'status', nodeId: base.node.id, field: 'props/sourceId' }] };
    mount({ ...document, componentLibrary: [component] }, component, 'tile-one');
    expect(screen.getByRole('button', { name: 'Light Entity' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Status Entity' }));
    expect(screen.getByRole('dialog', { name: 'Entity for Status' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entity' })).toBeNull();
  });

  it('presses the default entity\'s domain for a plain entity source, and the model\'s domains for a model', () => {
    const document = lightTiles();
    const base = document.componentLibrary![0];
    const plain: CompositionDocument = { ...document, dataSources: [...document.dataSources, { id: 'switch-a', kind: 'ha-entity', entityId: lit('switch.demo_other') } as never].map(source => source.id === 'light-one' ? { id: 'light-one', kind: 'ha-entity', entityId: lit('light.demo_one') } as never : source) };
    expect(pairingOf(plain, base, 'light')).toEqual({ model: undefined, domains: undefined });
    mount(plain, base, 'tile-one');
    fireEvent.click(screen.getByRole('button', { name: 'Entity' }));
    expect(screen.getByRole('button', { name: 'Light', pressed: true })).toBeTruthy();
  });
});

describe('what pairs', () => {
  const entryFor = (source: J): { document: CompositionDocument; entry: ComponentEntry } => {
    const document = lightTiles();
    const base = document.componentLibrary![0];
    return { document: { ...document, dataSources: [...document.dataSources, source as never] }, entry: { ...base, node: { ...base.node, props: { sourceId: source.id } } as never } };
  };

  it('leaves a camera as a choice among camera sources', () => {
    const { document, entry } = entryFor({ id: 'cam-a', kind: 'model', model: 'camera-stream@1', inputs: { entityId: lit('camera.demo_front') } });
    expect(pairingOf(document, entry, 'light')).toBeUndefined();
  });

  it('pairs a power switch with a power-toggle source, never a light', () => {
    const { document, entry } = entryFor({ id: 'power-a', kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_fan') } });
    expect(pairingOf(document, entry, 'light')?.domains).toEqual(['switch', 'input_boolean']);
    const paired = pairSource(document, entry, 'light', 'switch.demo_heater');
    expect(paired.document.dataSources.find(source => source.id === paired.sourceId)).toMatchObject({ kind: 'model', model: 'power-toggle@1', inputs: { entityId: lit('switch.demo_heater') } });
  });

  it('leaves a source that reads no single entity as a choice', () => {
    const { document, entry } = entryFor({ id: 'status-a', kind: 'model', model: 'home-status@1', inputs: {} });
    expect(pairingOf(document, entry, 'light')).toBeUndefined();
  });
});

