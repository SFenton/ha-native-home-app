import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import { createApp } from '../server/app';
import { isLoopbackHost, loadConfig, localDevelopment, type ServerConfig } from '../server/config';
import { readNativeHouseConfig } from '../server/native-home';
import { StudioStore } from '../server/store';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(overrides: Partial<ServerConfig> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-home-server-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const config: ServerConfig = { production: false, port: 4800, host: '127.0.0.1', dataDir: directory, ...overrides };
  const application = createApp(store, config);
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    application.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const request = (endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}${endpoint}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { directory, store, config, application, server, base, request };
}

function houseConfig(cameraIds = ['camera.demo_entry', 'camera.demo_side']) {
  return {
    schema: 2, hash: 'a'.repeat(64),
    config: {
      home: { temperature: 'sensor.demo_outside', cameras: cameraIds.map(entityId => ({ title: 'Synthetic camera', entityId })) }, security: {}, climate: { thermostat: 'climate.demo_hall' },
      customLights: {}, food: {}, chores: {}, household: {}, media: { speaker: 'media_player.demo_kitchen' },
      roomDevices: {}, sprinklers: {}, vacation: {}, vacuums: {}, bedroom: {}, rooms: [],
    },
  };
}

async function mockNativeHome(options: {
  house?: unknown; states?: unknown;
  command?: (send: (value: unknown) => void, socket: Duplex) => void;
  authentication?: boolean;
  stallStates?: boolean;
  redirectWebsocket?: string;
} = {}) {
  const paths: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const connections: { closed: Promise<unknown[]> }[] = [];
  const sockets = new Set<Duplex>();
  const upstream = http.createServer((req, res) => {
    paths.push(req.url!);
    if (options.stallStates) return;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(options.states ?? [
      { entity_id: 'sensor.demo_outside', state: '0', attributes: { friendly_name: 'Outside', unit_of_measurement: 'C', icon: 'mdi:thermometer', device_class: 'temperature', token: 'discard-this-attribute', push_url: 'http://private-relay/', entity_picture: '/api/camera_proxy/camera.demo_front?token=discard-this-attribute' } },
      { entity_id: 'climate.demo_hall', state: 'off', attributes: { current_temperature: 0, temperature: 0, hvac_action: 'idle' } },
      { entity_id: 'media_player.demo_kitchen', state: 'off', attributes: { volume_level: 0, is_volume_muted: false } },
      { entity_id: 'sensor.demo_unreferenced', state: 'private-unrelated-state', attributes: {} },
    ]));
  });
  upstream.on('upgrade', (req, socket) => {
    paths.push(req.url!);
    if (options.redirectWebsocket) {
      socket.end(`HTTP/1.1 302 Found\r\nLocation: ${options.redirectWebsocket}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    connections.push({ closed: once(socket, 'close') });
    socket.on('close', () => sockets.delete(socket));
    const send = (value: unknown) => {
      const body = Buffer.from(JSON.stringify(value));
      const header = Buffer.alloc(body.length < 126 ? 2 : body.length < 65536 ? 4 : 10);
      header[0] = 0x81;
      if (body.length < 126) header[1] = body.length;
      else if (body.length < 65536) { header[1] = 126; header.writeUInt16BE(body.length, 2); }
      else { header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
      socket.write(Buffer.concat([header, body]));
    };
    let buffered: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 15;
        const masked = Boolean(buffered[1] & 128);
        let length = buffered[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (buffered.length < 4) return;
          length = buffered.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (buffered.length < 10) return;
          length = Number(buffered.readBigUInt64BE(2)); offset = 10;
        }
        if (buffered.length < offset + (masked ? 4 : 0) + length) return;
        const mask = masked ? buffered.subarray(offset, offset + 4) : undefined;
        offset += masked ? 4 : 0;
        const body = Buffer.from(buffered.subarray(offset, offset + length));
        if (mask) for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
        buffered = buffered.subarray(offset + length);
        if (opcode === 8) { if (!socket.writableEnded) socket.end(Buffer.from([0x88, 0])); return; }
        const message = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        messages.push(message);
        if (message.type === 'auth') send({ type: options.authentication === false ? 'auth_invalid' : 'auth_ok' });
        else if (message.type === 'fenton_home/house_config') {
          if (options.command) options.command(send, socket);
          else send({ id: 1, type: 'result', success: true, result: options.house ?? houseConfig() });
        } else if (message.type === 'auth/current_user') {
          send({ id: message.id, type: 'result', success: true, result: { id: 'synthetic-user', name: 'Synthetic user', is_owner: false, is_admin: true } });
        }
      }
    });

    send({ type: 'auth_required' });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  return { url, websocketUrl: url.replace('http:', 'ws:') + '/api/websocket', paths, messages, connections };
}

describe('durable storage', () => {
  it('releases storage on development shutdown with a connected hot-reload client', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-home-shutdown-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const reservation = http.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory,
        HA_URL: '', HA_TOKEN: '', SUPERVISOR_TOKEN: '', STUDIO_AUTH_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    });
    let output = '';
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    const ready = new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
        if (output.includes('Native Home Studio listening')) resolve();
      });
    });
    await Promise.race([
      ready,
      exited.then(() => { throw new Error(`Studio exited before readiness: ${output}`); }),
    ]);
    const before = await readFile(path.join(directory, 'native-v2', 'state.json'), 'utf8');
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, 'vite-hmr');
    cleanup.push(async () => { socket.close(); });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Hot-reload client could not connect')), { once: true });
    });
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(await readdir(directory)).not.toContain('.studio.lock');
    expect(await readFile(path.join(directory, 'native-v2', 'state.json'), 'utf8')).toBe(before);
  }, 10000);
  it('keeps only the composition draft: a new data directory gets no schema-1 files', async () => {
    const { directory, store } = await fixture();
    expect((await readdir(directory)).sort()).toEqual(['.studio.lock', 'native-v2']);
    expect(store.native.getDraft().revision).toBe(1);
  });
  it('has no schema-1 draft, validate, export, schema, feedback, data, camera, wallpaper or action endpoints', async () => {
    const { request } = await fixture();
    for (const [endpoint, method] of [
      ['/api/draft', 'GET'], ['/api/draft', 'PUT'], ['/api/validate', 'POST'], ['/api/export', 'GET'], ['/api/schema', 'GET'], ['/api/feedback', 'POST'],
      ['/api/data/climate', 'GET'], ['/api/read-endpoints', 'GET'], ['/api/cameras/camera.demo/stream', 'GET'], ['/api/native-wallpaper', 'GET'],
      ['/api/actions/execute', 'POST'], ['/api/publish', 'POST'], ['/api/published', 'GET'], ['/api/events', 'GET'],
    ] as const) expect((await request(endpoint, method, method === 'GET' ? undefined : {})).status, `${method} ${endpoint}`).toBe(404);
    expect((await (await request('/api/health')).json())).toEqual({ status: 'ok', mode: 'sample', haConnected: false, draftRevision: 1 });
  });
  it('leaves schema-1 files from an earlier Studio on disk untouched, unread and unrecreated', async () => {
    const { store, directory } = await fixture();
    await store.close();
    const legacy: Record<string, string> = {
      'draft.json': '{broken', 'published.json': '{"retired":true}\n', 'revisions/1.json': '{"retired":true}\n', 'feedback/queued.json': '{"status":"queued"}\n',
    };
    for (const [name, body] of Object.entries(legacy)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), body);
    }
    const reopened = await StudioStore.open(directory);
    cleanup.push(() => reopened.close());
    expect(reopened.native.getDraft().revision).toBe(1);
    for (const [name, body] of Object.entries(legacy)) expect(await readFile(path.join(directory, name), 'utf8'), name).toBe(body);
    expect((await readdir(directory)).sort()).toEqual(['.studio.lock', 'draft.json', 'feedback', 'native-v2', 'published.json', 'revisions']);
  });
  it('rejects a second writer using the same DATA_DIR', async () => {
    const { directory } = await fixture();
    await expect(StudioStore.open(directory)).rejects.toThrow('DATA_DIR is locked');
  });
});

describe('authentication, origin checks, and safe HA boundary', () => {
  it('requires production authentication and rejects weak configuration', () => {
    expect(() => loadConfig({ STUDIO_AUTH_TOKEN: 'short' })).toThrow();
    expect(() => loadConfig({ HA_URL: 'http://user:secret@example.com' })).toThrow();
    expect(() => loadConfig({ HA_URL: 'file:///etc/passwd' })).toThrow();
    expect(() => loadConfig({ HA_URL: 'not-an-origin' })).toThrow('HA_URL must be a valid HTTP(S) origin');
    expect(loadConfig({ HA_URL: 'http://example.test:8123/' }).haUrl).toBe('http://example.test:8123');
  });

  describe('authenticated read-only native home bootstrap', () => {
    const authoringToken = 'test-authoring-native-bootstrap-token';
    const haToken = 'test-backend-native-bootstrap-token';
    const headers = { Authorization: `Bearer ${authoringToken}` };

    it('fetches the unchanged schema-2 envelope and projects only referenced safe states without saving', async () => {
      const upstream = await mockNativeHome();
      const { request, store } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const before = JSON.stringify(store.native.getDraft());
      expect((await request('/api/native-home')).status).toBe(401);
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        mode: 'live', houseConfig: houseConfig(), currentUser: { id: 'synthetic-user', name: 'Synthetic user', isOwner: false, isAdmin: true }, states: [
          { entityId: 'sensor.demo_outside', state: '0', name: 'Outside', unit: 'C', icon: 'mdi:thermometer', deviceClass: 'temperature' },
          { entityId: 'climate.demo_hall', state: 'off', name: 'climate.demo_hall', currentTemperature: 0, temperature: 0, hvacAction: 'idle' },
          { entityId: 'media_player.demo_kitchen', state: 'off', name: 'media_player.demo_kitchen', volumeLevel: 0, isVolumeMuted: false },
        ],
      });
      const serialized = JSON.stringify(body);
      for (const forbidden of [authoringToken, haToken, 'discard-this-attribute', 'push_url', 'entity_picture', 'private-unrelated-state']) expect(serialized).not.toContain(forbidden);
      expect(upstream.messages).toEqual([{ type: 'auth', access_token: haToken }, { id: 1, type: 'fenton_home/house_config' }, { id: 2, type: 'auth/current_user' }]);
      expect(upstream.paths).toEqual(['/api/websocket', '/api/states']);
      await upstream.connections[0].closed;
      expect(JSON.stringify(store.native.getDraft())).toBe(before);
      expect(upstream.paths).toEqual(['/api/websocket', '/api/states']);
    });

    it('does not inherit the sample-demo bypass once a token is set, and fails explicitly without HA configuration', async () => {
      const demo = await fixture({ authToken: authoringToken });
      expect((await demo.request('/api/native-home')).status).toBe(401);
      const { request } = await fixture({ authToken: authoringToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Home Assistant is not configured' });
    });

    it('uses the same verified ingress identity and admin boundary as authoring APIs', async () => {
      const upstream = await mockNativeHome();
      const { request } = await fixture({
        haUrl: upstream.url, haToken,
        ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/native-test' },
      });
      const ingress = { 'X-Ingress-Path': '/api/hassio_ingress/native-test', 'X-Remote-User-Id': 'test-admin', 'X-Remote-User-Groups': 'system-admin' };
      for (const invalid of [{ ...ingress, 'X-Ingress-Path': '/wrong' }, { ...ingress, 'X-Remote-User-Groups': 'system-users' }, { 'X-Ingress-Path': ingress['X-Ingress-Path'] }]) {
        expect((await request('/api/native-home', 'GET', undefined, invalid)).status).toBe(401);
      }
      expect(upstream.connections).toHaveLength(0);
      expect((await request('/api/native-home', 'GET', undefined, ingress)).status).toBe(200);
      await upstream.connections[0].closed;
    });

    it.each([
      { house: { configured: false }, status: 503, error: 'not configured' },
      { house: { ...houseConfig(), schema: 1 }, status: 502, error: 'Unsupported' },
      { house: { ...houseConfig(), schema: 3 }, status: 502, error: 'Unsupported' },
      { house: { ...houseConfig(), hash: 'not-a-hash' }, status: 502, error: 'Invalid' },
      { house: { ...houseConfig(), config: { home: {} } }, status: 502, error: 'missing required' },
    ])('rejects unavailable/unsupported/invalid native config: $error ($status)', async ({ house, status, error }) => {
      const upstream = await mockNativeHome({ house });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(status);
      expect((await response.json()).error).toContain(error);
      expect(upstream.paths).toEqual(['/api/websocket']);
      await upstream.connections[0].closed;
    });

    it.each([
      { authentication: false, error: 'authentication failed' },
      { command: (send: (value: unknown) => void) => send({ id: 1, type: 'result', success: false, error: { code: 'unknown_command', message: haToken } }), error: 'command is unavailable' },
      { command: (_send: (value: unknown) => void, socket: Duplex) => socket.end(Buffer.from([0x88, 0])), error: 'closed before' },
    ])('closes on HA transport errors without forwarding upstream error contents: $error', async (options) => {
      const upstream = await mockNativeHome(options);
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toContain(options.error);
      expect(text).not.toContain(haToken);
      await upstream.connections[0].closed;
    });

    it('bounds time waiting for a native response and closes the socket on timeout', async () => {
      const upstream = await mockNativeHome({ command: () => {} });
      await expect(readNativeHouseConfig(upstream.websocketUrl, haToken, AbortSignal.timeout(150))).rejects.toMatchObject({ status: 504, message: 'Native home snapshot timed out' });
      await upstream.connections[0].closed;
    });

    it('refuses WebSocket redirects instead of authenticating to another origin', async () => {
      const target = await mockNativeHome();
      const upstream = await mockNativeHome({ redirectWebsocket: target.websocketUrl });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(target.paths).toEqual([]);
      expect(target.messages).toEqual([]);
    });

    it('applies the overall eight-second deadline to the HTTP state read as well', async () => {
      const upstream = await mockNativeHome({ stallStates: true });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const start = performance.now();
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: 'Native home snapshot timed out' });
      expect(performance.now() - start).toBeLessThan(10000);
      expect(upstream.paths).toEqual(['/api/websocket', '/api/states']);
      await upstream.connections[0].closed;
    }, 12000);

    it('closes the native socket when the browser cancels its request', async () => {
      let received!: () => void;
      const commandReceived = new Promise<void>((resolve) => { received = resolve; });
      const upstream = await mockNativeHome({ command: () => received() });
      const { base } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const controller = new AbortController();
      const pending = fetch(`${base}/api/native-home`, { headers, signal: controller.signal });
      await commandReceived;
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await upstream.connections[0].closed;
    });

    it('cancels a pending native request and closes its socket when Studio shuts down', async () => {
      let received!: () => void;
      const commandReceived = new Promise<void>((resolve) => { received = resolve; });
      const upstream = await mockNativeHome({ command: () => received() });
      const { request, application } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const pending = request('/api/native-home', 'GET', undefined, headers);
      await commandReceived;
      application.close();
      expect((await pending).status).toBe(503);
      await upstream.connections[0].closed;
    });

    it.each([
      { addition: { push_url: 'http://private-relay/' }, error: 'credential-bearing fields' },
      { addition: { accessToken: 'test-never-forward' }, error: 'credential-bearing fields' },
      { addition: { url: 'https://user:password@example.test/' }, error: 'credential-bearing URLs' },
      { addition: { url: '//user:password@example.test/' }, error: 'credential-bearing URLs' },
      { addition: { url: 'https://example.test/?api_key=test-never-forward' }, error: 'credential-bearing URLs' },
      { addition: { template: '{{ states.sensor.secret }}' }, error: 'unsafe executable' },
      { addition: { label: haToken }, error: 'server credentials' },
    ])('rejects unsafe raw config without redacting it under the original hash: $error', async ({ addition, error }) => {
      const house = houseConfig();
      Object.assign(house.config.home, addition);
      const upstream = await mockNativeHome({ house });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toContain(error);
      expect(text).not.toContain('test-never-forward');
      expect(text).not.toContain(haToken);
      await upstream.connections[0].closed;
    });

    it('rejects known credentials in otherwise allowed state fields', async () => {
      const upstream = await mockNativeHome({ states: [{ entity_id: 'sensor.demo_outside', state: '0', attributes: { friendly_name: authoringToken } }] });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Native home snapshot contains server credentials' });
      await upstream.connections[0].closed;
    });

    it('rejects oversized upstream messages and malformed state projections instead of returning partial snapshots', async () => {
      const upstream = await mockNativeHome({ house: { ...houseConfig(), padding: 'x'.repeat(260 * 1024) } });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      expect((await request('/api/native-home', 'GET', undefined, headers)).status).toBe(502);
      await upstream.connections[0].closed;
      const invalidStates = await mockNativeHome({ states: [{ entity_id: 'sensor.demo_outside', state: '0', attributes: { brightness: 999 } }] });
      const invalid = await fixture({ authToken: authoringToken, haUrl: invalidStates.url, haToken });
      expect((await invalid.request('/api/native-home', 'GET', undefined, headers)).status).toBe(502);
      await invalidStates.connections[0].closed;
    });

    it('enforces shared JSON string limits on native configuration', async () => {
      const house = houseConfig();
      Object.assign(house.config.home, { label: 'x'.repeat(16385) });
      const upstream = await mockNativeHome({ house });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(upstream.paths).toEqual(['/api/websocket']);
      await upstream.connections[0].closed;
    });

    it('rejects raw HTTP states above 4 MiB even when oversized attributes would be discarded', async () => {
      const upstream = await mockNativeHome({ states: [{ entity_id: 'sensor.demo_outside', state: '0', attributes: { ignored: 'x'.repeat(4 * 1024 * 1024) } }] });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Home Assistant response exceeds 4 MiB' });
      await upstream.connections[0].closed;
    });

    it('rejects a projected snapshot above 1 MiB rather than returning a truncated entity set', async () => {
      const entities = Array.from({ length: 1000 }, (_, index) => `sensor.${String(index).padStart(150, 'a')}`);
      const house = houseConfig();
      const upstream = await mockNativeHome({
        house: { ...house, config: { ...house.config, home: { entities }, climate: {}, media: {} } },
        states: entities.map((entity_id) => ({
          entity_id, state: 'x'.repeat(255),
          attributes: { friendly_name: 'x'.repeat(240), unit_of_measurement: 'x'.repeat(80), icon: 'x'.repeat(80), device_class: 'x'.repeat(80), hvac_action: 'x'.repeat(80) },
        })),
      });
      const { request } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const response = await request('/api/native-home', 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'Native home snapshot exceeds 1 MiB' });
      await upstream.connections[0].closed;
    });
  });
  it('refuses production or credentialed HA authoring without authentication', async () => {
    await expect(fixture({ production: true })).rejects.toThrow('require STUDIO_AUTH_TOKEN');
    await expect(fixture({ production: true, haUrl: 'http://example.test', haToken: 'test-backend-only-credential' })).rejects.toThrow('require STUDIO_AUTH_TOKEN');
    await expect(fixture({ supervisorToken: 'test-supervisor-credential' })).rejects.toThrow('require STUDIO_AUTH_TOKEN');
  });
  describe('local development without a token', () => {
    it('reaches every authoring route, including native composition, without signing in', async () => {
      const { request } = await fixture();
      expect((await request('/native/api/draft')).status).toBe(200);
      expect((await request('/native/api/published')).status).not.toBe(401);
      expect((await request('/api/native-home')).status).toBe(503);
    });
    it('allows HA credentials on loopback and refuses a reachable bind with one message', async () => {
      const ha = { haUrl: 'http://example.test', haToken: 'test-backend-only-credential' };
      for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) {
        const { request } = await fixture({ ...ha, host });
        expect((await request('/native/api/draft')).status).toBe(200);
      }
      for (const host of ['0.0.0.0', '::', '192.168.1.20', 'studio.example.test'])
        await expect(fixture({ ...ha, host })).rejects.toThrow(/^Local development without STUDIO_AUTH_TOKEN[^\n]*loopback HOST[^\n]*$/);
    });
    it('keeps plain development without credentials open on a LAN bind', async () => {
      const { request } = await fixture({ host: '0.0.0.0' });
      expect((await request('/native/api/draft')).status).toBe(200);
    });
    it('turns sign-in on when STUDIO_AUTH_TOKEN is set, and does not treat Ingress or production as local', async () => {
      const token = 'a-long-test-token-not-a-real-secret';
      const { request } = await fixture({ authToken: token, haUrl: 'http://example.test', haToken: 'test-backend-only-credential', host: '0.0.0.0' });
      expect((await request('/api/health')).status).toBe(401);
      expect((await request('/native/api/draft')).status).toBe(401);
      expect((await request('/native/api/draft', 'GET', undefined, { Authorization: `Bearer ${token}` })).status).toBe(200);
      expect(localDevelopment({ production: false })).toBe(true);
      expect(localDevelopment({ production: true })).toBe(false);
      expect(localDevelopment({ production: false, authToken: token })).toBe(false);
      expect(localDevelopment({ production: false, ingress: { proxyAddress: '172.30.32.2', path: '/api/hassio_ingress/x' } })).toBe(false);
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('10.0.0.1')).toBe(false);
    });
  });
  describe('DNS rebinding guard', () => {
    /** Sends a raw request so the Host header is exactly what a rebound page would carry. */
    function withHost(base: string, host: string, endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
      return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const url = new URL(endpoint, base);
        const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method, headers: { Host: host, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
          let text = '';
          res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        });
        req.on('error', reject);
        req.end(payload);
      });
    }
    for (const credentials of [false, true]) {
      it(`refuses a foreign Host on every route in local development ${credentials ? 'with' : 'without'} HA credentials`, async () => {
        const { base, store } = await fixture(credentials ? { haUrl: 'http://127.0.0.1:9', haToken: 'test-backend-only-credential' } : {});
        const draft = store.native.getDraft();
        for (const host of ['evil.example', 'evil.example:4800', 'localhost.evil.example', 'x.ts.net.evil.example']) {
          for (const [endpoint, method, body] of [
            ['/native/api/draft', 'GET', undefined], ['/api/native-home', 'GET', undefined], ['/native/api/ha/services', 'GET', undefined],
            ['/native/api/draft', 'PUT', { document: draft.document, expectedRevision: draft.revision }],
            ['/native/api/ha/publish', 'POST', { expectedRevision: draft.revision }], ['/native/api/ha/rollback', 'POST', { revision: 1 }],
          ] as const) {
            const response = await withHost(base, host, endpoint, method, body, method === 'GET' ? {} : { Origin: `http://${host}` });
            expect([host, endpoint, response.status]).toEqual([host, endpoint, 403]);
            expect(response.body).toBe('');
          }
        }
        expect((await withHost(base, 'evil.example', '/native/api/draft')).status).toBe(403);
        expect(store.native.getDraft().revision).toBe(draft.revision);
      });
    }
    it('lets loopback names, IP literals, Tailscale names and STUDIO_ALLOWED_HOSTS entries through', async () => {
      const previous = process.env.STUDIO_ALLOWED_HOSTS;
      process.env.STUDIO_ALLOWED_HOSTS = 'studio.lan';
      cleanup.push(async () => { if (previous === undefined) delete process.env.STUDIO_ALLOWED_HOSTS; else process.env.STUDIO_ALLOWED_HOSTS = previous; });
      const { base } = await fixture();
      for (const host of ['localhost', 'localhost:4800', '127.0.0.1:4800', '[::1]:4800', '192.168.1.20:4800', 'mac.tail1234.ts.net', 'mac.tail1234.ts.net:4800', 'studio.lan:4800']) {
        expect([host, (await withHost(base, host, '/native/api/draft')).status]).toEqual([host, 200]);
      }
    });
    it('keeps a verified Ingress proxy and token-protected production working with a forwarded Host', async () => {
      const ingress = { 'X-Ingress-Path': '/api/hassio_ingress/native-test', 'X-Remote-User-Id': 'test-admin', 'X-Remote-User-Groups': 'system-admin' };
      const viaIngress = await fixture({ production: true, ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/native-test' } });
      expect((await withHost(viaIngress.base, 'ha.example.org', '/native/api/draft', 'GET', undefined, { ...ingress, 'X-Forwarded-Host': 'ha.example.org' })).status).toBe(200);
      expect((await withHost(viaIngress.base, 'ha.example.org', '/native/api/draft')).status).toBe(401);
      const token = 'a-long-test-token-not-a-real-secret';
      const tokened = await fixture({ authToken: token });
      expect((await withHost(tokened.base, 'studio.example.org', '/native/api/draft', 'GET', undefined, { Authorization: `Bearer ${token}` })).status).toBe(200);
    });
  });
  it('protects reads and writes with a token, supports HttpOnly authoring sessions, and does not leak the token', async () => {
    const token = 'a-long-test-token-not-a-real-secret';
    const { request, base } = await fixture({ production: true, authToken: token });
    const validate = { document: createCompositionDocument('session-check') };
    expect((await request('/native/api/draft')).status).toBe(401);
    expect((await request('/native/api/draft', 'GET', undefined, { 'X-Ingress-Path': '/fake' })).status).toBe(401);
    const authenticated = await request('/native/api/draft', 'GET', undefined, { Authorization: `Bearer ${token}` });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.text()).not.toContain(token);
    const login = await request('/api/auth', 'POST', { token }, { Origin: base });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await request('/native/api/draft', 'GET', undefined, { Cookie: cookie })).status).toBe(200);
    expect((await request('/native/api/validate', 'POST', validate, { Cookie: cookie, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/native/api/validate', 'POST', validate, { Authorization: `Bearer ${token}`, Origin: base })).status).toBe(200);
  });
  it('never trusts spoofed ingress headers from an unverified peer', async () => {
    const { request } = await fixture({ production: true, ingress: { proxyAddress: '192.0.2.10', path: '/api/hassio_ingress/verified' } });
    const response = await request('/native/api/draft', 'GET', undefined, { 'X-Ingress-Path': '/api/hassio_ingress/verified', 'X-Forwarded-For': '192.0.2.10' });
    expect(response.status).toBe(401);
  });
  it('requires the exact ingress path in addition to the actual verified peer', async () => {
    const { request, base } = await fixture({ production: true, ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/verified' } });
    const headers = { 'X-Ingress-Path': '/api/hassio_ingress/verified', 'X-Remote-User-Id': 'test-admin', 'X-Remote-User-Groups': 'system-admin' };
    expect((await request('/native/api/draft')).status).toBe(401);
    expect((await request('/native/api/draft', 'GET', undefined, { ...headers, 'X-Ingress-Path': '/wrong' })).status).toBe(401);
    expect((await request('/native/api/draft', 'GET', undefined, { 'X-Ingress-Path': headers['X-Ingress-Path'] })).status).toBe(401);
    expect((await request('/native/api/draft', 'GET', undefined, { ...headers, 'X-Remote-User-Groups': 'system-users' })).status).toBe(401);
    expect((await request('/native/api/draft', 'GET', undefined, headers)).status).toBe(200);
    expect((await request('/native/api/validate', 'POST', { document: createCompositionDocument('ingress-check') }, { ...headers, Origin: base })).status).toBe(200);
  });
  it('blocks traversal, oversized logins and arbitrary proxy endpoints', async () => {
    const { request } = await fixture();
    expect((await request('/native/api/assets/%2e%2e%2fsecret')).status).toBe(400);
    expect((await request('/native/api/assets/https%3A%2F%2Fexample.com')).status).toBe(400);
    expect((await request('/api/proxy?url=http://169.254.169.254')).status).toBe(404);
    const oversizedLogin = await request('/api/auth', 'POST', { token: 'x'.repeat(1024 * 1024 + 1) });
    expect(oversizedLogin.status).toBe(413);
    expect(await oversizedLogin.json()).toEqual({ error: 'Request body exceeds 1 MiB' });
  });
  it('labels sample data and reports no Home Assistant connection without credentials', async () => {
    const { request } = await fixture();
    const health = await (await request('/api/health')).json();
    expect(health.mode).toBe('sample');
    expect(health.haConnected).toBe(false);
  });
  it('requires JSON content types and bounds unauthenticated login attempts', async () => {
    const { request, base } = await fixture({ production: true, authToken: 'test-authoring-token-long-enough' });
    expect((await fetch(`${base}/api/auth`, { method: 'POST', body: 'token=x', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    for (let attempt = 0; attempt < 10; attempt++) expect((await request('/api/auth', 'POST', { token: 'wrong' })).status).toBe(401);
    const limited = await request('/api/auth', 'POST', { token: 'wrong' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
});

describe('Home Assistant services (read only)', () => {
  async function upstream(body: unknown) {
    const seen: { method?: string; url?: string; auth?: string }[] = [];
    const server = http.createServer((req, res) => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
  }
  const authToken = 'synthetic-services-authoring-token', haToken = 'synthetic-services-backend-token';
  it('serves the reduced list with GET only, no credentials, and needs authentication', async () => {
    const source = await upstream([{ domain: 'light', services: { turn_on: { name: 'Turn on', description: 'Turn on a light.', target: {}, fields: {
      brightness: { name: 'Brightness', description: 'How bright.', example: '120', selector: { number: { min: 0, max: 255, unit_of_measurement: 'lm' } } },
      effect: { selector: { select: { options: ['rainbow', { value: 'pulse', label: 'Pulse' }] } } }, bad_key: { selector: { text: null } }, 'Bad Key': {} } } } },
      { domain: 'Bad Domain', services: {} }]);
    const { request } = await fixture({ authToken, haToken, haUrl: source.url });
    expect((await request('/native/api/ha/services')).status).toBe(401);
    const response = await request('/native/api/ha/services', 'GET', undefined, { Authorization: `Bearer ${authToken}` });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(haToken); expect(text).not.toContain('example');
    const body = JSON.parse(text) as { domain: string; services: { service: string; fields: Record<string, { kind: string; options?: string[] }> }[] }[];
    expect(body.map(item => item.domain)).toEqual(['light']);
    expect(body[0].services[0].fields.brightness).toMatchObject({ kind: 'number', min: 0, max: 255, unit: 'lm' });
    expect(body[0].services[0].fields.effect).toMatchObject({ kind: 'choice', options: ['rainbow', 'pulse'] });
    expect(Object.keys(body[0].services[0].fields)).not.toContain('Bad Key');
    expect(source.seen).toEqual([{ method: 'GET', url: '/api/services', auth: `Bearer ${haToken}` }]);
    expect((await request('/native/api/ha/services', 'POST', {}, { Authorization: `Bearer ${authToken}` })).status).toBeGreaterThanOrEqual(400);
  });
  it('answers 503 without a Home Assistant connection', async () => {
    const { request } = await fixture({ authToken });
    expect((await request('/native/api/ha/services', 'GET', undefined, { Authorization: `Bearer ${authToken}` })).status).toBe(503);
  });
});
