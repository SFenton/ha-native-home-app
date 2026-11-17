import { useMemo } from 'react';
import { wallClock } from '../../preview2/clock';
import type { FlowContext, PipelineInputs } from '../../shared/composition/pipeline';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { useLiveRun, type LiveRun } from './liveRun';
import { flowData, useSample, type FlowData, type Sample } from './samples';

/** The clock a flow reads in the Studio: this browser's local time, as the contract's `Clock`. */
export function studioClock(date: Date = new Date()): FlowContext['clock'] { return wallClock(date); }

/** What a flow draws now (its data, where it came from, and what the steps made), with the sample kept for it and whether values are hidden. */
export function useFlowData(flowId: string, inputs: PipelineInputs): FlowData & { sample?: Sample; hide: boolean; run: LiveRun } {
  const { house } = useWorkspaceData();
  const { sample, hide } = useSample(flowId);
  const states = house?.states, run = useLiveRun(flowId, inputs);
  // The minute is the clock's grain: a flow that reads Today or Now follows it without re-running on every render.
  const minute = Math.floor(Date.now() / 60_000);
  const data = useMemo(() => flowData(inputs, { states, sample, hide, live: run.answer?.response, context: { clock: studioClock(), viewer: house?.viewer } }), [inputs, states, sample, hide, run.answer, house?.viewer, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...data, sample, hide, run };
}
