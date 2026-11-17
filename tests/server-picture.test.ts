import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { pictureType } from '../server/ha';
import { StudioStore } from '../server/store';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const haToken = 'synthetic-ha-token-that-must-never-leave-the-server';
const token = 'synthetic-picture-studio-token';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A fake Home Assistant that answers only the two picture routes, recording each request. */
async function fakeHa(answer: (url: string) => { status?: number; body?: Buffer; headers?: Record<string, string>; delay?: number }) {
  const seen: { url: string; authorization?: string }[] = [];
  // The server also opens a websocket for the house configuration; only the picture routes are recorded.
  const server = http.createServer((req, res) => {
    if (/^\/api\/(image|camera)_proxy\//.test(req.url ?? '')) seen.push({ url: req.url ?? '', authorization: req.headers.authorization });
    const reply = answer(req.url ?? '');
    setTimeout(() => { res.writeHead(reply.status ?? 200, reply.headers ?? {}); res.end(reply.body ?? PNG); }, reply.delay ?? 0);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function studio(haUrl: string | undefined) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'server-picture-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: token, ...(haUrl ? { haUrl, haToken } : {}) });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
}
const auth = { Authorization: `Bearer ${token}` };

describe('pictureType', () => {
  it('reads the type from the first bytes and never from a header', () => {
    expect(pictureType(PNG)).toBe('image/png');
    expect(pictureType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(pictureType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(pictureType(Buffer.from('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(pictureType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    expect(pictureType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('GET /api/live/picture/:entityId', () => {
  it('needs a signed-in session', async () => {
    const ha = await fakeHa(() => ({}));
    const { base } = await studio(ha.url);
    expect((await fetch(`${base}/api/live/picture/camera.example_map`)).status).toBe(401);
    expect(ha.seen).toHaveLength(0);
  });
  it('answers 503 when Home Assistant is not configured', async () => {
    const { base } = await studio(undefined);
    expect((await fetch(`${base}/api/live/picture/camera.example_map`, { headers: auth })).status).toBe(503);
  });
  it('refuses an entity that is not an image or a camera, whatever the draft says', async () => {
    const ha = await fakeHa(() => ({}));
    const { base } = await studio(ha.url);
    for (const id of ['light.example_lamp', 'camera', 'camera.Bad', 'camera.demo%2Fb', '..%2Fapi']) expect([400, 404]).toContain((await fetch(`${base}/api/live/picture/${id}`, { headers: auth })).status);
    expect(ha.seen).toHaveLength(0);
  });
  it('refuses a camera the draft does not name', async () => {
    const ha = await fakeHa(() => ({}));
    const { base } = await studio(ha.url);
    expect((await fetch(`${base}/api/live/picture/camera.example_unnamed`, { headers: auth })).status).toBe(404);
    expect(ha.seen).toHaveLength(0);
  });
  it('serves a named picture with the server token only, no-store, typed by its bytes', async () => {
    const ha = await fakeHa(() => ({ headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'x=1', 'X-Upstream': 'secret' } }));
    const { base, store } = await studio(ha.url);
    const draft = store.native.peekDraft();
    store.native.peekDraft = () => ({ ...draft, document: { ...(draft.document as object), picture: 'image.example_floor' } }) as never;
    const response = await fetch(`${base}/api/live/picture/image.example_floor`, { headers: auth });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-upstream')).toBeNull();
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    expect(ha.seen).toEqual([{ url: '/api/image_proxy/image.example_floor', authorization: `Bearer ${haToken}` }]);
  });
  it('serves a vacuum map camera for a map id the draft carries', async () => {
    const ha = await fakeHa(() => ({}));
    const { base, store } = await studio(ha.url);
    const draft = store.native.peekDraft();
    store.native.peekDraft = () => ({ ...draft, document: { ...(draft.document as object), source: { mapId: 'example_robot' } } }) as never;
    expect((await fetch(`${base}/api/live/picture/camera.example_robot_map_data`, { headers: auth })).status).toBe(200);
    expect(ha.seen[0].url).toBe('/api/camera_proxy/camera.example_robot_map_data');
  });
  async function named(ha: { url: string }, id: string) {
    const { base, store } = await studio(ha.url);
    const draft = store.native.peekDraft();
    store.native.peekDraft = () => ({ ...draft, document: { ...(draft.document as object), picture: id } }) as never;
    return base;
  }
  it('serves the snapshot picture of a camera source the draft names, with the token kept on the server', async () => {
    const ha = await fakeHa(() => ({ body: PNG }));
    const { base, store } = await studio(ha.url);
    const draft = store.native.peekDraft();
    store.native.peekDraft = () => ({ ...draft, document: { dataSources: [{ id: 'cam', kind: 'model', model: 'camera-stream@1',
      inputs: { entityId: { type: 'literal', value: 'camera.demo_porch' }, snapshotEntityId: { type: 'literal', value: 'camera.demo_porch_snapshot' } } }] } }) as never;
    const response = await fetch(`${base}/api/live/picture/camera.demo_porch_snapshot`, { headers: auth });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(ha.seen.map(item => item.url)).toEqual(['/api/camera_proxy/camera.demo_porch_snapshot']);
    expect(ha.seen[0].authorization).toBe(`Bearer ${haToken}`);
    expect((await fetch(`${base}/api/live/picture/camera.demo_other`, { headers: auth })).status).toBe(404);
  });
  it('does not follow a redirect', async () => {
    const ha = await fakeHa(() => ({ status: 302, headers: { Location: 'http://127.0.0.1:1/elsewhere' } }));
    const response = await fetch(`${await named(ha, 'camera.example_cam')}/api/live/picture/camera.example_cam`, { headers: auth });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('127.0.0.1');
  });
  it('refuses a body that is not a picture', async () => {
    const ha = await fakeHa(() => ({ body: Buffer.from('<html>no</html>'), headers: { 'Content-Type': 'image/png' } }));
    expect((await fetch(`${await named(ha, 'camera.example_cam')}/api/live/picture/camera.example_cam`, { headers: auth })).status).toBe(502);
  });
  it('maps an upstream 404 to 404 and a failure to 502 without upstream text', async () => {
    const missing = await fakeHa(() => ({ status: 404, body: Buffer.from('upstream words') }));
    const a = await fetch(`${await named(missing, 'camera.example_cam')}/api/live/picture/camera.example_cam`, { headers: auth });
    expect(a.status).toBe(404); expect(await a.text()).not.toContain('upstream words');
    const down = await fakeHa(() => ({ status: 503, body: Buffer.from('upstream words') }));
    const b = await fetch(`${await named(down, 'camera.example_cam')}/api/live/picture/camera.example_cam`, { headers: auth });
    expect(b.status).toBe(502); expect(await b.text()).not.toContain('upstream words');
  });
  it('caps the body', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]);
    const ha = await fakeHa(() => ({ body: big }));
    expect((await fetch(`${await named(ha, 'camera.example_cam')}/api/live/picture/camera.example_cam`, { headers: auth })).status).toBe(502);
  });
  it('limits pictures in flight', async () => {
    const ha = await fakeHa(() => ({ delay: 400 }));
    const base = await named(ha, 'camera.example_cam');
    const answers = await Promise.all(Array.from({ length: 10 }, () => fetch(`${base}/api/live/picture/camera.example_cam`, { headers: auth }).then(r => r.status)));
    expect(answers.filter(code => code === 429).length).toBeGreaterThan(0);
    expect(answers.filter(code => code === 200).length).toBe(8);
  });
});
