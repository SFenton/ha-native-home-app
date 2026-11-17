import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentEntityIds, EntityCache, LiveEntityHub, openLiveSession, wantedEntities, type HubSocket, type LiveMessage } from '../server/ha-live';

/** The token the fake hub is given. It must never reach a page. */
const TOKEN = 'secret-token-0123456789-abcdefghij';
const URL_TEXT = 'ws://ha.invalid/api/websocket';

class FakeSocket implements HubSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
  addEventListener(type: string, listener: (event: { data?: unknown }) => void) { (this.listeners[type] ??= []).push(listener); }
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close() { this.closed = true; }
  receive(value: unknown) { for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(value) }); }
  drop() { for (const listener of this.listeners.close ?? []) listener({}); }
}

const entry = (state: string, attributes: Record<string, unknown> = {}) => ({ s: state, a: attributes, c: 1, lc: 1, lu: 1 });
function setup(options: { idleCloseMs?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const hub = new LiveEntityHub({ url: URL_TEXT, token: TOKEN, backoffMs: { initial: 1000, max: 8000 }, idleCloseMs: options.idleCloseMs ?? 60_000, createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } });
  return { hub, sockets };
}
/** Authenticates the hub's newest socket and delivers the first full picture. */
function connect(socket: FakeSocket, entities: Record<string, ReturnType<typeof entry>>) {
  socket.receive({ type: 'auth_required' });
  socket.receive({ type: 'auth_ok' });
  socket.receive({ id: 1, type: 'result', success: true, result: null });
  socket.receive({ id: 1, type: 'event', event: { a: entities } });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('EntityCache', () => {
  it('rebuilds states from the compressed events', () => {
    const cache = new EntityCache();
    expect(cache.apply({ a: { 'light.demo_a': entry('on', { brightness: 100, friendly_name: 'A' }), 'sensor.demo_b': entry('1') } }, true).changed.sort()).toEqual(['light.demo_a', 'sensor.demo_b']);
    // A diff: new state, a new attribute, a dropped one.
    const change = cache.apply({ c: { 'light.demo_a': { '+': { s: 'off', a: { color_mode: 'hs' } }, '-': { a: ['brightness'] } } } });
    expect(change).toEqual({ changed: ['light.demo_a'], removed: [] });
    expect(cache.get('light.demo_a')).toEqual({ state: 'off', attributes: { friendly_name: 'A', color_mode: 'hs' } });
    expect(cache.apply({ r: ['sensor.demo_b', 'sensor.demo_missing'] })).toEqual({ changed: [], removed: ['sensor.demo_b'] });
    expect(cache.size).toBe(1);
  });
  it('reports only real changes and drops what a full picture leaves out', () => {
    const cache = new EntityCache();
    cache.apply({ a: { 'light.demo_a': entry('on'), 'light.demo_gone': entry('on') } }, true);
    const again = cache.apply({ a: { 'light.demo_a': entry('on'), 'light.demo_new': entry('off') } }, true);
    expect(again).toEqual({ changed: ['light.demo_new'], removed: ['light.demo_gone'] });
    expect(cache.apply({ c: { 'light.demo_a': { '+': { s: 'on' } } } }).changed).toEqual([]);
    expect(cache.apply({ c: { 'light.demo_unknown': { '+': { s: 'on' } } }, a: 'nonsense' } as never).changed).toEqual([]);
  });
});

describe('LiveEntityHub and a page session', () => {
  it('authenticates, subscribes once, then streams a snapshot and changes', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    const stop = openLiveSession(hub, () => new Set(['light.demo_a', 'sensor.demo_b']), message => messages.push(message), { credentials: [TOKEN] });
    expect(sockets).toHaveLength(1);
    connect(sockets[0], { 'light.demo_a': entry('on', { friendly_name: 'A', brightness: 120 }), 'sensor.demo_b': entry('21.5', { unit_of_measurement: 'C' }), 'light.demo_unwanted': entry('on') });
    expect(sockets[0].sent[0]).toEqual({ type: 'auth', access_token: TOKEN });
    expect(sockets[0].sent[1]).toEqual({ id: 1, type: 'subscribe_entities' });
    vi.advanceTimersByTime(60);
    const snapshot = messages.find(message => message.type === 'snapshot');
    expect(snapshot).toMatchObject({ type: 'snapshot', connected: true });
    expect(snapshot?.type === 'snapshot' && snapshot.states.map(state => [state.entityId, state.state]).sort()).toEqual([['light.demo_a', 'on'], ['sensor.demo_b', '21.5']]);
    // A change to a wanted entity is one small update; a change to an unwanted one sends nothing.
    messages.length = 0;
    sockets[0].receive({ id: 1, type: 'event', event: { c: { 'light.demo_a': { '+': { s: 'off' } }, 'light.demo_unwanted': { '+': { s: 'off' } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'update', removed: [] });
    expect(messages[0].type === 'update' && messages[0].states.map(state => [state.entityId, state.state, state.brightness])).toEqual([['light.demo_a', 'off', 120]]);
    stop();
  });

  it('batches changes inside one window and sends nothing for a state that did not change', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    openLiveSession(hub, () => new Set(['light.demo_a']), message => messages.push(message));
    connect(sockets[0], { 'light.demo_a': entry('on') });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    sockets[0].receive({ id: 1, type: 'event', event: { c: { 'light.demo_a': { '+': { s: 'off' } } } } });
    sockets[0].receive({ id: 1, type: 'event', event: { c: { 'light.demo_a': { '+': { s: 'on' } } } } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([]);
  });

  it('never sends the token, the URL or a state that carries the token', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    openLiveSession(hub, () => new Set(['light.demo_a', 'sensor.demo_leak']), message => messages.push(message), { credentials: [TOKEN] });
    connect(sockets[0], { 'light.demo_a': entry('on', { friendly_name: 'A' }), 'sensor.demo_leak': entry('x', { friendly_name: `Key ${TOKEN}` }) });
    vi.advanceTimersByTime(60);
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    connect(sockets[1], { 'light.demo_a': entry('off', { friendly_name: 'A' }), 'sensor.demo_leak': entry('y', { friendly_name: `Key ${TOKEN}` }) });
    vi.advanceTimersByTime(60);
    const text = JSON.stringify(messages);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('ha.invalid');
    expect(text).not.toContain('access_token');
    expect(text).toContain('light.demo_a');
    expect(text).not.toContain('sensor.demo_leak');
  });

  it('keeps the last good states through a drop, reconnects with backoff and sends only what changed', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    openLiveSession(hub, () => new Set(['light.demo_a', 'light.demo_b']), message => messages.push(message));
    connect(sockets[0], { 'light.demo_a': entry('on'), 'light.demo_b': entry('off') });
    vi.advanceTimersByTime(60);
    messages.length = 0;

    sockets[0].drop();
    expect(messages).toEqual([{ type: 'status', connected: false }]);
    expect(hub.connected).toBe(false);
    expect(hub.project('light.demo_a')?.state).toBe('on');           // the last good state is kept, not blanked
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // The second attempt fails too: the delay doubles.
    sockets[1].drop();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    messages.length = 0;
    connect(sockets[2], { 'light.demo_a': entry('on'), 'light.demo_b': entry('on') });
    vi.advanceTimersByTime(60);
    expect(messages[0]).toEqual({ type: 'status', connected: true });
    const updates = messages.filter(message => message.type === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].type === 'update' && updates[0].states.map(state => state.entityId)).toEqual(['light.demo_b']);
    // The delay is back to its first value after a good connection.
    sockets[2].drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(4);
  });

  it('retries slowly when the token is refused and never gives states it does not have', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    openLiveSession(hub, () => new Set(['light.demo_a']), message => messages.push(message));
    sockets[0].receive({ type: 'auth_required' });
    sockets[0].receive({ type: 'auth_invalid' });
    vi.advanceTimersByTime(7999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(messages.some(message => message.type === 'snapshot')).toBe(false);
  });

  it('sends an entity that becomes wanted after the stream opened', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    let wanted: ReadonlySet<string> = new Set(['light.demo_a']);
    openLiveSession(hub, () => wanted, message => messages.push(message), { refreshMs: 500 });
    connect(sockets[0], { 'light.demo_a': entry('on'), 'light.demo_b': entry('off') });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    wanted = new Set(['light.demo_a', 'light.demo_b']);
    vi.advanceTimersByTime(600);
    expect(messages).toHaveLength(1);
    expect(messages[0].type === 'update' && messages[0].states.map(state => state.entityId)).toEqual(['light.demo_b']);
  });

  it('reports an entity Home Assistant removes', () => {
    const { hub, sockets } = setup();
    const messages: LiveMessage[] = [];
    openLiveSession(hub, () => new Set(['light.demo_a']), message => messages.push(message));
    connect(sockets[0], { 'light.demo_a': entry('on') });
    vi.advanceTimersByTime(60);
    messages.length = 0;
    sockets[0].receive({ id: 1, type: 'event', event: { r: ['light.demo_a'] } });
    vi.advanceTimersByTime(60);
    expect(messages).toEqual([{ type: 'update', states: [], removed: ['light.demo_a'] }]);
  });

  it('closes the socket after the last page leaves and opens again for the next', () => {
    const { hub, sockets } = setup({ idleCloseMs: 5000 });
    const stop = openLiveSession(hub, () => new Set(), () => undefined);
    connect(sockets[0], { 'light.demo_a': entry('on') });
    stop();
    vi.advanceTimersByTime(4999);
    expect(sockets[0].closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sockets[0].closed).toBe(true);
    expect(hub.project('light.demo_a')?.state).toBe('on');
    openLiveSession(hub, () => new Set(), () => undefined);
    expect(sockets).toHaveLength(2);
  });

  it('closes a socket that goes silent', () => {
    const { hub, sockets } = setup();
    openLiveSession(hub, () => new Set(), () => undefined);
    connect(sockets[0], { 'light.demo_a': entry('on') });
    vi.advanceTimersByTime(25_000);
    expect(sockets[0].sent.some(message => message.type === 'ping')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets[0].closed).toBe(true);
    expect(hub.connected).toBe(false);
  });
});

describe('what a page asks for', () => {
  it('reads entity ids from a document and recomputes only when an input changes', () => {
    expect([...documentEntityIds({ a: ['light.demo_x', 'icon.name.deep', { b: 'sensor.demo_y' }], c: 'Not an id.', d: 'sh.state-style@1' })].sort()).toEqual(['light.demo_x', 'sensor.demo_y']);
    let revision = 1, document: unknown = { a: 'light.demo_x' };
    const refs = new Set(['sensor.demo_house']);
    const wanted = wantedEntities(() => refs, () => ({ revision, document }));
    const first = wanted();
    expect([...first].sort()).toEqual(['light.demo_x', 'sensor.demo_house']);
    expect(wanted()).toBe(first);
    revision = 2; document = { a: 'light.demo_y' };
    expect([...wanted()].sort()).toEqual(['light.demo_y', 'sensor.demo_house']);
  });
});
