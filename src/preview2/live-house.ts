import type { NativeState } from '../shared/native-state';
import type { Viewer } from './evaluate';
import type { House } from './projections';

/** The key a reader holds when it depends on whether the first house has arrived. */
export const READY_KEY = '\u0000ready';
/** The key a reader holds when it depends on the signed-in person. */
export const VIEWER_KEY = '\u0000viewer';
export const TIME_ZONE_KEY = '\u0000time-zone';
/** The key a reader holds when it looked at every entity (a scan, a size or an iteration). */
export const ALL_KEY = '\u0000all';

const browserTimeZones = new Map<string, string | undefined>();
/** The browser's time-zone database may lag behind the server's. */
export function browserTimeZone(timeZone?: string): string | undefined {
  if (!timeZone) return undefined;
  if (!browserTimeZones.has(timeZone)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
      browserTimeZones.set(timeZone, timeZone);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      browserTimeZones.set(timeZone, undefined);
    }
  }
  return browserTimeZones.get(timeZone);
}

/** A listener hears changed entity ids, readiness, viewer and time-zone keys in one commit. */
export type LiveListener = (keys: readonly string[]) => void;

/** Fields the stream does not carry; they come from the slower snapshot read and survive a stream update. */
const SNAPSHOT_ONLY = ['todoList', 'dailyForecast', 'hourlyForecast'] as const;

/**
 * The preview's house as a store of per-entity boxes. A live change replaces one entity's box and tells only the readers that
 * read that entity, so one light turning on draws one tile again, not the page. Two feeds write it:
 *
 * - the slow snapshot (`/api/native-home`, every few seconds), which also carries the viewer, todo lists and forecasts;
 * - the live stream, which is authoritative for the entities it has sent: a snapshot never overwrites those fields.
 *
 * A feed that brings an unchanged entity changes nothing and notifies nobody. A reconnect keeps every box.
 */
export class LiveHouse {
  /** The current states, mutated in place; read it through {@link house} or a tracked view so readers hear changes. */
  readonly states = new Map<string, NativeState>();
  /** The `House` the projections read. One object for the life of the store. */
  readonly house: House;
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Set<LiveListener>();
  /** Entities the stream has sent; their fields are the stream's. */
  private readonly streamed = new Set<string>();
  private viewerValue?: Viewer;
  private timeZoneValue?: string;
  private isReady = false;
  private global = 0;

  constructor() {
    const store = this;
    this.house = { get states() { return store.isReady ? store.states : undefined; }, get viewer() { return store.viewerValue; }, get timeZone() { return store.timeZoneValue; } };
  }
  /** Whether the first house has arrived. */
  get ready() { return this.isReady; }
  /** The signed-in person, once known. */
  get viewer() { return this.viewerValue; }
  get timeZone() { return this.timeZoneValue; }
  /** A number that rises whenever the key's value changes. {@link ALL_KEY} rises on every change. */
  versionOf(key: string): number { return key === ALL_KEY ? this.global : this.versions.get(key) ?? 0; }
  /** Listens to commits; returns the way to stop. */
  subscribe(listener: LiveListener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Applies snapshot states, viewer and zone. Entities the stream owns keep the stream's fields. */
  applySnapshot(states: readonly NativeState[], viewer?: Viewer, timeZone?: string) {
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const incoming of states) {
      seen.add(incoming.entityId);
      const before = this.states.get(incoming.entityId);
      const next = before && this.streamed.has(incoming.entityId) ? this.withSnapshotFields(before, incoming) : incoming;
      if (this.put(next)) changed.push(incoming.entityId);
    }
    for (const id of [...this.states.keys()]) {
      if (seen.has(id) || this.streamed.has(id)) continue;
      this.states.delete(id); changed.push(id);
    }
    if (JSON.stringify(viewer ?? null) !== JSON.stringify(this.viewerValue ?? null)) { this.viewerValue = viewer; changed.push(VIEWER_KEY); }
    if (timeZone !== this.timeZoneValue) { this.timeZoneValue = timeZone; changed.push(TIME_ZONE_KEY); }
    if (!this.isReady) { this.isReady = true; changed.push(READY_KEY); }
    this.commit(changed);
  }
  /** Applies a stream snapshot or update. Snapshot-only fields stay from the last snapshot read. */
  applyStream(states: readonly NativeState[], removed: readonly string[] = []) {
    const changed: string[] = [];
    for (const incoming of states) {
      this.streamed.add(incoming.entityId);
      const before = this.states.get(incoming.entityId);
      if (this.put(before ? this.withSnapshotFields(incoming, before) : incoming)) changed.push(incoming.entityId);
    }
    for (const id of removed) {
      this.streamed.delete(id);
      if (this.states.delete(id)) changed.push(id);
    }
    this.commit(changed);
  }

  /** `base` with the snapshot-only fields of `source`. */
  private withSnapshotFields(base: NativeState, source: NativeState): NativeState {
    const next: NativeState = { ...base };
    for (const field of SNAPSHOT_ONLY) {
      if (source[field] !== undefined) (next as Record<string, unknown>)[field] = source[field];
      else delete (next as Record<string, unknown>)[field];
    }
    return next;
  }
  /** Stores `next` unless it equals the box already there. */
  private put(next: NativeState): boolean {
    const before = this.states.get(next.entityId);
    if (before && JSON.stringify(before) === JSON.stringify(next)) return false;
    this.states.set(next.entityId, next);
    return true;
  }
  private commit(keys: string[]) {
    if (!keys.length) return;
    for (const key of keys) this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    this.global += 1;
    for (const listener of [...this.listeners]) listener(keys);
  }
}
