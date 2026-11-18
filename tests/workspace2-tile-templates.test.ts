import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandDocument } from '../src/shared/composition/components';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { valueAt } from '../src/composition-editor';
import { pairingOf, pairSource } from '../src/workspace2/add/sources';
import { endOf } from '../src/workspace2/add/insert';
import { insertPlace } from '../src/workspace2/linked';
import { setArgument } from '../src/workspace2/params';
import { ConversionError, convertTiles } from '../src/workspace2/repeats/convertTiles';

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const PAGE = ['pages', 2, 'components'];

/** A page of three light tiles, each over its own light-group source, in the first-slice fixture. */
function fixture(): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  const names = ['Alpha', 'Beta', 'Gamma'];
  names.forEach((name, at) => document.dataSources.push({ id: `light-${at}`, kind: 'model', model: 'home-light@1', inputs: { entityId: lit(`light.demo_${name.toLowerCase()}`), memberEntityIds: [lit(`light.demo_${name.toLowerCase()}_one`)] } }));
  document.pages[2].components = [{
    id: 'grid', title: 'Grid', layout: { span: 1 }, type: 'tile-grid',
    props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' },
    children: names.map((name, at) => ({ id: `tile-${at}`, title: `${name} Lights`, layout: { span: 1 }, type: 'light-group-tile', props: { sourceId: `light-${at}` } })),
  }];
  return document as CompositionDocument;
}
const labels = { title: 'Name', 'props/sourceId': 'Light' };
const worked = (document: CompositionDocument) => { const { componentLibrary: _, ...rest } = expandDocument(compileCompositionDocument(document).expanded); return canonicalCompositionJSON(rest); };
const tiles = ['tile-0', 'tile-1', 'tile-2'];

describe('convertTiles', () => {
  it('makes one template of the tiles and every tile draws as it did', () => {
    const before = fixture();
    const saved = convertTiles(before, { name: 'Light Tile', nodeIds: tiles, labels });
    const entry = saved.document.componentLibrary![0];
    expect(entry.params?.map(param => [param.label, param.kind])).toEqual([['Name', 'text'], ['Light', 'source-id']]);
    expect(saved.places).toBe(3);
    expect(worked(saved.document)).toBe(worked(before));
  });

  it('keeps each tile\'s id so a selection or a link carries over', () => {
    const saved = convertTiles(fixture(), { name: 'Light Tile', nodeIds: tiles, labels });
    expect((valueAt(saved.document, [...PAGE, 0, 'children', 1]) as J)).toMatchObject({ id: 'tile-1', type: 'component-ref', args: { light: 'light-1' } });
  });

  it('refuses a setting it has no label for, an id it cannot find and a tile that would have to stay as it is', () => {
    expect(() => convertTiles(fixture(), { name: 'Light Tile', nodeIds: tiles, labels: { title: 'Name' } })).toThrow(ConversionError);
    expect(() => convertTiles(fixture(), { name: 'Light Tile', nodeIds: [...tiles, 'missing'], labels })).toThrow('Found 3 of the 4');
    const odd = fixture();
    (valueAt(odd, [...PAGE, 0, 'children', 2]) as J).props.extra = true;
    expect(() => convertTiles(odd, { name: 'Light Tile', nodeIds: tiles, labels })).toThrow('would stay as they are');
  });
});

describe('the pairing step for a Source setting', () => {
  const made = () => { const saved = convertTiles(fixture(), { name: 'Light Tile', nodeIds: tiles, labels }); return { document: saved.document, entry: saved.document.componentLibrary![0] }; };

  it('pairs a source setting whose default source reads one entity, and no other setting', () => {
    const { document, entry } = made();
    expect(pairingOf(document, entry, 'light')).toEqual({ model: 'home-light@1', domains: ['light', 'switch', 'input_boolean'] });
    expect(pairingOf(document, entry, 'name')).toBeUndefined();
    expect(pairingOf(document, entry, 'missing')).toBeUndefined();
  });

  it('makes a source when the entity has none, and the new place reads it', () => {
    const { document, entry } = made();
    const placed = insertPlace(document, entry.id, endOf(document, 'node:grid')!);
    const paired = pairSource(placed.document, entry, 'light', 'light.demo_delta');
    const source = paired.document.dataSources.find(item => item.id === paired.sourceId)!;
    expect(paired.document.dataSources.length).toBe(placed.document.dataSources.length + 1);
    expect(source).toMatchObject({ kind: 'model', model: 'home-light@1', inputs: { entityId: lit('light.demo_delta') } });
    expect((source as J).inputs.memberEntityIds).toBeUndefined();
    const refPath = [...PAGE, 0, 'children', 3];
    const next = setArgument(paired.document, refPath, 'light', paired.sourceId);
    const tile = expandDocument(compileCompositionDocument(next).expanded).pages[2].components[0] as J;
    expect(tile.children.at(-1).props.sourceId).toBe(paired.sourceId);
  });

  it('reuses the source an entity already has, group members and all', () => {
    const { document, entry } = made();
    const paired = pairSource(document, entry, 'light', 'light.demo_beta');
    expect(paired.sourceId).toBe('light-1');
    expect(paired.document).toBe(document);
  });

  it('refuses a setting that is not paired', () => {
    const { document, entry } = made();
    expect(() => pairSource(document, entry, 'name', 'light.demo_delta')).toThrow('not paired');
  });

  it('gives a second place for the same new entity the first one\'s source', () => {
    const { document, entry } = made();
    const first = pairSource(document, entry, 'light', 'light.demo_delta');
    const second = pairSource(first.document, entry, 'light', 'light.demo_delta');
    expect(second.sourceId).toBe(first.sourceId);
    expect(second.document).toBe(first.document);
  });
});
