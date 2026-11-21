import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftTodoIds, nativeHomeSnapshot, readNativeSnapshot, type NativeHouseConfig } from '../server/native-home';

const credentials = ['fixture-ha-private-token', 'fixture-studio-private-token'];
const identity = { id: 'fixture-user', name: 'Authenticated fixture', is_owner: false, is_admin: true };
const forecastEntry = {
  datetime: '2026-11-12T12:00:00+00:00', condition: 'cloudy', temperature: 0, templow: -2,
  precipitation: 0, precipitation_probability: 0, humidity: 50, wind_speed: 0,
};
const rawState = (entity_id: string, attributes: Record<string, unknown> = {}, state = 'off') => ({ entity_id, state, attributes });
const envelope = (entities: string[]): NativeHouseConfig => ({
  schema: 2, hash: 'a'.repeat(64), config: {
    home: { entities }, security: {}, climate: {}, customLights: {}, food: {}, chores: {}, household: {},
    media: {}, roomDevices: {}, sprinklers: {}, vacation: {}, vacuums: {}, bedroom: {}, rooms: [],
  },
});

type Command = Record<string, unknown>;
type SocketControl = {
  emit: (value: unknown) => void;
  result: (command: Command, result?: unknown, success?: boolean) => void;
};
function transport(options: {
  states?: unknown;
  house?: NativeHouseConfig;
  user?: unknown;
  command?: (command: Command, socket: SocketControl) => boolean;
} = {}) {
  const states = options.states ?? [
    rawState('weather.fixture', { supported_features: 3, temperature: 0, temperature_unit: 'C', wind_speed_unit: 'km/h', precipitation_unit: 'mm' }, 'cloudy'),
    rawState('person.linked', { user_id: identity.id, entity_picture: '/api/image/serve/private?token=never-forward' }),
    rawState('person.other', { user_id: 'different-user' }),
  ];
  const sockets: FakeSocket[] = [];
  const commands: Command[] = [];
  class FakeSocket extends EventTarget {
    closed = false;
    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => this.emit({ type: 'auth_required' }));
    }
    emit(value: unknown) {
      if (!this.closed) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
    }
    result(command: Command, result?: unknown, success = true) { this.emit({ type: 'result', id: command.id, success, result }); }
    send(value: string) {
      const command = JSON.parse(value) as Command;
      commands.push(command);
      queueMicrotask(() => {
        if (this.closed || options.command?.(command, this)) return;
        if (command.type === 'auth') this.emit({ type: 'auth_ok' });
        else if (command.type === 'fenton_home/house_config') this.result(command, options.house ?? envelope(['weather.fixture']));
        else if (command.type === 'auth/current_user') this.result(command, options.user ?? identity);
        else if (command.type === 'weather/subscribe_forecast') {
          this.result(command);
          this.emit({ type: 'event', id: command.id, event: { type: command.forecast_type, forecast: [forecastEntry] } });
        } else if (command.type === 'unsubscribe_events') this.result(command);
        else throw new Error('Unapproved fixture request');
      });
    }
    close() { this.closed = true; }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  const readStates = vi.fn(async () => states);
  const snapshot = (signal = new AbortController().signal, draftTodoLists?: ReadonlySet<string>) =>
    readNativeSnapshot('ws://fixture.invalid/api/websocket', credentials[0], signal, credentials, readStates, draftTodoLists);
  return { snapshot, readStates, states, commands, sockets };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('safe native control projections', () => {
  it('preserves author metadata and structured public content in native-house configuration', () => {
    const house = envelope(['sensor.demo_metadata']);
    house.config.home = {
      author: 'Demo Owner', entity: 'sensor.demo_metadata',
      details: { links: ['https://demo.invalid/home?width=120'], description: 'x '.repeat(129) },
    };
    const snapshot = nativeHomeSnapshot(house, [rawState('sensor.demo_metadata')], credentials);
    expect(snapshot.houseConfig).toEqual(house);
    expect(snapshot.states).toEqual([{ entityId: 'sensor.demo_metadata', state: 'off', name: 'sensor.demo_metadata' }]);
  });

  it('reads configured Chores lists and resident summary lists, not arbitrary todo entity counts', async () => {
    const house = envelope(['todo.unrelated']);
    house.config.chores = {
      pages: [{ lists: [{ entityId: 'todo.assigned' }, { entityId: 'todo.assigned' }] }],
      people: [{ summaryLists: { overdue: 'todo.summary' } }],
    };
    const api = transport({ house, states: [rawState('todo.assigned', {}, '1'), rawState('todo.summary', {}, '0'), rawState('todo.unrelated', {}, '12')],
      command(command, socket) {
        if (command.type !== 'todo/item/list') return false;
        socket.result(command, { items: command.entity_id === 'todo.summary' ? [] : [
          { uid: '15--fixture', summary: 'Synthetic task', status: 'needs_action', due_date: '2026-11-12', description: 'Synthetic description', ignored: 'untrusted-extra-field' },
        ] }); return true;
      } });
    const snapshot = await api.snapshot();
    expect(snapshot.currentUser?.id).toBe(identity.id);
    expect(api.commands.filter(command => command.type === 'todo/item/list').map(command => command.entity_id).sort()).toEqual(['todo.assigned', 'todo.summary']);
    expect(snapshot.states.find(state => state.entityId === 'todo.assigned')?.todoList).toEqual({ status: 'ready', items: [{ uid: '15--fixture', summary: 'Synthetic task', status: 'needs_action', due: '2026-11-12', description: 'Synthetic description' }] });
    expect(snapshot.states.find(state => state.entityId === 'todo.summary')?.todoList).toEqual({ status: 'ready', items: [] });
    expect(snapshot.states.find(state => state.entityId === 'todo.unrelated')?.todoList).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('untrusted-extra-field');
    expect(api.sockets.every(socket => socket.closed)).toBe(true);
  });
  it('reads the todo lists the draft names as well, and only those and the chores pages', async () => {
    const house = envelope([]);
    house.config.chores = { pages: [{ lists: [{ entityId: 'todo.demo_assigned' }] }] };
    const api = transport({ house, states: [rawState('todo.demo_assigned', {}, '1'), rawState('todo.demo_draft_only', {}, '2'), rawState('todo.demo_unrelated', {}, '9')],
      command(command, socket) {
        if (command.type !== 'todo/item/list') return false;
        socket.result(command, { items: [{ uid: `${command.entity_id}-1`, summary: 'Synthetic task', status: 'needs_action' }] }); return true;
      } });
    const snapshot = await api.snapshot(undefined, new Set(['todo.demo_draft_only', 'todo.demo_assigned']));
    expect(api.commands.filter(command => command.type === 'todo/item/list').map(command => command.entity_id).sort()).toEqual(['todo.demo_assigned', 'todo.demo_draft_only']);
    expect(snapshot.states.find(state => state.entityId === 'todo.demo_draft_only')?.todoList).toEqual({ status: 'ready', items: [{ uid: 'todo.demo_draft_only-1', summary: 'Synthetic task', status: 'needs_action' }] });
    expect(snapshot.states.find(state => state.entityId === 'todo.demo_unrelated')).toBeUndefined();
  });
  it('keeps the cap of 64 across the chores pages and the draft together', async () => {
    const house = envelope([]);
    house.config.chores = { pages: [{ lists: Array.from({ length: 40 }, (_, index) => ({ entityId: `todo.demo_page_${index}` })) }] };
    const api = transport({ house, states: [] });
    const result = await api.snapshot(undefined, new Set(Array.from({ length: 30 }, (_, index) => `todo.demo_draft_${index}`)));
    expect(result.warnings).toContain('Chores collection limit exceeded; no todo collections were read');
    expect(api.commands.some(command => command.type === 'todo/item/list')).toBe(false);
  });
  it('names the draft todo lists from its todo-collection sources only', () => {
    const list = (id: unknown) => ({ title: 'List', entityId: { type: 'literal', value: id }, hideCompleted: false, hideWhenNoOpenItems: false });
    const document = { dataSources: [
      { id: 'a', kind: 'model', model: 'todo-collection@1', inputs: { lists: [list('todo.demo_one'), list('todo.demo_two'), list('todo.demo_one'), list('sensor.demo_not_todo'), list('todo.Bad Id'), list(7)] } },
      { id: 'b', kind: 'model', model: 'todo-counts@1', inputs: { lists: [list('todo.demo_counts_only')] } },
      { id: 'c', kind: 'ha-entity', entityId: { type: 'literal', value: 'todo.demo_entity' } },
    ] };
    expect([...draftTodoIds(document)].sort()).toEqual(['todo.demo_one', 'todo.demo_two']);
    expect(draftTodoIds(null).size).toBe(0);
    expect(draftTodoIds({ dataSources: 'no' }).size).toBe(0);
  });
  it.each([
    { items: [{ uid: '1', summary: 'Fixture', status: 'unexpected' }] },
    { items: [{ uid: '1', summary: credentials[0], status: 'needs_action' }] },
    { items: [{ uid: '1', summary: 'Fixture', status: 'needs_action', description: 'Bearer private-value' }] },
    { items: [{ uid: '1', summary: 'Fixture', status: 'needs_action', due_date: 'not-a-date' }] },
    { items: [{ uid: '1', summary: 'Fixture', status: 'needs_action', due_date: '2026-02-30' }] },
    { items: [{ uid: '1', summary: 'Fixture', status: 'needs_action', due_datetime: '2026-02-28T24:00:00Z' }] },
    { items: Array.from({ length: 1001 }, (_, index) => ({ uid: String(index), summary: 'Fixture', status: 'needs_action' })) },
    { items: [{ uid: '1', summary: 'A', status: 'needs_action' }, { uid: '1', summary: 'B', status: 'needs_action' }] },
    { invalid: [] },
  ])('isolates malformed, oversized or unsafe todo responses without a fabricated empty list', async response => {
    const house = envelope([]);
    house.config.chores = { pages: [{ lists: [{ entityId: 'todo.fixture' }] }] };
    const api = transport({ house, states: [rawState('todo.fixture', {}, '1')],
      command(command, socket) { if (command.type !== 'todo/item/list') return false; socket.result(command, response); return true; } });
    const result = await api.snapshot();
    expect(result.states[0].todoList).toEqual({ status: 'error', message: expect.stringContaining('could not be loaded') });
    expect(result.warnings?.join(' ')).toContain('Chores read unavailable');
    expect(JSON.stringify(result)).not.toContain(credentials[0]);
  });
  it('reports an unsupported todo command and missing state without replacing either with sample records', async () => {
    const house = envelope([]);
    house.config.chores = { pages: [{ lists: [{ entityId: 'todo.fixture' }, { entityId: 'todo.missing' }] }] };
    const api = transport({ house, states: [rawState('todo.fixture', {}, '1')],
      command(command, socket) { if (command.type !== 'todo/item/list') return false; socket.result(command, { message: 'private upstream error' }, false); return true; } });
    const result = await api.snapshot();
    expect(result.states).toHaveLength(1);
    expect(result.states[0].todoList?.status).toBe('error');
    expect(result.warnings).toContain('Chores entity state unavailable for todo.missing');
    expect(JSON.stringify(result)).not.toContain('private upstream error');
  });
  it('fails closed at the configured todo collection limit', async () => {
    const house = envelope([]);
    house.config.chores = { pages: [{ lists: Array.from({ length: 65 }, (_, index) => ({ entityId: `todo.list_${index}` })) }] };
    const api = transport({ house, states: [] });
    const result = await api.snapshot();
    expect(result.warnings).toContain('Chores collection limit exceeded; no todo collections were read');
    expect(api.commands.some(command => command.type === 'todo/item/list')).toBe(false);
  });
  it('ignores a timed-out todo response without poisoning later forecast reads', async () => {
    vi.useFakeTimers();
    const house = envelope(['weather.fixture']);
    house.config.chores = { pages: [{ lists: [{ entityId: 'todo.fixture' }] }] };
    const api = transport({ house, states: [rawState('todo.fixture', {}, '1'), rawState('weather.fixture', { supported_features: 3 }, 'cloudy')],
      command(command, socket) {
        if (command.type === 'todo/item/list') {
          setTimeout(() => socket.result(command, { items: [] }), 1250);
          return true;
        }
        if (command.type === 'weather/subscribe_forecast') {
          setTimeout(() => {
            socket.result(command);
            socket.emit({ type: 'event', id: command.id, event: { type: command.forecast_type, forecast: [forecastEntry] } });
          }, 100);
          return true;
        }
        return false;
      } });
    const pending = api.snapshot();
    await vi.advanceTimersByTimeAsync(1400);
    const result = await pending;
    expect(result.states.find(state => state.entityId === 'todo.fixture')?.todoList?.status).toBe('error');
    expect(result.states.find(state => state.entityId === 'weather.fixture')?.dailyForecast).toHaveLength(1);
    expect(result.states.find(state => state.entityId === 'weather.fixture')?.hourlyForecast).toHaveLength(1);
  });
  it('projects actual control capabilities and preserves zero, false, missing and unrelated state behavior', () => {
    const raw = [
      rawState('light.fixture', {
        supported_features: 4, brightness: 0, supported_color_modes: ['color_temp', 'hs'], color_mode: 'color_temp',
        color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500,
        hs_color: [0, 0], rgb_color: [0, 0, 0], xy_color: [0, 0], effect: 'none', effect_list: ['none'],
        access_token: 'discarded', entity_picture: '/private?token=discarded',
      }),
      rawState('climate.fixture', {
        temperature: 0, current_temperature: 0, min_temp: -5, max_temp: 35, target_temp_step: 0.5,
        target_temp_high: 23, target_temp_low: 18, hvac_modes: ['off', 'heat_cool'], hvac_action: 'idle',
        preset_mode: 'home', preset_modes: ['home', 'away'], fan_mode: 'auto', fan_modes: ['auto'],
        swing_mode: 'off', swing_modes: ['off'], current_humidity: 0, humidity: 0,
      }),
      rawState('select.fixture', { options: ['A', 'B'] }),
      rawState('input_select.fixture', { options: [] }),
      rawState('fan.fixture', { percentage: 0, percentage_step: 25, direction: 'forward', oscillating: false, preset_mode: 'auto', preset_modes: ['auto'] }),
      rawState('cover.fixture', { current_position: 0, current_tilt_position: 0 }),
      rawState('media_player.fixture', {
        volume_level: 0, is_volume_muted: false, media_title: 'Fixture title', media_artist: 'Fixture artist',
        media_album_name: 'Fixture album', media_content_type: 'music', media_duration: 0, media_position: 0,
        media_position_updated_at: '2026-11-12T12:00:00+00:00', source: 'Radio', source_list: ['Radio'],
        sound_mode: 'normal', sound_mode_list: ['normal'], repeat: 'off', shuffle: false,
        media_content_id: 'https://private.invalid/?access_token=discarded',
      }),
      rawState('vacuum.fixture', { battery_level: 0, fan_speed: 'quiet', fan_speed_list: ['quiet'], status: 'Docked' }),
      rawState('weather.fixture', {
        temperature: 0, temperature_unit: 'C', apparent_temperature: -2, humidity: 0, dew_point: -3,
        pressure: 1000, pressure_unit: 'hPa', wind_speed: 0, wind_gust_speed: 0, wind_bearing: 0,
        wind_speed_unit: 'km/h', precipitation_unit: 'mm', visibility: 0, visibility_unit: 'km', cloud_coverage: 0, uv_index: 0,
      }),
      rawState('sensor.unreferenced', { friendly_name: 'private unreferenced' }),
    ];
    const snapshot = nativeHomeSnapshot(envelope(raw.slice(0, -1).map(state => state.entity_id)), raw, credentials);
    expect(snapshot.states).toHaveLength(9);
    expect(snapshot.states[0]).toMatchObject({ brightness: 0, supportedColorModes: ['color_temp', 'hs'], colorTempKelvin: 2700, hsColor: [0, 0], rgbColor: [0, 0, 0], xyColor: [0, 0], supportedFeatures: 4 });
    expect(snapshot.states[1]).toMatchObject({ targetTempHigh: 23, targetTempLow: 18, targetTempStep: 0.5, minTemp: -5, maxTemp: 35, hvacModes: ['off', 'heat_cool'], currentHumidity: 0, targetHumidity: 0, fanModes: ['auto'], swingModes: ['off'] });
    expect(snapshot.states[2].options).toEqual(['A', 'B']);
    expect(snapshot.states[3].options).toEqual([]);
    expect(snapshot.states[4]).toMatchObject({ percentage: 0, percentageStep: 25, oscillating: false, direction: 'forward', presetModes: ['auto'] });
    expect(snapshot.states[5]).toMatchObject({ currentPosition: 0, currentTiltPosition: 0 });
    expect(snapshot.states[6]).toMatchObject({ volumeLevel: 0, isVolumeMuted: false, mediaPosition: 0, mediaTitle: 'Fixture title', sourceList: ['Radio'], shuffle: false });
    expect(snapshot.states[7]).toMatchObject({ batteryLevel: 0, fanSpeedList: ['quiet'], status: 'Docked' });
    expect(snapshot.states[8]).toMatchObject({ unit: 'C', temperature: 0, humidity: 0, windSpeed: 0, windBearing: 0, precipitationUnit: 'mm', uvIndex: 0 });
    for (const forbidden of ['discarded', 'private unreferenced', 'media_content_id', 'entity_picture', 'access_token']) expect(JSON.stringify(snapshot)).not.toContain(forbidden);
    expect(snapshot.states[0].dailyForecast).toBeUndefined();
    expect(nativeHomeSnapshot(envelope(['light.missing']), raw, credentials).states).toEqual([]);
  });

  it.each([
    ['light.fixture', { hs_color: [361, 0] }],
    ['light.fixture', { rgb_color: [0, 0, 256] }],
    ['light.fixture', { color_temp_kelvin: -1 }],
    ['climate.fixture', { hvac_modes: 'heat' }],
    ['climate.fixture', { target_temp_step: 0 }],
    ['number.fixture', { step: 0 }],
    ['input_number.fixture', { max: '10' }],
    ['humidifier.fixture', { min_humidity: -1 }],
    ['select.fixture', { options: Array(101).fill('over-limit') }],
    ['fan.fixture', { oscillating: 'false' }],
    ['cover.fixture', { current_tilt_position: 101 }],
    ['media_player.fixture', { source: 'Bearer fixture-private' }],
    ['vacuum.fixture', { fan_speed_list: ['https://private.invalid/?token=credential'] }],
    ['weather.fixture', { humidity: 101 }],
  ] as const)('rejects malformed or credential-bearing %s capabilities', (id, attributes) => {
    expect(() => nativeHomeSnapshot(envelope([id]), [rawState(id, attributes)], credentials)).toThrow();
  });

  it('omits null weather units and optional controls rather than fabricating defaults', () => {
    const snapshot = nativeHomeSnapshot(envelope(['weather.fixture', 'light.fixture']), [
      rawState('weather.fixture', { temperature_unit: null, humidity: null }),
      rawState('light.fixture', { supported_color_modes: null, color_temp_kelvin: null }),
    ], credentials);
    expect(snapshot.states).toEqual([
      { entityId: 'weather.fixture', name: 'weather.fixture', state: 'off' },
      { entityId: 'light.fixture', name: 'light.fixture', state: 'off' },
    ]);
  });
});

describe('native authenticated identity and bounded forecast reads', () => {
  it('uses one authenticated socket, the exact authenticated user, unique person link, and fixed supported forecast reads only', async () => {
    const fixture = transport({ user: { ...identity, credentials: [{ auth_provider_type: 'homeassistant' }], mfa_modules: [], access_token: 'discarded' } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.currentUser).toEqual({ id: identity.id, name: identity.name, isOwner: false, isAdmin: true, personEntityId: 'person.linked' });
    expect(snapshot.states[0].dailyForecast).toEqual([{ datetime: forecastEntry.datetime, condition: 'cloudy', temperature: 0, templow: -2, precipitation: 0, precipitationProbability: 0, humidity: 50, windSpeed: 0 }]);
    expect(snapshot.states[0].hourlyForecast).toEqual(snapshot.states[0].dailyForecast);
    expect(snapshot.warnings).toBeUndefined();
    expect(fixture.sockets).toHaveLength(1);
    expect(fixture.sockets[0].closed).toBe(true);
    expect(fixture.readStates).toHaveBeenCalledTimes(1);
    expect(fixture.commands.map(command => command.type)).toEqual([
      'auth', 'fenton_home/house_config', 'auth/current_user', 'weather/subscribe_forecast',
      'weather/subscribe_forecast', 'unsubscribe_events', 'unsubscribe_events',
    ]);
    expect(fixture.commands.filter(command => command.type === 'weather/subscribe_forecast')).toEqual([
      { id: 3, type: 'weather/subscribe_forecast', entity_id: 'weather.fixture', forecast_type: 'daily' },
      { id: 4, type: 'weather/subscribe_forecast', entity_id: 'weather.fixture', forecast_type: 'hourly' },
    ]);
    for (const forbidden of ['access_token', 'mfa_modules', 'credentials', 'entity_picture', ...credentials]) expect(JSON.stringify(snapshot)).not.toContain(forbidden);
  });

  it.each([
    { ...identity, id: 123 },
    { ...identity, name: null },
    { ...identity, is_admin: 'true' },
    { ...identity, name: credentials[0] },
    { ...identity, name: 'Bearer fixture-other-secret' },
    { ...identity, name: '/api/image?access_token=fixture-other-secret' },
  ])('does not infer an identity from malformed or unsafe current-user responses', async user => {
    const fixture = transport({ user });
    const snapshot = await fixture.snapshot();
    expect(snapshot.currentUser).toBeUndefined();
    expect(snapshot.warnings).toContain('Current user response was invalid or unsafe');
    expect(snapshot.states[0].dailyForecast).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('fixture-other-secret');
  });

  it('never guesses a person from friendly names or ambiguous matching users', async () => {
    const fixture = transport({ house: envelope([]), states: [
      rawState('person.first', { user_id: identity.id }), rawState('person.second', { user_id: identity.id }),
      rawState('person.named', { friendly_name: identity.name, user_id: 'different' }),
    ] });
    expect((await fixture.snapshot()).currentUser).toEqual({ id: identity.id, name: identity.name, isOwner: false, isAdmin: true });
  });

  it('explicitly rejects an empty successful current-user response', async () => {
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'auth/current_user') return false;
      socket.result(command);
      return true;
    } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.currentUser).toBeUndefined();
    expect(snapshot.warnings).toContain('Current user response was invalid or unsafe');
  });

  it('preserves valid states and explicitly reports unavailable optional reads without upstream error contents', async () => {
    const fixture = transport({ command(command, socket) {
      if (command.type === 'auth/current_user' || command.type === 'weather/subscribe_forecast') {
        socket.emit({ id: command.id, type: 'result', success: false, error: { code: 'not_allowed', message: credentials[0] } });
        return true;
      }
      return false;
    } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.currentUser).toBeUndefined();
    expect(snapshot.states).toHaveLength(1);
    expect(snapshot.states[0].dailyForecast).toBeUndefined();
    expect(snapshot.warnings).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain(credentials[0]);
    expect(fixture.commands.some(command => command.type === 'unsubscribe_events')).toBe(false);
  });

  it.each([
    ['daily', Array(33).fill(forecastEntry)],
    ['hourly', Array(193).fill(forecastEntry)],
    ['daily', [{ ...forecastEntry, datetime: 'not-a-date' }]],
    ['daily', [{ ...forecastEntry, temperature: '0' }]],
    ['daily', [{ ...forecastEntry, humidity: 101 }]],
    ['daily', [{ ...forecastEntry, condition: credentials[1] }]],
    ['daily', null],
  ] as const)('rejects an invalid or oversized %s forecast while retaining other valid data', async (kind, forecast) => {
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'weather/subscribe_forecast' || command.forecast_type !== kind) return false;
      socket.result(command);
      socket.emit({ id: command.id, type: 'event', event: { type: kind, forecast } });
      return true;
    } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.states[0][kind === 'daily' ? 'dailyForecast' : 'hourlyForecast']).toBeUndefined();
    expect(snapshot.states[0][kind === 'daily' ? 'hourlyForecast' : 'dailyForecast']).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.currentUser?.id).toBe(identity.id);
    expect(JSON.stringify(snapshot)).not.toContain(credentials[1]);
  });

  it('accepts the exact forecast caps without truncation and projects no unlisted fields', async () => {
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'weather/subscribe_forecast') return false;
      socket.result(command);
      socket.emit({ id: command.id, type: 'event', event: { type: command.forecast_type, forecast: Array(command.forecast_type === 'daily' ? 32 : 192).fill({ ...forecastEntry, access_token: 'discarded' }) } });
      return true;
    } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.states[0].dailyForecast).toHaveLength(32);
    expect(snapshot.states[0].hourlyForecast).toHaveLength(192);
    expect(snapshot.warnings).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('discarded');
  });

  it('does not request unreferenced weather or unsupported forecast kinds and bounds weather targets', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `weather.fixture_${i}`);
    const fixture = transport({
      house: envelope([...ids, ids[0]]),
      states: [...ids.map(id => rawState(id, { supported_features: 1 })), rawState('weather.unreferenced', { supported_features: 3 })],
    });
    const snapshot = await fixture.snapshot();
    const requests = fixture.commands.filter(command => command.type === 'weather/subscribe_forecast');
    expect(requests).toHaveLength(8);
    expect(new Set(requests.map(command => command.entity_id)).size).toBe(8);
    expect(requests.every(command => command.forecast_type === 'daily')).toBe(true);
    expect(snapshot.warnings).toContain('Weather forecast entity limit exceeded; only the first 8 referenced weather entities were read');
    expect(snapshot.states[8].dailyForecast).toBeUndefined();
  });

  it('bounds optional timeouts and unsubscribes acknowledged forecasts without discarding valid states', async () => {
    vi.useFakeTimers();
    const fixture = transport({ command(command, socket) {
      if (command.type === 'auth/current_user') return true;
      if (command.type === 'weather/subscribe_forecast') { socket.result(command); return true; }
      return false;
    } });
    const pending = fixture.snapshot();
    await vi.advanceTimersByTimeAsync(2400);
    const snapshot = await pending;
    expect(snapshot.states).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(3);
    expect(fixture.commands.filter(command => command.type === 'unsubscribe_events')).toHaveLength(2);
    expect(fixture.sockets[0].closed).toBe(true);
  });

  it.each(['cancel', 'timeout'] as const)('propagates %s during forecasts and closes the shared socket', async reason => {
    const controller = new AbortController();
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'weather/subscribe_forecast') return false;
      socket.result(command);
      controller.abort(reason === 'timeout' ? new DOMException('fixture', 'TimeoutError') : undefined);
      return true;
    } });
    await expect(fixture.snapshot(controller.signal)).rejects.toMatchObject({ status: reason === 'timeout' ? 504 : 503 });
    expect(fixture.sockets[0].closed).toBe(true);
  });

  it('does not open a socket or read states for an already cancelled caller', async () => {
    const fixture = transport();
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.snapshot(controller.signal)).rejects.toMatchObject({ status: 503 });
    expect(fixture.commands).toEqual([]);
    expect(fixture.sockets).toEqual([]);
    expect(fixture.readStates).not.toHaveBeenCalled();
  });

  it('bounds unsubscription acknowledgments and reports failure instead of leaving a socket open', async () => {
    vi.useFakeTimers();
    const fixture = transport({ command(command) { return command.type === 'unsubscribe_events'; } });
    const pending = fixture.snapshot();
    await vi.advanceTimersByTimeAsync(1200);
    const snapshot = await pending;
    expect(snapshot.states[0].dailyForecast).toBeUndefined();
    expect(snapshot.warnings).toHaveLength(2);
    expect(fixture.sockets[0].closed).toBe(true);
    expect(fixture.commands.filter(command => command.type === 'unsubscribe_events')).toHaveLength(2);
  });

  it('rejects malformed authentication before sending commands or HTTP reads', async () => {
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'auth') return false;
      socket.emit({ type: 'auth_invalid', message: credentials[0] });
      return true;
    } });
    await expect(fixture.snapshot()).rejects.toMatchObject({ status: 502, message: 'Home Assistant WebSocket authentication failed' });
    expect(fixture.readStates).not.toHaveBeenCalled();
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.sockets[0].closed).toBe(true);
  });

  it('rejects oversized forecast frames explicitly without wiping valid current states', async () => {
    const fixture = transport({ command(command, socket) {
      if (command.type !== 'weather/subscribe_forecast') return false;
      socket.emit({ id: command.id, type: 'event', event: { padding: 'x'.repeat(260 * 1024) } });
      return true;
    } });
    const snapshot = await fixture.snapshot();
    expect(snapshot.states[0].temperature).toBe(0);
    expect(snapshot.warnings).toHaveLength(2);
    expect(fixture.sockets[0].closed).toBe(true);
  });
});
