import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { HaPublicationClient } from '../server/ha-publication';
import { StudioStore } from '../server/store';
import { SHEET_LEVELS_CAPABILITY } from '../src/shared/composition/global-chrome';
import { compileCompositionDocument, INK_DEFAULT_CAPABILITY, legacyManifest, supportedCompositionCapabilities } from '../src/shared/composition/compiler';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { servedDocument, shippedCompositionCapabilities, unloweredWords } from '../src/shared/composition/publish-target';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { fakeHomeAssistant } from './fake-ha-publication';

type J = Record<string, any>;

// MARK: - Fixtures

/** The shared first-slice document: pages `page-orbit`, `page-lattice`, `page-echo` and the sheet `modal-swatch`. */
const base = (): J => JSON.parse(readFileSync('tests/fixtures/composition-first-slice.json', 'utf8')).document;
const push = (pageId: string): J => ({ type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' });
const tile = (id: string, action: J): J => ({
  id, type: 'navigation-tile', title: id, icon: { type: 'sf-symbol', name: 'info.circle', rendering: 'canonical', unavailable: 'fallback' }, layout: { span: 1 },
  props: { family: 'neutral', selected: 'navigation-path', subtitle: { type: 'literal', value: 'Open' } }, action,
});
/** The sheet's second tile pushes the level `demo_level_a`; the level's tile pushes the page `page-echo`. */
function withLevels(): J {
  const document = base();
  const { navigation: _navigation, ...surface } = structuredClone(document.pages[2]);
  document.levels = [{ ...surface, id: 'demo_level_a', title: 'demo_level_a', toolbar: { type: 'replace', groups: [] }, components: [tile('demo_tile_out', push('page-echo'))] }];
  document.modals[0].components[1] = tile('demo_tile_in', push('demo_level_a'));
  return document;
}
/** A saved component that pushes, used inside the sheet: it cannot be written two ways. */
function withUnloweredUse(): J {
  const document = withLevels();
  document.componentLibrary = [{ id: 'demo_note', name: 'Note', node: tile('demo_note_tile', push('page-echo')) }];
  document.modals[0].components[1] = { id: 'demo_use', type: 'component-ref', componentId: 'demo_note', layout: { span: 1 } };
  return document;
}

/** A room-navigation source whose one room opens `page-echo`, and a grid that shows it in the sheet; `onPage` also shows it on a page. */
function withRooms(onPage = false): J {
  const document = withLevels();
  document.dataSources.push({
    id: 'demo_rooms_source', kind: 'model', model: 'room-navigation@1', ranking: 'configured',
    items: [{ id: 'demo_room', title: 'Demo room', icon: { type: 'sf-symbol', name: 'house', rendering: 'canonical', unavailable: 'fallback' }, fill: { type: 'solid-rgb', red: 20, green: 60, blue: 100 }, bodyHint: 'Opens Demo room', action: push('page-echo') }],
  });
  const grid = (id: string): J => ({ id, title: 'Rooms', type: 'room-navigation-grid', layout: { span: 1 }, binding: { sourceId: 'demo_rooms_source', projection: 'room-navigation@1' }, props: {} });
  document.modals[0].components.push(grid('demo_rooms_sheet'));
  if (onPage) document.pages[0].components.push(grid('demo_rooms_page'));
  return document;
}

// MARK: - Unit

describe('the shipped target', () => {
  it('is the supported list less the pending ids, so sheet levels are not in it yet', () => {
    expect(shippedCompositionCapabilities).toEqual(supportedCompositionCapabilities.filter(id => !pendingCompositionCapabilities.includes(id)));
    expect(pendingCompositionCapabilities).toContain(SHEET_LEVELS_CAPABILITY);
    expect(shippedCompositionCapabilities).not.toContain(SHEET_LEVELS_CAPABILITY);
  });
});

describe('servedDocument', () => {
  it('writes every level as a pushed page and drops the `levels` key', () => {
    const document = withLevels();
    const { document: served, unlowered } = servedDocument(document);
    expect(served.levels).toBeUndefined();
    expect('levels' in served).toBe(false);
    expect(served.pages.map((page: J) => page.id)).toEqual([...document.pages.map((page: J) => page.id), 'demo_level_a']);
    expect(served.pages.at(-1).navigation).toEqual({ type: 'stack' });
    expect(served.modals[0].components[1].action).toEqual(push('demo_level_a'));
    expect(unlowered).toEqual([]);
    expect(document.levels).toHaveLength(1);
    expect(compileCompositionDocument(served).capabilities).not.toContain(SHEET_LEVELS_CAPABILITY);
  });

  it('writes a sheet push to a page as dismiss-then-push', () => {
    const document = withLevels();
    document.modals[0].components.push(tile('demo_tile_page', push('page-echo')));
    expect(servedDocument(document).document.modals[0].components[3].action).toEqual({ type: 'dismiss-then-push', destination: push('page-echo') });
  });

  it('leaves the document unchanged for a target that has the capability', () => {
    const document = withLevels();
    const { document: served } = servedDocument(document, [...shippedCompositionCapabilities, SHEET_LEVELS_CAPABILITY]);
    expect(served.levels).toHaveLength(1);
    expect(served).toEqual(document);
  });

  it('passes a document with no `levels` key through', () => {
    const document = base();
    expect(servedDocument(document)).toEqual({ document, unlowered: [] });
  });

  it('writes a room chosen in a sheet as dismiss-then-push, on the source', () => {
    const { document, unlowered } = servedDocument(withRooms());
    expect(document.dataSources.find((source: J) => source.id === 'demo_rooms_source').items[0].action).toEqual({ type: 'dismiss-then-push', destination: push('page-echo') });
    expect(unlowered).toEqual([]);
    expect(compileCompositionDocument(document).capabilities).not.toContain(SHEET_LEVELS_CAPABILITY);
  });

  it('refuses a room source that a page shows too: one source cannot be written two ways', () => {
    const document = withRooms(true);
    const served = servedDocument(document);
    expect(served.unlowered).toEqual(['/document/modals/0/components/3']);
    expect(served.document.dataSources).toEqual(document.dataSources);
  });

  it('reports a saved component that cannot be lowered', () => {
    expect(servedDocument(withUnloweredUse()).unlowered).toEqual(['/document/modals/0/components/1']);
  });
});

// MARK: - End to end

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = 'synthetic-composition-token', haToken = 'synthetic-ha-token';

async function lab() {
  const fake = await fakeHomeAssistant({ token: haToken });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lowering-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: token, haUrl: fake.url, haToken });
  application.app.use(application.errorHandler);
  const server = http.createServer(application.app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (endpoint: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${endpoint}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  /** The store's own starting layout with the fixture's pages, sheets and levels (the fixture's wallpaper has no stored image here). */
  const pick = (document: J): J => Object.fromEntries(['pages', 'modals', 'navigation', 'dataSources', 'levels', 'componentLibrary'].filter(key => document[key] !== undefined).map(key => [key, document[key]]));
  /** Saves `document` as the draft under the store's own document id. */
  const save = async (document: J): Promise<CompositionDraft> => {
    const first: CompositionDraft = await (await request('/native/api/draft')).json();
    const response = await request('/native/api/draft', 'PUT', { document: { ...structuredClone(first.document), ...pick(document) }, expectedRevision: first.revision });
    expect(response.status).toBe(200);
    return response.json();
  };
  return { fake, request, save, store };
}
const sentEnvelope = (f: Awaited<ReturnType<typeof lab>>) => f.fake.messages.find(message => message.type === 'fenton_home/ui_publication/publish')?.envelope as J | undefined;

/** A refused publish leaves the Studio as it was: no publication of its own, and an open that does not start from the live layout. */
async function expectNothingRecorded(f: Awaited<ReturnType<typeof lab>>, saved: CompositionDraft) {
  expect((await f.request('/native/api/published')).status).toBe(404);
  expect(f.store.native.peekDraft().revision).toBe(saved.revision);
  expect(await (await f.request('/native/api/ha/open-check')).json()).not.toMatchObject({ action: 'start' });
}

describe('publishing to a build that does not list sh.sheet-levels@1', () => {
  it('sends a document with no `levels` key and the pushed pages, and keeps the levels in the draft', async () => {
    const f = await lab();
    const saved = await f.save(withLevels());
    expect(saved.capabilities).toContain(SHEET_LEVELS_CAPABILITY);

    const published = await f.request('/native/api/ha/publish', 'POST', { expectedRevision: saved.revision });
    expect(published.status).toBe(200);
    const sent = sentEnvelope(f)!;
    expect(sent.document.levels).toBeUndefined();
    expect('levels' in sent.document).toBe(false);
    expect(sent.document.pages.map((page: J) => page.id)).toContain('demo_level_a');
    expect(sent.document.modals[0].components[1].action).toEqual(push('demo_level_a'));
    expect(sent.capabilities).not.toContain(SHEET_LEVELS_CAPABILITY);

    // Read back what Home Assistant holds.
    const held = (await (await f.request('/native/api/ha/publication')).json());
    expect(held.current.capabilities).not.toContain(SHEET_LEVELS_CAPABILITY);
    // The draft is what is live, and still has its levels.
    expect(held.draftIsLive).toBe(true);
    const draft: CompositionDraft = await (await f.request('/native/api/draft')).json();
    expect((draft.document as J).levels).toHaveLength(1);
  });

  it('refuses a saved component that cannot be lowered, in the lint\'s words, and publishes nothing', async () => {
    const f = await lab();
    const saved = await f.save(withUnloweredUse());
    const published = await f.request('/native/api/ha/publish', 'POST', { expectedRevision: saved.revision });
    expect(published.status).toBe(422);
    expect(JSON.stringify(await published.json())).toContain(unloweredWords.slice(0, 60));
    expect(sentEnvelope(f)).toBeUndefined();
    await expectNothingRecorded(f, saved);
  });

  it('writes a room chosen in a sheet as dismiss-then-push, and refuses a room source a page shows too', async () => {
    const f = await lab();
    const saved = await f.save(withRooms());
    expect((await f.request('/native/api/ha/publish', 'POST', { expectedRevision: saved.revision })).status).toBe(200);
    expect(sentEnvelope(f)!.document.dataSources.at(-1).items[0].action.type).toBe('dismiss-then-push');
    // The draft is unchanged: its levels and its room source are intact, and it reads as live.
    const draft: CompositionDraft = await (await f.request('/native/api/draft')).json();
    expect(draft.revision).toBe(saved.revision);
    expect(draft.document).toEqual(saved.document);
    expect((draft.document as J).levels).toHaveLength(1);
    expect((draft.document as J).dataSources.at(-1).items[0].action).toEqual(push('page-echo'));
    expect((await (await f.request('/native/api/ha/publication')).json()).draftIsLive).toBe(true);
    expect(await (await f.request('/native/api/ha/open-check')).json()).toMatchObject({ action: 'keep', reason: 'already-published' });

    const g = await lab();
    const shared = await g.save(withRooms(true));
    const refused = await g.request('/native/api/ha/publish', 'POST', { expectedRevision: shared.revision });
    expect(refused.status).toBe(422);
    expect(sentEnvelope(g)).toBeUndefined();
    await expectNothingRecorded(g, shared);
  });

  it('declares no capability the draft did not: the older manifest keeps muted ink', async () => {
    const f = await lab();
    const saved = await f.save(withLevels());
    expect(saved.capabilities).toContain(INK_DEFAULT_CAPABILITY);
    // A draft written before the ink id existed: its manifest lacks it and is still valid.
    const legacy = { ...saved, capabilities: legacyManifest(saved.capabilities) };
    const client = new HaPublicationClient({ base: f.fake.url, token: haToken, websocketUrl: new URL('/api/websocket', f.fake.url).href.replace(/^http/, 'ws') });
    cleanup.push(async () => client.close());
    await client.publish({ ...legacy, publishedAt: saved.updatedAt } as never);
    expect((f.fake.messages.at(-1)!.envelope as J).capabilities).not.toContain(INK_DEFAULT_CAPABILITY);
    await client.publish({ ...saved, publishedAt: saved.updatedAt } as never);
    const sent = f.fake.messages.at(-1)!.envelope as J;
    expect(sent.capabilities).toContain(INK_DEFAULT_CAPABILITY);
    expect(sent.capabilities).not.toContain(SHEET_LEVELS_CAPABILITY);
  });
});

describe('publishing once sh.sheet-levels@1 is shipped', () => {
  it('stops lowering when the id moves to the shipped set (injected; the corpus is not edited)', async () => {
    const document = withLevels();
    // The fixture's image is already held by Home Assistant.
    const fake = await fakeHomeAssistant({ token: haToken, storedAssets: document.assets.map((asset: J) => asset.sha256) });
    cleanup.push(() => fake.close());
    const publication = (target: readonly string[]) => {
      const client = new HaPublicationClient({ base: fake.url, token: haToken, websocketUrl: new URL('/api/websocket', fake.url).href.replace(/^http/, 'ws') }, target);
      cleanup.push(async () => client.close());
      return client;
    };
    const compiled = compileCompositionDocument(document);
    const envelope = {
      envelopeVersion: '2.0', publisherId: 'demo_publisher', revision: 1, updatedAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z',
      capabilities: compiled.capabilities, assetManifestSha256: (await import('../server/composition')).compositionAssetManifestHash(compiled.document.assets), document: compiled.document,
    } as never;
    await publication(shippedCompositionCapabilities).publish(envelope);
    expect((fake.messages.at(-1)!.envelope as J).document.levels).toBeUndefined();
    await publication([...shippedCompositionCapabilities, SHEET_LEVELS_CAPABILITY]).publish(envelope);
    const sent = fake.messages.at(-1)!.envelope as J;
    expect(sent.document.levels).toHaveLength(1);
    expect(sent.capabilities).toContain(SHEET_LEVELS_CAPABILITY);
  });
});
