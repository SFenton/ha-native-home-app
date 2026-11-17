import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

const haToken = 'synthetic-ha-token-that-must-never-leave-the-server';
const token = 'synthetic-start-from-published-token';

async function studio() {
  const fake = await fakeHomeAssistant({ token: haToken });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'start-published-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: token, haUrl: fake.url, haToken });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (endpoint: string, method = 'GET', body?: unknown) => fetch(`${base}${endpoint}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const draft = async (): Promise<CompositionDraft> => (await request('/native/api/draft')).json();
  /** Makes `document` the layout the fake Home Assistant serves. */
  const serve = (document: unknown, revision = 7) => {
    fake.state.current = { revision, publishedAt: '2026-11-14T12:00:00+00:00', publishedBy: 'someone', envelopeSha256: 'a'.repeat(64), capabilities: [], envelope: { document } };
  };
  return { fake, request, draft, serve, directory };
}
const live = (name: string) => ({ ...createCompositionDocument('document-published-elsewhere'), name });

describe('POST /native/api/ha/start-from-published', () => {
  it('replaces the draft with the live layout as a new revision, keeps the old draft, and writes nothing to Home Assistant', async () => {
    const f = await studio();
    const before = await f.draft();
    f.serve(live('Live layout'));
    const response = await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: before.revision });
    expect(response.status).toBe(200);
    const body = await response.json() as { revision: number; publishedRevision: number; backup: { revision: number; createdAt: string } | null };
    expect(body).toMatchObject({ revision: before.revision + 1, publishedRevision: 7, backup: { revision: before.revision } });
    expect(Number.isNaN(Date.parse(body.backup!.createdAt))).toBe(false);
    const after = await f.draft();
    expect(after.document.name).toBe('Live layout');
    // The workspace keeps its own document identity.
    expect(after.document.id).toBe(before.document.id);
    expect(JSON.stringify(body)).not.toContain(haToken);
    // The old draft is a file under backups/, restorable.
    expect(await readdir(path.join(f.directory, 'native-v2', 'backups'))).toHaveLength(1);
    // Only reads reached Home Assistant: nothing was published or rolled back.
    expect(f.fake.log.filter(line => /publish|rollback/.test(line))).toEqual([]);
    expect(f.fake.state.revision).toBe(0);
  });

  it('refuses with a clear error and leaves the draft alone when nothing is published', async () => {
    const f = await studio();
    const before = await f.draft();
    const response = await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: before.revision });
    expect(response.status).toBe(404);
    expect((await response.json() as { error: string }).error).toMatch(/Nothing has been published/);
    expect(await f.draft()).toEqual(before);
  });

  it('refuses an invalid published document without touching the draft or keeping a backup', async () => {
    const f = await studio();
    const before = await f.draft();
    f.serve({ schemaVersion: '2.0', name: 'broken' });
    const response = await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: before.revision });
    expect(response.status).toBe(422);
    expect(await f.draft()).toEqual(before);
    await expect(readdir(path.join(f.directory, 'native-v2', 'backups'))).rejects.toThrow();
  });

  it('answers 409 when the draft moved since the page loaded it', async () => {
    const f = await studio();
    const before = await f.draft();
    f.serve(live('Live layout'));
    expect((await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: before.revision + 5 })).status).toBe(409);
    expect((await f.draft()).revision).toBe(before.revision);
  });
});

describe('restoring the previous draft', () => {
  it('has no backup until a replacement, then swaps the two drafts each time', async () => {
    const f = await studio();
    expect(await (await f.request('/native/api/ha/draft-backup')).json()).toEqual({ backup: null });
    const first = await f.draft();
    expect((await f.request('/native/api/ha/restore-draft', 'POST', { expectedRevision: first.revision })).status).toBe(404);

    f.serve(live('Live layout'));
    await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: first.revision });
    const started = await f.draft();
    expect(((await (await f.request('/native/api/ha/draft-backup')).json()) as { backup: unknown }).backup).not.toBeNull();

    const restored = await f.request('/native/api/ha/restore-draft', 'POST', { expectedRevision: started.revision });
    expect(restored.status).toBe(200);
    const back = await f.draft();
    expect(back.revision).toBe(started.revision + 1);
    expect(back.document.name).toBe(first.document.name);
    // The layout it replaced is now the one kept, so Start from Published can be undone and redone.
    const again = await f.request('/native/api/ha/restore-draft', 'POST', { expectedRevision: back.revision });
    expect(again.status).toBe(200);
    expect((await f.draft()).document.name).toBe('Live layout');
  });

  it('keeps at most five backups', async () => {
    const f = await studio();
    f.serve(live('Live layout'));
    for (let round = 0; round < 7; round += 1) {
      const current = await f.draft();
      await f.request('/native/api/ha/start-from-published', 'POST', { expectedRevision: current.revision });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(await readdir(path.join(f.directory, 'native-v2', 'backups'))).toHaveLength(5);
  });
});
