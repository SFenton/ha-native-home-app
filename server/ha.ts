import { nativeHomeEndpoints } from '../src/shared/native-endpoints';
import { entityIdSchema } from '../src/shared/schema';
import type { Action, DataSource, Json } from '../src/shared/types';
import type { ServerConfig } from './config';
import { CameraTransport, nativeCameraIds } from './camera';
import { nativeHomeAbortError, readNativeHouseConfig, readNativeSnapshot, type NativeHomeSnapshot } from './native-home';
import { HttpError } from './store';
import { ReadEndpointRegistry } from './read-endpoints';
import { HaPublicationClient } from './ha-publication';

export class HomeAssistantClient {
  private readonly base?: string;
  private readonly token?: string;
  private readonly websocketUrl?: string;
  private readonly shutdown = new AbortController();
  private connected = false;
  readonly cameras: CameraTransport;
  readonly readEndpoints: ReadEndpointRegistry;
  /** Publishes to the `fenton_home` integration with this client's credentials; the token never leaves the server. */
  readonly publication: HaPublicationClient;
  constructor(private readonly config: ServerConfig) {
    const direct = Boolean(config.haUrl && config.haToken);
    this.base = direct ? config.haUrl : (config.supervisorToken ? 'http://supervisor/core' : undefined);
    this.token = direct ? config.haToken : config.supervisorToken;
    this.websocketUrl = direct ? new URL('/api/websocket', config.haUrl).href.replace(/^http/, 'ws') : (config.supervisorToken ? 'ws://supervisor/core/websocket' : undefined);
    this.publication = new HaPublicationClient({ base: this.base, token: this.token, websocketUrl: this.websocketUrl });
    this.readEndpoints = new ReadEndpointRegistry({
      base: this.base, token: this.token, endpoints: config.readEndpoints,
      credentials: [config.haToken ?? '', config.supervisorToken ?? '', config.authToken ?? ''],
    });
    this.cameras = new CameraTransport({
      base: this.base, token: this.token, websocketUrl: this.websocketUrl,
      credentials: [config.haToken ?? '', config.supervisorToken ?? '', config.authToken ?? ''],
      resolveIds: async signal => {
        if (!this.websocketUrl || !this.token) throw new HttpError(503, 'Home Assistant is not configured');
        return nativeCameraIds(await readNativeHouseConfig(this.websocketUrl, this.token, signal));
      },
    });
  }
  /** The house configuration the `fenton_home` integration serves, read over this client's own connection. */
  async houseConfig(signal = AbortSignal.timeout(15000)): Promise<Record<string, unknown>> {
    if (!this.websocketUrl || !this.token) throw new HttpError(503, 'Home Assistant is not configured');
    return (await readNativeHouseConfig(this.websocketUrl, this.token, signal)).config;
  }
  get configured() { return Boolean(this.base && this.token); }
  get haConnected() { return this.connected; }
  private async request(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: unknown, signal = AbortSignal.timeout(8000), maxBytes = 1024 * 1024): Promise<unknown> {
    if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
    let response: Response;
    try {
      response = await fetch(`${this.base}${endpoint}`, {
        method, redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      this.connected = false;
      throw new HttpError(502, 'Home Assistant request failed or timed out');
    }
    if (!response.ok) {
      this.connected = false;
      throw new HttpError(502, `Home Assistant returned HTTP ${response.status}`);
    }
    // Read a bounded response, never return upstream errors, headers or credentials.
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, 'Home Assistant returned no response body');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new HttpError(502, `Home Assistant response exceeds ${maxBytes / (1024 * 1024)} MiB`); }
        chunks.push(value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      this.connected = true;
      return parsed;
    } catch (error) {
      this.connected = false;
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Home Assistant returned invalid JSON');
    } finally { reader.releaseLock(); }
  }
  async probe(): Promise<boolean> {
    if (!this.configured) return false;
    try { await this.request('/api/'); return true; }
    catch (error) {
      if (error instanceof HttpError) return false;
      throw error;
    }
  }
  async nativeHome(callerSignal?: AbortSignal): Promise<NativeHomeSnapshot> {
    if (!this.configured || !this.websocketUrl || !this.token) throw new HttpError(503, 'Home Assistant is not configured');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException('Native home snapshot timed out', 'TimeoutError')), 8000);
    const signal = AbortSignal.any([timeout.signal, this.shutdown.signal, ...(callerSignal ? [callerSignal] : [])]);
    try {
      const snapshot = await readNativeSnapshot(
        this.websocketUrl, this.token, signal, [this.config.haToken ?? '', this.config.supervisorToken ?? '', this.config.authToken ?? ''],
        () => this.request('/api/states', 'GET', undefined, signal, 4 * 1024 * 1024),
      );
      this.connected = true;
      return snapshot;
    } catch (error) {
      this.connected = false;
      if (signal.aborted) throw nativeHomeAbortError(signal);
      throw error;
    } finally { clearTimeout(timer); }
  }
  /**
   * The services Home Assistant offers, reduced to what the Studio's service picker shows: domain, service name, a one-line
   * description and each field's name, description, kind and range. A read only (`GET /api/services`); no credentials, long
   * examples or selectors beyond the field kind leave the server.
   */
  async services(signal?: AbortSignal): Promise<HaServiceDomain[]> {
    const raw = await this.request('/api/services', 'GET', undefined, signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : undefined, 4 * 1024 * 1024);
    return reduceServices(raw);
  }
  close() { this.shutdown.abort(); this.cameras.close(); this.readEndpoints.close(); this.publication.close(); }
  async wallpaper(): Promise<{ image: Buffer; type: string }> {
    if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
    let response: Response;
    try {
      response = await fetch(`${this.base}/local/images/house.webp`, {
        redirect: 'error', signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(8000)]),
        headers: { Authorization: `Bearer ${this.token}` },
      });
    } catch { throw new HttpError(502, 'Native wallpaper request failed or timed out'); }
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, `Native wallpaper returned HTTP ${response.status}`); }
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!type || !['image/webp', 'image/jpeg', 'image/png'].includes(type)) {
      await response.body?.cancel(); throw new HttpError(502, 'Native wallpaper must be a WebP, JPEG, or PNG image');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, 'Native wallpaper has no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new HttpError(502, 'Native wallpaper exceeds 2 MiB'); }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Native wallpaper could not be read');
    } finally { reader.releaseLock(); }
    const image = Buffer.concat(chunks);
    const valid = type === 'image/webp' ? image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP'
      : type === 'image/png' ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image[0] === 255 && image[1] === 216 && image[2] === 255;
    if (!valid || [this.token, this.config.authToken].some(secret => secret && image.includes(secret))) throw new HttpError(502, 'Invalid native wallpaper content');
    return { image, type };
  }
  async data(source: DataSource, query?: string, signal?: AbortSignal): Promise<{ data: Json; mode: 'sample' | 'live' }> {
    if (source.kind === 'endpoint') return this.readEndpoints.read(source.endpoint, query, signal);
    if (source.kind === 'static' || !this.configured) return { data: source.sample, mode: 'sample' };
    if (source.kind === 'ha-state') {
      const entityId = entityIdSchema.parse(source.entityId);
      const raw = await this.request(`/api/states/${encodeURIComponent(entityId)}`);
      if (!raw || typeof raw !== 'object' || !('state' in raw) || typeof raw.state !== 'string') throw new HttpError(502, 'Invalid Home Assistant state response');
      const attributes = 'attributes' in raw && raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
      return { data: {
        entityId, state: raw.state,
        name: 'friendly_name' in attributes && typeof attributes.friendly_name === 'string' ? attributes.friendly_name : entityId,
        unit: 'unit_of_measurement' in attributes && typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : '',
      }, mode: 'live' };
    }
    if (!source.endpoint || !Object.hasOwn(nativeHomeEndpoints, source.endpoint)) throw new HttpError(400, 'Unknown native-home endpoint name');
    if (source.endpoint === 'house-states') return { data: (await this.nativeHome()).states, mode: 'live' };
    if (source.endpoint === 'house-profile') {
      const user = (await this.nativeHome()).currentUser;
      if (!user) throw new HttpError(502, 'Home Assistant current user is unavailable; no profile was inferred');
      return { data: user, mode: 'live' };
    }
    const raw = await this.request(nativeHomeEndpoints[source.endpoint]);
    if (source.endpoint === 'push-config') {
      if (!raw || typeof raw !== 'object' || !('available' in raw) || typeof raw.available !== 'boolean' ||
          !('bundle_id' in raw) || (raw.bundle_id !== null && typeof raw.bundle_id !== 'string') ||
          !('critical_alerts' in raw) || (raw.critical_alerts !== null && typeof raw.critical_alerts !== 'boolean')) {
        throw new HttpError(502, 'Invalid native-home push configuration response');
      }
      return { data: { available: raw.available, bundleId: raw.bundle_id, criticalAlerts: raw.critical_alerts }, mode: 'live' };
    }
    throw new HttpError(501, 'This native-home endpoint has no installed response adapter');
  }
  async execute(action: Extract<Action, { type: 'service' }>, confirmed: boolean) {
    if (!this.config.enableLiveActions) return { mode: 'simulated' as const, executed: false };
    if (!confirmed) throw new HttpError(428, 'Live actions require confirmed: true in this request');
    if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured; no service was called');
    await this.request(`/api/services/${action.domain}/${action.service}`, 'POST', { ...action.data, entity_id: action.entityId });
    return { mode: 'live' as const, executed: true };
  }
}

/** One field of a Home Assistant service, as the picker shows it. */
export interface HaServiceField { name: string; description?: string; required?: boolean; kind: 'number' | 'boolean' | 'choice' | 'text'; unit?: string; min?: number; max?: number; step?: number; options?: string[] }
/** One service of a domain. */
export interface HaService { service: string; name?: string; description?: string; fields: Record<string, HaServiceField>; target: boolean }
/** A domain and its services. */
export interface HaServiceDomain { domain: string; services: HaService[] }

const clip = (value: unknown, max = 240) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Reduces Home Assistant's `/api/services` body: bounded, typed and free of everything the picker does not draw. */
export function reduceServices(raw: unknown): HaServiceDomain[] {
  if (!Array.isArray(raw)) return [];
  const domains: HaServiceDomain[] = [];
  for (const item of raw.slice(0, 500)) {
    const entry = record(item), domain = clip(entry.domain, 64);
    if (!domain || !/^[a-z][a-z0-9_]*$/.test(domain)) continue;
    const services: HaService[] = [];
    for (const [service, value] of Object.entries(record(entry.services)).slice(0, 500)) {
      if (!/^[a-z][a-z0-9_]*$/.test(service)) continue;
      const body = record(value), fields: Record<string, HaServiceField> = {};
      for (const [key, field] of Object.entries(record(body.fields)).slice(0, 64)) {
        if (!/^[a-z][a-zA-Z0-9_]*$/.test(key)) continue;
        const detail = record(field), selector = record(detail.selector), [kind = 'text'] = Object.keys(selector);
        const number = record(selector.number), select = record(selector.select);
        const options = Array.isArray(select.options) ? select.options.map(option => typeof option === 'string' ? option : clip(record(option).value, 80)).filter((option): option is string => Boolean(option)).slice(0, 64) : undefined;
        const finite = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : undefined;
        fields[key] = {
          name: clip(detail.name, 80) ?? key, description: clip(detail.description), required: detail.required === true ? true : undefined,
          kind: kind === 'number' ? 'number' : kind === 'boolean' ? 'boolean' : kind === 'select' && options?.length ? 'choice' : 'text',
          unit: clip(number.unit_of_measurement, 16), min: finite(number.min), max: finite(number.max), step: finite(number.step), options: kind === 'select' ? options : undefined,
        };
      }
      services.push({ service, name: clip(body.name, 120), description: clip(body.description), fields, target: body.target !== undefined });
    }
    domains.push({ domain, services });
  }
  return domains;
}
