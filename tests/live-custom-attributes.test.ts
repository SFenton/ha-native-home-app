import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { documentAttributeReads, LiveEntityHub, openLiveSession, wantedAttributes, wantedEntities, type HubSocket, type LiveMessage } from '../server/ha-live';
import { projectNativeState } from '../server/native-home';
import { StudioStore } from '../server/store';
import { attributeOf, createEnvironment, houseFrom } from '../src/preview2/projections';
import { evaluateOperand, evaluatePredicate, unavailable, value } from '../src/preview2/evaluate';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { expandDocument } from '../src/shared/composition/components';
import { publishedDocument } from '../src/shared/composition/logic-library';
import type { CompositionDocument, CompositionNode } from '../src/shared/composition/schema';
import type { Operand } from '../src/shared/composition/expression';
import { objectOf, STRING } from '../src/shared/composition/pipeline/shape';
import type { PipelineSource } from '../src/shared/composition/pipeline/schema';
import type { NativeState } from '../src/shared/native-state';
import fixture from './fixtures/composition-first-slice.json';
import { fakeHomeAssistant } from './fake-ha-publication';

const entityId = 'sensor.demo_custom';
const sourceId = 'demo-source';
const source = { id: sourceId, kind: 'ha-entity' as const, entityId: { type: 'literal' as const, value: entityId } };
const read = (name: string, as: 'string' | 'number' | 'entity-id' = 'string', id = sourceId): Extract<Operand, { type: 'read' }> =>
  ({ type: 'read', from: { type: 'source', sourceId: id, path: ['attributes', name] }, as, missing: 'unavailable' });
const text = (id: string, operand: Operand = read('line')): Extract<CompositionNode, { type: 'text' }> => ({
  id, title: id, type: 'text', layout: { span: 1 },
  props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'Unavailable' },
});
const draft = (...components: CompositionNode[]) => compileCompositionDocument({
  ...structuredClone(fixture.document),
  dataSources: [...fixture.document.dataSources, source],
  pages: fixture.document.pages.map((page, index) => index === 2 ? { ...page, components } : page),
}).document;
const raw = (attributes: Record<string, unknown>) => ({ entity_id: entityId, state: 'off', attributes });
function privateFlowDraft(useLogic = false): CompositionDocument {
  const base = draft();
  const node = text('demo-private-body');
  const flow: PipelineSource = {
    id: sourceId, kind: 'model', model: 'pipeline@1',
    inputs: {
      title: 'Private line', parameters: [],
      request: { type: 'none', value: { type: 'object', fields: {
        attributes: { type: 'object', fields: { line: { type: 'literal', value: 'Private' } } },
      } } },
      steps: [], output: { kind: 'record' }, schema: objectOf({ attributes: objectOf({ line: STRING }) }),
    },
  };
  return compileCompositionDocument({
    ...base,
    ...(useLogic ? { logicLibrary: [{
      id: 'demo-private-logic', name: 'Private line', kind: 'operand', params: [{ name: 'src', kind: 'source-id' }],
      body: { ...read('line'), from: { type: 'source', sourceId: { type: 'hole', name: 'src' }, path: ['attributes', 'line'] } },
    }] } : {}),
    componentLibrary: [{
      id: 'demo-private-component', name: 'Private line', flows: [flow],
      node: { ...node, props: { ...node.props, value: { type: 'expr', value: useLogic
        ? { type: 'logic-ref', logicId: 'demo-private-logic', args: { src: sourceId } }
        : read('line') } } },
    }],
    pages: base.pages.map((page, index) => index === 2 ? { ...page, components: [{
      id: 'demo-private-instance', type: 'component-ref', componentId: 'demo-private-component', layout: { span: 1 },
    }] } : page),
  }).document;
}
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

describe('draft-scoped Home Assistant attribute reads', () => {
  it('forwards the draft-named attribute and resolves it in the preview, not unnamed attributes or one-shot snapshots', () => {
    const document = draft(text('demo-line'));
    const state = projectNativeState(raw({ line: 'Off', unnamed: 'Never requested' }), documentAttributeReads(document).get(entityId));
    expect(state.attributes).toEqual({ line: 'Off' });
    expect(projectNativeState(raw({ line: 'Off' })).attributes).toBeUndefined();
    const env = createEnvironment(document, houseFrom({ states: [state] }));
    expect(evaluateOperand(read('line'), env)).toEqual(value('Off'));
    expect(env.read(sourceId, ['attributes', 'unnamed'])).toEqual(unavailable);
  });

  it('collects slot reads, nested operands, state and numeric predicates, list reads and reads inside an entity-id operand', () => {
    const document = draft(
      { ...text('demo-slot'), props: { value: read('slot'), style: 'body', unavailableText: 'Unavailable' } },
      { ...text('demo-predicate'), visibleWhen: { type: 'all', of: [
        { type: 'state', sourceId, path: ['attributes', 'line'], in: ['Off'] },
        { type: 'numeric', sourceId, path: ['attributes', 'level'], above: { type: 'literal', value: 0 } },
      ] }, whenUnknown: 'hide' },
      text('demo-format', { type: 'format', pattern: '{text}', args: { text: read('nested') } }),
      text('demo-list', { type: 'list-count', from: { type: 'source', sourceId, path: ['attributes', 'items'] } }),
      text('demo-includes', { type: 'list-includes', from: { type: 'source', sourceId, path: ['attributes', 'choices'] }, value: { type: 'literal', value: 'A' } }),
    );
    document.dataSources.push({ id: 'demo-dynamic', kind: 'ha-entity', entityId: read('selected_entity', 'entity-id') });
    document.pages[2].components.push(text('demo-dynamic-read', read('dynamic_line', 'string', 'demo-dynamic')));
    const validated = compileCompositionDocument(document).document;
    const requested = documentAttributeReads(validated);
    expect([...requested.get(entityId)!].sort()).toEqual(['choices', 'items', 'level', 'line', 'nested', 'selected_entity', 'slot']);
    expect(requested.size).toBe(1);
    expect([...requested.values()].some(names => names.has('dynamic_line'))).toBe(false);
  });

  it('does not interpret JSON literal payloads as reads', () => {
    const document = draft({
      ...text('demo-line'), visibleWhen: { type: 'exists', value: { type: 'literal', value: read('not_a_read') } }, whenUnknown: 'hide',
    });
    expect(documentAttributeReads(document).get(entityId)).toEqual(new Set(['line']));
  });

  it('works out parameterized logic and per-instance component source bindings without changing the draft', () => {
    const base = draft();
    const document = compileCompositionDocument({
      ...base,
      logicLibrary: [{
        id: 'demo-line-logic', name: 'Line', kind: 'operand', params: [{ name: 'src', kind: 'source-id' }],
        body: { ...read('line'), from: { type: 'source', sourceId: { type: 'hole', name: 'src' }, path: ['attributes', 'line'] } },
      }],
      componentLibrary: [{
        id: 'demo-component', name: 'Line component', sources: [source],
        params: [{ name: 'entity', kind: 'entity-id' }],
        bindings: [{ param: 'entity', sourceId, field: 'entityId/value' }],
        node: {
          id: 'demo-body', title: 'Line', type: 'text', layout: { span: 1 },
          props: { value: { type: 'expr', value: { type: 'logic-ref', logicId: 'demo-line-logic', args: { src: sourceId } } }, style: 'body', unavailableText: 'Unavailable' },
        },
      }],
      pages: base.pages.map((page, index) => index === 2 ? { ...page, components: [{
        id: 'demo-instance', type: 'component-ref', componentId: 'demo-component', layout: { span: 1 }, args: { entity: 'sensor.demo_other' },
      }] } : page),
    }).document;
    const before = JSON.stringify(document);
    const requested = documentAttributeReads(document);
    expect(requested.get('sensor.demo_other')).toEqual(new Set(['line']));
    const expanded = expandDocument(publishedDocument(document));
    const state = projectNativeState({ entity_id: 'sensor.demo_other', state: 'off', attributes: { line: 'Other' } }, requested.get('sensor.demo_other'));
    expect(createEnvironment(expanded, houseFrom({ states: [state] })).read('demo-instance~demo-source', ['attributes', 'line'])).toEqual(value('Other'));
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each([false, true])('does not request global attributes shadowed by a private flow (logic: %s)', useLogic => {
    const document = privateFlowDraft(useLogic);
    const before = JSON.stringify(document);
    expect(documentAttributeReads(document).get(entityId)).toBeUndefined();
    const expanded = expandDocument(publishedDocument(document));
    const env = createEnvironment(expanded, houseFrom({ states: [projectNativeState(raw({ line: 'Global' }), new Set(['line']))] }));
    expect(env.read(sourceId, ['attributes', 'line'])).toEqual(value('Global'));
    expect(env.read('demo-private-instance~demo-source', ['attributes', 'line'])).toEqual(unavailable);
    expect(JSON.stringify(document)).toBe(before);
    document.pages[2].components = [];
    expect(documentAttributeReads(document).get(entityId)).toBeUndefined();
  });

  it('keeps inherited global reads inside a private flow when their source id is not shadowed', () => {
    const document = privateFlowDraft();
    document.dataSources.push({ ...source, id: 'demo-global-source' });
    document.componentLibrary![0].flows![0].inputs.parameters.push({
      name: 'line', type: 'string', value: read('line', 'string', 'demo-global-source'),
    });
    expect(documentAttributeReads(compileCompositionDocument(document).document).get(entityId)).toEqual(new Set(['line']));
  });

  it('recomputes wanted attributes by revision even when the entity ids do not change', () => {
    let current = { revision: 1, document: draft(text('demo-line')) };
    const wanted = wantedAttributes(() => current);
    const first = wanted();
    expect(wanted()).toBe(first);
    current = { revision: 1, document: draft(text('demo-mode', read('mode'))) };
    expect(wanted()).toBe(first);
    current = { ...current, revision: 2 };
    expect(wanted()).not.toBe(first);
    expect(wanted().get(entityId)).toEqual(new Set(['mode']));
  });
});

describe('safe custom attribute projection', () => {
  it.each([
    'access_token', 'entity_picture', 'Entity_Picture', 'Entity.Picture', 'token_count', 'PASSWORD', 'passwd', 'session_secret',
    'api_key', 'apiKey', 'api-key', 'Api.Key', 'x_api_key', 'credential_bundle', 'Authorization',
    'bearer', 'BeArEr', 'session', 'Session.Id', 'cookie', 'Set-Cookie', 'signature', 'Signature', 'sig', 'X-Sig',
    'private-key', 'push_url', 'webhook',
  ])('drops the entire attribute for denied top-level, nested and array key %s', name => {
    const attributes = {
      [name]: 'demo-private', line: 'Off',
      nested: { label: 'Safe', details: { [name]: 'demo-private' } },
      array: ['Safe', { [name]: 'demo-private' }],
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual({ line: 'Off' });
  });

  it.each([
    '/api/camera_proxy/camera.demo_front?token=demo-private',
    'https://demo.invalid/image?access_token=demo-private',
    '/image?authSig=demo-private',
    '/image?signature=demo-private',
    '/image?key=demo-private',
    '/image?sig=demo-private',
    '/image?size=small&Api.Key=demo-private',
    '/image?x_api_key=demo-private',
    '/image?%74oken=demo-private',
    'token=demo-private',
    'access_token=demo-private',
    'authSig=demo-private',
    'signature=demo-private',
    'key=demo-private',
    'metadata:token=demo-private',
    'metadata:key=demo-private',
    'Image URL: /image?TOKEN=demo-private',
    'Bearer demo-private',
    'bearer demo-private',
    'Authorization:Bearer demo-private',
    'https://demo-user:demo-password@demo.invalid/image',
    '//demo-user:demo-password@demo.invalid/image',
    String.raw`https:\demo-user:demo-password@demo.invalid/image`,
    'Image URL: https://demo-user:demo-password@demo.invalid/image',
  ])('drops the entire attribute for credential-bearing strings at any depth: %s', input => {
    const attributes = {
      line: 'Off', thumbnail: input,
      nested: { label: 'Safe', details: { url: input } },
      array: ['Safe', { url: input }],
      deep_array: [['Safe'], [input]],
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual({ line: 'Off' });
  });

  it('keeps ordinary strings, public URLs and non-sensitive keys', () => {
    const attributes = {
      thumbnail: '/api/camera_proxy/camera.demo_front?width=120',
      details: { signal: 'Strong', design: 'Compact', key: 'demo-row', note: 'Token count is 3', url: 'https://demo.invalid/image?size=small' },
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual(attributes);
  });

  it('keeps JSON scalars, arrays and objects, but rejects non-JSON values and nested credential fields', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const attributes = {
      line: 'Off', zero: 0, no: false, nil: null, list: ['A', 0, false, null], details: { text: 'Off', values: [1, 2] },
      undef: undefined, nan: NaN, infinity: Infinity, bigint: 1n, fn: () => 'Off', symbol: Symbol('Off'),
      date: new Date(), map: new Map(), set: new Set(), cyclic,
      bad_list: [undefined], bad_object: { value: undefined }, to_json: { toJSON: () => 'Off' },
      nested_private: { records: [{ password: 'private' }] }, nested_picture: { entity_picture: '/api/private' },
    };
    const state = projectNativeState(raw(attributes), new Set(Object.keys(attributes)));
    expect(state.attributes).toEqual({ line: 'Off', zero: 0, no: false, nil: null, list: ['A', 0, false, null], details: { text: 'Off', values: [1, 2] } });
  });

  it('enforces the 4 KiB serialized byte boundary, including multi-byte strings', () => {
    const attributes = { boundary: 'x'.repeat(4094), over: 'x'.repeat(4095), unicode_boundary: '\u00e9'.repeat(2047), unicode_over: '\u00e9'.repeat(2048), object_over: { text: 'x'.repeat(4090) } };
    const state = projectNativeState(raw(attributes), new Set(Object.keys(attributes)));
    expect(state.attributes).toEqual({ boundary: attributes.boundary, unicode_boundary: attributes.unicode_boundary });
    expect(Buffer.byteLength(JSON.stringify(state.attributes?.boundary))).toBe(4096);
  });

  it('keeps native fields and aliases authoritative even when custom names collide', () => {
    const attributes = {
      friendly_name: 'Actual', unit_of_measurement: 'C', current_temperature: 20, brightness: 0,
      state: 'shadow', entity_id: 'shadow', name: 'shadow', unit: 'shadow', currentTemperature: 99, last_changed: 'shadow',
    };
    const state = projectNativeState(raw(attributes), new Set(Object.keys(attributes)));
    expect(state).toMatchObject({ entityId, state: 'off', name: 'Actual', unit: 'C', currentTemperature: 20, brightness: 0 });
    for (const [name, expected] of Object.entries({ friendly_name: 'Actual', name: 'Actual', state: 'off', entity_id: entityId, unit: 'C', unit_of_measurement: 'C', currentTemperature: 20, brightness: 0 })) {
      expect(attributeOf(state, name)).toEqual(expected);
    }
    expect(attributeOf(state, 'last_changed')).toBeUndefined();
    expect(attributeOf(state, 'attributes')).toBeUndefined();
    expect(attributeOf(state, 'toString')).toBeUndefined();
  });
});

class FakeSocket implements HubSocket {
  private listeners: ((event: { data?: unknown }) => void)[] = [];
  send() {}
  close() {}
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) { if (type === 'message') this.listeners.push(listener); }
  receive(payload: unknown) { for (const listener of this.listeners) listener({ data: JSON.stringify(payload) }); }
  connect(attributes: Record<string, unknown>) {
    this.receive({ type: 'auth_required' }); this.receive({ type: 'auth_ok' });
    this.receive({ id: 1, type: 'event', event: { a: { [entityId]: { s: 'off', a: attributes } } } });
  }
}
function liveHub() {
  const socket = new FakeSocket();
  const hub = new LiveEntityHub({ url: 'ws://demo.invalid/api/websocket', token: 'demo-ha-private-token', createSocket: () => socket });
  cleanup.push(() => hub.stop());
  return { hub, socket };
}
const statesOf = (message: LiveMessage): NativeState[] => message.type === 'status' ? [] : message.states;

describe('live draft revisions and session isolation', () => {
  beforeEach(() => vi.useFakeTimers());

  it('does not stream global attributes requested only through a shadowing private flow', () => {
    const { hub, socket } = liveHub();
    const messages: LiveMessage[] = [], document = privateFlowDraft(true);
    cleanup.push(openLiveSession(hub, () => new Set([entityId]), message => messages.push(message), {
      attributes: wantedAttributes(() => ({ revision: 1, document })),
    }));
    socket.connect({ line: 'Global' });
    vi.advanceTimersByTime(60);
    expect(statesOf(messages.at(-1)!)).toEqual([projectNativeState(raw({ line: 'Global' }))]);
    messages.length = 0;
    socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: 'Unrequested update' } } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([]);
  });

  it('adds, replaces and removes custom attributes without needing an HA state change', () => {
    const { hub, socket } = liveHub();
    let current = { revision: 1, document: draft(text('demo-line')) };
    const messages: LiveMessage[] = [], references = new Set([entityId]);
    cleanup.push(openLiveSession(hub, wantedEntities(() => references, () => current), message => messages.push(message), { attributes: wantedAttributes(() => current) }));
    socket.connect({ line: 'Off', mode: 'Sleep' });
    vi.advanceTimersByTime(60);
    expect(statesOf(messages.at(-1)!)[0].attributes).toEqual({ line: 'Off' });
    messages.length = 0;
    current = { revision: 2, document: draft(text('demo-mode', read('mode'))) };
    vi.advanceTimersByTime(1100);
    expect(messages).toHaveLength(1);
    expect(statesOf(messages[0])[0].attributes).toEqual({ mode: 'Sleep' });
    const env = createEnvironment(current.document, houseFrom({ states: statesOf(messages[0]) }));
    expect(evaluateOperand(read('mode'), env)).toEqual(value('Sleep'));
    expect(evaluatePredicate({ type: 'state', sourceId, path: ['attributes', 'mode'], in: ['Sleep'] }, env)).toBe('yes');
    expect(env.read(sourceId, ['attributes', 'line'])).toEqual(unavailable);
    messages.length = 0;
    current = { revision: 3, document: draft(text('demo-no-read', { type: 'literal', value: 'Static' })) };
    vi.advanceTimersByTime(1100);
    expect(messages).toHaveLength(1);
    expect(statesOf(messages[0])[0].attributes).toBeUndefined();
  });

  it('keeps requested attributes out of the shared projection and other sessions, and streams actual attribute changes', () => {
    const { hub, socket } = liveHub();
    const wanted = new Set([entityId]), first: LiveMessage[] = [], second: LiveMessage[] = [];
    cleanup.push(openLiveSession(hub, () => wanted, message => first.push(message), { attributes: wantedAttributes(() => ({ revision: 1, document: draft(text('demo-line')) })) }));
    cleanup.push(openLiveSession(hub, () => wanted, message => second.push(message), { attributes: wantedAttributes(() => ({ revision: 1, document: draft(text('demo-mode', read('mode'))) })) }));
    socket.connect({ line: 'Off', mode: 'Sleep', unnamed: 'Private' });
    vi.advanceTimersByTime(60);
    expect(statesOf(first.at(-1)!)[0].attributes).toEqual({ line: 'Off' });
    expect(statesOf(second.at(-1)!)[0].attributes).toEqual({ mode: 'Sleep' });
    expect(hub.project(entityId)?.attributes).toBeUndefined();
    first.length = second.length = 0;
    socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: 'On' } } } } } });
    vi.advanceTimersByTime(60);
    expect(statesOf(first[0])[0].attributes).toEqual({ line: 'On' });
    expect(second).toEqual([]);
  });

  it('still drops and removes a state if a safely named attribute contains a server credential', () => {
    const { hub, socket } = liveHub();
    const credential = 'demo-server-private-credential';
    const messages: LiveMessage[] = [], document = draft(text('demo-line'));
    cleanup.push(openLiveSession(hub, () => new Set([entityId]), message => messages.push(message), { credentials: [credential], attributes: wantedAttributes(() => ({ revision: 1, document })) }));
    socket.connect({ line: 'Off' });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: { nested: credential } } } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([{ type: 'update', states: [], removed: [entityId] }]);
    expect(JSON.stringify(messages)).not.toContain(credential);
  });
});

it('wires the authenticated SSE endpoint to the persisted draft revision', async () => {
  const haToken = 'demo-ha-private-token', authToken = 'demo-studio-private-token';
  const fake = await fakeHomeAssistant({ token: haToken, houseConfig: { home: { entity: entityId } }, entities: { [entityId]: { state: 'off', attributes: { line: 'Off', mode: 'Sleep', unnamed: 'Private' } } } });
  cleanup.push(() => fake.close());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'live-custom-attributes-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const store = await StudioStore.open(directory);
  cleanup.push(() => store.close());
  const initial = store.native.getDraft();
  const document = { ...initial.document, dataSources: [...initial.document.dataSources, source], pages: initial.document.pages.map((page, index) => index === 0 ? { ...page, components: [...page.components, text('demo-line')] } : page) };
  const saved = await store.native.save(document, initial.revision);
  const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken, haUrl: fake.url, haToken });
  const server = http.createServer(application.app);
  application.app.use(application.errorHandler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, controller = new AbortController();
  cleanup.push(() => controller.abort());
  const headers = { Authorization: `Bearer ${authToken}` };
  const response = await fetch(`${base}/api/live/states`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const nextStates = async (type: 'snapshot' | 'update') => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!data) continue;
        const message: LiveMessage = JSON.parse(data);
        if (message.type === type) return message.states;
        continue;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('Live stream ended before the expected states');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const snapshot = await nextStates('snapshot');
  expect(snapshot.find(state => state.entityId === entityId)?.attributes).toEqual({ line: 'Off' });
  const updated = { ...document, pages: document.pages.map((page, index) => index === 0 ? { ...page, components: [...page.components.slice(0, -1), text('demo-mode', read('mode'))] } : page) };
  const result = await fetch(`${base}/native/api/draft`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: saved.revision, document: updated }) });
  expect(result.status).toBe(200);
  const update = await nextStates('update');
  expect(update.find(state => state.entityId === entityId)?.attributes).toEqual({ mode: 'Sleep' });
  expect(JSON.stringify([snapshot, update])).not.toContain(haToken);
  expect(JSON.stringify([snapshot, update])).not.toContain(authToken);
  expect(fake.serviceCalls).toEqual([]);
}, 15000);
