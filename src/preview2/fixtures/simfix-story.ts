import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import deviceControls from './device-controls.json';
import { deviceStates } from './device-house';

/**
 * The story of the simulator-fidelity fixes (lane `lsimfix`): a made-up house and four pages added to the device-controls fixture
 * for the status chips, the vacuum tiles and sheet, the room cards and the thermostat. Synthetic `demo_` ids only. Open it at
 * `/?preview2=1&fixture=simfix&surface=page:page-sim-vacuums`.
 */

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string) => ({ type: 'token', name });
const basePage = (id: string, title: string, components: unknown[]) => ({
  id, title, icon: symbol('house'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: { top: space('m'), leading: space('m'), bottom: space('m'), trailing: space('m') }, spacing: space('m'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
  components,
});
const grid = (id: string, title: string, maxColumns: number, children: unknown[], minimum = 'tile-dynamic-type@1') => ({
  id, title, layout: { span: 1 }, type: 'tile-grid', children,
  props: { minimum, maxColumns, spacing: space('m'), equalRowHeights: false, shortRow: 'share', fold: 'page' },
});
const robot = (id: string, title: string, span?: number) => ({
  id, title, type: 'vacuum-control', layout: span === undefined ? {} : { span },
  props: { sourceId: 'demo-vacuum', primitive: { kind: 'card', icon: symbol('robotic.vacuum'), commands: ['start_pause', 'dock'], destination: { type: 'present', modalId: 'modal-demo', arguments: {}, ifPresented: 'reject' } } },
});
const primitive = (id: string, title: string, body: Record<string, unknown>) => ({ id, title, type: 'vacuum-control', layout: { span: 1 }, props: { sourceId: 'demo-vacuum', primitive: body } });
const map = (id: string, overlay: 'rooms' | 'autoClean') => primitive(id, 'Map', { kind: 'map', overlay, height: 260, runtimeHeight: 320, label: 'Main Floor map', loadingText: 'Loading map', unavailableText: 'Map unavailable', locate: true });
const entitySource = (id: string, entityId: string) => ({ id, kind: 'ha-entity', entityId: { type: 'literal', value: entityId } });
const card = (id: string, title: string, sourceId: string, kind: string, icon: string, props: Record<string, unknown> = {}) => ({
  id, title, type: 'room-card', layout: { span: 1 }, icon: symbol(icon), binding: { sourceId, projection: 'room-state@1' },
  props: { kind, showState: true, subtitleSourceIds: [sourceId], activeStates: [], disabledStates: [], stateLabels: [], ...props },
});
const chip = (id: string, title: string, sourceId: string, icon: string, fill?: { red: number; green: number; blue: number }) => ({
  id, title, type: 'status-chip', layout: { span: 1 },
  props: { sourceId, states: [{ state: 'active', appearance: { icon: symbol(icon), ...(fill ? { fill: { type: 'solid-rgb', ...fill } } : { fill: { type: 'standard' } }) } }],
    fallback: { icon: symbol(icon), fill: { type: 'standard' } }, announcement: 'none' },
});
const homeStatus = (id: string, projection: string, entityIds: string[]) => ({
  id, kind: 'model', model: 'home-status@1',
  inputs: { projection, format: 'summary', entityIds: entityIds.map(value => ({ type: 'literal', value })), awayEntityIds: [] },
  labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'None', hidden: 'Hidden' },
});

/** The entities the added pages read, over the device-controls house. */
export const simfixStates: NativeState[] = [
  { entityId: 'light.demo_sim_a', state: 'on', name: 'Lamp A' }, { entityId: 'light.demo_sim_b', state: 'on', name: 'Lamp B' }, { entityId: 'light.demo_sim_c', state: 'off', name: 'Lamp C' },
  { entityId: 'cover.demo_vent_open', state: 'open', name: 'Vent open' }, { entityId: 'cover.demo_vent_closed', state: 'closed', name: 'Vent closed' },
  { entityId: 'binary_sensor.demo_guest_mode', state: 'on', name: 'Guest mode' }, { entityId: 'binary_sensor.demo_party_mode', state: 'off', name: 'Party mode' },
];

/** The device-controls document with the four story pages added, and the house they read. */
export function simfixStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(deviceControls.document) as unknown as CompositionDocument & Record<string, unknown>;
  const pages = [
    basePage('page-sim-chips', 'Chips', [{ id: 'sim-rail', title: 'Chips', type: 'status-rail', layout: { span: 1 }, props: {}, children: [
      chip('sim-chip-lights', 'Lights', 'sim-status-lights', 'lightbulb', { red: 95, green: 53, blue: 16 }), chip('sim-chip-vents', 'Vents', 'sim-status-vents', 'wind'),
    ] }, { id: 'sim-link', title: 'Household', type: 'settings-link', layout: { span: 1 }, icon: symbol('person.2'),
      props: { subtitle: 'Away, presence and relay', hint: 'Opens the household settings.', showsChevron: true },
      action: { type: 'push', pageId: 'page-sim-rooms', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } }]),
    basePage('page-sim-vacuums', 'Robot Vacuums', [
      grid('sim-robots', 'Robot Vacuums', 2, [robot('sim-robot-1', 'Main Floor'), robot('sim-robot-2', 'Studio Robot'), robot('sim-robot-3', 'Basement', 2)]),
      { id: 'sim-auto-section', title: 'Auto-Clean', type: 'section', layout: { span: 1 }, props: { header: 'Auto-Clean', footer: '', style: 'module-list', density: 'dense', hasGlyphs: true, spacing: space('m') },
        children: [primitive('sim-auto', 'Main Floor', { kind: 'auto-clean' })] },
    ]),
    basePage('page-sim-sheet', 'Vacuum sheet', [{ id: 'sim-tabs', title: 'Vacuum sheet', type: 'local-tabs', layout: { span: 1 }, props: { stateId: 'sim-tab', transition: 'canonical-swap@1' }, tabs: [
      { id: 'controls', label: 'Controls', children: [map('sim-map-rooms', 'rooms'), primitive('sim-status', 'Status', { kind: 'status', metric: 'status' })] },
      { id: 'rooms', label: 'Rooms', children: [primitive('sim-notices', 'Notices', { kind: 'notices' })] },
      { id: 'to-clean', label: 'To Clean', children: [map('sim-map-auto', 'autoClean')] },
    ] }]),
    basePage('page-sim-rooms', 'Rooms', [
      grid('sim-cards', 'Room cards', 2, [
        card('sim-vent-open', 'Hall Vent', 'sim-vent-open-source', 'vent', 'wind', { showState: false, subtitleSourceIds: [], activeStates: ['open'] }),
        card('sim-vent-closed', 'Study Vent', 'sim-vent-closed-source', 'vent', 'wind', { showState: false, subtitleSourceIds: [], activeStates: ['open'] }),
        card('sim-lamp-on', 'Lamp A', 'sim-lamp-a-source', 'light', 'lightbulb'), card('sim-lamp-off', 'Lamp C', 'sim-lamp-c-source', 'light', 'lightbulb'),
        card('sim-guest', 'Guest Room', 'sim-guest-source', 'contact', 'bed.double', { visibility: { sourceId: 'sim-guest-source', states: ['on'] } }),
        card('sim-party', 'Party Room', 'sim-party-source', 'contact', 'party.popper', { visibility: { sourceId: 'sim-party-source', states: ['on'] } }),
      ], 'tile@1'),
      { id: 'sim-section-hidden', title: 'Party section', type: 'room-section', layout: { span: 1 }, props: { arrangement: 'grid', leadJoinsAtRegularWidth: false, visibility: { sourceId: 'sim-party-source', states: ['on'] } },
        children: [card('sim-party-inner', 'Party Lamp', 'sim-lamp-a-source', 'light', 'lightbulb')] },
    ]),
  ];
  document.pages = [...document.pages, ...pages] as CompositionDocument['pages'];
  document.dataSources = [...document.dataSources,
    homeStatus('sim-status-lights', 'lights', ['light.demo_sim_a', 'light.demo_sim_b', 'light.demo_sim_c']), homeStatus('sim-status-vents', 'lights', ['light.demo_sim_c']),
    entitySource('sim-vent-open-source', 'cover.demo_vent_open'), entitySource('sim-vent-closed-source', 'cover.demo_vent_closed'),
    entitySource('sim-lamp-a-source', 'light.demo_sim_a'), entitySource('sim-lamp-c-source', 'light.demo_sim_c'),
    entitySource('sim-guest-source', 'binary_sensor.demo_guest_mode'), entitySource('sim-party-source', 'binary_sensor.demo_party_mode'),
  ] as CompositionDocument['dataSources'];
  document.localState = [...(document.localState ?? []), { id: 'sim-tab', type: 'choice', initial: 'controls', options: [{ id: 'controls', label: 'Controls' }, { id: 'rooms', label: 'Rooms' }, { id: 'to-clean', label: 'To Clean' }] }] as CompositionDocument['localState'];
  return { document, house: houseFrom({ states: [...deviceStates, ...simfixStates] }) };
}
