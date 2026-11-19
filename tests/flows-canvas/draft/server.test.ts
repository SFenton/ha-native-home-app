import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../server/app';
import { StudioStore } from '../../../server/store';
import { validateCompositionPublication } from '../../../server/composition';
import { HaPublicationClient } from '../../../server/ha-publication';
import type { prepareDraft } from '../../../server/studio-logic/prepare';
import type { CompositionDraft } from '../../../src/shared/composition/workspace';
import type { CompositionPublication } from '../../../src/shared/composition/schema';
import { canonicalCompositionJSON, CompositionValidationError } from '../../../src/shared/composition/json';
import { atPointer, replacePointer } from '../../../src/shared/composition/studio-logic';
import { fakeHomeAssistant } from '../../fake-ha-publication';
import { draftDocument } from './fixtures';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const port = 4821, mount = '/api/hassio_ingress/w2-d/';
const dataRoot = path.resolve('./test-results/studio-data/w2-d');
const authToken = 'synthetic-w2-d-studio-token', haToken = 'synthetic-w2-d-ha-token';
const hash = (document: unknown) => createHash('sha256').update(canonicalCompositionJSON(document)).digest('hex');

async function lab() {
  if (process.env.STUDIO_E2E_PORT && process.env.STUDIO_E2E_PORT !== String(port)) throw new Error('W2-D requires port 4821');
  if (process.env.STUDIO_E2E_DATA_DIR && path.resolve(process.env.STUDIO_E2E_DATA_DIR) !== dataRoot) throw new Error('W2-D requires its isolated data directory');
  await mkdir(dataRoot, { recursive: true });
  const directory = await mkdtemp(path.join(dataRoot, 'server-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const fake = await fakeHomeAssistant({ token: haToken });
  cleanups.push(() => fake.close());
  const store = await StudioStore.open(directory);
  cleanups.push(() => store.close());
  const application = createApp(store, { production: false, port, host: '127.0.0.1', dataDir: directory, authToken, haUrl: fake.url, haToken });
  application.app.use(application.errorHandler);
  const host = http.createServer((request, response) => {
    if (!request.url?.startsWith(mount)) { response.writeHead(404).end(); return; }
    request.url = `/${request.url.slice(mount.length)}`;
    application.app(request, response);
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    application.close();
    host.closeAllConnections();
    if (host.listening) await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()));
  };
  cleanups.push(close);
  await new Promise<void>((resolve, reject) => { host.once('error', reject); host.listen(port, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${port}${mount}`;
  const request = (endpoint: string, method = 'GET', body?: unknown) => fetch(`${base}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${authToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const draft = async (): Promise<CompositionDraft> => {
    const response = await request('native/api/draft');
    expect(response.status).toBe(200);
    return response.json();
  };
  const prepare = async (document: unknown): Promise<ReturnType<typeof prepareDraft>> => {
    const response = await request('native/api/draft/prepare', 'POST', { document });
    expect(response.status).toBe(200);
    return response.json();
  };
  await draft();
  return { fake, store, directory, request, draft, prepare, close };
}

describe('D-layout / D-binding / D-strip: mounted real draft and publication routes', () => {
  it('saves/reopens raw layout and bindings, exports the draft losslessly, and strips every publication/download/HA entry point', async () => {
    const f = await lab(), initial = await f.draft();
    const document = { ...draftDocument(initial.document.id), studioCanvas: { version: 400, future: ['retained', { x: 90 }] } };
    const savedResponse = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document });
    expect(savedResponse.status).toBe(200);
    const saved: CompositionDraft = await savedResponse.json();
    expect(saved.document).toEqual(document);
    expect((await f.draft()).document).toEqual(document);
    expect(await (await f.request('native/api/export?source=draft')).json()).toEqual(document);
    const prepared = await f.prepare(document);
    expect(prepared.layout.warnings).toEqual([expect.objectContaining({ code: 'invalid_layout' })]);
    expect(prepared.sourceMap).toContainEqual(expect.objectContaining({
      authoredPointer: '/pages/0/components/1/props/subtitle/value/args/source',
      sourcePointer: '/pages/0/components/1/props/titleProviderId',
    }));
    const validation = await f.request('native/api/validate', 'POST', { document });
    expect(await validation.json()).toEqual({ valid: true, capabilities: saved.capabilities });

    const publicationResponse = await f.request('native/api/publish', 'POST', { expectedRevision: saved.revision });
    expect(publicationResponse.status).toBe(200);
    const publication: CompositionPublication = await publicationResponse.json();
    expect(publication.document).toEqual(prepared.expanded);
    expect(hash(publication.document)).toBe(prepared.publicationDocumentSha256);
    expect(JSON.stringify(publication.document)).not.toMatch(/logic-ref|"hole"|logicLibrary|studioCanvas|logicUseBindings/);
    expect(atPointer(publication.document, '/pages/0/components/1/props/subtitle/value/from/sourceId')).toBe('source-b');
    expect(await (await f.request('native/api/published')).json()).toEqual(publication);
    expect(await (await f.request('native/api/export?source=published')).json()).toEqual(publication.document);
    expect(() => validateCompositionPublication({ ...publication, document: { ...publication.document, studioCanvas: null } })).toThrow(CompositionValidationError);
    expect(() => validateCompositionPublication({ ...publication, document: { ...publication.document, logicUseBindings: [] } })).toThrow(CompositionValidationError);

    const sent = await f.request('native/api/ha/publish', 'POST', { expectedRevision: saved.revision });
    expect(sent.status).toBe(200);
    expect(f.fake.state.current?.envelope.document).toEqual(publication.document);
    expect(JSON.stringify(f.fake.state.current?.envelope)).not.toContain(haToken);
    expect(JSON.stringify(prepared)).not.toContain(authToken);
    // The HA service also prepares an authored document when called outside the HTTP/store path.
    const client = new HaPublicationClient({ base: f.fake.url, token: haToken, websocketUrl: `${f.fake.url.replace('http:', 'ws:')}/api/websocket` });
    try { await client.publish({ ...publication, document: saved.document }); }
    finally { client.close(); }
    expect(f.fake.state.current?.envelope.document).toEqual(publication.document);

    await f.close();
    await f.store.close();
    const reopened = await StudioStore.open(f.directory);
    cleanups.push(() => reopened.close());
    expect(reopened.native.getDraft().document).toEqual(document);
    expect(reopened.native.getPublished()).toEqual(publication);
  });

  it('keeps the publication document hash and live comparison unchanged after metadata-only saves', async () => {
    const f = await lab(), initial = await f.draft();
    const document = draftDocument(initial.document.id);
    const saved: CompositionDraft = await (await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document })).json();
    expect((await f.request('native/api/ha/publish', 'POST', { expectedRevision: saved.revision })).status).toBe(200);
    const publication: CompositionPublication = await (await f.request('native/api/published')).json();
    const before = await f.prepare(document);
    const edited = { ...document, studioCanvas: { version: 1, canvases: [], bundles: [{ id: 'output', name: 'Only presentation', outputs: [{ name: 'Label', logicId: 'tile-label' }] }] } };
    const after = await f.prepare(edited);
    expect(after.publicationDocumentSha256).toBe(before.publicationDocumentSha256);
    expect(canonicalCompositionJSON(after.expanded)).toBe(canonicalCompositionJSON(before.expanded));
    const metadataSave: CompositionDraft = await (await f.request('native/api/draft', 'PUT', { expectedRevision: saved.revision, document: edited })).json();
    expect(metadataSave.revision).toBe(saved.revision + 1);
    expect((await (await f.request('native/api/ha/publication')).json()).draftIsLive).toBe(true);
    expect(await (await f.request('native/api/ha/open-check')).json()).toMatchObject({ action: 'keep', reason: 'already-published' });
    expect(await (await f.request('native/api/published')).json()).toEqual(publication);
    const next: CompositionPublication = await (await f.request('native/api/publish', 'POST', { expectedRevision: metadataSave.revision })).json();
    expect(hash(next.document)).toBe(hash(publication.document));
    expect(next.document).toEqual(publication.document);
    expect((await f.draft()).document).toEqual(edited);
  });

  it('refuses invalid semantic bindings through prepare and save, leaving disk and publication untouched', async () => {
    const f = await lab(), initial = await f.draft();
    expect((await f.request('native/api/publish', 'POST', { expectedRevision: initial.revision })).status).toBe(200);
    const published = f.store.native.getPublished(), disk = await readFile(path.join(f.directory, 'native-v2/state.json'), 'utf8');
    const invalid = replacePointer(draftDocument(initial.document.id), '/pages/0/components/1/props/titleProviderId', 7);
    for (const [endpoint, body] of [
      ['native/api/draft/prepare', { document: invalid }],
      ['native/api/draft', { document: invalid, expectedRevision: initial.revision }],
    ] as const) {
      const response = await f.request(endpoint, endpoint.endsWith('prepare') ? 'POST' : 'PUT', body);
      expect(response.status).toBe(422);
      expect((await response.json()).issues).toContainEqual({ code: 'binding_type', pointer: '/document/logicUseBindings/1/from/field' });
    }
    expect(await f.draft()).toEqual(initial);
    expect(await readFile(path.join(f.directory, 'native-v2/state.json'), 'utf8')).toBe(disk);
    expect(f.store.native.getPublished()).toEqual(published);
    expect(f.fake.messages.some(message => message.type === 'fenton_home/ui_publication/publish')).toBe(false);
    expect((await readdir(path.join(f.directory, 'native-v2'))).some(name => name.endsWith('.tmp'))).toBe(false);
  });
});

describe('D-conflict: revision preconditions are atomic and retain the caller buffer', () => {
  it('induces a 409, retains local AST/layout/bindings, exposes the current revision, and persists only the winner', async () => {
    const f = await lab(), initial = await f.draft();
    const local = { ...draftDocument(initial.document.id), name: 'Local unsaved work', studioCanvas: { version: 1, canvases: [] } };
    const before = structuredClone(local);
    const remote = { ...draftDocument(initial.document.id), name: 'Concurrent saved work', studioCanvas: { version: 27 } };
    const winning = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: remote });
    expect(winning.status).toBe(200);
    const winner: CompositionDraft = await winning.json();
    const refused = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: local });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ currentRevision: winner.revision, error: expect.stringContaining('local edits were retained') });
    expect(local).toEqual(before);
    expect(await f.draft()).toEqual(winner);
    const stalePublish = await f.request('native/api/ha/publish', 'POST', { expectedRevision: initial.revision });
    expect(stalePublish.status).toBe(409);
    expect(f.fake.messages.some(message => message.type === 'fenton_home/ui_publication/publish')).toBe(false);
    // Explicit retry is the caller's choice, using the still-intact local document and the new revision.
    const retry = await f.request('native/api/draft', 'PUT', { expectedRevision: winner.revision, document: local });
    expect(retry.status).toBe(200);
    const saved: CompositionDraft = await retry.json();
    expect(saved.document).toEqual(local);
    expect(saved.revision).toBe(winner.revision + 1);
    expect((await f.request('native/api/published')).status).toBe(404);
    await f.close();
    await f.store.close();
    const reopened = await StudioStore.open(f.directory);
    cleanups.push(() => reopened.close());
    expect(reopened.native.getDraft()).toEqual(saved);
  });

  it('serializes competing saves so exactly one complete document reaches disk', async () => {
    const f = await lab(), initial = await f.draft();
    const candidates = ['First', 'Second'].map(name => ({ ...draftDocument(initial.document.id), name, studioCanvas: { version: 1, canvases: [] } }));
    const responses = await Promise.all(candidates.map(document => f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = candidates[responses.findIndex(response => response.status === 200)];
    expect((await f.draft()).document).toEqual(winner);
    const state = JSON.parse(await readFile(path.join(f.directory, 'native-v2/state.json'), 'utf8'));
    expect(state.draft.document).toEqual(winner);
    expect(state.draft.revision).toBe(initial.revision + 1);
    expect(state.publishedRevision).toBeNull();
  });

  it('detaches an accepted AST/layout/binding snapshot from subsequent caller mutations', async () => {
    const f = await lab(), initial = await f.draft();
    const input = { ...draftDocument(initial.document.id), studioCanvas: { version: 1, canvases: [] } };
    const saved = await f.store.native.save(input, initial.revision);
    input.name = 'Must remain local';
    input.logicUseBindings.length = 0;
    input.studioCanvas.version = 99;
    expect(f.store.native.getDraft()).toEqual(saved);
    const state = JSON.parse(await readFile(path.join(f.directory, 'native-v2/state.json'), 'utf8'));
    expect(state.draft).toEqual(saved);
  });
});
