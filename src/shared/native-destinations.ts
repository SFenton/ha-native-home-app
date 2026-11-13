import type { Action, Component, Json } from './types';

type RecordValue = Record<string, Json>;
type Builder = {
  config: RecordValue;
  warnings: Set<string>;
  node: (type: Component['type'], title: string, props?: RecordValue, icon?: string) => Component;
  bound: (type: Component['type'], title: string, entityId: unknown, props?: RecordValue, icon?: string) => Component;
  group: (title: string, children: Component[], props?: RecordValue) => Component;
  detail: (title: string, children: Component[]) => Action;
  page: (id: string, title: string, icon: string, children: Component[]) => void;
};
const rec = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const rows = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(rec) : [];
const str = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const entityPattern = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,64}$/;
const entity = (value: unknown): string => {
  const id = str(value);
  if (!entityPattern.test(id) || id.length > 160) throw new Error(`Invalid native destination entity: ${id}`);
  return id;
};
const key = (value: unknown): string => {
  const id = str(value);
  if (!keyPattern.test(id)) throw new Error(`Invalid native destination ID: ${id}`);
  return id;
};

/** Source configuration only: snapshots and resolved identities never enter this builder. */
export function createNativeDestinations(b: Builder) {
  const { config, node, bound, group } = b;
  const cached = new Map<string, Action>();
  const section = (name: string) => rec(config[name]);
  const once = (id: string, title: string, children: () => Component[], asPage = false): Action => {
    const previous = cached.get(id);
    if (previous) return previous;
    if (asPage) {
      const action: Action = { type: 'navigate', pageId: `native-${key(id)}` };
      cached.set(id, action);
      b.page(action.pageId, title, 'square.grid.2x2', children());
      return action;
    }
    const action = b.detail(title, children());
    cached.set(id, action);
    return action;
  };
  const warn = (message: string) => { b.warnings.add(message); };
  const service = (id: unknown, name: string, data?: RecordValue): Action => {
    const entityId = entity(id);
    return { type: 'service', domain: entityId.split('.')[0], service: name, entityId, ...(data ? { data } : {}) };
  };
  const script = (id: unknown, variables?: RecordValue): Action => {
    const value = str(id);
    return service(value.startsWith('script.') ? value : `script.${value}`, 'turn_on', variables ? { variables } : undefined);
  };
  const control = (title: string, id: unknown, props: RecordValue = {}, icon = ''): Component => {
    const entityId = entity(id);
    const domain = entityId.split('.')[0];
    const kinds: Record<string, string> = {
      light: 'light', climate: 'climate', cover: 'cover', fan: 'fan', select: 'select', input_select: 'select',
      switch: 'toggle', input_boolean: 'toggle', media_player: 'media', vacuum: 'vacuum',
      humidifier: 'humidifier', number: 'number', input_number: 'number',
    };
    const tile = bound('action-tile', title, entityId, { presentation: 'control', controlKind: kinds[domain] ?? 'sensor', ...props }, icon);
    if (domain === 'button' || domain === 'input_button') tile.action = service(entityId, 'press');
    return tile;
  };
  const fields = (data: RecordValue, definitions: [string, string][], props: RecordValue = {}) => definitions.flatMap(([field, title]) =>
    data[field] ? [control(title, data[field], props)] : []);
  const tile = (title: string, action: Action, icon = '') => ({ ...node('action-tile', title, {}, icon), action });
  const link = (title: string, action: Action, icon = '') => ({ ...node('settings-row', title, {}, icon), action });
  const tabs = (children: Component[]) => group('', children, { presentation: 'tabs' });
  const collection = (title: string, kind: string, props: RecordValue = {}): Component => {
    if (!['household-people', 'todo-items', 'resident-todo-items'].includes(kind)) warn(`${kind} requires a server collection contract; only its editable source configuration is imported.`);
    const component = node(kind === 'suggested-recipes' ? 'carousel' : 'list', title, {
      collectionKind: kind, ...props, ...(kind === 'household-people' ? {} : { requiredData: kind }),
      emptyText: 'Nothing To Show', unavailableText: `${title} unavailable`,
      ...(['todo-items', 'resident-todo-items'].includes(kind) ? props : {}),
    });
    component.binding = { sourceId: 'native-states' };
    return component;
  };
  const configuredTiles = (value: Json | undefined) => rows(value).map(item =>
    control(str(item.title), item.entityId, { showState: item.showsState ?? true }, str(item.icon)));

  const command = (value: unknown): Action | undefined => {
    const data = rec(value);
    if (data.type !== 'service') return undefined;
    const call = rec(data.call);
    const domain = str(call.domain);
    const name = str(call.service);
    if (!/^[a-z_]+$/.test(domain) || !/^[a-z0-9_]+$/.test(name)) throw new Error('Invalid configured native service');
    const payload = rec(call.data);
    if (Object.keys(payload).some(k => ['entity_id', 'area_id', 'device_id', 'floor_id', 'label_id'].includes(k))) {
      warn(`Native ${domain}.${name} requires backend target translation; no unsafe service action was generated.`);
      return undefined;
    }
    const target = str(call.target);
    if (!target && domain === 'script') return service(`script.${name}`, 'turn_on', Object.keys(payload).length ? { variables: payload } : {});
    if (!target) {
      warn(`Native ${domain}.${name} has no representable entity target.`);
      return undefined;
    }
    if (entity(target).split('.')[0] !== domain) {
      warn(`Native ${domain}.${name} requires backend target translation; no cross-domain action was generated.`);
      return undefined;
    }
    return service(target, name, payload);
  };
  const remoteActions = (title: string, value: unknown, fallbackEntity: unknown, icon = ''): Component[] => {
    const action = rec(value);
    const make = (value: unknown) => {
      const resolved = command(value);
      if (resolved) return tile(title, resolved, icon);
      warn('Native text prompts and non-service commands are unavailable without a structured safe adapter.');
      return node('action-tile', title, { disabled: true, unavailableText: 'Configured command adapter unavailable.' }, icon);
    };
    if (action.type === 'command') {
      return [make(action.command)];
    }
    if (action.type === 'state') {
      const entityId = entity(action.entityId ?? fallbackEntity);
      const cases = rows(action.cases);
      const allStates: string[] = [];
      const branches: Component[] = cases.map(branch => {
        if (!Array.isArray(branch.states) || !branch.states.length || branch.states.some(value => typeof value !== 'string' || !value.trim()))
          throw new Error('Configured remote state cases require nonempty string states.');
        const states = branch.states as string[];
        const excludedStates = [...allStates];
        allStates.push(...states);
        const component = make(branch.command);
        component.props = { ...component.props, stateEntityId: entityId, matchStates: states, excludedStates };
        component.binding = { sourceId: 'native-states' };
        return component;
      });
      if (action.otherwise) {
        const alternate = make(action.otherwise);
        alternate.props = { ...alternate.props, stateEntityId: entityId, alternateForStates: allStates };
        alternate.binding = { sourceId: 'native-states' };
        branches.push(alternate);
      }
      return branches;
    }
    return [];
  };
  const remote = (id: string): Action => {
    const data = rows(section('media').remotes).find(r => r.id === id);
    if (!data) throw new Error(`Unknown configured media remote: ${id}`);
    return once(`remote-${key(id)}`, str(data.remoteTitle, str(data.title, 'Remote')), () => {
      const mediaEntityId = entity(data.mediaEntityId ?? data.controlEntityId);
      const remoteButtons = (names: string[]) => names.flatMap(name => {
        const button = rec(data[name]);
        return remoteActions(str(button.label, name.replace(/^\w/, letter => letter.toUpperCase())), button.action,
          data.controlEntityId ?? data.mediaEntityId, str(button.icon)).map(component => ({
          ...component, binding: { sourceId: 'native-states' },
          props: { ...component.props, presentation: 'remote-key', remoteKey: name, remoteMediaEntityId: mediaEntityId },
        }));
      });
      const sections = [group('Remote', [
        group('Controls', remoteButtons(['back', 'up', 'power', 'left', 'select', 'right', 'home', 'down', 'keyboard']), { presentation: 'remote-pad', columns: 3, adaptive: false }),
        group('Playback', remoteButtons(['pause', 'play']), { presentation: 'remote-playback', columns: 3, adaptive: false }),
        ...(data.volumeEntityId ? [{
          ...group(str(data.volumeTitle, 'Volume'), remoteButtons(['volumeMute', 'volumeDown', 'volumeUp']), {
            presentation: 'remote-volume', entityId: entity(data.volumeEntityId), remoteMediaEntityId: mediaEntityId,
          }), binding: { sourceId: 'native-states' },
        }] : []),
      ])];
      if (rows(data.apps).length) sections.push(group(str(data.appSectionTitle, 'Apps'), rows(data.apps).flatMap(app =>
        remoteActions(str(app.title), app.action, app.stateEntityId ?? data.mediaEntityId, str(app.icon)))));
      if (rows(data.devices).length) sections.push(group('Devices', rows(data.devices).flatMap(device =>
        device.action ? remoteActions(str(device.title), device.action, device.entityId, str(device.icon)) : [control(str(device.title), device.entityId)])));
      const sync = rec(data.lightSync);
      if (Object.keys(sync).length) sections.push(group('Hue Sync', fields(sync, [
        ['powerEntityId', 'Power'], ['lightSyncEntityId', 'Light Sync'], ['syncModeEntityId', 'Sync Mode'],
        ['intensityEntityId', 'Intensity'], ['brightnessEntityId', 'Brightness'], ['hdmiInputEntityId', 'HDMI Input'],
      ])));
      const root = tabs(sections);
      root.title = str(data.remoteTitle, str(data.title, 'Remote'));
      root.props = { ...root.props, nativeKind: 'remote-sheet', entityId: mediaEntityId };
      root.binding = { sourceId: 'native-states' };
      ['Gamepad2', 'LayoutGrid', 'Monitor', 'Lightbulb'].forEach((icon, index) => {
        const title = ['Remote', str(data.appSectionTitle, 'Apps'), 'Devices', 'Hue Sync'][index];
        const tab = sections.find(section => section.title === title);
        if (tab) tab.icon = icon;
      });
      return [root];
    });
  };

  const vacuum = (data: RecordValue): Action => once(`vacuum-${entity(data.entityId)}`, `${str(data.title, 'Vacuum')} Robot Vacuum`, () => {
    const dock = rec(data.dockControls);
    const tab = (title: string, id: string, icon: string, children: Component[]) => ({
      ...group(title, children, { vacuumTab: id, columns: 1 }), icon,
    });
    const settings = group('Cleaning Settings', fields(data, [
      ['modeEntityId', 'Mode'], ['fanEntityId', 'Fan Speed'], ['waterEntityId', 'Water'], ['passesEntityId', 'Passes'],
    ]), { columns: 1, presentation: 'grouped-settings' });
    settings.subtitle = 'Water is available when Mode includes mopping.';
    const autoClean = tab('Auto-Clean', 'autoClean', 'History', rows(data.zones).map(item =>
      control(str(item.title), item.entityId, { checkRow: true, checkedText: 'Included', uncheckedText: 'Skipped' }, str(item.icon))));
    autoClean.subtitle = 'Manual cleans from Rooms are unaffected by Auto-Clean room settings.';
    const root = group(str(data.title, 'Vacuum'), [
      tab('Controls', 'controls', 'Bot', [
        settings,
        ...(data.cleanScript ? [{ ...tile('Clean', script(data.cleanScript)), props: { vacuumAction: 'clean' } }] : []),
      ]),
      tab('Rooms', 'zones', 'LayoutGrid', rows(data.zones).map(zone =>
        bound('action-tile', str(zone.title), entity(zone.entityId), {
          nativeKind: 'vacuum-room', mapName: zone.mapName ?? '',
        }, str(zone.icon)))),
      autoClean,
      tab('Dock', 'more', 'PlugZap', [
        ...fields(dock, [['dockStatusEntityId', 'Dock Status'], ['mopAttachmentEntityId', 'Mop Attachment']]),
        ...(data.dockButtonEntityId ? [control('Empty Bin', data.dockButtonEntityId)] : []),
        ...(dock.cleanScript ? [{ ...tile('Clean Mop Dock', script(dock.cleanScript)), props: { vacuumAction: 'dockClean' } }] : []),
        ...(dock.dryScript ? [{ ...tile('Dry Mops', script(dock.dryScript)), props: { vacuumAction: 'dockDry' } }] : []),
      ]),
      tab('Info', 'info', 'Info', [
        ...rows(data.consumables).map(item => control(str(item.title), item.entityId, { valueKind: item.valueKind ?? '', readOnly: true }, str(item.icon))),
      ]),
      group(`${str(data.title, 'Vacuum')} Cleaning Area`, [
        collection('Map', 'vacuum-map', {
          vacuumMapId: data.vacuumMapId ?? '', mapRoomSelection: data.mapRoomSelection ?? {},
          mapRotationDegrees: data.mapRotationDegrees ?? 0, mapScale: data.mapScale ?? 1,
        }),
      ], { vacuumPage: 'area', columns: 1 }),
      group('Cleaning Report', [node('text', 'Report unavailable', { text: 'Cleaning report telemetry is unavailable. No room outcomes have been fabricated.' })],
        { vacuumPage: 'report', columns: 1 }),
    ], {
      presentation: 'vacuum-sheet', entityId: entity(data.entityId),
      ...(data.batteryEntityId ? { batteryEntityId: entity(data.batteryEntityId) } : {}),
      ...(dock.dockStatusEntityId ? { dockStatusEntityId: entity(dock.dockStatusEntityId) } : {}),
    });
    root.binding = { sourceId: 'native-states' };
    warn('Vacuum area/map/report telemetry, pending-resume and error-reason policy, and selected-room script payloads are unavailable in this browser adapter.');
    return [root];
  });
  const bed = (data: RecordValue): Action => once(`bed-${key(data.id)}`, str(data.title, 'Bed'), () => [
    ...fields(data, [['climateEntityId', 'Temperature'], ['targetLevelEntityId', 'Target Level']]),
    tabs([
      group('Temperature', [
        ...fields(data, [['schedulePhaseEntityId', 'Schedule Phase']]),
        ...Object.entries(rec(data.stageLevelEntityIds)).map(([title, id]) => control(title, id)),
        collection('Schedule', 'bed-schedule', {
          bedId: data.id ?? '', scheduleEntityId: section('bedroom').scheduleEntityId ?? '',
          scheduleSetTopic: section('bedroom').scheduleSetTopic ?? '', tonightScript: data.tonightScript ?? '',
          outsideScheduleScript: data.outsideScheduleScript ?? '',
        }),
      ]),
      group('Special Modes', fields(data, [
        ['hotFlashActiveEntityId', 'Hot Flash'], ['hotFlashButtonEntityId', 'Start Hot Flash'],
        ['hotFlashCancelButtonEntityId', 'Cancel Hot Flash'], ['hotFlashRestoreAtEntityId', 'Restore At'], ['hotFlashTimerEntityId', 'Timer'],
      ])),
      group('Alarms', [
        ...fields(data, [['alarmStateEntityId', 'Alarm'], ['alarmSnoozeButtonEntityId', 'Snooze'], ['alarmStopButtonEntityId', 'Stop Alarm']]),
        collection('Alarms', 'bed-alarms', { bedId: data.id ?? '' }),
      ]),
      group('Status', fields(data, [
        ['heartRateEntityId', 'Heart Rate'], ['breathingRateEntityId', 'Breathing Rate'], ['hrvEntityId', 'HRV'],
        ['pumpClogEntityId', 'Pump Clog'], ['pumpStallEntityId', 'Pump Stall'],
        ['pumpLoopTemperatureEntityId', 'Loop Temperature'], ['pumpRpmEntityId', 'Pump RPM'],
      ])),
    ]),
  ]);
  const wake = (): Action => {
    const data = rec(section('bedroom').wakeLight);
    return once('wake-light', str(data.title, 'Wake-Light Alarms'), () => [
      ...fields(data, [['statusEntityId', 'Status']]),
      tabs([
        group('Alarms', [
          collection('Alarms', 'wake-light-alarms', { wakeLightId: data.id ?? '' }),
          ...rows(data.sources).flatMap(source => {
            const target = rows(section('bedroom').beds).find(each => each.id === source.bedId);
            return target ? [link(str(source.alarmsLabel, str(target.title)), bed(target))] : [];
          }),
        ]),
        group('Room Defaults', [collection('Room Defaults', 'wake-light-defaults', { wakeLightId: data.id ?? '' })]),
      ]),
    ]);
  };
  const bathroomFan = (data: RecordValue): Action => once(`bathroom-fan-${key(data.id)}`, `${str(data.roomTitle)} Fan`, () => [
    group('Fan', [
      bound('action-tile', 'Power', entity(data.powerEntityId), { presentation: 'control', controlKind: 'sensor' }),
      ...(data.scriptService ? [
        tile('Turn On', script(data.scriptService, { command: 'power', target_power: 'on' })),
        tile('Turn Off', script(data.scriptService, { command: 'power', target_power: 'off' })),
      ] : []),
    ]),
    group('Timer', [
      ...fields(data, [['timerEntityId', 'Timer'], ['deadlineEntityId', 'Deadline'], ['pendingEntityId', 'Pending']], { controlKind: 'sensor' }),
      ...(data.scriptService ? [
        ...[5, 10, 15, 20, 30, 60].map(minutes => tile(minutes === 60 ? 'Turn Off in 1 Hour' : `Turn Off in ${minutes} Minutes`,
          script(data.scriptService, { command: 'timer_start', minutes, auto_unlock: true }))),
        tile('Cancel Timer', script(data.scriptService, { command: 'timer_cancel' })),
      ] : []),
    ]),
    group('Lock', [
      ...fields(data, [['lockEntityId', 'Locked'], ['autoUnlockEntityId', 'Automatic Unlock']], { controlKind: 'sensor' }),
      ...(data.scriptService ? [
        tile('Lock Fan', script(data.scriptService, { command: 'lock', locked: true })),
        tile('Unlock Fan', script(data.scriptService, { command: 'lock', locked: false })),
      ] : []),
    ]),
  ]);
  const purifier = (data: RecordValue): Action => once(`air-${entity(data.pm25EntityId)}`, `${str(data.roomTitle)} Air Quality`, () => {
    const base = entity(data.pm25EntityId).replace(/^sensor\./, '').replace(/_pm2_?5$/, '');
    return [
      group('Air Quality', [
        control('PM2.5', data.pm25EntityId),
        control('AQI', data.aqiEntityId ?? `sensor.${base}_air_quality_index`),
      ]),
      group('Fan Mode', [control('Mode', data.modeEntityId ?? `select.${base}_fan_mode`)]),
      group('Auto Mode', [control('Auto Mode', data.autoModeEntityId ?? `select.${base}_auto_mode`)]),
      group('Fan Speed', data.fanEntityId ? [control('Fan Speed', data.fanEntityId)] : []),
    ];
  });
  const humidifier = (data: RecordValue): Action => once(`humidifier-${key(data.id)}`, str(data.title, 'Humidifier'), () => [
    group('Humidifier', fields(data, [
      ['powerEntityId', 'Power'], ['currentHumidityEntityId', 'Humidity'], ['currentTemperatureEntityId', 'Temperature'],
      ['humidifyingEntityId', 'Humidifying'], ['waterLowEntityId', 'Water Low'], ['tankRemovedEntityId', 'Tank Removed'],
    ])),
    tabs([
      group('Controls', fields(data, [
        ['modeEntityId', 'Mode'], ['targetHumidityEntityId', 'Target Humidity'], ['mistLevelEntityId', 'Mist Level'],
        ['warmLevelEntityId', 'Warm Level'], ['displayEntityId', 'Display'],
      ])),
      group('Schedule', [
        ...fields(data, [['scheduleEnabledEntityId', 'Schedule Enabled'], ['vacationModeEntityId', 'Vacation Mode']]),
        collection('Schedule', 'humidifier-schedule', { scheduleEntityId: data.scheduleEntityId ?? '', scheduleId: data.scheduleId ?? '', applyProfileScriptService: data.applyProfileScriptService ?? '' }),
      ]),
      group('Timer', fields(data, [['timerMinutesEntityId', 'Timer Minutes'], ['timerRemainingEntityId', 'Time Remaining']])),
    ]),
  ]);
  const grill = (data: RecordValue): Action => once(`grill-${entity(data.stateEntityId)}`, str(data.title, 'Grill'), () => [
    group('Grill', fields(data, [['stateEntityId', 'Status']])),
    group('Details', configuredTiles(data.details)),
  ]);
  const controller = (data: RecordValue): Component => group(str(data.title, 'Controller'), [
    group('Status', fields(data, [
      ['stateEntityId', 'Status'], ['batteryEntityId', 'Battery'], ['faultEntityId', 'Fault'],
      ['hubConnectedEntityId', 'Hub Connected'], ['nextWateringEntityId', 'Next Watering'],
    ])),
    group('Zones', rows(data.zones).map((zone, index) => group(`Zone ${index + 1}`, [
      ...fields(zone, [['valveEntityId', 'Valve'], ['programEntityId', 'Program'], ['historyEntityId', 'History']]),
    ]))),
    group('Controls', fields(data, [['modeEntityId', 'Mode'], ['smartWateringEntityId', 'Smart Watering'], ['rainDelayEntityId', 'Rain Delay']])),
    group('Schedule', [collection('Schedule', 'sprinkler-schedule', {
      controllerId: data.id ?? '', zones: data.zones ?? [], defaultStartTime: section('sprinklers').defaultStartTime ?? '',
      runMinutes: 15, minimumMinutes: 1, maximumMinutes: 60, minutePresets: [5, 10, 15, 30, 60],
      minimumBudget: 0, maximumBudget: 200, budgetStep: 5,
    })]),
  ]);
  const todo = (data: RecordValue): Component[] => [
    group('', rows(data.lists).map(list => {
      const child = collection(str(list.title, str(data.title)), 'todo-items', {
        entityId: entity(list.entityId), hideCompleted: list.hideCompleted ?? true,
        hideWhenNoOpenItems: list.hideWhenNoOpenItems ?? false, currentUserIds: list.userIds ?? [],
        completionScript: list.completionScript ?? '', emptyText: data.emptyDescription ?? '',
        addAction: data.addAction ?? {}, hasTaskForm: data.hasTaskForm ?? false,
        profileSourceId: 'native-profile', people: section('chores').people ?? [],
      });
      child.binding = { sourceId: 'native-states' };
      return child;
    }), {
      nativeTodoPage: true, resident: data.resident ?? '', hiddenByVacation: data.hiddenByVacation ?? false,
      hideListHeaders: data.hideListHeaders ?? false, emptyTitle: data.emptyTitle ?? 'Nothing To Show',
      emptyText: data.emptyDescription ?? '', profileSourceId: 'native-profile', people: section('chores').people ?? [],
      addAction: data.addAction ?? {}, hasTaskForm: data.hasTaskForm ?? false,
      vacationEntityId: section('vacation').modeEntityId ?? '', vacationEmptyText: section('chores').vacationEmptyDescription ?? '',
    }),
  ];
  const todoRoute = (id: string, title: string): Action => {
    const data = rows(section('chores').pages).find(page => page.id === id);
    if (!data) throw new Error(`Unknown configured to-do page: ${id}`);
    return once(`todo-${key(id)}`, title, () => todo(data), true);
  };
  const family = (id: string, title: string): Action => {
    if (rows(section('chores').pages).some(page => page.id === id)) return todoRoute(id, title);
    return once(`destination-${key(id)}`, title, () => {
      switch (id) {
        case 'custom-lights': {
          const data = section('customLights');
          const mode = fields(data, [['modeEntityId', str(data.lightingModeTitle, 'Lighting Mode')]], { fallbackModes: data.fallbackModes ?? [] });
          const lights = group('Lights', [
            ...configuredTiles(data.lights),
            ...(data.groupEntityId ? [tile('Reset All Lights', service(data.groupEntityId, 'turn_on', { color_temp_kelvin: 2000, brightness: 255, transition: 1 }))] : []),
          ]);
          if (data.modeEntityId) lights.visibility = { source: 'entity', key: entity(data.modeEntityId), operator: 'equals', value: str(data.customMode, 'Custom') };
          const manual = group('', [...mode, lights]);
          if (data.manualControlEntityId) manual.visibility = { source: 'entity', key: entity(data.manualControlEntityId), operator: 'equals', value: 'on' };
          return [group(str(data.sectionTitle, 'Custom Lights'), [
            ...fields(data, [['manualControlEntityId', 'Manual Control']]), manual,
          ])];
        }
        case 'food': {
          const data = section('food');
          return [
            group('Suggested Recipes', [collection('Suggested Recipes', 'suggested-recipes')]),
            group('Food', [
              link('All Recipes', once('all-recipes', 'All Recipes', () => [collection('Recipes', 'recipes')], true), 'book'),
              link('All Food', once('all-food', 'All Food', () => [collection('Food', 'food-items')], true), 'fork.knife'),
              ...fields(data, [['expiringSoonEntityId', 'Expiring Soon'], ['totalItemsEntityId', 'Total Items'], ['expiredItemsEntityId', 'Expired Items']]),
            ]),
            group('Food Spaces', rows(data.spaces).map(space => {
              const action = once(`food-space-${key(str(space.location, str(space.title).replaceAll(' ', '-')))}`, str(space.title), () => [
                ...fields(space, [['entityId', 'Items']]),
                collection(str(space.title), 'food-items', { location: space.location ?? '', space: space }),
              ], true);
              return link(str(space.title), action, str(space.icon));
            })),
          ];
        }
        case 'media': return rows(section('media').pageSections).map(s => group(str(s.title), rows(s.cards).map(card => {
          const device = rec(card.device);
          const component = control(str(device.title), device.entityId, {
            stateLabels: device.stateLabels ?? {}, activeStates: device.activeStates ?? [],
          }, str(device.icon));
          if (card.remoteId) component.action = remote(key(card.remoteId));
          return component;
        })));
        case 'vacuums': return [
          group('Vacuums', rows(section('vacuums').vacuums).map(data => link(str(data.title), vacuum(data), 'fan'))),
          group('Automatic Cleaning', rows(section('vacuums').autoCleanControls).map(data =>
            control(str(data.title), data.entityId, { enabledWhen: data.kind === 'pause' ? 'off' : 'on' }, str(data.icon)))),
        ];
        case 'sprinklers':
          warn('Sprinkler Water Now, schedule writes, and water-budget actions require a same-origin backend command contract; cross-domain bhyve targeting is not emitted.');
          return rows(section('sprinklers').controllers).map(controller);
        case 'admin': {
          const data = section('household');
          return [
            group('Security Controls', configuredTiles(data.securityTiles)),
            ...(data.powerRecoveryAutomation ? [group('Living Room Power Recovery', [tile('Attempt Power Recovery', service(data.powerRecoveryAutomation, 'trigger'))])] : []),
            group('Relay Control Mode', configuredTiles(data.relayTiles)),
            group('Presence-Based Light Overrides', rows(data.presenceRooms).map(room => control(str(room.title), room.presenceEntityId))),
            group('Show Specific Controls', configuredTiles(data.showSpecificTiles)),
            group('Automatic Presence Setting Overrides', rows(data.presenceRooms).map(room => control(str(room.title), room.autoReenableEntityId))),
          ];
        }
        case 'device-modes': return [group('Special Device Modes', configuredTiles(section('household').highAqiTile ? [section('household').highAqiTile] : []))];
        case 'guests': return [group('Guests', configuredTiles(section('home').guestToggles))];
        case 'car': return [group('Car', configuredTiles(section('household').vehicleTiles).map(child => {
          // Vehicle lock confirmation is native-specific; do not generate an unconfirmed lock action.
          child.props.controlKind = 'sensor';
          return child;
        }))];
        case 'vacation': {
          const data = section('vacation');
          return [
            group('Vacation Mode', fields(data, [['modeEntityId', 'Vacation Mode'], ['invalidDatesPendingEntityId', 'Invalid Dates Pending']])),
            group('Pre-Vacation Checklist', configuredTiles(data.checklist)),
            group('Vacation Dates', [
              ...fields(data, [['startEntityId', 'Starts'], ['endEntityId', 'Ends']]),
              collection('Vacation Dates', 'vacation-dates', { startEntityId: data.startEntityId ?? '', endEntityId: data.endEntityId ?? '' }),
            ]),
            group('Solo Trip', [
              ...fields(section('bedroom'), [['householdAwayEntityId', 'Household Away']]),
              collection('Solo Trip', 'household-away', { householdAwayScript: section('bedroom').householdAwayScript ?? '', people: section('chores').people ?? [] }),
            ]),
          ];
        }
        case 'bedroom': return [
          ...rows(section('bedroom').beds).map(data => link(str(data.title), bed(data), 'bed.double')),
          ...(Object.keys(rec(section('bedroom').wakeLight)).length ? [link('Wake-Light Alarms', wake(), 'alarm')] : []),
        ];
        default: throw new Error(`Unsupported native destination: ${id}`);
      }
    }, true);
  };
  const roomCard = (card: RecordValue, room: string): Action | undefined => {
    const sheet = str(card.sheet);
    const devices = section('roomDevices');
    const bedConfig = rows(section('bedroom').beds).find(data => data.id === sheet);
    if (bedConfig) return bed(bedConfig);
    if (card.kind === 'media' && rows(section('media').remotes).some(data => data.id === sheet)) return remote(sheet);
    const match = (field: string, idField: string) => rows(devices[field]).find(data => data[idField] === card.entityId);
    const fan = match('bathroomFans', 'powerEntityId');
    if (fan && card.control === 'bathroom-fan') return bathroomFan(fan);
    const humidifierConfig = match('humidifiers', 'powerEntityId');
    if (humidifierConfig && card.kind === 'humidifier') return humidifier(humidifierConfig);
    const vacuumConfig = rows(section('vacuums').vacuums).find(data => data.entityId === card.entityId);
    if (vacuumConfig && card.kind === 'vacuum') return vacuum(vacuumConfig);
    if (card.kind === 'wake-light' && rec(section('bedroom').wakeLight).statusEntityId === card.entityId) return wake();
    const air = rows(devices.airPurifiers).find(data => data.pm25EntityId === (card.modalEntityId ?? card.entityId));
    if (air && card.kind === 'air') return purifier(air);
    const grillConfig = match('grills', 'stateEntityId');
    if (grillConfig && card.kind === 'grill') return grill(grillConfig);
    if (rows(card.modalItems).length) return once(`items-${entity(card.entityId)}`, str(card.modalTitle, `${room} ${str(card.title)}`), () => [
      group(str(card.modalTitle, str(card.title)), configuredTiles(card.modalItems)),
    ]);
    const action = rec(card.action);
    if (action.type === 'flip') return service(card.entityId, 'toggle');
    if (action.type === 'remote') {
      const actions = remoteActions(str(card.title), action.action, card.entityId, str(card.icon));
      if (actions.length === 1 && !actions[0].visibility) return actions[0].action;
      if (actions.length) return once(`commands-${entity(card.entityId)}-${key(str(card.title).replaceAll(' ', '-').replaceAll("'", ''))}`, str(card.title), () => [group('Controls', actions)]);
    }
    if (!sheet) return undefined;
    const groupField = ({ light: 'lightGroups', vent: 'climateGroups', climate: 'climateGroups', occupancy: 'occupancyGroups', contact: 'contactGroups' } as Record<string, string>)[str(card.kind)];
    const configuredGroup = groupField ? rows(section('rooms')[groupField]).find(data => (data.room ?? data.title) === room) : undefined;
    return once(`room-control-${entity(card.entityId)}`, str(card.modalTitle, `${room} ${str(card.title)}`), () => [
      group(str(card.title), configuredGroup ? configuredTiles(configuredGroup.items) : [
        control(str(card.title), card.modalEntityId ?? card.entityId),
        ...(Array.isArray(card.subtitleEntityIds) ? card.subtitleEntityIds.map(id => control(str(card.title), id)) : []),
      ]),
    ]);
  };
  const settings = () => [
    ['Vacation', 'vacation', 'airplane'], ['Admin', 'admin', 'wrench.and.screwdriver'],
    ['Special Device Modes', 'device-modes', 'slider.horizontal.3'], ['Guests', 'guests', 'person.2'], ['Car', 'car', 'car'],
  ].map(([title, id, icon]) => link(title, family(id, title), icon));
  const profile = (): Component[] => {
    const chores = section('chores');
    const summary = node('profile', 'Your Summary', {
      presentation: 'summary', namePath: 'name', residentMatch: 'haUserId', people: chores.people ?? [],
      emptyText: 'Signed In', unavailableText: 'Profile unavailable',
    }, 'person.crop.circle');
    summary.binding = { sourceId: 'native-profile' };
    const userTabs = [
      group('Profile', [summary, collection('People at Home', 'household-people', { itemTitle: 'name', itemSubtitle: 'state' })]),
      group('Overdue Chores', [collection('Overdue Chores', 'resident-todo-items', {
        profileSourceId: 'native-profile', people: chores.people ?? [], summaryListKeys: ['overdue'], requiresResident: true,
        hideCompleted: true, emptyTitle: 'No Chores Due', emptyText: 'You are all caught up on chores that slipped past their due date.',
        hiddenByVacation: true, vacationEntityId: section('vacation').modeEntityId ?? '', vacationEmptyText: chores.vacationEmptyDescription ?? 'Enjoy vacation!',
      })], { requiresResident: true, profileSourceId: 'native-profile', people: chores.people ?? [] }),
      group('Upcoming Chores', [collection('Upcoming Chores', 'resident-todo-items', {
        profileSourceId: 'native-profile', people: chores.people ?? [], summaryListKeys: ['dueToday', 'noDueDate'], requiresResident: true,
        hideCompleted: true, emptyTitle: 'No Chores Upcoming', emptyText: 'There is nothing else on your schedule for the rest of today.',
        hiddenByVacation: true, vacationEntityId: section('vacation').modeEntityId ?? '', vacationEmptyText: chores.vacationEmptyDescription ?? 'Enjoy vacation!',
      })], { requiresResident: true, profileSourceId: 'native-profile', people: chores.people ?? [] }),
      group('Expired Food', [collection('Expired Food', 'food-items', { expiredOnly: true })]),
    ];
    ['person.crop.circle', 'list.bullet', 'calendar', 'fork.knife'].forEach((icon, index) => { userTabs[index].icon = icon; });
    return [tabs(userTabs)];
  };
  return { family, roomCard, settings, profile, todo, todoRoute, control, wake };
}
