import http from 'node:http';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { loadConfig, type ServerConfig } from '../server/config';
import { HomeAssistantClient } from '../server/ha';
import { parseReadEndpoints, ReadEndpointRegistry } from '../server/read-endpoints';
import { StudioStore } from '../server/store';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';

const authToken = 'synthetic-studio-authoring-credential';
const haToken = 'synthetic-ha-backend-credential';
const externalToken = 'synthetic-external-credential-+/%';
const headers = { Authorization: `Bearer ${authToken}` };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'studio-read-endpoints-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function fixtureServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const objectResponse = { shape: 'object', fields: { title: 'details.title', available: 'available', amount: 'amount', note: 'note' } };
function external(url: string, extra: Record<string, unknown> = {}) {
  return { id: 'catalog', name: 'External catalog', kind: 'http', url, response: objectResponse, ...extra };
}
function ha(extra: Record<string, unknown> = {}) {
  return { id: 'entity', name: 'Entity read', kind: 'home-assistant', path: '/api/states/sensor.synthetic', response: { shape: 'object', fields: { value: 'state', title: 'attributes.friendly_name' } }, ...extra };
}
function registry(definitions: unknown, base?: string) {
  const endpoints = parseReadEndpoints(definitions, { CATALOG_BEARER: externalToken }, [authToken, haToken]);
  const instance = new ReadEndpointRegistry({ endpoints, base, token: haToken, credentials: [authToken, haToken] });
  cleanup.push(async () => instance.close());
  return instance;
}
async function app(definitions: unknown, extra: Partial<ServerConfig> = {}) {
  const dir = await directory();
  const store = await StudioStore.open(dir);
  cleanup.push(() => store.close());
  const config: ServerConfig = {
    production: false, port: 0, host: '127.0.0.1', dataDir: dir, enableLiveActions: false, authToken,
    readEndpoints: parseReadEndpoints(definitions, { CATALOG_BEARER: externalToken }, [authToken, haToken]), ...extra,
  };
  const application = createApp(store, config);
  application.app.use(application.errorHandler);
  const fixture = await fixtureServer(application.app);
  cleanup.push(async () => application.close());
  const request = (route: string, init: RequestInit = {}) => fetch(`${fixture.url}${route}`, { ...init, headers: { ...headers, ...init.headers } });
  const save = async (endpoint = 'catalog') => {
    const draft = store.getDraft();
    const document = validateDocument({
      ...draft.document,
      variables: { ...draft.document.variables, lookup: '' },
      dataSources: [
        ...draft.document.dataSources.filter(source => source.id !== 'saved-search'),
        { id: 'saved-search', name: 'Saved search', kind: 'endpoint', endpoint, queryVariable: 'lookup', refreshSeconds: 30, sample: [] },
      ],
    });
    await store.save(document, draft.revision);
  };
  return { ...fixture, application, request, store, save, dir };
}
function payload() { return { details: { title: 'Kitchen' }, available: false, amount: 0, note: null, ignored: { private: 'discarded' } }; }

describe('administrator read endpoint configuration', () => {
  it('loads a bounded explicit file once, leaves omission empty, and refuses unreadable or malformed files', async () => {
    const dir = await directory();
    const file = path.join(dir, 'registered.json');
    await writeFile(file, JSON.stringify([external('http://127.0.0.1:12345/read')]));
    const config = loadConfig({ STUDIO_READ_ENDPOINTS_FILE: file, STUDIO_AUTH_TOKEN: authToken });
    expect(config.readEndpoints?.map(endpoint => endpoint.id)).toEqual(['catalog']);
    await writeFile(file, '[]');
    expect(config.readEndpoints).toHaveLength(1);
    expect(loadConfig({}).readEndpoints).toEqual([]);
    for (const value of ['not-json', '{}', ' '.repeat(256 * 1024 + 1)]) {
      await writeFile(file, value);
      expect(() => loadConfig({ STUDIO_READ_ENDPOINTS_FILE: file })).toThrow('Cannot load STUDIO_READ_ENDPOINTS_FILE');
    }
    for (const location of [dir, path.join(dir, 'missing.json'), 'relative.json']) {
      expect(() => loadConfig({ STUDIO_READ_ENDPOINTS_FILE: location })).toThrow('Cannot load STUDIO_READ_ENDPOINTS_FILE');
    }
    const linked = path.join(dir, 'linked.json');
    await symlink(file, linked);
    expect(() => loadConfig({ STUDIO_READ_ENDPOINTS_FILE: linked })).toThrow('Cannot load STUDIO_READ_ENDPOINTS_FILE');
    await writeFile(file, Buffer.from([91, 34, 255, 34, 93]));
    expect(() => loadConfig({ STUDIO_READ_ENDPOINTS_FILE: file })).toThrow('Cannot load STUDIO_READ_ENDPOINTS_FILE');
  });

  it.each([
    'https://user:embedded@host.test/data', 'https://host.test/data?key=value', 'https://host.test/data#fragment',
    'https://host.test/data?', 'https://host.test/data#', 'file:///tmp/private', '//host.test/data', 'http:\\\\host.test/data',
  ])('refuses credential-bearing or nonfixed HTTP location %s', url => {
    expect(() => registry([external(url)])).toThrow('Invalid read endpoint location');
  });

  it.each([
    'http://host.test/api/states', '//host.test/api/states', '/api/../states', '/api/states/./sensor.demo',
    '/api/states/%2e%2e/config', '/api/states%2fsensor.demo', '/api/states%252fsensor.demo', '/api/states?x=1',
    '/api/states#fragment', '/api/states\\sensor.demo', '/api//states', '/api/auth/token', '/api/services/light/turn_on',
    '/api/config', '/api/websocket', '/api/stream', '/api/camera_proxy_stream/camera.demo', '/api/hassio/ingress',
    '/api/hls/private/index.m3u8', '/api/stream/hls',
  ])('refuses unsafe or protected HA path %s', readPath => {
    expect(() => registry([ha({ path: readPath })])).toThrow('Invalid read endpoint location');
  });

  it.each([
    external('https://host.test/data', { id: '../unsafe' }),
    external('https://host.test/data', { method: 'POST' }),
    external('https://host.test/data', { headers: { Authorization: 'embedded' } }),
    external('https://host.test/data', { token: 'embedded' }),
    external('https://host.test/data', { queryParam: 'access_token' }),
    external('https://host.test/data', { response: { shape: 'object', fields: { accessToken: 'value' } } }),
    external('https://host.test/data', { response: { shape: 'object', fields: { safe: 'attributes.password' } } }),
    external('https://host.test/data', { response: { shape: 'object', fields: { safe: '__proto__.value' } } }),
    external('https://host.test/data', { response: { shape: 'object', fields: {} } }),
    external('https://host.test/data', { response: { shape: 'object', fields: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, 'value'])) } }),
    external('https://host.test/data', { response: { shape: 'array', path: 'items[0]', fields: { safe: 'value' } } }),
    ha({ bearerTokenEnv: 'CATALOG_BEARER' }),
  ])('rejects malformed, executable, embedded-auth or unsafe projection definitions %#', definition => {
    expect(() => registry([definition])).toThrow('Invalid read endpoint definitions');
  });

  it('rejects duplicate IDs, oversized registries and absent or reserved external credentials without leaking values', () => {
    expect(() => registry([ha(), ha()])).toThrow('Duplicate');
    expect(() => registry(Array.from({ length: 65 }, (_, index) => external('https://host.test/data', { id: `id${index}` })))).toThrow('Invalid');
    for (const name of ['HA_TOKEN', 'STUDIO_AUTH_TOKEN', 'SUPERVISOR_TOKEN', 'HASS_TOKEN', 'HOME_ASSISTANT_TOKEN', 'AUTH_TOKEN']) {
      expect(() => parseReadEndpoints([external('https://host.test/data', { bearerTokenEnv: name })], { [name]: haToken }, [haToken])).toThrow('Reserved');
    }
    for (const value of [undefined, '', haToken, authToken, encodeURIComponent(haToken), Buffer.from(authToken).toString('base64'), 'bad\nheader', 'non-ascii-\u2603']) {
      expect(() => parseReadEndpoints([external('https://host.test/data', { bearerTokenEnv: 'CATALOG_BEARER' })], { CATALOG_BEARER: value }, [haToken, authToken])).toThrow('Invalid read endpoint credential');
    }
    expect(() => registry([external(`https://host.test/${haToken}`)])).toThrow('contain server credentials');
    expect(() => registry([external('https://host.test/data', { name: externalToken, bearerTokenEnv: 'CATALOG_BEARER' })])).toThrow('contain server credentials');
  });

  it('allows an external-only registry in loopback local development, but refuses a reachable bind', async () => {
    const dir = await directory();
    const store = await StudioStore.open(dir);
    cleanup.push(() => store.close());
    const readEndpoints = parseReadEndpoints([external('https://host.test/data')], {}, []);
    const base = { production: false, port: 0, dataDir: dir, enableLiveActions: false, readEndpoints };
    expect(() => createApp(store, { ...base, host: '127.0.0.1' })).not.toThrow();
    expect(() => createApp(store, { ...base, host: '0.0.0.0' })).toThrow('loopback HOST');
    expect(() => createApp(store, { ...base, host: '0.0.0.0', production: true })).toThrow('require STUDIO_AUTH_TOKEN');
  });
});

describe('bounded registered reads', () => {
  it('projects declared primitive object fields without HA, forwarding only the dedicated external bearer', async () => {
    const requests: { method?: string; url?: string; authorization?: string }[] = [];
    const upstream = await fixtureServer((req, res) => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Private', 'not-forwarded');
      res.end(JSON.stringify(payload()));
    });
    const instance = registry([external(`${upstream.url}/object`, { bearerTokenEnv: 'CATALOG_BEARER' })]);
    expect(await instance.read('catalog')).toEqual({ data: { title: 'Kitchen', available: false, amount: 0, note: null }, mode: 'live' });
    expect(requests).toEqual([{ method: 'GET', url: '/object', authorization: `Bearer ${externalToken}` }]);
  });

  it('uses the configured HA origin and HA token for a fixed registered entity path', async () => {
    const requests: { url?: string; authorization?: string }[] = [];
    const upstream = await fixtureServer((req, res) => {
      requests.push({ url: req.url, authorization: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ state: '0', attributes: { friendly_name: 'Synthetic entity' }, private: 'discarded' }));
    });
    expect(await registry([ha({ queryParam: 'filter' })], upstream.url).read('entity', 'tea & coffee')).toEqual({ data: { value: '0', title: 'Synthetic entity' }, mode: 'live' });
    expect(requests).toEqual([{ url: '/api/states/sensor.synthetic?filter=tea+%26+coffee', authorization: `Bearer ${haToken}` }]);
  });

  it('projects arrays from a declared path and URL-encodes exactly one declared search parameter', async () => {
    const urls: string[] = [];
    const upstream = await fixtureServer((req, res) => {
      urls.push(req.url!);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results: [{ value: 'one', ignored: {} }, { value: 'two' }] }));
    });
    const instance = registry([external(`${upstream.url}/search`, { queryParam: 'term', response: { shape: 'array', path: 'results', fields: { title: 'value' } } })]);
    const query = 'tea & coffee/+/日本?url=https://other.invalid';
    expect(await instance.read('catalog', query)).toEqual({ data: [{ title: 'one' }, { title: 'two' }], mode: 'live' });
    const parsed = new URL(urls[0], upstream.url);
    expect([...parsed.searchParams]).toEqual([['term', query]]);
    expect(parsed.pathname).toBe('/search');
    await instance.read('catalog', '');
    expect(urls[1]).toBe('/search?term=');
  });

  it('accepts empty and exactly 100-record arrays without truncating them', async () => {
    let rows: { value: number }[] = [];
    const upstream = await fixtureServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rows));
    });
    const instance = registry([external(upstream.url, { response: { shape: 'array', fields: { value: 'value' } } })]);
    expect((await instance.read('catalog')).data).toEqual([]);
    rows = Array.from({ length: 100 }, (_, value) => ({ value }));
    expect((await instance.read('catalog')).data).toEqual(rows);
  });

  it('bounds projected output even when many fields map to the same input value', async () => {
    const upstream = await fixtureServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(Array.from({ length: 3 }, () => ({ value: 'x'.repeat(4096) }))));
    });
    const instance = registry([external(upstream.url, {
      response: { shape: 'array', fields: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, 'value'])) },
    })]);
    await expect(instance.read('catalog')).rejects.toThrow('projected response exceeds 1 MiB');
  });

  it('never forwards HA or Studio authorization to unauthenticated external registrations', async () => {
    const authorizations: (string | undefined)[] = [];
    const upstream = await fixtureServer((req, res) => {
      authorizations.push(req.headers.authorization);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload()));
    });
    await registry([external(upstream.url)], 'http://ha.invalid').read('catalog');
    expect(authorizations).toEqual([undefined]);
  });

  it('rejects HA and authoring credential echoes or queries before credentials can leave the server', async () => {
    let value = haToken;
    let count = 0;
    const upstream = await fixtureServer((_req, res) => {
      count++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...payload(), details: { title: value } }));
    });
    const instance = registry([external(upstream.url, { queryParam: 'term' })]);
    for (const token of [haToken, authToken]) {
      value = token;
      await expect(instance.read('catalog')).rejects.toThrow('protected content');
      await expect(instance.read('catalog', token)).rejects.toThrow('query contains protected content');
    }
    expect(count).toBe(2);
  });

  it.each([
    { response: { shape: 'array', fields: { title: 'value' } }, raw: Array.from({ length: 101 }, () => ({ value: 'x' })), error: 'at most 100 records' },
    { response: { shape: 'array', fields: { title: 'value' } }, raw: {}, error: 'at most 100 records' },
    { response: { shape: 'object', fields: { title: 'value' } }, raw: { value: {} }, error: 'must be primitives' },
    { response: { shape: 'object', fields: { title: 'value' } }, raw: {}, error: 'missing a declared field' },
    { response: { shape: 'object', fields: { title: 'value' } }, raw: { value: 'x'.repeat(16385) }, error: 'size limit' },
    { response: { shape: 'object', fields: { title: 'value' } }, raw: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, 1])), error: 'bounded objects' },
    { response: { shape: 'object', fields: { title: 'constructor.name' } }, raw: {}, error: 'Invalid read endpoint definitions' },
  ])('rejects malformed, missing or nonprimitive projections %#', async ({ response, raw, error }) => {
    const upstream = await fixtureServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(raw)); });
    await expect(async () => registry([external(upstream.url, { response })]).read('catalog')).rejects.toThrow(error);
  });

  it.each([
    (value: string) => value, (value: string) => encodeURIComponent(value),
    (value: string) => encodeURIComponent(encodeURIComponent(value)),
    (value: string) => new URLSearchParams({ value }).toString().slice(6),
    (value: string) => Buffer.from(value).toString('base64'),
    (value: string) => Buffer.from(value).toString('base64url'),
    (value: string) => Buffer.from(value).toString('hex'),
    (value: string) => Buffer.from(value).toString('hex').toUpperCase(),
    (value: string) => [...Buffer.from(value)].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join(''),
  ])('rejects configured credential echoes in ordinary encoded form %#', async encode => {
    const upstream = await fixtureServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...payload(), details: { title: `echo:${encode(externalToken)}` } }));
    });
    const instance = registry([external(upstream.url, { bearerTokenEnv: 'CATALOG_BEARER' })]);
    await expect(instance.read('catalog')).rejects.toThrow('contains protected content');
  });

  it.each(['redirect', 'oversize', 'error', 'invalid-json', 'invalid-utf8', 'wrong-type'])('rejects unsafe upstream %s without exposing its body, URL or headers', async mode => {
    const destinationRequests: string[] = [];
    const destination = await fixtureServer((req, res) => { destinationRequests.push(req.url!); res.end(); });
    const upstream = await fixtureServer((_req, res) => {
      res.setHeader('X-Private', externalToken);
      res.setHeader('Content-Type', mode === 'wrong-type' ? 'text/html' : 'application/json');
      if (mode === 'redirect') res.writeHead(302, { Location: `${destination.url}/${haToken}` }).end(externalToken);
      else if (mode === 'oversize') res.end(JSON.stringify({ details: { title: 'x'.repeat(1024 * 1024) } }));
      else if (mode === 'error') res.writeHead(500).end(externalToken);
      else if (mode === 'invalid-utf8') res.end(Buffer.from([123, 34, 100, 34, 58, 34, 255, 34, 125]));
      else res.end(mode === 'wrong-type' ? haToken : `{${externalToken}`);
    });
    const fixture = await app([external(upstream.url)]);
    await fixture.save();
    const response = await fixture.request('/api/data/saved-search');
    expect(response.status).toBe(502);
    const body = await response.text();
    for (const privateValue of [externalToken, haToken, upstream.url, destination.url]) expect(body.includes(privateValue)).toBe(false);
    expect(response.headers.get('x-private')).toBeNull();
    expect(destinationRequests).toEqual([]);
  });

  it('fails explicitly for empty registries, unknown registrations, unsupported searches and unconfigured HA', async () => {
    await expect(registry([]).read('missing')).rejects.toThrow('No read endpoints');
    const instance = registry([ha(), external('https://host.test/data')]);
    await expect(instance.read('missing')).rejects.toThrow('Unknown registered');
    await expect(instance.read('catalog', 'search')).rejects.toThrow('does not accept');
    await expect(instance.read('entity')).rejects.toThrow('Home Assistant is not configured');
  });
});

describe('authenticated saved-source read API', () => {
  it('lists only safe metadata and resolves only persisted source IDs, not browser-supplied endpoint overrides', async () => {
    const paths: string[] = [];
    const upstream = await fixtureServer((req, res) => {
      paths.push(req.url!);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload()));
    });
    const fixture = await app([external(`${upstream.url}/registered`, { queryParam: 'term', bearerTokenEnv: 'CATALOG_BEARER' })]);
    await fixture.save();
    expect(await (await fixture.request('/api/read-endpoints')).json()).toEqual([{ id: 'catalog', name: 'External catalog', kind: 'http', searchable: true }]);
    expect((await fetch(`${fixture.url}/api/read-endpoints`)).status).toBe(401);
    expect((await fetch(`${fixture.url}/api/data/saved-search`)).status).toBe(401);
    const draft = fixture.store.getDraft();
    draft.document.dataSources.find(source => source.id === 'saved-search')!.endpoint = 'browser-only';
    const response = await fixture.request('/api/data/saved-search?q=milk%26bread');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { title: 'Kitchen', available: false, amount: 0, note: null }, mode: 'live' });
    expect(paths).toEqual(['/registered?term=milk%26bread']);
    const maximumQuery = 'x'.repeat(500);
    expect((await fixture.request(`/api/data/saved-search?q=${maximumQuery}`)).status).toBe(200);
    expect(new URL(paths[1], fixture.url).searchParams.get('term')).toBe(maximumQuery);
    expect((await fixture.request('/api/data/catalog')).status).toBe(404);
    for (const query of ['q=a&q=b', 'url=https://other.invalid', 'q[0]=x', 'endpoint=browser-only', `q=${'x'.repeat(501)}`]) {
      expect((await fixture.request(`/api/data/saved-search?${query}`)).status).toBe(400);
    }
    expect((await fixture.request('/api/data/saved-search', { method: 'HEAD' })).status).toBe(405);
    expect((await fixture.request('/api/data/saved-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
    expect((await fixture.request('/api/read-endpoints?q=a')).status).toBe(400);
    expect((await fixture.request('/api/read-endpoints', { method: 'HEAD' })).status).toBe(405);
    expect(paths).toHaveLength(2);
    await fixture.save('missing');
    expect((await fixture.request('/api/data/saved-search')).status).toBe(404);
  });

  it('uses the existing author session and verified Ingress without trusting spoofed Ingress headers', async () => {
    const fixture = await app([external('https://host.test/data')], { authToken: undefined, ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/synthetic' } });
    const ingress = { 'X-Ingress-Path': '/api/hassio_ingress/synthetic', 'X-Remote-User-Id': 'synthetic-user', 'X-Remote-User-Groups': 'system-admin' };
    expect((await fetch(`${fixture.url}/api/read-endpoints`, { headers: ingress })).status).toBe(200);
    expect((await fetch(`${fixture.url}/api/read-endpoints`, { headers: { ...ingress, 'X-Ingress-Path': '/api/hassio_ingress/spoofed' } })).status).toBe(401);
    const session = await app([]);
    const signedIn = await fetch(`${session.url}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: authToken }) });
    const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
    expect((await fetch(`${session.url}/api/read-endpoints`, { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('preserves static offline sample behavior while endpoint sources never fall back to samples', async () => {
    const fixture = await app([]);
    const initial = fixture.store.getDraft();
    const sample = initial.document.dataSources.find(source => source.kind === 'static')!;
    expect(await (await fixture.request(`/api/data/${sample.id}`)).json()).toEqual({ data: sample.sample, mode: 'sample' });
    await fixture.save();
    const response = await fixture.request('/api/data/saved-search');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'No read endpoints are configured' });
  });
});

describe('read deadline and cancellation', () => {
  function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
  }
  it('aborts upstream requests when the caller disconnects and when the application shuts down', async () => {
    for (const cancel of ['caller', 'shutdown']) {
      const started = deferred(), closed = deferred();
      const upstream = await fixtureServer((req, res) => {
        started.resolve();
        res.on('close', () => closed.resolve());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"details":');
      });
      const fixture = await app([external(upstream.url)]);
      await fixture.save();
      const controller = new AbortController();
      const pending = fixture.request('/api/data/saved-search', { signal: controller.signal });
      await started.promise;
      if (cancel === 'caller') {
        controller.abort();
        await expect(pending).rejects.toThrow();
      } else {
        fixture.application.close();
        expect((await pending).status).toBe(503);
      }
      await closed.promise;
    }
  });

  it('enforces the eight-second deadline over a stalled response body', async () => {
    const started = deferred();
    const upstream = await fixtureServer((_req, res) => {
      started.resolve();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"details":');
    });
    const instance = registry([external(upstream.url)]);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const result = instance.read('catalog');
    const rejected = expect(result).rejects.toMatchObject({ status: 504, message: 'Read endpoint request timed out' });
    await started.promise;
    const deadline = timer.mock.calls.find(call => call[1] === 8000);
    expect(deadline).toBeDefined();
    if (!deadline) throw new Error('Read deadline was not installed');
    deadline[0]();
    await rejected;
  });

  it('rejects already-aborted callers before dispatching any external request', async () => {
    let count = 0;
    const upstream = await fixtureServer((_req, res) => { count++; res.end(); });
    const controller = new AbortController();
    controller.abort();
    await expect(registry([external(upstream.url)]).read('catalog', undefined, controller.signal)).rejects.toMatchObject({ status: 503 });
    expect(count).toBe(0);
  });

  it('closes registered reads with the HA client without changing ordinary static reads', async () => {
    const client = new HomeAssistantClient({ production: false, port: 0, host: '127.0.0.1', dataDir: '.', enableLiveActions: false });
    client.close();
    const source = createSampleDocument().dataSources.find(source => source.kind === 'static')!;
    expect(await client.data(source)).toEqual({ data: source.sample, mode: 'sample' });
  });
});
