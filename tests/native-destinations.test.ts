import { describe, expect, it } from 'vitest';
import { importNativeHome, type NativeSnapshot } from '../src/shared/native-preview';
import { validateDocument } from '../src/shared/schema';
import type { Component, Json } from '../src/shared/types';
import { nativePresentationVisible } from '../src/shared/native-presentation';

const descendants = (components: Component[]): Component[] => components.flatMap(component => [component, ...descendants(component.children ?? [])]);
const fixture = (): NativeSnapshot => ({
  mode: 'live',
  houseConfig: {
    schema: 2, hash: 'b'.repeat(64),
    config: {
      home: { weatherEntityId: 'weather.example', statusChips: [], cameras: [], guestToggles: [{ title: 'Guests', entityId: 'input_boolean.guests' }] },
      security: { alarmEntityId: 'alarm_control_panel.example', controlTiles: [] },
      climate: { rooms: [] },
      chores: {
        people: [{ key: 'resident_1', haUserId: 'configured-user', name: 'Configured Resident', summaryLists: { overdue: 'todo.overdue', dueToday: 'todo.today', noDueDate: 'todo.undated' } }],
        pages: [
          { id: 'chores', title: 'Chores', lists: [{ title: 'Tasks', entityId: 'todo.tasks', userIds: ['configured-user'], hideCompleted: true }] },
          { id: 'groceries', title: 'Groceries', lists: [{ title: 'Groceries', entityId: 'todo.groceries' }] },
        ],
        quickLinks: [{ title: 'Groceries', pageId: 'groceries' }],
      },
      rooms: {
        lightGroups: [], climateGroups: [], occupancyGroups: [], contactGroups: [],
        pages: [{ id: 'studio', title: 'Studio', overviewCards: [], sections: [{ title: 'Devices', cards: [
          { title: 'Vacuum', entityId: 'vacuum.studio', kind: 'vacuum', sheet: 'robot-vacuum' },
          { title: 'TV', entityId: 'media_player.studio', kind: 'media', sheet: 'studio-remote' },
          { title: 'Bed', entityId: 'climate.bed', kind: 'climate', sheet: 'bed-one' },
          { title: 'Wake-Light', entityId: 'sensor.wake', kind: 'wake-light', sheet: 'wake' },
          { title: 'Humidifier', entityId: 'switch.humidifier', kind: 'humidifier', sheet: 'humidifier' },
          { title: 'Air', entityId: 'sensor.purifier_pm2_5', kind: 'air', sheet: 'air-purifier' },
          { title: 'Bathroom Fan', entityId: 'switch.bathroom_fan', kind: 'fan', control: 'bathroom-fan', sheet: 'bathroom-fan' },
          { title: 'Grill', entityId: 'sensor.grill', kind: 'grill', sheet: 'grill' },
        ] }] }],
        grid: { items: [{ title: 'Studio', path: 'studio' }] },
        quickLinks: [
          { id: 'rooms', title: 'Rooms' },
          ...['custom-lights', 'food', 'media', 'vacuums', 'sprinklers'].map(id => ({ id, title: id, action: { type: 'navigate', path: id } })),
        ],
      },
      customLights: {
        manualControlEntityId: 'input_boolean.manual', modeEntityId: 'select.lighting_mode',
        groupEntityId: 'light.outdoor', sectionTitle: 'Front Yard', lightingModeTitle: 'Lighting Mode',
        customMode: 'Custom', fallbackModes: ['Default', 'Custom'], lights: [{ title: 'Path Light', entityId: 'light.path' }],
      },
      food: {
        expiringSoonEntityId: 'sensor.food_expiring', totalItemsEntityId: 'sensor.food_total', expiredItemsEntityId: 'sensor.food_expired',
        spaces: [{ title: 'Pantry', entityId: 'sensor.pantry_items', location: 'pantry', icon: 'Archive' }],
      },
      media: {
        pageSections: [{ title: 'Studio', cards: [{ device: { title: 'Studio TV', entityId: 'media_player.studio' }, remoteId: 'studio-remote' }] }],
        remotes: [{
          id: 'studio-remote', title: 'Studio', remoteTitle: 'Studio Remote', mediaEntityId: 'media_player.studio', controlEntityId: 'remote.studio',
          up: { label: 'Up', action: { type: 'command', command: { type: 'service', call: { domain: 'remote', service: 'send_command', target: 'remote.studio', data: { command: 'DPAD_UP' } } } } },
          apps: [{ title: 'Configured App', action: { type: 'command', command: { type: 'service', call: { domain: 'script', service: 'studio_app', data: { preset: 'cinema' } } } } }],
          devices: [], lightSync: { powerEntityId: 'switch.sync_power', syncModeEntityId: 'select.sync_mode' },
        }],
      },
      vacuums: {
        vacuums: [{
          title: 'Studio Vacuum', entityId: 'vacuum.studio', batteryEntityId: 'sensor.vacuum_battery', cleanScript: 'script.vacuum_clean',
          zones: [{ title: 'Studio', entityId: 'input_boolean.clean_studio', mapName: 'Studio' }],
          consumables: [{ title: 'Filter', entityId: 'sensor.vacuum_filter', valueKind: 'hours' }],
          modeEntityId: 'select.clean_mode', vacuumMapId: 'studio-map',
          dockControls: { dockStatusEntityId: 'sensor.dock', cleanScript: 'script.clean_mop' },
        }],
        autoCleanControls: [{ title: 'Pause Cleaning', entityId: 'input_boolean.pause_cleaning', kind: 'pause' }],
      },
      sprinklers: {
        defaultStartTime: '07:00',
        controllers: [{ id: 'yard', title: 'Yard', stateEntityId: 'sensor.sprinkler', batteryEntityId: 'sensor.sprinkler_battery',
          modeEntityId: 'select.sprinkler_mode', zones: [{ valveEntityId: 'valve.yard', programEntityId: 'sensor.yard_program', historyEntityId: 'sensor.yard_history' }] }],
      },
      household: {
        securityTiles: [{ title: 'Auto-Lock', entityId: 'input_boolean.auto_lock' }],
        presenceRooms: [{ title: 'Studio', presenceEntityId: 'switch.presence', autoReenableEntityId: 'switch.presence_reset' }],
        highAqiTile: { title: 'High AQI Mode', entityId: 'input_boolean.high_aqi' },
        powerRecoveryAutomation: 'automation.power_recovery',
        relayTiles: [{ title: 'Relay Control', entityId: 'input_boolean.relay' }],
        showSpecificTiles: [{ title: 'Outdoor Faucets', entityId: 'input_boolean.outdoor_faucets' }],
        vehicleTiles: [{ title: 'Charge Status', entityId: 'sensor.car_charge' }],
      },
      vacation: {
        modeEntityId: 'input_boolean.vacation', startEntityId: 'input_datetime.vacation_start', endEntityId: 'input_datetime.vacation_end',
        checklist: [{ title: 'Doors Locked', entityId: 'input_boolean.doors_checked' }],
      },
      bedroom: {
        scheduleEntityId: 'sensor.bed_schedule', scheduleSetTopic: 'bed/command/schedule',
        householdAwayEntityId: 'sensor.household_away', householdAwayScript: 'household_away',
        wakeLight: { id: 'studio-wake', title: 'Wake-Light Alarms', statusEntityId: 'sensor.wake', sources: [{ id: 'side-one', bedId: 'bed-one', alarmsLabel: 'Bed Alarms' }] },
        beds: [{
          id: 'bed-one', title: 'Bed', climateEntityId: 'climate.bed', targetLevelEntityId: 'number.bed_level',
          stageLevelEntityIds: { bedtime: 'number.bed_bedtime' }, alarmStateEntityId: 'sensor.bed_alarm',
          alarmStopButtonEntityId: 'button.stop_bed_alarm', hotFlashButtonEntityId: 'button.hot_flash',
          heartRateEntityId: 'sensor.heart_rate', pumpRpmEntityId: 'sensor.pump_rpm',
        }],
      },
      roomDevices: {
        airPurifiers: [{ roomTitle: 'Studio', pm25EntityId: 'sensor.purifier_pm2_5' }],
        bathroomFans: [{ id: 'bathroom-fan', roomTitle: 'Studio', powerEntityId: 'switch.bathroom_fan', timerEntityId: 'timer.bathroom_fan', lockEntityId: 'input_boolean.fan_locked', scriptService: 'script.fan_toggle' }],
        humidifiers: [{ id: 'humidifier', title: 'Humidifier', powerEntityId: 'switch.humidifier', modeEntityId: 'select.humidifier_mode', targetHumidityEntityId: 'number.target_humidity', scheduleId: 'humidifier', scheduleEntityId: 'schedule.humidifier', timerMinutesEntityId: 'number.humidifier_timer' }],
        grills: [{ title: 'Grill', roomTitle: 'Studio', stateEntityId: 'sensor.grill', details: [{ title: 'Probe', entityId: 'sensor.grill_probe' }] }],
      },
    },
  },
  states: [],
});

describe('source-derived native destinations', () => {
  it('imports the configured vacuum topology and clean script without a fabricated area payload', () => {
    const { document } = importNativeHome(fixture());
    const modal = document.modals.find(modal => modal.title === 'Studio Vacuum Robot Vacuum')!;
    const root = modal.components[0];
    expect(root.props.presentation).toBe('vacuum-sheet');
    expect(root.children?.filter(child => child.props.vacuumTab).map(child => child.title))
      .toEqual(['Controls', 'Rooms', 'Auto-Clean', 'Dock', 'Info']);
    expect(descendants([root]).find(child => child.props.vacuumAction === 'clean')?.action)
      .toEqual({ type: 'service', domain: 'script', service: 'turn_on', entityId: 'script.vacuum_clean' });
    expect(root.children?.filter(child => child.props.vacuumPage).map(child => child.props.vacuumPage)).toEqual(['area', 'report']);
    expect(root.children?.find(child => child.props.vacuumTab === 'autoClean')?.children?.[0])
      .toMatchObject({ title: 'Studio', props: { entityId: 'input_boolean.clean_studio', checkRow: true, checkedText: 'Included', uncheckedText: 'Skipped' } });
    expect(descendants([root]).some(child => child.action?.type === 'service' && child.action.service === 'send_command')).toBe(false);
    expect(validateDocument(document)).toEqual(document);
  });
  it('compiles ordered remote cases and otherwise to exactly one safe editable action', () => {
    const snapshot = fixture();
    const remotes = (snapshot.houseConfig.config.media as Record<string, Json>).remotes as Record<string, Json>[];
    const command = (command: string) => ({ type: 'service', call: { domain: 'remote', service: 'send_command', target: 'remote.studio', data: { command } } });
    remotes[0].power = { label: 'Power', action: { type: 'state', entityId: 'media_player.studio', cases: [
      { states: ['off', 'paused'], command: command('first') },
      { states: ['paused', 'playing'], command: command('second') },
    ], otherwise: command('otherwise') } };
    const { document } = importNativeHome(snapshot);
    const keys = document.modals.flatMap(modal => descendants(modal.components)).filter(child => child.props.remoteKey === 'power');
    expect(keys.map(key => key.title)).toEqual(['Power', 'Power', 'Power']);
    for (const [state, expected] of [['paused', 'first'], ['playing', 'second'], ['idle', 'otherwise']]) {
      const visible = keys.filter(key => nativePresentationVisible(key, [{ entityId: 'media_player.studio', state }]));
      expect(visible).toHaveLength(1);
      expect(visible[0].action).toMatchObject({ data: { command: expected } });
    }
    expect(JSON.stringify(document)).not.toMatch(/configuredCommand|configuredStateAction|\(alternate\)/);
    expect(validateDocument(document)).toEqual(document);
    remotes[0].power = { action: { type: 'state', entityId: 'media_player.studio', cases: [{ states: [], command: command('bad') }] } };
    expect(() => importNativeHome(snapshot)).toThrow('nonempty string states');
  });
  it('resolves every configured link to editable relevant content without placeholder screens', () => {
    const snapshot = fixture();
    const { document, warnings } = importNativeHome(snapshot);
    expect(validateDocument(document)).toEqual(document);
    const nodes = descendants([...document.pages.flatMap(page => page.components), ...document.modals.flatMap(modal => modal.components)]);
    for (const component of nodes) {
      const action = component.action;
      if (action?.type === 'modal') expect(document.modals.some(modal => modal.id === action.modalId)).toBe(true);
      if (action?.type === 'navigate') expect(document.pages.some(page => page.id === action.pageId)).toBe(true);
    }
    expect(document.pages.map(page => page.title)).toEqual(expect.arrayContaining(['custom-lights', 'food', 'media', 'vacuums', 'sprinklers', 'Vacation', 'Admin', 'Special Device Modes', 'Guests', 'Car']));
    expect(nodes.map(component => component.title)).toEqual(expect.arrayContaining([
      'Lighting Mode', 'Suggested Recipes', 'All Recipes', 'All Food', 'Food Spaces',
      'Automatic Cleaning', 'Zones', 'Remote', 'Apps', 'Hue Sync', 'Temperature', 'Special Modes', 'Alarms', 'Status',
      'Fan Mode', 'Auto Mode', 'Fan Speed', 'Pre-Vacation Checklist', 'Vacation Dates', 'Solo Trip',
    ]));
    const serialization = JSON.stringify(document);
    expect(serialization).not.toMatch(/not reproduced|not implemented|Preview persona|specialized destination/i);
    expect(nodes.filter(component => component.props.presentation === 'control').length).toBeGreaterThan(35);
    expect(warnings.join('\n')).toContain('server collection contract');
    expect(document.modals.length).toBeLessThan(50);
  });
  it('keeps domain controls and source remote service targets explicit and safe', () => {
    const { document } = importNativeHome(fixture());
    const nodes = document.modals.flatMap(modal => descendants(modal.components));
    expect(nodes.find(component => component.title === 'Up')?.action).toEqual({ type: 'service', domain: 'remote', service: 'send_command', entityId: 'remote.studio', data: { command: 'DPAD_UP' } });
    expect(nodes.find(component => component.title === 'Configured App')?.action).toEqual({ type: 'service', domain: 'script', service: 'turn_on', entityId: 'script.studio_app', data: { variables: { preset: 'cinema' } } });
    expect(nodes.find(component => component.title === 'Stop Alarm')?.action).toEqual({ type: 'service', domain: 'button', service: 'press', entityId: 'button.stop_bed_alarm' });
    expect(nodes.find(component => component.props.entityId === 'select.purifier_auto_mode')?.props.controlKind).toBe('select');
    expect(nodes.find(component => component.props.entityId === 'select.purifier_fan_mode')?.props.controlKind).toBe('select');
    expect(nodes.some(component => component.props.entityId === 'fan.purifier')).toBe(false);
    expect(nodes.some(component => component.props.requiredData === 'vacuum-map' && component.props.vacuumMapId === 'studio-map')).toBe(true);
    expect(validateDocument(document)).toEqual(document);
  });
  it('keeps custom lighting behind manual/custom mode and uses the native warm-white reset payload', () => {
    const { document } = importNativeHome(fixture());
    const custom = document.pages.find(page => page.title === 'custom-lights')!;
    const manual = descendants(custom.components).find(component => component.visibility?.key === 'input_boolean.manual')!;
    expect(manual.visibility).toMatchObject({ operator: 'equals', value: 'on' });
    const lights = descendants(manual.children ?? []).find(component => component.title === 'Lights')!;
    expect(lights.visibility).toEqual({ source: 'entity', key: 'select.lighting_mode', operator: 'equals', value: 'Custom' });
    expect(lights.children?.find(component => component.title === 'Reset All Lights')?.action).toEqual({
      type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.outdoor',
      data: { color_temp_kelvin: 2000, brightness: 255, transition: 1 },
    });
  });
  it('ports bathroom fan script commands rather than toggling timer and lock helpers directly', () => {
    const { document } = importNativeHome(fixture());
    const fan = document.modals.find(modal => modal.title === 'Studio Fan')!;
    const nodes = descendants(fan.components);
    expect(nodes.find(component => component.title === 'Turn On')?.action).toEqual({
      type: 'service', domain: 'script', service: 'turn_on', entityId: 'script.fan_toggle',
      data: { variables: { command: 'power', target_power: 'on' } },
    });
    expect(nodes.find(component => component.title === 'Turn Off in 30 Minutes')?.action).toMatchObject({
      data: { variables: { command: 'timer_start', minutes: 30, auto_unlock: true } },
    });
    expect(nodes.find(component => component.title === 'Cancel Timer')?.action).toMatchObject({ data: { variables: { command: 'timer_cancel' } } });
    expect(nodes.find(component => component.title === 'Lock Fan')?.action).toMatchObject({ data: { variables: { command: 'lock', locked: true } } });
    expect(nodes.find(component => component.title === 'Locked')?.props.controlKind).toBe('sensor');
    expect(validateDocument(document)).toEqual(document);
  });
  it('declares missing collection data and source resident filters without storing current-user or forecast records', () => {
    const snapshot = fixture();
    snapshot.currentUser = { id: 'CAPTURED_USER', name: 'CAPTURED_PERSON', isOwner: true, isAdmin: true };
    snapshot.states = [{ entityId: 'weather.example', state: 'sunny', name: 'CAPTURED_WEATHER', dailyForecast: [{ datetime: 'CAPTURED_FORECAST', temperature: 987.654 }] }];
    const before = structuredClone(snapshot);
    const { document } = importNativeHome(snapshot);
    const profileModal = document.modals.find(modal => modal.id === 'native-profile')!;
    const profile = descendants(profileModal.components).find(component => component.type === 'profile')!;
    expect(profile).toMatchObject({ title: 'Your Summary', binding: { sourceId: 'native-profile' }, props: { residentMatch: 'haUserId' } });
    expect(profile.props.name).toBeUndefined();
    expect(profileModal.components[0].children?.map(child => child.title)).toEqual(['Profile', 'Overdue Chores', 'Upcoming Chores', 'Expired Food']);
    const todos = document.pages.flatMap(page => descendants(page.components)).find(component => component.props.collectionKind === 'todo-items')!;
    expect(todos).toMatchObject({ binding: { sourceId: 'native-states' }, props: { requiredData: 'todo-items', currentUserIds: ['configured-user'], hideCompleted: true } });
    expect(JSON.stringify(document)).not.toContain('CAPTURED_');
    expect(JSON.stringify(document)).not.toContain('987.654');
    expect(document.dataSources.every(source => source.sample === null || Array.isArray(source.sample) && source.sample.length === 0)).toBe(true);
    expect(snapshot).toEqual(before);
  });
  it('does not make cross-domain sprinkler payloads into unsafe service actions', () => {
    const snapshot = fixture();
    const media = snapshot.houseConfig.config.media as Record<string, Json>;
    const remotes = media.remotes as Record<string, Json>[];
    remotes[0].power = { label: 'Water Now', action: { type: 'command', command: { type: 'service', call: {
      domain: 'bhyve', service: 'start_watering', target: 'valve.yard', data: { entity_id: 'valve.yard' },
    } } } };
    const { document, warnings } = importNativeHome(snapshot);
    const nodes = document.modals.flatMap(modal => descendants(modal.components));
    expect(nodes.find(component => component.title === 'Water Now')?.action).toBeUndefined();
    expect(warnings.join('\n')).toContain('backend target translation');
    expect(validateDocument(document)).toEqual(document);
  });
  it('rejects malformed or unknown configured destinations instead of repairing them silently', () => {
    const invalidEntity = fixture();
    (invalidEntity.houseConfig.config.customLights as Record<string, Json>).modeEntityId = '../unsafe';
    expect(() => importNativeHome(invalidEntity)).toThrow('Invalid native destination entity');
    const unknown = fixture();
    (unknown.houseConfig.config.rooms as Record<string, Json>).quickLinks = [{ id: 'unknown', title: 'Unknown' }];
    expect(() => importNativeHome(unknown)).toThrow('Unsupported native destination: unknown');
    const invalidRemote = fixture();
    (invalidRemote.houseConfig.config.media as Record<string, Json>).pageSections = [{ title: 'Studio', cards: [{ device: { title: 'TV', entityId: 'media_player.studio' }, remoteId: '../remote' }] }];
    expect(() => importNativeHome(invalidRemote)).toThrow('Invalid native destination ID');
  });
});
