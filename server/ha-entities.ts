import { HttpError } from './store';
import { HubRequestError, type LiveEntityHub } from './ha-live';

/**
 * What the Studio's style editor reads from Home Assistant: the entity list, a domain's states with their translated names, the
 * states an entity has only been seen in, and whether a script or timer exists. Read-only: nothing is ever written or installed.
 */

/** One entity as the picker lists it. */
export interface PickerEntity { entityId: string; name: string; state: string; unit?: string; deviceClass?: string }

/** A state Home Assistant offers for an entity, with the name it shows people. */
export interface EntityState { state: string; name?: string }

/** The fill for a state map: Home Assistant's own states, history-only states, and whether the state set is open-ended. */
export interface EntityStates {
  entityId: string;
  deviceClass?: string;
  states: EntityState[];
  history: string[];
  openEnded: boolean;
}

/** The reads this module needs; the client supplies real ones and a test supplies fakes. */
export interface HaReads {
  /** REST `GET <path>`; resolves `undefined` for a 404. */
  get(path: string): Promise<unknown>;
  /** Websocket `frontend/get_translations` for the entity component category of one domain. */
  translations(domain: string): Promise<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const entityPattern = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
/** Domains whose state is a value, not one of a fixed set: the map ends in a resting fallback. */
export const openEndedDomains = new Set(['sensor', 'select', 'input_select', 'input_text', 'input_number', 'number', 'zone', 'person', 'counter', 'text', 'input_datetime', 'weather', 'sun']);

/** The entity list, optionally for one domain, ordered by name. */
export async function listEntities(reads: HaReads, domain?: string): Promise<PickerEntity[]> {
  const raw = await reads.get('/api/states');
  if (!Array.isArray(raw)) throw new HttpError(502, 'Home Assistant returned an unreadable entity list');
  const found: PickerEntity[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.entity_id !== 'string' || !entityPattern.test(item.entity_id) || typeof item.state !== 'string') continue;
    if (domain && !item.entity_id.startsWith(`${domain}.`)) continue;
    const attributes = isRecord(item.attributes) ? item.attributes : {};
    found.push({
      entityId: item.entity_id,
      name: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : item.entity_id,
      state: item.state,
      ...(typeof attributes.unit_of_measurement === 'string' ? { unit: attributes.unit_of_measurement } : {}),
      ...(typeof attributes.device_class === 'string' ? { deviceClass: attributes.device_class } : {}),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));
}

/** Only names and entity membership leave the registries; device identifiers and registry metadata stay on the server. */
export async function listEntityAreas(hub: Pick<LiveEntityHub, 'request'> | undefined, credentials: readonly string[] = []) {
  if (!hub) throw new HttpError(503, 'Home Assistant is not configured');
  let raw: unknown[];
  try {
    raw = await Promise.all(['area', 'device', 'entity'].map(kind => hub.request({ type: `config/${kind}_registry/list` }, 8000)));
  } catch (error) {
    if (error instanceof HubRequestError) throw new HttpError(502, 'Home Assistant areas could not be read');
    throw error;
  }
  if (!raw.every(Array.isArray)) throw new HttpError(502, 'Home Assistant returned unreadable areas');
  const [areaRows, deviceRows, entityRows] = raw as unknown[][];
  const safe = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && !credentials.some(secret => secret && value.includes(secret));
  const areas = areaRows.filter(isRecord).flatMap(row => safe(row.area_id) && safe(row.name) ? [{ id: row.area_id, name: row.name }] : []);
  const areaIds = new Set(areas.map(area => area.id));
  const devices = new Map(deviceRows.filter(isRecord).flatMap(row => safe(row.id) ? [[row.id, row] as const] : []));
  const entities = entityRows.filter(isRecord).flatMap(row => {
    if (!safe(row.entity_id) || !entityPattern.test(row.entity_id)) return [];
    const device = typeof row.device_id === 'string' ? devices.get(row.device_id) : undefined;
    const area = typeof row.area_id === 'string' ? row.area_id : device?.area_id;
    const deviceName = device?.name_by_user ?? device?.name;
    return [{ entityId: row.entity_id, ...(typeof area === 'string' && areaIds.has(area) ? { areaId: area } : {}), ...(safe(deviceName) ? { device: deviceName } : {}) }];
  });
  return { areas, entities };
}

/**
 * The state names Home Assistant translates for a domain. Keys look like `component.light.entity_component._.state.on` (any device
 * class of the domain) or `component.binary_sensor.entity_component.door.state.on` (one device class). A device class's names win.
 */
export function translatedStates(resources: Record<string, string>, domain: string, deviceClass?: string): EntityState[] {
  const states = new Map<string, string>();
  const read = (klass: string) => {
    const prefix = `component.${domain}.entity_component.${klass}.state.`;
    for (const [key, value] of Object.entries(resources)) {
      if (key.startsWith(prefix) && typeof value === 'string') states.set(key.slice(prefix.length), value);
    }
  };
  read('_');
  if (deviceClass) read(deviceClass);
  return [...states].map(([state, name]) => ({ state, name }));
}

/** The distinct states of an entity in the last days, from a minimal history response. */
export function historyStates(raw: unknown): string[] {
  const seen = new Set<string>();
  const lists = Array.isArray(raw) ? raw : [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (isRecord(item) && typeof item.state === 'string') seen.add(item.state);
  }
  return [...seen];
}

/** Home Assistant's own states for one entity, plus any state seen only in its history (these the map lists as unclassified). */
export async function entityStates(reads: HaReads, entityId: string, now = new Date(), days = 10): Promise<EntityStates> {
  if (!entityPattern.test(entityId)) throw new HttpError(400, 'Expected an entity ID such as light.demo_living_room');
  const domain = entityId.split('.')[0];
  const current = await reads.get(`/api/states/${entityId}`);
  if (current === undefined) throw new HttpError(404, 'Home Assistant does not know that entity');
  const attributes = isRecord(current) && isRecord(current.attributes) ? current.attributes : {};
  const deviceClass = typeof attributes.device_class === 'string' ? attributes.device_class : undefined;
  const openEnded = openEndedDomains.has(domain);
  const states = openEnded ? [] : translatedStates(await reads.translations(domain).catch(() => ({})), domain, deviceClass);
  const nowState = isRecord(current) && typeof current.state === 'string' ? current.state : undefined;
  if (nowState && !openEnded && !states.some(item => item.state === nowState)) states.push({ state: nowState });
  const start = new Date(now.getTime() - days * 86_400_000).toISOString();
  const history = historyStates(await reads.get(
    `/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${entityId}&minimal_response&no_attributes&end_time=${encodeURIComponent(now.toISOString())}`,
  ).catch(() => []));
  return {
    entityId, ...(deviceClass ? { deviceClass } : {}), states, openEnded,
    history: openEnded ? [] : history.filter(state => !states.some(item => item.state === state)),
  };
}

/** Whether a script or timer exists, for the request phase's two warnings. */
export async function entityExists(reads: HaReads, id: string): Promise<boolean> {
  if (!/^(script|timer)\.[a-z0-9_]+$/.test(id)) throw new HttpError(400, 'Expected a script or timer ID');
  return (await reads.get(`/api/states/${id}`)) !== undefined;
}
