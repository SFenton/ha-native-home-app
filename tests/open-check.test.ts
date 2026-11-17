import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import { createCompositionDocument, type CompositionDraft } from '../src/shared/composition/workspace';
import { fakeHomeAssistant } from './fake-ha-publication';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const haToken = 'synthetic-ha-token-for-the-open-check';
const token = 'synthetic-open-check-token';

/** A Studio on a fresh temporary data folder; `connected: false` leaves Home Assistant unconfigured, `'down'` points it at a closed port. */
async function studio(connected: boolean | 'down' = true) {
  const fake = await fakeHomeAssistant({ token: haToken });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'open-check-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const haUrl = connected === true ? fake.url : connected === 'down' ? 'http://127.0.0.1:1' : undefined;
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: token, haUrl, haToken: haUrl ? haToken : undefined });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (endpoint: string, method = 'GET', body?: unknown, auth = true) => fetch(`${base}${endpoint}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const draft = async (): Promise<CompositionDraft> => (await request('/native/api/draft')).json();
  const check = async () => (await request('/native/api/ha/open-check')).json() as Promise<{ action: string; reason: string; draftRevision: number; publishedRevision?: number }>;
  const serve = (document: unknown, revision = 7) => {
    fake.state.current = { revision, publishedAt: '2026-11-14T12:00:00+00:00', publishedBy: 'someone', envelopeSha256: 'a'.repeat(64), capabilities: [], envelope: { document } };
  };
  return { fake, request, draft, check, serve, directory };
}
const live = (name: string) => ({ ...createCompositionDocument('document-published-elsewhere'), name });

describe('GET /native/api/ha/open-check', () => {
  it('keeps the draft and says nothing when Home Assistant is not connected', async () => {
    const f = await studio(false);
    expect(await f.check()).toMatchObject({ action: 'keep', reason: 'not-connected' });
  });

  it('keeps the draft and says nothing when Home Assistant cannot be reached', async () => {
    const f = await studio('down');
    expect(await f.check()).toMatchObject({ action: 'keep', reason: 'unreachable' });
  });

  it('keeps the draft and says nothing when nothing has been published', async () => {
    const f = await studio();
    expect(await f.check()).toMatchObject({ action: 'keep', reason: 'nothing-published' });
  });

  it('keeps the draft when it already is the published layout', async () => {
    const f = await studio();
    const before = await f.draft();
    f.serve(before.document);
    expect(await f.check()).toMatchObject({ action: 'keep', reason: 'already-published', publishedRevision: 7 });
  });

  it('starts from published, silently, for a draft nobody edited', async () => {
    const f = await studio();
    f.serve(live('Live layout'));
    expect(await f.check()).toMatchObject({ action: 'start', reason: 'no-unpublished-edits', publishedRevision: 7 });
  });

  it('starts from published when the draft is what this Studio last published and the app has since changed', async () => {
    const f = await studio();
    const first = await f.draft();
    const saved = await (await f.request('/native/api/draft', 'PUT', { document: { ...first.document, name: 'Mine' }, expectedRevision: first.revision })).json() as CompositionDraft;
    expect((await f.request('/native/api/ha/publish', 'POST', { expectedRevision: saved.revision })).status).toBe(200);
    f.serve(live('Changed elsewhere'), 9);
    expect(await f.check()).toMatchObject({ action: 'start', reason: 'no-unpublished-edits', publishedRevision: 9 });
  });

  it('asks when the draft holds edits the app does not have', async () => {
    const f = await studio();
    const first = await f.draft();
    await f.request('/native/api/draft', 'PUT', { document: { ...first.document, name: 'Edited but not published' }, expectedRevision: first.revision });
    f.serve(live('Live layout'));
    const answer = await f.check();
    expect(answer).toMatchObject({ action: 'ask', reason: 'unpublished-edits', publishedRevision: 7 });
    // It only reads: the draft is as it was.
    expect((await f.draft()).document.name).toBe('Edited but not published');
  });

  it('leaves Restore Draft working after a start from published', async () => {
    const f = await studio();
    const first = await f.draft();
    f.serve(live('Live layout'));
    const answer = await f.check();
    expect(answer.action).toBe('start');
    expect((await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: answer.draftRevision })).status).toBe(200);
    const started = await f.draft();
    expect(started.document.name).toBe('Live layout');
    // The draft is now the published layout, so the next open has nothing to ask.
    expect(await f.check()).toMatchObject({ action: 'keep', reason: 'already-published' });
    expect((await f.request('/native/api/ha/restore-draft', 'POST', { expectedRevision: started.revision })).status).toBe(200);
    expect((await f.draft()).document.name).toBe(first.document.name);
  });

  it('needs the sign-in like every other native route', async () => {
    const f = await studio();
    expect((await f.request('/native/api/ha/open-check', 'GET', undefined, false)).status).toBe(401);
  });
});

describe('the Studio notes (row icons)', () => {
  it('start empty, round-trip and survive nothing but their own file', async () => {
    const f = await studio();
    expect(await (await f.request('/native/api/studio-notes')).json()).toEqual({ listIcons: {} });
    const before = await f.draft();
    const put = await f.request('/native/api/studio-notes', 'PUT', { listIcons: { 'node:tile-1': 'bed.double', 'page:home': 'house' } });
    expect(put.status).toBe(200);
    expect(await (await f.request('/native/api/studio-notes')).json()).toEqual({ listIcons: { 'node:tile-1': 'bed.double', 'page:home': 'house' } });
    // Saving notes is not a draft edit.
    expect(await f.draft()).toEqual(before);
    expect(JSON.parse(await readFile(path.join(f.directory, 'native-v2', 'studio-notes.json'), 'utf8'))).toEqual({ listIcons: { 'node:tile-1': 'bed.double', 'page:home': 'house' } });
  });

  it('refuse a key or an icon name that is not one', async () => {
    const f = await studio();
    expect((await f.request('/native/api/studio-notes', 'PUT', { listIcons: { 'weird key': 'house' } })).status).toBe(400);
    expect((await f.request('/native/api/studio-notes', 'PUT', { listIcons: { 'node:a': '<script>' } })).status).toBe(400);
    expect((await f.request('/native/api/studio-notes', 'PUT', { listIcons: {}, extra: 1 })).status).toBe(400);
  });

  it('need the sign-in', async () => {
    const f = await studio();
    expect((await f.request('/native/api/studio-notes', 'GET', undefined, false)).status).toBe(401);
    expect((await f.request('/native/api/studio-notes', 'PUT', { listIcons: {} }, false)).status).toBe(401);
  });

  it('never reach Publish, Export, the published copy or what Home Assistant receives', async () => {
    const f = await studio();
    await f.request('/native/api/studio-notes', 'PUT', { listIcons: { 'page:home': 'sparkle-marker-icon' } });
    const draft = await f.draft();
    const published = await (await f.request('/native/api/publish', 'POST', { expectedRevision: draft.revision })).text();
    const exported = await (await f.request('/native/api/export?source=published')).text();
    const exportedDraft = await (await f.request('/native/api/export')).text();
    expect((await f.request('/native/api/ha/publish', 'POST', { expectedRevision: draft.revision })).status).toBe(200);
    const sent = JSON.stringify(f.fake.state.current);
    for (const text of [JSON.stringify(draft), published, exported, exportedDraft, sent, await (await f.request('/native/api/published')).text()]) {
      expect(text).not.toContain('listIcons');
      expect(text).not.toContain('sparkle-marker-icon');
    }
    expect(sent).toContain('document');
  });
});
