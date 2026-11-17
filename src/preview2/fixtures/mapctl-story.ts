import type { CompositionDocument } from '../../shared/composition/schema';
import { locateButton, type SurfaceButton, type SurfaceControls } from '../../shared/composition/surface-controls';
import { houseFrom, type House } from '../projections';

/**
 * The story of the map orientation and the corner button groups (lane `vacuum-map-ctl`): the `home-domains` document with one vacuum source and its
 * first page holding one map, drawn for a named scenario. Synthetic `demo_` ids only. Open it at `/?preview2=1&fixture=mapctl&scenario=row-of-three&surface=page:...`.
 */
export const mapctlScenarios = ['default', 'row-of-three', 'column-of-two', 'flip-horizontal', 'flip-vertical', 'flip-both', 'more'] as const;
export type MapctlScenario = typeof mapctlScenarios[number];

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' }) as SurfaceButton['icon'];
const lights: SurfaceButton['action'] = { type: 'call-service', domain: 'light', service: 'toggle', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } };
const button = (id: string, label: string, name: string, action: SurfaceButton['action'] = lights): SurfaceButton => ({ id, icon: symbol(name), label, action });
const dock = button('dock', 'Dock', 'house.fill', { type: 'source-command', command: 'dock' });
const three = [locateButton, dock, button('lights', 'Kitchen Lights', 'lightbulb.fill')];
const names = ['moon.fill', 'bolt.fill', 'leaf.fill', 'flame', 'bell', 'heart', 'sun.max.fill', 'snowflake'];

/** The groups of a scenario, or `undefined` for the default (today's Locate, nothing authored). */
function controlsOf(scenario: MapctlScenario): SurfaceControls | undefined {
  switch (scenario) {
    case 'default': return undefined;
    case 'row-of-three': case 'flip-horizontal': case 'flip-vertical': case 'flip-both': return [{ corner: 'top-trailing', axis: 'row', buttons: three }];
    case 'column-of-two': return [{ corner: 'bottom-leading', axis: 'column', buttons: [dock, button('lights', 'Kitchen Lights', 'lightbulb.fill')] }];
    // Two rows of four share the top edge: on the iPhone each gets half of it, so each shows two buttons and More.
    case 'more': return [{ corner: 'top-leading', axis: 'row', buttons: names.slice(0, 4).map((name, index) => button(`b${index}`, `Button ${index + 1}`, name)) },
      { corner: 'top-trailing', axis: 'row', buttons: names.slice(4).map((name, index) => button(`b${index + 4}`, `Button ${index + 5}`, name)) }];
  }
}

/** The document and house of one scenario, over `base` (the `home-domains` fixture's document; a test reads it from disk, the harness imports it). */
export function mapctlStory(base: CompositionDocument, scenario: MapctlScenario = 'default'): { document: CompositionDocument; house: House } {
  const document = structuredClone(base);
  const controls = controlsOf(scenario);
  const flipHorizontal = scenario === 'flip-horizontal' || scenario === 'flip-both', flipVertical = scenario === 'flip-vertical' || scenario === 'flip-both';
  document.dataSources.push({ id: 'demo-vacuum', kind: 'model', model: 'vacuum@1', inputs: {
    title: 'Demo Robot', entityId: 'vacuum.demo_robot', batteryEntityId: 'sensor.demo_battery', cleanScript: 'script.demo_clean', errorEntityId: 'sensor.demo_error',
    passesEntityId: 'input_select.demo_passes', statusEntityId: 'sensor.demo_status', statusFlagEntityId: 'input_text.demo_flag', vacuumMapId: 'demo_robot', mapRoomSelection: true,
    mapRotationDegrees: 0, mapScale: 1, areaCleaning: { minimumSizeCm: 50, script: 'script.demo_area' }, consumables: [], autoCleanDisabledRooms: [], outcomeRoomNames: [],
    outcomeReconciliations: [], zoneDescription: [], zones: [], ...(flipHorizontal || flipVertical ? { orientation: { flipHorizontal, flipVertical } } : {}),
  } });
  const map = { id: 'demo-map', title: 'Main Floor Map', type: 'vacuum-control', layout: { span: 1 }, props: { sourceId: 'demo-vacuum', primitive: {
    kind: 'map', overlay: 'rooms', height: 300, runtimeHeight: 400, label: 'Main Floor map', loadingText: 'Loading map', unavailableText: 'Map unavailable',
    locate: controls === undefined || controls.some(group => group.buttons.some(item => item.action.type === 'map')), ...(controls ? { controls } : {}) } } };
  document.pages[0] = { ...document.pages[0], components: [map] } as typeof document.pages[number];
  return { document, house: houseFrom({ states: [{ entityId: 'vacuum.demo_robot', name: 'Robot', state: 'docked' }] }) };
}
