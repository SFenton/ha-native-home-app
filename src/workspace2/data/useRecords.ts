import type { PipelineInputs } from '../../shared/composition/pipeline';
import type { Json } from '../../shared/types';
import type { RecordsAnswer } from '../../preview2/flow-records';
import { needsServer } from './liveRun';
import { useFlowData } from './useFlowData';

/**
 * The records a `repeat` draws (`sh.repeat@1`), from the flow of a source: the sample kept for the flow, else its live Data run, else demo data of its request's shape,
 * the same data the Data tab shows. Loading while a live run has not answered and nothing is kept; empty for an empty list; unavailable when the flow gave no
 * records; an error when the steps ran over budget. A later failed run keeps the last answer and marks it stale ("No reload").
 */
export function useRecords(sourceId: string, inputs: PipelineInputs): RecordsAnswer {
  const data = useFlowData(sourceId, inputs);
  const { result, run } = data;
  if (needsServer(inputs) && data.source === 'demo' && run.running && !run.answer) return { state: 'loading', records: [] };
  if (!result) return { state: 'unavailable', records: [] };
  if (result.status !== 'ok') return { state: 'error', records: [] };
  const output = result.output as Json;
  if (!Array.isArray(output)) return { state: 'unavailable', records: [] };
  if (output.length === 0) return { state: 'empty', records: [] };
  return { state: 'ready', records: output, stale: run.error !== undefined && run.answer !== undefined };
}
