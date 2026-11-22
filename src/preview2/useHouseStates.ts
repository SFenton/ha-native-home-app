import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api';
import type { CompositionDocument, CallService } from '../shared/composition/schema';
import type { LocalValue } from '../shared/composition/shell';
import type { NativeSnapshot } from '../shared/native-state';
import { createEnvironment, emptyOverlay, applyCall, applyLocal, houseFrom, resolveCall, type House, type Overlay } from './projections';
import { LiveHouse } from './live-house';
import { connectLiveStates, type OpenStream } from './live-stream';
import type { Environment } from './evaluate';

/** What the hook returns. */
export interface HouseStates {
  house: House;
  overlay: Overlay;
  /** `loading` until the first read, then `ready`; `error` keeps the last good house. */
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** The evaluation environment over the document's sources, the house and the overlay. */
  environment: Environment;
  /** Simulates a `call-service` action in the overlay. Returns whether the preview simulated anything. */
  simulateCall(call: CallService, control?: Parameters<typeof createEnvironment>[3]): boolean;
  /** Simulates a `set-local` action. */
  setLocal(stateId: string, value: LocalValue): void;
  /** Replaces the overlay with one the preview computed (a simulated tap in Use). */
  setOverlay(next: Overlay): void;
  /** Drops every simulated change. */
  resetOverlay(): void;
  /** Reads the house again now. */
  refresh(): void;
  /**
   * The house as per-entity boxes, fed by the snapshot read and, once Home Assistant is connected, by the live stream. The preview
   * draws from this; `house` above is the snapshot only, for the pickers.
   */
  live: LiveHouse;
  /** Whether the live stream is open now. Entity changes then arrive within a second and the snapshot read slows. */
  streaming: boolean;
}

/** How often the snapshot is read while the live stream is open: it then carries only what the stream does not (lists, forecasts). */
const STREAMING_REFRESH_SECONDS = 30;

/**
 * The house states for the 2.0 preview: one read of `/api/native-home` and then a poll, plus the live stream once Home Assistant
 * is connected, plus an overlay of simulated changes. A simulated service call writes the overlay and never a device.
 * The overlay survives a poll and a stream update, so a simulated change stays until reset; a reconnect keeps the last good house.
 * Not connected, there is no stream and the preview shows what it showed before.
 */
export function useHouseStates(document: Pick<CompositionDocument, 'dataSources'> | undefined, options: { enabled?: boolean; refreshSeconds?: number; openStream?: OpenStream } = {}): HouseStates {
  const { enabled = true, refreshSeconds = 10, openStream } = options;
  const live = useMemo(() => new LiveHouse(), []);
  const [streaming, setStreaming] = useState(false);
  const streamingNow = useRef(false);
  streamingNow.current = streaming;
  const [house, setHouse] = useState<House>({});
  const [overlay, setOverlay] = useState<Overlay>(emptyOverlay);
  const [status, setStatus] = useState<HouseStates['status']>('loading');
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const latest = useRef({ house, overlay });
  latest.current = { house, overlay };

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const snapshot = await request<NativeSnapshot>('/api/native-home', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const next = houseFrom(snapshot);
        live.applySnapshot(snapshot.states, next.viewer, next.timeZone);
        setHouse(next); setStatus('ready'); setError(undefined);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStatus('error'); setError(cause instanceof Error ? cause.message : 'The house could not be read.');
      }
      if (!controller.signal.aborted) timer = setTimeout(read, Math.max(1, streamingNow.current ? Math.max(refreshSeconds, STREAMING_REFRESH_SECONDS) : refreshSeconds) * 1000);
    };
    void read();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [enabled, refreshSeconds, tick, live]);

  // Once Home Assistant has answered, the live stream keeps every tile current. It stays open through a read that fails: the
  // server holds the last good states and the stream resumes on its own.
  const [connectedOnce, setConnectedOnce] = useState(false);
  useEffect(() => { if (status === 'ready') setConnectedOnce(true); }, [status]);
  useEffect(() => {
    if (!enabled || !connectedOnce) return;
    const close = connectLiveStates({
      onSnapshot: states => live.applyStream(states),
      onUpdate: (states, removed) => live.applyStream(states, removed),
      onOpen: setStreaming,
    }, openStream ? { open: openStream } : {});
    return () => { close(); setStreaming(false); };
  }, [enabled, connectedOnce, live, openStream]);

  const environment = useMemo(() => createEnvironment(document ?? { dataSources: [] }, house, overlay), [document, house, overlay]);
  const simulateCall = useCallback<HouseStates['simulateCall']>((call, control) => {
    const resolved = resolveCall(call, createEnvironment(document ?? { dataSources: [] }, live.house, latest.current.overlay, control));
    if (!resolved) return false;
    const next = applyCall(live.house, latest.current.overlay, resolved);
    if (next === latest.current.overlay) return false;
    latest.current = { ...latest.current, overlay: next };
    setOverlay(next);
    return true;
  }, [document, live]);
  const setLocal = useCallback((stateId: string, value: LocalValue) => setOverlay(current => applyLocal(current, stateId, value)), []);
  const resetOverlay = useCallback(() => setOverlay(emptyOverlay), []);
  const refresh = useCallback(() => setTick(value => value + 1), []);
  return { house, overlay, status, error, environment, simulateCall, setLocal, setOverlay, resetOverlay, refresh, live, streaming };
}
