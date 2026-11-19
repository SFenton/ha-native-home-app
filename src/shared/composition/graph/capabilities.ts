import { parseCompositionShape } from '../compiler';
import { CompositionValidationError } from '../json';
import { checkPipelineSource, FLOW_AVERAGE_CAPABILITY, type PipelineFacts } from '../pipeline/compile';
import { pipelineInputsSchema, pipelineSourceSchema, stepSchema } from '../pipeline/schema';
import type { GraphPipelineSource } from './types';

export const AVERAGE_CAPABILITY = FLOW_AVERAGE_CAPABILITY;
export const TEXT_KEEP_CAPABILITY = 'sh.text-keep@1';
export const graphStepSchema = stepSchema;
export const graphInputsSchema = pipelineInputsSchema;
export const graphSourceSchema = pipelineSourceSchema;
export function checkGraphPipeline(source: GraphPipelineSource, at: string): PipelineFacts {
  try { return checkPipelineSource(parseCompositionShape(pipelineSourceSchema, source), at); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { issues: error.issues.map(issue => ({ ...issue, pointer: at + issue.pointer })), reads: [], dependencies: [], capabilities: [] };
  }
}
export function typingSteps(steps: GraphPipelineSource['inputs']['steps']) {
  return steps.map(step => stepSchema.parse(step));
}
