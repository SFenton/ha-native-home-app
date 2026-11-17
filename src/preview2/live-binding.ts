import { useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { NativeState } from '../shared/native-state';
import { ALL_KEY, READY_KEY, VIEWER_KEY } from './live-house';
import { createEnvironment, type House } from './projections';
import type { RenderContext } from './render-context';

/** A read-only view of the live states that records which entity a render read. */
class TrackedStates implements ReadonlyMap<string, NativeState> {
  constructor(private readonly source: ReadonlyMap<string, NativeState>, private readonly note: (key: string) => void) {}
  get size() { this.note(ALL_KEY); return this.source.size; }
  get(id: string) { this.note(id); return this.source.get(id); }
  has(id: string) { this.note(id); return this.source.has(id); }
  forEach(callback: (value: NativeState, key: string, map: ReadonlyMap<string, NativeState>) => void, thisArg?: unknown) {
    this.note(ALL_KEY); this.source.forEach((value, key) => callback.call(thisArg, value, key, this));
  }
  entries() { this.note(ALL_KEY); return this.source.entries(); }
  keys() { this.note(ALL_KEY); return this.source.keys(); }
  values() { this.note(ALL_KEY); return this.source.values(); }
  [Symbol.iterator]() { this.note(ALL_KEY); return this.source[Symbol.iterator](); }
}

/**
 * What `useRender` returns. Without a live store it is the context itself. With one, the context's `house` and `env` read
 * through a recorder: the component remembers which entities (and which of the viewer and the first read) its render touched,
 * and draws again only when one of those changes. A tile that shows one light is told about that light and nothing else; the
 * page above it, which read no entity, is not told at all.
 *
 * The recorder resets on every render, so a component that stops reading an entity stops hearing about it. A change that lands
 * between a render and its commit is caught by comparing versions in the layout effect.
 */
export function useLiveRender(base: RenderContext): RenderContext {
  const live = base.live;
  /** Key to the version read, for the render in progress. */
  const reads = useRef(new Map<string, number>());
  /** The reads of the last committed render, which decide what wakes this component. */
  const committed = useRef(reads.current);
  const [, wake] = useReducer((count: number) => count + 1, 0);
  if (live) reads.current = new Map();

  const derived = useMemo<RenderContext>(() => {
    if (!live) return base;
    const store = live.store;
    const note = (key: string) => { if (!reads.current.has(key)) reads.current.set(key, store.versionOf(key)); };
    const states = new TrackedStates(store.states, note);
    const house: House = {
      get states() { note(READY_KEY); return store.ready ? states : undefined; },
      get viewer() { note(VIEWER_KEY); return store.viewer; },
    };
    const env = { ...createEnvironment({ dataSources: live.dataSources }, house, base.overlay) };
    if (base.scope) { env.item = base.scope.item; env.index = base.scope.index; }
    Object.defineProperty(env, 'viewer', { enumerable: true, get() { note(VIEWER_KEY); return store.viewer; } });
    return { ...base, house, env };
  }, [base, live]);

  useLayoutEffect(() => {
    if (!live) return;
    return live.store.subscribe(keys => {
      const held = committed.current;
      if (keys.some(key => held.has(key)) || (held.has(ALL_KEY) && keys.length)) wake();
    });
  }, [live]);
  useLayoutEffect(() => {
    committed.current = reads.current;
    if (!live) return;
    for (const [key, version] of reads.current) if (live.store.versionOf(key) !== version) { wake(); return; }
  });
  return derived;
}
