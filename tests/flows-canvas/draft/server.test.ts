import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
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
import { expandDocument } from '../../../src/shared/composition/components';
import { liftJSON, type LiftOptions } from '../../../src/shared/composition/graph/lift';
import type { LogicAnchor } from '../../../src/shared/composition/graph/types';
import { atPointer, encodeStudioCanvas, readStudioCanvas, replacePointer, resolveLogicAnchor } from '../../../src/shared/composition/studio-logic';
import { fakeHomeAssistant } from '../../fake-ha-publication';
import { componentDocument, draftDocument, labelTemplate, read } from './fixtures';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const port = Number(process.env.STUDIO_E2E_PORT ?? 4821), mount = '/api/hassio_ingress/w2-d/';
const dataRoot = path.resolve(process.env.STUDIO_E2E_DATA_DIR ?? './test-results/studio-data/w2-d');
const authToken = 'synthetic-w2-d-studio-token', haToken = 'synthetic-w2-d-ha-token';
const hash = (document: unknown) => createHash('sha256').update(canonicalCompositionJSON(document)).digest('hex');
const tileReads = (publication: CompositionPublication) => expandDocument(publication.document).pages[0].components.map(node => ({
  tileSource: atPointer(node, '/props/titleProviderId'),
  logicSource: atPointer(node, '/props/subtitle/value/from/sourceId'),
}));
const expectedTileReads = [{ tileSource: 'source-a', logicSource: 'source-a' }, { tileSource: 'source-b', logicSource: 'source-b' }];

async function lab() {
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
  const request = (endpoint: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, authenticated = true) => fetch(`${base}${endpoint}`, {
    method,
    headers: { ...(authenticated ? { Authorization: `Bearer ${authToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
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

function positionedCanvas(document: unknown, before: ReturnType<typeof liftJSON>) {
  return encodeStudioCanvas(document, [{
    id: 'round-trip', roots: before.graph.roots.map(root => ({
      anchor: root.anchor, nodes: before.graph.nodes.map((node, index) => ({
        id: node.id, origins: node.origins, x: 384 + index * 17, y: 240 + index * 11,
      })),
    })),
  }]);
}
async function reopenDraft(f: Awaited<ReturnType<typeof lab>>) {
  await f.close();
  await f.store.close();
  const reopened = await StudioStore.open(f.directory);
  cleanups.push(() => reopened.close());
  return reopened.native.getDraft().document;
}
const positionedTemplate = {
  ...labelTemplate, id: 'positioned-label', params: [],
  body: { type: 'format', pattern: '{value}', args: { value: read('source-a') } },
};

interface LayoutScenario {
  readonly original: Record<string, unknown>;
  readonly changed: Record<string, unknown>;
  readonly anchors: readonly LogicAnchor[];
  readonly replacements?: readonly LogicAnchor[];
  readonly kind?: LiftOptions['kind'];
  readonly publicationUnchanged?: boolean;
}
const section = (children: readonly unknown[]) => ({
  id: 'container', type: 'section', title: 'Container', layout: { span: 1 },
  props: { header: '', footer: '', style: 'plain', density: 'thin', hasGlyphs: false, spacing: { type: 'token', name: 'm' } }, children,
});
const pageWith = (document: ReturnType<typeof draftDocument>, components: readonly unknown[]) =>
  ({ ...document, pages: [{ ...document.pages[0], components }] });
const layoutScenarios: [string, (id: string) => LayoutScenario][] = [
  ['round-2-repro', id => {
    const base = draftDocument(id), unused = { ...positionedTemplate, id: 'unused-template' };
    const original = { ...base, logicLibrary: [labelTemplate, unused] };
    return {
      original, changed: { ...original, logicLibrary: [unused, labelTemplate] },
      anchors: [{ kind: 'logic', id: labelTemplate.id, field: '/body' }], publicationUnchanged: true,
    };
  }],
  ...(['forward', 'backward'] as const).flatMap(direction => ['/body', '/body/args/value'].map((field): [string, (id: string) => LayoutScenario] =>
    [`logic-move/${direction}/${field}`, id => {
      const base = draftDocument(id);
      const original = { ...base, logicLibrary: direction === 'forward' ? [positionedTemplate, labelTemplate] : [labelTemplate, positionedTemplate] };
      return { original, changed: { ...original, logicLibrary: [...original.logicLibrary].reverse() }, anchors: [{ kind: 'logic', id: positionedTemplate.id, field }] };
    }])),
  ['two-templates-swap-identical-node-ids', id => {
    const base = draftDocument(id), other = { ...positionedTemplate, id: 'different-owner' };
    const original = { ...base, logicLibrary: [positionedTemplate, other, labelTemplate] };
    return {
      original, changed: { ...original, logicLibrary: [other, positionedTemplate, labelTemplate] },
      anchors: [positionedTemplate, other].map(entry => ({ kind: 'logic', id: entry.id, field: '/body' })),
    };
  }],
  ...(['remove-insert', 'replace'] as const).map((change): [string, (id: string) => LayoutScenario] => [`wrong-owner/${change}`, id => {
    const base = draftDocument(id), other = { ...positionedTemplate, id: 'other-owner' }, replacement = { ...positionedTemplate, id: 'replacement-owner' };
    const original = { ...base, logicLibrary: [positionedTemplate, other, labelTemplate] };
    return {
      original, changed: { ...original, logicLibrary: change === 'replace' ? [replacement, other, labelTemplate] : [other, labelTemplate] },
      anchors: [{ kind: 'logic', id: positionedTemplate.id, field: '/body' }],
      replacements: [{ kind: 'logic', id: change === 'replace' ? replacement.id : other.id, field: '/body' }],
    };
  }]),
  ...(['deeper', 'shallower'] as const).map((direction): [string, (id: string) => LayoutScenario] => [`tile-across-nesting/${direction}`, id => {
    const base = draftDocument(id), [tileA, tileB] = base.pages[0].components;
    const shallow = pageWith(base, [tileA, tileB]), deep = pageWith(base, [section([tileA]), tileB]);
    return {
      original: direction === 'deeper' ? shallow : deep, changed: direction === 'deeper' ? deep : shallow,
      anchors: [{ kind: 'page', id: base.pages[0].id, nodeId: tileA.id, field: '/props/subtitle/value' }],
    };
  }]),
  ...(['deeper', 'shallower'] as const).map((direction): [string, (id: string) => LayoutScenario] => [`component-tile-across-nesting/${direction}`, id => {
    const base = draftDocument(id), node = { ...base.pages[0].components[0], id: 'component-inner' };
    const entry = { id: 'saved-container', name: 'Saved container', params: [], bindings: [], node };
    const use: LogicAnchor = { kind: 'component', id: entry.id, nodeId: node.id, field: '/props/subtitle/value' };
    const shallow = { ...base, componentLibrary: [entry], logicUseBindings: [...base.logicUseBindings, { ...base.logicUseBindings[0], use }] };
    const deep = { ...shallow, componentLibrary: [{ ...entry, node: section([node]) }] };
    return { original: direction === 'deeper' ? shallow : deep, changed: direction === 'deeper' ? deep : shallow, anchors: [use] };
  }]),
  ...(['tabs', 'blocks'] as const).flatMap(branch => (['deeper', 'shallower'] as const).map((direction): [string, (id: string) => LayoutScenario] =>
    [`tile-across-${branch}/${direction}`, id => {
      const base = draftDocument(id), [tileA, tileB] = base.pages[0].components;
      const tabs = {
        id: 'tab-container', title: 'Tabs', type: 'local-tabs', layout: { span: 1 },
        props: { stateId: 'selected-tab', transition: 'canonical-swap@1' },
        tabs: [{ id: 'first', label: 'First', children: branch === 'tabs' ? [tileA] : [] }, { id: 'second', label: 'Second', children: [] }],
        ...(branch === 'blocks' ? { blocks: [{ id: 'common-block', tabs: 'all', children: [tileA] }] } : {}),
      };
      const shallow = pageWith(base, [tileA, tileB]);
      const deep = { ...pageWith(base, [tabs, tileB]), localState: [{ id: 'selected-tab', type: 'choice', initial: 'first', options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] }] };
      return {
        original: direction === 'deeper' ? shallow : deep, changed: direction === 'deeper' ? deep : shallow,
        anchors: [{ kind: 'page', id: base.pages[0].id, nodeId: tileA.id, field: '/props/subtitle/value' }],
      };
    }])),
  ...(['forward', 'backward'] as const).map((direction): [string, (id: string) => LayoutScenario] => [`page-owner-move/${direction}`, id => {
    const base = draftDocument(id), home = base.pages[0], empty = { ...home, id: 'page-other', components: [] };
    const original = { ...base, pages: direction === 'forward' ? [home, empty] : [empty, home] };
    return {
      original, changed: { ...original, pages: [...original.pages].reverse() },
      anchors: [{ kind: 'page', id: home.id, nodeId: 'tile-a', field: '/props/subtitle/value' }],
    };
  }]),
  ...([false, true] as const).map((moved): [string, (id: string) => LayoutScenario] => [`whole-nested-component/${moved ? 'moved' : 'unchanged'}`, id => {
    const base = draftDocument(id), predicate = { type: 'viewer', isAdmin: true };
    const node = { ...base.pages[0].components[0], id: 'whole-inner', visibleWhen: predicate };
    const rootNode = { ...section([node]), id: 'whole-container', visibleWhen: predicate };
    const entry = { id: 'whole-component', name: 'Whole component', params: [], bindings: [], node: rootNode };
    const empty = { ...entry, id: 'other-component', node: { ...section([]), id: 'other-container' } };
    const original = { ...base, componentLibrary: [entry, empty] };
    return {
      original, changed: moved ? { ...original, componentLibrary: [empty, entry] } : original, kind: 'fragment',
      anchors: [{ kind: 'component', id: entry.id, nodeId: rootNode.id, field: '' }],
    };
  }]),
];

describe('round-3 adversarial layout matrix: canonical frames, never legacy inference', () => {
  it.each(layoutScenarios.flatMap(([name, scenario]) => (['relative', 'absolute'] as const).map(encoding =>
    [`${name}/${encoding}`, scenario, encoding] as const)))('%s', async (_name, scenario, encoding) => {
    for (const format of ['legacy', 'canonical'] as const) {
      const f = await lab(), initial = await f.draft();
      const { original, changed, anchors, replacements, kind = 'operand', publicationUnchanged } = scenario(initial.document.id);
      const layouts = anchors.map((anchor, owner) => {
        const root = resolveLogicAnchor(original, anchor);
        if (!root) throw new Error('Expected the authored matrix anchor');
        const before = liftJSON(Buffer.from(canonicalCompositionJSON(root.value)), { kind, anchor });
        return {
          id: `canvas-${owner}`, anchor, root, before,
          nodes: before.graph.nodes.map((node, index) => ({ id: node.id, origins: node.origins, x: 631 + owner * 300 + index * 19, y: 427 + owner * 200 + index * 13 })),
        };
      });
      const studioCanvas = format === 'canonical'
        ? encodeStudioCanvas(original, layouts.map(saved => ({ id: saved.id, roots: [{ anchor: saved.anchor, nodes: saved.nodes }] })))
        : { version: 1, canvases: layouts.map(saved => ({
          id: saved.id, roots: [saved.anchor],
          nodes: saved.nodes.map(node => ({ ...node, origins: node.origins.map(origin => encoding === 'absolute' ? saved.root.pointer + origin : origin) })),
        })) };
      const first = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: { ...original, studioCanvas } });
      expect(first.status).toBe(200);
      const saved: CompositionDraft = await first.json();
      const second = await f.request('native/api/draft', 'PUT', { expectedRevision: saved.revision, document: { ...changed, studioCanvas } });
      expect(second.status).toBe(200);
      const prepared = await f.prepare({ ...changed, studioCanvas });
      if (publicationUnchanged) expect(prepared.publicationDocumentSha256).toBe((await f.prepare(original)).publicationDocumentSha256);
      const restored = await reopenDraft(f), layout = readStudioCanvas(restored);
      expect(layout).toEqual(prepared.layout);
      expect(atPointer(restored, '/studioCanvas')).toEqual(studioCanvas);
      const preserve = format === 'canonical' && !replacements;
      expect(layout.warnings).toEqual(preserve ? [] : [expect.objectContaining({ code: 'invalid_layout' })]);
      if (!preserve) expect(layout.metadata).toBeUndefined();
      for (const [index, anchor] of (replacements ?? anchors).entries()) {
        const root = resolveLogicAnchor(restored, anchor);
        if (!root) throw new Error('Expected the current matrix owner');
        const bytes = Buffer.from(canonicalCompositionJSON(root.value));
        const after = liftJSON(bytes, { kind, anchor, metadata: layout.metadata });
        expect(after.warnings.filter(item => item.code === 'invalid_layout')).toEqual([]);
        const positions = layouts[index].nodes.map(({ x, y }) => ({ x, y }));
        expect(after.graph.nodes.map(node => node.id)).toEqual(layouts[index].nodes.map(node => node.id));
        if (preserve) expect(after.graph.nodes.map(node => node.position)).toEqual(positions);
        else {
          expect(after.graph.nodes.map(node => node.position)).toEqual(liftJSON(bytes, { kind, anchor }).graph.nodes.map(node => node.position));
          expect(after.graph.nodes.map(node => node.position)).not.toEqual(positions);
        }
      }
    }
  });

  it('auth-invalid-canonical-atomic-conflict-write-cleanup-restart', async () => {
    const f = await lab(), initial = await f.draft();
    const local = { ...draftDocument(initial.document.id), studioCanvas: { version: 55, future: 'keep' } };
    expect((await f.request('native/api/draft/prepare', 'POST', { document: local }, {}, false)).status).toBe(401);
    expect((await f.request('native/api/draft/prepare', 'POST', { document: local }, { Origin: 'http://example.invalid' })).status).toBe(403);
    const state = path.join(f.directory, 'native-v2/state.json'), before = await readFile(state, 'utf8');
    const invalid = replacePointer(local, '/logicLibrary/0/body', { type: 'math', op: 'not-an-op', args: [] });
    for (const endpoint of ['native/api/draft/prepare', 'native/api/draft']) {
      expect((await f.request(endpoint, endpoint.endsWith('prepare') ? 'POST' : 'PUT', { document: invalid, ...(endpoint.endsWith('prepare') ? {} : { expectedRevision: initial.revision }) })).status).toBe(422);
    }
    expect(await readFile(state, 'utf8')).toBe(before);
    const responses = await Promise.all(['winner-a', 'winner-b'].map(name => f.request('native/api/draft', 'PUT', { document: { ...local, name }, expectedRevision: initial.revision })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = await f.draft(), buffer = structuredClone(local);
    expect((await f.request('native/api/draft', 'PUT', { document: local, expectedRevision: initial.revision })).status).toBe(409);
    expect(local).toEqual(buffer);
    const backup = `${state}.matrix-original`;
    await rename(state, backup); await mkdir(state);
    try {
      expect((await f.request('native/api/draft', 'PUT', { document: local, expectedRevision: winner.revision })).status).toBe(500);
      expect(await f.draft()).toEqual(winner);
      expect((await readdir(path.dirname(state))).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { await rmdir(state); await rename(backup, state); }
    const restored = await reopenDraft(f), layout = readStudioCanvas(restored);
    expect(restored).toEqual(winner.document);
    expect(JSON.parse(await readFile(state, 'utf8')).draft).toEqual(winner);
    expect(layout).toMatchObject({ raw: local.studioCanvas, warnings: [{ code: 'invalid_layout' }] });
    expect(layout.metadata).toBeUndefined();
    const anchor: LogicAnchor = { kind: 'logic', id: labelTemplate.id, field: '/body' }, root = resolveLogicAnchor(restored, anchor);
    if (!root) throw new Error('Expected the retained logic owner after restart');
    const bytes = Buffer.from(canonicalCompositionJSON(root.value));
    const after = liftJSON(bytes, { kind: 'operand', anchor, metadata: layout.metadata });
    expect(after.graph.nodes.map(node => node.position)).toEqual(liftJSON(bytes, { kind: 'operand', anchor }).graph.nodes.map(node => node.position));
  });
});

describe('D-layout / D-binding / D-strip: mounted real draft and publication routes', () => {
  it('keeps canvas-wide IDs and groups distinct for identical graphs under two moved owners', async () => {
    const f = await lab(), initial = await f.draft(), base = draftDocument(initial.document.id);
    const other = { ...positionedTemplate, id: 'other-owner' };
    const original = { ...base, logicLibrary: [positionedTemplate, other, labelTemplate] };
    const roots = [positionedTemplate, other].map((owner, index) => {
      const anchor: LogicAnchor = { kind: 'logic', id: owner.id, field: '/body' };
      const graph = liftJSON(Buffer.from(canonicalCompositionJSON(owner.body)), { kind: 'operand', anchor }).graph;
      return { anchor, nodes: graph.nodes.map(node => ({ id: node.id, origins: node.origins, x: 700 + index * 300, y: 800 + index * 200 })) };
    });
    expect(roots[0].nodes.map(node => node.id)).toEqual(roots[1].nodes.map(node => node.id));
    const studioCanvas = encodeStudioCanvas(original, [{ id: 'shared-canvas', roots, viewport: { x: 20, y: 30, zoom: 1.5 } }]);
    const canvas = studioCanvas.canvases[0];
    expect(new Set(canvas.nodes.map(node => node.id)).size).toBe(canvas.nodes.length);
    canvas.groups = [{ id: 'both-owners', label: 'Both owners', nodeIds: canvas.nodes.map(node => node.id) }];
    const changed = { ...original, logicLibrary: [other, positionedTemplate, labelTemplate], studioCanvas };
    expect((await f.request('native/api/draft', 'PUT', { document: changed, expectedRevision: initial.revision })).status).toBe(200);
    const restored = await reopenDraft(f), layout = readStudioCanvas(restored);
    expect(layout.raw).toEqual(studioCanvas);
    expect(layout.warnings).toEqual([]);
    for (const root of roots) {
      const current = resolveLogicAnchor(restored, root.anchor);
      if (!current) throw new Error('Expected the current stable owner');
      const after = liftJSON(Buffer.from(canonicalCompositionJSON(current.value)), { kind: 'operand', anchor: root.anchor, metadata: layout.metadata });
      expect(after.warnings.filter(item => item.code === 'invalid_layout')).toEqual([]);
      expect(after.graph.nodes.map(node => node.position)).toEqual(root.nodes.map(({ x, y }) => ({ x, y })));
      const adapted = layout.metadata?.canvases.find(saved => saved.roots[0].id === root.anchor.id);
      expect(adapted?.viewport).toEqual(canvas.viewport);
      expect(adapted?.groups?.[0].nodeIds).toEqual(root.nodes.map(node => node.id));
    }
  });

  it('serves HTTP and persists state in the configured port and data root', async () => {
    const f = await lab(), response = await f.request('native/api/draft');
    expect(response.status).toBe(200);
    expect(new URL(response.url).port).toBe(String(Number(process.env.STUDIO_E2E_PORT ?? 4821)));
    expect(path.dirname(f.directory)).toBe(path.resolve(process.env.STUDIO_E2E_DATA_DIR ?? './test-results/studio-data/w2-d'));
    expect(await readFile(path.join(f.directory, 'native-v2/state.json'), 'utf8')).toContain('"draft"');
  });

  it.each(['props//titleProviderId', '/props/titleProviderId/'])('publishes the correct source read for every component use with field %s', async field => {
    const f = await lab(), initial = await f.draft(), document = componentDocument(initial.document.id, field);
    const savedResponse = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document });
    expect(savedResponse.status).toBe(200);
    const saved: CompositionDraft = await savedResponse.json();
    const publicationResponse = await f.request('native/api/publish', 'POST', { expectedRevision: saved.revision });
    expect(publicationResponse.status).toBe(200);
    const publication: CompositionPublication = await publicationResponse.json();
    expect(tileReads(publication)).toEqual(expectedTileReads);
    expect(atPointer(publication.document, '/componentLibrary/0/bindings/0/field')).toBe(field);
    expect(tileReads(await (await f.request('native/api/published')).json())).toEqual(expectedTileReads);
  });

  it('refuses a changed reference with the same source argument before it can replace the published tile reads', async () => {
    const f = await lab(), initial = await f.draft(), document = draftDocument(initial.document.id);
    const savedResponse = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document });
    expect(savedResponse.status).toBe(200);
    const saved: CompositionDraft = await savedResponse.json();
    const first = await f.request('native/api/publish', 'POST', { expectedRevision: saved.revision });
    expect(first.status).toBe(200);
    const published: CompositionPublication = await first.json();
    expect(tileReads(published)).toEqual(expectedTileReads);
    const different = {
      ...labelTemplate, id: 'different-template',
      body: { type: 'format', pattern: 'DIFFERENT {value}', args: { value: labelTemplate.body } },
    };
    const changed = replacePointer({ ...document, logicLibrary: [...document.logicLibrary, different] }, '/pages/0/components/0/props/subtitle/value/logicId', different.id);
    for (const [endpoint, method, body] of [
      ['native/api/draft/prepare', 'POST', { document: changed }],
      ['native/api/draft', 'PUT', { document: changed, expectedRevision: saved.revision }],
    ] as const) {
      const response = await f.request(endpoint, method, body);
      expect(response.status).toBe(422);
      expect((await response.json()).issues).toEqual([{ code: 'invalid_reference', pointer: '/document/logicUseBindings/0/logicId' }]);
    }
    expect(await f.draft()).toEqual(saved);
    expect(await (await f.request('native/api/published')).json()).toEqual(published);
    const republishedResponse = await f.request('native/api/publish', 'POST', { expectedRevision: saved.revision });
    expect(republishedResponse.status).toBe(200);
    const republished: CompositionPublication = await republishedResponse.json();
    expect(tileReads(republished)).toEqual(expectedTileReads);
    expect(republished.document).toEqual(published.document);
    expect(JSON.stringify(republished.document)).not.toContain('DIFFERENT');
  });

  it.each(['document', 'nested fragment'] as const)('round-trips canonical saved %s positions through reopen and lift', async scope => {
    const f = await lab(), initial = await f.draft(), base = draftDocument(initial.document.id);
    const nested = {
      ...labelTemplate, id: 'nested-label', params: [],
      body: { type: 'format', pattern: '{value}', args: { value: read('source-a') } },
    };
    const document = { ...base, logicLibrary: [...base.logicLibrary, nested] };
    const field = '/logicLibrary/1/body/args/value', kind = scope === 'document' ? 'document' : 'operand';
    const options: LiftOptions = { kind, ...(scope === 'document' ? {} : { anchor: { kind: 'logic', id: nested.id, field: '/body/args/value' } }) };
    const before = liftJSON(Buffer.from(canonicalCompositionJSON(scope === 'document' ? document : atPointer(document, field))), options);
    const studioCanvas = positionedCanvas(document, before);
    const saved = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: { ...document, studioCanvas } });
    expect(saved.status).toBe(200);
    const restored = await reopenDraft(f), layout = readStudioCanvas(restored);
    expect(layout.raw).toEqual(studioCanvas);
    expect(layout.warnings).toEqual([]);
    const after = liftJSON(Buffer.from(canonicalCompositionJSON(scope === 'document' ? restored : atPointer(restored, field))), { ...options, metadata: layout.metadata });
    expect(after.warnings.filter(warning => warning.code === 'invalid_layout')).toEqual([]);
    expect(after.graph.nodes.map(node => node.position)).toEqual(studioCanvas.canvases[0].nodes.map(({ x, y }) => ({ x, y })));
    expect(atPointer(restored, '/studioCanvas')).toEqual(studioCanvas);
  });

  it.each(['fragment', 'nested fragment', 'tile fragment'] as const)('retains a moved canonical %s through save, reopen and lift', async scope => {
    const f = await lab(), initial = await f.draft(), base = draftDocument(initial.document.id);
    const document = { ...base, logicLibrary: [positionedTemplate, ...base.logicLibrary] };
    const anchor: LogicAnchor = scope === 'tile fragment'
      ? { kind: 'page', id: 'page-home', nodeId: 'tile-a', field: '/props/subtitle/value' }
      : { kind: 'logic', id: positionedTemplate.id, field: scope === 'fragment' ? '/body' : '/body/args/value' };
    const field = scope === 'tile fragment' ? `/pages/0/components/0${anchor.field}` : `/logicLibrary/0${anchor.field}`;
    const options: LiftOptions = { kind: 'operand', anchor };
    const before = liftJSON(Buffer.from(canonicalCompositionJSON(atPointer(document, field))), options);
    const studioCanvas = positionedCanvas(document, before);
    const first = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: { ...document, studioCanvas } });
    expect(first.status).toBe(200);
    const saved: CompositionDraft = await first.json();
    const moved = scope === 'tile fragment'
      ? { ...document, pages: [{ ...document.pages[0], components: [...document.pages[0].components].reverse() }], studioCanvas }
      : { ...document, logicLibrary: [...base.logicLibrary, positionedTemplate], studioCanvas };
    if (scope !== 'tile fragment') {
      expect((await f.prepare(moved)).publicationDocumentSha256).toBe((await f.prepare(document)).publicationDocumentSha256);
    }
    expect((await f.request('native/api/draft', 'PUT', { expectedRevision: saved.revision, document: moved })).status).toBe(200);
    const restored = await reopenDraft(f), layout = readStudioCanvas(restored), root = resolveLogicAnchor(restored, anchor);
    if (!root) throw new Error('Expected the stable fragment owner after moving');
    expect(root.pointer).not.toBe(field);
    expect(layout.raw).toEqual(studioCanvas);
    expect(layout.warnings).toEqual([]);
    const after = liftJSON(Buffer.from(canonicalCompositionJSON(root.value)), { ...options, metadata: layout.metadata });
    expect(after.warnings.filter(warning => warning.code === 'invalid_layout')).toEqual([]);
    expect(after.graph.nodes.map(node => node.id)).toEqual(before.graph.nodes.map(node => node.id));
    expect(after.graph.nodes.map(node => node.position)).toEqual(studioCanvas.canvases[0].nodes.map(({ x, y }) => ({ x, y })));
    expect(atPointer(restored, '/studioCanvas')).toEqual(studioCanvas);
  });

  it.each(['removed', 'replaced'] as const)('does not attach %s canonical fragment positions to another owner after save, reopen and lift', async change => {
    const f = await lab(), initial = await f.draft(), base = draftDocument(initial.document.id);
    const other = { ...positionedTemplate, id: 'other-label' }, replacement = { ...positionedTemplate, id: 'replacement-label' };
    const document = { ...base, logicLibrary: [positionedTemplate, other, ...base.logicLibrary] };
    const anchor: LogicAnchor = { kind: 'logic', id: positionedTemplate.id, field: '/body/args/value' };
    const field = `/logicLibrary/0${anchor.field}`, options: LiftOptions = { kind: 'operand', anchor };
    const before = liftJSON(Buffer.from(canonicalCompositionJSON(atPointer(document, field))), options);
    const studioCanvas = positionedCanvas(document, before);
    const first = await f.request('native/api/draft', 'PUT', { expectedRevision: initial.revision, document: { ...document, studioCanvas } });
    expect(first.status).toBe(200);
    const saved: CompositionDraft = await first.json();
    const changed = { ...document, logicLibrary: [...(change === 'removed' ? [] : [replacement]), other, ...base.logicLibrary], studioCanvas };
    expect((await f.request('native/api/draft', 'PUT', { expectedRevision: saved.revision, document: changed })).status).toBe(200);
    const restored = await reopenDraft(f), layout = readStudioCanvas(restored);
    expect(resolveLogicAnchor(restored, anchor)).toBeUndefined();
    expect(layout.raw).toEqual(studioCanvas);
    expect(layout.metadata).toBeUndefined();
    expect(layout.warnings).toEqual([expect.objectContaining({ code: 'invalid_layout' })]);
    const newAnchor: LogicAnchor = { ...anchor, id: change === 'removed' ? other.id : replacement.id };
    const root = resolveLogicAnchor(restored, newAnchor);
    if (!root) throw new Error('Expected another owner at the old array position');
    expect(root.pointer).toBe(field);
    const automatic = liftJSON(Buffer.from(canonicalCompositionJSON(root.value)), { ...options, anchor: newAnchor });
    const after = liftJSON(Buffer.from(canonicalCompositionJSON(root.value)), { ...options, anchor: newAnchor, metadata: layout.metadata });
    expect(after.graph.nodes.map(node => node.id)).toEqual(before.graph.nodes.map(node => node.id));
    expect(after.graph.nodes.map(node => node.position)).toEqual(automatic.graph.nodes.map(node => node.position));
    expect(after.graph.nodes.map(node => node.position)).not.toEqual(studioCanvas.canvases[0].nodes.map(({ x, y }) => ({ x, y })));
    expect(atPointer(restored, '/studioCanvas')).toEqual(studioCanvas);
  });

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
