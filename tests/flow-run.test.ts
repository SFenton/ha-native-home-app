import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOW_RUN_LIMITS, FlowRunner, cutLists, readsOnly } from '../server/flow-run';
import { LiveEntityHub, type HubSocket } from '../server/ha-live';
import { HttpError } from '../server/store';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import type { ServerConfig } from '../server/config';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const TOKEN = 'secret-token-0123456789-abcdefghij';
const SERVICES = {
  todo: { get_items: { response: { optional: false } }, add_item: {} },
  weather: { get_forecasts: { response: { optional: false } } },
  script: { turn_on: {}, refresh: { response: { optional: true } } },
  light: { turn_on: {} },
  conversation: { process: { response: { optional: false } } },
  rest_command: { get_it: { response: { optional: false } } },
};

/** A fake Home Assistant behind the hub's socket: answers the handshake, `get_services` and `call_service`. */
function fakeHub(options: { silent?: boolean; answer?: (command: Record<string, unknown>) => { success: boolean; result?: unknown } } = {}) {
  const calls: Record<string, unknown>[] = [];
  let socketCount = 0;
  const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
  const receive = (value: unknown) => { for (const listener of listeners.message ?? []) listener({ data: JSON.stringify(value) }); };
  const socket: HubSocket = {
    addEventListener: (type, listener) => { (listeners[type] ??= []).push(listener); },
    close: () => {},
    send: data => {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.type === 'auth') { receive({ type: 'auth_ok' }); return; }
      if (message.type === 'subscribe_entities') {
        receive({ id: 1, type: 'result', success: true, result: null });
        receive({ id: 1, type: 'event', event: { a: {
          'sensor.example_temp': { s: '21', a: { unit: 'C', friendly_name: 'Temp' }, c: 1, lc: 1, lu: 1 },
          'todo.example_chores': { s: '2', a: {}, c: 1, lc: 1, lu: 1 },
        } } });
        return;
      }
      calls.push(message);
      if (options.silent && message.type === 'call_service') return;
      const answer = options.answer?.(message) ?? (message.type === 'get_services' ? { success: true, result: SERVICES }
        : message.service === 'get_items' ? { success: true, result: { context: {}, response: { 'todo.example_chores': { items: [
          { uid: 'a', summary: 'Water the plants', status: 'needs_action' }, { uid: 'b', summary: 'Take out the trash', status: 'completed' }] } } } }
        : { success: true, result: { context: {}, response: { rows: [1, 2, 3] } } });
      receive({ id: message.id, type: 'result', ...answer });
    },
  };
  const hub = new LiveEntityHub({ url: 'ws://ha.invalid/api/websocket', token: TOKEN, createSocket: () => { socketCount += 1; queueMicrotask(() => receive({ type: 'auth_required' })); return socket; } });
  return { hub, calls, sockets: () => socketCount };
}

const row = { id: { type: 'item', path: ['uid'] }, title: { type: 'item', path: ['summary'] } };
const flow = (request: unknown, steps: unknown[] = [], output: unknown = { kind: 'rows', max: 20, row }) => ({
  title: 'Chores', parameters: [], request, steps, output, schema: { kind: 'any' },
});
const todoRequest = { type: 'service-response', domain: 'todo', service: 'get_items', target: { entity_id: { type: 'literal', value: 'todo.example_chores' } }, timeoutSeconds: 5, responseShape: { kind: 'any' } };
const pick = [{ id: 's1', op: 'get', path: ['todo.example_chores', 'items'] }];

afterEach(() => { vi.useRealTimers(); });

describe('readsOnly', () => {
  it('marks only services Home Assistant says answer with data and nothing else', () => {
    expect(readsOnly('todo', 'get_items', SERVICES)).toBe('reads');
    expect(readsOnly('todo', 'add_item', SERVICES)).toBe('changes');
    expect(readsOnly('script', 'refresh', SERVICES)).toBe('changes');
    expect(readsOnly('light', 'turn_on', SERVICES)).toBe('changes');
    expect(readsOnly('todo', 'nope', SERVICES)).toBe('unknown');
    expect(readsOnly('todo', 'get_items', null)).toBe('unknown');
  });
  it('refuses a domain that can act even when it answers with data', () => {
    expect(readsOnly('conversation', 'process', SERVICES)).toBe('changes');
    expect(readsOnly('rest_command', 'get_it', SERVICES)).toBe('changes');
  });
});

describe('cutLists', () => {
  it('cuts every list and says so', () => {
    expect(cutLists({ a: [1, 2, 3], b: { c: [4] } }, 2)).toEqual({ value: { a: [1, 2], b: { c: [4] } }, cut: true });
    expect(cutLists([1], 2).cut).toBe(false);
  });
});

describe('FlowRunner', () => {
  const run = (runner: FlowRunner, inputs: unknown, extra: Record<string, unknown> = {}) => runner.run({ inputs, ...extra });
  const failure = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as HttpError & { details: { code: string } }; } throw new Error('expected a refusal'); };

  it('runs a to-do service and gives its rows, on the hub\'s one connection', async () => {
    const { hub, calls, sockets } = fakeHub();
    const answer = await run(new FlowRunner(hub, [TOKEN]), flow(todoRequest, pick));
    expect(answer.source).toBe('live');
    expect(answer.output).toEqual([{ id: 'a', title: 'Water the plants' }, { id: 'b', title: 'Take out the trash' }]);
    expect(answer.items).toBe(2);
    const call = calls.find(item => item.type === 'call_service')!;
    expect(call).toMatchObject({ domain: 'todo', service: 'get_items', return_response: true, target: { entity_id: 'todo.example_chores' } });
    expect(sockets()).toBe(1);
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    hub.stop();
  });

  it('runs a live to-do subscription and a forecast through the read-only services', async () => {
    const { hub, calls } = fakeHub({ answer: command => command.type === 'get_services' ? { success: true, result: SERVICES }
      : { success: true, result: { response: { 'weather.example_home': { forecast: [{ datetime: '2026-11-16T12:00:00', temperature: 60 }] } } } } });
    const forecast = flow({ type: 'ha-subscription', kind: 'weather-forecast', entityId: { type: 'literal', value: 'weather.example_home' }, forecastType: 'daily' },
      [{ id: 'g', op: 'get', path: ['forecast'] }], { kind: 'rows', max: 5, row: { id: { type: 'item', path: ['datetime'] }, title: { type: 'item', path: ['datetime'] } } });
    const answer = await run(new FlowRunner(hub), forecast);
    expect(answer.response).toEqual({ type: 'daily', forecast: [{ datetime: '2026-11-16T12:00:00', temperature: 60 }] });
    expect(calls.find(item => item.type === 'call_service')).toMatchObject({ service: 'get_forecasts', service_data: { type: 'daily' } });
    hub.stop();
  });

  it('reads entities and an attribute from the live state, calling nothing', async () => {
    const { hub, calls } = fakeHub();
    const entities = flow({ type: 'entities', entityIds: [{ type: 'literal', value: 'sensor.example_temp' }, { type: 'literal', value: 'sensor.example_missing' }], attributes: ['unit'] }, [],
      { kind: 'rows', max: 5, row: { id: { type: 'item', path: ['entityId'] }, title: { type: 'item', path: ['state'] }, subtitle: { type: 'item', path: ['unit'] } } });
    const answer = await run(new FlowRunner(hub), entities);
    expect(answer.output).toEqual([{ id: 'sensor.example_temp', title: '21', subtitle: 'C' }, { id: 'sensor.example_missing', title: 'unavailable' }]);
    const attribute = flow({ type: 'entity-attribute', entityId: { type: 'literal', value: 'sensor.example_temp' }, path: ['unit'], responseShape: { kind: 'string' } }, [], { kind: 'scalar' });
    expect((await run(new FlowRunner(hub), attribute)).output).toBe('C');
    const absent = flow({ type: 'entity-attribute', entityId: { type: 'literal', value: 'sensor.example_temp' }, path: ['nope'], responseShape: { kind: 'string' } }, [], { kind: 'scalar' });
    expect((await failure(run(new FlowRunner(hub), absent))).message).toBe('sensor.example_temp has no nope.');
    expect(calls.filter(item => item.type === 'call_service')).toEqual([]);
    hub.stop();
  });

  it('refuses a service that is not read only, without calling it', async () => {
    for (const [domain, service, words] of [['light', 'turn_on', 'light.turn_on can change things'], ['todo', 'add_item', 'todo.add_item can change things'],
      ['script', 'refresh', 'script.refresh can change things'], ['conversation', 'process', 'conversation.process can change things']] as const) {
      const { hub, calls } = fakeHub();
      const error = await failure(run(new FlowRunner(hub), flow({ ...todoRequest, domain, service })));
      expect(error.status).toBe(422);
      expect(error.details.code).toBe('can-change-things');
      expect(error.message).toContain(words);
      expect(calls.filter(item => item.type === 'call_service')).toEqual([]);
      hub.stop();
    }
  });

  it('says so when Home Assistant has no such service or entity', async () => {
    const { hub } = fakeHub();
    expect((await failure(run(new FlowRunner(hub), flow({ ...todoRequest, service: 'nope' })))).message).toBe('Home Assistant has no todo.nope.');
    const missing = { type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.example_other' } };
    expect((await failure(run(new FlowRunner(hub), flow(missing)))).message).toBe('Home Assistant has no todo.example_other.');
    hub.stop();
  });

  it('times out in the flow\'s own words and never returns Home Assistant\'s error text', async () => {
    vi.useFakeTimers();
    const { hub } = fakeHub({ silent: true });
    const pending = failure(run(new FlowRunner(hub), flow(todoRequest, pick)));
    await vi.advanceTimersByTimeAsync(6000);
    const error = await pending;
    expect(error.status).toBe(504);
    expect(error.message).toBe("Home Assistant didn't answer in 5 seconds.");
    hub.stop();
    const refusing = fakeHub({ answer: command => command.type === 'get_services' ? { success: true, result: SERVICES } : { success: false, result: { code: 'x', message: `bad ${TOKEN} at /config/secrets.yaml` } } });
    const refused = await failure(run(new FlowRunner(refusing.hub), flow(todoRequest, pick)));
    expect(refused.status).toBe(502);
    expect(refused.message).not.toContain('secrets');
    expect(refused.message).not.toContain(TOKEN);
    refusing.hub.stop();
  });

  it('says Home Assistant is not connected when there is no hub or it never answers', async () => {
    const none = await failure(run(new FlowRunner(undefined), flow(todoRequest)));
    expect([none.status, none.message]).toEqual([503, "Home Assistant isn't connected."]);
    vi.useFakeTimers();
    const dead = new LiveEntityHub({ url: 'ws://ha.invalid', token: TOKEN, createSocket: () => ({ send() {}, close() {}, addEventListener() {} }) });
    const pending = failure(run(new FlowRunner(dead), flow({ type: 'entities', entityIds: [{ type: 'literal', value: 'sensor.example_temp' }], attributes: [] })));
    await vi.advanceTimersByTimeAsync(FLOW_RUN_LIMITS.connectMs + 100);
    expect((await pending).message).toBe("Home Assistant isn't connected.");
    dead.stop();
  });

  it('cuts long lists, and refuses an answer that carries a credential', async () => {
    const items = Array.from({ length: 500 }, (_, at) => ({ uid: `u${at}`, summary: `Item ${at}`, status: 'needs_action' }));
    const big = fakeHub({ answer: command => command.type === 'get_services' ? { success: true, result: SERVICES } : { success: true, result: { response: { 'todo.example_chores': { items } } } } });
    const answer = await run(new FlowRunner(big.hub), flow(todoRequest, pick, { kind: 'rows', max: 100, row }));
    expect(answer.trimmed).toBe(true);
    expect((answer.response as Record<string, { items: unknown[] }>)['todo.example_chores'].items.length).toBe(FLOW_RUN_LIMITS.listItems);
    expect(answer.items).toBe(100);
    big.hub.stop();
    const leaky = fakeHub({ answer: command => command.type === 'get_services' ? { success: true, result: SERVICES } : { success: true, result: { response: { note: `x ${TOKEN}` } } } });
    expect((await failure(run(new FlowRunner(leaky.hub, [TOKEN]), flow(todoRequest, [], { kind: 'record' })))).status).toBe(502);
    leaky.hub.stop();
  });

  it('limits concurrency', async () => {
    const { hub } = fakeHub({ silent: true });
    const runner = new FlowRunner(hub);
    vi.useFakeTimers();
    const started = Array.from({ length: FLOW_RUN_LIMITS.concurrent }, () => failure(run(runner, flow(todoRequest, pick))));
    const extra = await failure(run(runner, flow(todoRequest, pick)));
    expect(extra.status).toBe(429);
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all(started);
    hub.stop();
  });

  it('says a flow that is not finished cannot run', async () => {
    const error = await failure(new FlowRunner(undefined).run({ inputs: { title: 'x' } }));
    expect([error.status, error.message]).toEqual([422, "This flow isn't finished, so it can't run yet."]);
  });

  it('runs a flow with no request without Home Assistant', async () => {
    const answer = await run(new FlowRunner(undefined), flow({ type: 'none', value: { type: 'literal', value: 7 } }, [], { kind: 'scalar' }));
    expect(answer.output).toBe(7);
  });
});

describe('POST /native/api/ha/flow-run', () => {
  it('needs a signed-in session, and answers in the flow\'s words without Home Assistant', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'flow-run-'));
    const store = await StudioStore.open(directory);
    const config: ServerConfig = { production: false, port: 0, host: '127.0.0.1', dataDir: directory, authToken: 'synthetic-flow-run-token-0000' };
    const { app, errorHandler, close } = createApp(store, config);
    app.use(errorHandler);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (headers: Record<string, string>) => fetch(`${base}/native/api/ha/flow-run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ inputs: flow(todoRequest, pick) }) });
      expect((await post({})).status).toBe(401);
      const signedIn = await post({ Authorization: 'Bearer synthetic-flow-run-token-0000' });
      expect(signedIn.status).toBe(503);
      expect(await signedIn.json()).toEqual({ error: "Home Assistant isn't connected.", code: 'not-connected' });
    } finally { close(); server.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
