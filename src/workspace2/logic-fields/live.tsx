import { useMemo } from 'react';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import type { Json } from '../../shared/types';
import type { RecordsAnswer } from '../../preview2/flow-records';
import { needsServer, useLiveRun } from '../data/liveRun';
import { flowData, useSample } from '../data/samples';
import { studioClock } from '../data/useFlowData';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useLogicFields } from './LogicFields';

/** Retire legacy readers before the canvas acquires grouped request ownership. */
export function RetireWorkspaceFlows({ ids }: { ids: readonly string[] }) {
  return ids.map(id => <RetireFlow key={id} id={id}/>);
}
function RetireFlow({ id }: { id: string }) { useLiveRun(id, undefined); return null; }

export function useWorkspaceFlowData(flowId: string, inputs: PipelineInputs) {
  const { house } = useWorkspaceData(), suspended = useLogicFields()?.suspended;
  const { sample, hide } = useSample(flowId), run = useLiveRun(flowId, suspended ? undefined : inputs);
  const minute = Math.floor(Date.now() / 60_000);
  const data = useMemo(() => flowData(inputs, {
    states: house?.states, sample, hide, live: run.answer?.response, context: { clock: studioClock(), viewer: house?.viewer },
  }), [inputs, house?.states, house?.viewer, sample, hide, run.answer, minute]);
  return { ...data, sample, hide, run };
}
export function useWorkspaceRecords(sourceId: string, inputs: PipelineInputs): RecordsAnswer {
  const data = useWorkspaceFlowData(sourceId, inputs), { result, run } = data;
  if (needsServer(inputs) && data.source === 'demo' && run.running && !run.answer) return { state: 'loading', records: [] };
  if (!result) return { state: 'unavailable', records: [] };
  if (result.status !== 'ok') return { state: 'error', records: [] };
  const output = result.output as Json;
  if (!Array.isArray(output)) return { state: 'unavailable', records: [] };
  if (!output.length) return { state: 'empty', records: [] };
  return { state: 'ready', records: output, stale: run.error !== undefined && run.answer !== undefined };
}
