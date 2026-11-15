import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { createSampleDocument } from '../src/shared/sample';
import { validateDocument } from '../src/shared/schema';
import { createApp } from '../server/app';
import { loadConfig, type ServerConfig } from '../server/config';
import { readCameraStream, rewriteCameraManifest } from '../server/camera';
import { readNativeHouseConfig } from '../server/native-home';
import { StudioStore } from '../server/store';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(overrides: Partial<ServerConfig> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-home-server-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const config: ServerConfig = { production: false, port: 4800, host: '127.0.0.1', dataDir: directory, enableLiveActions: false, ...overrides };
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

function documentAtByteLength(size: number) {
  const document = validateDocument(createSampleDocument());
  const sample = Array<string>(1000).fill('');
  document.dataSources.push({ id: 'large-sample', name: 'Large sample', kind: 'static', refreshSeconds: 60, sample });
  const remaining = size - Buffer.byteLength(JSON.stringify(document));
  const perItem = Math.floor(remaining / sample.length);
  sample.fill('x'.repeat(perItem));
  sample[0] += 'x'.repeat(remaining % sample.length);
  expect(Buffer.byteLength(JSON.stringify(document))).toBe(size);
  return document;
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
  cameraCommand?: (send: (value: unknown) => void, socket: Duplex) => void;
  media?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
} = {}) {
  const paths: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const connections: { closed: Promise<unknown[]> }[] = [];
  const sockets = new Set<Duplex>();
  const upstream = http.createServer((req, res) => {
    paths.push(req.url!);
    if (options.media && (req.url?.startsWith('/api/hls/') || req.url?.startsWith('/api/camera_proxy_stream/'))) { options.media(req, res); return; }
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
        } else if (message.type === 'camera/stream') {
          if (options.cameraCommand) options.cameraCommand(send, socket);
          else send({ id: 1, type: 'result', success: true, result: { url: `/api/hls/${'a'.repeat(32)}/master_playlist.m3u8` } });
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

describe('authenticated native camera HLS transport',() => {
  function deferred() {
    let resolve!: () => void;
    const promise=new Promise<void>(done => { resolve=done; });
    return { promise,resolve };
  }
  const authToken='synthetic-camera-authoring-token';
  const haToken='synthetic-camera-backend-token';
  const headers={ Authorization: `Bearer ${authToken}` };
  const entity='camera.demo_entry';
  const start=`/api/cameras/${entity}/stream`;
  const playlist='#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:12\n#EXT-X-PART-INF:PART-TARGET=1.000\n#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=2.000\n#EXT-X-START:TIME-OFFSET=-3.000,PRECISE=YES\n#EXT-X-PART:DURATION=1.000,URI="./segment/12.0.m4s",INDEPENDENT=YES\n#EXTINF:6.000,\n./segment/12.m4s\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="./segment/13.0.m4s"\n';

  it.each(['camera.demo_entry','camera.demo_side'])('allows the configured native camera command for %s',async entityId => {
    const upstream=await mockNativeHome();
    const { request }=await fixture({ authToken,haToken,haUrl: upstream.url });
    expect((await request(`/api/cameras/${entityId}/stream`,'GET',undefined,headers)).status).toBe(200);
    expect(upstream.messages.at(-1)).toEqual({ type: 'camera/stream',id: 1,entity_id: entityId,format: 'hls' });
  });

  it('requires actual authentication and resolves unknown cameras only from server-loaded native configuration',async () => {
    const anonymous=await fixture();
    expect((await anonymous.request(start)).status).toBe(401);
    const upstream=await mockNativeHome();
    const { request }=await fixture({ authToken,haToken,haUrl: upstream.url });
    expect((await request(start)).status).toBe(401);
    expect((await request('/api/cameras/camera.demo_unknown/stream','GET',undefined,headers)).status).toBe(404);
    expect((await request(start,'GET',undefined,{ ...headers,Origin: 'https://other.invalid' })).status).toBe(403);
    expect((await request(`${start}?url=http://other.invalid`,'GET',undefined,headers)).status).toBe(400);
    expect(upstream.paths).toEqual(['/api/websocket']);
    expect(upstream.messages).toEqual([{ type: 'auth', access_token: haToken }, { id: 1, type: 'fenton_home/house_config' }]);
  });

  it('accepts newly configured cameras and revokes removed cameras without trusting browser claims', async () => {
    const house = houseConfig();
    const upstream = await mockNativeHome({ house });
    const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
    const first = await (await request(start, 'GET', undefined, headers)).json();
    house.config.home.cameras = [{ title: 'Added camera', entityId: 'camera.demo_newly_configured' }];
    expect((await request('/api/cameras/camera.demo_newly_configured/stream', 'GET', undefined, headers)).status).toBe(200);
    expect(upstream.messages.at(-1)).toMatchObject({ type: 'camera/stream', entity_id: 'camera.demo_newly_configured' });
    expect((await request('/api/cameras/camera.demo_newly_configured/mjpeg', 'GET', undefined, headers)).status).toBe(200);
    expect((await request(start, 'GET', undefined, headers)).status).toBe(404);
    expect((await request(`/${first.url}`, 'GET', undefined, headers)).status).toBe(410);
    expect((await request('/api/cameras/camera.demo_browser_only/mjpeg', 'GET', undefined, headers)).status).toBe(404);
    expect(upstream.paths.every(path => path === '/api/websocket')).toBe(true);
  });

  it.each([[], undefined])('rejects cameras when home.cameras is empty or absent (%s)', async cameras => {
    const house = houseConfig();
    Object.assign(house.config.home, { cameras });
    const upstream = await mockNativeHome({ house });
    const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
    expect((await request(start, 'GET', undefined, headers)).status).toBe(404);
    expect((await request(`/api/cameras/${entity}/mjpeg`, 'GET', undefined, headers)).status).toBe(404);
    expect(upstream.messages.some(message => message.type === 'camera/stream')).toBe(false);
  });

  it.each([
    null, 'camera.demo_entry', [{}], [{ entityId: 'sensor.demo_entry' }],
    [{ entityId: 'camera.demo_entry/../other' }], [{ entityId: 'camera.demo_entry?token=private' }],
    [{ entityId: 'https://other.invalid/camera' }], [{ entityId: `camera.${'x'.repeat(160)}` }],
    [{ entityId: entity }, { entityId: 'camera.demo_invalid/path' }],
  ])('fails closed for malformed camera configuration (%j)', async cameras => {
    const house = houseConfig();
    Object.assign(house.config.home, { cameras });
    const upstream = await mockNativeHome({ house });
    const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
    for (const transport of ['stream', 'mjpeg']) {
      const response = await request(`/api/cameras/${entity}/${transport}`, 'GET', undefined, headers);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('private');
    }
    expect(upstream.messages.some(message => message.type === 'camera/stream')).toBe(false);
    expect(upstream.paths.every(path => path === '/api/websocket')).toBe(true);
  });

  it.each([
    { id: 'sensor.demo_entry', status: 404 }, { id: 'camera.demo_bad%2fpath', status: 400 },
    { id: 'camera.demo_bad%3ftoken=private', status: 404 }, { id: `camera.${'x'.repeat(160)}`, status: 404 },
  ])('rejects unsafe request IDs before reading native configuration ($id)', async ({ id, status }) => {
    const upstream = await mockNativeHome();
    const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
    expect((await request(`/api/cameras/${id}/stream`, 'GET', undefined, headers)).status).toBe(status);
    expect(upstream.paths).toEqual([]);
  });

  it('refreshes media authorization within five seconds and stops removed camera leases before fetching media', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const house = houseConfig();
      const upstream = await mockNativeHome({ house, media: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end('#EXTM3U\nplaylist.m3u8\n');
      } });
      const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
      const stream = await (await request(start, 'GET', undefined, headers)).json();
      for (let index = 0; index < 2; index++) expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(200);
      expect(upstream.messages.filter(message => message.type === 'fenton_home/house_config')).toHaveLength(1);
      house.config.home.cameras = [];
      clock.mockReturnValue(now + 5001);
      expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(503);
      expect(upstream.messages.filter(message => message.type === 'fenton_home/house_config')).toHaveLength(2);
      expect(upstream.paths.filter(path => path.startsWith('/api/hls/'))).toHaveLength(2);
      expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(410);
    } finally { clock.mockRestore(); }
  });

  it('cancels the native-configuration read when the camera requester disconnects', async () => {
    const started = deferred();
    const upstream = await mockNativeHome({ command: () => started.resolve() });
    const { base } = await fixture({ authToken, haToken, haUrl: upstream.url });
    const abort = new AbortController();
    const pending = fetch(`${base}${start}`, { headers, signal: abort.signal });
    await started.promise;
    abort.abort();
    await expect(pending).rejects.toThrow();
    await upstream.connections[0].closed;
    expect(upstream.messages.some(message => message.type === 'camera/stream')).toBe(false);
  });

  it('releases abandoned camera leases immediately without filling the inactive stream quota', async () => {
    const upstream = await mockNativeHome();
    const { request } = await fixture({ authToken, haToken, haUrl: upstream.url });
    for (let index = 0; index < 18; index++) {
      const opened = await request(start, 'GET', undefined, headers);
      expect(opened.status).toBe(200);
      const stream = await opened.json();
      const release = `/api/cameras/streams/${stream.streamId}`;
      if (index === 0) {
        expect((await request(release, 'DELETE', {})).status).toBe(401);
        expect((await request(release, 'DELETE', {}, { ...headers, Origin: 'https://other.invalid' })).status).toBe(403);
      }
      const closed = await request(release, 'DELETE', {}, headers);
      expect(closed.status).toBe(200);
      expect(await closed.json()).toEqual({ released: true });
      expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(410);
      expect(await (await request(release, 'DELETE', {}, headers)).json()).toEqual({ released: false });
    }
  });

  it('authenticates the official read-only command and proxies only bounded same-origin HLS resources without leaking upstream URLs',async () => {
    const upstreamAuth: string[]=[];
    const upstream=await mockNativeHome({
      media: (req,res) => {
        upstreamAuth.push(req.headers.authorization??'');
        if(req.url?.endsWith('master_playlist.m3u8')) {
          res.writeHead(200,{ 'Content-Type': 'application/vnd.apple.mpegurl' });
          res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,CODECS="avc1.640028,mp4a.40.2"\nplaylist.m3u8\n');
        } else if(req.url?.endsWith('playlist.m3u8')) {
          res.writeHead(200,{ 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(playlist);
        } else {
          const init=req.url?.endsWith('init.mp4');
          res.writeHead(200,{ 'Content-Type': init? 'video/mp4':'video/iso.segment' });
          res.end(Buffer.concat([Buffer.from([0,0,0,8]),Buffer.from(init? 'ftyp':'moof')]));
        }
      }
    });
    const { request,base }=await fixture({ authToken,haToken,haUrl: upstream.url });
    const login=await request('/api/auth','POST',{ token: authToken },{ Origin: base });
    const cookieHeaders={ Cookie: login.headers.get('set-cookie')!.split(';')[0] };
    const response=await request(start,'GET',undefined,cookieHeaders);
    expect(response.status).toBe(200);
    const stream=await response.json();
    expect(stream).toMatchObject({ transport: 'hls',streamId: expect.stringMatching(/^[a-f0-9]{32}$/),idleSeconds: 60 });
    expect(upstream.messages).toEqual([
      { type: 'auth',access_token: haToken },
      { id: 1,type: 'fenton_home/house_config' },
      { type: 'auth',access_token: haToken },
      { id: 1,type: 'camera/stream',entity_id: entity,format: 'hls' },
    ]);
    await Promise.all(upstream.connections.map(connection => connection.closed));
    const master=await request(`/${stream.url}`,'GET',undefined,cookieHeaders);
    expect(master.headers.get('cache-control')).toBe('private, no-store');
    const manifest=await master.text();
    const prefix=`/api/cameras/streams/${stream.streamId}/`;
    const media=await request(`${prefix}playlist.m3u8`,'GET',undefined,cookieHeaders);
    const rewritten=await media.text();
    expect(rewritten).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(rewritten).toContain('\nsegment/12.m4s\n');
    expect(rewritten).not.toContain('PART');
    expect(rewritten).not.toContain('SERVER-CONTROL');
    expect((await request(`${prefix}init.mp4`,'GET',undefined,cookieHeaders)).status).toBe(200);
    expect((await request(`${prefix}segment/12.m4s`,'GET',undefined,cookieHeaders)).status).toBe(200);
    expect(upstreamAuth).toEqual(Array(4).fill(`Bearer ${haToken}`));
    const output=JSON.stringify(stream)+manifest+rewritten;
    for(const privateValue of [haToken,authToken,upstream.url,'a'.repeat(32),'/api/hls/']) expect(output).not.toContain(privateValue);
    expect((await request(`${prefix}init.mp4`)).status).toBe(401);
    expect((await request(`${prefix}segment/%2e%2e%2fother`,'GET',undefined,headers)).status).toBe(400);
    expect((await request(`${prefix}other.mp4`,'GET',undefined,headers)).status).toBe(404);
    expect((await request(`${prefix}playlist.m3u8?_HLS_msn=5`,'GET',undefined,headers)).status).toBe(400);
    expect((await request(`${prefix}init.mp4`,'GET',undefined,{ ...headers,Range: 'bytes=0-8' })).status).toBe(400);
  });

  it.each([
    'https://other.invalid/stream.m3u8','//other.invalid/stream.m3u8',
    '/api/hls/aaaaaaaaaaaaaaaa/../other/master_playlist.m3u8',
    '/api/hls/aaaaaaaaaaaaaaaa/master_playlist.m3u8?token=private',
    '/api/camera_proxy_stream/camera.demo_entry','rtsp://other.invalid/stream',
  ])('refuses non-Core or credential-bearing stream references: %s',async url => {
    const upstream=await mockNativeHome({ cameraCommand: send => send({ type: 'result',id: 1,success: true,result: { url } }) });
    const { request }=await fixture({ authToken,haToken,haUrl: upstream.url });
    const response=await request(start,'GET',undefined,headers);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(url);
    expect(upstream.paths).toEqual(['/api/websocket', '/api/websocket']);
    await Promise.all(upstream.connections.map(connection => connection.closed));
  });

  it.each([
    '#EXTM3U\nhttps://other.invalid/segment.m4s\n',
    '#EXTM3U\n//other.invalid/segment.m4s\n',
    '#EXTM3U\n../playlist.m3u8\n',
    '#EXTM3U\nsegment/%2e%2e/init.mp4\n',
    '#EXTM3U\n#EXT-X-MAP:URI="http://other.invalid/init.mp4"\nsegment/12.m4s\n',
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://other.invalid/key"\nsegment/12.m4s\n',
    '#EXTM3U\n#EXT-X-PART:DURATION=1,URI="../private"\nsegment/12.m4s\n',
    '#EXTM3U\n#EXT-X-SESSION-DATA:DATA-ID="private",VALUE="do-not-forward"\nsegment/12.m4s\n',
  ])('rejects manifest URL escapes and unsupported tags instead of forwarding them',manifest => {
    expect(() => rewriteCameraManifest(manifest)).toThrow('unsupported response');
  });

  it('rejects upstream redirects, oversized manifests, invalid media and unsupported HLS with sanitized errors',async () => {
    let mode='redirect';
    const upstream=await mockNativeHome({
      media: (_req,res) => {
        if(mode==='redirect') res.writeHead(302,{ Location: '/must-not-follow' }).end();
        else if (mode === 'oversized') res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end('#EXTM3U\n' + 'x'.repeat(65536));
        else if (mode === 'token') res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,CODECS="${'a'.repeat(32)}"\nplaylist.m3u8\n`);
        else res.writeHead(200,{ 'Content-Type': 'video/mp4' }).end('not real fmp4');
      }
    });
    const { request }=await fixture({ authToken,haToken,haUrl: upstream.url });
    const stream=await (await request(start,'GET',undefined,headers)).json();
    for (mode of ['redirect', 'oversized', 'invalid', 'token']) {
      const response=await request(`/${stream.url}`,'GET',undefined,headers);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('must-not-follow');
    }
    expect(upstream.paths).not.toContain('/must-not-follow');
    const unsupported=await mockNativeHome({ cameraCommand: send => send({ type: 'result',id: 1,success: false,error: { message: 'rtsp://private.invalid:554/credential' } }) });
    const other=await fixture({ authToken,haToken,haUrl: unsupported.url });
    const response=await other.request(start,'GET',undefined,headers);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('no snapshot is being shown');
    const redirected=await mockNativeHome({ redirectWebsocket: `${upstream.url}/must-not-follow` });
    await expect(readCameraStream(redirected.websocketUrl,haToken,entity,AbortSignal.timeout(1000))).rejects.toThrow('unsupported response');
    expect(upstream.paths).not.toContain('/must-not-follow');
  });

  it('cancels the command on browser disconnect and media reads on disconnect or shutdown',async () => {
    const commandStarted=deferred();
    const stalled=await mockNativeHome({ cameraCommand: () => { commandStarted.resolve(); } });
    const commandFixture=await fixture({ authToken,haToken,haUrl: stalled.url });
    const commandAbort=new AbortController();
    const command=fetch(`${commandFixture.base}${start}`,{ headers,signal: commandAbort.signal });
    await commandStarted.promise;
    commandAbort.abort();
    await expect(command).rejects.toThrow();
    await Promise.all(stalled.connections.map(connection => connection.closed));
    for(const shutdown of [false,true]) {
      const started=deferred(),closed=deferred();
      const upstream=await mockNativeHome({
        media: (_req,res) => {
          res.once('close',() => closed.resolve()); started.resolve();
        }
      });
      const { request,base,application }=await fixture({ authToken,haToken,haUrl: upstream.url });
      const stream=await (await request(start,'GET',undefined,headers)).json();
      const abort=new AbortController();
      const pending=fetch(`${base}/${stream.url}`,{ headers,signal: abort.signal });
      await started.promise;
      if(shutdown) application.close(); else abort.abort();
      if(shutdown) expect((await pending).status).toBe(503); else await expect(pending).rejects.toThrow();
      await closed.promise;
    }
  });

  it('bounds local stream leases and expires idle media references instead of caching private frames',async () => {
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now());
    try {
      const upstream=await mockNativeHome();
      const { request }=await fixture({ authToken,haToken,haUrl: upstream.url });
      let stream: { url: string }|undefined;
      for(let index=0;index<16;index++) {
        const response=await request(start,'GET',undefined,headers);
        expect(response.status).toBe(200);
        stream=await response.json();
      }
      expect((await request(start,'GET',undefined,headers)).status).toBe(429);
      clock.mockReturnValue(Date.now()+61_000);
      expect((await request(`/${stream!.url}`,'GET',undefined,headers)).status).toBe(410);
      expect((await request(start,'GET',undefined,headers)).status).toBe(200);
      expect(upstream.paths.every(path => path==='/api/websocket')).toBe(true);
    } finally { clock.mockRestore(); }
  });
});

describe('authenticated MJPEG camera fallback', () => {
  const headers = { Authorization: 'Bearer synthetic-mjpeg-authoring' };
  const config = { authToken: 'synthetic-mjpeg-authoring', haToken: 'synthetic-mjpeg-backend' };
  const entity = 'camera.demo_entry';
  const jpeg = Buffer.from([255, 216, 255, 217]);
  function part(delimiter: string, length = true, frame = jpeg) {
    return Buffer.concat([Buffer.from(`${delimiter}\r\nContent-Type: image/jpeg\r\n${length ? `Content-Length: ${frame.length}\r\n` : ''}X-Private: discard-this-header\r\n\r\n`), frame, Buffer.from('\r\n')]);
  }
  it('stops an active multipart stream after its camera is removed from current native configuration', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const house = houseConfig();
      let output!: http.ServerResponse;
      let closed!: () => void;
      const disconnected = new Promise<void>(resolve => { closed = resolve; });
      const upstream = await mockNativeHome({ house, media: (_req, res) => {
        output = res;
        res.once('close', closed);
        res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=--frameboundary' });
        res.write(part('--frameboundary'));
      } });
      const { request } = await fixture({ ...config, haUrl: upstream.url });
      const stream = await (await request(`/api/cameras/${entity}/mjpeg`, 'GET', undefined, headers)).json();
      const response = await request(`/${stream.url}`, 'GET', undefined, headers);
      const reader = response.body!.getReader();
      expect(Buffer.from((await reader.read()).value!).includes(jpeg)).toBe(true);
      house.config.home.cameras = [];
      clock.mockReturnValue(now + 5001);
      output.write(part('--frameboundary'));
      expect(await reader.read()).toEqual({ value: undefined, done: true });
      reader.releaseLock();
      await disconnected;
      expect(upstream.messages.filter(message => message.type === 'fenton_home/house_config')).toHaveLength(2);
      expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(410);
    } finally { clock.mockRestore(); }
  });

  it.each([
    { delimiter: '--frameboundary', length: true },
    { delimiter: '----frameboundary', length: false },
  ])('normalizes genuine multipart frames and cancels upstream readers on browser disconnect: $delimiter', async ({ delimiter, length }) => {
    let closed!: () => void;
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const calls: string[] = [];
    const upstream = await mockNativeHome({ media: (req, res) => {
      calls.push(req.url!);
      expect(req.headers.authorization).toBe(`Bearer ${config.haToken}`);
      res.once('close', closed);
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=--frameboundary' });
      const body = Buffer.concat([part(delimiter, length), part(delimiter, length)]);
      res.write(body.subarray(0, 7)); res.write(body.subarray(7));
    } });
    const { request } = await fixture({ ...config, haUrl: upstream.url });
    expect((await request(`/api/cameras/${entity}/mjpeg`)).status).toBe(401);
    expect((await request('/api/cameras/camera.demo_unknown/mjpeg', 'GET', undefined, headers)).status).toBe(404);
    const stream = await (await request(`/api/cameras/${entity}/mjpeg`, 'GET', undefined, headers)).json();
    expect(stream.transport).toBe('mjpeg');
    expect(stream.url).toMatch(/^api\/cameras\/streams\/[a-f0-9]{32}\/live\.mjpeg$/);
    expect((await request(`/${stream.url}`)).status).toBe(401);
    const response = await request(`/${stream.url}`, 'GET', undefined, headers);
    expect(response.headers.get('content-type')).toBe('multipart/x-mixed-replace; boundary=studio-camera');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader = response.body!.getReader();
    const bytes = Buffer.from((await reader.read()).value!);
    expect(bytes.toString()).toContain('--studio-camera\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\n');
    expect(bytes.includes(jpeg)).toBe(true);
    for (const secret of [config.haToken, 'discard-this-header', upstream.url, '--frameboundary']) expect(bytes.toString()).not.toContain(secret);
    expect((await request(`/${stream.url}`, 'GET', undefined, headers)).status).toBe(429);
    expect((await request(`/${stream.url.replace('live.mjpeg', 'init.mp4')}`, 'GET', undefined, headers)).status).toBe(404);
    await reader.cancel();
    await disconnected;
    expect(calls).toEqual([`/api/camera_proxy_stream/${entity}`]);
    expect(upstream.messages).toEqual([
      { type: 'auth', access_token: config.haToken }, { id: 1, type: 'fenton_home/house_config' },
      { type: 'auth', access_token: config.haToken }, { id: 1, type: 'fenton_home/house_config' },
    ]);
  });

  it('cancels MJPEG while waiting for the first frame when Studio shuts down', async () => {
    let started!: () => void, closed!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const upstream = await mockNativeHome({ media: (_req, res) => { res.once('close', closed); started(); } });
    const { request, application } = await fixture({ ...config, haUrl: upstream.url });
    const stream = await (await request(`/api/cameras/${entity}/mjpeg`, 'GET', undefined, headers)).json();
    const response = request(`/${stream.url}`, 'GET', undefined, headers);
    await pending;
    application.close();
    expect((await response).status).toBe(503);
    await disconnected;
  });

  it.each(['redirect', 'boundary', 'content-type', 'headers', 'length', 'jpeg', 'credential'])('refuses unsafe MJPEG response %s without forwarding private headers/body', async mode => {
    const upstream = await mockNativeHome({ media: (_req, res) => {
      if (mode === 'redirect') { res.writeHead(302, { Location: '/must-not-follow' }).end(); return; }
      res.writeHead(200, { 'Content-Type': mode === 'boundary' ? 'multipart/x-mixed-replace; boundary=../../bad' : mode === 'content-type' ? 'image/jpeg' : 'multipart/x-mixed-replace; boundary=--frameboundary' });
      if (mode === 'headers') res.end(Buffer.from('x'.repeat(4097)));
      else if (mode === 'length') res.end('--frameboundary\r\nContent-Type: image/jpeg\r\nContent-Length: 8388609\r\n\r\n');
      else res.end(part('--frameboundary', true, mode === 'credential' ? Buffer.concat([jpeg.subarray(0, 2), Buffer.from(config.haToken), jpeg.subarray(2)]) : Buffer.from('not-jpeg')));
    } });
    const { request } = await fixture({ ...config, haUrl: upstream.url });
    const stream = await (await request(`/api/cameras/${entity}/mjpeg`, 'GET', undefined, headers)).json();
    const response = await request(`/${stream.url}`, 'GET', undefined, headers);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(config.haToken);
    expect(upstream.paths).not.toContain('/must-not-follow');
  });
});

describe('durable schema-1 draft API', () => {
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
        HA_URL: '', HA_TOKEN: '', SUPERVISOR_TOKEN: '', STUDIO_AUTH_TOKEN: '', ENABLE_LIVE_ACTIONS: 'false',
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
    const before = await readFile(path.join(directory, 'draft.json'), 'utf8');
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, 'vite-hmr');
    cleanup.push(async () => { socket.close(); });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Hot-reload client could not connect')), { once: true });
    });
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(await readdir(directory)).not.toContain('.studio.lock');
    expect(await readFile(path.join(directory, 'draft.json'), 'utf8')).toBe(before);
  }, 10000);
  it('persists saves and rejects racing stale revisions', async () => {
    const fixtureData = await fixture();
    const { request, store, directory } = fixtureData;
    const initial = await (await request('/api/draft')).json();
    initial.document.name = 'Edited household';
    const responses = await Promise.all([
      request('/api/draft', 'PUT', { document: initial.document, expectedRevision: initial.revision }),
      request('/api/draft', 'PUT', { document: initial.document, expectedRevision: initial.revision }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(store.getDraft().revision).toBe(2);
    await store.close();
    const reloaded = await StudioStore.open(directory);
    cleanup.push(() => reloaded.close());
    expect(reloaded.getDraft().document.name).toBe('Edited household');
    expect(reloaded.getDraft().revision).toBe(2);
  });
  it('accepts a full-size document with its validate and save request envelopes', async () => {
    const { request, store } = await fixture();
    const document = documentAtByteLength(1024 * 1024);
    expect(validateDocument(document)).toEqual(document);
    const validation = await request('/api/validate', 'POST', { document });
    expect(validation.status).toBe(200);
    expect(await validation.json()).toEqual({ valid: true, errors: [] });
    const saved = await request('/api/draft', 'PUT', { document, expectedRevision: 1 });
    expect(saved.status).toBe(200);
    expect(store.getDraft().document).toEqual(document);
  });
  it('rejects a one-byte-oversized document without replacing the draft', async () => {
    const { request, store } = await fixture();
    const before = store.getDraft();
    const document = documentAtByteLength(1024 * 1024 + 1);
    const validation = await request('/api/validate', 'POST', { document });
    expect(validation.status).toBe(200);
    expect(await validation.json()).toEqual({ valid: false, errors: ['document: exceeds the 1 MiB serialized size limit'] });
    const saved = await request('/api/draft', 'PUT', { document, expectedRevision: 1 });
    expect(saved.status).toBe(422);
    expect(store.getDraft()).toEqual(before);
  });
  it('has no schema-1 publish, published or event endpoints: the app reads no schema-1 document', async () => {
    const { request } = await fixture();
    expect((await request('/api/publish', 'POST', { expectedRevision: 1 })).status).toBe(404);
    expect((await request('/api/published')).status).toBe(404);
    expect((await request('/api/events')).status).toBe(404);
    expect((await (await request('/api/health')).json())).not.toHaveProperty('publishedRevision');
  });
  it('leaves a retired schema-1 publication on disk alone and opens beside it', async () => {
    const { store, directory } = await fixture();
    const draft = store.getDraft();
    const retired = `${JSON.stringify({ ...draft, publishedAt: new Date().toISOString(), capabilities: ['document-v1'] })}\n`;
    await writeFile(path.join(directory, 'published.json'), retired);
    await writeFile(path.join(directory, 'revisions/1.json'), retired);
    await store.close();
    const reopened = await StudioStore.open(directory);
    cleanup.push(() => reopened.close());
    expect(reopened.getDraft()).toEqual(draft);
    expect(await readFile(path.join(directory, 'published.json'), 'utf8')).toBe(retired);
  });
  it('exports plain versioned documents in JSON and YAML that can be imported with expectedRevision', async () => {
    const { request, store } = await fixture();
    for (const format of ['json', 'yaml']) {
      const response = await request(`/api/export?format=${format}&source=draft`);
      expect(response.status).toBe(200);
      const text = await response.text();
      const document = validateDocument(format === 'yaml' ? parse(text) : JSON.parse(text));
      expect(document).toEqual(store.getDraft().document);
      const revision = store.getDraft().revision;
      expect((await request('/api/draft', 'PUT', { document, expectedRevision: revision })).status).toBe(200);
    }
    expect((await request('/api/export?format=xml')).status).toBe(400);
    expect((await request('/api/export?format=json&source=published')).status).toBe(400);
  });
  it('fails loudly on corruption and does not replace existing corrupt files', async () => {
    const { store, directory } = await fixture();
    await store.close();
    await writeFile(path.join(directory, 'draft.json'), '{broken');
    await expect(StudioStore.open(directory)).rejects.toThrow('Cannot load Studio storage');
    expect(await readFile(path.join(directory, 'draft.json'), 'utf8')).toBe('{broken');
  });
  it('rejects a second writer using the same DATA_DIR', async () => {
    const { directory } = await fixture();
    await expect(StudioStore.open(directory)).rejects.toThrow('DATA_DIR is locked');
  });
  it('returns semantic validation errors and a generated machine-readable JSON Schema', async () => {
    const { request } = await fixture();
    const document = createSampleDocument();
    document.navigation.initialPageId = 'unknown';
    const invalid = await (await request('/api/validate', 'POST', { document })).json();
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toContain('navigation.initialPageId');
    expect((await request('/api/draft', 'PUT', { document, expectedRevision: 1 })).status).toBe(422);
    const schema = await (await request('/api/schema')).json();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.properties.schemaVersion.const).toBe('1.0');
    expect(schema.additionalProperties).toBe(false);
  });
  it('durably queues feedback and clearly does not claim GitHub submission', async () => {
    const { request, directory } = await fixture();
    const response = await request('/api/feedback', 'POST', { kind: 'report-issue', title: 'Preview issue', description: 'Details to review locally.' });
    expect(response.status).toBe(201);
    const queued = await response.json();
    expect(queued.status).toBe('queued');
    const files = await readdir(path.join(directory, 'feedback'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(directory, 'feedback', files[0]), 'utf8'))).toEqual(queued);
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

    it('serves the named house-state adapter with weather units and no configuration persistence', async () => {
      const house = houseConfig();
      house.config.home.temperature = 'weather.example';
      const upstream = await mockNativeHome({ house, states: [{ entity_id: 'weather.example', state: 'snowy', attributes: { temperature: 0, temperature_unit: 'C' } }] });
      const { request, store } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const document = store.getDraft().document;
      document.dataSources.push({ id: 'native-states', name: 'Native states', kind: 'native-home', endpoint: 'house-states', sample: [], refreshSeconds: 30 });
      document.dataSources.push({ id: 'native-profile', name: 'Profile', kind: 'native-home', endpoint: 'house-profile', sample: null, refreshSeconds: 30 });
      await store.save(validateDocument(document), 1);
      expect((await request('/api/data/native-states')).status).toBe(401);
      expect((await request('/api/data/native-profile')).status).toBe(401);
      const response = await request('/api/data/native-states', 'GET', undefined, headers);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ mode: 'live', data: [{ entityId: 'weather.example', state: 'snowy', name: 'weather.example', temperature: 0, unit: 'C' }] });
      expect(store.getDraft().document.dataSources.find(source => source.id === 'native-states')?.sample).toEqual([]);
      expect(upstream.paths).toEqual(['/api/websocket', '/api/states']);
    });

    it('restricts wallpaper to an authenticated fixed path and rejects unsafe, oversized and redirected responses', async () => {
      const paths: string[] = [];
      let variant = 'valid';
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      const upstream = http.createServer((req, res) => {
        paths.push(req.url!);
        if (variant === 'redirect') { res.writeHead(302, { Location: '/must-not-follow' }); res.end(); return; }
        res.setHeader('content-type', variant === 'svg' ? 'image/svg+xml' : 'image/png');
        res.end(variant === 'valid' ? png : variant === 'oversized' ? Buffer.alloc(2 * 1024 * 1024 + 1) : '<svg/>');
      });
      await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
      cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
      const { request } = await fixture({ authToken: authoringToken, haToken, haUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` });
      expect((await request('/api/native-wallpaper')).status).toBe(401);
      expect(paths).toEqual([]);
      const image = await request('/api/native-wallpaper', 'GET', undefined, headers);
      expect(image.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
      for (variant of ['svg', 'invalid', 'oversized', 'redirect']) expect((await request('/api/native-wallpaper', 'GET', undefined, headers)).status).toBe(502);
      expect(paths).toEqual(Array(5).fill('/local/images/house.webp'));
    });

    it('fetches the unchanged schema-2 envelope and projects only referenced safe states without actuating or saving', async () => {
      const upstream = await mockNativeHome();
      const { request, store, directory } = await fixture({ authToken: authoringToken, haUrl: upstream.url, haToken });
      const before = await readFile(path.join(directory, 'draft.json'), 'utf8');
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
      expect(await readFile(path.join(directory, 'draft.json'), 'utf8')).toBe(before);
      expect(store.getDraft().revision).toBe(1);
      expect(await (await request('/api/actions/execute', 'POST', { action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_unit' }, confirmed: true }, headers)).json()).toEqual({ mode: 'simulated', executed: false });
      expect(upstream.paths).toEqual(['/api/websocket', '/api/states']);
    });

    it('does not inherit the unauthenticated sample-demo bypass and fails explicitly without HA configuration', async () => {
      const demo = await fixture();
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
    await expect(fixture({ haUrl: 'http://example.test', haToken: 'test-backend-only-credential' })).rejects.toThrow('require STUDIO_AUTH_TOKEN');
  });
  it('protects reads and writes with a token, supports HttpOnly authoring sessions, and does not leak the token', async () => {
    const token = 'a-long-test-token-not-a-real-secret';
    const { request, base } = await fixture({ production: true, authToken: token });
    expect((await request('/api/draft')).status).toBe(401);
    expect((await request('/api/draft', 'GET', undefined, { 'X-Ingress-Path': '/fake' })).status).toBe(401);
    const authenticated = await request('/api/draft', 'GET', undefined, { Authorization: `Bearer ${token}` });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.text()).not.toContain(token);
    const login = await request('/api/auth', 'POST', { token }, { Origin: base });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await request('/api/draft', 'GET', undefined, { Cookie: cookie })).status).toBe(200);
    expect((await request('/api/validate', 'POST', { document: createSampleDocument() }, { Cookie: cookie, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/api/validate', 'POST', { document: createSampleDocument() }, { Authorization: `Bearer ${token}`, Origin: base })).status).toBe(200);
  });
  it('never trusts spoofed ingress headers from an unverified peer', async () => {
    const { request } = await fixture({ production: true, ingress: { proxyAddress: '192.0.2.10', path: '/api/hassio_ingress/verified' } });
    const response = await request('/api/draft', 'GET', undefined, { 'X-Ingress-Path': '/api/hassio_ingress/verified', 'X-Forwarded-For': '192.0.2.10' });
    expect(response.status).toBe(401);
  });
  it('requires the exact ingress path in addition to the actual verified peer', async () => {
    const { request, base } = await fixture({ production: true, ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/verified' } });
    const headers = { 'X-Ingress-Path': '/api/hassio_ingress/verified', 'X-Remote-User-Id': 'test-admin', 'X-Remote-User-Groups': 'system-admin' };
    expect((await request('/api/draft')).status).toBe(401);
    expect((await request('/api/draft', 'GET', undefined, { ...headers, 'X-Ingress-Path': '/wrong' })).status).toBe(401);
    expect((await request('/api/draft', 'GET', undefined, { 'X-Ingress-Path': headers['X-Ingress-Path'] })).status).toBe(401);
    expect((await request('/api/draft', 'GET', undefined, { ...headers, 'X-Remote-User-Groups': 'system-users' })).status).toBe(401);
    expect((await request('/api/draft', 'GET', undefined, headers)).status).toBe(200);
    expect((await request('/api/validate', 'POST', { document: createSampleDocument() }, { ...headers, Origin: base })).status).toBe(200);
  });
  it('blocks traversal, oversized requests, unsafe HA entity IDs and arbitrary proxy endpoints', async () => {
    const { request } = await fixture();
    expect((await request('/api/data/%2e%2e%2fsecret')).status).toBe(400);
    expect((await request('/api/data/https%3A%2F%2Fexample.com')).status).toBe(400);
    expect((await request('/api/proxy?url=http://169.254.169.254')).status).toBe(404);
    const oversized = await request('/api/draft', 'PUT', { document: 'x'.repeat(1024 * 1024 + 64 * 1024 + 1), expectedRevision: 1 });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'Request body exceeds 1 MiB plus 64 KiB of envelope space' });
    const oversizedLogin = await request('/api/auth', 'POST', { token: 'x'.repeat(1024 * 1024 + 1) });
    expect(oversizedLogin.status).toBe(413);
    expect(await oversizedLogin.json()).toEqual({ error: 'Request body exceeds 1 MiB' });
    const document = createSampleDocument();
    document.dataSources[1].entityId = '../config';
    expect((await request('/api/draft', 'PUT', { document, expectedRevision: 1 })).status).toBe(422);
    const data: Record<string, unknown> = {};
    let nested = data;
    for (let index = 0; index < 60; index++) { const next = {}; nested.child = next; nested = next; }
    expect((await request('/api/actions/execute', 'POST', { action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_unit', data } })).status).toBe(422);
  });
  it('labels sample data, rejects unknown IDs, and never actuates by default', async () => {
    const { request } = await fixture();
    expect((await (await request('/api/data/climate')).json()).mode).toBe('sample');
    expect((await request('/api/data/missing')).status).toBe(404);
    const response = await request('/api/actions/execute', 'POST', { action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_living_room' }, confirmed: true });
    expect(await response.json()).toEqual({ mode: 'simulated', executed: false });
    const health = await (await request('/api/health')).json();
    expect(health.mode).toBe('sample');
    expect(health.haConnected).toBe(false);
  });
  it('requires confirmation even when live services are enabled and rejects service target overrides', async () => {
    const { request } = await fixture({ enableLiveActions: true });
    const action = { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_living_room' };
    expect((await request('/api/actions/execute', 'POST', { action })).status).toBe(428);
    expect((await request('/api/actions/execute', 'POST', { action, confirmed: true })).status).toBe(503);
    expect((await request('/api/actions/execute', 'POST', { action: { ...action, data: { entity_id: 'all' } }, confirmed: true })).status).toBe(422);
  });
  it('requires JSON content types and bounds unauthenticated login attempts', async () => {
    const { request, base } = await fixture({ production: true, authToken: 'test-authoring-token-long-enough' });
    expect((await fetch(`${base}/api/auth`, { method: 'POST', body: 'token=x', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    for (let attempt = 0; attempt < 10; attempt++) expect((await request('/api/auth', 'POST', { token: 'wrong' })).status).toBe(401);
    const limited = await request('/api/auth', 'POST', { token: 'wrong' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
  it('uses only fixed live GET paths, projects safe fields, refuses redirects, and requires explicit actuation', async () => {
    const calls: { path: string; method: string; body: string }[] = [];
    const upstream = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({ path: req.url!, method: req.method!, body });
      if (req.url === '/api/states/sensor.demo_redirect') {
        res.writeHead(302, { Location: 'http://169.254.169.254/' });
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/fenton_home/config') res.end(JSON.stringify({ available: true, bundle_id: 'example.native-home', critical_alerts: true, push_url: 'http://private-internal/api', secret: 'never-forward-me' }));
      else if (req.url === '/api/states/sensor.demo_living_room_temperature') res.end(JSON.stringify({ state: '22', attributes: { friendly_name: 'Living room', unit_of_measurement: 'C', secret: 'never-forward-me', access_token: 'never-forward-me' } }));
      else if (req.url?.startsWith('/api/services/')) res.end('[]');
      else res.end('{"message":"API running"}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); });
    const token = 'test-authoring-credential-for-live-boundary';
    const { request: rawRequest, store } = await fixture({ authToken: token, haUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, haToken: 'test-backend-only-credential', enableLiveActions: true });
    const request = (endpoint: string, method = 'GET', body?: unknown) => rawRequest(endpoint, method, body, { Authorization: `Bearer ${token}` });
    const state = await (await request('/api/data/climate')).json();
    expect(state).toEqual({ mode: 'live', data: { entityId: 'sensor.demo_living_room_temperature', state: '22', name: 'Living room', unit: 'C' } });
    const document = store.getDraft().document;
    document.dataSources.push({ id: 'push-config', name: 'Push capabilities', kind: 'native-home', endpoint: 'push-config', refreshSeconds: 30, sample: null });
    document.dataSources.push({ id: 'redirect', name: 'No redirects', kind: 'ha-state', entityId: 'sensor.demo_redirect', refreshSeconds: 30, sample: null });
    await store.save(document, 1);
    const bridge = await (await request('/api/data/push-config')).json();
    expect(bridge).toEqual({ mode: 'live', data: { available: true, bundleId: 'example.native-home', criticalAlerts: true } });
    expect((await request('/api/data/redirect')).status).toBe(502);
    const action = { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_living_room' };
    expect((await request('/api/actions/execute', 'POST', { action })).status).toBe(428);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(await (await request('/api/actions/execute', 'POST', { action, confirmed: true })).json()).toEqual({ mode: 'live', executed: true });
    expect(calls.at(-1)).toEqual({ path: '/api/services/light/turn_on', method: 'POST', body: '{"entity_id":"light.demo_living_room"}' });
    expect((await (await request('/api/health')).json()).haConnected).toBe(true);
    expect(JSON.stringify(state) + JSON.stringify(bridge)).not.toContain('never-forward-me');
  });
});
