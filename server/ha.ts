import type { ServerConfig } from './config';
import { houseConfigReferences, nativeHomeAbortError, readNativeHouseConfig, readNativeSnapshot, type NativeHomeSnapshot, type NativeHouseConfig } from './native-home';
import { LiveEntityHub } from './ha-live';
import { HttpError } from './store';
import { HaPublicationClient, command } from './ha-publication';
import { entityExists, entityStates, listEntities, type HaReads } from './ha-entities';
import { isNativeTimeZone } from '../src/shared/native-state';

/** The entities the picture proxy serves: `image.<name>` and `camera.<name>` only. */
export const PICTURE_ENTITY = /^(image|camera)\.[a-z0-9_]{1,120}$/;
/** The most bytes of one picture the proxy reads (16 MiB). */
export const MAX_PICTURE_BYTES = 16 * 1024 * 1024;
const MAX_PICTURES_IN_FLIGHT = 8;
/** The image type a body's first bytes show (PNG, JPEG, WebP or GIF), else `undefined`. The upstream `Content-Type` is never trusted. */
export function pictureType(body: Uint8Array): string | undefined {
  const at = (...bytes: number[]) => bytes.every((byte, index) => body[index] === byte);
  if (at(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0x47, 0x49, 0x46, 0x38) && (body[4] === 0x37 || body[4] === 0x39) && body[5] === 0x61) return 'image/gif';
  if (at(0x52, 0x49, 0x46, 0x46) && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) return 'image/webp';
  return undefined;
}

export class HomeAssistantClient {
  private readonly base?: string;
  private readonly token?: string;
  private readonly websocketUrl?: string;
  private readonly shutdown = new AbortController();
  private connected = false;
  /** Publishes to the `fenton_home` integration with this client's credentials; the token never leaves the server. */
  readonly publication: HaPublicationClient;
  constructor(private readonly config: ServerConfig) {
    const direct = Boolean(config.haUrl && config.haToken);
    this.base = direct ? config.haUrl : (config.supervisorToken ? 'http://supervisor/core' : undefined);
    this.token = direct ? config.haToken : config.supervisorToken;
    this.websocketUrl = direct ? new URL('/api/websocket', config.haUrl).href.replace(/^http/, 'ws') : (config.supervisorToken ? 'ws://supervisor/core/websocket' : undefined);
    this.publication = new HaPublicationClient({ base: this.base, token: this.token, websocketUrl: this.websocketUrl });
    if (this.websocketUrl && this.token) {
      this.live = new LiveEntityHub({ url: this.websocketUrl, token: this.token });
      const subscribe = this.live.subscribe.bind(this.live);
      // Observe existing listeners without opening a second connection or keeping an idle hub alive.
      this.live.subscribe = listener => subscribe(event => {
        if (event.type === 'status' && event.connected) this.timeZoneRead = undefined;
        listener(event);
      });
    }
  }
  /** The live entity stream (one websocket, opened on the first listener); undefined when Home Assistant is not configured. */
  readonly live?: LiveEntityHub;
  private references?: { at: number; ids: Promise<ReadonlySet<string>> };
  /**
   * The entities the house configuration names, cached for a minute. These are what the live stream sends besides the draft's
   * own entities. When the configuration cannot be read the set is empty and the stream carries the draft's entities alone.
   */
  liveReferences(): Promise<ReadonlySet<string>> {
    const now = Date.now();
    if (!this.references || now - this.references.at > 60_000) {
      const ids = this.houseConfig().then(config => houseConfigReferences({ config } as { config: NativeHouseConfig['config'] }) as ReadonlySet<string>).catch(() => new Set<string>() as ReadonlySet<string>);
      this.references = { at: now, ids };
    }
    return this.references.ids;
  }
  /** The house configuration the `fenton_home` integration serves, read over this client's own connection. */
  async houseConfig(signal = AbortSignal.timeout(15000)): Promise<Record<string, unknown>> {
    if (!this.websocketUrl || !this.token) throw new HttpError(503, 'Home Assistant is not configured');
    return (await readNativeHouseConfig(this.websocketUrl, this.token, signal)).config;
  }
  /** The read-only reads the style editor needs, over this client's credentials. A 404 reads as `undefined`. */
  private reads(signal: AbortSignal): HaReads {
    return {
      get: async path => {
        try { return await this.request(path, 'GET', undefined, signal, 4 * 1024 * 1024); }
        catch (error) {
          if (error instanceof HttpError && error.message.endsWith('HTTP 404')) { this.connected = true; return undefined; }
          throw error;
        }
      },
      translations: async domain => {
        const result = await command({ base: this.base, token: this.token, websocketUrl: this.websocketUrl }, 'translations',
          { language: 'en', category: 'entity_component', integration: [domain] }, signal, 'frontend/get_translations');
        const resources = typeof result === 'object' && result !== null ? (result as { resources?: unknown }).resources : undefined;
        return typeof resources === 'object' && resources !== null ? resources as Record<string, string> : {};
      },
    };
  }
  /** Read-only entity lookups for the style editor. Nothing is written to Home Assistant. */
  readonly entities = {
    list: (domain?: string, signal = AbortSignal.timeout(15000)) => listEntities(this.reads(signal), domain),
    states: (entityId: string, signal = AbortSignal.timeout(20000)) => entityStates(this.reads(signal), entityId),
    exists: (id: string, signal = AbortSignal.timeout(8000)) => entityExists(this.reads(signal), id),
  };
  get configured() { return Boolean(this.base && this.token); }
  get haConnected() { return this.connected; }
  private timeZoneRead?: Promise<string | undefined>;
  private houseTimeZone(signal: AbortSignal): Promise<string | undefined> {
    if (!this.timeZoneRead) {
      const read = this.request('/api/config', 'GET', undefined, signal).then(raw => {
        const zone = record(raw).time_zone;
        return isNativeTimeZone(zone) ? zone : undefined;
      });
      this.timeZoneRead = read;
      void read.catch(() => { if (this.timeZoneRead === read) this.timeZoneRead = undefined; });
    }
    return this.timeZoneRead;
  }
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
      this.timeZoneRead = undefined;
      throw new HttpError(502, 'Home Assistant request failed or timed out');
    }
    if (!response.ok) {
      this.connected = false;
      this.timeZoneRead = undefined;
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
      this.timeZoneRead = undefined;
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Home Assistant returned invalid JSON');
    } finally { reader.releaseLock(); }
  }
  /** Picture requests in flight, so one slow camera cannot hold every connection (`picture`). */
  private pictureInFlight = 0;
  /**
   * One picture of an `image` or `camera` entity through Home Assistant's own proxy route, with this client's Bearer token (which never leaves the
   * server). Redirects are refused, the request times out after 8 s, the body is capped at {@link MAX_PICTURE_BYTES}, and the first bytes must be a
   * PNG, JPEG, WebP or GIF. Upstream text and headers never reach the caller: every failure is a plain 404 or 502.
   */
  async picture(entityId: string, callerSignal?: AbortSignal): Promise<{ contentType: string; body: Buffer }> {
    const match = PICTURE_ENTITY.exec(entityId);
    if (!match) throw new HttpError(404, 'Unknown picture');
    if (!this.configured) throw new HttpError(503, 'Home Assistant is not configured');
    if (this.pictureInFlight >= MAX_PICTURES_IN_FLIGHT) throw new HttpError(429, 'Too many pictures are loading');
    this.pictureInFlight += 1;
    try {
      const route = match[1] === 'image' ? 'image_proxy' : 'camera_proxy';
      const signal = AbortSignal.any([AbortSignal.timeout(8000), this.shutdown.signal, ...(callerSignal ? [callerSignal] : [])]);
      let response: Response;
      try {
        response = await fetch(`${this.base}/api/${route}/${entityId}`, { method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${this.token}` } });
      } catch { throw new HttpError(502, 'The picture could not be loaded'); }
      if (response.status === 404) { await response.body?.cancel(); throw new HttpError(404, 'Unknown picture'); }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new HttpError(502, 'The picture could not be loaded'); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_PICTURE_BYTES) { await reader.cancel(); throw new HttpError(502, 'The picture is too large'); }
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, 'The picture could not be loaded');
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks);
      const contentType = pictureType(body);
      if (!contentType) throw new HttpError(502, 'The picture is not an image');
      return { contentType, body };
    } finally { this.pictureInFlight -= 1; }
  }
  async probe(): Promise<boolean> {
    if (!this.configured) return false;
    try { await this.request('/api/'); return true; }
    catch (error) {
      if (error instanceof HttpError) return false;
      throw error;
    }
  }
  async nativeHome(callerSignal?: AbortSignal, draftTodoLists: ReadonlySet<string> = new Set()): Promise<NativeHomeSnapshot> {
    if (!this.configured || !this.websocketUrl || !this.token) throw new HttpError(503, 'Home Assistant is not configured');
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException('Native home snapshot timed out', 'TimeoutError')), 8000);
    const signal = AbortSignal.any([timeout.signal, this.shutdown.signal, ...(callerSignal ? [callerSignal] : [])]);
    try {
      const snapshot = await readNativeSnapshot(
        this.websocketUrl, this.token, signal, [this.config.haToken ?? '', this.config.supervisorToken ?? '', this.config.authToken ?? ''],
        () => this.request('/api/states', 'GET', undefined, signal, 4 * 1024 * 1024), draftTodoLists,
        () => this.houseTimeZone(signal),
      );
      this.connected = true;
      return snapshot;
    } catch (error) {
      this.connected = false;
      this.timeZoneRead = undefined;
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
  close() { this.shutdown.abort(); this.live?.stop(); this.publication.close(); }
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
