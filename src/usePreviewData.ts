import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from './api';
import type { NativeSnapshot } from './shared/native-preview';
import type { DataSource, Json, Primitive, StudioDocument } from './shared/types';

type PreviewData = {
  key: string;
  results: Record<string, Json>;
  modes: Record<string, string>;
  errors: Record<string, string>;
  queryEpochs: Record<string, symbol>;
};
const emptyData = (key: string): PreviewData => ({ key, results: {}, modes: {}, errors: {}, queryEpochs: {} });
const hasQuery = (source: DataSource) => source.kind === 'endpoint' && source.queryVariable !== undefined;

export function usePreviewData(
  document: StudioDocument | undefined,
  savedSources: DataSource[],
  serverMode: string,
  notify: (message: string, tone: 'error' | 'info') => void,
  variables?: Record<string, Primitive>,
  activeQuerySourceIds: readonly string[] = [],
) {
  const [preference, setPreference] = useState<boolean>();
  const [queryConsent, setQueryConsent] = useState(false);
  const consentDocument = useRef(document?.id);
  const identity = useRef<string | undefined>(undefined);
  const sourcesKey = JSON.stringify(document?.dataSources ?? []);
  const sources = useMemo(() => document?.dataSources ?? [], [sourcesKey]);
  const savedKey = JSON.stringify(savedSources);
  const saved = useMemo(() => new Map(savedSources.map(source => [source.id, JSON.stringify(source)])), [savedKey]);
  const key = JSON.stringify([document?.id, sourcesKey]);
  const queryEntries = sources.filter(hasQuery).map(source => [
    source.id,
    variables && Object.hasOwn(variables, source.queryVariable!) ? variables[source.queryVariable!] : document?.variables[source.queryVariable!],
  ] as const);
  const queriesKey = JSON.stringify(queryEntries);
  const queries = useMemo(() => Object.fromEntries(queryEntries), [queriesKey]);
  const activeQueriesKey = JSON.stringify(activeQuerySourceIds);
  const activeQueries = useMemo(() => new Set(activeQuerySourceIds), [activeQueriesKey]);
  const liveEnabled = preference ?? (serverMode === 'live' && sources.some(source => source.kind === 'native-home' && source.endpoint === 'house-states'));
  const queryLiveEnabled = liveEnabled && queryConsent && consentDocument.current === document?.id;
  const queryEpoch = useMemo(() => Symbol('endpoint query'), [key, queriesKey, activeQueriesKey, queryLiveEnabled]);
  const [data, setData] = useState<PreviewData>(() => emptyData(key));
  const current = useRef({ key, liveEnabled, queries, queryLiveEnabled, activeQueries, queryEpoch });
  current.current = { key, liveEnabled, queries, queryLiveEnabled, activeQueries, queryEpoch };
  const active = useRef(new Map<string, AbortController>());
  const queryTimers = useRef(new Map<string, number>());
  const nativeRequest = useRef<Promise<NativeSnapshot> | undefined>(undefined);
  const failures = useRef(new Map<string, string>());
  const nativeWarnings = useRef('');

  const fetchData = useCallback(async (id: string) => {
    if (!liveEnabled) {
      notify('Enable live preview data to fetch this source.', 'info');
      return;
    }
    const source = sources.find(item => item.id === id);
    if (!source || active.current.has(id)) return;
    const query = hasQuery(source) ? current.current.queries[id] : undefined;
    const requestEpoch = current.current.queryEpoch;
    if (hasQuery(source)) {
      window.clearTimeout(queryTimers.current.get(id));
      queryTimers.current.delete(id);
      if (!current.current.queryLiveEnabled || !current.current.activeQueries.has(id)) {
        notify('Turn on endpoint search in Interact mode first.', 'info');
        return;
      }
      if (typeof query === 'string' && !query.trim()) return;
    }
    if (hasQuery(source) && (typeof query !== 'string' || query.length > 500)) {
      setData(previous => {
        const next = previous.key === key ? previous : emptyData(key);
        const results = { ...next.results };
        results[id] = null;
        return { ...next, results, queryEpochs: { ...next.queryEpochs, [id]: requestEpoch }, modes: { ...next.modes, [id]: 'error' }, errors: { ...next.errors, [id]: 'Search queries must be strings of at most 500 characters.' } };
      });
      return;
    }
    const nativeStates = source.kind === 'native-home' && source.endpoint === 'house-states';
    const nativeProfile = source.kind === 'native-home' && source.endpoint === 'house-profile';
    const targets = nativeStates || nativeProfile ? sources.filter(item =>
      item.kind === 'native-home' && ['house-states', 'house-profile'].includes(item.endpoint ?? '')) : [source];
    if (!nativeStates && !nativeProfile && saved.get(id) !== JSON.stringify(source)) {
      const error = 'Save this data source before fetching its changed configuration.';
      setData(previous => {
        const next = previous.key === key ? previous : emptyData(key);
        return { ...next, results: hasQuery(source) ? { ...next.results, [id]: null } : next.results, queryEpochs: { ...next.queryEpochs, [id]: requestEpoch }, modes: { ...next.modes, [id]: 'unsaved' }, errors: { ...next.errors, [id]: error } };
      });
      return;
    }
    const controller = new AbortController();
    active.current.set(id, controller);
    const stillCurrent = () => !controller.signal.aborted && current.current.liveEnabled && current.current.key === key &&
      (!hasQuery(source) || (current.current.queryLiveEnabled && current.current.activeQueries.has(id) && current.current.queryEpoch === requestEpoch));
    setData(previous => {
      const next = previous.key === key ? previous : emptyData(key);
      const changedQuery = hasQuery(source) && next.queryEpochs[id] !== requestEpoch;
      const results = { ...next.results };
      if (changedQuery) results[id] = null;
      return { ...next, results, errors: changedQuery ? { ...next.errors, [id]: '' } : next.errors, queryEpochs: { ...next.queryEpochs, [id]: requestEpoch }, modes: { ...next.modes, [id]: hasQuery(source) || results[id] === undefined ? 'loading' : next.modes[id] } };
    });
    try {
      // This fixed read does not depend on saving an imported document first.
      let updates: { source: DataSource; data: Json; mode: string; error: string }[];
      let warnings = '';
      if (nativeStates || nativeProfile) {
        const pending = nativeRequest.current ?? request<NativeSnapshot>('/api/native-home', { signal: controller.signal });
        nativeRequest.current = pending;
        try {
          const snapshot = await pending;
          if (!stillCurrent()) return;
          const nextIdentity = JSON.stringify([document?.id, snapshot.currentUser?.id ?? null]);
          if (identity.current !== undefined && identity.current !== nextIdentity) {
            current.current.queryLiveEnabled = false;
            setQueryConsent(false);
          }
          identity.current = nextIdentity;
          warnings = snapshot.warnings?.join(' ') ?? '';
          updates = targets.map(target => {
            const profile = target.endpoint === 'house-profile';
            const error = profile && !snapshot.currentUser ? 'Home Assistant did not provide the authenticated profile.' : '';
            return {
              source: target,
              data: profile ? snapshot.currentUser ? { ...snapshot.currentUser } : null : snapshot.states as Json,
              mode: error ? 'error' : snapshot.mode,
              error,
            };
          });
        } finally {
          if (nativeRequest.current === pending) nativeRequest.current = undefined;
        }
      } else {
        const suffix = typeof query === 'string' ? `?${new URLSearchParams({ q: query })}` : '';
        const result = await request<{ data: Json; mode: 'sample' | 'live' }>(`/api/data/${encodeURIComponent(id)}${suffix}`, { signal: controller.signal });
        updates = [{ source, ...result, error: '' }];
      }
      if (!stillCurrent()) return;
      if (warnings !== nativeWarnings.current) {
        nativeWarnings.current = warnings;
        if (warnings) notify(`Import notes: ${warnings}`, 'info');
      }
      for (const update of updates) {
        if (!update.error) failures.current.delete(update.source.id);
        else {
          if (failures.current.get(update.source.id) !== update.error) notify(`${update.source.name}: ${update.error}`, 'error');
          failures.current.set(update.source.id, update.error);
        }
      }
      setData(previous => {
        const next = previous.key === key ? previous : emptyData(key);
        return {
          ...next,
          results: { ...next.results, ...Object.fromEntries(updates.map(update => [update.source.id, update.data])) },
          modes: { ...next.modes, ...Object.fromEntries(updates.map(update => [update.source.id, update.mode])) },
          errors: { ...next.errors, ...Object.fromEntries(updates.map(update => [update.source.id, update.error])) },
        };
      });
    } catch (reason) {
      if (!stillCurrent()) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      if (nativeStates || nativeProfile) {
        current.current.queryLiveEnabled = false;
        setQueryConsent(false);
      }
      setData(previous => {
        const next = previous.key === key ? previous : emptyData(key);
        return {
          ...next,
          results: { ...next.results, ...Object.fromEntries(targets.filter(target => hasQuery(target) || (target.kind === 'native-home' && target.endpoint === 'house-profile')).map(target => [target.id, null])) },
          modes: { ...next.modes, ...Object.fromEntries(targets.map(target => [target.id, 'error'])) },
          errors: { ...next.errors, ...Object.fromEntries(targets.map(target => [target.id, message])) },
        };
      });
      for (const target of targets) {
        if (failures.current.get(target.id) !== message) notify(`${target.name}: ${message}`, 'error');
        failures.current.set(target.id, message);
      }
    } finally {
      if (active.current.get(id) === controller) active.current.delete(id);
    }
  }, [liveEnabled, sources, saved, key, notify, document?.id]);

  useEffect(() => {
    setQueryConsent(false);
    identity.current = undefined;
  }, [document?.id]);

  useEffect(() => {
    setData(previous => liveEnabled && previous.key === key ? previous : emptyData(key));
    if (!liveEnabled) return;
    for (const source of sources.filter(source => !hasQuery(source))) void fetchData(source.id);
    const timers = sources.filter(source => source.kind !== 'static' && !hasQuery(source)).map(source =>
      window.setInterval(() => { void fetchData(source.id); }, Math.max(5, source.refreshSeconds) * 1000));
    return () => {
      timers.forEach(window.clearInterval);
      for (const controller of active.current.values()) controller.abort();
      active.current.clear();
      nativeRequest.current = undefined;
      failures.current.clear();
    };
  }, [key, liveEnabled, sources, fetchData]);

  useEffect(() => {
    if (!queryLiveEnabled) return;
    const targets = sources.filter(source => hasQuery(source) && activeQueries.has(source.id));
    for (const source of targets) {
      const query = queries[source.id];
      if (typeof query === 'string' && !query.trim()) continue;
      queryTimers.current.set(source.id, window.setTimeout(() => { void fetchData(source.id); }, 300));
    }
    return () => {
      for (const source of targets) {
        window.clearTimeout(queryTimers.current.get(source.id));
        queryTimers.current.delete(source.id);
        active.current.get(source.id)?.abort();
        active.current.delete(source.id);
      }
    };
  }, [queries, key, queryLiveEnabled, sources, fetchData, activeQueries]);

  const visible = useMemo(() => {
    const next = liveEnabled && data.key === key ? data : emptyData(key);
    const results = { ...next.results }, modes = { ...next.modes }, errors = { ...next.errors };
    for (const source of sources.filter(hasQuery)) {
      if (!queryLiveEnabled || !activeQueries.has(source.id)) {
        delete results[source.id]; delete errors[source.id]; modes[source.id] = 'sample';
        continue;
      }
      const query = queries[source.id];
      if (typeof query === 'string' && !query.trim()) {
        results[source.id] = null; delete errors[source.id]; modes[source.id] = 'idle';
        continue;
      }
      if (next.queryEpochs[source.id] === queryEpoch) continue;
      results[source.id] = null;
      delete errors[source.id];
      if (liveEnabled) modes[source.id] = 'loading';
    }
    return { results, modes, errors };
  }, [liveEnabled, data, key, sources, queries, queryLiveEnabled, activeQueries, queryEpoch]);
  return {
    liveEnabled,
    queryLiveEnabled,
    changeLive: (value: boolean) => { if (!value) setQueryConsent(false); setPreference(value); },
    enableQueryReads: () => { consentDocument.current = document?.id; setQueryConsent(true); setPreference(true); },
    dataResults: visible.results,
    dataModes: visible.modes,
    dataErrors: visible.errors,
    fetchData,
  };
}
