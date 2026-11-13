import { describe, expect, it } from 'vitest';
import { importNativeHome, nativeGroupActivity, nativeHelperFill, nativeSummary, type NativeSnapshot } from '../src/shared/native-preview';
import { validateDocument } from '../src/shared/schema';
import type { Component, Json } from '../src/shared/types';
import { duoGeometry, isAccessibilityText, nativeSectionColumns, nativeTileMetrics, placeFoldSections, solveNativeGrid } from '../src/shared/native-layout';

const descendants = (components: Component[]): Component[] => components.flatMap(component => [component, ...descendants(component.children ?? [])]);

export function nativeFixture(): NativeSnapshot {
  return {
    mode: 'live',
    houseConfig: {
      schema: 2, hash: 'a'.repeat(64),
      config: {
        home: {
          weatherEntityId: 'weather.example',
          statusChips: [
            { title: 'Lights', tone: 'light', sheet: 'lights', entityId: 'light.example' },
            { title: 'Security', tone: 'security', sheet: 'security', entityId: 'alarm_control_panel.example' },
            { title: 'Climate', tone: 'climate', sheet: 'climate', entityId: 'input_text.climate' },
            { title: 'Occupancy', tone: 'presence', sheet: 'occupancy', entityId: 'binary_sensor.occupancy' },
            { title: 'Contacts', tone: 'contact', sheet: 'contacts', entityId: 'binary_sensor.contacts' },
            { title: 'Air Quality', tone: 'air', sheet: 'airQuality', entityId: 'input_text.air' },
          ],
          cameras: [{ title: 'Example camera', entityId: 'camera.example', aspectRatio: 4 / 3 }],
          guestToggles: [{ title: 'Guests', entityId: 'input_boolean.guests' }],
        },
        security: { alarmEntityId: 'alarm_control_panel.example', controlTiles: [] },
        climate: { globalThermostatEntityId: 'climate.example', hubEntityId: 'climate.hub', contactSensors: [], rooms: [{ title: 'Study', ventEntityIds: ['cover.study_vent'] }] },
        chores: { pages: [{ id: 'chores', title: 'Chores', lists: [] }], quickLinks: [] },
        rooms: {
          lightGroups: [{ room: 'Study', items: [{ title: 'Lamp', entityId: 'light.lamp' }] }],
          climateGroups: [{ room: 'Study', items: [{ title: 'Temperature', entityId: 'sensor.study_temperature' }, { title: 'Vent', entityId: 'cover.study_vent' }] }],
          occupancyGroups: [{ room: 'Study', items: [{ title: 'Motion', entityId: 'binary_sensor.study_motion' }] }],
          contactGroups: [{ room: 'Study', items: [{ title: 'Window', entityId: 'binary_sensor.study_window' }] }],
          airQualityRooms: [{ title: 'Study', aqiEntityId: 'sensor.study_aqi', colorEntityId: 'input_text.study_air_color', pm25EntityId: 'sensor.study_pm25' }],
          pages: [{ id: 'study', title: 'Study', sections: [], overviewCards: [] }],
          grid: { items: [{ title: 'Study', path: 'study', accessCounterEntityId: 'counter.study' }] },
          quickLinks: [{ id: 'rooms', title: 'Rooms' }],
        },
      },
    },
    states: [{ entityId: 'light.lamp', state: 'on', name: 'Private live entity label' }],
  };
}
describe('native reference initialization', () => {
  it('creates valid editable native tabs and configured chips without persisting live values or modifying the input', () => {
    const snapshot = nativeFixture();
    const before = structuredClone(snapshot);
    const { document, warnings } = importNativeHome(snapshot);
    expect(validateDocument(document)).toEqual(document);
    expect(document.navigation.tabs.map(tab => tab.label)).toEqual(['Home', 'Security', 'Climate', 'Chores', 'Settings']);
    expect(document.pages[0].components[0].children?.map(chip => chip.title)).toEqual(['Lights', 'Security', 'Climate', 'Occupancy', 'Contacts', 'Air Quality']);
    expect(document.pages[0].layout.foldAware).toBe(true);
    expect(document.dataSources[0]).toMatchObject({ endpoint: 'house-states', sample: [] });
    expect(JSON.stringify(document)).not.toContain('Private live entity label');
    expect(snapshot).toEqual(before);
    expect(warnings.join('\n')).toMatch(/Viewer identity/);
    const profile = descendants(document.modals.find(modal => modal.id === 'native-profile')!.components).find(component => component.type === 'profile')!;
    expect(profile.title).toBe('Your Summary');
    expect(profile.binding).toEqual({ sourceId: 'native-profile' });
  });
  it('persists binding definitions without captured weather, helper colors, thermostat values, or entity labels', () => {
    const snapshot = nativeFixture();
    snapshot.states = [
      { entityId: 'weather.example', state: 'CAPTURED_WEATHER_STATE', name: 'CAPTURED_WEATHER_NAME', temperature: 828.734, unit: 'CAPTURED_UNIT' },
      { entityId: 'climate.example', state: 'CAPTURED_HVAC_STATE', name: 'CAPTURED_THERMOSTAT_NAME', currentTemperature: 901.238 },
      { entityId: 'input_text.study_air_color', state: 'rgb(11, 222, 33)', name: 'CAPTURED_COLOR_NAME' },
    ];
    const { document } = importNativeHome(snapshot), serialized = JSON.stringify(document);
    expect(document.dataSources).toEqual([
      { id: 'native-states', name: 'Native Home entities', kind: 'native-home', endpoint: 'house-states', refreshSeconds: 30, sample: [] },
      { id: 'native-profile', name: 'Signed-in Home Assistant user', kind: 'native-home', endpoint: 'house-profile', refreshSeconds: 30, sample: null },
    ]);
    expect(document.variables).toEqual({});
    expect(descendants([...document.pages.flatMap(page => page.components), ...document.modals.flatMap(modal => modal.components)]).filter(node => node.binding).every(node => ['native-states', 'native-profile'].includes(node.binding!.sourceId))).toBe(true);
    expect(serialized).not.toContain('CAPTURED_');
    expect(serialized).not.toContain('828.734');
    expect(serialized).not.toContain('901.238');
    expect(serialized).not.toContain('rgb(11, 222, 33)');
    expect(validateDocument(document)).toEqual(document);
  });
  it('counts configured members by entity identity and does not turn missing data into zero', () => {
    const chip = importNativeHome(nativeFixture()).document.pages[0].components[0].children![0];
    const states = [{ entityId: 'light.lamp', state: 'on' }, { entityId: 'light.example', state: 'on' }, { entityId: 'light.unrelated', state: 'on' }];
    expect(nativeSummary(chip, states)).toBe('1 On');
    expect(nativeSummary(chip, [...states].reverse())).toBe('1 On');
    expect(nativeSummary(chip, states.filter(state => state.entityId !== 'light.example'))).toBe('1 On');
    expect(nativeSummary(chip, states.slice(1))).toBe('Unavailable');
  });
  it('counts active lights despite offline or omitted members and retains native zero capitalization', () => {
    const chip: Component = { id: 'lights', type: 'status-chip', title: 'Lights', props: { tone: 'light', members: ['light.a', 'light.b', 'light.c'] } };
    const states = [{ entityId: 'light.a', state: 'on' }, { entityId: 'light.b', state: 'unavailable' }];
    expect(nativeSummary(chip, states)).toBe('1 On');
    expect(nativeSummary(chip, [{ entityId: 'light.a', state: 'off' }, states[1]])).toBe('All Off');
    expect(nativeSummary(chip, [states[1]])).toBe('All Off');
    expect(nativeSummary(chip, [])).toBe('Unavailable');
    expect(nativeSummary({ ...chip, props: { entityId: 'light.b', nativeKind: 'light' } }, states)).toBe('Unavailable');
  });
  it('matches room-light counts, aggregate fallback, and activity without fabricating a missing feed', () => {
    const room: Component = { id: 'room', type: 'navigation-tile', title: 'Study', props: { nativeKind: 'room-light', entityId: 'light.group', members: ['light.a', 'light.b'] } };
    const states = [{ entityId: 'light.a', state: 'on' }, { entityId: 'light.b', state: 'unavailable' }];
    expect(nativeSummary(room, states)).toBe('1 On');
    expect(nativeGroupActivity(room, states)).toBe('active');
    expect(nativeSummary({ ...room, props: { ...room.props, members: ['light.a'] } }, states)).toBe('On');
    expect(nativeSummary(room, [states[1], { entityId: 'light.group', state: 'on' }])).toBe('On');
    expect(nativeSummary(room, [{ entityId: 'light.a', state: 'off' }, states[1]])).toBe('Off');
    expect(nativeGroupActivity(room, [{ entityId: 'light.a', state: 'off' }, states[1]])).toBe('inactive');
    expect(nativeSummary(room, [{ entityId: 'light.group', state: 'unavailable' }])).toBe('Unavailable');
    expect(nativeSummary(room, [])).toBe('Unavailable');
  });
  it('uses occupancy members rather than aggregate activity and distinguishes all-unavailable sensors', () => {
    const room: Component = { id: 'room', type: 'navigation-tile', title: 'Study', props: { nativeKind: 'room-occupancy', entityId: 'binary_sensor.group', members: ['binary_sensor.a', 'binary_sensor.b'] } };
    const states = [{ entityId: 'binary_sensor.group', state: 'on' }, { entityId: 'binary_sensor.a', state: 'off' }, { entityId: 'binary_sensor.b', state: 'unavailable' }];
    expect(nativeSummary(room, states)).toBe('Not Occupied');
    expect(nativeGroupActivity(room, states)).toBe('inactive');
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.a', state: 'active' }, states[2]])).toBe('Occupied');
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.a', state: 'occupied' }, states[2]])).toBe('Occupied');
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.a', state: 'unavailable' }, states[2]])).toBe('Unavailable');
    expect(nativeSummary(room, [])).toBe('Unavailable');
    const individual = { ...room, props: { nativeKind: 'occupancy', entityId: 'binary_sensor.a' } };
    expect(nativeSummary(individual, [{ entityId: 'binary_sensor.a', state: 'occupied' }])).toBe('Detected');
    expect(nativeSummary(individual, [{ entityId: 'binary_sensor.a', state: 'not_occupied' }])).toBe('Clear');
    expect(nativeSummary(individual, [{ entityId: 'binary_sensor.a', state: 'unknown' }])).toBe('Unknown');
  });
  it('retains contact kind/count meanings without treating an offline sibling as the whole room', () => {
    const room: Component = { id: 'contacts', type: 'navigation-tile', title: 'Study', props: {
      nativeKind: 'room-contact', members: ['binary_sensor.window', 'binary_sensor.door'],
      memberItems: [{ title: 'Windows', entityId: 'binary_sensor.window', contactCount: 2 }, { title: 'Door', entityId: 'binary_sensor.door' }],
    } };
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.window', state: 'on' }, { entityId: 'binary_sensor.door', state: 'unavailable' }])).toBe('1 Window Open');
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.window', state: 'off' }, { entityId: 'binary_sensor.door', state: 'off' }])).toBe('All Closed');
    expect(nativeSummary(room, [{ entityId: 'binary_sensor.window', state: 'unavailable' }, { entityId: 'binary_sensor.door', state: 'unavailable' }])).toBe('Unavailable');
    expect(nativeSummary(room, [])).toBe('Unavailable');
  });
  it('counts occupied rooms rather than individual sensors', () => {
    const chip: Component = { id: 'occupancy', type: 'status-chip', title: 'Occupancy', props: { entityId: 'binary_sensor.all', tone: 'presence', roomMembers: [['binary_sensor.a', 'binary_sensor.b'], ['binary_sensor.c']] } };
    expect(nativeSummary(chip, ['all', 'a', 'b', 'c'].map(name => ({ entityId: `binary_sensor.${name}`, state: name === 'c' ? 'off' : 'on' })))).toBe('1 occupied');
  });
  it('uses the configured climate range or min/max readings rather than inventing an average', () => {
    const room: Component = { id: 'climate', type: 'navigation-tile', title: 'Study', props: { entityId: 'input_text.study_range', nativeKind: 'room-climate', members: ['sensor.a', 'sensor.b', 'cover.vent'] } };
    const states: Json[] = [{ entityId: 'sensor.a', state: '70.28', unit: '°F' }, { entityId: 'sensor.b', state: '73.49', unit: '°F' }, { entityId: 'cover.vent', state: 'open' }];
    expect(nativeSummary(room, states)).toBe('70.2°F - 73.4°F');
    expect(nativeSummary(room, [...states, { entityId: 'input_text.study_range', state: '70.28 - 73.49°F' }])).toBe('70.2 - 73.4°F');
    expect(nativeSummary(room, [])).toBe('Unavailable');
    expect(nativeSummary(room, [...states.slice(0, 2), { entityId: 'cover.vent', state: '100', currentTemperature: 100 }])).toBe('70.2°F - 73.4°F');
  });
  it('opens the bound weather card into an editable bound detail, and imports source alarm mode actions', () => {
    const { document } = importNativeHome(nativeFixture());
    const weather = descendants(document.pages[0].components).find(component => component.type === 'weather-summary')!;
    const detail = document.modals.find(modal => weather.action?.type === 'modal' && weather.action.modalId === modal.id)!;
    expect(detail.components[0]).toMatchObject({ type: 'weather-summary', binding: weather.binding, props: { presentation: 'detail', entityId: 'weather.example' } });
    const panel = document.modals.flatMap(modal => descendants(modal.components)).find(component => component.props.presentation === 'alarm-panel')!;
    expect(panel.type).toBe('section');
    expect(panel.children?.map(child => child.props.modeState)).toEqual(['disarmed', 'armed_home', 'armed_away', 'armed_night']);
    expect(panel.children?.[0].props).toMatchObject({ confirmationTitle: 'Disarm the Security System?', confirmation: 'Doors and motion stop triggering the alarm.', confirmationAction: 'Disarm' });
    expect(panel.children?.every(child => child.action?.type === 'service')).toBe(true);
    expect(panel.children?.some(child => child.title === 'Modes')).toBe(false);
    expect(validateDocument(document)).toEqual(document);
  });
  it('reuses editable room overview subpages instead of duplicating a modal for every room card', () => {
    const snapshot = nativeFixture();
    const rooms = snapshot.houseConfig.config.rooms as Record<string, Json>;
    rooms.pages = [{ id: 'study', title: 'Study', sections: [{
      title: 'Lights', cards: [{ title: 'Lights', entityId: 'light.lamp', kind: 'light', sheet: 'lights' }],
    }], overviewCards: [] }];
    const { document } = importNativeHome(snapshot);
    const chip = document.pages[0].components[0].children![0];
    const room = document.pages.find(page => page.id === 'room-study')!;
    const light = descendants(room.components).find(component => component.title === 'Lights' && component.type === 'action-tile')!;
    expect(light.action).toEqual(chip.action);
    const modal = document.modals.find(modal => chip.action?.type === 'modal' && modal.id === chip.action.modalId)!;
    expect(descendants(modal.components).some(component => component.id === light.props.initialDestinationId && component.props.presentation === 'subpage')).toBe(true);
    expect(validateDocument(document)).toEqual(document);
  });
  it('darkens valid helper RGB for white text, rejecting unsafe or invalid values', () => {
    const fill = nativeHelperFill('[255, 255, 255]')!;
    const channel = parseInt(fill.slice(1, 3), 16) / 255;
    const highlighted = channel * .88 + .12;
    const luminance = ((highlighted + .055) / 1.055) ** 2.4;
    expect(1.05 / (luminance + .05)).toBeGreaterThanOrEqual(4.5);
    expect(nativeHelperFill('[500, 2, 1]')).toBeUndefined();
    expect(nativeHelperFill('rgb(255, 255, 255)')).toBe(fill);
    expect(nativeHelperFill('rgba(255, 255, 255, 1)')).toBe(fill);
    expect(nativeHelperFill('[1, 2, 3)')).toBeUndefined();
    expect(nativeHelperFill('url(https://example.test)')).toBeUndefined();
  });
  it('maps source-shaped chip room overviews, read-only AQI, and editable in-sheet room destinations', () => {
    const { document } = importNativeHome(nativeFixture());
    const chips = document.pages[0].components[0].children!;
    const destination = (title: string) => {
      const action = chips.find(chip => chip.title === title)!.action!;
      return document.modals.find(modal => action.type === 'modal' && modal.id === action.modalId)!;
    };
    for (const title of ['Lights', 'Climate', 'Occupancy', 'Contacts']) {
      const nodes = descendants(destination(title).components);
      const room = nodes.find(node => node.title === 'Study' && node.type === 'navigation-tile')!;
      expect(room.props.arrangement).toBe('row');
      expect(nodes.some(node => node.id === room.props.destinationId && node.type === 'section')).toBe(true);
      expect(nodes.some(node => node.props.presentation === 'navigation-stack')).toBe(true);
    }
    expect(descendants(destination('Lights').components).map(node => node.props.activeTitle)).toContain('Lights On');
    expect(descendants(destination('Occupancy').components).map(node => node.props.inactiveTitle)).toContain('Clear');
    expect(descendants(destination('Climate').components).map(node => node.title)).toEqual(expect.arrayContaining(['Rooms', 'Temperature Sensor', 'Vent']));
    const aqi = descendants(destination('Air Quality').components).find(node => node.title === 'Study')!;
    expect(aqi.props).toMatchObject({ readOnly: true, entityId: 'sensor.study_aqi', detailEntityId: 'sensor.study_pm25' });
    expect(aqi.action).toBeUndefined();
    expect(descendants(destination('Security').components).filter(node => node.action?.type === 'service').map(node => node.title)).toEqual(['Disarm', 'Home', 'Away', 'Night']);
  });
  it('keeps Climate Advanced Controls separate, with configured tabs and tracking/eco subpages but no invented occupied-only IDs', () => {
    const snapshot = nativeFixture();
    snapshot.houseConfig.config.climate = {
      ...snapshot.houseConfig.config.climate as Record<string, Json>,
      ecoCriticalEntityId: 'select.fixture_eco_critical', ecoAwayEntityId: 'select.fixture_eco_away',
    };
    const { document } = importNativeHome(snapshot);
    const advanced = document.modals.find(modal => modal.title === 'Advanced Controls')!;
    const nodes = descendants(advanced.components), tabs = nodes.find(node => node.props.presentation === 'tabs')!;
    expect(tabs.children?.map(child => child.title)).toEqual(['Rooms', 'Automation', 'Tracking']);
    expect(nodes.map(node => node.title)).toEqual(expect.arrayContaining(['Selected Rooms', 'Critical Protection', 'Occupied Only', 'Eco Mode Critical Tracking', 'Eco Behavior When Away', 'Current Prediction']));
    expect(JSON.stringify(document)).not.toContain('study_occupied_only');
    expect(nodes.find(node => node.props.nativeKind === 'climate-room')?.props.entityId).toBe('sensor.thermostat_contact_sensors_study_temperature');
    expect(nodes.find(node => node.props.nativeKind === 'climate-room')?.props.showState).toBe(true);
    expect(nodes.find(node => node.title === 'Automatic Thermostat' && node.children)?.subtitle)
      .toBe("Turn Home Assistant's automatic thermostat control on or off.");
    expect(nodes.find(node => node.props.presentation === 'navigation-stack')?.props.childClose).toBe(true);
    expect(nodes.some(node => node.props.choiceList === true)).toBe(true);
    const links = descendants(document.pages.find(page => page.title === 'Climate')!.components).filter(node => node.action?.type === 'modal' && node.action.modalId === advanced.id);
    expect(links.map(node => node.subtitle)).toEqual([
      "View each room's temperature and occupancy, then open a room to adjust its target and check vent position.",
      'Manage Automatic Thermostat, Eco Mode, and Predictive Comfort settings.',
      'Choose which rooms participate in normal comfort, critical protection, or occupancy-only tracking.',
    ]);
    expect(links.map(node => node.props.initialTabId)).toEqual(tabs.children?.map(child => child.id));
    expect(validateDocument(document)).toEqual(document);
  });
  it('imports one Guests group with every configured toggle and editable explanatory content', () => {
    const snapshot = nativeFixture();
    (snapshot.houseConfig.config.home as Record<string, Json>).guestToggles = [
      { title: 'One', entityId: 'input_boolean.guest_one' }, { title: 'Two', entityId: 'switch.guest_two' },
    ];
    const { document } = importNativeHome(snapshot);
    const groups = document.pages.flatMap(page => descendants(page.components)).filter(node => node.props.presentation === 'guest-group');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.title).toBe('Guests Staying Over');
      expect(group.subtitle).toBe('Guest mode skips some away automations. Review security, climate, and auto-clean controls before leaving.');
      expect(group.children?.map(child => child.title)).toEqual(['One', 'Two']);
      expect(group.children?.every(child => !child.visibility && child.props.presentation === 'guest-toggle' && !child.action)).toBe(true);
    }
    expect(validateDocument(document)).toEqual(document);
  });
  it.each(['', '../Invalid'])('rejects unsafe climate room derivations during import: %j', title => {
    const snapshot = nativeFixture();
    snapshot.houseConfig.config.climate = { rooms: [{ title }] };
    expect(() => importNativeHome(snapshot)).toThrow('Native climate room title cannot produce safe entity IDs');
  });
  it('configures camera viewer controls from recording scripts, retains stream metadata, and does not embed transport URLs', () => {
    const snapshot = nativeFixture();
    snapshot.houseConfig.config.home = { ...snapshot.houseConfig.config.home as object, cameras: [
      { title: 'Door', entityId: 'camera.door', rtcStreamId: 'door', aspectRatio: 4 / 3 },
      { title: 'Garden', entityId: 'camera.garden', recordingScriptEntityId: 'script.record_garden' },
    ] };
    const { document } = importNativeHome(snapshot);
    const feeds = document.modals.flatMap(modal => descendants(modal.components)).filter(node => node.type === 'camera-feed');
    expect(feeds.find(node => node.title === 'Door')?.props).toMatchObject({ viewer: true, entityId: 'camera.door', rtcStreamId: 'door', controls: ['snapshot', 'sound'], aspectRatio: 4 / 3 });
    expect(feeds.find(node => node.title === 'Garden')?.props.controls).toEqual(['snapshot', 'sound', 'record']);
    expect(feeds.every(node => node.props.url === undefined && node.props.src === undefined)).toBe(true);
    const cards = descendants(document.pages[0].components).filter(node => node.props.presentation === 'camera-card');
    expect(cards[0].props.aspectRatio).toBe(1 / .78);
    expect(document.dataSources[0].sample).toEqual([]);
  });
  it('represents eleven-room drilldowns without exceeding the modal budget or storing live state', () => {
    const snapshot = nativeFixture();
    const rooms = snapshot.houseConfig.config.rooms as Record<string, Component['props'][string]>;
    for (const key of ['lightGroups', 'climateGroups', 'occupancyGroups', 'contactGroups']) rooms[key] = Array.from({ length: 11 }, (_, index) => ({ room: `Room ${index}`, items: [{ title: 'Device', entityId: `sensor.room_${index}` }] }));
    const { document } = importNativeHome(snapshot);
    expect(document.modals.length).toBeLessThan(50);
    expect(validateDocument(document)).toEqual(document);
    expect(JSON.stringify(document)).not.toContain('Private live entity label');
  });
});

describe('UIKit-derived layout measurements', () => {
  it('keeps all normal text sizes on one scrolling rail and switches only at accessibility size', () => {
    expect([.75, 1, 1.4, 1.6].map(isAccessibilityText)).toEqual([false, false, false, false]);
    expect(isAccessibilityText(25 / 15)).toBe(true);
    expect(nativeTileMetrics('row', 1, false).minimumHeight).toBe(72);
    expect(nativeTileMetrics('anchored-bottom', 1, false).minimumHeight).toBe(96);
    expect(nativeTileMetrics('centered-stack', 1, false).minimumHeight).toBe(84);
    expect(nativeTileMetrics('stacked-top', 1, false).minimumHeight).toBe(112);
    expect(nativeTileMetrics('anchored-bottom', 1, true).titleReserve).toBe(40);
    expect(nativeTileMetrics('row', 25 / 15, false).arrangement).toBe('anchored-bottom');
  });
  it('shares a short row, fills multirow spare tracks narrowest-first with later ties, and never fills camera rows', () => {
    const tiles = Array.from({ length: 3 }, () => ({}));
    const short = solveNativeGrid(637, tiles, { minimumWidth: 150 });
    expect(short.columns).toBe(4);
    expect(short.shared).toBe(true);
    short.placements.forEach(item => expect(item.width).toBeCloseTo((637 - 24) / 3));
    const multirow = solveNativeGrid(636, [...tiles, {}, {}, {}, {}], { minimumWidth: 150 });
    expect(multirow.placements.slice(4).map(item => item.span)).toEqual([1, 1, 2]);
    const lone = solveNativeGrid(636, [...tiles, {}, {}], { minimumWidth: 150 });
    expect(lone.placements.at(-1)?.span).toBe(4);
    const cameras = solveNativeGrid(700, [{}, {}, {}, {}, {}], { minimumWidth: 160, fill: false });
    expect(cameras.placements.at(-1)?.span).toBe(1);
    expect(cameras.placements.at(-1)?.width).toBeCloseTo(166);
    expect(solveNativeGrid(636, [{ minimumWidth: 312 }, {}, {}, {}], { minimumWidth: 150 }).placements[0].span).toBe(2);
    expect(nativeSectionColumns(637, 1)).toBe(1);
    expect(nativeSectionColumns(703, 1)).toBe(1);
    expect(nativeSectionColumns(704, 1)).toBe(2);
    expect(nativeSectionColumns(704, .75)).toBe(2);
    expect(nativeSectionColumns(704, 1.4)).toBe(1);
  });
  it.each([
    ['closed', 'portrait', 466, 678, true, undefined, 450],
    ['closed', 'landscape', 678, 466, true, undefined, 289],
    ['partial', 'portrait', 669, 951, false, undefined, 653],
    ['partial', 'landscape', 951, 669, true, 455.3, 447],
    ['open', 'portrait', 669, 951, false, undefined, 653],
    ['open', 'landscape', 951, 669, true, undefined, 425],
  ] as const)('uses the pinned %s %s viewport without inventing a portrait split', (posture, orientation, width, height, side, hinge, sheetWidth) => {
    const geometry = duoGeometry(posture, orientation);
    expect(geometry).toMatchObject({ width, height, trailingControls: side, sheetWidth });
    expect(geometry.hinge?.start).toBe(hinge);
    if (orientation === 'portrait' && posture !== 'closed') expect(geometry.contentWidth).toBe(637);
    expect(geometry.horizontalFoldUnverified).toBe(posture === 'partial' && orientation === 'portrait');
  });
  it('positions full-width rail, weather left, cameras then guests right independently of section heights', () => {
    const geometry = duoGeometry('partial', 'landscape');
    expect(geometry.foldColumns?.leading).toBeCloseTo(423.3);
    expect(geometry.foldColumns?.trailing).toBeCloseTo(340.3);
    const entries = [{ side: 'rail', height: 60 }, { side: 'leading', height: 400 }, { side: 'trailing', height: 200 }, { side: 'trailing', height: 72 }];
    const result = placeFoldSections(entries, geometry.foldColumns!, 24, false);
    expect(result.frames[0].width).toBeCloseTo(836);
    expect(result.frames[1].top).toBe(84);
    expect(result.frames[2]).toMatchObject({ top: 84 });
    expect(result.frames[2].left).toBeCloseTo(495.7);
    expect(result.frames[3].top).toBe(308);
    const accessible = placeFoldSections(entries, geometry.foldColumns!, 24, true);
    expect(accessible.frames[0].width).toBeCloseTo(423.3);
    expect(accessible.frames[2].top).toBe(0);
    const reordered = placeFoldSections([{ side: 'trailing', height: 72, order: 1 }, { side: 'trailing', height: 200, order: 0 }], geometry.foldColumns!, 24, false);
    expect(reordered.frames[1].top).toBe(0);
    expect(reordered.frames[0].top).toBe(224);
  });
});
