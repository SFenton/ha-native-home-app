import type { ServerConfig } from './config';
import { nativeHomeAbortError, readNativeHouseConfig, readNativeSnapshot, type NativeHomeSnapshot } from './native-home';
import { HttpError } from './store';
import { HaPublicationClient, command } from './ha-publication';
import { entityExists, entityStates, listEntities, type HaReads } from './ha-entities';

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
  close() { this.shutdown.abort(); this.publication.close(); }
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
