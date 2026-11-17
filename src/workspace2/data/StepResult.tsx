import { useMemo } from 'react';
import type { Json } from '../../shared/types';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import { useWorkspaceData } from '../pickers/WorkspaceData';
import { flowData, useSample } from './samples';
import { studioClock } from './useFlowData';
import { useLiveRun } from './liveRun';

/** What a step did to the data: how many items arrived, how many it left, and the first item. `undefined` while there is no data. */
export interface StepOutcome { before: number | null; after: number | null; first?: Json }
/** Runs the flow up to and including step `index` and reports what that step did. */
export function stepOutcome(inputs: PipelineInputs, index: number, held: Parameters<typeof flowData>[1]): StepOutcome | undefined {
  const upto = flowData({ ...inputs, steps: inputs.steps.slice(0, index + 1) }, held);
  if (upto.result?.status !== 'ok') return undefined;
  const trace = upto.result.trace, after = trace[index]?.size ?? null;
  const before = index === 0 ? (Array.isArray(upto.response) ? upto.response.length : null) : trace[index - 1]?.size ?? null;
  const value = upto.result.value;
  return { before, after, first: Array.isArray(value) ? value[0] : value };
}

/** The outcome of a step over the data the flow draws now (the draft's own steps, so the Result line follows each edit). */
export function useStepOutcome(flowId: string, inputs: PipelineInputs | undefined, index: number): StepOutcome | undefined {
  const { house } = useWorkspaceData();
  const { sample, hide } = useSample(flowId), run = useLiveRun(flowId, inputs);
  return useMemo(() => inputs ? stepOutcome(inputs, index, { states: house?.states, sample, hide, live: run.answer?.response, context: { clock: studioClock(), viewer: house?.viewer } }) : undefined, [inputs, index, house?.states, house?.viewer, sample, hide, run.answer]);
}

/** The words under a Filter: "Keeps 3 of 14 items." and, when a field is optional, "Items with no due date are left out." */
export function filterResult(outcome: StepOutcome | undefined, optionalField?: string): { head: string; note?: string } {
  if (!outcome || outcome.after === null) return { head: 'No data yet.', note: 'Paste a sample, or add the Data Flow to a list, to see what this keeps.' };
  const head = outcome.before === null ? `Keeps ${outcome.after} ${outcome.after === 1 ? 'item' : 'items'}.` : `Keeps ${outcome.after} of ${outcome.before} ${outcome.before === 1 ? 'item' : 'items'}.`;
  return { head, note: optionalField ? `Items with no ${optionalField.replace(/_/g, ' ')} are left out.` : undefined };
}
