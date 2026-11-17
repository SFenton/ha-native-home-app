import { useCallback, useMemo, useState } from 'react';
import { createEnvironment, emptyOverlay, type House, type Overlay } from '../../preview2/projections';
import type { Environment, ReadResult } from '../../shared/composition/evaluator';
import { loading, unavailable, value } from '../../shared/composition/evaluator';
import type { Clock } from '../../shared/composition/pipeline/dates';
import type { CompositionDocument } from '../../shared/composition/schema';

/**
 * Try Values (D8): inputs a person overrides for the page that is open. An override is one entity's state: a value, or "Unavailable" or
 * "Loading". It lives in the workspace, reaches the simulator through the overlay and the result lines through the environment, and
 * is never written to the document or sent to Home Assistant.
 */
export type Tried = { kind: 'value'; value: string } | { kind: 'unavailable' } | { kind: 'loading' };
/** What the editors read and write. */
export interface TryApi {
  /** The overrides by entity id. */
  overrides: ReadonlyMap<string, Tried>;
  set(entityId: string, tried: Tried | undefined): void;
  reset(): void;
  count: number;
}
export const noTries: TryApi = { overrides: new Map(), set() {}, reset() {}, count: 0 };

/** The workspace's Try Values state. */
export function useTryValues(): TryApi {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Tried>>(new Map());
  const set = useCallback((entityId: string, tried: Tried | undefined) => setOverrides(old => {
    const next = new Map(old);
    if (tried) next.set(entityId, tried); else next.delete(entityId);
    return next;
  }), []);
  const reset = useCallback(() => setOverrides(old => old.size ? new Map() : old), []);
  return useMemo(() => ({ overrides, set, reset, count: overrides.size }), [overrides, set, reset]);
}

/** The overlay with the overrides written in as entity states: what the simulator draws. */
export function triedOverlay(overlay: Overlay, tries: TryApi): Overlay {
  if (!tries.count) return overlay;
  const entities = { ...overlay.entities };
  for (const [id, tried] of tries.overrides) entities[id] = { ...entities[id], state: tried.kind === 'value' ? tried.value : tried.kind === 'unavailable' ? 'unavailable' : 'unknown' };
  return { ...overlay, entities };
}
/** The overlay without the overrides, for a change the simulator reports back. */
export function withoutTries(next: Overlay, merged: Overlay, tries: TryApi): Overlay {
  if (!tries.count) return next;
  const entities = { ...next.entities };
  for (const id of tries.overrides.keys()) if (entities[id] === merged.entities[id]) delete entities[id];
  return { ...next, entities };
}

/**
 * An environment over a document (the editor's draft, which may hold sources the saved document lacks), the house and the overrides.
 * "Unavailable" and "Loading" answer the reads of that entity as the evaluator's own `unavailable` and `loading`.
 */
export function environmentFor(document: Pick<CompositionDocument, 'dataSources'>, house: House, overlay: Overlay | undefined, tries: TryApi, clock?: Clock): Environment {
  const base = createEnvironment(document, house, triedOverlay(overlay ?? emptyOverlay, tries), undefined, clock);
  if (!tries.count) return base;
  const entityOf = new Map(document.dataSources.flatMap(source => source.kind === 'ha-entity' && source.entityId.type === 'literal' ? [[source.id, String(source.entityId.value)] as const] : []));
  return {
    ...base,
    read(sourceId, path): ReadResult {
      const tried = tries.overrides.get(entityOf.get(sourceId) ?? '');
      if (tried?.kind === 'unavailable') return unavailable;
      if (tried?.kind === 'loading') return loading;
      if (tried?.kind === 'value' && path.length === 1 && path[0] === 'state') return value(tried.value);
      return base.read(sourceId, path);
    },
    readChanged(sourceId): ReadResult {
      // A tried "Unavailable" or "Loading" is the entity's own, so it has no time either; a tried state does not change when it last changed.
      const tried = tries.overrides.get(entityOf.get(sourceId) ?? '');
      if (tried?.kind === 'unavailable') return unavailable;
      if (tried?.kind === 'loading') return loading;
      return base.readChanged!(sourceId);
    },
    readRaw(sourceId): ReadResult {
      const tried = tries.overrides.get(entityOf.get(sourceId) ?? '');
      // A tried "Unavailable" is the entity's own state to a raw read, which tells it from a source with no entity.
      if (tried?.kind === 'unavailable') return value('unavailable');
      if (tried?.kind === 'loading') return loading;
      if (tried?.kind === 'value') return value(tried.value);
      return base.readRaw!(sourceId);
    },
  };
}
