import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { houseFrom, type House } from '../projections';
import deviceControls from './device-controls.json';
import { deviceStates } from './device-house';

/**
 * The story of the panel-fidelity fixes (lane `fidpanels`, `build/research/sim-fidelity-classify.md` items 5, 9, 12, 13 and 16): a made-up house and
 * the surfaces that show them, over the device-controls fixture. A security sheet whose alarm panel has a known mode (so its chosen mode draws) with
 * a lock door tile, a thermostat sheet with the single-target hero, the range hero and the hub, and a sheet that declares `dark` (item 11's appearance check), and a Car page of settings rows in a two-column
 * grid. Synthetic `demo_` ids only. Open it at `/?preview2=1&fixture=fidpanels&surface=modal:modal-fid-security`.
 */

const symbol = (name: string) => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });
const space = (name: string) => ({ type: 'token', name });
const solid = (red: number, green: number, blue: number) => ({ type: 'solid-rgb', red, green, blue });
const literal = (value: string) => ({ type: 'literal', value });

const sheet = (id: string, title: string, components: unknown[], appearance: 'system' | 'dark' = 'system') => ({
  id, title, icon: symbol('slider.horizontal.3'), parameters: {}, toolbar: { type: 'replace', groups: [] },
  layout: { type: 'column', padding: { top: space('m'), leading: space('l'), bottom: space('m'), trailing: space('l') }, spacing: space('xl'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
  presentation: { type: 'sheet', width: 'form', height: { type: 'full' }, appearance, placement: 'canonical-sheet@1', grabber: 'canonical', navigation: 'local-stack@1',
    close: { type: 'close', visibility: 'root-only', placement: 'trailing', rail: 'keep-horizontal-when-allowed', guard: { type: 'none' } } },
  components,
});
const page = (id: string, title: string, components: unknown[]) => ({
  id, title, icon: symbol('car'), parameters: {}, navigation: { type: 'stack' }, toolbar: { type: 'inherit' },
  layout: { type: 'column', padding: { top: space('m'), leading: space('m'), bottom: space('m'), trailing: space('m') }, spacing: space('m'), maxWidth: { type: 'unbounded' }, scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host' },
  components,
});

const modes = [
  { state: 'disarmed', label: 'Disarm', hint: 'Disarms the security system', icon: 'shield.slash', fill: solid(67, 160, 71), text: 'Disarmed' },
  { state: 'armed_home', label: 'Home', hint: 'Sets the security system to Home', icon: 'house', fill: solid(30, 136, 229), text: 'Armed Home', badge: 'shield.lefthalf.filled' },
  { state: 'armed_away', label: 'Away', hint: 'Sets the security system to Away', icon: 'figure.walk', fill: solid(229, 57, 53), text: 'Armed Away', badge: 'shield' },
  { state: 'armed_night', label: 'Night', hint: 'Sets the security system to Night', icon: 'moon', fill: solid(142, 36, 170), text: 'Armed Night', badge: 'moon' },
];
const alarm = (id: string, sourceId: string) => ({
  id, title: 'Security System', layout: { span: 1 }, type: 'alarm-panel',
  props: {
    sourceId, subtitle: 'Security System', sincePrefix: 'Since ', separator: ' · ', loadingText: 'Loading', unavailableText: 'Unavailable', hiddenText: 'Hidden', errorText: "Didn't Respond", pendingText: 'Sending command',
    confirmation: { title: 'Disarm the Security System?', message: 'Doors and motion stop triggering the alarm.', confirmLabel: 'Disarm', cancelLabel: 'Cancel' }, triggeredWash: solid(215, 0, 21),
    fallback: { icon: symbol('shield'), fill: solid(84, 110, 122), text: 'Unknown' },
    modes: modes.map(mode => ({ state: mode.state, label: mode.label, hint: mode.hint, icon: symbol(mode.icon), fill: mode.fill })),
    states: modes.map(mode => ({ state: mode.state, appearance: { icon: symbol(mode.badge ?? mode.icon), fill: mode.fill, text: mode.text } })),
  },
});
const lockState = (state: string, icon: string, text: string, fill: ReturnType<typeof solid>, active: boolean, error = false) => ({ state, appearance: { icon: symbol(icon), fill, text }, active, error });
const door = (id: string, title: string, sourceId: string) => ({
  id, title, layout: { span: 1 }, type: 'door-tile',
  props: {
    sourceId, kind: 'lock', loadingText: 'Loading', hiddenText: 'Hidden', unavailableText: 'Unavailable', errorText: "Didn't Respond", sendingOpenText: 'Sending Open...', sendingCloseText: 'Sending Close...',
    openLabel: 'Unlock', closeLabel: 'Lock', reverseLabel: 'Reverse', fallback: { icon: symbol('lock'), fill: solid(84, 110, 122), text: 'Unknown' },
    states: [lockState('locked', 'lock.fill', 'Locked', solid(67, 160, 71), false), lockState('unlocked', 'lock.open', 'Unlocked', solid(229, 57, 53), true),
      lockState('jammed', 'lock.trianglebadge.exclamationmark', 'Jammed', solid(229, 57, 53), true, true)],
  },
});
const settingsRow = (id: string, title: string, icon: string, item: string, span?: number) => ({
  id, title, type: 'settings-control', layout: span === undefined ? {} : { span }, icon: symbol(icon),
  props: { sourceId: 'demo-settings-household', kind: 'household-read-only', item, subtitle: '' },
});
const byId = (id: string) => {
  const found = (deviceControls.document.pages as { components: { id: string }[] }[]).flatMap(item => item.components).find(item => item.id === id);
  if (!found) throw new Error(`The device-controls fixture has no node "${id}".`);
  return structuredClone(found) as unknown as Record<string, unknown> & { props: Record<string, unknown> };
};

/** The entities the story reads, over the device-controls house: a lock that is locked and an alarm armed at home. */
export const fidpanelsStates: NativeState[] = [
  { entityId: 'alarm_control_panel.demo_home', state: 'armed_home', name: 'Home alarm' },
  { entityId: 'climate.demo_single', state: 'heat', name: 'Single', temperature: 71, currentTemperature: 69, hvacAction: 'heating', unit: '°F' },
  { entityId: 'lock.demo_front', state: 'locked', name: 'Front lock' },
  { entityId: 'lock.demo_back', state: 'unlocked', name: 'Back lock' },
];

/** The device-controls document with the story surfaces added, and the house they read. */
export function fidpanelsStory(): { document: CompositionDocument; house: House } {
  const document = structuredClone(deviceControls.document) as unknown as CompositionDocument & Record<string, unknown>;
  // The single-target hero reads a thermostat with one set point; the range hero keeps the fixture's heat-cool one.
  const hero = { ...byId('cl-dial'), id: 'fid-dial-single', title: 'Whole Home' }, range = byId('cl-dial-range'), hub = byId('cl-hub');
  hero.props.sourceId = 'fid-climate-single';
  for (const dial of [hero, range]) dial.props.dial = { ...(dial.props.dial as object), size: 'modal' };
  document.modals = [...document.modals,
    sheet('modal-fid-security', 'Security', [alarm('fid-alarm', 'fid-alarm-source'), { id: 'fid-doors', title: 'Doors', type: 'tile-grid', layout: { span: 1 }, props: { minimum: 'tile-dynamic-type@1', maxColumns: 2, spacing: space('m'), equalRowHeights: false, shortRow: 'share', fold: 'page' },
      children: [door('fid-door-front', 'Front Door', 'fid-door-front-source'), door('fid-door-back', 'Back Door', 'fid-door-back-source')] }]),
    sheet('modal-fid-thermostat', 'Thermostat', [hero, range, hub]),
    sheet('modal-fid-dark', 'Dark Sheet', [alarm('fid-alarm-dark', 'fid-alarm-source')], 'dark'),
  ] as CompositionDocument['modals'];
  document.pages = [...document.pages,
    page('page-fid-car', 'Car', [{ id: 'fid-car-grid', title: 'Charge Status', type: 'tile-grid', layout: { span: 1 }, props: { minimum: 'tile-dynamic-type@1', maxColumns: 2, spacing: space('m'), equalRowHeights: false, shortRow: 'share', fold: 'page' },
      children: [settingsRow('fid-car-charge', 'Charge Status', 'bolt.car', 'sensor.demo_car_charge'), settingsRow('fid-car-doors', 'Doors', 'lock', 'sensor.demo_car_doors'),
        settingsRow('fid-car-driver', "Driver's Seat", 'carseat.left', 'sensor.demo_car_driver'), settingsRow('fid-car-passenger', 'Passenger Seat', 'carseat.right', 'sensor.demo_car_passenger'),
        settingsRow('fid-car-climate', 'Climate', 'fanblades', 'sensor.demo_car_climate', 2)] }]),
  ] as CompositionDocument['pages'];
  document.dataSources = [...document.dataSources,
    { id: 'fid-climate-single', kind: 'model', model: 'climate@1', inputs: { entityId: 'climate.demo_single', rangeCommitEntityIds: [], sensorEntityId: 'sensor.demo_single_temp', occupancyEntityId: 'binary_sensor.demo_single_occ' } },
    { id: 'fid-alarm-source', kind: 'model', model: 'alarm-mode@1', inputs: { entityId: literal('alarm_control_panel.demo_home') } },
    { id: 'fid-door-front-source', kind: 'model', model: 'security-door@1', inputs: { entityId: literal('lock.demo_front'), kind: 'lock' } },
    { id: 'fid-door-back-source', kind: 'model', model: 'security-door@1', inputs: { entityId: literal('lock.demo_back'), kind: 'lock' } },
  ] as CompositionDocument['dataSources'];
  return { document, house: houseFrom({ states: [...deviceStates, ...fidpanelsStates] }) };
}
