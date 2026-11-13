import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod/v4';
import { identifierSchema } from '../src/shared/schema';
import type { Json, Primitive } from '../src/shared/types';
import { HttpError } from './store';

const maxBytes = 1024 * 1024;
const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const sensitiveKey = /token|secret|password|credential|authorization|apikey|privatekey|cookie|webhook|pushurl/;
const sensitive = (key: string) => sensitiveKey.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
const safePath = z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
  .refine(value => value.split('.').length <= 32 && !value.split('.').some(key => reservedKeys.has(key) || sensitive(key)));
const outputName = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)
  .refine(value => !reservedKeys.has(value) && !sensitive(value));
const projection = z.object({
  shape: z.enum(['object', 'array']),
  path: safePath.optional(),
  fields: z.record(outputName, safePath).refine(fields => Object.keys(fields).length >= 1 && Object.keys(fields).length <= 100),
}).strict();
const common = {
  id: identifierSchema,
  name: z.string().trim().min(1).max(240),
  queryParam: z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .refine(value => !reservedKeys.has(value) && !sensitive(value)),
  response: projection,
};
const definitionSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, queryParam: common.queryParam.optional(), kind: z.literal('home-assistant'), path: z.string().max(2048) }).strict(),
  z.object({
    ...common, queryParam: common.queryParam.optional(), kind: z.literal('http'), url: z.string().max(2048),
    bearerTokenEnv: z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/).optional(),
  }).strict(),
]);
type Definition = z.infer<typeof definitionSchema>;
export type RegisteredReadEndpoint = Definition & { bearerToken?: string };
export interface ReadEndpointConnection {
  base?: string;
  token?: string;
  credentials: string[];
  endpoints?: readonly RegisteredReadEndpoint[];
}

function variants(secret: string): string[] {
  const bytes = Buffer.from(secret);
  return [
    secret, encodeURIComponent(secret), encodeURI(secret),
    new URLSearchParams({ value: secret }).toString().slice(6),
    bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('hex'), bytes.toString('hex').toUpperCase(),
    [...bytes].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''),
    [...bytes].map(byte => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join(''),
    JSON.stringify(secret).slice(1, -1),
    secret.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  ];
}

function secretPatterns(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter(Boolean).flatMap(variants))];
}
function containsSecret(value: string, patterns: readonly string[]): boolean {
  const candidates = new Set([value]);
  let decoded = value;
  for (let count = 0; count < 3; count++) {
    try { decoded = decodeURIComponent(decoded.replace(/\+/g, ' ')); }
    catch { break; }
    candidates.add(decoded);
  }
  return patterns.some(pattern => [...candidates].some(candidate => candidate.includes(pattern)));
}

function validHaPath(value: string): boolean {
  if (!/^\/api\/[A-Za-z0-9_~./-]+$/.test(value) || value.includes('//')) return false;
  const segments = value.slice(5).split('/');
  return !segments.some(segment => segment === '.' || segment === '..' ||
    /^(?:auth|services|config|websocket|streams?|stream_.+|camera_proxy(?:_stream)?|hls|hassio|webhooks?)$/i.test(segment));
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:\/\//.test(value) && ['http:', 'https:'].includes(url.protocol) &&
      !url.username && !url.password && !value.includes('?') && !value.includes('#') &&
      !/[\s\\\u0000-\u001f]/.test(value);
  } catch { return false; }
}

export function parseReadEndpoints(raw: unknown, env: NodeJS.ProcessEnv, credentials: string[]): RegisteredReadEndpoint[] {
  const parsed = z.array(definitionSchema).max(64).safeParse(raw);
  if (!parsed.success) throw new Error('Invalid read endpoint definitions; startup refused');
  const ids = new Set<string>();
  const endpoints = parsed.data.map(definition => {
    if (ids.has(definition.id)) throw new Error('Duplicate read endpoint ID; startup refused');
    ids.add(definition.id);
    if (definition.kind === 'home-assistant' ? !validHaPath(definition.path) : !validHttpUrl(definition.url)) {
      throw new Error('Invalid read endpoint location; startup refused');
    }
    if (definition.kind !== 'http' || !definition.bearerTokenEnv) return definition;
    if (/^(?:STUDIO_|HA_|HASS_|HASSIO_|HOME_ASSISTANT_|SUPERVISOR_|AUTH_TOKEN$|AUTHORIZATION$)/i.test(definition.bearerTokenEnv)) {
      throw new Error('Reserved read endpoint credential reference; startup refused');
    }
    const token = env[definition.bearerTokenEnv];
    if (!token || !/^[\u0021-\u007e]{1,16384}$/.test(token) || containsSecret(token, secretPatterns(credentials))) {
      throw new Error('Invalid read endpoint credential; startup refused');
    }
    return { ...definition, bearerToken: token };
  });
  const secrets = [...credentials, ...endpoints.map(endpoint => 'bearerToken' in endpoint ? endpoint.bearerToken ?? '' : '')];
  if (parsed.data.some(definition => containsSecret(JSON.stringify(definition), secretPatterns(secrets)))) {
    throw new Error('Read endpoint definitions contain server credentials; startup refused');
  }
  return endpoints;
}

export function loadReadEndpoints(file: string | undefined, env: NodeJS.ProcessEnv, credentials: string[]): RegisteredReadEndpoint[] {
  if (file === undefined || file === '') return [];
  let descriptor: number | undefined;
  try {
    if (!isAbsolute(file)) throw new Error('Absolute path required');
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Invalid endpoint file');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let bytes = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
      if (bytes > 256 * 1024) throw new Error('Endpoint file too large');
    }
    return parseReadEndpoints(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))), env, credentials);
  } catch {
    throw new Error('Cannot load STUDIO_READ_ENDPOINTS_FILE; check the file and endpoint definitions; startup refused');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function select(value: unknown, path: string): unknown {
  let selected = value;
  for (const key of path.split('.')) {
    if ((!object(selected) && !Array.isArray(selected)) || !Object.hasOwn(selected, key)) {
      throw new HttpError(502, 'Read endpoint response is missing a declared field');
    }
    if (Array.isArray(selected) && !/^(?:0|[1-9][0-9]*)$/.test(key)) throw new HttpError(502, 'Read endpoint response is missing a declared field');
    selected = object(selected) ? selected[key] : selected[Number(key)];
  }
  return selected;
}
function project(raw: unknown, response: Definition['response'], secrets: string[]): Json {
  const selected = response.path ? select(raw, response.path) : raw;
  let projectedBytes = response.shape === 'array' ? 2 : 0;
  let records = 0;
  const record = (value: unknown): Record<string, Primitive> => {
    if (!object(value) || Object.keys(value).length > 100) throw new HttpError(502, 'Read endpoint response must contain bounded objects');
    const result: Record<string, Primitive> = {};
    for (const [name, path] of Object.entries(response.fields)) {
      const mapped = select(value, path);
      if (mapped !== null && typeof mapped !== 'string' && typeof mapped !== 'boolean' && !(typeof mapped === 'number' && Number.isFinite(mapped))) {
        throw new HttpError(502, 'Read endpoint mapped values must be primitives');
      }
      if (typeof mapped === 'string' && mapped.length > 16384) throw new HttpError(502, 'Read endpoint mapped string exceeds the size limit');
      if (sensitive(name) || containsSecret(name, secrets) || (typeof mapped === 'string' && containsSecret(mapped, secrets))) {
        throw new HttpError(502, 'Read endpoint response contains protected content');
      }
      result[name] = mapped;
    }
    const serialized = JSON.stringify(result);
    projectedBytes += Buffer.byteLength(serialized);
    if (response.shape === 'array' && records > 0) projectedBytes++;
    records++;
    if (projectedBytes > maxBytes) throw new HttpError(502, 'Read endpoint projected response exceeds 1 MiB');
    if (containsSecret(serialized, secrets)) throw new HttpError(502, 'Read endpoint response contains protected content');
    return result;
  };
  if (response.shape === 'object') return record(selected);
  if (!Array.isArray(selected) || selected.length > 100) throw new HttpError(502, 'Read endpoint response must contain at most 100 records');
  return selected.map(record);
}

export function readEndpointQuery(query: Record<string, unknown>): string | undefined {
  const parsed = z.object({ q: z.string().max(500).optional() }).strict().safeParse(query);
  if (!parsed.success) throw new HttpError(400, 'Reads accept only one optional q string of at most 500 characters');
  return parsed.data.q;
}

export class ReadEndpointRegistry {
  private readonly shutdown = new AbortController();
  private readonly endpoints: ReadonlyMap<string, RegisteredReadEndpoint>;
  private readonly secrets: string[];
  constructor(private readonly connection: ReadEndpointConnection) {
    this.endpoints = new Map((connection.endpoints ?? []).map(endpoint => [endpoint.id, endpoint]));
    this.secrets = secretPatterns([...connection.credentials, ...[...this.endpoints.values()].map(endpoint => endpoint.bearerToken ?? '')]);
  }
  metadata() {
    return [...this.endpoints.values()].map(({ id, name, kind, queryParam }) => ({ id, name, kind, searchable: Boolean(queryParam) }));
  }
  close() { this.shutdown.abort(); }
  async read(id: string | undefined, query?: string, callerSignal?: AbortSignal): Promise<{ data: Json; mode: 'live' }> {
    if (!this.endpoints.size) throw new HttpError(503, 'No read endpoints are configured');
    const endpoint = id ? this.endpoints.get(id) : undefined;
    if (!endpoint) throw new HttpError(404, 'Unknown registered read endpoint');
    if (query !== undefined && (!endpoint.queryParam || query.length > 500)) throw new HttpError(400, 'This read endpoint does not accept the requested search query');
    if (query !== undefined && containsSecret(query, this.secrets)) throw new HttpError(400, 'Read endpoint query contains protected content');
    if (endpoint.kind === 'home-assistant' && (!this.connection.base || !this.connection.token)) throw new HttpError(503, 'Home Assistant is not configured');
    const url = new URL(endpoint.kind === 'http' ? endpoint.url : `${this.connection.base}${endpoint.path}`);
    if (query !== undefined && endpoint.queryParam) url.searchParams.set(endpoint.queryParam, query);
    const token = endpoint.kind === 'http' ? endpoint.bearerToken : this.connection.token;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 8000);
    const signal = AbortSignal.any([timeout.signal, this.shutdown.signal, ...(callerSignal ? [callerSignal] : [])]);
    try {
      signal.throwIfAborted();
      const upstream = await fetch(url, {
        method: 'GET', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw new HttpError(502, 'Read endpoint returned an unsuccessful response');
      }
      const contentType = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!contentType || !/^application\/(?:[a-z0-9.+-]+\+)?json$/.test(contentType)) {
        await upstream.body?.cancel();
        throw new HttpError(502, 'Read endpoint must return JSON');
      }
      const reader = upstream.body?.getReader();
      if (!reader) throw new HttpError(502, 'Read endpoint returned no response body');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw new HttpError(502, 'Read endpoint response exceeds 1 MiB');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      signal.throwIfAborted();
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      return { data: project(raw, endpoint.response, this.secrets), mode: 'live' };
    } catch (error) {
      if (signal.aborted) {
        if (timeout.signal.aborted) throw new HttpError(504, 'Read endpoint request timed out');
        throw new HttpError(503, 'Read endpoint request cancelled');
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Read endpoint request failed or returned invalid JSON');
    } finally { clearTimeout(timer); }
  }
}
