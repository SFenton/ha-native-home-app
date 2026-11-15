import { readFileSync } from 'node:fs';
import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { compositionAssetManifestHash, decodeCompositionPublication, validateCompositionPublication } from '../server/composition';
import { compileCompositionDocument, firstSliceCapabilities } from '../src/shared/composition/compiler';
import { assertCompositionBounds, canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_BYTES, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON } from '../src/shared/composition/json';
import { activityPresentationSchema, compositionDocumentSchema, type CompositionPublication } from '../src/shared/composition/schema';

const fixtureBytes = readFileSync(new URL('./fixtures/composition-first-slice.json', import.meta.url));
const fixture = (): CompositionPublication => JSON.parse(fixtureBytes.toString('utf8'));
function issue(run: () => unknown, code: string, pointer?: string) {
  try { run(); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(CompositionValidationError);
    expect((error as CompositionValidationError).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, ...(pointer === undefined ? {} : { pointer }) }),
    ]));
  }
}
function liveFixture() {
  const publication = fixture(), document = publication.document;
  document.dataSources.push(
    { id: 'source-panel', kind: 'model', model: 'alarm-mode@1',
      inputs: { entityId: { type: 'literal', value: 'alarm_control_panel.demo_panel' } } },
    { id: 'source-stock', kind: 'model', model: 'inventory-summary@1',
      inputs: { totalEntityId: { type: 'literal', value: 'sensor.demo_total' },
        expiringEntityId: { type: 'literal', value: 'sensor.demo_expiry' },
        spaceEntityIds: [{ type: 'literal', value: 'sensor.demo_space' }] },
      labels: { singular: 'Unit', plural: 'Units', expiringSuffix: 'Due', separator: ' / ',
        loadingText: 'Reading stock', unavailableText: 'Stock unavailable' } },
  );
  const grid = document.pages[0].components[0], text = document.pages[2].components[0];
  if (grid.type !== 'tile-grid' || grid.children[1].type !== 'navigation-tile' || text.type !== 'text') throw Error('Fixture shape changed');
  const tile = grid.children[1];
  tile.props.selected = 'none';
  tile.props.subtitle = { type: 'literal', value: '' };
  tile.props.alarm = {
    sourceId: 'source-panel', projection: 'alarm-navigation@1',
    states: [{ state: 'disarmed', appearance: {
      icon: { type: 'sf-symbol', name: 'shield.slash', rendering: 'canonical', unavailable: 'reject' },
      fill: { type: 'solid-rgb', red: 67, green: 160, blue: 71 }, text: 'At rest',
    } }],
    fallback: { icon: { type: 'sf-symbol', name: 'shield', rendering: 'canonical', unavailable: 'reject' },
      fill: { type: 'solid-rgb', red: 84, green: 110, blue: 122 }, text: 'Panel' },
    loadingText: 'Reading panel', unavailableText: 'Panel unavailable', errorText: 'No response', hiddenText: 'Private',
  };
  text.props.value = { type: 'read', from: { type: 'source', sourceId: 'source-stock', path: ['stateText'] }, as: 'string', missing: 'unavailable' };
  return { publication, tile, text };
}
describe('configured live adapters', () => {
  it('negotiates supporting text styles without changing the original text contract', () => {
    for (const style of ['subheadline', 'footnote', 'section-title'] as const) {
      const publication = fixture(), text = publication.document.pages[2].components[0];
      if (text.type !== 'text') throw Error('Fixture shape changed');
      text.props.style = style;
      issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
      publication.capabilities = compileCompositionDocument(publication.document).capabilities;
      expect(publication.capabilities).toContain(style === 'section-title' ? 'sh.section-title@1' : 'sh.supporting-text-styles@1');
      expect(validateCompositionPublication(publication).document).toEqual(publication.document);
    }
    expect(compileCompositionDocument(fixture().document).capabilities).toEqual(firstSliceCapabilities);
  });

  it('authors todo count sources with exact capability and strict list targets', () => {
    const publication = fixture();
    publication.document.dataSources.push({
      id: 'source-chores', kind: 'model', model: 'todo-counts@1',
      inputs: { lists: [{ entityId: { type: 'literal', value: 'todo.demo_unit' }, overdue: true }] },
      labels: { openSuffix: 'open', overdueSuffix: 'late', separator: ' / ', zeroText: 'All clear',
        loadingText: 'Loading', unavailableText: 'Unavailable' },
    });
    const text = publication.document.pages[2].components[0];
    if (text.type !== 'text') throw Error('Fixture shape changed');
    text.props.value = { type: 'read', from: { type: 'source', sourceId: 'source-chores', path: ['stateText'] }, as: 'string', missing: 'unavailable' };
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.todo-counts@1'].sort());
    expect(validateCompositionPublication(publication).document).toEqual(publication.document);
    const schema = JSON.stringify(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
    for (const field of ['todo-counts@1', 'overdueSuffix', 'zeroText', 'overdue']) expect(schema).toContain(`"${field}"`);
    const source = publication.document.dataSources.at(-1)!;
    if (source.kind !== 'model' || source.model !== 'todo-counts@1') throw Error('Expected todo counts');
    source.inputs.lists.push(structuredClone(source.inputs.lists[0]));
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/dataSources/2/inputs/lists/1/entityId/value');
    source.inputs.lists.pop();
    source.inputs.lists[0].entityId.value = 'sensor.demo_unit';
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/dataSources/2/inputs/lists/0/entityId/value');
  });
  it('authors a strictly configured sprinkler state source with exact capability and typed reads', () => {
    const publication = fixture();
    const literal = (value: string) => ({ type: 'literal' as const, value });
    const inputs = {
      title: 'Test controller', lowBatteryPercent: 25,
      stateEntityId: literal('sensor.test_state'), modeEntityId: literal('select.test_mode'),
      batteryEntityId: literal('sensor.test_battery'), faultEntityId: literal('binary_sensor.test_fault'),
      nextWateringEntityId: literal('sensor.test_next'), hubConnectedEntityId: literal('binary_sensor.test_hub'),
      rainDelayEntityId: literal('switch.test_rain'), smartWateringEntityId: literal('switch.test_smart'),
      zones: [{ valveEntityId: literal('valve.test_zone'), programEntityId: literal('switch.test_program'),
        historyEntityId: literal('sensor.test_history') }],
    };
    publication.document.dataSources.push({ id: 'source-irrigation', kind: 'model', model: 'sprinkler-state@1', inputs });
    const text = publication.document.pages[2].components[0];
    if (text.type !== 'text') throw Error('Fixture shape changed');
    text.props.value = { type: 'read', from: { type: 'source', sourceId: 'source-irrigation', path: ['status'] },
      as: 'string', missing: 'unavailable' };
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.sprinkler-state@1'].sort());
    expect(validateCompositionPublication(publication).document.dataSources.at(-1)).toMatchObject({ inputs });
    const schema = JSON.stringify(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
    for (const field of ['sprinkler-state@1', 'lowBatteryPercent', 'valveEntityId', 'historyEntityId'])
      expect(schema).toContain(`"${field}"`);
    inputs.zones[0].valveEntityId.value = 'switch.test_zone';
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination',
      '/document/dataSources/2/inputs/zones/0/valveEntityId/value');
    inputs.zones[0].valveEntityId.value = 'valve.test_zone';
    text.props.value.from.path = ['batteryLow'];
    issue(() => compileCompositionDocument(publication.document), 'binding_type');
    text.props.value.from.path = ['bogus'];
    issue(() => compileCompositionDocument(publication.document), 'invalid_reference');
  });
  it('negotiates list sources separately from summaries and rejects scalar reads', () => {
    const publication = fixture();
    publication.document.dataSources.push({
      id: 'source-items', kind: 'model', model: 'inventory-list@1', inputs: { space: 'fridge' },
    });
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toContain('sh.inventory-list@1');
    expect(validateCompositionPublication(publication).document.dataSources.at(-1)).toEqual({
      id: 'source-items', kind: 'model', model: 'inventory-list@1', inputs: { space: 'fridge' },
    });
    const text = publication.document.pages[2].components[0];
    if (text.type !== 'text') throw Error('Expected text');
    text.props.value = { type: 'read', from: { type: 'source', sourceId: 'source-items', path: ['stateText'] },
      as: 'string', missing: 'unavailable' };
    issue(() => compileCompositionDocument(publication.document), 'invalid_reference', '/document/pages/2/components/0/props/value/from/path');
  });
  it('authors an explicit read-only household away sensor with an exact capability closure', () => {
    const publication = fixture(), document = publication.document;
    document.dataSources.push({ id: 'source-away', kind: 'model', model: 'household-away-status@1',
      inputs: { entityId: { type: 'literal', value: 'sensor.example_away' } } });
    const text = document.pages[2].components[0];
    if (text.type !== 'text') throw Error('Fixture shape changed');
    text.props.value = { type: 'read', from: { type: 'source', sourceId: 'source-away', path: ['mode'] },
      as: 'string', missing: 'unavailable' };
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.household-away-status@1'].sort());
    expect(validateCompositionPublication(publication).document).toEqual(document);
    const schema = JSON.stringify(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
    expect(schema).toContain('"household-away-status@1"');
    const source = document.dataSources.at(-1)!;
    if (source.kind !== 'model' || source.model !== 'household-away-status@1') throw Error('Expected away source');
    source.inputs.entityId.value = 'switch.example';
    issue(() => compileCompositionDocument(document), 'invalid_combination', '/document/dataSources/2/inputs/entityId/value');
    source.inputs.entityId.value = 'sensor.example_away';
    if (text.props.value.type !== 'read') throw Error('Expected read');
    text.props.value.from.path = ['traveler'];
    issue(() => compileCompositionDocument(document), 'invalid_reference', '/document/pages/2/components/0/props/value/from/path');
  });
  it('negotiates a private account header without accepting personal snapshots or scalar reads', () => {
    const publication = fixture(), document = publication.document;
    document.dataSources.push({ id: 'private-account', kind: 'model', model: 'profile-account@1' });
    document.pages[2].components.push({
      id: 'account-card', title: 'Account', type: 'account-header', layout: { span: 1 },
      binding: { sourceId: 'private-account', projection: 'profile-account@1' },
      props: { fallbackName: 'Signed In', loadingText: 'Loading account', unavailableText: 'Account unavailable' },
    });
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.profile-account@1'].sort());
    expect(validateCompositionPublication(publication).document).toEqual(document);
    const input = JSON.parse(JSON.stringify(document));
    input.dataSources[2].token = 'not-a-token';
    issue(() => compileCompositionDocument(input), 'unknown_field', '/document/dataSources/2/token');
    delete input.dataSources[2].token;
    input.dataSources[2].name = 'Synthetic';
    issue(() => compileCompositionDocument(input), 'unknown_field', '/document/dataSources/2/name');
    delete input.dataSources[2].name;
    input.pages[2].components[1].binding.sourceId = 'source-power';
    issue(() => compileCompositionDocument(input), 'binding_type', '/document/pages/2/components/1/binding/sourceId');
    input.pages[2].components[1].binding.sourceId = 'missing';
    issue(() => compileCompositionDocument(input), 'invalid_reference', '/document/pages/2/components/1/binding/sourceId');
    input.pages[2].components[1].binding.sourceId = 'private-account';
    input.pages[2].components[0].props.value.from.sourceId = 'private-account';
    issue(() => compileCompositionDocument(input), 'invalid_reference', '/document/pages/2/components/0/props/value/from/path');
  });
  it('negotiates delivered activity presentation without granting engine actions', () => {
    const activity = {
      id: 'activity-demo', jobId: 'fan.demo_unit', type: 'activity-presentation@1', title: 'Cleaning', glyph: 'fan', tint: 'air',
      source: 'activity-engine@1', privacy: 'system-sensitive@1', updates: 'engine@1', intents: 'engine-safe@1',
    };
    expect(activityPresentationSchema.safeParse(activity).success).toBe(true);
    for (const change of [{ privacy: 'public' }, { updates: 'poll' }, { intents: 'unlock' },
      { glyph: 'unknown' }, { title: ' ' }, { title: 'a'.repeat(33) }, { id: 'constructor' }, { unexpected: 'value' }])
      expect(activityPresentationSchema.safeParse({ ...activity, ...change }).success).toBe(false);
    const document = { ...fixture().document, liveActivities: [activity] };
    expect(compileCompositionDocument(document).capabilities).toContain('sh.activity-presentation@1');
    issue(() => compileCompositionDocument({ ...document, liveActivities: [activity, { ...activity, id: 'other' }] }),
      'duplicate_id', '/document/liveActivities/0/jobId');
  });
  it('negotiates alarm navigation and inventory with arbitrary identities and editable structured fields', () => {
    const { publication, tile } = liveFixture();
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.alarm-mode@1', 'sh.inventory-summary@1', 'sh.tile-presentation@1'].sort());
    expect(validateCompositionPublication(publication).document.pages[0].components[0]).toEqual(publication.document.pages[0].components[0]);
    expect(tile.action.type).toBe('push');
    const schema = JSON.stringify(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
    for (const field of ['alarm-navigation@1', 'alarm-mode@1', 'inventory-summary@1', 'expiringEntityId',
      'spaceEntityIds', 'expiringSuffix', 'hiddenText', 'fallback']) expect(schema).toContain(`"${field}"`);
  });
  it('rejects mismatched references, ambiguous alarm states and ignored subtitles', () => {
    const { publication, tile, text } = liveFixture(), alarm = tile.props.alarm!;
    alarm.sourceId = 'source-stock';
    issue(() => compileCompositionDocument(publication.document), 'binding_type', '/document/pages/0/components/0/children/1/props/alarm/sourceId');
    alarm.sourceId = 'missing';
    issue(() => compileCompositionDocument(publication.document), 'invalid_reference');
    alarm.sourceId = 'source-panel';
    alarm.states.push(structuredClone(alarm.states[0]));
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/pages/0/components/0/children/1/props/alarm/states/1/state');
    alarm.states.pop();
    tile.props.subtitle = { type: 'literal', value: 'Frozen' };
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/pages/0/components/0/children/1/props/subtitle');
    tile.props.subtitle.value = '';
    tile.props.selected = 'navigation-path';
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination');
    tile.props.selected = 'none';
    if (text.props.value.type !== 'read') throw Error('Expected summary read');
    text.props.value.from.path = ['isOn'];
    issue(() => compileCompositionDocument(publication.document), 'invalid_reference');
    text.props.value.from.path = ['stateText'];
    text.props.value.as = 'entity-id';
    issue(() => compileCompositionDocument(publication.document), 'binding_type');
  });
  it('rejects wrong entity domains, read-derived alarm targets, missing copy and extra executable fields', () => {
    const { publication } = liveFixture();
    const input = JSON.parse(JSON.stringify(publication.document));
    input.dataSources[2].inputs.entityId.value = 'switch.demo_panel';
    issue(() => compileCompositionDocument(input), 'invalid_combination', '/document/dataSources/2/inputs/entityId/value');
    input.dataSources[2].inputs.entityId.value = 'alarm_control_panel.demo_panel';
    input.dataSources[3].inputs.totalEntityId.value = 'sensor.demo_total\n';
    issue(() => compileCompositionDocument(input), 'invalid_value');
    input.dataSources[3].inputs.totalEntityId.value = 'sensor.demo_total';
    input.dataSources[3].inputs.spaceEntityIds = [];
    issue(() => compileCompositionDocument(input), 'limit_exceeded');
    input.dataSources[3].inputs.spaceEntityIds = [{ type: 'literal', value: 'sensor.demo_space' }];
    delete input.dataSources[3].labels.unavailableText;
    issue(() => compileCompositionDocument(input), 'missing_required', '/document/dataSources/3/labels/unavailableText');
    input.dataSources[3].labels.unavailableText = 'No data';
    input.dataSources[3].labels.expression = 'return 12';
    issue(() => compileCompositionDocument(input), 'unknown_field', '/document/dataSources/3/labels/expression');
    delete input.dataSources[3].labels.expression;
    input.dataSources[2].inputs.entityId = { type: 'read', from: { type: 'source', sourceId: 'source-entity', path: ['state'] }, as: 'entity-id', missing: 'unavailable' };
    expect(() => compileCompositionDocument(input)).toThrow(CompositionValidationError);
  });
  it('keeps power actions and entity-id dependency graphs closed to the new models', () => {
    const { publication } = liveFixture(), grid = publication.document.pages[0].components[0];
    if (grid.type !== 'tile-grid' || grid.children[0].type !== 'action-tile') throw Error('Fixture shape changed');
    grid.children[0].binding.sourceId = grid.children[0].action.sourceId = 'source-panel';
    issue(() => compileCompositionDocument(publication.document), 'binding_type');
    const source = publication.document.dataSources[0];
    if (source.kind !== 'ha-entity') throw Error('Expected HA source');
    source.entityId = { type: 'read', from: { type: 'source', sourceId: 'source-stock', path: ['stateText'] }, as: 'entity-id', missing: 'unavailable' };
    issue(() => compileCompositionDocument(publication.document), 'binding_type', '/document/dataSources/0/entityId/as');
  });
});
describe('settings links', () => {
  it('compiles authored rows with exact capabilities and rejects invalid chevrons and destinations', () => {
    const publication = fixture();
    publication.document.pages[2].components[0] = {
      id: 'settings-demo', type: 'settings-link', title: 'Sample setting', layout: { span: 1 },
      icon: { type: 'sf-symbol', name: 'gearshape', rendering: 'canonical', unavailable: 'reject' },
      props: { subtitle: 'Open details', hint: 'Opens details', showsChevron: true },
      action: { type: 'push', pageId: 'page-echo', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
    };
    const row = publication.document.pages[2].components[0];
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toContain('sh.settings-link@1');
    expect(validateCompositionPublication(publication).document.pages[2].components[0]).toEqual(row);
    row.props.showsChevron = false;
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/pages/2/components/0/props/showsChevron');
    row.props.showsChevron = true;
    if (row.action.type !== 'push') throw Error('Expected push');
    row.action.pageId = 'missing';
    issue(() => compileCompositionDocument(publication.document), 'invalid_reference', '/document/pages/2/components/0/action/pageId');
    row.action.pageId = 'page-echo';
    const grid = publication.document.pages[0].components[0];
    if (grid.type !== 'tile-grid') throw Error('Expected grid');
    grid.children[1] = { ...row, id: 'row-in-grid' };
    issue(() => compileCompositionDocument(publication.document), 'invalid_combination', '/document/pages/0/components/0/children/1');
  });
});
describe('schema 2 composition compiler', () => {
  it('compiles the same frozen publication as Swift with the exact capability closure and manifest', () => {
    const publication = decodeCompositionPublication(fixtureBytes);
    expect(publication.capabilities).toEqual(firstSliceCapabilities);
    expect(compositionAssetManifestHash(publication.document.assets)).toBe(publication.assetManifestSha256);
    expect(compileCompositionDocument(publication.document).document).toEqual(fixture().document);
    const jsonSchema = z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' });
    expect(jsonSchema.additionalProperties).toBe(false);
  });
  it('keeps composition ID-driven when tabs are reordered and an arbitrary tab is renamed', () => {
    const publication = fixture(), nav = publication.document.navigation;
    nav.tabs[0].id = 'tab-unregistered';
    nav.initialTabId = 'tab-unregistered';
    nav.tabs.reverse();
    expect(validateCompositionPublication(publication).document.navigation.initialTabId).toBe('tab-unregistered');
  });
  it('negotiates authored tile presentation exactly and rejects incompatible native faces', () => {
    const publication = fixture(), grid = publication.document.pages[0].components[0];
    if (grid.type !== 'tile-grid' || grid.children[1].type !== 'navigation-tile') throw Error('Fixture shape changed');
    const tile = grid.children[1];
    tile.props.selected = 'none';
    tile.props.presentation = {
      layout: 'anchored-bottom', titleLines: 2,
      fill: { type: 'solid-rgb', red: 42, green: 128, blue: 255 },
      bodyHint: 'Opens the sample page',
    };
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(validateCompositionPublication(publication).document).toEqual(publication.document);
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.tile-presentation@1'].sort());
    tile.props.family = 'lights';
    issue(() => validateCompositionPublication(publication), 'invalid_combination', '/document/pages/0/components/0/children/1/props/family');
    tile.props.family = 'neutral';
    if (tile.props.presentation.fill.type !== 'solid-rgb') throw Error('Expected authored solid fill');
    tile.props.presentation.fill.red = 256;
    issue(() => validateCompositionPublication(publication), 'limit_exceeded');
    tile.props.presentation.fill.red = 42;
    tile.props.presentation.bodyHint = ' ';
    issue(() => validateCompositionPublication(publication), 'invalid_value');
    const unused = fixture();
    unused.capabilities = [...firstSliceCapabilities, 'sh.tile-presentation@1'].sort();
    issue(() => validateCompositionPublication(unused), 'capability_manifest_mismatch');
  });
  it('requires explicit policies and refuses unknown fields and schemas', () => {
    const publication = fixture();
    const input = JSON.parse(JSON.stringify(publication));
    delete input.document.navigation.policy.reselect;
    issue(() => validateCompositionPublication(input), 'missing_required', '/document/navigation/policy/reselect');
    input.document.navigation.policy.reselect = 'pop-root-then-scroll@1';
    input.document.pages[0].css = 'display:grid';
    issue(() => validateCompositionPublication(input), 'unknown_field', '/document/pages/0/css');
    input.document.schemaVersion = '1.0';
    issue(() => validateCompositionPublication(input), 'unsupported_schema', '/document/schemaVersion');
  });
  it('rejects unknown capability requirements before manifest mismatch and rejects missing requirements', () => {
    const publication = fixture();
    publication.capabilities.push('sh.remote-code@1');
    issue(() => validateCompositionPublication(publication), 'unsupported_capability');
    publication.capabilities = firstSliceCapabilities.filter(capability => capability !== 'sh.grid@1');
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
  });
  it('rejects duplicates, missing destinations and mismatched power model bindings', () => {
    const publication = fixture(), page = publication.document.pages[0];
    publication.document.pages.push(structuredClone(page));
    issue(() => validateCompositionPublication(publication), 'duplicate_id');
    publication.document.pages.pop();
    publication.document.navigation.tabs[0].pageId = 'missing';
    issue(() => validateCompositionPublication(publication), 'invalid_reference');
    publication.document.navigation.tabs[0].pageId = page.id;
    const grid = page.components[0];
    if (grid.type !== 'tile-grid' || grid.children[0].type !== 'action-tile') throw Error('Fixture shape changed');
    grid.children[0].action.sourceId = 'source-entity';
    issue(() => validateCompositionPublication(publication), 'invalid_combination');
  });
  it('checks read types and rejects source cycles without executing them', () => {
    const publication = fixture(), text = publication.document.pages[2].components[0];
    if (text.type !== 'text' || text.props.value.type !== 'read') throw Error('Fixture shape changed');
    text.props.value.as = 'number';
    issue(() => validateCompositionPublication(publication), 'binding_type');
    text.props.value.as = 'string';
    const source = publication.document.dataSources[0];
    if (source.kind !== 'ha-entity') throw Error('Fixture shape changed');
    source.entityId = { type: 'read', from: { type: 'source', sourceId: source.id, path: ['attributes', 'target'] }, as: 'entity-id', missing: 'unavailable' };
    issue(() => validateCompositionPublication(publication), 'invalid_combination');
  });
  it('requires a menu at each shell root and counts host-owned Close in modal chrome', () => {
    const publication = fixture();
    publication.document.pages[0].toolbar = { type: 'replace', groups: [] };
    issue(() => validateCompositionPublication(publication), 'invalid_combination', '/document/pages/0/toolbar');
    const modal = fixture();
    const button = modal.document.navigation.chrome.groups[1].items[0];
    if (button.type !== 'button') throw Error('Fixture shape changed');
    modal.document.modals[0].toolbar = { type: 'replace', groups: [{
      id: 'group-modal', placement: 'trailing', horizontal: 'shared@1', vertical: 'shared@1',
      items: Array.from({ length: 12 }, (_, i) => ({ ...button, id: `button-${i}` })),
    }] };
    issue(() => validateCompositionPublication(modal), 'limit_exceeded', '/document/modals/0/toolbar');
  });
  it('rejects unsupported premeasurement, local state and extended tabs explicitly', () => {
    const input = JSON.parse(fixtureBytes.toString('utf8'));
    input.document.modals[0].presentation.height = { type: 'fitted', follows: 'root', fitKey: 'fit-demo', firstOpen: 'premeasure' };
    issue(() => validateCompositionPublication(input), 'unknown_variant', '/document/modals/0/presentation/height/firstOpen');
    input.document.modals[0].presentation.height = { type: 'full' };
    input.document.variables.query = { value: { type: 'string', maxLength: 10 }, initial: '', scope: 'scene-instance' };
    issue(() => validateCompositionPublication(input), 'unsupported_capability');
    input.document.variables = {};
    for (let i = 2; i < 6; i++) input.document.navigation.tabs.push({ ...input.document.navigation.tabs[0], id: `tab-${i}` });
    issue(() => validateCompositionPublication(input), 'unsupported_capability', '/document/navigation/tabs');
  });
  it('negotiates canonical fitted sheets and Dynamic Type grids without changing the frozen profile', () => {
    const publication = fixture(), grid = publication.document.modals[0].components;
    publication.document.modals[0].presentation.height = { type: 'fitted', follows: 'top-page', firstOpen: 'canonical@1' };
    const pageGrid = publication.document.pages[0].components[0];
    if (pageGrid.type !== 'tile-grid') throw Error('Fixture shape changed');
    pageGrid.props.minimum = 'tile-dynamic-type@1';
    issue(() => validateCompositionPublication(publication), 'capability_manifest_mismatch');
    publication.capabilities = compileCompositionDocument(publication.document).capabilities;
    expect(publication.capabilities).toEqual([...firstSliceCapabilities, 'sh.grid-dynamic-type@1', 'sh.sheet-fit@1'].sort());
    expect(validateCompositionPublication(publication).document.modals[0].components).toEqual(grid);
    publication.document.modals[0].presentation.height.follows = 'root';
    expect(validateCompositionPublication(publication).document.modals[0].presentation.height)
      .toEqual({ type: 'fitted', follows: 'root', firstOpen: 'canonical@1' });
  });
  it('checks manifest integrity, digest paths, image bounds and timestamp ordering', () => {
    const publication = fixture();
    publication.assetManifestSha256 = '0'.repeat(64);
    issue(() => validateCompositionPublication(publication), 'asset_integrity');
    publication.document.assets[0].source.path = '/api/assets/../private.png';
    issue(() => validateCompositionPublication(publication), 'invalid_value');
    const dimensions = fixture();
    dimensions.document.assets[0].pixelWidth = 8192; dimensions.document.assets[0].pixelHeight = 8192;
    issue(() => validateCompositionPublication(dimensions), 'limit_exceeded');
    const time = fixture();
    time.updatedAt = '2026-02-30T00:00:00Z';
    issue(() => validateCompositionPublication(time), 'invalid_value');
    time.updatedAt = '2027-01-01T00:00:00Z';
    issue(() => validateCompositionPublication(time), 'invalid_value');
  });
  it('accepts an exact maximum-sized document but rejects one additional byte inside an otherwise valid envelope', () => {
    const publication = fixture();
    const padding = Array.from({ length: 140 }, (_, i) => ({
      id: `padding-${i}`, title: 'Padding', type: 'text' as const, layout: { span: 1 },
      props: { value: { type: 'literal' as const, value: '' }, style: 'body' as const, unavailableText: 'Unavailable' },
    }));
    publication.document.pages[1].components.push(...padding.slice(0, 70));
    publication.document.pages[2].components.push(...padding.slice(70));
    const remaining = MAX_COMPOSITION_BYTES - Buffer.byteLength(canonicalCompositionJSON(publication.document));
    padding.forEach((node, i) => { node.props.value.value = 'x'.repeat(Math.floor(remaining / padding.length) + (i < remaining % padding.length ? 1 : 0)); });
    expect(Buffer.byteLength(canonicalCompositionJSON(publication.document))).toBe(MAX_COMPOSITION_BYTES);
    expect(decodeCompositionPublication(Buffer.from(JSON.stringify(publication))).revision).toBe(1);
    padding[0].props.value.value += 'x';
    issue(() => decodeCompositionPublication(Buffer.from(JSON.stringify(publication))), 'limit_exceeded', '/document');
  });
  it('accepts 256 pages and 256 modals independently, but rejects either catalog overflowing', () => {
    const publication = fixture();
    const page = { ...publication.document.pages[2], components: [] };
    const modal = { ...publication.document.modals[0], components: [] };
    while (publication.document.pages.length < 256)
      publication.document.pages.push({ ...page, id: `page-extra-${publication.document.pages.length}` });
    while (publication.document.modals.length < 256)
      publication.document.modals.push({ ...modal, id: `modal-extra-${publication.document.modals.length}` });
    expect(validateCompositionPublication(publication).document.pages).toHaveLength(256);
    expect(validateCompositionPublication(publication).document.modals).toHaveLength(256);
    publication.document.pages.push({ ...page, id: 'page-overflow' });
    issue(() => validateCompositionPublication(publication), 'limit_exceeded', '/document/pages');
    publication.document.pages.pop();
    publication.document.modals.push({ ...modal, id: 'modal-overflow' });
    issue(() => validateCompositionPublication(publication), 'limit_exceeded', '/document/modals');
  });
});
describe('bounded inert JSON', () => {
  it('detects escaped duplicate keys before parsing and does not echo their values', () => {
    issue(() => parseCompositionJSON(Buffer.from('{"id":"private-a","\\u0069d":"private-b"}')), 'duplicate_key', '/id');
    issue(() => parseCompositionJSON(Buffer.from('{"a":{"x":1,"x":2}}')), 'duplicate_key', '/a/x');
  });
  it('rejects malformed, nonfinite, cyclic, oversized and excessive-depth JSON', () => {
    for (const value of ['[1,]', '{"a":1,}', '{"a":NaN}', '{"a":1e999}', '"\\ud800"', '[01]'])
      issue(() => parseCompositionJSON(Buffer.from(value)), 'invalid_value');
    issue(() => parseCompositionJSON(Buffer.alloc(MAX_COMPOSITION_ENVELOPE_BYTES + 1, 32)), 'limit_exceeded');
    issue(() => parseCompositionJSON(Buffer.from('['.repeat(42) + '0' + ']'.repeat(42))), 'limit_exceeded');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    issue(() => compileCompositionDocument(cycle), 'invalid_value');
  });
  it('canonicalizes asset key order and preserves JSON strings without HTML escaping', () => {
    expect(canonicalCompositionJSON({ z: '/a', a: [true, -0, '😀'] })).toBe('{"a":[true,0,"😀"],"z":"/a"}');
  });
  it('accepts exactly 100000 JSON values and rejects the next value before schema parsing', () => {
    const input = [...Array.from({ length: 99 }, () => Array<number>(1000).fill(0)), Array<number>(899).fill(0)];
    expect(() => assertCompositionBounds(input)).not.toThrow();
    expect(parseCompositionJSON(Buffer.from(JSON.stringify(input)))).toEqual(input);
    input[99].push(0);
    issue(() => assertCompositionBounds(input), 'limit_exceeded');
    issue(() => parseCompositionJSON(Buffer.from(JSON.stringify(input))), 'limit_exceeded');
  });
});

describe('canonically equivalent object keys', () => {
  const composed = '"caf\\u00e9"', decomposed = '"cafe\\u0301"';
  it('rejects a key repeated in another Unicode normal form while parsing', () => {
    issue(() => parseCompositionJSON(Buffer.from(`{"a":{${composed}:1,${decomposed}:2}}`)), 'duplicate_key', '/a/cafe\u0301');
    issue(() => parseCompositionJSON(Buffer.from(`{${decomposed}:1,${composed}:2}`)), 'duplicate_key', '/caf\u00e9');
    issue(() => parseCompositionJSON(Buffer.from('{"\\uac01":1,"\\u1100\\u1161\\u11a8":2}')), 'duplicate_key', '/\u1100\u1161\u11a8');
    expect(parseCompositionJSON(Buffer.from('{"caf\\u00e9":1,"cafe":2}'))).toEqual({ 'caf\u00e9': 1, cafe: 2 });
  });
  it('rejects equivalent keys already parsed into one object, before canonicalization', () => {
    const value = JSON.parse(`{"a":{${composed}:1,${decomposed}:2}}`);
    issue(() => assertCompositionBounds(value), 'duplicate_key', '/a/cafe\u0301');
    expect(() => canonicalCompositionJSON(value)).toThrow(CompositionValidationError);
    expect(() => assertCompositionBounds({ list: [{ 'caf\u00e9': 1 }, { 'caf\u00e9': 2 }] })).not.toThrow();
  });
});
