import type { Component, Json, Modal, Page, StudioDocument } from './types';
import { createId } from './ids';
import { nativeClimateRoomEntities } from './native-entities';
import { createNativeDestinations } from './native-destinations';
import type { NativeSnapshot } from './native-state';
export type { NativeSnapshot, NativeState } from './native-state';

export const record = (value: Json | undefined): Record<string, Json> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const items = (value: Json | undefined) => Array.isArray(value) ? value.map(record) : [];
const text = (value: Json | undefined, fallback = '') => typeof value === 'string' ? value : fallback;
export function nativeEntity(states: Json | undefined, id: Json | undefined): Record<string, Json> | undefined {
  if (!Array.isArray(states) || typeof id !== 'string') return undefined;
  return states.map(record).find(item => item.entityId === id);
}
const roomColors = ['#8A6F44', '#0D8457', '#AF5F00', '#3E3EB7', '#007E94', '#72492D', '#547F12', '#901E79', '#A6222C', '#453057', '#195E20', '#637145', '#407B6E', '#59596F', '#975B46', '#7D7200'];
const stateLabels: Record<string, string> = { on: 'On', off: 'Off', armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night', disarmed: 'Disarmed', triggered: 'Triggered', unavailable: 'Unavailable', unknown: 'Unavailable', partlycloudy: 'Partly Cloudy', clear: 'Clear', 'clear-night': 'Clear Night' };
const unavailable = (state: Json | undefined) => state === undefined || state === '' || state === 'unavailable' || state === 'unknown';
const active = (state: Json | undefined) => ['on', 'open', 'playing', 'recording', 'home', 'heat', 'cool'].includes(String(state));
const occupied = (state: Json | undefined) => ['on', 'active', 'occupied'].includes(String(state));
const open = (state: Json | undefined) => ['on', 'open'].includes(String(state));
export function nativeGroupActivity(component: Component, states: Json | undefined): 'active' | 'inactive' | 'unavailable' {
  const members = Array.isArray(component.props.members) ? component.props.members : [];
  const values = members.map(id => nativeEntity(states, id)?.state);
  const isOccupancy = component.props.nativeKind === 'room-occupancy';
  const aggregate = nativeEntity(states, component.props.entityId)?.state;
  if (isOccupancy ? values.some(occupied) : active(aggregate) || values.some(active)) return 'active';
  if (isOccupancy && (!values.some(value => value !== undefined) || values.length > 0 && values.every(value => value !== undefined && unavailable(value)))) return 'unavailable';
  return values.some(value => value !== undefined) || aggregate !== undefined ? 'inactive' : 'unavailable';
}
export function nativeSummary(component: Component, states: Json | undefined): string {
  const entity = nativeEntity(states, component.props.entityId);
  const tone = component.props.tone;
  const members = Array.isArray(component.props.members) ? component.props.members : [];
  if (component.props.nativeKind === 'room-occupancy') {
    const activity = nativeGroupActivity(component, states);
    return activity === 'active' ? 'Occupied' : activity === 'inactive' ? 'Not Occupied' : 'Unavailable';
  }
  if (component.props.nativeKind === 'room-contact') {
    const values = members.map(id => nativeEntity(states, id)?.state);
    if (!values.some(value => value !== undefined) || values.every(value => value !== undefined && unavailable(value))) return 'Unavailable';
    const contacts = items(component.props.memberItems);
    const kinds = [true, false].map(window => {
      const entries = contacts.filter(item => `${text(item.title)} ${text(item.entityId)}`.toLowerCase().includes('window') === window);
      const total = entries.reduce((sum, item) => sum + (typeof item.contactCount === 'number' ? item.contactCount : 1), 0);
      const count = entries.filter(item => open(nativeEntity(states, item.entityId)?.state)).length;
      const noun = window ? 'Window' : 'Door';
      const summary = total === 1 ? `${noun} ${count ? 'Open' : 'Closed'}` : count === 0 ? `All ${noun}s Closed` : count === total ? `All ${noun}s Open` : `${count} ${noun}${count === 1 ? '' : 's'} Open`;
      return { total, count, summary };
    }).filter(kind => kind.total > 0);
    return kinds.length === 1 ? kinds[0].summary : kinds.filter(kind => kind.count > 0).map(kind => kind.summary).join(', ') || 'All Closed';
  }
  if (component.props.nativeKind === 'room-light') {
    const values = members.map(id => nativeEntity(states, id)?.state);
    const count = values.filter(active).length;
    if (count) return members.length === 1 ? 'On' : `${count} On`;
    if (entity) return unavailable(entity.state) ? 'Unavailable' : active(entity.state) ? 'On' : 'Off';
    return values.some(value => value !== undefined) ? 'Off' : 'Unavailable';
  }
  if (component.props.nativeKind === 'occupancy') {
    if (!entity || entity.state === 'unavailable' || entity.state === '') return 'Unavailable';
    if (entity.state === 'unknown') return 'Unknown';
    return occupied(entity.state) ? 'Detected' : ['off', 'inactive', 'clear', 'not_occupied'].includes(String(entity.state)) ? 'Clear' : String(entity.state);
  }
  if (tone === 'presence' && Array.isArray(component.props.roomMembers) && component.props.roomMembers.length) {
    const rooms = component.props.roomMembers.map(room => Array.isArray(room) ? room.map(id => nativeEntity(states, id)?.state) : []);
    if (!rooms.some(values => values.some(value => value !== undefined))) return 'Unavailable';
    const count = rooms.filter(values => values.some(occupied)).length;
    return count ? `${count} occupied` : 'Clear';
  }
  if (members.length && ['light', 'contact', 'presence'].includes(String(tone))) {
    const values = members.map(id => nativeEntity(states, id)?.state);
    if (!values.some(value => value !== undefined)) return 'Unavailable';
    const count = values.filter(tone === 'light' ? active : tone === 'contact' ? open : occupied).length;
    return tone === 'light' ? count ? `${count} On` : 'All Off' : tone === 'contact' ? count ? `${count} Open` : 'All Closed' : count ? `${count} active sensors` : 'Clear';
  }
  if (component.props.nativeKind === 'room-climate') {
    if (entity && !unavailable(entity.state)) return String(entity.state).replace(/-?\d+(?:\.\d+)?/g, value => (Math.trunc(Number(value) * 10) / 10).toFixed(1));
    const readings = members.filter(id => typeof id === 'string' && id.startsWith('sensor.')).map(id => nativeEntity(states, id)).filter(value => value && !unavailable(value.state) && Number.isFinite(Number(value.state)));
    const temperatures = readings.map(value => Number(value?.currentTemperature ?? value?.temperature ?? value?.state)).filter(Number.isFinite);
    if (!temperatures.length) return 'Unavailable';
    const format = (temperature: number) => `${(Math.trunc(temperature * 10) / 10).toFixed(1)}${readings[0]?.unit || '°'}`;
    const low = Math.min(...temperatures), high = Math.max(...temperatures);
    return Math.abs(low - high) < .05 ? format(low) : `${format(low)} - ${format(high)}`;
  }
  if (!entity || unavailable(entity.state)) return component.props.nativeKind === 'contact' && entity?.state === 'unknown' ? 'Unknown' : 'Unavailable';
  const configuredLabel = record(component.props.stateLabels)[String(entity.state)];
  if (typeof configuredLabel === 'string') return configuredLabel;
  if (tone === 'air') {
    const detail = nativeEntity(states, component.props.detailEntityId)?.state;
    return `AQI ${entity.state}${detail && detail !== 'unavailable' ? ` · PM2.5 ${detail}` : ''}`;
  }
  if (component.props.nativeKind === 'contact') return open(entity.state) ? 'Open' : 'Closed';
  if (component.type !== 'weather-summary' && (entity.currentTemperature !== undefined || entity.temperature !== undefined)) return `${entity.currentTemperature ?? entity.temperature}${entity.unit || '°'}`;
  const numeric = typeof entity.state === 'string' && /^-?\d+(?:\.\d+)?$/.test(entity.state);
  return `${stateLabels[String(entity.state)] ?? String(entity.state).replaceAll('_', ' ')}${numeric && entity.unit ? ` ${entity.unit}` : ''}`;
}

export function nativeHelperFill(value: Json | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = /^#([\da-f]{6})$/i.exec(value);
  const channels = '(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})';
  const rgb = [
    new RegExp(`^\\s*${channels}\\s*$`),
    new RegExp(`^\\s*\\[\\s*${channels}\\s*\\]\\s*$`),
    new RegExp(`^\\s*rgb\\(\\s*${channels}\\s*\\)\\s*$`, 'i'),
    new RegExp(`^\\s*rgba\\(\\s*${channels}\\s*,\\s*(?:0|1|0?\\.\\d+)\\s*\\)\\s*$`, 'i'),
  ].map(pattern => pattern.exec(value)).find(Boolean);
  if (!hex && !rgb) return undefined;
  const color = hex ? [0, 2, 4].map(start => parseInt(hex[1].slice(start, start + 2), 16)) : rgb!.slice(1).map(Number);
  if (color.some(channel => channel > 255)) return undefined;
  let darkened = color.map(channel => channel * .73);
  const luminance = (channels: number[]) => channels.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  for (let step = 0; step < 100 && 1.05 / (luminance(darkened.map(channel => channel * .88 + 255 * .12)) + .05) < 4.5; step++) darkened = darkened.map(channel => channel * .95);
  return `#${darkened.map(channel => Math.floor(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function importNativeHome(snapshot: NativeSnapshot): { document: StudioDocument; warnings: string[] } {
  if (snapshot.mode !== 'live' || snapshot.houseConfig.schema !== 2) throw new Error('Importing needs a live Home Assistant connection.');
  const config = snapshot.houseConfig.config;
  if (!config.home || !config.rooms || !config.security || !config.climate || !config.chores) throw new Error('Native configuration is missing required sections.');
  const home = record(config.home), rooms = record(config.rooms), security = record(config.security), climate = record(config.climate), chores = record(config.chores);
  const warnings = new Set<string>([
    'Browser approximation of the pinned UIKit app, not an iOS emulator or native publishing destination.',
    'Viewer identity uses the current-user binding and configured resident mappings, never a saved persona or captured identity.',
    'Cameras use consent-gated browser media, not the native RTC transport. Snapshot and Record controls are simulated.',
  ]);
  let serial = 0;
  const node = (type: Component['type'], title: string, props: Record<string, Json> = {}): Component => ({ id: `native-${++serial}`, type, title, props });
  const bound = (type: Component['type'], value: Record<string, Json>, props: Record<string, Json> = {}) => {
    const component = node(type, text(value.title, text(value.entityId, 'Device')), { ...props, entityId: value.entityId ?? '', nativeKind: value.kind ?? '' });
    component.icon = text(value.icon, 'Activity');
    component.binding = { sourceId: 'native-states' };
    return component;
  };
  const group = (title: string, children: Component[], props: Record<string, Json> = {}) => ({ ...node('section', title, { columns: 2, gap: 12, adaptive: props.columns !== 1, ...props }), children });
  const toolbar = () => [
    { id: `quick-${++serial}`, label: 'Quick Links', icon: 'LayoutGrid', placement: 'leading' as const, action: { type: 'modal' as const, modalId: 'native-quick-links' } },
    { id: `profile-${++serial}`, label: 'Your Summary', icon: 'UserRound', placement: 'trailing' as const, action: { type: 'modal' as const, modalId: 'native-profile' } },
  ];
  const page = (id: string, title: string, icon: string, components: Component[] = [], foldAware = false): Page => ({ id, title, icon, layout: { columns: 1, gap: 24, foldAware }, toolbar: toolbar(), components });
  const modal = (id: string, title: string, components: Component[]): Modal => ({ ...page(id, title, 'Layers', components), toolbar: [], presentation: 'sheet', detent: 'large' });
  const detail = (title: string, children: Component[]) => {
    const id = `native-detail-${++serial}`;
    modals.push(modal(id, title, children));
    return { type: 'modal' as const, modalId: id };
  };
  const modals: Modal[] = [];
  const overviewActions = new Map<string, Component['action']>();
  const roomSubpages = new Map<string, string>();
  const destinations = createNativeDestinations({
    config, warnings, group, detail,
    node: (type, title, props, icon) => ({ ...node(type, title, props), ...(icon ? { icon } : {}) }),
    bound: (type, title, entityId, props = {}, icon = '') => bound(type, { title, entityId: typeof entityId === 'string' ? entityId : '', kind: props.nativeKind ?? '', icon }, props),
    page: (id, title, icon, children) => { pages.push(page(id, title, icon, children)); },
  });
  const nativeCard = (value: Record<string, Json>, room: string) => {
    const groupField = ({ light: 'lightGroups', vent: 'climateGroups', climate: 'climateGroups', occupancy: 'occupancyGroups', contact: 'contactGroups' } as Record<string, string>)[text(value.kind)];
    const roomGroup = groupField ? items(rooms[groupField]).find(item => (item.room ?? item.title) === room) : undefined;
    const kind = roomGroup && ['light', 'occupancy', 'contact'].includes(text(value.kind)) ? `room-${text(value.kind)}` : value.kind;
    const component = bound('action-tile', { ...value, kind: kind ?? '' }, {
      arrangement: 'row', showState: value.showState !== false,
      members: roomGroup ? items(roomGroup.items).map(item => item.entityId ?? '') : [], memberItems: roomGroup?.items ?? [],
      stateLabels: value.stateLabels ?? {}, activeStates: value.activeStates ?? [], disabledStates: value.disabledStates ?? [],
      subtitleEntityIds: value.subtitleEntityIds ?? [], alternate: value.alternate ?? null,
      resident: value.resident ?? '', residentLabel: value.residentLabel ?? null,
    });
    if (value.isFullWidth) component.layout = { span: 4 };
    const overviewKind = ({ light: 'lights', vent: 'climate', climate: 'climate', occupancy: 'occupancy', contact: 'contacts' } as Record<string, string>)[text(value.kind)];
    const sharedAction = roomGroup && overviewActions.get(overviewKind);
    const action = sharedAction || destinations.roomCard(value, room);
    if (sharedAction) {
      const destination = roomSubpages.get(`${overviewKind}/${room}`);
      if (!destination) throw new Error(`Native room destination is missing for ${overviewKind}/${room}`);
      component.props.initialDestinationId = destination;
    }
    if (action) component.action = action;
    return component;
  };
  const roomOverview = (value: Record<string, Json>, kind: string): Component[] => {
    if (kind === 'security') {
      const entityId = text(security.alarmEntityId, text(value.entityId));
      const modes = ['Disarm', 'Home', 'Away', 'Night'].map((title, index) => {
        const component = bound('action-tile', { title, entityId, icon: ['shield.slash', 'house', 'figure.walk', 'moon'][index] }, {
          modeState: ['disarmed', 'armed_home', 'armed_away', 'armed_night'][index],
          ...(index === 0 ? { confirmationTitle: 'Disarm the Security System?', confirmation: 'Doors and motion stop triggering the alarm.', confirmationAction: 'Disarm' } : {}),
        });
        component.action = { type: 'service', domain: entityId.split('.')[0], service: ['alarm_disarm', 'alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night'][index], entityId };
        return component;
      });
      return [{ ...bound('section', { title: 'Security System', entityId, icon: 'Shield', kind: 'security' }, { presentation: 'alarm-panel' }), children: modes }];
    }
    if (kind === 'airQuality') return [group('Rooms', items(rooms.airQualityRooms).map(room => bound('action-tile', { title: room.title ?? '', entityId: room.aqiEntityId ?? '', icon: 'Wind' }, { tone: 'air', detailEntityId: room.pm25EntityId ?? '', colorEntityId: room.colorEntityId ?? '', readOnly: true })))];
    const key = ({ lights: 'lightGroups', climate: 'climateGroups', occupancy: 'occupancyGroups', contacts: 'contactGroups' } as Record<string, string>)[kind];
    const subpages: Component[] = [];
    const cards = items(rooms[key ?? '']).map(room => {
      const members = items(room.items), entityId = text(room.entityId);
      const stateCard = (item: Record<string, Json>, nativeKind = '') => {
        const control = destinations.control(text(item.title), item.entityId);
        control.props.nativeKind = nativeKind;
        return control;
      };
      let sections: Component[];
      if (kind === 'lights') sections = [
        group(members.length === 1 ? 'Light' : 'Lights', [
          ...(members.length > 1 && entityId.startsWith('light.') ? [stateCard({ title: 'Group Brightness', entityId })] : []),
          ...members.map(item => stateCard(item)),
        ]),
      ];
      else if (kind === 'climate') {
        const sensors = members.filter(item => !text(item.entityId).startsWith('cover.')), vents = members.filter(item => text(item.entityId).startsWith('cover.'));
        sections = [
          ...(sensors.length ? [group(sensors.length === 1 ? 'Temperature Sensor' : 'Temperature Sensors', sensors.map(item => stateCard(item)))] : []),
          ...(vents.length ? [group(vents.length === 1 ? 'Vent' : 'Vents', vents.map(item => stateCard(item)))] : []),
        ];
      } else sections = [group(`${kind === 'occupancy' ? 'Occupancy' : 'Contact'} Sensor${members.length === 1 ? '' : 's'}`, members.map(item => {
        const card = stateCard(item, kind === 'occupancy' ? 'occupancy' : 'contact');
        if (kind === 'contacts') card.props.suppressNormalState = true;
        return card;
      }))];
      const component = bound('navigation-tile', { title: room.room ?? room.title ?? '', entityId, icon: value.icon ?? 'House', kind: kind === 'climate' ? 'room-climate' : kind === 'occupancy' ? 'room-occupancy' : kind === 'lights' ? 'room-light' : kind === 'contacts' ? 'room-contact' : '' }, {
        arrangement: 'row', members: members.map(item => item.entityId ?? ''), tone: kind === 'lights' ? 'light' : kind === 'contacts' ? 'contact' : kind === 'occupancy' ? 'presence' : 'climate',
        memberItems: room.items ?? [],
        colorEntityId: room.colorEntityId ?? '', suppressNormalState: kind === 'contacts',
      });
      const destination = group(component.title, sections, { columns: 1, presentation: 'subpage' });
      subpages.push(destination);
      component.props.destinationId = destination.id;
      roomSubpages.set(`${kind}/${component.title}`, destination.id);
      return component;
    });
    const overview = group(kind === 'climate' || kind === 'contacts' ? 'Rooms' : '', cards, kind === 'lights' || kind === 'occupancy' ? {
      presentation: 'state-groups', activeTitle: kind === 'lights' ? 'Lights On' : 'Occupied', inactiveTitle: kind === 'lights' ? 'Lights Off' : 'Clear', unavailableTitle: 'Unavailable',
    } : {});
    return [group('', [overview, ...subpages], { columns: 1, presentation: 'navigation-stack' })];
  };
  const chips = items(home.statusChips).map(value => {
    const component = bound('status-chip', { ...value, kind: value.tone === 'presence' ? 'occupancy' : value.kind ?? '' }, { tone: value.tone ?? 'neutral', colorEntityId: value.colorEntityId ?? '', detailEntityId: value.detailEntityId ?? '' });
    const kind = text(value.sheet) || ({ light: 'lights', contact: 'contacts', presence: 'occupancy', air: 'airQuality' } as Record<string, string>)[text(value.tone)] || text(value.tone);
    const groupKey = kind === 'lights' ? 'lightGroups' : kind === 'contacts' ? 'contactGroups' : kind === 'occupancy' ? 'occupancyGroups' : '';
    const groups = items(rooms[groupKey]);
    component.props.members = [...new Set(groups.flatMap(group => items(group.items).map(item => text(item.entityId))).filter(Boolean))];
    if (value.tone === 'presence') component.props.roomMembers = groups.map(group => items(group.items).map(item => text(item.entityId)).filter(Boolean));
    component.action = detail(component.title, roomOverview(value, kind));
    overviewActions.set(kind, component.action);
    return component;
  });
  const cameras = () => group('Cameras', items(home.cameras).map(value => {
    const viewer = node('camera-feed', text(value.title), { entityId: value.entityId ?? '', rtcStreamId: value.rtcStreamId ?? '', aspectRatio: value.aspectRatio ?? 16 / 9, viewer: true, controls: ['snapshot', 'sound', ...(value.recordingScriptEntityId ? ['record'] : [])] });
    const card = node('camera-button', text(value.title), { presentation: 'camera-card', entityId: value.entityId ?? '', aspectRatio: 1 / .78 });
    card.icon = 'Camera'; card.action = detail(card.title, [viewer]);
    return card;
  }), { columns: 4, minimumWidth: 160, fill: false, foldRegion: 'trailing', foldOrder: 0 });
  const guests = () => ({
    ...group('Guests Staying Over', items(home.guestToggles).map(value =>
      bound('action-tile', value, { presentation: 'guest-toggle', tone: 'presence' })),
    { presentation: 'guest-group', foldRegion: 'trailing', foldOrder: 1 }),
    binding: { sourceId: 'native-states' },
    subtitle: 'Guest mode skips some away automations. Review security, climate, and auto-clean controls before leaving.',
  });
  const climateSubpages: Component[] = [];
  const climateState = (title: string, entityId: Json | undefined) => entityId ? destinations.control(title, entityId) : bound('settings-row', { title, entityId: '', icon: 'Thermometer' });
  const climateLink = (title: string, children: Component[], entityId?: Json) => {
    const destination = group(title, children, { columns: 1, presentation: 'subpage' });
    climateSubpages.push(destination);
    return bound('settings-row', { title, entityId: entityId ?? '', icon: 'ChevronRight' }, { destinationId: destination.id, showState: entityId !== undefined });
  };
  const climateRooms = items(climate.rooms).map(room => {
    const title = text(room.title);
    return {
      ...room, title, ...nativeClimateRoomEntities(title),
      ventEntityIds: room.ventEntityIds ?? [],
      occupiedOnlyEntityId: room.occupiedOnlyEntityId ?? '',
    };
  });
  const thermostatRooms = climateRooms.map(room => {
    const link = climateLink(room.title, [
      group('Thermostat', [climateState(room.title, room.thermostat)]),
      group(`${room.title} Vents`, (Array.isArray(room.ventEntityIds) ? room.ventEntityIds : []).map((id, index) => climateState(`Vent ${index + 1}`, id))),
    ]);
    link.type = 'navigation-tile';
    link.props = { ...link.props, showState: true, arrangement: 'anchored-bottom', entityId: room.temperature, occupancyEntityId: room.occupancy, nativeKind: 'climate-room' };
    return link;
  });
  const optionLink = (title: string, entityId: Json | undefined) => {
    const control = climateState(title, entityId);
    if (control.props.controlKind === 'select') control.props.choiceList = true;
    return climateLink(title, [control], entityId);
  };
  const trackingLinks = [
    { title: 'Selected Rooms', key: 'track', prerequisite: climate.trackSelectedEntityId, expected: 'on', note: 'Enable Track Selected Rooms before choosing participating rooms.' },
    { title: 'Critical Protection', key: 'critical', prerequisite: climate.ecoCriticalEntityId, expected: climate.trackSelectCriticalOption, note: 'Set Eco Mode Critical Tracking to Track Select Critical before choosing protected unselected rooms.' },
    { title: 'Occupied Only', key: 'occupiedOnlyEntityId', note: 'Rooms without an explicitly configured Occupied Only entity are unavailable.' },
  ].map(rule => {
    const link = climateLink(rule.title, [
      node('text', rule.title, { text: rule.note }),
      group('Rooms', climateRooms.map(room => {
        const control = climateState(room.title, room[rule.key as keyof typeof room]);
        if (control.props.controlKind === 'toggle') control.props.checkRow = true;
        return control;
      }), { columns: 1, presentation: 'grouped-settings' }),
    ]);
    if ('prerequisite' in rule && typeof rule.prerequisite === 'string' && typeof rule.expected === 'string') {
      link.props.enabledEntityId = rule.prerequisite;
      link.props.enabledState = rule.expected;
      link.props.disabledMessage = rule.note;
    }
    return link;
  });
  const prediction = climateLink('Current Prediction', [
    group('Recommendation', [climateState('Predictive Comfort', climate.predictiveSensorEntityId)], { columns: 1 }),
    group('Controls', [
      climateState('Auto Setpoint Adjustments', climate.predictiveAutoAdjustEntityId),
      climateState('HVAC Mode Changes', climate.predictiveHvacModeChangesEntityId),
      climateState('Predictive Comfort While Away', climate.predictiveAllowAwayEntityId),
    ], { columns: 1 }),
  ]);
  if (typeof climate.predictiveComfortEntityId === 'string') prediction.visibility = { source: 'entity', key: climate.predictiveComfortEntityId, operator: 'equals', value: 'on' };
  const climateTabs = group('', [
    { ...group('Rooms', [group('Room Thermostats', thermostatRooms, { presentation: 'climate-rooms', columns: 4, minimumWidth: 140 })]), icon: 'Thermometer' },
    group('Automation', [
      { ...group('Automatic Thermostat', [climateState('Automatic Thermostat', climate.integrationEntityId)], { columns: 1, presentation: 'grouped-settings' }), subtitle: "Turn Home Assistant's automatic thermostat control on or off." },
      group('Eco Mode', [climateState('Eco Mode', climate.ecoModeEntityId), optionLink('Eco Mode Critical Tracking', climate.ecoCriticalEntityId), optionLink('Eco Behavior When Away', climate.ecoAwayEntityId)], { columns: 1, presentation: 'grouped-settings' }),
      group('Predictive Comfort', [climateState('Predictive Comfort', climate.predictiveComfortEntityId), ...(climate.predictiveSensorEntityId ? [climateState('Recommendation', climate.predictiveSensorEntityId)] : []), prediction], { columns: 1, presentation: 'grouped-settings' }),
    ], { columns: 1 }),
    group('Tracking', [
      group('Room Tracking', [climateState('Track Selected Rooms', climate.trackSelectedEntityId)], { columns: 1, presentation: 'grouped-settings' }),
      group('Room Rules', trackingLinks, { columns: 1, presentation: 'grouped-settings' }),
    ], { columns: 1 }),
  ], { columns: 1, presentation: 'tabs' });
  climateTabs.children[1].icon = 'Settings';
  climateTabs.children[2].icon = 'Footprints';
  const advancedControls = detail('Advanced Controls', [group('', [climateTabs, ...climateSubpages], { columns: 1, presentation: 'navigation-stack', childClose: true })]);
  const weather = bound('weather-summary', { title: 'Weather', entityId: home.weatherEntityId ?? '', icon: 'CloudSun' });
  weather.action = detail('Weather', [bound('weather-summary', { title: 'Weather', entityId: home.weatherEntityId ?? '', icon: 'CloudSun' }, { presentation: 'detail' })]);
  const securityTile = bound('action-tile', { title: 'Security System', entityId: security.alarmEntityId ?? '', icon: 'Shield' });
  const alarmChip = chips.find(chip => chip.props.tone === 'security');
  if (alarmChip?.action) securityTile.action = alarmChip.action;
  else if (security.alarmEntityId) securityTile.action = detail('Security System', roomOverview(securityTile.props, 'security'));
  const pages = [
    page('home', 'Home', 'House', [
      group('', chips, { presentation: 'status-rail', foldRegion: 'rail' }),
      weather,
      guests(), cameras(),
    ], true),
    page('security', 'Security', 'Shield', [
      group('', chips.filter(chip => ['security', 'contact'].includes(String(chip.props.tone))).map(chip => ({ ...structuredClone(chip), id: `native-${++serial}` })), { presentation: 'status-rail', foldRegion: 'rail' }),
      securityTile,
      group('Doors', items(security.controlTiles).filter(item => item.kind !== 'alarm').map(item => nativeCard(item, 'Security')), { columns: 4 }),
      guests(), cameras(),
    ], true),
    page('climate', 'Climate', 'Thermometer', [
      ...(climate.globalThermostatEntityId ? [destinations.control('Whole Home', climate.globalThermostatEntityId)] : []),
      bound('status-chip', { title: 'Thermostat Hub', entityId: climate.hubEntityId ?? '', icon: 'Thermometer' }, { tone: 'climate' }),
      group('Open Contact Sensors', items(climate.contactSensors).map(value => ({ ...bound('settings-row', value, { readOnly: true }), visibility: { source: 'entity' as const, key: text(value.entityId), operator: 'equals' as const, value: 'on' } })), { columns: 1, hideWhenEmpty: true, foldRegion: 'trailing' }),
      group('Advanced Controls', ['Room Thermostats', 'Advanced Configuration', 'Room Tracking'].map((title, index) => ({
        ...node('settings-row', title, { initialTabId: climateTabs.children[index].id }),
        subtitle: [
          "View each room's temperature and occupancy, then open a room to adjust its target and check vent position.",
          'Manage Automatic Thermostat, Eco Mode, and Predictive Comfort settings.',
          'Choose which rooms participate in normal comfort, critical protection, or occupancy-only tracking.',
        ][index],
        icon: ['Thermometer', 'Settings', 'Footprints'][index], action: advancedControls,
      })), { columns: 1, foldRegion: 'trailing' }),
    ], true),
    page('chores', 'Chores', 'ListChecks'),
    page('settings', 'Settings', 'Settings'),
  ];
  for (const value of items(rooms.pages)) {
    const overview = items(value.overviewCards).map(item => {
      const card = nativeCard(item, text(value.title));
      card.type = 'status-chip';
      return card;
    });
    pages.push(page(`room-${text(value.id)}`, text(value.title), 'House', [
      group('', overview, { presentation: 'status-rail' }),
      ...items(value.sections).filter(section => section.showOnRoomPage !== false).map(section => group(text(section.title), items(section.cards).map(item => nativeCard(item, text(value.title))), { columns: 4, fill: section.layout !== 'appLaunch' })),
    ]));
  }
  const roomItems = items(record(rooms.grid).items).map((value, index) => {
    const component = node('navigation-tile', text(value.title), { arrangement: 'anchored-bottom' });
    component.icon = text(value.icon, 'House'); component.color = roomColors[index % roomColors.length];
    component.action = { type: 'navigate', pageId: `room-${text(value.path)}` };
    return { component, rank: Number(snapshot.states.find(state => state.entityId === value.accessCounterEntityId)?.state ?? 0), index };
  }).sort((a, b) => b.rank - a.rank || a.index - b.index);
  pages.push(page('native-rooms', 'Rooms', 'LayoutGrid', [group('', roomItems.map(item => item.component), { columns: 4 })]));
  const quickLinks = items(rooms.quickLinks).map(value => {
    const component = node('navigation-tile', text(value.title), { arrangement: 'anchored-bottom' }); component.icon = text(value.icon, 'ArrowUpRight');
    const action = record(value.action);
    const id = text(action.detail, text(action.path, text(value.id)));
    if (id === 'rooms') component.action = { type: 'navigate', pageId: 'native-rooms' };
    else if (id === 'security' || id === 'security-system') component.action = securityTile.action ?? { type: 'navigate', pageId: 'security' };
    else component.action = destinations.family(id, component.title);
    if (value.visibilityEntityId) component.visibility = { source: 'entity', key: text(value.visibilityEntityId), operator: 'equals', value: 'on' };
    return component;
  });
  modals.push(modal('native-quick-links', 'Quick Links', [group('', quickLinks)]));
  modals.push(modal('native-profile', 'Your Summary', destinations.profile()));
  for (const value of items(chores.pages)) {
    const id = text(value.id);
    if (id === 'chores') pages[3].components = destinations.todo(value);
    else destinations.todoRoute(id, text(value.title));
  }
  pages[3].components.unshift(group('Quick Links', items(chores.quickLinks).filter(value => items(chores.pages).some(page => page.id === value.pageId)).map(value => {
    const destination = items(chores.pages).find(page => page.id === value.pageId)!;
    const component = node('navigation-tile', text(value.title), { arrangement: 'anchored-bottom', choreLink: destination, people: chores.people ?? [], profileSourceId: 'native-profile' });
    component.icon = text(value.icon);
    component.binding = { sourceId: 'native-states' };
    component.action = value.pageId === 'chores' ? { type: 'navigate', pageId: 'chores' } : destinations.todoRoute(text(value.pageId), text(value.title)); return component;
  })));
  const settingsRow = (title: string, subtitle?: string) => ({ ...node('settings-row', title, { unsupported: 'Native setting is not changed by this preview.' }), subtitle, icon: 'Settings' });
  pages[4].components = [
    group('Household', destinations.settings(), { columns: 1, presentation: 'grouped-settings' }),
    group('Appearance', [settingsRow('Background Blur'), settingsRow('Reset to Default'), settingsRow('Show count on app icon'), settingsRow('App Icon')], { columns: 1, presentation: 'grouped-settings' }),
    group('', [settingsRow('Home Assistant Settings'), settingsRow('Performance')], { columns: 1, presentation: 'grouped-settings' }),
    { ...node('report-issue', 'Report an Issue'), icon: 'Bug', action: { type: 'report-issue' } },
    { ...node('request-feature', 'Request a Feature'), icon: 'Lightbulb', action: { type: 'request-feature' } },
    settingsRow('About'),
  ];
  return {
    document: {
      schemaVersion: '1.0', id: createId('native-reference'), name: 'S+H reference',
      theme: { accent: '#409cff', appearance: 'system', fontScale: 1, background: { image: '/api/native-wallpaper', blur: 16.8, dim: .46 } },
      navigation: { initialPageId: 'home', tabs: pages.slice(0, 5).map(value => ({ id: `tab-${value.id}`, label: value.title, icon: value.icon, pageId: value.id })) },
      pages, modals, liveActivities: [],
      dataSources: [
        { id: 'native-states', name: 'S+H entities', kind: 'native-home', endpoint: 'house-states', refreshSeconds: 30, sample: [] },
        { id: 'native-profile', name: 'Signed-in Home Assistant user', kind: 'native-home', endpoint: 'house-profile', refreshSeconds: 30, sample: null },
      ],
      variables: {},
    },
    warnings: [...warnings],
  };
}
