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

  it('only requests allowlisted plain-ASCII attribute names without normalizing HA keys', () => {
    const names = ['line', 'author', 'auth', 'x_authorization', 'x_sig', 'Line', 'api-key', 'n'.repeat(65)];
    const document = draft(...names.map((name, index) => text(`demo-name-${index}`, read(name))));
    const requested = documentAttributeReads(document);
    expect(requested.get(entityId)).toEqual(new Set(['line', 'author']));
    expect(projectNativeState(raw({ Line: 'Wrong key', author: 'Demo Owner' }), requested.get(entityId)).attributes).toEqual({ author: 'Demo Owner' });
  });
});

describe('safe custom attribute projection', () => {
  it.each([
    'access_token', 'entity_picture', 'Entity_Picture', 'Entity.Picture', 'token_count', 'PASSWORD', 'passwd', 'session_secret',
    'api_key', 'apiKey', 'api-key', 'Api.Key', 'x_api_key', 'credential_bundle', 'Authorization',
    'bearer', 'BeArEr', 'session', 'Session.Id', 'cookie', 'Set-Cookie', 'signature', 'Signature', 'sig', 'X-Sig',
    'private-key', 'push_url', 'webhook', 'auth', 'oauth', 'x_auth', 'authorization', 'x_authorization', 'x_sig',
    'api%2Dkey', '%74oken', '\uff41\uff50\uff49\uff0d\uff4b\uff45\uff59', '', 'n'.repeat(65), 'line.name', 'line name', 'line\n', '\u00e9',
  ])('drops attributes with refused names and structured values: %s', name => {
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
    '/image?api%2Dkey=demo-private',
    '/image?\uff41\uff50\uff49\uff0d\uff4b\uff45\uff59=demo-private',
    '/image?to!ken=demo-private',
    '/image?token[]=demo-private',
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
    '{"access_token":"x"}',
    '["demo-private"]',
    `data:text/plain;base64,${Buffer.from('demo-private').toString('base64')}`,
    'data:Off', 'DATA:Off', '  data:Off', '//example.invalid/path', 'Bearer', 'A BEARER label',
    'Public https://demo.invalid/image', 'plain://value',
    'Question?', 'Percent 50%', 'A=B', 'demo@example.invalid', 'Object {', 'Array [', String.raw`Path \ demo`,
    'Control \0', 'Control \t', 'Control \n', 'Control \u007f', 'Control \u0085',
    'Format \u200b', 'Format \u202e', 'Format \u2066', 'Format \ufeff',
    'Fullwidth \uff41', 'Fullwidth \uff11', 'Fullwidth \uff1f', 'Fullwidth \uffef',
    'Symbol \u221e', 'Emoji \ud83d\ude00', 'Private \ue000', 'Surrogate \ud800', 'Combining e\u0301',
    'Demo\u00a0Owner', 'Paused\u2026', '\u00e9'.repeat(24), '\u6570'.repeat(24),
    'a'.repeat(24), 'Prefix ' + 'a'.repeat(25), '+/_-'.repeat(6),
  ])('drops the whole attribute for refused top-level or flat-array strings: %s', input => {
    const attributes = {
      line: 'Off', thumbnail: input,
      array: ['Safe', input],
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual({ line: 'Off' });
  });

  it('keeps ordinary text and non-sensitive ASCII names, including common Unicode letters and punctuation', () => {
    const attributes = {
      signal: 'Strong', design: 'Compact', key: 'demo-row', author: 'Demo Owner', note: 'Token count is 3',
      accented: 'Caf\u00e9', letters: '\u6570\u5024 12', punctuation: '\u201cOff\u201d \u2013 paused', space: 'Demo Owner',
      ordinary_word: 'Unbearable', near_run: 'a'.repeat(23),
      n: 'One', ['n'.repeat(64)]: 'Sixty-four', _: 'Underscore',
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual(attributes);
  });

  it('keeps plain scalars and flat arrays, but rejects objects, nested arrays and non-JSON values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const attributes = {
      line: 'Off', level: 0, no: false, ends_at: null, list: ['A', 0, false, null], numbers: [0, 1, 2], empty: [],
      details: { text: 'Off', values: [1, 2] }, nested: [[1, 2]], mixed: ['Safe', { label: 'Off' }],
      undef: undefined, nan: NaN, infinity: Infinity, negative_infinity: -Infinity, bigint: 1n, fn: () => 'Off', symbol: Symbol('Off'),
      date: new Date(), map: new Map(), set: new Set(), cyclic,
      bad_list: [undefined], bad_number_list: [1, Infinity], sparse_list: Array(1), bad_object: { value: undefined }, to_json: { toJSON: () => 'Off' },
      nested_private: { records: [{ password: 'private' }] }, nested_picture: { entity_picture: '/api/private' },
    };
    const state = projectNativeState(raw(attributes), new Set(Object.keys(attributes)));
    expect(state.attributes).toEqual({ line: 'Off', level: 0, no: false, ends_at: null, list: ['A', 0, false, null], numbers: [0, 1, 2], empty: [] });
  });

  it('enforces 256-character strings and 32-item arrays, dropping a whole array when any item is refused', () => {
    const boundary = 'x '.repeat(128), over = boundary + 'x';
    const attributes = {
      boundary, over, array_boundary: [boundary], array_over: ['Safe', over],
      unicode_boundary: '\u00e9 '.repeat(128), unicode_over: '\u00e9 '.repeat(128) + '\u00e9',
      items_boundary: Array(32).fill(0), items_over: Array(33).fill(0),
      text_items_boundary: Array(32).fill(boundary),
    };
    const state = projectNativeState(raw(attributes), new Set(Object.keys(attributes)));
    expect(state.attributes).toEqual({
      boundary, array_boundary: [boundary], unicode_boundary: attributes.unicode_boundary,
      items_boundary: attributes.items_boundary, text_items_boundary: attributes.text_items_boundary,
    });
  });

  it('bounds finite scalar and array numbers to an absolute value of 1e15', () => {
    const attributes = {
      minimum: -1e15, maximum: 1e15, numbers: [-1e15, 0, 1e15],
      above: 1e15 + 1, below: -1e15 - 1, exponent: 1e21,
      array_above: [0, 1e15 + 1], array_below: [-1e15 - 1, 0],
    };
    expect(projectNativeState(raw(attributes), new Set(Object.keys(attributes))).attributes).toEqual({
      minimum: -1e15, maximum: 1e15, numbers: [-1e15, 0, 1e15],
    });
  });

  it('treats a requested __proto__ name as a plain own attribute rather than changing the result prototype', () => {
    const attributes: Record<string, unknown> = JSON.parse('{"__proto__":["Off"]}');
    const extra = projectNativeState(raw(attributes), new Set(['__proto__'])).attributes;
    expect(JSON.stringify(extra)).toBe('{"__proto__":["Off"]}');
    expect(Object.getPrototypeOf(extra)).toBe(Object.prototype);
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

describe.each(['snapshot', 'delta'] as const)('credential-safe custom attributes on the %s path', phase => {
  beforeEach(() => vi.useFakeTimers());
  const haCredential = 'demo-ha-a1b2c3d4e5f6g7h8';
  const supervisorCredential = 'demo-supervisor-i9j0k1l2m3n4o5p6';
  const authCredential = 'demo-studio-q7r8s9t0u1v2w3x4';
  const digitCredential = '1234567890123456';
  const credentials = [haCredential, supervisorCredential, authCredential, digitCredential, '10000000000000000', '1000000000000000000000', 'demo-42-a'];
  const mathematicalBold = Array.from(haCredential, character => /[a-z]/.test(character)
    ? String.fromCodePoint(0x1d41a + character.charCodeAt(0) - 97)
    : /[0-9]/.test(character) ? String.fromCodePoint(0x1d7ce + character.charCodeAt(0) - 48) : character).join('');

  it.each([
    { name: 'literal configured token', input: haCredential },
    { name: 'mathematical-bold configured token', input: mathematicalBold },
    { name: 'fullwidth configured digits', input: Array.from(digitCredential, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0)).join('') },
    { name: 'space-separated HA credential', input: haCredential.split('').join(' ') },
    { name: 'colon-separated Supervisor credential', input: supervisorCredential.split('').join(':') },
    { name: 'punctuation-separated Studio credential', input: authCredential.split('').join(",'-") },
    { name: 'credential fragments across flat array items', input: ['demo-studio-', false, 'q7r8s9t0', null, 'u1v2w3x4'] },
    { name: 'credential fragments across strings and numbers', input: ['1234', 5678, '9012', 3456] },
    { name: 'credential fragments across number items', input: [1234, 5678, 9012, 3456] },
    { name: 'non-prefix credential window with mixed case', input: 'Read: A1 B2 C3 D4 E5 F6, done.' },
    { name: 'credential shorter than twelve canonical characters', input: 'DE MO: 42: A' },
    { name: 'in-range numeric credential', input: 123456789012345 },
    { name: 'large numeric configured credential', input: 10000000000000000 },
    { name: 'exponent-form configured credential', input: 1e+21 },
    { name: 'large numeric credential in an array', input: [0, 1e+21] },
    { name: 'leading-whitespace data prefix', input: '  data:Off' },
    { name: 'leading-whitespace data prefix in an array', input: ['Safe', '  DaTa:Off'] },
    { name: 'protocol-relative URL', input: '//example.invalid/path' },
    { name: 'protocol-relative URL in an array', input: ['Safe', '//example.invalid/path'] },
    { name: 'Unicode opaque run', input: '\u00e9'.repeat(24) },
    { name: 'Unicode opaque run in an array', input: ['Safe', '\u6570'.repeat(24)] },
  ])('drops the whole attribute for $name', ({ input }) => {
    const { hub, socket } = liveHub();
    const messages: LiveMessage[] = [], wanted = new Set([entityId]), requested = new Map([[entityId, new Set(['line', 'level'])]]);
    cleanup.push(openLiveSession(hub, () => wanted, message => messages.push(message), {
      credentials, attributes: () => requested,
    }));
    socket.connect({ line: phase === 'snapshot' ? input : 'Off', level: 0 });
    vi.advanceTimersByTime(60);
    if (phase === 'delta') {
      expect(statesOf(messages.at(-1)!)[0].attributes).toEqual({ line: 'Off', level: 0 });
      messages.length = 0;
      socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: input } } } } } });
      vi.advanceTimersByTime(60);
    }
    const expectedState = { ...projectNativeState(raw({})), attributes: { level: 0 } };
    expect(messages.at(-1)).toEqual(phase === 'snapshot'
      ? { type: 'snapshot', connected: true, states: [expectedState] }
      : { type: 'update', states: [expectedState], removed: [] });
    for (const credential of credentials) expect(JSON.stringify(messages)).not.toContain(credential);
  });

  it('preserves ordinary scalars, sentences, ISO timestamps and numeric arrays', () => {
    const { hub, socket } = liveHub();
    const ordinary = {
      line: 'Off', level: 0, ends_at: null, enabled: false,
      sentence: "Ready, mode: Off; it's paused.",
      timestamp: '2026-11-21T17:55:42+00:00',
      numbers: [-42, 0, 1, 2.5],
    };
    const messages: LiveMessage[] = [], wanted = new Set([entityId]), requested = new Map([[entityId, new Set(Object.keys(ordinary))]]);
    cleanup.push(openLiveSession(hub, () => wanted, message => messages.push(message), {
      credentials, attributes: () => requested,
    }));
    socket.connect(phase === 'snapshot' ? ordinary : { line: 'On' });
    vi.advanceTimersByTime(60);
    if (phase === 'delta') {
      messages.length = 0;
      socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: ordinary } } } } });
      vi.advanceTimersByTime(60);
    }
    expect(statesOf(messages.at(-1)!)[0].attributes).toEqual(ordinary);
  });

  it('keeps credential filtering per session instead of caching it in shared projections', () => {
    const { hub, socket } = liveHub();
    const input = haCredential.split('').join(' ');
    const first: LiveMessage[] = [], second: LiveMessage[] = [], wanted = new Set([entityId]);
    const requested = new Map([[entityId, new Set(['line'])]]);
    cleanup.push(openLiveSession(hub, () => wanted, message => first.push(message), { credentials, attributes: () => requested }));
    cleanup.push(openLiveSession(hub, () => wanted, message => second.push(message), { credentials: ['demo-unrelated-credential'], attributes: () => requested }));
    socket.connect({ line: phase === 'snapshot' ? input : 'Off' });
    vi.advanceTimersByTime(60);
    if (phase === 'delta') {
      first.length = second.length = 0;
      socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: input } } } } } });
      vi.advanceTimersByTime(60);
    }
    expect(statesOf(first.at(-1)!)[0].attributes).toBeUndefined();
    expect(statesOf(second.at(-1)!)[0].attributes).toEqual({ line: input });
    expect(hub.project(entityId)?.attributes).toBeUndefined();
  });
});

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

  it('still drops and removes a state if a native field contains a server credential', () => {
    const { hub, socket } = liveHub();
    const credential = 'demo-private';
    const messages: LiveMessage[] = [], document = draft(text('demo-line'));
    cleanup.push(openLiveSession(hub, () => new Set([entityId]), message => messages.push(message), { credentials: [credential], attributes: wantedAttributes(() => ({ revision: 1, document })) }));
    socket.connect({ line: 'Off' });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { friendly_name: `State ${credential}` } } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([{ type: 'update', states: [], removed: [entityId] }]);
    expect(JSON.stringify(messages)).not.toContain(credential);
  });

  it.each([
    '{"access_token":"x"}',
    `data:text/plain;base64,${Buffer.from('demo-private').toString('base64')}`,
  ])('removes a previously plain attribute when its update contains a refused flat-array string: %s', input => {
    const { hub, socket } = liveHub();
    const messages: LiveMessage[] = [], document = draft(text('demo-line'));
    cleanup.push(openLiveSession(hub, () => new Set([entityId]), message => messages.push(message), {
      credentials: ['demo-private'], attributes: wantedAttributes(() => ({ revision: 1, document })),
    }));
    socket.connect({ line: 'Off' });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    socket.receive({ id: 1, type: 'event', event: { c: { [entityId]: { '+': { a: { line: ['Safe', input] } } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([{ type: 'update', states: [projectNativeState(raw({}))], removed: [] }]);
    expect(JSON.stringify(messages)).not.toContain(input);
    expect(JSON.stringify(messages)).not.toContain('demo-private');
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

it('ignores a configured credential with no letters or digits instead of dropping every attribute', async () => {
  const { projectNativeAttributes } = await import('../server/native-home');
  const wanted = new Set(['line', 'level', 'enabled', 'ends_at']);
  const attributes = { line: 'Off', level: 0, enabled: true, ends_at: null };
  expect(projectNativeAttributes(attributes, wanted, ['.'.repeat(24)])).toEqual(attributes);
  expect(projectNativeAttributes(attributes, wanted, ['..a..b..c..'])).toEqual(attributes);
  expect(projectNativeAttributes({ line: 'demo token 0123456789abcdef' }, new Set(['line']), ['0123456789abcdef'])).toBeUndefined();
});
