import { projectNativeAttributes, projectNativeState } from './native-home';
import { expandDocument, ownedSources } from '../src/shared/composition/components';
import { publishedDocument } from '../src/shared/composition/logic-library';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { NativeState } from '../src/shared/native-state';

/**
 * The live entity stream. One Home Assistant websocket per server subscribes to `subscribe_entities`, keeps the latest state of
 * every entity and tells each connected Studio page what changed. The token stays in this module's socket: a page receives only
 * projected entity states (native fields plus safe draft-requested attributes), never an upstream URL, header or credential.
 *
 * Three parts: {@link EntityCache} (the compressed event format applied to full states), {@link LiveEntityHub} (the socket, with
 * reconnect and backoff, keeping the last good states while it is down) and {@link openLiveSession} (one page's view: a
 * snapshot, then batched updates of the entities it asked for).
 */

/** One cached entity, as Home Assistant reports it. A new object replaces it on every change. */
export interface RawEntity { state: string; attributes: Readonly<Record<string, unknown>>; /** `lc` of the stream: epoch seconds of the last state change. */ lastChanged?: number }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameAttributes = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>) => {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => key in right && JSON.stringify(left[key]) === JSON.stringify(right[key]));
};

/** What one event changed. */
export interface CacheChange { changed: string[]; removed: string[] }

/**
 * The latest state of every entity, rebuilt from `subscribe_entities` events: the first event carries every entity (`a`), later
 * ones carry additions (`a`), diffs (`c`, with `+` for new values and `-` for removed attribute names) and removals (`r`).
 */
export class EntityCache {
  private readonly entities = new Map<string, RawEntity>();
  get size() { return this.entities.size; }
  get(entityId: string): RawEntity | undefined { return this.entities.get(entityId); }
  ids(): IterableIterator<string> { return this.entities.keys(); }
  /**
   * Applies one event. With `replace` the event is a full picture (the first one after a subscribe): entities it does not name
   * are removed. Returns only the ids whose state or attributes really changed.
   */
  apply(event: unknown, replace = false): CacheChange {
    const changed: string[] = [], removed: string[] = [];
    if (!isRecord(event)) return { changed, removed };
    const seen = new Set<string>();
    if (isRecord(event.a)) {
      for (const [id, value] of Object.entries(event.a)) {
        if (!isRecord(value)) continue;
        seen.add(id);
        const next: RawEntity = { state: typeof value.s === 'string' ? value.s : String(value.s ?? 'unknown'), attributes: isRecord(value.a) ? { ...value.a } : {}, ...(typeof value.lc === 'number' ? { lastChanged: value.lc } : {}) };
        const before = this.entities.get(id);
        this.entities.set(id, next);
        if (!before || before.state !== next.state || !sameAttributes(before.attributes, next.attributes)) changed.push(id);
      }
    }
    if (isRecord(event.c)) {
      for (const [id, diff] of Object.entries(event.c)) {
        const before = this.entities.get(id);
        if (!before || !isRecord(diff)) continue;
        let state = before.state, lastChanged = before.lastChanged;
        const attributes: Record<string, unknown> = { ...before.attributes };
        const add = diff['+'], drop = diff['-'];
        if (isRecord(add)) {
          if (typeof add.s === 'string') state = add.s;
          if (typeof add.lc === 'number') lastChanged = add.lc;
          if (isRecord(add.a)) Object.assign(attributes, add.a);
        }
        if (isRecord(drop) && Array.isArray(drop.a)) for (const name of drop.a) if (typeof name === 'string') delete attributes[name];
        if (state === before.state && sameAttributes(before.attributes, attributes)) continue;
        this.entities.set(id, { state, attributes, ...(lastChanged !== undefined ? { lastChanged } : {}) });
        changed.push(id);
      }
    }
    if (Array.isArray(event.r)) {
      for (const id of event.r) if (typeof id === 'string' && this.entities.delete(id)) removed.push(id);
    }
    if (replace) {
      for (const id of [...this.entities.keys()]) if (!seen.has(id)) { this.entities.delete(id); removed.push(id); }
    }
    return { changed, removed };
  }
}

/** The part of a `WebSocket` the hub uses, so a test can supply a fake. */
export interface HubSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
}

/** What the hub tells its listeners. */
export type HubEvent =
  | { type: 'changed'; changed: string[]; removed: string[] }
  | { type: 'status'; connected: boolean };

/** Hub tuning; the defaults are right for production and tests shorten them. */
export interface LiveHubOptions {
  /** The Home Assistant websocket URL. */
  url: string;
  /** The access token. Held here and never exposed. */
  token: string;
  createSocket?: (url: string) => HubSocket;
  /** First retry delay and its ceiling. A successful subscribe resets the delay. */
  backoffMs?: { initial: number; max: number };
  /** How long the socket stays open after the last page leaves. */
  idleCloseMs?: number;
  /** Ping every this often; no message in `silenceMs` closes the socket and reconnects. */
  pingMs?: number;
  silenceMs?: number;
}

const MAX_EVENT_BYTES = 32 * 1024 * 1024;

/** Why a command over the hub's connection failed. Home Assistant's own error text is never carried. */
export class HubRequestError extends Error {
  constructor(readonly reason: 'offline' | 'timeout' | 'refused' | 'dropped') { super(reason); }
}

/**
 * Holds one authenticated, subscribed websocket to Home Assistant while any page listens. A drop keeps every cached state and
 * reconnects with exponential backoff; the next full picture is diffed against the cache so listeners hear only real changes.
 */
export class LiveEntityHub {
  readonly cache = new EntityCache();
  private readonly options: Required<Omit<LiveHubOptions, 'url' | 'token' | 'createSocket'>>;
  private readonly createSocket: (url: string) => HubSocket;
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private socket?: HubSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private delay: number;
  private lastMessage = 0;
  private stopped = true;
  private online = false;
  private firstEvent = true;
  /** Projections by cached object, so several pages share one projection of one state. */
  private readonly projections = new WeakMap<RawEntity, NativeState | null>();

  constructor(private readonly config: LiveHubOptions) {
    this.createSocket = config.createSocket ?? (url => new WebSocket(url) as unknown as HubSocket);
    this.options = { backoffMs: config.backoffMs ?? { initial: 1000, max: 30_000 }, idleCloseMs: config.idleCloseMs ?? 60_000, pingMs: config.pingMs ?? 25_000, silenceMs: config.silenceMs ?? 70_000 };
    this.delay = this.options.backoffMs.initial;
  }
  /** Whether the hub has an authenticated, subscribed socket now. */
  get connected() { return this.online; }
  /** Whether the first full picture has arrived (now or before a drop). */
  get hasStates() { return this.cache.size > 0; }

  /** Listens to changes; the first listener starts the connection, the last one's departure closes it after the idle time. */
  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    clearTimeout(this.idle); this.idle = undefined;
    if (this.stopped) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.stopped) this.idle = setTimeout(() => this.stop(), this.options.idleCloseMs);
    };
  }
  /** The entity as the app reads it, or undefined when Home Assistant does not have it or its state is unusable. */
  project(entityId: string, wantedAttributes?: ReadonlySet<string>): NativeState | undefined {
    const raw = this.cache.get(entityId);
    if (!raw) return undefined;
    let found = this.projections.get(raw);
    if (found === undefined) {
      try { found = projectNativeState({ entity_id: entityId, state: raw.state, attributes: raw.attributes, last_changed: raw.lastChanged }); }
      catch { found = null; }
      this.projections.set(raw, found);
    }
    if (!found) return undefined;
    const attributes = wantedAttributes && projectNativeAttributes(raw.attributes, wantedAttributes);
    return attributes ? { ...found, attributes } : found;
  }
  /** Closes the socket and cancels every timer. Cached states stay. */
  stop() {
    this.stopped = true;
    clearTimeout(this.retry); clearTimeout(this.idle); clearInterval(this.ping);
    this.retry = this.idle = this.ping = undefined;
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(); } catch { /* already closed */ }
    this.setOnline(false);
  }

  private start() {
    this.stopped = false;
    this.connect();
    this.ping = setInterval(() => {
      if (!this.socket) return;
      if (Date.now() - this.lastMessage > this.options.silenceMs) { this.dropped(this.socket); return; }
      if (this.online) { try { this.socket.send(JSON.stringify({ id: this.nextId(), type: 'ping' })); } catch { this.dropped(this.socket); } }
    }, this.options.pingMs);
    this.ping.unref?.();
  }
  private idCounter = 1;
  private readonly requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: HubRequestError) => void }>();
  /**
   * Sends one command on the hub's own authenticated connection and resolves with its `result`. No second socket and no subscription: while the
   * command waits, the hub counts as listened to, so it connects if it is idle. Rejects with {@link HubRequestError}: `offline` (not connected in
   * time), `timeout`, `refused` (Home Assistant said no; its text is dropped) or `dropped` (the connection fell while waiting).
   */
  request(command: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false, id = 0;
      const release = this.subscribe(event => { if (event.type === 'status' && event.connected) send(); });
      const done = (act: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.requests.delete(id); release(); act();
      };
      const timer = setTimeout(() => done(() => reject(new HubRequestError(this.online ? 'timeout' : 'offline'))), timeoutMs);
      const send = () => {
        if (settled || id || !this.online || !this.socket) return;
        id = this.nextId();
        this.requests.set(id, { resolve: value => done(() => resolve(value)), reject: error => done(() => reject(error)) });
        try { this.socket.send(JSON.stringify({ ...command, id })); } catch { done(() => reject(new HubRequestError('dropped'))); }
      };
      send();
    });
  }
  private nextId() { return ++this.idCounter; }
  private emit(event: HubEvent) { for (const listener of [...this.listeners]) listener(event); }
  private setOnline(next: boolean) {
    if (this.online === next) return;
    this.online = next;
    this.emit({ type: 'status', connected: next });
  }
  private connect() {
    if (this.stopped) return;
    let socket: HubSocket;
    try { socket = this.createSocket(this.config.url); }
    catch { this.scheduleRetry(); return; }
    this.socket = socket;
    this.lastMessage = Date.now();
    this.firstEvent = true;
    let phase: 'challenge' | 'authentication' | 'subscribing' | 'ready' = 'challenge';
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      this.lastMessage = Date.now();
      if (typeof event.data !== 'string' || event.data.length > MAX_EVENT_BYTES) { this.dropped(socket); return; }
      let payload: unknown;
      try { payload = JSON.parse(event.data); } catch { this.dropped(socket); return; }
      if (!isRecord(payload)) return;
      if (payload.type === 'result' && typeof payload.id === 'number' && payload.id > 1 && this.requests.has(payload.id)) {
        const waiting = this.requests.get(payload.id)!;
        if (payload.success === true) waiting.resolve(payload.result); else waiting.reject(new HubRequestError('refused'));
        return;
      }
      if (phase === 'challenge' && payload.type === 'auth_required') {
        phase = 'authentication';
        try { socket.send(JSON.stringify({ type: 'auth', access_token: this.config.token })); } catch { this.dropped(socket); }
      } else if (phase === 'authentication' && payload.type === 'auth_ok') {
        phase = 'subscribing';
        try { socket.send(JSON.stringify({ id: 1, type: 'subscribe_entities' })); } catch { this.dropped(socket); }
      } else if (payload.type === 'auth_invalid') {
        // A wrong token will not fix itself; retry slowly in case it is replaced.
        this.delay = this.options.backoffMs.max;
        this.dropped(socket);
      } else if (payload.type === 'result' && payload.id === 1) {
        if (payload.success === false) this.dropped(socket);
      } else if (payload.type === 'event' && payload.id === 1) {
        phase = 'ready';
        const replace = this.firstEvent;
        this.firstEvent = false;
        const { changed, removed } = this.cache.apply(payload.event, replace);
        this.delay = this.options.backoffMs.initial;
        const wasOnline = this.online;
        this.online = true;
        if (!wasOnline) this.emit({ type: 'status', connected: true });
        if (changed.length || removed.length) this.emit({ type: 'changed', changed, removed });
      }
    });
    socket.addEventListener('close', () => this.dropped(socket));
    socket.addEventListener('error', () => this.dropped(socket));
  }
  private dropped(socket: HubSocket) {
    if (this.socket !== socket) return;
    this.socket = undefined;
    try { socket.close(); } catch { /* already closed */ }
    for (const waiting of [...this.requests.values()]) waiting.reject(new HubRequestError('dropped'));
    this.setOnline(false);
    this.scheduleRetry();
  }
  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    const wait = this.delay;
    this.delay = Math.min(this.options.backoffMs.max, this.delay * 2);
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, wait);
    this.retry.unref?.();
  }
}

// MARK: One page's view

/** What a page receives. */
export type LiveMessage =
  | { type: 'snapshot'; connected: boolean; states: NativeState[] }
  | { type: 'update'; states: NativeState[]; removed: string[] }
  | { type: 'status'; connected: boolean };

export type NativeAttributeRequests = ReadonlyMap<string, ReadonlySet<string>>;

/** Per-page tuning. */
export interface LiveSessionOptions {
  /** Server credentials: a state containing any of them is dropped, never sent. */
  credentials?: string[];
  /** Changes within this window go out as one update. */
  batchMs?: number;
  /** Draft-named attributes, stable until the draft revision changes. */
  attributes?: () => NativeAttributeRequests;
  /** How often the wanted entities and attributes are checked for changes. */
  refreshMs?: number;
}

/**
 * One page's stream. `wanted` names the entities the page draws (it may change as the draft is edited; return the same set while
 * it has not). The page gets a snapshot of those once Home Assistant has answered, then an update for each batch of real changes
 * and when the wanted entities or attributes change. A dropped hub connection sends `status` and changes no state. Returns the closer.
 */
export function openLiveSession(hub: LiveEntityHub, wanted: () => ReadonlySet<string>, send: (message: LiveMessage) => void, options: LiveSessionOptions = {}): () => void {
  const { credentials = [], attributes, batchMs = 50, refreshMs = 1000 } = options;
  /** What the page holds, as JSON: an entity is sent again only when its projection differs. */
  const held = new Map<string, string>();
  const pending = new Set<string>();
  const removedPending = new Set<string>();
  let snapshotSent = false, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  let lastWanted: ReadonlySet<string> | undefined;
  let lastAttributes: NativeAttributeRequests | undefined;

  const read = (id: string, requested: NativeAttributeRequests | undefined): { state: NativeState; json: string } | undefined => {
    const state = hub.project(id, requested?.get(id));
    if (!state) return undefined;
    const json = JSON.stringify(state);
    if (credentials.some(credential => credential && json.includes(credential))) return undefined;
    return { state, json };
  };
  const flush = () => {
    timer = undefined;
    if (closed) return;
    const now = wanted();
    const requested = attributes?.();
    const wantedChanged = now !== lastWanted, attributesChanged = requested !== lastAttributes;
    lastWanted = now; lastAttributes = requested;
    if (!snapshotSent) {
      if (!hub.hasStates) return;
      const states: NativeState[] = [];
      for (const id of now) { const found = read(id, requested); if (found) { held.set(id, found.json); states.push(found.state); } }
      snapshotSent = true; pending.clear(); removedPending.clear();
      send({ type: 'snapshot', connected: hub.connected, states });
      return;
    }
    const ids = attributesChanged ? new Set([...pending, ...now])
      : wantedChanged ? new Set([...pending, ...now].filter(id => pending.has(id) || !held.has(id))) : pending;
    const states: NativeState[] = [], removed: string[] = [];
    for (const id of ids) {
      if (!now.has(id)) continue;
      const found = read(id, requested);
      if (!found) { if (held.delete(id)) removed.push(id); continue; }
      if (held.get(id) === found.json) continue;
      held.set(id, found.json); states.push(found.state);
    }
    if (wantedChanged) for (const id of held.keys()) if (!now.has(id)) { held.delete(id); removed.push(id); }
    for (const id of removedPending) if (held.delete(id)) removed.push(id);
    pending.clear(); removedPending.clear();
    if (states.length || removed.length) send({ type: 'update', states, removed });
  };
  const schedule = () => { if (!timer && !closed) timer = setTimeout(flush, batchMs); };
  const unsubscribe = hub.subscribe(event => {
    if (event.type === 'status') { send({ type: 'status', connected: event.connected }); return; }
    for (const id of event.changed) pending.add(id);
    for (const id of event.removed) { pending.delete(id); removedPending.add(id); }
    schedule();
  });
  const refresh = setInterval(() => { if (!snapshotSent || wanted() !== lastWanted || attributes?.() !== lastAttributes) schedule(); }, refreshMs);
  refresh.unref?.();
  send({ type: 'status', connected: hub.connected });
  if (hub.hasStates) schedule();
  return () => { closed = true; clearTimeout(timer); clearInterval(refresh); unsubscribe(); };
}

// MARK: What a page asks for

const entityText = /"([a-z][a-z0-9_]*\.[a-z0-9_]{1,120})"/g;
/** Every string in a document that reads like an entity id (`domain.object_id`), at most 2000. Strings that are not entities cost nothing: Home Assistant has no state for them. */
export function documentEntityIds(document: unknown): Set<string> {
  const found = new Set<string>();
  for (const match of JSON.stringify(document ?? null).matchAll(entityText)) {
    found.add(match[1]);
    if (found.size >= 2000) break;
  }
  return found;
}

/**
 * The wanted set of one page: the house configuration's entities and the draft's, recomputed only when either changes (so the
 * session sees the same set object until then).
 */
export function wantedEntities(references: () => ReadonlySet<string>, draft: () => { revision: number; document: unknown }): () => ReadonlySet<string> {
  let key: { references: ReadonlySet<string>; revision: number } | undefined, value: ReadonlySet<string> = new Set();
  return () => {
    const refs = references(), current = draft();
    if (key && key.references === refs && key.revision === current.revision) return value;
    key = { references: refs, revision: current.revision };
    value = new Set([...refs, ...documentEntityIds(current.document)]);
    return value;
  };
}

/** Attribute reads on literal `ha-entity` sources, including worked-out logic and component instances. Dynamic entity ids are not resolved here. */
export function documentAttributeReads(document: CompositionDocument): NativeAttributeRequests {
  const wanted = new Map<string, Set<string>>();
  const entities = (sources: CompositionDocument['dataSources'], inherited: ReadonlyMap<string, string> = new Map()) => {
    const ids = new Map(inherited);
    for (const source of sources) {
      ids.delete(source.id);
      if (source.kind !== 'ha-entity') continue;
      if (source.entityId.type === 'literal' && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(source.entityId.value)) ids.set(source.id, source.entityId.value);
    }
    return ids;
  };
  const visit = (value: unknown, ids: ReadonlyMap<string, string>): void => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, ids)); return; }
    if (!isRecord(value) || value.type === 'literal') return;
    const from = value.type === 'state' || value.type === 'numeric' ? value
      : ['read', 'list-count', 'list-includes'].includes(String(value.type)) && isRecord(value.from) && value.from.type === 'source' ? value.from : undefined;
    if (from && typeof from.sourceId === 'string' && Array.isArray(from.path) && from.path[0] === 'attributes' && typeof from.path[1] === 'string') {
      const id = ids.get(from.sourceId);
      if (id) {
        const names = wanted.get(id) ?? new Set<string>();
        names.add(from.path[1]); wanted.set(id, names);
      }
    }
    for (const [key, nested] of Object.entries(value)) if (!['componentLibrary', 'studioCanvas', 'logicUseBindings'].includes(key)) visit(nested, ids);
  };
  const collect = (view: CompositionDocument) => {
    const ids = entities(view.dataSources);
    visit(view, ids);
    for (const entry of view.componentLibrary ?? []) visit(entry, entities(ownedSources(entry), ids));
  };
  collect(document);
  collect(expandDocument(publishedDocument(document)));
  return wanted;
}

/** Like `wantedEntities`, keep the map's identity until the draft revision changes, even if the entity ids stayed the same. */
export function wantedAttributes(draft: () => { revision: number; document: CompositionDocument }): () => NativeAttributeRequests {
  let revision: number | undefined, value: NativeAttributeRequests = new Map();
  return () => {
    const current = draft();
    if (revision !== current.revision) {
      value = documentAttributeReads(current.document);
      revision = current.revision;
    }
    return value;
  };
}

/**
 * Whether the draft may have this entity's picture served: its id is named in the draft or the house configuration, or it is a vacuum's map camera
 * (`camera.<map id>_map_data`) for a `mapId` the draft's vacuum sources carry (the map is drawn from a name, not from the camera's id).
 */
export function pictureWanted(entityId: string, wanted: ReadonlySet<string>, document: unknown): boolean {
  if (wanted.has(entityId)) return true;
  const match = /^camera\.([a-z0-9_]+)_map_data$/.exec(entityId);
  return Boolean(match && JSON.stringify(document ?? null).includes(`"${match[1]}"`));
}
