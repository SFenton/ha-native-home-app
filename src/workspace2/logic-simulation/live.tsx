import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ALL_KEY, READY_KEY, VIEWER_KEY } from '../../preview2/live-house';
import { createEnvironment, emptyOverlay } from '../../preview2/projections';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Environment } from '../../shared/composition/evaluator';
import { entityRows, type PipelineInputs } from '../../shared/composition/pipeline';
import type { SimulationCase } from '../../shared/composition/graph/types';
import { valueAt } from '../../shared/composition/evaluator';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { heldEntity } from '../data/samples';
import { needsServer, useLiveRun, type LiveRun } from '../data/liveRun';
import { studioClock } from '../data/useFlowData';
import { flowFingerprint, type SimulationProgram } from './program';
import type { HeldSnapshot } from './engine';

export interface FlowState { readonly fingerprint: string; readonly run: LiveRun }
/** Group identical requests onto the existing run store, using the first authored flow ID. */
export function sharedFlowRequests(program: SimulationProgram): readonly { readonly id: string; readonly ids: readonly string[]; readonly inputs: PipelineInputs }[] {
  const grouped = new Map<string, { id: string; ids: string[]; inputs: PipelineInputs }>();
  for (const [id, inputs] of program.flows) {
    if (!needsServer(inputs)) continue;
    const key = flowFingerprint(inputs);
    const group = grouped.get(key);
    if (group) group.ids.push(id);
    else grouped.set(key, { id, ids: [id], inputs });
  }
  return [...grouped.values()];
}
/** Keep mounted while switching modes: undefined inputs cancel the shared debounce and invalidate in-flight answers. */
export function SimulationFlowBridge({ id, ids, inputs, enabled, onRun }: {
  id: string; ids: readonly string[]; inputs: PipelineInputs; enabled: boolean;
  onRun: (ids: readonly string[], state: FlowState) => void;
}) {
  const run = useLiveRun(id, enabled ? inputs : undefined);
  const fingerprint = flowFingerprint(inputs), keys = ids.join('\u0000');
  useEffect(() => {
    if (enabled) onRun(ids, { fingerprint, run });
  }, [enabled, keys, fingerprint, run.answer, run.error, run.running, onRun]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
/** Subscribe to versions, never mutable map identity. This adapter opens no socket and owns no request helper. */
export function useSimulationSnapshot(program: SimulationProgram, document: Pick<CompositionDocument, 'dataSources'>, flows: Readonly<Record<string, FlowState>>, options: {
  readonly clock?: SimulationCase['base']['clock'];
  readonly previousText?: SimulationCase['base']['previousText'];
  readonly stale?: boolean;
  readonly error?: string;
} = {}): HeldSnapshot {
  const data = useWorkspaceData(), { live, house } = data;
  const entityIds = useMemo(() => {
    const ids = new Set<string>();
    program.reads.forEach(read => { const entity = program.sourceEntities[read.sourceId]; if (entity) ids.add(entity); });
    for (const [, inputs] of program.flows) {
      if (inputs.request.type === 'entities') inputs.request.entityIds.forEach(entity => ids.add(entity.value));
      else if (inputs.request.type === 'entity-attribute' || inputs.request.type === 'ha-subscription') ids.add(inputs.request.entityId.value);
    }
    return [...ids];
  }, [program]);
  const broad = program.reads.some(read => !program.sourceEntities[read.sourceId] && !program.flows.has(read.sourceId));
  const key = entityIds.join('\u0000');
  const subscribe = useCallback((listener: () => void) => live ? live.subscribe(keys => {
    if (broad || keys.some(changed => changed === READY_KEY || changed === VIEWER_KEY || entityIds.includes(changed))) listener();
  }) : () => {}, [live, key, broad]); // eslint-disable-line react-hooks/exhaustive-deps
  const versions = useSyncExternalStore(subscribe, () => live ? `${live.ready}|${live.versionOf(VIEWER_KEY)}|${broad ? live.versionOf(ALL_KEY) : entityIds.map(id => live.versionOf(id)).join(',')}` : '');
  const now = options.clock ?? studioClock();
  return useMemo(() => {
    const environment: Environment = createEnvironment(document, house ?? {}, emptyOverlay, undefined, now);
    const reads: SimulationCase['base']['reads'] = program.reads.filter(read => !program.flows.has(read.sourceId)).map(read => ({
      ...read,
      answer: read.access === 'raw-state' ? environment.readRaw?.(read.sourceId) ?? { status: 'unavailable' }
        : read.access === 'last-changed' ? environment.readChanged?.(read.sourceId) ?? { status: 'unavailable' }
          : environment.read(read.sourceId, [...(read.path ?? [])]),
    })) as SimulationCase['base']['reads'];
    const at = new Date().toISOString();
    const flowResponses: SimulationCase['base']['flowResponses'][number][] = [];
    for (const [sourceId, inputs] of program.flows) {
      const request = inputs.request, fingerprint = flowFingerprint(inputs);
      if (request.type === 'none') continue;
      if (request.type === 'entities' && (live?.ready || house?.states)) {
        flowResponses.push({ sourceId, requestFingerprint: fingerprint, response: entityRows(request, id => heldEntity(house?.states?.get(id))), at, trimmed: false });
      } else if (request.type === 'entity-attribute') {
        const entity = heldEntity(house?.states?.get(request.entityId.value));
        if (entity) flowResponses.push({ sourceId, requestFingerprint: fingerprint, response: valueAt(entity.attributes, request.path), at, trimmed: false });
      } else {
        const state = flows[sourceId], answer = state?.fingerprint === fingerprint ? state.run.answer : undefined;
        if (answer) flowResponses.push({ sourceId, requestFingerprint: fingerprint, response: answer.response, at: answer.at, trimmed: answer.trimmed ?? false });
      }
    }
    const currentFlows = Object.entries(flows).filter(([id, state]) => {
      const inputs = program.flows.get(id);
      return inputs && flowFingerprint(inputs) === state.fingerprint;
    }).map(([, state]) => state);
    const stale = options.stale || currentFlows.some(state => state.run.error && state.run.answer || state.run.running && state.run.answer);
    const error = options.error ?? currentFlows.find(state => state.run.error)?.run.error;
    return {
      at, origin: live || !house?.states ? 'live' as const : 'sample' as const, stale: Boolean(stale), ...(error ? { error } : {}),
      base: { reads, flowResponses, clock: now, previousText: options.previousText ?? [],
        ...(program.viewerFields.size && house?.viewer ? { viewer: Object.fromEntries(Object.entries(house.viewer).filter(([field]) => program.viewerFields.has(field as 'userId' | 'isAdmin' | 'personEntityId'))) } : {}),
        ...(program.viewerPerson ? { viewerPerson: environment.viewerPersonState?.() ?? { status: 'unavailable' as const } } : {}) },
    };
  }, [program, document, house, live, versions, flows, now.now, now.utcOffsetMinutes, options.previousText, options.stale, options.error]); // eslint-disable-line react-hooks/exhaustive-deps
}
