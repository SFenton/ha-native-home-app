import type { Json } from '../../shared/types';
import type { PipelineInputs } from '../../shared/composition/pipeline';
import { entitiesWords } from './EntitiesChooser';
import { flowShapes, stepNames, stepSummary } from './flow';
import { needsServer } from './liveRun';
import type { FlowData, Sample } from './samples';

export interface RunData extends FlowData {
  output?: Json;
  sample?: Omit<Sample, 'json'>;
  run?: { at?: string; running: boolean; error?: string };
}

export const emptyLiveHint = 'Try it: choose Edit Flow in Canvas, then Simulation · Studio only to try a scenario.';

function readCount(inputs: PipelineInputs, data: RunData): number | undefined {
  if (Array.isArray(data.response)) return data.response.length;
  if (inputs.request.type === 'ha-subscription') {
    const response = data.response;
    const list = response && typeof response === 'object' ? response[inputs.request.kind === 'todo-items' ? 'items' : 'forecast'] : undefined;
    return Array.isArray(list) ? list.length : undefined;
  }
  if (data.result?.status !== 'ok') return undefined;
  const list = data.result.trace.find(step => step.size !== null);
  return list && (list.op === 'get' || list.op === 'select-key') ? list.size ?? undefined : undefined;
}

function requestCount(inputs: PipelineInputs, count: number): string {
  if (inputs.request.type === 'entities') return entitiesWords(inputs.request.entityIds.map(id => id.value), new Map()).primary;
  return `${count} ${count === 1 ? 'item' : 'items'}${inputs.request.type === 'ha-subscription' ? ' from the list' : ''}`;
}

export interface RunNotice { head: string; note: string; state: 'loading' | 'unavailable' | 'error' | 'stale' }

/** An unanswered or indeterminate request is not an empty answered list. */
export function runNotice(inputs: PipelineInputs, data: RunData): RunNotice | undefined {
  if (inputs.request.type === 'none') return undefined;
  if (data.run?.error) return data.source === 'live'
    ? { head: 'Stale', note: `Last answer kept; it may be out of date. ${data.run.error}`, state: 'stale' }
    : { head: 'Error', note: data.run.error, state: 'error' };
  if (data.run?.running && data.source !== 'live') return { head: 'Loading', note: `Asking Home Assistant… ${data.source === 'sample' ? 'The sample is' : data.source === 'demo' ? 'Demo Data is' : 'Values are'} not a live answer yet.`, state: 'loading' };
  if (data.result?.status === 'over-budget' || !flowShapes(inputs).clean) return { head: 'Error', note: data.result?.status === 'over-budget' ? 'The flow used too much work to finish. No output is available.' : 'A step does not fit the data before it. No live output is available.', state: 'error' };
  if (data.source !== 'live') return undefined;
  if (needsServer(inputs) && !data.run?.at) return { head: "Can't tell yet", note: 'Home Assistant has not answered this request. This is not an empty list.', state: 'unavailable' };
  if (inputs.request.type === 'entities' && Array.isArray(data.response)) {
    const missing = data.response.filter(row => !row || typeof row !== 'object' || Array.isArray(row) || row.state === 'unavailable' || row.state === 'unknown').length;
    if (missing) return { head: "Can't tell yet", note: `Requested ${requestCount(inputs, data.response.length)}. ${missing} ${missing === 1 ? 'is' : 'are'} unavailable or unknown.`, state: 'unavailable' };
  }
  if (data.items === 0 && readCount(inputs, data) === undefined) return { head: "Can't tell yet", note: 'The request did not return a list of items. This is not an empty answered list.', state: 'unavailable' };
  return undefined;
}

/** The first positive list count that reaches zero, followed by the actual output count. */
export function emptyLiveSummary(inputs: PipelineInputs, data: RunData): string | undefined {
  if (data.source !== 'live' || data.items !== 0 || data.result?.status !== 'ok' || inputs.request.type === 'none') return undefined;
  const notice = runNotice(inputs, data);
  if (notice && notice.state !== 'stale') return undefined;
  const count = readCount(inputs, data);
  if (count === undefined) return undefined;
  let before = count;
  const parts = [`Read ${requestCount(inputs, count)}`];
  for (const trace of data.result.trace) {
    if (before > 0 && trace.size === 0) {
      const step = inputs.steps.find(step => step.id === trace.id);
      if (step) parts.push(`none left after ${stepNames[step.op]} (${stepSummary(step)})`);
      break;
    }
    if (trace.size !== null) before = trace.size;
  }
  const prefix = notice?.state === 'stale' ? 'Stale · Last answer: ' : data.run?.running ? 'Live · Last answer: ' : 'Live · ';
  return `${prefix}${[...parts, 'Output 0 items'].join(' · ')}`;
}
