import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idsOf, main, refusalFor } from '../scripts/convert-tiles';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { ConversionError, convertTiles, workedOut } from '../src/workspace2/repeats/convertTiles';

type J = Record<string, any>;
const lit = (value: unknown) => ({ type: 'literal', value });
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });

const nav = (id: string, title: string): J => ({
  id, title, layout: { span: 1 }, type: 'navigation-tile', icon: symbol('info.circle'),
  props: { family: 'neutral', selected: 'navigation-path', subtitle: lit('Open') },
  action: { type: 'push', pageId: 'page-lattice', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});
const light = (id: string, title: string, sourceId: string): J => ({ id, title, layout: { span: 1 }, type: 'light-group-tile', props: { sourceId } });
function fixture(children: J[], sources: J[] = []): CompositionDocument {
  const document: J = JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
  document.dataSources.push(...sources);
  document.pages[2].components = [{
    id: 'grid', title: 'Grid', layout: { span: 1 }, type: 'tile-grid',
    props: { minimum: 'tile@1', maxColumns: 4, spacing: { type: 'token', name: 'm' }, equalRowHeights: false, shortRow: 'share', fold: 'page' }, children,
  }];
  return document as CompositionDocument;
}
const lightSource = (id: string, entity: string): J => ({ id, kind: 'model', model: 'home-light@1', inputs: { entityId: lit(entity) } });

describe('convertTiles extra settings', () => {
  it('adds a setting the places share today, so a new place can set it, and the worked-out document stays equal', () => {
    const before = fixture([nav('a', 'Alpha'), nav('b', 'Beta')]);
    const saved = convertTiles(before, { name: 'Link', nodeIds: ['a', 'b'], labels: { title: 'Name' }, also: [{ label: 'Opens', fields: ['action/pageId'] }] });
    const entry = saved.document.componentLibrary![0];
    expect(entry.params?.map(param => [param.label, param.kind])).toEqual([['Name', 'text'], ['Opens', 'page-id']]);
    expect(saved.document.pages[2].components[0]).toMatchObject({ children: [{ id: 'a', args: { page_id: 'page-lattice' } }, { id: 'b', args: { page_id: 'page-lattice' } }] });
    expect(workedOut(saved.document)).toBe(workedOut(before));
  });

  it('adds a Source setting for a source the places share, each place keeping it', () => {
    const before = fixture([light('a', 'Alpha', 'src-shared'), light('b', 'Beta', 'src-shared')], [lightSource('src-shared', 'light.demo_shared')]);
    const saved = convertTiles(before, { name: 'Light', nodeIds: ['a', 'b'], labels: { title: 'Name' }, also: [{ label: 'Light', fields: ['props/sourceId'] }] });
    expect(saved.document.componentLibrary![0].params?.map(param => [param.label, param.kind])).toEqual([['Name', 'text'], ['Light', 'source-id']]);
    expect(saved.document.pages[2].components[0]).toMatchObject({ children: [{ args: { light: 'src-shared' } }, { args: { light: 'src-shared' } }] });
    expect(workedOut(saved.document)).toBe(workedOut(before));
  });

  it('leaves a field alone that a setting already fills, and joins a label an existing setting has', () => {
    const before = fixture([nav('a', 'Alpha'), nav('b', 'Beta')]);
    const saved = convertTiles(before, { name: 'Link', nodeIds: ['a', 'b'], labels: { title: 'Name' }, also: [{ label: 'Name', fields: ['title'] }] });
    expect(saved.document.componentLibrary![0].params).toHaveLength(1);
  });

  it('refuses a joined setting that would give a tile a value it did not have (the gate)', () => {
    const before = fixture([nav('a', 'Alpha'), nav('b', 'Beta')]);
    // The subtitle is "Open" in both places; joining it to Name would draw "Alpha" and "Beta" there.
    expect(() => convertTiles(before, { name: 'Link', nodeIds: ['a', 'b'], labels: { title: 'Name' }, also: [{ label: 'Name', fields: ['props/subtitle/value'] }] })).toThrow(ConversionError);
    expect(() => convertTiles(before, { name: 'Link', nodeIds: ['a', 'b'], labels: { title: 'Name' }, also: [{ label: 'Name', fields: ['props/subtitle/value'] }] })).toThrow('worked-out document would change');
  });

  it('refuses tiles of more than one type', () => {
    const before = fixture([nav('a', 'Alpha'), light('b', 'Beta', 'src-x')], [lightSource('src-x', 'light.demo_x')]);
    expect(() => convertTiles(before, { name: 'Mixed', nodeIds: ['a', 'b'], labels: {} })).toThrow('more than one type');
  });
});

describe('convert-tiles script', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const doc = () => fixture([nav('hc-a', 'Alpha'), nav('hc-b', 'Beta'), light('other', 'Gamma', 'src-x')], [lightSource('src-x', 'light.demo_x')]);

  it('picks tiles by type, id pattern and field filter', () => {
    const document = doc();
    expect(idsOf(document, 'navigation-tile', /^hc-/)).toEqual(['hc-a', 'hc-b']);
    expect(idsOf(document, 'navigation-tile', /^hc-a$/)).toEqual(['hc-a']);
    expect(idsOf(document, 'navigation-tile', /^hc-/, { 'props/family': 'neutral' })).toEqual(['hc-a', 'hc-b']);
    expect(idsOf(document, 'navigation-tile', /./, { 'props/family': 'none' })).toEqual([]);
    expect(idsOf(document, 'light-group-tile', /./)).toEqual(['other']);
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'convert-tiles-'));
    writeFileSync(join(dir, 'in.json'), JSON.stringify({ document: doc() }));
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ templates: [{ name: 'Link', type: 'navigation-tile', idPattern: '^hc-', labels: { title: 'Name' } }] }));
    return dir;
  }
  const quiet = () => { vi.spyOn(console, 'log').mockImplementation(() => undefined); return vi.spyOn(console, 'error').mockImplementation(() => undefined); };

  it('converts a copy and writes a bare document', () => {
    const dir = setup(); quiet();
    expect(main([join(dir, 'in.json'), join(dir, 'spec.json'), join(dir, 'out.json')], {}, dir)).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as CompositionDocument;
    expect(out.componentLibrary?.[0].name).toBe('Link');
    expect(workedOut(out)).toBe(workedOut(doc()));
  });

  it('exits 1 when a conversion refuses, writing nothing, and 2 for missing arguments', () => {
    const dir = setup(); const errors = quiet();
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ templates: [{ name: 'Link', type: 'navigation-tile', idPattern: '^nothing$', labels: {} }] }));
    expect(main([join(dir, 'in.json'), join(dir, 'spec.json'), join(dir, 'out.json')], {}, dir)).toBe(1);
    expect(errors).toHaveBeenCalled();
    expect(main([join(dir, 'in.json')], {}, dir)).toBe(2);
  });

  it('refuses an output that is the input, inside ./data or DATA_DIR, or beside a .studio.lock', () => {
    const dir = setup(); quiet();
    const input = join(dir, 'in.json'), spec = join(dir, 'spec.json');
    mkdirSync(join(dir, 'data')); mkdirSync(join(dir, 'live')); writeFileSync(join(dir, 'live', '.studio.lock'), '1');
    mkdirSync(join(dir, 'state'));
    symlinkSync(join(dir, 'data'), join(dir, 'alias'));
    expect(main([input, spec, input], {}, dir)).toBe(2);
    expect(main([input, spec, join(dir, 'data', 'draft.json')], {}, dir)).toBe(2);
    expect(main([input, spec, 'data/draft.json'], {}, dir)).toBe(2);
    expect(main([input, spec, join(dir, 'alias', 'draft.json')], {}, dir)).toBe(2);
    expect(main([input, spec, join(dir, 'state', 'draft.json')], { DATA_DIR: join(dir, 'state') }, dir)).toBe(2);
    expect(main([input, spec, join(dir, 'live', 'out.json')], {}, dir)).toBe(2);
    expect(refusalFor(input, join(dir, 'fine.json'), {}, dir)).toBeUndefined();
  });
});
