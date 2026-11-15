import { request } from '../../api';

/** One field of a service, as the server reduces it. */
export interface ServiceField { name: string; description?: string; required?: boolean; kind: 'number' | 'boolean' | 'choice' | 'text'; unit?: string; min?: number; max?: number; step?: number; options?: string[] }
/** One service. */
export interface ServiceRow { domain: string; service: string; name: string; description?: string; fields: Record<string, ServiceField>; target: boolean }

/** `Light: Turn on` for `light.turn_on` when Home Assistant gave no name. */
const words = (text: string) => { const spaced = text.replace(/_/g, ' '); return spaced.charAt(0).toUpperCase() + spaced.slice(1); };
export const serviceTitle = (row: Pick<ServiceRow, 'domain' | 'service' | 'name'>) => `${words(row.domain)}: ${row.name || words(row.service)}`;

/** The services shown when Home Assistant is not connected: the common ones, with the fields people reach for. */
const brightness: ServiceField = { name: 'Brightness', kind: 'number', min: 0, max: 255 };
const sample: Record<string, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'], switch: ['turn_on', 'turn_off', 'toggle'], fan: ['turn_on', 'turn_off', 'toggle', 'set_percentage'],
  climate: ['set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'], cover: ['open_cover', 'close_cover', 'stop_cover', 'set_cover_position'],
  lock: ['lock', 'unlock', 'open'], alarm_control_panel: ['alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night', 'alarm_disarm'],
  media_player: ['media_play', 'media_pause', 'volume_set', 'volume_up', 'volume_down'], scene: ['turn_on'], script: ['turn_on'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'], input_number: ['set_value'], input_select: ['select_option'], button: ['press'], vacuum: ['start', 'stop', 'return_to_base'],
  notify: ['notify'], homeassistant: ['turn_on', 'turn_off', 'toggle'],
};
export const sampleServices: ServiceRow[] = Object.entries(sample).flatMap(([domain, list]) => list.map(service => ({
  domain, service, name: words(service), target: domain !== 'script' && domain !== 'notify',
  fields: (domain === 'light' && service === 'turn_on' ? { brightness } : domain === 'climate' && service === 'set_temperature' ? { temperature: { name: 'Temperature', kind: 'number' as const, required: true } }
    : domain === 'cover' && service === 'set_cover_position' ? { position: { name: 'Position', kind: 'number' as const, min: 0, max: 100, unit: '%' } } : {}) as Record<string, ServiceField>,
})));

let cache: Promise<ServiceRow[] | undefined> | undefined;
/** Home Assistant's services through the Studio's server, or undefined when it is not connected. Fetched once. */
export function loadServices(): Promise<ServiceRow[] | undefined> {
  cache ??= request<{ domain: string; services: { service: string; name?: string; description?: string; fields: Record<string, ServiceField>; target: boolean }[] }[]>('/native/api/ha/services')
    .then(domains => domains.flatMap(item => item.services.map(service => ({ domain: item.domain, service: service.service, name: service.name ?? words(service.service), description: service.description, fields: service.fields, target: service.target }))))
    .catch(() => { cache = undefined; return undefined; });
  return cache;
}
/** Forgets the fetched list (tests). */
export const resetServices = () => { cache = undefined; };

/** Rows matching every word in the title, id or description, in domain order. */
export function filterServices(rows: readonly ServiceRow[], query: string): ServiceRow[] {
  const needed = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => { const text = `${serviceTitle(row)} ${row.domain}.${row.service} ${row.description ?? ''}`.toLowerCase(); return needed.every(word => text.includes(word)); });
}
/** The domains present, in order. */
export const serviceDomains = (rows: readonly ServiceRow[]) => [...new Set(rows.map(row => row.domain))];
