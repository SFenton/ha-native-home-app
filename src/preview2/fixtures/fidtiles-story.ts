import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import deviceControls from './device-controls.json';
import { deviceStates } from './device-house';

/**
 * The story of the tile-fidelity fixes (lane `fidtiles`, task `sim-fidelity`): a made-up house where some rooms have lights on, and five pages
 * added to the device-controls fixture for the Lights overview, the other overviews (occupancy, contacts, air quality, climate), a room page,
 * the Custom Lights page and the Quick Links. Synthetic `demo_fid` ids only. Open it at `/?preview2=1&fixture=fidtiles&surface=page:page-fid-lights`.
 */

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string) => ({ type: 'token', name });
const literal = (value: string) => ({ type: 'literal', value });
const standard = { type: 'standard' };
const basePage = (id: string, title: string, components: unknown[]) => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: { top: space('m'), leading: space('m'), bottom: space('m'), trailing: space('m') }, spacing: space('m'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
  components,
});
const grid = (id: string, title: string, children: unknown[], minimum = 'tile@1', maxColumns = 4) => ({
  id, title, layout: { span: 1 }, type: 'tile-grid', children,
  props: { minimum, maxColumns, spacing: space('m'), equalRowHeights: false, shortRow: 'share', fold: 'page' },
});
const labels = { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'None', hidden: 'Hidden' };
const homeStatus = (id: string, inputs: Record<string, unknown>) => ({
  id, kind: 'model', model: 'home-status@1', labels,
  inputs: { format: 'room', awayEntityIds: [], ...inputs, entityIds: (inputs.entityIds as string[]).map(literal) },
});
const lightSource = (id: string, entityId: string, members: string[] = []) => ({
  id, kind: 'model', model: 'home-light@1', inputs: { entityId: literal(entityId), ...(members.length ? { memberEntityIds: members.map(literal) } : {}) },
});
const entitySource = (id: string, entityId: string) => ({ id, kind: 'ha-entity', entityId: literal(entityId) });
const appearance = (icon: string) => ({ icon: symbol(icon), fill: standard });
const overview = (id: string, title: string, sourceId: string, icon: string, hidesContactSubtitle = false) => ({
  id, title, type: 'room-overview-tile', layout: { span: 1 },
  props: { sourceId, states: [], fallback: appearance(icon), announcement: 'none', hidesContactSubtitle },
  action: { type: 'push', pageId: 'page-fid-room', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
});
/** The Lights overview's grid: one tile per room, with the rooms' ids prefixed so the page and the sheet can both hold one. */
const lightRooms = (prefix: string) => grid(`${prefix}-grid`, 'Lights', [
  overview(`${prefix}-living`, 'Living Room', 'fid-st-living', 'lightbulb'), overview(`${prefix}-bed`, 'Bedroom', 'fid-st-bed', 'lightbulb'),
  overview(`${prefix}-kitchen`, 'Kitchen', 'fid-st-kitchen', 'lightbulb'), overview(`${prefix}-office`, 'Office', 'fid-st-office', 'lightbulb'),
  overview(`${prefix}-hall`, 'Hall', 'fid-st-hall', 'lightbulb'),
]);
const roomCard = (id: string, title: string, sourceId: string, kind: string, icon: string, props: Record<string, unknown> = {}) => ({
  id, title, type: 'room-card', layout: { span: 1 }, icon: symbol(icon), binding: { sourceId, projection: 'room-state@1' },
  props: { kind, showState: true, subtitleSourceIds: [], activeStates: [], disabledStates: [], stateLabels: [], ...props },
});
/** The light tiles leave `layout.span` unset, so the grid gives each the tracks its content needs. */
const lightTile = (id: string, title: string, sourceId: string) => ({ id, title, type: 'light-group-tile', layout: {}, props: { sourceId } });
const brightness = (id: string, title: string, entityId: string, withAction: boolean) => ({
  id, title, type: 'custom-light-control', layout: {},
  props: { sourceId: 'fid-custom-lights', kind: 'brightness', entityId, ...(withAction ? { action: { type: 'present', modalId: 'modal-demo', arguments: {}, ifPresented: 'reject' } } : {}) },
});
const alarmState = (state: string, icon: string, red: number, green: number, blue: number, text: string) =>
  ({ state, appearance: { icon: symbol(icon), fill: { type: 'solid-rgb', red, green, blue }, text } });
const securityTile = {
  id: 'fid-quick-security', title: 'Security System', type: 'navigation-tile', layout: { span: 1 }, icon: symbol('shield'),
  props: {
    family: 'neutral', selected: 'none', subtitle: literal(''), presentation: { layout: 'standard', titleLines: 1, fill: standard },
    alarm: {
      sourceId: 'fid-alarm', projection: 'alarm-navigation@1',
      states: [alarmState('disarmed', 'shield.slash', 67, 160, 71, 'Disarmed'), alarmState('armed_home', 'house.fill', 30, 136, 229, 'Armed Home'),
        alarmState('armed_away', 'shield.fill', 229, 57, 53, 'Armed Away'), alarmState('armed_night', 'moon.fill', 142, 36, 170, 'Armed Night')],
      fallback: { icon: symbol('shield'), fill: { type: 'solid-rgb', red: 84, green: 110, blue: 122 }, text: 'Unknown' },
      loadingText: 'Loading', unavailableText: 'Unavailable', errorText: 'Didn’t Respond', hiddenText: 'Hidden',
    },
  },
  action: { type: 'push', pageId: 'page-fid-room', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
};
const plainTile = {
  id: 'fid-quick-chores', title: 'Chores', type: 'navigation-tile', layout: { span: 1 }, icon: symbol('checklist'),
  props: { family: 'neutral', selected: 'none', subtitle: literal('') }, action: { type: 'push', pageId: 'page-fid-room', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' },
};

/** The entities the added pages read. Lights on in the Living Room (one of two), the Bedroom (both) and the Kitchen (its one); the Office and the Hall are off or gone. */
export const fidtilesStates: NativeState[] = [
  { entityId: 'light.demo_fid_living_a', state: 'on', name: 'Living A', brightness: 200, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_living_b', state: 'off', name: 'Living B', supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_bed_a', state: 'on', name: 'Bed A', brightness: 120, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_bed_b', state: 'on', name: 'Bed B', brightness: 255, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_kitchen', state: 'on', name: 'Kitchen', brightness: 255, supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_office', state: 'off', name: 'Office', supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_office_group', state: 'off', name: 'Office group', supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_hall', state: 'unavailable', name: 'Hall', supportedColorModes: ['brightness'] },
  { entityId: 'light.demo_fid_dimmer', state: 'on', name: 'Dimmer', brightness: 128, rgbColor: [255, 190, 90], supportedColorModes: ['rgb'] },
  { entityId: 'light.demo_fid_plain', state: 'on', name: 'Plain', supportedColorModes: ['onoff'] },
  { entityId: 'light.demo_fid_plain_off', state: 'off', name: 'Plain off', supportedColorModes: ['onoff'] },
  { entityId: 'light.demo_fid_dead', state: 'unavailable', name: 'Dead' },
  { entityId: 'binary_sensor.demo_fid_occ_a', state: 'on', name: 'Occupancy A' }, { entityId: 'binary_sensor.demo_fid_occ_b', state: 'off', name: 'Occupancy B' },
  { entityId: 'binary_sensor.demo_fid_contact_window', state: 'on', name: 'Window' }, { entityId: 'binary_sensor.demo_fid_contact_door', state: 'off', name: 'Door' },
  { entityId: 'sensor.demo_fid_aqi', state: '42', name: 'AQI' }, { entityId: 'sensor.demo_fid_pm25', state: '9.5', name: 'PM2.5', unit: 'µg/m³' },
  { entityId: 'input_text.demo_fid_aqi_color', state: 'rgb(220, 120, 30)', name: 'AQI colour' },
  { entityId: 'input_text.demo_fid_range', state: '70.04°F - 72.99°F', name: 'Range' },
  { entityId: 'sensor.demo_fid_temp_a', state: '70.24', name: 'Temp A', unit: '°F' }, { entityId: 'sensor.demo_fid_temp_b', state: '72.18', name: 'Temp B', unit: '°F' },
  { entityId: 'cover.demo_fid_vent_open', state: 'open', name: 'Vent open', currentPosition: 60 }, { entityId: 'cover.demo_fid_vent_closed', state: 'closed', name: 'Vent closed' },
  { entityId: 'binary_sensor.contact_demo_fid_card', state: 'on', name: 'Contact card' }, { entityId: 'binary_sensor.contact_demo_fid_card_closed', state: 'off', name: 'Contact card closed' },
  { entityId: 'alarm_control_panel.demo_fid', state: 'armed_away', name: 'Alarm' },
];

/** The device-controls document with the five story pages added, and the house they read. */
export function fidtilesStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(deviceControls.document) as unknown as CompositionDocument & Record<string, unknown>;
  const pages = [
    basePage('page-fid-lights', 'Lights', [lightRooms('fid-lights')]),
    basePage('page-fid-overview', 'Overviews', [grid('fid-overview-grid', 'Overviews', [
      overview('fid-ov-occ-a', 'Occupied Room', 'fid-st-occ-a', 'figure.walk'), overview('fid-ov-occ-b', 'Empty Room', 'fid-st-occ-b', 'figure.walk'),
      overview('fid-ov-contact', 'Contacts', 'fid-st-contact', 'door.left.hand.open', true), overview('fid-ov-contact-shown', 'Contacts shown', 'fid-st-contact', 'door.left.hand.open'),
      overview('fid-ov-air', 'Air Quality', 'fid-st-air', 'aqi.medium'), overview('fid-ov-range', 'Climate range', 'fid-st-range', 'thermometer.medium'),
      overview('fid-ov-sensors', 'Climate sensors', 'fid-st-sensors', 'thermometer.medium'),
    ])]),
    basePage('page-fid-room', 'Room', [
      grid('fid-room-lights', 'Lights', [
        lightTile('fid-room-dim', 'Living Room Lights', 'fid-light-dim'), lightTile('fid-room-plain', 'Porch Light', 'fid-light-plain'),
        lightTile('fid-room-off', 'Study Lights', 'fid-light-off'), lightTile('fid-room-dead', 'Garage Lights', 'fid-light-dead'),
      ]),
      grid('fid-room-cards', 'Cards', [
        roomCard('fid-vent-open', 'Hall Vent', 'fid-vent-open-source', 'vent', 'wind', { activeStates: ['open'] }),
        roomCard('fid-vent-closed', 'Study Vent', 'fid-vent-closed-source', 'vent', 'wind', { activeStates: ['open'] }),
        roomCard('fid-contact-plain', 'Window', 'fid-contact-card-source', 'contact', 'window.vertical.open', { showState: false }),
        roomCard('fid-contact-state', 'Window state', 'fid-contact-card-source', 'contact', 'window.vertical.open', { showState: true }),
        roomCard('fid-contact-closed', 'Closed window', 'fid-contact-closed-source', 'contact', 'window.vertical.open', { showState: true }),
        roomCard('fid-light-card', 'Lamp', 'fid-lamp-source', 'light', 'lightbulb'),
        roomCard('fid-source-line', 'Vent with a line', 'fid-vent-open-source', 'vent', 'wind', { showState: false, subtitleSourceIds: ['fid-vent-open-source'], activeStates: ['open'] }),
      ], 'tile@1', 2),
    ]),
    basePage('page-fid-custom-lights', 'Custom Lights', [grid('fid-custom-grid', 'Custom Lights', [
      brightness('fid-cl-living', 'Living Room Lamp', 'light.demo_fid_dimmer', true), brightness('fid-cl-bed', 'Bedroom Reading Light', 'light.demo_fid_bed_a', true),
      brightness('fid-cl-off', 'Office Lamp', 'light.demo_fid_office', true), brightness('fid-cl-dead', 'Hall Sconce', 'light.demo_fid_dead', false),
    ], 'tile@1', 4)]),
    basePage('page-fid-quick', 'Quick Links', [grid('fid-quick-grid', 'Quick Links', [securityTile, plainTile], 'tile@1', 2)]),
  ];
  document.pages = [...document.pages, ...pages] as CompositionDocument['pages'];
  // The Lights chip's sheet: the same grid in a sheet that follows the device's appearance (`presentation.appearance: system`).
  const sheet = structuredClone(document.modals.find(item => item.id === 'modal-demo')!) as unknown as Record<string, unknown>;
  document.modals = [...document.modals, { ...sheet, id: 'modal-fid-lights', title: 'Lights', components: [lightRooms('fid-sheet')] }] as CompositionDocument['modals'];
  const room = (id: string, entityIds: string[], range?: string, members?: string[]) => homeStatus(id, {
    projection: 'lights', entityIds, ...(range ? { rangeEntityId: literal(range) } : {}),
    ...(members ? { members: members.map(entityId => ({ entityId: literal(entityId), title: entityId.split('.')[1].replace(/^demo_fid_/, ''), contactCount: 1, contactKind: 'window' })) } : {}),
  });
  document.dataSources = [...document.dataSources,
    room('fid-st-living', ['light.demo_fid_living_a', 'light.demo_fid_living_b']), room('fid-st-bed', ['light.demo_fid_bed_a', 'light.demo_fid_bed_b']),
    room('fid-st-kitchen', ['light.demo_fid_kitchen']), room('fid-st-office', ['light.demo_fid_office'], 'light.demo_fid_office_group'), room('fid-st-hall', ['light.demo_fid_hall']),
    homeStatus('fid-st-occ-a', { projection: 'occupancy', entityIds: ['binary_sensor.demo_fid_occ_a'] }), homeStatus('fid-st-occ-b', { projection: 'occupancy', entityIds: ['binary_sensor.demo_fid_occ_b'] }),
    homeStatus('fid-st-contact', { projection: 'contacts', entityIds: ['binary_sensor.demo_fid_contact_window', 'binary_sensor.demo_fid_contact_door'],
      members: ['binary_sensor.demo_fid_contact_window', 'binary_sensor.demo_fid_contact_door'].map((entityId, at) => ({ entityId: literal(entityId), title: at ? 'Door' : 'Window', contactCount: 1, contactKind: at ? 'door' : 'window' })) }),
    homeStatus('fid-st-air', { projection: 'air-quality', entityIds: ['sensor.demo_fid_aqi'], secondaryEntityId: literal('sensor.demo_fid_pm25'), colorEntityId: literal('input_text.demo_fid_aqi_color') }),
    homeStatus('fid-st-range', { projection: 'climate', entityIds: ['sensor.demo_fid_temp_a'], rangeEntityId: literal('input_text.demo_fid_range') }),
    homeStatus('fid-st-sensors', { projection: 'climate', entityIds: ['sensor.demo_fid_temp_a', 'sensor.demo_fid_temp_b'] }),
    lightSource('fid-light-dim', 'light.demo_fid_dimmer'), lightSource('fid-light-plain', 'light.demo_fid_plain'), lightSource('fid-light-off', 'light.demo_fid_office'), lightSource('fid-light-dead', 'light.demo_fid_dead'),
    entitySource('fid-vent-open-source', 'cover.demo_fid_vent_open'), entitySource('fid-vent-closed-source', 'cover.demo_fid_vent_closed'),
    entitySource('fid-contact-card-source', 'binary_sensor.contact_demo_fid_card'), entitySource('fid-contact-closed-source', 'binary_sensor.contact_demo_fid_card_closed'),
    entitySource('fid-lamp-source', 'light.demo_fid_dimmer'),
    { id: 'fid-custom-lights', kind: 'model', model: 'custom-lights@1', inputs: {
      sectionTitle: 'Fidelity', manualTitle: 'Manual', modeTitle: 'Mode', manualEntityId: 'input_boolean.demo_manual', modeEntityId: 'input_select.demo_mode', groupEntityId: 'light.demo_group',
      customMode: 'Custom', fallbackModes: ['Warm White', 'Custom'], palettes: [], resetKelvin: 2700, resetBrightness: 255, resetTransition: 1,
      lights: [['Living Room Lamp', 'light.demo_fid_dimmer'], ['Bedroom Reading Light', 'light.demo_fid_bed_a'], ['Office Lamp', 'light.demo_fid_office'], ['Hall Sconce', 'light.demo_fid_dead']].map(([title, entityId]) => ({ title, entityId })) } },
    { id: 'fid-alarm', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: literal('alarm_control_panel.demo_fid') } },
  ] as CompositionDocument['dataSources'];
  return { document, house: houseFrom({ states: [...deviceStates, ...fidtilesStates] }) };
}
