import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { Predicate } from '../src/shared/composition/expression';
import { compositionErrors, replaceAt } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { acceptedDomains, bindEntity, bindSource, boundEntity, nodeSourceId, sourceChoices } from '../src/workspace2/add/sources';
import { acceptedKinds, dataOf, defaultAction, operandDepth, operandFor, sourceOf, targetEntities, withDataField, withService, withTargetEntities } from '../src/workspace2/editors/action';
import { schemaAt } from '../src/workspace2/rows';
import { filterEntities, rowsFromDocument } from '../src/workspace2/pickers/entities';
import { filterIcons } from '../src/workspace2/pickers/icons';
import { filterServices, sampleServices, serviceTitle } from '../src/workspace2/pickers/services';

const fixture = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
const doc = fixture.document;
const source = doc.dataSources.find(item => item.kind === 'ha-entity')?.id ?? 'hc-guest-0';
const samples: Record<string, Predicate> = {
  state: { type: 'state', sourceId: source, path: ['state'], in: ['on', 'home'] },
  notState: { type: 'not', of: { type: 'state', sourceId: source, path: ['state'], in: ['on'] } },
  above: { type: 'numeric', sourceId: source, path: ['state'], above: { type: 'literal', value: 20 } },
  below: { type: 'numeric', sourceId: source, path: ['state'], below: { type: 'literal', value: 5 } },
  between: { type: 'numeric', sourceId: source, path: ['state'], above: { type: 'literal', value: 1 }, below: { type: 'literal', value: 9 } },
  admin: { type: 'viewer', isAdmin: true },
  users: { type: 'viewer', userIds: ['abc'] },
  person: { type: 'viewer-person', in: ['person.demo_a', 'person.demo_b'] },
  all: { type: 'all', of: [{ type: 'viewer', isAdmin: true }, { type: 'viewer-person', in: ['person.demo_a'] }] },
  any: { type: 'any', of: [{ type: 'viewer', isAdmin: false }, { type: 'viewer-person', in: ['person.demo_a'] }] },
};
const deep: Predicate = { type: 'all', of: [{ type: 'any', of: [{ type: 'all', of: [{ type: 'viewer', isAdmin: true }] }] }] };


describe('action model', () => {
  const tile = [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'primary-button')
    ?? [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'row')!;
  it('offers the kinds a schema accepts, plus Nothing when the field is optional', () => {
    const row = [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'row')!;
    const kinds = acceptedKinds(schemaAt(doc, [...row.path, 'action']), true);
    expect(kinds).toContain('call-service'); expect(kinds).toContain('push'); expect(kinds.at(-1)).toBe('none');
    expect(kinds).not.toContain('domain');
    void tile;
  });
  it('builds a valid default action for each kind', () => {
    for (const kind of ['call-service', 'push', 'present', 'select-tab', 'back', 'dismiss', 'set-local'] as const) expect(defaultAction(kind, doc), kind).toBeTruthy();
    expect(defaultAction('none', doc)).toBeUndefined();
  });
  it('edits targets and data fields of a call', () => {
    let call = { type: 'call-service' as const, domain: 'light', service: 'turn_on' };
    expect(targetEntities(call)).toEqual([]);
    call = withTargetEntities(call, ['light.demo_a']) as typeof call;
    expect(call).toMatchObject({ target: { entity_id: { type: 'literal', value: 'light.demo_a' } } });
    call = withTargetEntities(call, ['light.demo_a', 'light.demo_b']) as typeof call;
    expect(targetEntities(call)).toEqual(['light.demo_a', 'light.demo_b']);
    expect((withTargetEntities(call, []) as { target?: unknown }).target).toBeUndefined();
    const withField = withDataField(call, 'brightness', { type: 'literal', value: 120 });
    expect(dataOf(withField).brightness).toEqual({ type: 'literal', value: 120 });
    expect(withDataField(withField, 'brightness', undefined).data).toBeUndefined();
    expect(withService(call, 'switch', 'toggle')).toMatchObject({ domain: 'switch', service: 'toggle', target: { entity_id: { value: ['light.demo_a', 'light.demo_b'] } } });
  });
  it('names the source of a value and converts between sources', () => {
    expect(sourceOf({ type: 'literal', value: 1 })).toBe('fixed');
    expect(sourceOf(operandFor('control', undefined))).toBe('control');
    expect(sourceOf(operandFor('viewer', undefined))).toBe('viewer');
    const formula = operandFor('formula', { type: 'literal', value: 3 });
    expect(formula.type).toBe('format');
    expect(operandDepth(formula)).toBe(2);
  });
});

describe('entity binding', () => {
  it('creates or reuses a data source for the entity and rewrites the tile in one document', () => {
    const tile = [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'action-tile')!;
    const first = bindEntity(doc, tile.path, 'switch.demo_new_plug');
    expect(boundEntity(first, tile.path)).toBe('switch.demo_new_plug');
    expect(compositionErrors(first)).toEqual([]);
    const again = bindEntity(first, tile.path, 'switch.demo_new_plug');
    expect(again.dataSources.length).toBe(first.dataSources.length);
  });
  it('rebinds a light tile to another light with a copy of its own model, and reuses that copy the next time', () => {
    const tile = [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'light-group-tile')!;
    const before = doc.dataSources.find(item => item.id === nodeSourceId(doc, tile.path)) as { model: string; inputs: { entityId: { value: string }; memberEntityIds?: unknown[] } };
    expect(before.inputs.memberEntityIds?.length).toBeGreaterThan(0);
    const first = bindEntity(doc, tile.path, 'light.demo_another_lamp');
    expect(first.dataSources.length).toBe(doc.dataSources.length + 1);
    expect(boundEntity(first, tile.path)).toBe('light.demo_another_lamp');
    const made = first.dataSources.find(item => item.id === nodeSourceId(first, tile.path)) as typeof before;
    expect(made.model).toBe(before.model);
    expect(made.inputs.memberEntityIds).toBeUndefined();
    expect(compositionErrors(first)).toEqual([]);
    const other = [...buildDocumentIndex(first).entries.values()].filter(entry => entry.node?.type === 'light-group-tile')[1]!;
    const shared = bindEntity(first, other.path, 'light.demo_another_lamp');
    expect(shared.dataSources.length).toBe(first.dataSources.length);
    expect(nodeSourceId(shared, other.path)).toBe(nodeSourceId(first, tile.path));
  });
  it('offers the entity picker to a node that reads one entity and only the Models group to one that reads a model', () => {
    const entries = [...buildDocumentIndex(doc).entries.values()];
    const light = sourceChoices(doc, entries.find(entry => entry.node?.type === 'light-group-tile')!.path);
    expect(light.acceptsEntity).toBe(true);
    const chipPath = entries.find(entry => entry.node?.type === 'status-chip')!.path;
    const chip = sourceChoices(doc, chipPath);
    expect(chip.acceptsEntity).toBe(false);
    expect(chip.models.length).toBeGreaterThan(1);
    expect(chip.models.every(item => item.kind === 'model' && item.model === 'home-status@1')).toBe(true);
    const target = chip.models.find(item => item.id !== nodeSourceId(doc, chipPath))!;
    const moved = bindSource(doc, chipPath, target.id);
    expect(nodeSourceId(moved, chipPath)).toBe(target.id);
    expect(moved.dataSources.length).toBe(doc.dataSources.length);
    expect(compositionErrors(moved)).toEqual([]);
  });
});

describe('the entity picker offers only entities the node can read', () => {
  const entries = [...buildDocumentIndex(doc).entries.values()].filter(entry => entry.node && nodeSourceId(doc, entry.path) && sourceChoices(doc, entry.path).acceptsEntity);
  it('limits a power-toggle tile to switches and input booleans, and a light tile to lights, switches and input booleans', () => {
    const tile = entries.find(entry => entry.node?.type === 'action-tile')!;
    expect(acceptedDomains(doc, tile.path)).toEqual(['switch', 'input_boolean']);
    expect(acceptedDomains(doc, entries.find(entry => entry.node?.type === 'light-group-tile')!.path)).toEqual(['light', 'switch', 'input_boolean']);
  });
  it('leaves the draft valid for every entity of every accepted domain, on every node the picker serves', () => {
    expect(entries.length).toBeGreaterThan(5);
    const kinds = new Set<string>();
    for (const entry of entries) {
      const domains = acceptedDomains(doc, entry.path);
      if (!domains) continue;
      kinds.add(`${entry.node!.type}:${domains.join(',')}`);
      for (const domain of domains) expect(compositionErrors(bindEntity(doc, entry.path, `${domain}.probe_entity`)), `${entry.node!.type} + ${domain}`).toEqual([]);
    }
    expect(kinds.size).toBeGreaterThan(2);
  });
  it('swaps a camera tile for another camera source with its sheet, and offers no single entity for it', () => {
    const tile = [...buildDocumentIndex(doc).entries.values()].find(entry => entry.node?.type === 'camera-tile')!;
    expect(sourceChoices(doc, tile.path).acceptsEntity).toBe(false);
    const camera = doc.dataSources.find(item => item.id === nodeSourceId(doc, tile.path)) as any;
    const twin = { ...camera, id: 'camera-two', inputs: { ...camera.inputs, entityId: { type: 'literal', value: 'camera.demo_two' }, snapshotEntityId: { type: 'literal', value: 'camera.demo_two' } } };
    // The fixture's second camera tile opens the same sheet, so the first cannot change camera; give that one a sheet of its own.
    const other = [...buildDocumentIndex(doc).entries.values()].filter(entry => entry.node?.type === 'camera-tile')[1]!;
    const sheet = doc.modals.find(modal => modal.id === 'hc-camera-0-modal')!;
    expect(sourceChoices(doc, tile.path).models.map(item => item.id)).toEqual(['hc-camera-0']);
    const split = replaceAt({ ...doc, modals: [...doc.modals, { ...JSON.parse(JSON.stringify(sheet).replace(/"id":"([^"]+)"/g, '"id":"$1-2"')) }] } as CompositionDocument, [...other.path, 'action', 'modalId'], 'hc-camera-0-modal-2');
    expect(compositionErrors(split)).toEqual([]);
    const two = { ...split, dataSources: [...split.dataSources, twin] } as CompositionDocument;
    expect(sourceChoices(two, tile.path).models.map(item => item.id)).toContain('camera-two');
    expect(compositionErrors(bindSource(two, tile.path, 'camera-two'))).toEqual([]);
  });
  it('would have refused the light the picker used to offer a power-toggle tile', () => {
    const tile = entries.find(entry => entry.node?.type === 'action-tile')!;
    expect(acceptedDomains(doc, tile.path)).not.toContain('light');
    expect(compositionErrors(bindEntity(doc, tile.path, 'light.demo_probe_entity')).length).toBeGreaterThan(0);
  });
});

describe('picker data', () => {
  it('searches name, id, area and domain, and filters by domain', () => {
    const rows = [{ entityId: 'light.demo_sofa', name: 'Sofa lamp', domain: 'light', area: 'Living Room' }, { entityId: 'switch.demo_fan', name: 'Desk fan', domain: 'switch', area: 'Office' }];
    expect(filterEntities(rows, 'living').map(row => row.entityId)).toEqual(['light.demo_sofa']);
    expect(filterEntities(rows, 'fan').map(row => row.entityId)).toEqual(['switch.demo_fan']);
    expect(filterEntities(rows, '', new Set(['light'])).length).toBe(1);
    expect(filterEntities(rows, 'sofa switch')).toEqual([]);
    expect(rowsFromDocument(doc).length).toBeGreaterThan(0);
  });
  it('searches icons by plain and symbol name, and services by title and id', () => {
    expect(filterIcons('bulb').some(choice => choice.symbol === 'lightbulb.fill')).toBe(true);
    expect(filterIcons('lightbulb.fill')[0].name).toContain('Light bulb');
    const turnOn = filterServices(sampleServices, 'light turn');
    expect(turnOn.map(row => `${row.domain}.${row.service}`)).toContain('light.turn_on');
    expect(serviceTitle(sampleServices.find(row => row.service === 'turn_on')!)).toMatch(/: Turn on$/);
  });
});
