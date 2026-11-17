import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors } from '../src/composition-editor';
import { NO_STYLE_FITS, tileChoices, tileTypes, typeForEntity } from '../src/workspace2/add/catalog';
import { after, canHold, endOf, insertEntity, insertMade, insertType, type Destination } from '../src/workspace2/add/insert';
import { newStateTile } from '../src/shared/composition/state-style-library';
import { builtInStyle } from '../src/shared/composition/state-styles';
import { buildDocumentIndex } from '../src/preview2/model';

const fixture = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const doc = fixture.document;
const index = buildDocumentIndex(doc);
const first = (type: string) => [...index.entries.values()].find(entry => entry.node?.type === type)!;
const containers = [['page', 'page:page-home'], ['grid', first('tile-grid').key], ['section', first('section').key], ['rail', first('status-rail').key]] as const;
const probe = (type: (typeof tileTypes)[number]) => type.domains ? { entityId: `${type.domains[0]}.probe`, name: 'Probe' } : undefined;

describe('the Add picker offers only what a container accepts, and what it adds compiles', () => {
  it('starts from a document that compiles', () => { expect(compositionErrors(doc)).toEqual([]); });

  it('every type the table accepts compiles when added, in every container', () => {
    for (const [label, owner] of containers) {
      const where = endOf(doc, owner as never) as Destination;
      for (const type of tileTypes) {
        // A map asks which robot first and is added with one (tests/workspace2-catalog-blocks.test.ts).
        if (!canHold(doc, owner as never, type.type) || type.asks) continue;
        const { document } = insertType(doc, where, type.key, probe(type));
        expect(compositionErrors(document), `${label} + ${type.key}`).toEqual([]);
      }
    }
  });

  it('a rail takes chips only and a grid takes what the compiler allows', () => {
    const rail = first('status-rail').key, grid = first('tile-grid').key;
    expect(tileTypes.filter(type => canHold(doc, rail, type.type)).map(type => type.type)).not.toContain('section');
    expect(canHold(doc, grid, 'settings-link')).toBe(false);
    expect(canHold(doc, grid, 'action-tile')).toBe(true);
  });

  it('adds one node, selects it, and leaves the rest of the document alone', () => {
    const where = endOf(doc, 'page:page-home') as Destination;
    const { document, key } = insertType(doc, where, 'row');
    expect(buildDocumentIndex(document).get(key)?.node?.type).toBe('row');
    expect(buildDocumentIndex(document).keys.length).toBe(index.keys.length + 1);
    expect(doc).toBe(fixture.document);
  });

  it('adds a tile for an entity of the right kind, with its source, and no id typed', () => {
    const where = after(doc, first('action-tile').key) as Destination;
    expect(typeForEntity('switch.demo_plug').type).toBe('action-tile');
    const { document, key } = insertEntity(doc, where, 'switch.demo_plug', 'Plug');
    expect(compositionErrors(document)).toEqual([]);
    expect(JSON.stringify(document)).toContain('switch.demo_plug');
    expect(buildDocumentIndex(document).get(key)?.node?.title).toBe('Plug');
  });
});

describe('State Tile', () => {
  const where = () => endOf(doc, 'page:page-home') as Destination;
  const bindingOf = (document: CompositionDocument, key: string) => (buildDocumentIndex(document).get(key as never)?.node as { binding: Record<string, unknown> }).binding;

  it('is one of the things a tile can do, and never the default tile of a domain', () => {
    expect(tileChoices.map(choice => choice.name)).toContain('Show a Device’s State');
    expect(tileChoices.find(choice => choice.type === 'state-tile')?.detail).toBe('Follows a door, lock, sensor or robot through its states. Can have buttons.');
    expect(typeForEntity('lock.demo_front').type).not.toBe('state-tile');
  });

  it('adds a tile with the built-in style that fits the entity, and the device class decides a cover', () => {
    const lock = insertType(doc, where(), 'state-tile', { entityId: 'lock.demo_front', name: 'Front door' });
    expect(bindingOf(lock.document, lock.key)).toMatchObject({ entityId: 'lock.demo_front', builtIn: 'lock' });
    expect(compositionErrors(lock.document)).toEqual([]);
    const garage = insertType(doc, where(), 'state-tile', { entityId: 'cover.demo_garage', name: 'Garage', deviceClass: 'garage' });
    expect(bindingOf(garage.document, garage.key).builtIn).toBe('garage-door');
    const blind = insertType(doc, where(), 'state-tile', { entityId: 'cover.demo_blind', name: 'Blind' });
    expect(bindingOf(blind.document, blind.key).builtIn).toBe('blind');
  });

  it('says so when no style fits the entity, and takes a saved style of its domain', () => {
    expect(() => insertType(doc, where(), 'state-tile', { entityId: 'binary_sensor.demo_motion', name: 'Motion' })).toThrow(NO_STYLE_FITS);
    expect(NO_STYLE_FITS).toBe('No style fits this entity yet.');
    const { base: _base, ...detector } = builtInStyle('detector')!;
    const saved = { ...detector, id: 'house-motion', name: 'House motion' };
    const library = { type: 'state-styles@1' as const, styles: [saved] };
    const tile = newStateTile('binary_sensor.demo_motion', 'Motion', undefined, library)!;
    const made = insertMade({ ...doc, stateStyles: { type: 'state-styles@1', styles: [] } }, where(), { node: tile, sources: [], stateStyles: [saved] });
    expect(made.document.stateStyles?.styles.map(style => style.id)).toEqual(['house-motion']);
    expect(bindingOf(made.document, made.key).styleId).toBe('house-motion');
    expect(compositionErrors(made.document)).toEqual([]);
  });
});

