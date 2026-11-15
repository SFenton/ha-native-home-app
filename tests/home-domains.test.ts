import { describe, expect, it } from 'vitest';
import { componentLocations, compositionEditorSchema, fieldVariants, resolveField, nodeDefinition } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { climatePropsSchema } from '../src/shared/composition/climate';
import fixture from '../src/preview2/fixtures/home-domains.json';

const compile = () => compileCompositionDocument(structuredClone(fixture.document));

describe('Home domain production recipes', () => {
  it('compiles every overview, weather presentation, security and climate route and camera viewer', () => {
    const result = compile();
    expect(result.capabilities).toEqual(fixture.capabilities);
    const locations = componentLocations(result.document);
    const weather = locations.flatMap(({ node }) => node.type === 'weather-panel' ? [node.props.panel] : []);
    expect(new Set(weather)).toEqual(new Set(['summary', 'hero', 'briefing', 'hourly', 'daily', 'highlights']));
    expect(result.document.modals.filter(x => x.id.startsWith('hc-overview-'))).toHaveLength(5);
    expect(locations.some(({ node }) => node.type === 'camera-viewer')).toBe(true);
    expect(locations.some(({ node }) => node.type === 'alarm-panel')).toBe(true);
    const tabs = locations.find(({ node }) => node.type === 'local-tabs')?.node;
    expect(tabs?.type === 'local-tabs' && tabs.tabs.map(tab => tab.id)).toEqual(['rooms', 'automation', 'tracking']);
    expect(locations.filter(({ node }) => node.type === 'climate-control' && node.props.kind === 'options')).toHaveLength(2);
  });

  it('rejects off-scope contact metadata and non-readable visibility sources', () => {
    const { document } = compile();
    const contact = document.dataSources.find(source => source.kind === 'model' && source.model === 'home-status@1' && source.inputs.members?.length);
    if (contact?.kind !== 'model' || contact.model !== 'home-status@1') throw new Error('Missing contact recipe');
    contact.inputs.members![0].entityId.value = 'binary_sensor.demo_not_a_member';
    expect(() => compileCompositionDocument(document)).toThrow();
    const other = compile().document;
    const index = other.dataSources.findIndex(source => source.id === 'hc-guests-status');
    other.dataSources[index] = { id: 'hc-guests-status', kind: 'model', model: 'power-toggle@1',
      inputs: { entityId: { type: 'literal', value: 'switch.demo_guest' } } };
    expect(() => compileCompositionDocument(other)).toThrow();
    const itemDocument = compile().document;
    const item = itemDocument.dataSources.find(source => source.kind === 'model' && source.model === 'home-status@1' && source.inputs.format === 'item');
    if (item?.kind !== 'model' || item.model !== 'home-status@1') throw new Error('Missing member tile');
    item.inputs.entityIds.push({ type: 'literal', value: 'sensor.demo_unexpected_second_member' });
    expect(() => compileCompositionDocument(itemDocument)).toThrow();
  });

  it('accepts 1000 sources and rejects the next source at the shared JSON container bound', () => {
    const { document } = compile();
    while (document.dataSources.length < 1000) document.dataSources.push({
      id: `extra-source-${document.dataSources.length}`, kind: 'ha-entity',
      entityId: { type: 'literal', value: `sensor.demo_extra_${document.dataSources.length}` },
    });
    expect(compileCompositionDocument(document).document.dataSources).toHaveLength(1000);
    document.dataSources.push({ id: 'overflow', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_overflow' } });
    expect(() => compileCompositionDocument(document)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ code: 'limit_exceeded', pointer: '/dataSources' })]),
    }));
  });

  it('exposes new prediction and metadata fields through the generated inspector and keeps them closed', () => {
    const nodeSchema = nodeDefinition();
    const node = fieldVariants(nodeSchema!).find(variant => variant.properties?.type?.const === 'climate-control');
    const props = fieldVariants(resolveField(node!.properties!.props)!);
    const explicit = props.find(variant => variant.properties?.kind?.const === 'explicit-switch');
    expect(explicit?.properties?.status).toBeDefined();
    expect(props.find(variant => variant.properties?.kind?.const === 'room-tile')?.properties?.paletteIndex).toBeDefined();
    expect(props.find(variant => variant.properties?.kind?.const === 'status')?.properties?.presentation).toBeDefined();
    expect(node?.properties?.action).toBeDefined();
    const power = fieldVariants(nodeSchema!).find(variant => variant.properties?.type?.const === 'action-tile');
    expect(resolveField(power!.properties!.props)?.properties?.powerLabels).toBeDefined();
    const control = componentLocations(compile().document).find(({ node }) => node.type === 'climate-control' && node.props.kind === 'explicit-switch')?.node;
    if (control?.type !== 'climate-control') throw new Error('Missing predictive recipe');
    expect(climatePropsSchema.safeParse({ ...control.props, connection: {} }).success).toBe(false);
    expect(climatePropsSchema.safeParse({ ...control.props, status: { projection: 'eval', unit: '°F', states: [], fallbackText: 'Unknown' } }).success).toBe(false);
    const document = compile().document;
    const configured = componentLocations(document).find(({ node }) => node.type === 'climate-control' && node.props.kind === 'explicit-switch')?.node;
    if (configured?.type !== 'climate-control' || configured.props.kind !== 'explicit-switch' || !configured.props.status) throw new Error('Missing status');
    configured.props.status.states.push(structuredClone(configured.props.status.states[0]));
    expect(() => compileCompositionDocument(document)).toThrow();
  });

  it('pins room power to its status membership and rejects navigation on non-navigation climate atoms', () => {
    const document = compile().document;
    const tile = componentLocations(document).find(({ node }) => node.type === 'room-overview-tile' && node.props.powerSourceId)?.node;
    if (tile?.type !== 'room-overview-tile') throw new Error('Missing room power disc');
    const source = document.dataSources.find(source => source.id === tile.props.powerSourceId);
    if (source?.kind !== 'model' || source.model !== 'home-light@1') throw new Error('Missing group light source');
    source.inputs.memberEntityIds = [{ type: 'literal', value: 'light.demo_wrong_room' }];
    expect(() => compileCompositionDocument(document)).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_combination' })]),
    }));
    const other = compile().document;
    const room = componentLocations(other).find(({ node }) => node.type === 'climate-control' && node.props.kind === 'room-tile')?.node;
    if (room?.type !== 'climate-control' || !room.action) throw new Error('Missing room navigation');
    const command = componentLocations(other).find(({ node }) => node.type === 'climate-control' && node.props.kind === 'toggle')?.node;
    if (command?.type !== 'climate-control') throw new Error('Missing toggle');
    command.action = structuredClone(room.action);
    expect(() => compileCompositionDocument(other)).toThrow();
    delete command.action;
    delete room.action;
    expect(() => compileCompositionDocument(other)).toThrow();
  });
});
