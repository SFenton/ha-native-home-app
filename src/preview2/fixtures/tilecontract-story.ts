import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import { fidtilesStory } from './fidtiles-story';

/**
 * The story of the tile contract lane (`sh.tile-swipe@1`, `sh.state-words@1`, `sh.tile-ink-default@1`, `sh.grid-state-groups@1`; task `sim-fidelity`):
 * the tile-fidelity story's house with four pages added, one for each id. Synthetic `demo_tc` ids only. Open it at `/?preview2=1&fixture=tilecontract&surface=page:page-tc-swipe`.
 */
const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string) => ({ type: 'token', name });
const literal = (value: unknown) => ({ type: 'literal', value });
const read = (sourceId: string, path: string[]) => ({ type: 'read', from: { type: 'source', sourceId, path }, as: 'number', missing: 'unavailable' });
const control = { type: 'control' };
const page = (id: string, title: string, components: unknown[]) => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: { top: space('m'), leading: space('m'), bottom: space('m'), trailing: space('m') }, spacing: space('m'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
  components,
});
const grid = (id: string, title: string, children: unknown[], props: Record<string, unknown> = {}) => ({
  id, title, layout: { span: 1 }, type: 'tile-grid', children,
  props: { minimum: 'tile@1', maxColumns: 4, spacing: space('m'), equalRowHeights: false, shortRow: 'share', fold: 'page', ...props },
});
const entitySource = (id: string, entityId: string) => ({ id, kind: 'ha-entity', entityId: literal(entityId) });
const lightSource = (id: string, entityId: string) => ({ id, kind: 'model', model: 'home-light@1', inputs: { entityId: literal(entityId) } });
const service = (domain: string, name: string, entityId: string, field: string, value: unknown = control) => ({
  type: 'call-service', domain, service: name, target: { entity_id: literal(entityId) }, data: { type: 'object', fields: { [field]: value } },
});
const percent = { min: 0, max: 100, step: 1 };
const swipeOf = (range: unknown, rest: Record<string, unknown>) => ({ axis: 'horizontal', range, commit: 'release', ...rest });
const lightTile = (id: string, title: string, sourceId: string, props: Record<string, unknown> = {}) => ({ id, title, type: 'light-group-tile', layout: {}, props: { sourceId, ...props } });
const stateTile = (id: string, title: string, entityId: string, icon: string, swipe: unknown, binding: Record<string, unknown> = {}, rest: Record<string, unknown> = {}) => ({
  id, title, type: 'state-tile', layout: {}, icon: symbol(icon), binding: { entityId, styleId: `tc-${entityId.split('.')[0]}`, ...binding }, props: { ...(swipe ? { swipe } : {}) }, ...rest,
});
const demoStyle = (domain: string) => ({
  id: `tc-${domain}`, name: `Story ${domain}`, domain,
  rules: [{ states: ['on', 'open', 'playing', 'heat', 'cool'], class: 'resting', active: true }, { states: ['off', 'closed', 'idle', 'paused'], class: 'resting', active: false }, { states: ['unavailable', 'unknown'], class: 'unknown', active: false }],
  fallback: { class: 'resting', active: false },
});

/** The entities the story's pages read. */
export const tilecontractStates: NativeState[] = [
  { entityId: 'light.demo_tc_lamp', state: 'on', name: 'Lamp', brightness: 128, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_tc_plain', state: 'on', name: 'Plain lamp', brightness: 200, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_tc_dark', state: 'off', name: 'Dark lamp', supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_tc_switch', state: 'on', name: 'Switch lamp', supportedColorModes: ['onoff'] },
  { entityId: 'light.demo_tc_dead', state: 'unavailable', name: 'Dead lamp', supportedColorModes: ['brightness'] },
  { entityId: 'cover.demo_tc_blinds', state: 'open', name: 'Blinds', currentPosition: 40 },
  { entityId: 'cover.demo_tc_garage', state: 'closed', name: 'Garage door', currentPosition: 0, deviceClass: 'garage' },
  { entityId: 'fan.demo_tc_fan', state: 'on', name: 'Fan', percentage: 30, percentageStep: 10 },
  { entityId: 'climate.demo_tc_thermostat', state: 'heat', name: 'Thermostat', temperature: 72, minTemp: 60, maxTemp: 85, targetTempStep: 0.5 },
  { entityId: 'media_player.demo_tc_speaker', state: 'playing', name: 'Speaker', volumeLevel: 0.3 },
];

const swipePage = () => page('page-tc-swipe', 'Swipe', [
  grid('tc-swipe-grid', 'Swipe', [
    lightTile('tc-light-swipe', 'Study Lights', 'tc-src-lamp', { swipe: swipeOf(percent, {}) }),
    lightTile('tc-light-plain', 'Hall Lights', 'tc-src-plain'),
    lightTile('tc-light-off', 'Dark Lights', 'tc-src-dark', { swipe: swipeOf(percent, {}) }),
    lightTile('tc-light-dead', 'Gone Lights', 'tc-src-dead', { swipe: swipeOf(percent, {}) }),
    stateTile('tc-cover', 'Blinds', 'cover.demo_tc_blinds', 'blinds.horizontal.open', swipeOf(percent, {
      value: read('tc-e-blinds', ['attributes', 'current_position']), action: service('cover', 'set_cover_position', 'cover.demo_tc_blinds', 'position'), label: 'position', format: '{value}%', detent: 10,
    }), { builtIn: 'blind', styleId: undefined }),
    stateTile('tc-fan', 'Fan', 'fan.demo_tc_fan', 'fan', swipeOf({ min: 0, max: 100, step: 10 }, {
      value: read('tc-e-fan', ['attributes', 'percentage']), action: service('fan', 'set_percentage', 'fan.demo_tc_fan', 'percentage'), label: 'speed', format: '{value}%', detent: 20,
    })),
    stateTile('tc-climate', 'Thermostat', 'climate.demo_tc_thermostat', 'thermometer', swipeOf({ min: 60, max: 85, step: 0.5 }, {
      value: read('tc-e-thermostat', ['attributes', 'temperature']), action: service('climate', 'set_temperature', 'climate.demo_tc_thermostat', 'temperature'), label: 'temperature', format: '{value}°', detent: 1, band: false,
    })),
    stateTile('tc-volume', 'Speaker', 'media_player.demo_tc_speaker', 'speaker.wave.2', swipeOf(percent, {
      value: { type: 'math', op: 'round', args: [{ type: 'math', op: 'multiply', args: [read('tc-e-speaker', ['attributes', 'volume_level']), literal(100)] }] },
      action: service('media_player', 'volume_set', 'media_player.demo_tc_speaker', 'volume_level', { type: 'math', op: 'divide', args: [control, literal(100)] }), label: 'volume', format: '{value}%', detent: 10,
    })),
    stateTile('tc-garage', 'Garage', 'cover.demo_tc_garage', 'door.garage.closed', null, { builtIn: 'garage-door', styleId: undefined }),
  ]),
  { id: 'tc-row', title: 'Sideways', type: 'paged-row', layout: { span: 1 }, props: { perPage: 2, pageLabel: 'Page', showsIndicator: true }, children: [
    stateTile('tc-row-cover', 'Row Blinds', 'cover.demo_tc_blinds', 'blinds.horizontal.open', swipeOf(percent, {
      value: read('tc-e-blinds', ['attributes', 'current_position']), action: service('cover', 'set_cover_position', 'cover.demo_tc_blinds', 'position'), label: 'position', format: '{value}%',
    }), { builtIn: 'blind', styleId: undefined }),
    stateTile('tc-row-plain', 'Row Plain', 'cover.demo_tc_garage', 'door.garage.closed', null, { builtIn: 'garage-door', styleId: undefined }),
  ] },
]);

/** The fidelity story's document with the tile contract pages added, and the house they read. */
/** The words page: the same lights twice, drawn with the app's words and with authored ones (`sh.state-words@1`). */
const words = { on: 'Lit', off: 'All Dark', unavailable: 'No Signal', level: 'Glowing {value}%' };
const wordsPage = () => page('page-tc-words', 'State Words', [
  grid('tc-words-default', 'Default words', [
    lightTile('tc-w-lamp', 'Study Lights', 'tc-src-lamp'), lightTile('tc-w-dark', 'Dark Lights', 'tc-src-dark'), lightTile('tc-w-dead', 'Dead Lights', 'tc-src-dead'), lightTile('tc-w-switch', 'Switch Lights', 'tc-src-switch'),
  ]),
  grid('tc-words-authored', 'Authored words', [
    lightTile('tc-w2-lamp', 'Study Lights', 'tc-src-lamp', { words }), lightTile('tc-w2-dark', 'Dark Lights', 'tc-src-dark', { words }), lightTile('tc-w2-dead', 'Dead Lights', 'tc-src-dead', { words }), lightTile('tc-w2-switch', 'Switch Lights', 'tc-src-switch', { words }),
  ]),
]);

/** The groups page: the lights grid grouped by state, On then Off (Off holds the idle and the unavailable ones), and one grid with no On tile (`sh.grid-state-groups@1`). */
const groupsPage = () => page('page-tc-groups', 'Lights', [
  grid('tc-groups-grid', 'Lights', [
    lightTile('tc-g-dark', 'Dark Lights', 'tc-src-dark'), lightTile('tc-g-lamp', 'Study Lights', 'tc-src-lamp'), lightTile('tc-g-dead', 'Dead Lights', 'tc-src-dead'),
    lightTile('tc-g-plain', 'Hall Lights', 'tc-src-plain'), lightTile('tc-g-switch', 'Switch Lights', 'tc-src-switch'), lightTile('tc-g-dark2', 'Attic Lights', 'tc-src-dark'),
  ], { groups: { by: 'state', items: [{ id: 'group-on', title: 'Lights On', states: ['active'] }, { id: 'group-off', title: 'Lights Off', states: ['idle', 'unavailable'] }] } }),
  grid('tc-groups-off', 'Nothing on', [lightTile('tc-g2-dark', 'Dark Lights', 'tc-src-dark'), lightTile('tc-g2-dead', 'Dead Lights', 'tc-src-dead')],
    { groups: { by: 'state', items: [{ id: 'group-on', title: 'Lights On', states: ['active'] }, { id: 'group-off', title: 'Lights Off', states: ['idle', 'unavailable'] }] } }),
  grid('tc-groups-ungrouped', 'Ungrouped', [lightTile('tc-g3-dark', 'Dark Lights', 'tc-src-dark'), lightTile('tc-g3-lamp', 'Study Lights', 'tc-src-lamp')]),
]);

/** The ink page: tiles with no family of their own, idle, lit and unavailable (`sh.tile-ink-default@1`). */
const inkPage = () => page('page-tc-ink', 'Tile Ink', [
  grid('tc-ink-grid', 'Ink', [
    stateTile('tc-ink-garage', 'Garage', 'cover.demo_tc_garage', 'door.garage.closed', null, { builtIn: 'garage-door', styleId: undefined }),
    stateTile('tc-ink-blinds', 'Blinds', 'cover.demo_tc_blinds', 'blinds.horizontal.open', null, { builtIn: 'blind', styleId: undefined }),
    lightTile('tc-ink-dark', 'Dark Lights', 'tc-src-dark'), lightTile('tc-ink-lit', 'Study Lights', 'tc-src-lamp'), lightTile('tc-ink-dead', 'Dead Lights', 'tc-src-dead'),
    lightTile('tc-ink-switch', 'Switch Lights', 'tc-src-switch'),
  ]),
]);

export function tilecontractStory(): { document: CompositionDocument; house: House } {
  const story = fidtilesStory();
  const document = story.document as CompositionDocument & Record<string, unknown>;
  document.pages = [...document.pages, swipePage(), wordsPage(), inkPage(), groupsPage()] as CompositionDocument['pages'];
  document.dataSources = [...document.dataSources,
    lightSource('tc-src-lamp', 'light.demo_tc_lamp'), lightSource('tc-src-plain', 'light.demo_tc_plain'), lightSource('tc-src-dark', 'light.demo_tc_dark'), lightSource('tc-src-dead', 'light.demo_tc_dead'), lightSource('tc-src-switch', 'light.demo_tc_switch'),
    entitySource('tc-e-blinds', 'cover.demo_tc_blinds'), entitySource('tc-e-fan', 'fan.demo_tc_fan'), entitySource('tc-e-thermostat', 'climate.demo_tc_thermostat'), entitySource('tc-e-speaker', 'media_player.demo_tc_speaker'),
  ] as CompositionDocument['dataSources'];
  document.stateStyles = { type: 'state-styles@1', styles: ['fan', 'climate', 'media_player'].map(demoStyle) } as CompositionDocument['stateStyles'];
  return { document, house: houseFrom({ states: [...story.house.states!.values(), ...tilecontractStates] }) };
}
