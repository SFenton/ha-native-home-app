import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import type { ServerConfig } from '../server/config';
import { StudioStore } from '../server/store';
import { compositionAssetManifestHash, validateCompositionPublication } from '../server/composition';
import { readerRequest } from '../server/publication-readers';
import { canonicalCompositionJSON, MAX_COMPOSITION_ENVELOPE_BYTES } from '../src/shared/composition/json';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionDraft, UploadedCompositionAsset } from '../src/shared/composition/workspace';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = 'synthetic-composition-token';
const auth = { Authorization: `Bearer ${token}` };

it('keeps canonical local HA origins but never issues remote-HTTP or author-scope reader grants', () => {
  const request = { haServer: 'https://ha.example.test', haUserID: 'demo-user',
    publisherURL: 'https://publisher.example.test/native', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  for (const haServer of ['http://homeassistant.local:8123', 'http://127.0.0.1:8123', 'http://[::1]:8123', 'http://[::ffff:7f00:1]:8123']) {
    expect(readerRequest.parse({ ...request, haServer }).haServer).toBe(haServer);
  }
  for (const update of [{ haServer: 'http://remote.example.test' }, { haServer: 'https://ha.example.test/path' },
    { publisherURL: 'http://publisher.example.test/native' }, { publisherURL: 'https://publisher.example.test:0/native' },
    { publisherURL: 'https://publisher.example.test/native/%00' }, { scope: 'author' }]) {
    expect(() => readerRequest.parse({ ...request, ...update })).toThrow();
  }
});
// Generated from the synthetic one-pixel PNG, with no production/reference media.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+I6KKK/bD8jP/9k=', 'base64');

function png(width = 1, height = 1) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 40, 80, 120, 255]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function fixture(authenticated = true, overrides: Partial<ServerConfig> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'composition-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, {
    production: false, port: 0, host: '127.0.0.1', dataDir: directory, enableLiveActions: false,
    ...(authenticated ? { authToken: token } : {}), ...overrides,
  });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    application.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const raw = (endpoint: string, init?: RequestInit) => fetch(`${base}${endpoint}`, init);
  const request = (endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) =>
    raw(endpoint, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const draft = async (): Promise<CompositionDraft> => (await request('/native/api/draft')).json();
  const upload = (bytes = png(), mime = 'image/png') => raw('/native/api/assets', { method: 'POST', headers: { ...auth, 'Content-Type': mime }, body: bytes });
  return { directory, store, raw, request, draft, upload };
}
function withWallpaper(document: CompositionDocument, asset: UploadedCompositionAsset): CompositionDocument {
  return {
    ...document, assets: [{ ...asset, id: 'asset-synthetic', role: 'backdrop' }],
    theme: {
      ...document.theme, background: {
        type: 'downloaded', assetId: 'asset-synthetic', recipe: 'house-r3@1', blur: { type: 'fixed', percent: 40 },
        scrim: { type: 'canonical@1' }, motion: 'stationary@1', reducedTransparency: 'canonical-base@1',
      },
    },
  };
}

describe('separate authenticated native composition pipeline', () => {
  it('issues durable reader-only grants scoped to published identity and published assets, with revocation', async () => {
    const f = await fixture(), first = await f.draft();
    const asset: UploadedCompositionAsset = await (await f.upload()).json();
    const saved: CompositionDraft = await (await f.request('/native/api/draft', 'PUT', {
      expectedRevision: first.revision, document: withWallpaper(first.document, asset),
    })).json();
    await f.request('/native/api/publish', 'POST', { expectedRevision: saved.revision });
    const response = await f.request('/native/api/readers', 'POST', {
      haServer: 'https://ha.example.test', haUserID: 'synthetic-user',
      publisherURL: 'https://publisher.example.test/native', expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(response.status).toBe(201);
    const enrollment = await response.json();
    expect(enrollment.publisherID).toBe(first.publisherId);
    const reader = { Authorization: `Bearer ${enrollment.credential}` };
    const get = await f.request('/native/api/published', 'GET', undefined, reader);
    expect(get.status).toBe(200);
    expect((await f.request('/native/api/published', 'HEAD', undefined, reader)).status).toBe(200);
    expect((await f.request('/native/api/published', 'GET', undefined,
      { ...reader, 'If-None-Match': get.headers.get('etag')! })).status).toBe(304);
    expect((await f.request(`/native${asset.source.path}`, 'GET', undefined, reader)).status).toBe(200);
    const unpublished: UploadedCompositionAsset = await (await f.upload(jpeg, 'image/jpeg')).json();
    for (const endpoint of ['/native/api/draft', '/native/api/assets', '/native/api/export', '/native/api/schema',
      '/api/native-home', '/api/actions', '/api/events', '/native/api/published?extra=1', `/native${unpublished.source.path}`])
      expect((await f.request(endpoint, 'GET', undefined, reader)).status).toBe(401);
    for (const endpoint of ['/native/api/publish', '/native/api/readers', '/api/actions', '/native/api/auth'])
      expect((await f.request(endpoint, 'POST', {}, reader)).status).toBe(401);
    const disk = await readFile(path.join(f.directory, 'native-v2/publication-readers.json'), 'utf8');
    expect(disk).not.toContain(enrollment.credential);
    const { PublicationReaders } = await import('../server/publication-readers');
    const reopened = await PublicationReaders.open(path.join(f.directory, 'native-v2'));
    expect(reopened.permits(enrollment.credential, f.store.native.getPublished(), '/native/api/published')).toBe(true);
    expect(reopened.permits(enrollment.credential, { ...f.store.native.getPublished(), publisherId: 'other' }, '/native/api/published')).toBe(false);
    expect(reopened.permits(enrollment.credential, f.store.native.getPublished(), '/native/api/published', (enrollment.expiresAt + 1) * 1000)).toBe(false);
    expect((await f.request(`/native/api/readers/${enrollment.grantID}`, 'DELETE', {}, reader)).status).toBe(401);
    expect((await f.request(`/native/api/readers/${enrollment.grantID}`, 'DELETE', {})).status).toBe(204);
    expect((await f.request('/native/api/published', 'GET', undefined, reader)).status).toBe(401);
    expect((await f.request('/native/api/draft')).status).toBe(200);
  });

  it('retains schema-1 work, durable identities, exact publication closure and immutable revisions across restart', async () => {
    const f = await fixture();
    const legacy = f.store.getDraft();
    await f.store.publish(legacy.revision);
    const legacyDraftBytes = await readFile(path.join(f.directory, 'draft.json'));
    const legacyPublicationBytes = await readFile(path.join(f.directory, 'published.json'));
    const first = await f.draft();
    expect(first.document.schemaVersion).toBe('2.0');
    expect((await f.request('/native/api/published')).status).toBe(404);
    const savedResponse = await f.request('/native/api/draft', 'PUT', {
      document: { ...first.document, name: 'Synthetic authored composition' }, expectedRevision: first.revision,
    });
    expect(savedResponse.status).toBe(200);
    const saved: CompositionDraft = await savedResponse.json();
    expect(saved.revision).toBe(2);
    expect(saved.publisherId).toBe(first.publisherId);
    expect(saved.assetManifestSha256).toBe(compositionAssetManifestHash([]));
    const publishedResponse = await f.request('/native/api/publish', 'POST', { expectedRevision: saved.revision });
    expect(publishedResponse.status).toBe(200);
    const published = validateCompositionPublication(await publishedResponse.json());
    const snapshot = await readFile(path.join(f.directory, 'native-v2/revisions/2.json'));
    const get = await f.request('/native/api/published');
    expect(await get.json()).toEqual(published);
    expect((await f.request('/native/api/published', 'GET', undefined, { ...auth, 'If-None-Match': `W/${get.headers.get('etag')}` })).status).toBe(304);
    expect((await f.request('/native/api/published', 'GET', undefined, { ...auth, 'If-None-Match': '*' })).status).toBe(304);
    expect((await f.request('/native/api/publish', 'POST', { expectedRevision: saved.revision })).status).toBe(200);
    expect(await readFile(path.join(f.directory, 'native-v2/revisions/2.json'))).toEqual(snapshot);
    await f.store.close();
    const reopened = await StudioStore.open(f.directory);
    cleanup.push(() => reopened.close());
    expect(reopened.native.getDraft()).toEqual(saved);
    expect(reopened.native.getPublished()).toEqual(published);
    expect(reopened.getDraft()).toEqual(legacy);
    expect(await readFile(path.join(f.directory, 'draft.json'))).toEqual(legacyDraftBytes);
    expect(await readFile(path.join(f.directory, 'published.json'))).toEqual(legacyPublicationBytes);
  });

  it('preserves last publication and draft on invalid content, stale writes and identity changes', async () => {
    const f = await fixture(), first = await f.draft();
    await f.request('/native/api/publish', 'POST', { expectedRevision: 1 });
    const state = await readFile(path.join(f.directory, 'native-v2/state.json'));
    const published = f.store.native.getPublished();
    const invalid = { ...first.document, unknownPolicy: true };
    const invalidSave = await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document: invalid });
    expect(invalidSave.status).toBe(422);
    expect((await invalidSave.json()).issues).toContainEqual({ code: 'unknown_field', pointer: '/document/unknownPolicy' });
    expect((await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document: { ...first.document, id: 'different-document' } })).status).toBe(422);
    expect(await readFile(path.join(f.directory, 'native-v2/state.json'))).toEqual(state);
    await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document: { ...first.document, name: 'New local draft' } });
    expect((await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document: first.document })).status).toBe(409);
    expect((await f.request('/native/api/publish', 'POST', { expectedRevision: 1 })).status).toBe(409);
    expect(f.store.native.getPublished()).toEqual(published);
    expect(f.store.native.getDraft().document.name).toBe('New local draft');
    expect((await readdir(path.join(f.directory, 'native-v2/revisions'))).filter(name => name.endsWith('.json'))).toEqual(['1.json']);
  });

  it('rejects duplicate decoded keys, invalid UTF-8, nested duplicate keys and oversized route input before parsing loses information', async () => {
    const f = await fixture();
    for (const body of [
      '{"expectedRevision":1,"expected\\u0052evision":2}',
      '{"document":{"schemaVersion":"2.0","schemaVersion":"2.0"},"expectedRevision":1}',
      Buffer.from([0xff, 0x7b, 0x7d]),
    ]) {
      const response = await f.raw('/native/api/draft', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body });
      expect(response.status).toBe(422);
    }
    const body = JSON.stringify({ expectedRevision: 1, document: f.store.native.getDraft().document });
    const exact = await f.raw('/native/api/draft', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: body + ' '.repeat(MAX_COMPOSITION_ENVELOPE_BYTES - Buffer.byteLength(body)) });
    expect(exact.status).toBe(200);
    const response = await f.raw('/native/api/draft', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: ' '.repeat(MAX_COMPOSITION_ENVELOPE_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request body exceeds 2 MiB plus 64 KiB of envelope space' });
    expect(f.store.native.getDraft().revision).toBe(2);
  });

  it('reuses verified Ingress identity without trusting spoofed or non-admin headers', async () => {
    const f = await fixture(false, { ingress: { proxyAddress: '127.0.0.1', path: '/api/hassio_ingress/synthetic' } });
    const headers = {
      'X-Ingress-Path': '/api/hassio_ingress/synthetic', 'X-Remote-User-Id': 'synthetic-user', 'X-Remote-User-Groups': 'system-admin',
    };
    expect((await f.request('/native/api/draft', 'GET', undefined, headers)).status).toBe(200);
    expect((await f.request('/native/api/draft', 'GET', undefined, { ...headers, 'X-Remote-User-Groups': 'system-users' })).status).toBe(401);
    expect((await f.request('/native/api/draft', 'GET', undefined, { ...headers, 'X-Ingress-Path': '/spoofed' })).status).toBe(401);
  });

  it('serializes competing saves and recovers a snapshot left before publication pointer selection', async () => {
    const f = await fixture(), first = await f.draft();
    const saves = await Promise.allSettled([
      f.store.native.save({ ...first.document, name: 'First writer' }, 1),
      f.store.native.save({ ...first.document, name: 'Stale second writer' }, 1),
    ]);
    expect(saves.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(f.store.native.getDraft().revision).toBe(2);
    const state = await readFile(path.join(f.directory, 'native-v2/state.json'));
    const published = await f.store.native.publish(2);
    const snapshot = await readFile(path.join(f.directory, 'native-v2/revisions/2.json'));
    await f.store.close();
    await writeFile(path.join(f.directory, 'native-v2/state.json'), state);
    const reopened = await StudioStore.open(f.directory);
    cleanup.push(() => reopened.close());
    expect(() => reopened.native.getPublished()).toThrow('No native composition');
    expect(await reopened.native.publish(2)).toEqual(published);
    expect(await readFile(path.join(f.directory, 'native-v2/revisions/2.json'))).toEqual(snapshot);
  });

  it('requires real auth even in development, shares session login, and retains origin and JSON write restrictions', async () => {
    const dev = await fixture(false);
    for (const endpoint of ['/native/api/draft', '/native/api/published', '/native/api/assets', `/native/api/assets/${'a'.repeat(64)}.png`])
      expect((await dev.request(endpoint, 'GET', undefined, {})).status).toBe(401);
    const f = await fixture();
    expect((await f.request('/native/api/draft', 'GET', undefined, {})).status).toBe(401);
    expect((await f.request('/native/api/publish', 'POST', { expectedRevision: 1 }, { ...auth, Origin: 'https://other.invalid' })).status).toBe(403);
    expect((await f.raw('/native/api/publish', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    const login = await f.request('/native/api/auth', 'POST', { token }, {});
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await f.request('/native/api/draft', 'GET', undefined, { Cookie: cookie })).status).toBe(200);
    expect((await f.request('/native/api/unknown')).status).toBe(404);
    expect((await f.request('/native/api/assets/%2e%2e%2fstate.json')).status).toBe(400);
    expect((await f.request('/native/api/schema')).status).toBe(200);
  });

  it('computes immutable PNG descriptors, rejects missing/mismatched assets and preserves old images after changes/restart', async () => {
    const f = await fixture(), first = await f.draft(), bytes = png();
    const upload = await f.upload(bytes);
    expect(upload.status).toBe(201);
    const asset: UploadedCompositionAsset = await upload.json();
    expect(asset).toMatchObject({ sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, pixelWidth: 1, pixelHeight: 1, mimeType: 'image/png' });
    expect((await f.upload(bytes)).status).toBe(201);
    const document = withWallpaper(first.document, asset);
    const save = await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document });
    expect(save.status).toBe(200);
    await f.request('/native/api/publish', 'POST', { expectedRevision: 2 });
    const published = f.store.native.getPublished();
    const image = await f.request(`/native${asset.source.path}`);
    expect(image.headers.get('content-type')).toContain('image/png');
    expect(image.headers.get('cache-control')).toContain('private');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    expect((await f.request(`/native${asset.source.path}`, 'GET', undefined, { ...auth, 'If-None-Match': image.headers.get('etag')! })).status).toBe(304);
    const mismatch = structuredClone(document);
    mismatch.assets[0].pixelWidth = 2;
    expect((await f.request('/native/api/draft', 'PUT', { expectedRevision: 2, document: mismatch })).status).toBe(422);
    expect(f.store.native.getPublished()).toEqual(published);
    expect((await f.request('/native/api/draft', 'PUT', { expectedRevision: 2, document: first.document })).status).toBe(200);
    await f.request('/native/api/publish', 'POST', { expectedRevision: 3 });
    await f.store.close();
    const reopened = await StudioStore.open(f.directory);
    cleanup.push(() => reopened.close());
    expect((await reopened.native.readAsset(asset.source.path.split('/').at(-1)!)).bytes).toEqual(bytes);
    expect(await readFile(path.join(f.directory, 'native-v2/revisions/2.json'), 'utf8')).toBe(canonicalCompositionJSON(published));
    expect(reopened.native.getPublished().document.assets).toEqual([]);
    expect(await reopened.native.listAssets()).toEqual([asset]);
  });

  it('fails closed on malformed images, wrong MIME, excessive dimensions, missing bytes and on-disk corruption', async () => {
    const f = await fixture(), first = await f.draft();
    expect((await f.upload(Buffer.from('not an image'))).status).toBe(422);
    expect((await f.upload(png(), 'image/jpeg')).status).toBe(422);
    expect((await f.upload(png(), 'image/webp')).status).toBe(415);
    expect((await f.upload(png(8193, 1))).status).toBe(422);
    expect((await f.upload(png(5000, 5000))).status).toBe(422);
    const corrupt = png(); corrupt[corrupt.length - 1] ^= 1;
    expect((await f.upload(corrupt)).status).toBe(422);
    expect((await f.upload(Buffer.alloc(8388609))).status).toBe(413);
    const asset: UploadedCompositionAsset = await (await f.upload()).json();
    const document = withWallpaper(first.document, asset);
    await f.request('/native/api/draft', 'PUT', { expectedRevision: 1, document });
    await f.request('/native/api/publish', 'POST', { expectedRevision: 2 });
    const snapshot = f.store.native.getPublished();
    const file = path.join(f.directory, 'native-v2/assets', asset.source.path.split('/').at(-1)!);
    await unlink(file);
    expect((await f.request('/native/api/publish', 'POST', { expectedRevision: 2 })).status).toBe(422);
    expect(f.store.native.getPublished()).toEqual(snapshot);
    expect((await f.request('/native/api/draft', 'PUT', { expectedRevision: 2, document })).status).toBe(422);
    await writeFile(file, png(2, 1));
    expect((await f.request(`/native${asset.source.path}`)).status).toBe(422);
    await f.store.close();
    await expect(StudioStore.open(f.directory)).rejects.toThrow('existing data was not replaced');
  });

  it('accepts a real synthetic JPEG container and rejects truncated/mislabeled JPEG bytes', async () => {
    const f = await fixture();
    const uploaded = await f.upload(jpeg, 'image/jpeg');
    expect(uploaded.status).toBe(201);
    const asset: UploadedCompositionAsset = await uploaded.json();
    expect(asset).toMatchObject({ mimeType: 'image/jpeg', pixelWidth: 1, pixelHeight: 1, byteLength: jpeg.length });
    expect(asset.source.path).toBe(`/api/assets/${asset.sha256}.jpg`);
    const served = await f.request(`/native${asset.source.path}`);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(jpeg);
    expect((await f.upload(jpeg.subarray(0, jpeg.length - 2), 'image/jpeg')).status).toBe(422);
    expect((await f.upload(jpeg, 'image/png')).status).toBe(422);
  });

  it('rejects corrupt native manifests on restart instead of silently initializing or replacing saved work', async () => {
    const f = await fixture();
    const file = path.join(f.directory, 'native-v2/state.json');
    await f.store.close();
    const saved = JSON.parse(await readFile(file, 'utf8'));
    saved.draft.capabilities = [];
    const corrupted = JSON.stringify(saved);
    await writeFile(file, corrupted);
    await expect(StudioStore.open(f.directory)).rejects.toThrow('existing data was not replaced');
    expect(await readFile(file, 'utf8')).toBe(corrupted);
  });

  it('does not silently replace native identity when persisted state is missing beside publication artifacts', async () => {
    const f = await fixture();
    await f.store.native.publish(1);
    const snapshot = await readFile(path.join(f.directory, 'native-v2/revisions/1.json'));
    await f.store.close();
    await unlink(path.join(f.directory, 'native-v2/state.json'));
    await expect(StudioStore.open(f.directory)).rejects.toThrow('existing data was not replaced');
    expect(await readFile(path.join(f.directory, 'native-v2/revisions/1.json'))).toEqual(snapshot);
  });
});
