import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { compositionErrors } from '../src/composition-editor';
import { tileTypes, typeForEntity } from '../src/workspace2/add/catalog';
import { after, canHold, endOf, insertEntity, insertType, type Destination } from '../src/workspace2/add/insert';
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
        if (!canHold(doc, owner as never, type.type)) continue;
        const { document } = insertType(doc, where, type.type, probe(type));
        expect(compositionErrors(document), `${label} + ${type.type}`).toEqual([]);
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
