import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export interface FakeEntry {
  revision: number; publishedAt: string; publishedBy: string; envelopeSha256: string; capabilities: string[]; envelope: Record<string, unknown>;
}
export interface FakeHaOptions {
  token: string;
  /** Answers `publish` with this `invalid_format` reason. */
  publishReason?: string;
  /** Answers rollback of any revision as unknown. */
  rejectRollback?: boolean;
  /** Answers every command as `unknown_command`. */
  unknownCommand?: boolean;
  /** Answers every command as `unauthorized`. */
  denyCommands?: boolean;
  /** The `config` part answered to `fenton_home/house_config`; the other schema-2 sections are filled with empty objects. */
  houseConfig?: Record<string, unknown>;
  /** Assets the integration already holds. */
  storedAssets?: string[];
  /** What `get_services` answers (domain, then service). Without it the command is unknown. */
  services?: Record<string, Record<string, unknown>>;
  /** What `call_service` answers as its `response`; called with each command, which is also kept in `serviceCalls`. */
  serviceResponse?: (command: Record<string, unknown>) => unknown;
  /** Entities the live stream and `GET /api/states` report, by id. */
  entities?: Record<string, { state: string; attributes?: Record<string, unknown> }>;
  /** Read-only registry replies, including extra metadata to exercise safe projection. */
  registries?: { area: unknown; device: unknown; entity: unknown };
}

/** Minimal Home Assistant: the `fenton_home` UI publication websocket commands, with an ordered call log. */
export async function fakeHomeAssistant(options: FakeHaOptions) {
  const log: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const serviceCalls: Record<string, unknown>[] = [];
  const authorizations: (string | undefined)[] = [];
  const assets = new Map<string, { contentType: string; size: number; body: Buffer }>();
  for (const sha of options.storedAssets ?? []) assets.set(sha, { contentType: 'image/png', size: 1, body: Buffer.alloc(1) });
  const state: { epoch: string; revision: number; current: FakeEntry | null; history: FakeEntry[] } = {
    epoch: 'epoch-1', revision: 0, current: null, history: [],
  };
  const sockets = new Set<Duplex>();
  const entities: Record<string, { state: string; attributes: Record<string, unknown> }> = {};
  for (const [id, value] of Object.entries(options.entities ?? {})) entities[id] = { state: value.state, attributes: value.attributes ?? {} };
  /** Live `subscribe_entities` listeners, one per open subscription. */
  const subscriptions = new Set<(event: unknown) => void>();
  let subscribeCount = 0;
  const entryView = (entry: FakeEntry, withEnvelope: boolean) => {
    const { envelope, ...rest } = entry;
    return withEnvelope ? { ...rest, envelope } : rest;
  };
  const promote = (entry: Omit<FakeEntry, 'revision'>): FakeEntry => {
    state.revision += 1;
    const next = { ...entry, revision: state.revision };
    if (state.current) state.history = [state.current, ...state.history].slice(0, 5);
    state.current = next;
    return next;
  };
  const upstream = http.createServer((req, res) => {
    authorizations.push(req.headers.authorization);
    if (req.method === 'GET' && (req.url === '/api/states' || req.url === '/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== `Bearer ${options.token}`) { res.statusCode = 401; res.end('{}'); return; }
      res.end(JSON.stringify(req.url === '/api/' ? { message: 'API running.' } : Object.entries(entities).map(([entity_id, value]) => ({ entity_id, state: value.state, attributes: value.attributes }))));
      return;
    }
    res.statusCode = 404; res.end();
  });
  upstream.on('upgrade', (req, socket) => {
    authorizations.push(req.headers.authorization);
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    // A client may leave while a reply is on its way; that is not a failure of the fake.
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    const send = (value: unknown) => {
      const body = Buffer.from(JSON.stringify(value));
      const header = Buffer.alloc(body.length < 126 ? 2 : body.length < 65536 ? 4 : 10);
      header[0] = 0x81;
      if (body.length < 126) header[1] = body.length;
      else if (body.length < 65536) { header[1] = 126; header.writeUInt16BE(body.length, 2); }
      else { header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
      socket.write(Buffer.concat([header, body]));
    };
    const fail = (id: unknown, code: string, message: string) => send({ id, type: 'result', success: false, error: { code, message } });
    const handle = (message: Record<string, unknown>) => {
      messages.push(message);
      const id = message.id;
      if (message.type === 'auth') { send({ type: message.access_token === options.token ? 'auth_ok' : 'auth_invalid' }); return; }
      if (message.type === 'subscribe_entities') {
        subscribeCount += 1;
        send({ id, type: 'result', success: true, result: null });
        send({ id, type: 'event', event: { a: Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, { s: value.state, a: value.attributes, c: 'x', lc: 1, lu: 1 }])) } });
        const listener = (event: unknown) => send({ id, type: 'event', event });
        subscriptions.add(listener);
        socket.on('close', () => subscriptions.delete(listener));
        return;
      }
      if (message.type === 'get_services' && options.services) { send({ id, type: 'result', success: true, result: options.services }); return; }
      if (message.type === 'call_service' && options.serviceResponse) {
        serviceCalls.push(message);
        send({ id, type: 'result', success: true, result: { context: { id: 'c' }, response: options.serviceResponse(message) } });
        return;
      }
      if (message.type === 'auth/current_user') { send({ id, type: 'result', success: true, result: { id: 'user-1', name: 'Test', is_owner: true, is_admin: true } }); return; }
      const name = String(message.type).replace('fenton_home/ui_publication/', '');
      log.push(`ws ${name}`);
      if (options.unknownCommand) { fail(id, 'unknown_command', 'Unknown command.'); return; }
      if (options.denyCommands) { fail(id, 'unauthorized', 'Unauthorized'); return; }
      const registry = /^config\/(area|device|entity)_registry\/list$/.exec(String(message.type))?.[1] as 'area' | 'device' | 'entity' | undefined;
      if (registry && options.registries) {
        send({ id, type: 'result', success: true, result: options.registries[registry] });
      } else if (message.type === 'fenton_home/house_config') {
        const sections = Object.fromEntries(['home', 'security', 'climate', 'customLights', 'food', 'chores', 'household', 'media', 'roomDevices', 'sprinklers',
          'vacation', 'vacuums', 'bedroom', 'rooms'].map(key => [key, {}]));
        send({ id, type: 'result', success: true, result: { schema: 2, hash: 'a'.repeat(64), config: { ...sections, ...options.houseConfig } } });
      } else if (name === 'get') {
        send({ id, type: 'result', success: true, result: {
          epoch: state.epoch, current: state.current && entryView(state.current, true),
          history: state.history.map(entry => entryView(entry, false)),
          assets: Object.fromEntries([...assets].map(([sha, { contentType, size }]) => [sha, { contentType, size }])),
        } });
      } else if (name === 'publish') {
        if (options.publishReason) { fail(id, 'invalid_format', options.publishReason); return; }
        const envelope = message.envelope as { capabilities: string[]; document: { assets: { sha256: string }[] } };
        if (envelope.document.assets.some(asset => !assets.has(asset.sha256))) { fail(id, 'invalid_format', 'missing_asset'); return; }
        const canonical = JSON.stringify(envelope);
        const entry = promote({
          publishedAt: '2026-11-14T12:00:00+00:00', publishedBy: 'supervisor-user', capabilities: envelope.capabilities,
          envelopeSha256: createHash('sha256').update(canonical).digest('hex'), envelope: envelope as unknown as Record<string, unknown>,
        });
        send({ id, type: 'result', success: true, result: { epoch: state.epoch, revision: entry.revision, envelopeSha256: entry.envelopeSha256 } });
      } else if (name === 'rollback') {
        const target = state.history.find(entry => entry.revision === message.revision);
        if (!target || options.rejectRollback) { fail(id, 'not_found', 'unknown_revision'); return; }
        const entry = promote({ ...target, publishedAt: '2026-11-14T13:00:00+00:00' });
        send({ id, type: 'result', success: true, result: { epoch: state.epoch, revision: entry.revision, envelopeSha256: entry.envelopeSha256 } });
      }
    };
    let buffered: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 15, masked = Boolean(buffered[1] & 128);
        let length = buffered[1] & 127, offset = 2;
        if (length === 126) { if (buffered.length < 4) return; length = buffered.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (buffered.length < 10) return; length = Number(buffered.readBigUInt64BE(2)); offset = 10; }
        if (buffered.length < offset + (masked ? 4 : 0) + length) return;
        const mask = masked ? buffered.subarray(offset, offset + 4) : undefined;
        offset += masked ? 4 : 0;
        const body = Buffer.from(buffered.subarray(offset, offset + length));
        if (mask) for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
        buffered = buffered.subarray(offset + length);
        if (opcode === 8) { if (!socket.writableEnded) socket.end(Buffer.from([0x88, 0])); return; }
        handle(JSON.parse(body.toString('utf8')) as Record<string, unknown>);
      }
    });
    send({ type: 'auth_required' });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  return {
    url, log, messages, serviceCalls, authorizations, assets, state,
    /** Sets an entity's state (and merges attributes) and pushes the change to every live subscription. */
    setEntity(entityId: string, next: string, attributes: Record<string, unknown> = {}) {
      const before = entities[entityId];
      entities[entityId] = { state: next, attributes: { ...before?.attributes, ...attributes } };
      const event = before
        ? { c: { [entityId]: { '+': { s: next, ...(Object.keys(attributes).length ? { a: attributes } : {}) } } } }
        : { a: { [entityId]: { s: next, a: entities[entityId].attributes, c: 'x', lc: 1, lu: 1 } } };
      for (const listener of subscriptions) listener(event);
    },
    /** Drops every websocket; the server must reconnect. */
    dropSockets() { for (const socket of sockets) socket.destroy(); },
    get subscribeCount() { return subscribeCount; },
    async close() {
      for (const socket of sockets) socket.destroy();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    },
  };
}
