import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { READY_KEY } from '../../preview2/live-house';
import { ApiError, request } from '../../api';
import type { Json } from '../../shared/types';
import type { FlowContext, PipelineInputs } from '../../shared/composition/pipeline';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { studioClock } from './useFlowData';

/**
 * Running a flow against live Home Assistant (studio-ux2 L-flowrun). The Studio's server makes the one read-only request the flow asks for
 * (`POST /native/api/ha/flow-run`); the page runs the steps itself on what comes back, so every step's result keeps following the draft.
 * Only a service and a live list need the server: a group of entities and an attribute are read from the house the page already streams.
 *
 * One store per flow, so the run bar, the outline and every step page share one request. A run is asked for when the request changes, after
 * {@link RUN_DEBOUNCE_MS}, and again when an entity the flow watches changes on the live stream. The last answer stays while the next one is
 * on its way ("No reload"); a failure keeps it too and says why.
 */
export const RUN_DEBOUNCE_MS = 600;

/** What the server answered. */
export interface LiveAnswer { response: Json; at: string; items?: number; trimmed?: boolean }
/** What the page knows about a flow's live run. `answer` is the last good one for the current request. */
export interface LiveRun { answer?: LiveAnswer; error?: string; running: boolean }

interface Entry { state: LiveRun & { requestKey?: string }; listeners: Set<() => void>; lastKey?: string; timer?: ReturnType<typeof setTimeout>; sequence: number }
const entries = new Map<string, Entry>();
const idle: LiveRun = { running: false };
const entryOf = (flowId: string): Entry => {
  let entry = entries.get(flowId);
  if (!entry) { entry = { state: { running: false }, listeners: new Set(), sequence: 0 }; entries.set(flowId, entry); }
  return entry;
};
const publish = (entry: Entry, state: Entry['state']) => { entry.state = state; entry.listeners.forEach(listener => listener()); };
/** Forgets every run (tests). */
export function resetLiveRuns(): void { for (const entry of entries.values()) clearTimeout(entry.timer); entries.clear(); }

/** Whether the flow needs the server: a service or a live list. */
export const needsServer = (inputs: PipelineInputs): boolean => inputs.request.type === 'service-response' || inputs.request.type === 'ha-subscription';

/** The entities whose change should run the flow again: a live list's own, a service's target and its refresh list. */
export function watchedEntities(inputs: PipelineInputs): string[] {
  const { request, refresh } = inputs, ids = new Set<string>();
  if (request.type === 'ha-subscription') ids.add(request.entityId.value);
  if (request.type === 'service-response') {
    const target = request.target?.entity_id;
    if (target?.type === 'literal' && typeof target.value === 'string') ids.add(target.value);
    for (const id of refresh?.entityIds ?? []) ids.add(id.value);
  }
  return [...ids];
}
/** What the server's answer depends on: the request and the inputs it reads. Editing a step does not change it. */
export const requestKeyOf = (inputs: PipelineInputs): string => JSON.stringify([inputs.request, inputs.parameters]);

function schedule(flowId: string, key: string, requestKey: string, inputs: PipelineInputs, viewer: FlowContext['viewer']) {
  const entry = entryOf(flowId);
  if (entry.lastKey === key) return;
  entry.lastKey = key;
  clearTimeout(entry.timer);
  const sequence = ++entry.sequence;
  publish(entry, { ...entry.state, running: true });
  entry.timer = setTimeout(() => {
    request<LiveAnswer & { source: 'live'; output: Json }>('/native/api/ha/flow-run', { method: 'POST', body: JSON.stringify({ inputs, clock: studioClock(), ...(viewer ? { viewer } : {}) }) })
      .then(answer => { if (entry.sequence === sequence) publish(entry, { answer: { response: answer.response, at: answer.at, items: answer.items, trimmed: answer.trimmed }, requestKey, running: false }); })
      .catch((error: unknown) => {
        if (entry.sequence !== sequence) return;
        publish(entry, { ...entry.state, error: error instanceof ApiError ? error.message : "The Studio couldn't reach its server.", running: false });
      });
  }, RUN_DEBOUNCE_MS);
}

/**
 * The live run of a flow. Quiet (no answer, not running) when Home Assistant is not connected or the flow needs no server, so Paste a Sample
 * and demo data stay as they were.
 */
export function useLiveRun(flowId: string, inputs: PipelineInputs | undefined): LiveRun {
  const { house, connected, live } = useWorkspaceData();
  const watch = inputs ? watchedEntities(inputs) : [];
  const watching = watch.join(',');
  // The house's map is mutated in place, so its identity never says an entity changed: listen to the store for the entities this flow reads.
  const subscribeHouse = useCallback((listener: () => void) => live ? live.subscribe(keys => { if (keys.includes(READY_KEY) || keys.some(id => watch.includes(id))) listener(); }) : () => {}, [live, watching]); // eslint-disable-line react-hooks/exhaustive-deps
  const versions = useSyncExternalStore(subscribeHouse, () => live ? `${live.ready}|${watch.map(id => live.versionOf(id)).join(',')}` : '');
  const ready = live ? live.ready : connected;
  const eligible = Boolean(inputs && ready && needsServer(inputs));
  const requestKey = inputs ? requestKeyOf(inputs) : '';
  const signature = !eligible || !inputs ? '' : live ? versions : JSON.stringify(watch.map(id => house?.states?.get(id) ?? null));
  const key = `${requestKey}|${signature}`;
  const viewer = house?.viewer;
  useEffect(() => {
    if (!eligible || !inputs) { const entry = entries.get(flowId); if (entry) { clearTimeout(entry.timer); entry.lastKey = undefined; entry.sequence++; } return; }
    schedule(flowId, key, requestKey, inputs, viewer);
  }, [flowId, key, eligible]); // eslint-disable-line react-hooks/exhaustive-deps
  const entry = entryOf(flowId);
  const state = useSyncExternalStore(listener => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; }, () => entry.state);
  if (!eligible) return idle;
  return { answer: state.requestKey === requestKey ? state.answer : undefined, error: state.error, running: state.running };
}
