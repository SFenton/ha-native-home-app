import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { CompositionStore } from '../server/composition-store';
import { StudioStore } from '../server/store';
import { validateCompositionPublication } from '../server/composition';
import { canonicalCompositionJSON } from '../src/shared/composition/json';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import corpus from '../contract/corpus/accept/fixture-composition-first-slice.json';
import { fakeHomeAssistant } from './fake-ha-publication';

type J = Record<string, any>;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = 'synthetic-composition-token', haToken = 'synthetic-ha-token';
const auth = { Authorization: `Bearer ${token}` };
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: unknown): J => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'number', missing: 'unavailable' });
const phrase: J = {
  id: 'count-phrase', name: 'Count phrase', kind: 'operand',
  params: [{ name: 'src', kind: 'source-id' }, { name: 'word', kind: 'text' }],
  body: { type: 'format', pattern: '{n} {w}', args: { n: read({ type: 'hole', name: 'src' }), w: lit({ type: 'hole', name: 'word' }) } },
};
const use = (word: string): J => ({ type: 'logic-ref', logicId: 'count-phrase', args: { src: 'temp', word } });
const row = (id: string, value: J): J => ({ id, title: id, type: 'text', layout: { span: 1 }, props: { value, style: 'body', unavailableText: 'None' } });

/** A draft that holds a library and ten uses of one entry, and the same layout written out by hand. */
function documents(own: J, uses = 10) {
  // The store's own starting layout, with the corpus fixture's pages (the corpus wallpaper has no stored image here).
  const base = { ...structuredClone(own), id: own.id, pages: structuredClone(corpus.document.pages), modals: structuredClone(corpus.document.modals), navigation: structuredClone(corpus.document.navigation), dataSources: structuredClone(corpus.document.dataSources) } as J;
  const make = (value: (index: number) => J, library: boolean): J => {
    const document = structuredClone(base);
    document.dataSources.push({ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') });
    document.pages[2].components = Array.from({ length: uses }, (_, index) => row(`row-${index}`, { type: 'expr', value: value(index) }));
    if (library) document.logicLibrary = [phrase];
    return document;
  };
  const hand = (index: number): J => ({ type: 'format', pattern: '{n} {w}', args: { n: read('temp'), w: lit(`word${index}`) } });
  return { draft: make(index => use(`word${index}`), true), hand: make(hand, false) };
}

async function lab() {
  const fake = await fakeHomeAssistant({ token: haToken });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'logic-test-'));
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
    fetch(`${base}${endpoint}`, { method, headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const draft = async (): Promise<CompositionDraft> => (await request('/native/api/draft')).json();
  return { fake, request, draft, directory, store };
}

describe('a draft that holds a logic library', () => {
  it('is saved with its library, published without it, and served as what the app serves', async () => {
    const f = await lab();
    const first = await f.draft();
    const { draft } = documents(first.document as unknown as J);
    const saved: CompositionDraft = await (await f.request('/native/api/draft', 'PUT', { document: draft, expectedRevision: first.revision })).json();
    expect((saved.document as J).logicLibrary).toHaveLength(1);
    expect((await f.draft()).document).toEqual(saved.document);
    // The capability list is what the worked-out text needs, and names no logic.
    expect(saved.capabilities).toEqual(compileCompositionDocument(draft).capabilities);

    const validated = await (await f.request('/native/api/validate', 'POST', { document: draft })).json();
    expect(validated).toEqual({ valid: true, capabilities: saved.capabilities });

    const published = await f.request('/native/api/ha/publish', 'POST', { expectedRevision: saved.revision });
    expect(published.status).toBe(200);
    const sent = f.fake.messages.find(message => message.type === 'fenton_home/ui_publication/publish')!.envelope as J;
    expect(sent.document.logicLibrary).toBeUndefined();
    expect(JSON.stringify(sent)).not.toMatch(/logic-ref|"hole"/);
    expect(() => validateCompositionPublication(sent)).not.toThrow();
    expect(sent.document.pages[2].components[3].props.value.value.args.w).toEqual(lit('word3'));
    expect(sent.capabilities).toEqual(saved.capabilities);

    // The draft is what the app serves, though the two documents differ: draftIsLive and open-check compare the worked-out draft.
    expect((await (await f.request('/native/api/ha/publication')).json()).draftIsLive).toBe(true);
    expect(await (await f.request('/native/api/ha/open-check')).json()).toMatchObject({ action: 'keep', reason: 'already-published' });
    // The store's own publication holds no library either.
    const stored = await (await f.request('/native/api/publish', 'POST', { expectedRevision: saved.revision })).json();
    expect(stored.document.logicLibrary).toBeUndefined();
    expect(JSON.stringify(stored)).not.toMatch(/logic-ref|"hole"/);

    // An edit to one use makes the draft differ from what is served.
    const edited = structuredClone(draft); edited.pages[2].components[0].props.value.value.args.word = 'changed';
    await f.request('/native/api/draft', 'PUT', { document: edited, expectedRevision: saved.revision });
    expect((await (await f.request('/native/api/ha/publication')).json()).draftIsLive).toBe(false);
  });

  it('keeps its library across a restart and equals the hand-written layout when published', async () => {
    const f = await lab();
    const first = await f.draft();
    const { draft, hand } = documents(first.document as unknown as J);
    const saved: CompositionDraft = await (await f.request('/native/api/draft', 'PUT', { document: draft, expectedRevision: first.revision })).json();
    await f.request('/native/api/publish', 'POST', { expectedRevision: saved.revision });
    const reopened = await CompositionStore.open(f.directory);
    expect((reopened.getDraft().document as J).logicLibrary).toHaveLength(1);
    expect(canonicalCompositionJSON(reopened.getPublished().document)).toBe(canonicalCompositionJSON(compileCompositionDocument(hand).document));
  });

  it('refuses a save whose logic does not work out', async () => {
    const f = await lab();
    const first = await f.draft();
    const { draft } = documents(first.document as unknown as J);
    draft.pages[2].components[0].props.value.value.args.word = 7;
    const refused = await f.request('/native/api/draft', 'PUT', { document: draft, expectedRevision: first.revision });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await f.draft()).revision).toBe(first.revision);
  });

  it('refuses a house import into a draft that holds a library, and leaves the draft as it was', async () => {
    const f = await lab();
    const first = await f.draft();
    const { draft } = documents(first.document as unknown as J);
    const saved: CompositionDraft = await (await f.request('/native/api/draft', 'PUT', { document: draft, expectedRevision: first.revision })).json();
    const refused = await f.request('/native/api/import-house-config', 'POST', { expectedRevision: saved.revision });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('logic library');
    expect((await f.draft()).revision).toBe(saved.revision);
  });

  it('grows the published size by the same amount per use, measured on the worked-out draft', async () => {
    const f = await lab();
    const first = await f.draft();
    const size = (uses: number) => {
      const { draft } = documents(first.document as unknown as J, uses);
      return new TextEncoder().encode(canonicalCompositionJSON(compileCompositionDocument(draft).expanded)).byteLength;
    };
    const perUse = (size(10) - size(0)) / 10;
    expect(perUse).toBeGreaterThan(100);
    expect(size(20) - size(10)).toBeCloseTo(perUse * 10, -2);
  });
});
