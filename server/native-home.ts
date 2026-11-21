import { z } from 'zod/v4';
import { assertJsonBounds, DocumentValidationError, entityIdSchema, jsonSchema } from '../src/shared/validation';
import { nativeClimateRoomEntities } from '../src/shared/native-entities';
import { nativeTodoItemSchema, nativeTodoReadSchema, choreRecord, choreRecords } from '../src/shared/native-chores';
import type { NativeCurrentUser, NativeForecast, NativeSnapshot, NativeState } from '../src/shared/native-state';
import type { Json } from '../src/shared/types';
import { HttpError } from './store';

const maxConfigBytes = 256 * 1024;
const maxSnapshotBytes = 1024 * 1024;
const requiredSections = ['home', 'security', 'climate', 'customLights', 'food', 'chores', 'household', 'media', 'roomDevices', 'sprinklers', 'vacation', 'vacuums', 'bedroom', 'rooms'];
const sensitiveKey = /token|secret|password|credential|pushurl|apikey|webhook|authorization|privatekey/;
const envelopeSchema = z.object({
  schema: z.literal(2),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  config: z.record(z.string().max(160), jsonSchema).refine((value) => Object.keys(value).length <= 100),
}).strict();
const finite = z.number().finite();
const percent = finite.min(0).max(100);
const nonnegative = finite.min(0);
const text = z.string().max(240);
const options = z.array(text).max(100);
const timestamp = z.iso.datetime({ offset: true });
const forecastSchema = z.object({
  datetime: timestamp,
  condition: text.optional(),
  temperature: finite.optional(),
  templow: finite.optional(),
  precipitation: nonnegative.optional(),
  precipitationProbability: percent.optional(),
  humidity: percent.optional(),
  windSpeed: nonnegative.optional(),
}).strict();
const stateSchema = z.object({
  entityId: entityIdSchema,
  state: z.string().max(255),
  lastChanged: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).optional(),
  name: z.string().max(240),
  unit: z.string().max(80).optional(),
  icon: z.string().max(80).optional(),
  deviceClass: z.string().max(80).optional(),
  brightness: z.number().min(0).max(255).optional(),
  temperature: z.number().finite().optional(),
  currentTemperature: z.number().finite().optional(),
  hvacAction: z.string().max(80).optional(),
  percentage: z.number().min(0).max(100).optional(),
  currentPosition: z.number().min(0).max(100).optional(),
  volumeLevel: z.number().min(0).max(1).optional(),
  isVolumeMuted: z.boolean().optional(),
  supportedFeatures: z.number().int().min(0).max(0x7fffffff).optional(),
  supportedColorModes: z.array(text).max(16).optional(),
  colorMode: text.optional(),
  colorTempKelvin: finite.positive().max(100000).optional(),
  minColorTempKelvin: finite.positive().max(100000).optional(),
  maxColorTempKelvin: finite.positive().max(100000).optional(),
  hsColor: z.tuple([finite.min(0).max(360), percent]).optional(),
  rgbColor: z.tuple([finite.min(0).max(255), finite.min(0).max(255), finite.min(0).max(255)]).optional(),
  xyColor: z.tuple([finite.min(0).max(1), finite.min(0).max(1)]).optional(),
  effect: text.optional(),
  effectList: options.optional(),
  minTemp: finite.optional(),
  maxTemp: finite.optional(),
  targetTempStep: finite.positive().optional(),
  targetTempHigh: finite.optional(),
  targetTempLow: finite.optional(),
  hvacModes: options.optional(),
  presetMode: text.optional(),
  presetModes: options.optional(),
  fanMode: text.optional(),
  fanModes: options.optional(),
  swingMode: text.optional(),
  swingModes: options.optional(),
  currentHumidity: percent.optional(),
  targetHumidity: percent.optional(),
  minHumidity: percent.optional(),
  maxHumidity: percent.optional(),
  min: finite.optional(),
  max: finite.optional(),
  step: finite.positive().optional(),
  options: options.optional(),
  percentageStep: percent.optional(),
  direction: text.optional(),
  oscillating: z.boolean().optional(),
  currentTiltPosition: percent.optional(),
  mediaTitle: text.optional(),
  mediaArtist: text.optional(),
  mediaAlbumName: text.optional(),
  mediaContentType: text.optional(),
  mediaDuration: nonnegative.optional(),
  mediaPosition: nonnegative.optional(),
  mediaPositionUpdatedAt: timestamp.optional(),
  source: text.optional(),
  sourceList: options.optional(),
  soundMode: text.optional(),
  soundModeList: options.optional(),
  repeat: text.optional(),
  shuffle: z.boolean().optional(),
  batteryLevel: percent.optional(),
  fanSpeed: text.optional(),
  fanSpeedList: options.optional(),
  status: text.optional(),
  apparentTemperature: finite.optional(),
  humidity: percent.optional(),
  dewPoint: finite.optional(),
  pressure: nonnegative.optional(),
  pressureUnit: text.optional(),
  windSpeed: nonnegative.optional(),
  windGustSpeed: nonnegative.optional(),
  windBearing: z.union([finite.min(0).max(360), text]).optional(),
  windSpeedUnit: text.optional(),
  precipitationUnit: text.optional(),
  visibility: nonnegative.optional(),
  visibilityUnit: text.optional(),
  cloudCoverage: percent.optional(),
  uvIndex: nonnegative.optional(),
  dailyForecast: z.array(forecastSchema).max(32).optional(),
  hourlyForecast: z.array(forecastSchema).max(192).optional(),
  todoList: nativeTodoReadSchema.optional(),
}).strict();

export type NativeHouseConfig = z.infer<typeof envelopeSchema>;
export type NativeEntityState = NativeState;
export type NativeHomeSnapshot = NativeSnapshot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nativeHomeAbortError(signal: AbortSignal) {
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? new HttpError(504, 'Native home snapshot timed out')
    : new HttpError(503, 'Native home snapshot was cancelled');
}

function parseHouseConfig(input: unknown): NativeHouseConfig {
  if (isRecord(input) && input.configured === false) throw new HttpError(503, 'Native house configuration is not configured in Home Assistant');
  if (isRecord(input) && typeof input.schema === 'number' && input.schema !== 2) throw new HttpError(502, 'Unsupported native house configuration schema; expected 2');
  try { assertJsonBounds(input); }
  catch (error) {
    if (!(error instanceof DocumentValidationError)) throw error;
    throw new HttpError(502, 'Native house configuration exceeds JSON bounds');
  }
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(502, 'Invalid native house configuration envelope');
  if (Buffer.byteLength(JSON.stringify(parsed.data.config)) > maxConfigBytes) throw new HttpError(502, 'Native house configuration exceeds 256 KiB');
  if (requiredSections.some((key) => !isRecord(parsed.data.config[key]) && !Array.isArray(parsed.data.config[key]))) {
    throw new HttpError(502, 'Native house configuration is missing required schema-2 sections');
  }
  return parsed.data;
}

type ReadCommand =
  | { type: 'fenton_home/house_config' | 'auth/current_user' }
  | { type: 'todo/item/list'; entity_id: string }
  | { type: 'weather/subscribe_forecast'; entity_id: string; forecast_type: 'daily' | 'hourly' }
  | { type: 'unsubscribe_events'; subscription: number };
type PendingRead = {
  command: ReadCommand;
  acknowledged: boolean;
  resolve: (value: unknown) => void;
  reject: (error: HttpError) => void;
  timer?: ReturnType<typeof setTimeout>;
};

class NativeReadSession {
  private readonly socket: WebSocket;
  private phase: 'challenge' | 'authentication' | 'ready' = 'challenge';
  private failure?: HttpError;
  private nextId = 1;
  private messageCount = 0;
  private bytes = 0;
  private readonly pending = new Map<number, PendingRead>();
  private readonly retiredSubscriptions = new Set<number>();
  private readonly retiredTodoReads = new Set<number>();
  private readonly activeSubscriptions = new Set<number>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: HttpError) => void;

  constructor(url: string, private readonly token: string, private readonly signal: AbortSignal) {
    try { this.socket = new WebSocket(url); }
    catch { throw new HttpError(502, 'Home Assistant WebSocket connection failed'); }
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.socket.addEventListener('message', this.message);
    this.socket.addEventListener('error', this.failed);
    this.socket.addEventListener('close', this.closed);
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }

  close(error = new HttpError(502, 'Home Assistant WebSocket closed before returning house configuration')) {
    if (this.failure) return;
    this.failure = error;
    this.signal.removeEventListener('abort', this.abort);
    this.socket.removeEventListener('message', this.message);
    this.socket.removeEventListener('error', this.failed);
    this.socket.removeEventListener('close', this.closed);
    this.rejectReady(error);
    for (const [id] of this.pending) this.finish(id, error);
    this.socket.close();
  }
  private abort = () => this.close(nativeHomeAbortError(this.signal));
  private failed = () => this.close(new HttpError(502, 'Home Assistant WebSocket connection failed'));
  private closed = () => this.close();
  private send(value: object) {
    try { this.socket.send(JSON.stringify(value)); }
    catch { this.failed(); }
  }
  private finish(id: number, error?: HttpError, value?: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (pending.command.type === 'weather/subscribe_forecast') this.retiredSubscriptions.add(id);
    if (error && pending.command.type === 'todo/item/list') this.retiredTodoReads.add(id);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
  private message = (event: MessageEvent) => {
    if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > maxConfigBytes + 4096) {
      this.close(new HttpError(502, 'Home Assistant house configuration message is invalid or oversized')); return;
    }
    this.bytes += Buffer.byteLength(event.data);
    if (++this.messageCount > 128 || this.bytes > 4 * 1024 * 1024) {
      this.close(new HttpError(502, 'Home Assistant WebSocket session exceeds read limits')); return;
    }
    let payload: unknown;
    try { payload = JSON.parse(event.data); }
    catch { this.close(new HttpError(502, 'Home Assistant WebSocket returned invalid JSON')); return; }
    if (!isRecord(payload)) { this.close(new HttpError(502, 'Invalid Home Assistant WebSocket message')); return; }
    if (this.phase === 'challenge' && payload.type === 'auth_required') {
      this.phase = 'authentication';
      this.send({ type: 'auth', access_token: this.token });
    } else if (this.phase === 'authentication' && payload.type === 'auth_ok') {
      this.phase = 'ready';
      this.resolveReady();
    } else if (payload.type === 'auth_invalid') {
      this.close(new HttpError(502, 'Home Assistant WebSocket authentication failed'));
    } else if (this.phase === 'ready' && typeof payload.id === 'number') {
      const pending = this.pending.get(payload.id);
      if (!pending) {
        if (payload.type === 'result' && this.retiredTodoReads.delete(payload.id)) return;
        // Initial forecast reads can race a further update while unsubscribing.
        if (payload.type === 'event' && this.retiredSubscriptions.has(payload.id)) return;
        this.close(new HttpError(502, 'Unexpected Home Assistant WebSocket message')); return;
      }
      if (payload.type === 'result' && !pending.acknowledged && typeof payload.success === 'boolean') {
        if (!payload.success) {
          this.finish(payload.id, new HttpError(502, pending.command.type === 'fenton_home/house_config'
            ? 'Native house configuration command is unavailable' : 'Optional native read command is unavailable'));
        } else if (pending.command.type === 'weather/subscribe_forecast') {
          pending.acknowledged = true;
          this.activeSubscriptions.add(payload.id);
        } else this.finish(payload.id, undefined, payload.result);
      } else if (payload.type === 'event' && pending.acknowledged && pending.command.type === 'weather/subscribe_forecast') {
        if (!isRecord(payload.event) || payload.event.type !== pending.command.forecast_type) {
          this.finish(payload.id, new HttpError(502, 'Invalid native weather forecast event')); return;
        }
        this.finish(payload.id, undefined, payload.event.forecast);
      } else this.close(new HttpError(502, 'Unexpected Home Assistant WebSocket message'));
    } else this.close(new HttpError(502, 'Unexpected Home Assistant WebSocket message'));
  };
  private async request(command: ReadCommand, optional = false): Promise<unknown> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.signal.aborted) throw nativeHomeAbortError(this.signal);
    const id = this.nextId++;
    try {
      return await new Promise((resolve, reject) => {
        const pending: PendingRead = { command, acknowledged: false, resolve, reject };
        if (optional) pending.timer = setTimeout(() => this.finish(id, new HttpError(504, 'Optional native read timed out')), 1200);
        this.pending.set(id, pending);
        this.send({ ...command, id });
      });
    } finally {
      if (command.type === 'weather/subscribe_forecast' && this.activeSubscriptions.delete(id) && !this.failure && !this.signal.aborted) {
        await this.request({ type: 'unsubscribe_events', subscription: id }, true);
      }
    }
  }
  async houseConfig() { return parseHouseConfig(await this.request({ type: 'fenton_home/house_config' })); }
  currentUser() { return this.request({ type: 'auth/current_user' }, true); }
  todoItems(entityId: string) { return this.request({ type: 'todo/item/list', entity_id: entityId }, true); }
  forecast(entityId: string, kind: 'daily' | 'hourly') {
    return this.request({ type: 'weather/subscribe_forecast', entity_id: entityId, forecast_type: kind }, true);
  }
}

/** Fixed one-shot house read, also used to authorize the separate camera transport. */
export async function readNativeHouseConfig(url: string, token: string, signal: AbortSignal): Promise<NativeHouseConfig> {
  if (signal.aborted) throw nativeHomeAbortError(signal);
  const session = new NativeReadSession(url, token, signal);
  try { return await session.houseConfig(); }
  finally { session.close(); }
}

function inspectConfig(value: Json, references: Set<string>) {
  if (typeof value === 'string') {
    if (entityIdSchema.safeParse(value).success) references.add(value);
    if (/\{\{|\{%|(?:javascript|vbscript|data|file):|(?:^|\s)Bearer\s+\S+/i.test(value)) throw new HttpError(502, 'Native house configuration contains unsafe executable or credential-bearing content');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) {
      let url: URL;
      try { url = new URL(value, 'https://native-home.invalid'); }
      catch { throw new HttpError(502, 'Native house configuration contains an invalid URL'); }
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => sensitiveKey.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase()))) {
        throw new HttpError(502, 'Native house configuration contains credential-bearing URLs');
      }
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (sensitiveKey.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) throw new HttpError(502, 'Native house configuration contains credential-bearing fields');
      if (entityIdSchema.safeParse(key).success) references.add(key);
      inspectConfig(nested, references);
    }
  }
}

function containsCredential(value: unknown, credentials: string[]): boolean {
  if (typeof value === 'string') return credentials.some((credential) => credential && value.includes(credential));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) => containsCredential(key, credentials) || containsCredential(nested, credentials));
  }
  return false;
}

/**
 * Every entity id a house configuration names: the ids in its strings and keys, plus the climate rooms' own entities.
 * Throws a 502 `HttpError` when the configuration is unsafe or too large.
 */
export function houseConfigReferences(houseConfig: Pick<NativeHouseConfig, 'config'>): Set<string> {
  const references = new Set<string>();
  inspectConfig(houseConfig.config, references);
  const climate = houseConfig.config.climate;
  if (isRecord(climate) && climate.rooms !== undefined) {
    if (!Array.isArray(climate.rooms)) throw new HttpError(502, 'Invalid native climate rooms');
    for (const room of climate.rooms) {
      if (!isRecord(room) || typeof room.title !== 'string') throw new HttpError(502, 'Invalid native climate room title');
      try { Object.values(nativeClimateRoomEntities(room.title)).forEach(id => references.add(id)); }
      catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new HttpError(502, error.message);
      }
    }
  }
  if (references.size > 1000) throw new HttpError(502, 'Native house configuration references more than 1000 entities');
  return references;
}

/**
 * Projects one Home Assistant state object (`{ entity_id, state, attributes }`, as REST or the entity stream gives it) to the
 * fields the app reads, plus explicitly wanted attributes for the Studio's live preview. Throws a 502 `HttpError` for a malformed or out-of-bounds state.
 */
export function projectNativeState(raw: unknown, wantedAttributes?: ReadonlySet<string>): NativeEntityState {
  if (!isRecord(raw) || typeof raw.entity_id !== 'string') throw new HttpError(502, 'Invalid Home Assistant state record');
  if (!isRecord(raw.attributes)) throw new HttpError(502, 'Invalid Home Assistant state attributes');
  const attributes = raw.attributes;
  const projected: Record<string, unknown> = {
    entityId: raw.entity_id, state: raw.state,
    name: attributes.friendly_name ?? raw.entity_id,
  };
  const lastChanged = lastChangedText(raw.last_changed);
  if (lastChanged) projected.lastChanged = lastChanged;
  const fields = {
    unit_of_measurement: 'unit', icon: 'icon', device_class: 'deviceClass',
    brightness: 'brightness', temperature: 'temperature', current_temperature: 'currentTemperature',
    hvac_action: 'hvacAction', percentage: 'percentage', current_position: 'currentPosition',
    volume_level: 'volumeLevel', is_volume_muted: 'isVolumeMuted',
  };
  for (const [source, target] of Object.entries(fields)) {
    if (attributes[source] !== undefined && attributes[source] !== null) projected[target] = attributes[source];
  }
  projectFields(projected, attributes, { supported_features: 'supportedFeatures' });
  const domain = raw.entity_id.split('.')[0];
  if (domain === 'light') projectFields(projected, attributes, {
    supported_color_modes: 'supportedColorModes', color_mode: 'colorMode', color_temp_kelvin: 'colorTempKelvin',
    min_color_temp_kelvin: 'minColorTempKelvin', max_color_temp_kelvin: 'maxColorTempKelvin',
    hs_color: 'hsColor', rgb_color: 'rgbColor', xy_color: 'xyColor', effect: 'effect', effect_list: 'effectList',
  });
  if (domain === 'climate') projectFields(projected, attributes, {
    min_temp: 'minTemp', max_temp: 'maxTemp', target_temp_step: 'targetTempStep',
    target_temp_high: 'targetTempHigh', target_temp_low: 'targetTempLow', hvac_modes: 'hvacModes',
    preset_mode: 'presetMode', preset_modes: 'presetModes', fan_mode: 'fanMode', fan_modes: 'fanModes',
    swing_mode: 'swingMode', swing_modes: 'swingModes', current_humidity: 'currentHumidity', humidity: 'targetHumidity',
  });
  if (domain === 'select' || domain === 'input_select') projectFields(projected, attributes, { options: 'options' });
  if (domain === 'number' || domain === 'input_number') projectFields(projected, attributes, { min: 'min', max: 'max', step: 'step' });
  if (domain === 'humidifier') projectFields(projected, attributes, {
    current_humidity: 'currentHumidity', humidity: 'targetHumidity', min_humidity: 'minHumidity', max_humidity: 'maxHumidity',
  });
  if (domain === 'fan') projectFields(projected, attributes, {
    percentage_step: 'percentageStep', preset_mode: 'presetMode', preset_modes: 'presetModes', direction: 'direction', oscillating: 'oscillating',
  });
  if (domain === 'cover') projectFields(projected, attributes, { current_tilt_position: 'currentTiltPosition' });
  if (domain === 'media_player') projectFields(projected, attributes, {
    media_title: 'mediaTitle', media_artist: 'mediaArtist', media_album_name: 'mediaAlbumName',
    media_content_type: 'mediaContentType', media_duration: 'mediaDuration', media_position: 'mediaPosition',
    media_position_updated_at: 'mediaPositionUpdatedAt', source: 'source', source_list: 'sourceList',
    sound_mode: 'soundMode', sound_mode_list: 'soundModeList', repeat: 'repeat', shuffle: 'shuffle',
  });
  if (domain === 'vacuum') projectFields(projected, attributes, {
    battery_level: 'batteryLevel', fan_speed: 'fanSpeed', fan_speed_list: 'fanSpeedList', status: 'status',
  });
  if (domain === 'weather') projectFields(projected, attributes, {
    apparent_temperature: 'apparentTemperature', humidity: 'humidity', dew_point: 'dewPoint', pressure: 'pressure',
    pressure_unit: 'pressureUnit', wind_speed: 'windSpeed', wind_gust_speed: 'windGustSpeed', wind_bearing: 'windBearing',
    wind_speed_unit: 'windSpeedUnit', precipitation_unit: 'precipitationUnit', visibility: 'visibility',
    visibility_unit: 'visibilityUnit', cloud_coverage: 'cloudCoverage', uv_index: 'uvIndex',
  });
  if (domain === 'weather' && projected.unit === undefined) projectFields(projected, attributes, { temperature_unit: 'unit' });
  const parsed = stateSchema.safeParse(projected);
  if (!parsed.success) throw new HttpError(502, 'Invalid projected Home Assistant state');
  const extra = wantedAttributes && projectNativeAttributes(attributes, wantedAttributes);
  return extra ? { ...parsed.data, attributes: extra } : parsed.data;
}

const deniedAttribute = /token|password|passwd|secret|api_?key|credential|auth/i;
const safeAttributeName = (name: string) => name.toLowerCase() !== 'entity_picture' && !deniedAttribute.test(name);
function hasDeniedAttribute(value: Json): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasDeniedAttribute);
  return Object.entries(value).some(([name, nested]) => !safeAttributeName(name) || hasDeniedAttribute(nested));
}

/** Extra attributes never become native fields; unsafe, non-JSON or oversized values remain unavailable. */
export function projectNativeAttributes(attributes: Readonly<Record<string, unknown>>, wanted: ReadonlySet<string>): Record<string, Json> | undefined {
  const extra: Record<string, Json> = {};
  for (const name of wanted) {
    if (!safeAttributeName(name) || !Object.hasOwn(attributes, name)) continue;
    const raw = attributes[name];
    try { assertJsonBounds({ [name]: raw }); }
    catch (error) {
      if (!(error instanceof DocumentValidationError)) throw error;
      continue;
    }
    const parsed = jsonSchema.safeParse(raw);
    if (!parsed.success || hasDeniedAttribute(parsed.data) || Buffer.byteLength(JSON.stringify(parsed.data)) > 4 * 1024) continue;
    extra[name] = parsed.data;
  }
  return Object.keys(extra).length ? extra : undefined;
}

/**
 * The todo list ids a draft names: every `lists[].entityId` of its `todo-collection@1` sources. The Studio reads these lists as well as the ones
 * house configuration's chores pages name, so the sim draws the draft's own sections. Ids that are not `todo.` entities are left out.
 */
export function draftTodoIds(document: unknown): Set<string> {
  const ids = new Set<string>();
  const sources = isRecord(document) && Array.isArray(document.dataSources) ? document.dataSources : [];
  for (const source of sources) {
    if (!isRecord(source) || source.model !== 'todo-collection@1' || !isRecord(source.inputs) || !Array.isArray(source.inputs.lists)) continue;
    for (const list of source.inputs.lists) {
      const id = isRecord(list) && isRecord(list.entityId) ? list.entityId.value : undefined;
      if (typeof id === 'string' && id.startsWith('todo.') && entityIdSchema.safeParse(id).success) ids.add(id);
    }
  }
  return ids;
}

/** `extraReferences` are entity ids the draft names beyond house configuration's (its todo lists), so their states are carried too. */
export function nativeHomeSnapshot(houseConfig: NativeHouseConfig, rawStates: unknown, credentials: string[], extraReferences: ReadonlySet<string> = new Set()): NativeHomeSnapshot {
  const references = houseConfigReferences(houseConfig);
  for (const id of extraReferences) references.add(id);
  if (!Array.isArray(rawStates)) throw new HttpError(502, 'Invalid Home Assistant states response');
  const states: NativeEntityState[] = [];
  const seen = new Set<string>();
  for (const raw of rawStates) {
    if (!isRecord(raw) || typeof raw.entity_id !== 'string') throw new HttpError(502, 'Invalid Home Assistant state record');
    if (!references.has(raw.entity_id)) continue;
    if (seen.has(raw.entity_id)) throw new HttpError(502, 'Home Assistant returned duplicate entity states');
    seen.add(raw.entity_id);
    states.push(projectNativeState(raw));
  }
  const snapshot: NativeHomeSnapshot = { mode: 'live', houseConfig, states };
  return validateSnapshot(snapshot, credentials);
}

/**
 * When a state last changed, as `YYYY-MM-DDTHH:MM:SS.sssZ` (`sh.entity-time@1`). Home Assistant's REST states give an ISO text with microseconds and an offset;
 * its entity stream gives epoch seconds. Anything else, or a moment that is not a date, is no time at all (the operand then reads unavailable).
 */
export function lastChangedText(value: unknown): string | undefined {
  const date = typeof value === 'string' ? new Date(value) : typeof value === 'number' ? new Date(value * 1000) : undefined;
  return date && Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date.toISOString() : undefined;
}

function projectFields(target: Record<string, unknown>, source: Record<string, unknown>, fields: Record<string, string>) {
  for (const [from, to] of Object.entries(fields)) {
    if (source[from] !== undefined && source[from] !== null) target[to] = source[from];
  }
}

function validateSnapshot(snapshot: NativeSnapshot, credentials: string[]): NativeSnapshot {
  inspectConfig(snapshot.states, new Set());
  if (snapshot.currentUser) inspectConfig(snapshot.currentUser, new Set());
  try { assertJsonBounds(snapshot); }
  catch (error) {
    if (!(error instanceof DocumentValidationError)) throw error;
    throw new HttpError(502, 'Native home snapshot exceeds JSON bounds');
  }
  const serialized = JSON.stringify(snapshot);
  if (containsCredential(snapshot, credentials)) throw new HttpError(502, 'Native home snapshot contains server credentials');
  if (Buffer.byteLength(serialized) > maxSnapshotBytes) throw new HttpError(502, 'Native home snapshot exceeds 1 MiB');
  return snapshot;
}

const currentUserSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(240),
  isOwner: z.boolean(),
  isAdmin: z.boolean(),
}).strict();

function currentUser(raw: unknown, rawStates: unknown, credentials: string[]): NativeCurrentUser {
  if (!isRecord(raw)) throw new HttpError(502, 'Invalid native current user response');
  const parsed = currentUserSchema.safeParse({ id: raw.id, name: raw.name, isOwner: raw.is_owner, isAdmin: raw.is_admin });
  if (!parsed.success) throw new HttpError(502, 'Invalid native current user response');
  const user: NativeCurrentUser = parsed.data;
  inspectConfig(user, new Set());
  if (containsCredential(user, credentials)) throw new HttpError(502, 'Native current user contains server credentials');
  if (Array.isArray(rawStates)) {
    const persons = rawStates.filter((state: unknown): state is Record<string, unknown> =>
      isRecord(state) && typeof state.entity_id === 'string' && state.entity_id.startsWith('person.') &&
      entityIdSchema.safeParse(state.entity_id).success && isRecord(state.attributes) && state.attributes.user_id === user.id);
    if (persons.length === 1 && typeof persons[0].entity_id === 'string') user.personEntityId = persons[0].entity_id;
  }
  return user;
}

function forecast(raw: unknown, kind: 'daily' | 'hourly', credentials: string[]): NativeForecast[] {
  if (!Array.isArray(raw) || raw.length > (kind === 'daily' ? 32 : 192)) throw new HttpError(502, 'Invalid or oversized native weather forecast');
  const entries = raw.map((entry: unknown) => {
    if (!isRecord(entry)) throw new HttpError(502, 'Invalid native weather forecast');
    const projected: Record<string, unknown> = { datetime: entry.datetime };
    projectFields(projected, entry, {
      condition: 'condition', temperature: 'temperature', templow: 'templow', precipitation: 'precipitation',
      precipitation_probability: 'precipitationProbability', humidity: 'humidity', wind_speed: 'windSpeed',
    });
    const parsed = forecastSchema.safeParse(projected);
    if (!parsed.success) throw new HttpError(502, 'Invalid native weather forecast');
    return parsed.data;
  });
  inspectConfig(entries, new Set());
  if (containsCredential(entries, credentials)) throw new HttpError(502, 'Native weather forecast contains server credentials');
  return entries;
}

function todoItems(raw: unknown, credentials: string[]) {
  if (!isRecord(raw) || !Array.isArray(raw.items) || raw.items.length > 1000) throw new HttpError(502, 'Invalid or oversized native todo collection');
  const items = raw.items.map((item: unknown) => {
    if (!isRecord(item)) throw new HttpError(502, 'Invalid native todo item');
    const due = item.due_datetime ?? item.due ?? item.due_date;
    const parsed = nativeTodoItemSchema.safeParse({
      uid: item.uid ?? item.summary, summary: item.summary ?? '', status: item.status,
      ...(item.description != null ? { description: item.description } : {}),
      ...(due != null ? { due } : {}),
    });
    if (!parsed.success) throw new HttpError(502, 'Invalid native todo item');
    return parsed.data;
  });
  if (new Set(items.map(item => item.uid)).size !== items.length) throw new HttpError(502, 'Duplicate native todo identity');
  inspectConfig(items, new Set());
  if (containsCredential(items, credentials)) throw new HttpError(502, 'Native todo collection contains server credentials');
  return items;
}

export async function readNativeSnapshot(
  url: string, token: string, signal: AbortSignal, credentials: string[],
  readStates: () => Promise<unknown>,
  /** Todo lists the draft names (`draftTodoIds`), read in addition to the chores pages' lists; the cap of 64 covers both. */
  extraTodoIds: ReadonlySet<string> = new Set(),
): Promise<NativeSnapshot> {
  if (signal.aborted) throw nativeHomeAbortError(signal);
  const session = new NativeReadSession(url, token, signal);
  const warnings: string[] = [];
  const optional = async <T>(read: () => Promise<T>, warning: string): Promise<T | undefined> => {
    try { return await read(); }
    catch (error) {
      if (signal.aborted) throw nativeHomeAbortError(signal);
      if (!(error instanceof HttpError)) throw error;
      warnings.push(warning);
      return undefined;
    }
  };
  try {
    const houseConfig = await session.houseConfig();
    const [rawStates, rawUser] = await Promise.all([
      readStates(),
      optional(async () => ({ value: await session.currentUser() }), 'Current user read unavailable'),
    ]);
    const snapshot = nativeHomeSnapshot(houseConfig, rawStates, credentials, extraTodoIds);
    if (rawUser !== undefined) {
      snapshot.currentUser = await optional(async () => currentUser(rawUser.value, rawStates, credentials), 'Current user response was invalid or unsafe');
      if (!snapshot.currentUser) delete snapshot.currentUser;
    }
    const chores = choreRecord(houseConfig.config.chores);
    const todoIds = [...new Set([
      ...extraTodoIds,
      ...choreRecords(chores.pages).flatMap(page => choreRecords(page.lists).map(list => list.entityId)),
      ...choreRecords(chores.people).flatMap(person => Object.values(choreRecord(person.summaryLists))),
    ].filter((id): id is string => typeof id === 'string' && id.startsWith('todo.') && entityIdSchema.safeParse(id).success))];
    if (todoIds.length > 64) {
      warnings.push('Chores collection limit exceeded; no todo collections were read');
    } else await Promise.all(todoIds.map(async id => {
      const state = snapshot.states.find(state => state.entityId === id);
      if (!state) { warnings.push(`Chores entity state unavailable for ${id}`); return; }
      const items = await optional(async () => todoItems(await session.todoItems(id), credentials),
        `Chores read unavailable, invalid, or oversized for ${id}`);
      state.todoList = items === undefined
        ? { status: 'error', message: 'Chores could not be loaded. Refresh live preview data to retry.' }
        : { status: 'ready', items };
    }));
    const weather = snapshot.states.filter(state => state.entityId.startsWith('weather.'));
    if (weather.length > 8) warnings.push('Weather forecast entity limit exceeded; only the first 8 referenced weather entities were read');
    await Promise.all(weather.slice(0, 8).flatMap(state => (['daily', 'hourly'] as const).map(async kind => {
      const feature = kind === 'daily' ? 1 : 2;
      if (!((state.supportedFeatures ?? 0) & feature)) {
        warnings.push(`Weather ${kind} forecast is not supported for ${state.entityId}`);
        return;
      }
      const entries = await optional(async () => forecast(await session.forecast(state.entityId, kind), kind, credentials),
        `Weather ${kind} forecast read unavailable, invalid, or oversized for ${state.entityId}`);
      if (entries !== undefined) {
        if (kind === 'daily') state.dailyForecast = entries;
        else state.hourlyForecast = entries;
      }
    })));
    if (signal.aborted) throw nativeHomeAbortError(signal);
    if (warnings.length) snapshot.warnings = warnings.sort();
    return validateSnapshot(snapshot, credentials);
  } finally { session.close(); }
}
