import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../api';
import type { CompositionDocument, CallService } from '../shared/composition/schema';
import type { LocalValue } from '../shared/composition/shell';
import type { NativeSnapshot } from '../shared/native-state';
import { createEnvironment, emptyOverlay, applyCall, applyLocal, houseFrom, resolveCall, type House, type Overlay } from './projections';
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
}

/**
 * The house states for the 2.0 preview: one read of `/api/native-home` and then a poll, plus an overlay of simulated
 * changes. A simulated service call writes the overlay and never a device. The 1.0 `usePreviewData` is untouched.
 * The overlay survives a poll, so a simulated change stays until reset; a reconnect keeps the last good house.
 */
export function useHouseStates(document: Pick<CompositionDocument, 'dataSources'> | undefined, options: { enabled?: boolean; refreshSeconds?: number } = {}): HouseStates {
  const { enabled = true, refreshSeconds = 10 } = options;
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
        setHouse(houseFrom(snapshot)); setStatus('ready'); setError(undefined);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStatus('error'); setError(cause instanceof Error ? cause.message : 'The house could not be read.');
      }
      if (!controller.signal.aborted) timer = setTimeout(read, Math.max(1, refreshSeconds) * 1000);
    };
    void read();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [enabled, refreshSeconds, tick]);

  const environment = useMemo(() => createEnvironment(document ?? { dataSources: [] }, house, overlay), [document, house, overlay]);
  const simulateCall = useCallback<HouseStates['simulateCall']>((call, control) => {
    const resolved = resolveCall(call, createEnvironment(document ?? { dataSources: [] }, latest.current.house, latest.current.overlay, control));
    if (!resolved) return false;
    const next = applyCall(latest.current.house, latest.current.overlay, resolved);
    if (next === latest.current.overlay) return false;
    latest.current = { ...latest.current, overlay: next };
    setOverlay(next);
    return true;
  }, [document]);
  const setLocal = useCallback((stateId: string, value: LocalValue) => setOverlay(current => applyLocal(current, stateId, value)), []);
  const resetOverlay = useCallback(() => setOverlay(emptyOverlay), []);
  const refresh = useCallback(() => setTick(value => value + 1), []);
  return { house, overlay, status, error, environment, simulateCall, setLocal, setOverlay, resetOverlay, refresh };
}
