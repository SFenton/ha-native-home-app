import { parseCompositionShape } from '../compiler';
import { CompositionValidationError } from '../json';
import { checkPipelineSource, FLOW_AVERAGE_CAPABILITY, type PipelineFacts } from '../pipeline/compile';
import { pipelineInputsSchema, pipelineSourceSchema, stepSchema } from '../pipeline/schema';
import { textValue } from '../slots';
import type { ExpressionFacts } from '../expression';
import type { GraphPipelineSource } from './types';

export const AVERAGE_CAPABILITY = FLOW_AVERAGE_CAPABILITY;
export const TEXT_KEEP_CAPABILITY = 'sh.text-keep@1';
export const graphStepSchema = stepSchema;
export const graphInputsSchema = pipelineInputsSchema;
export const graphSourceSchema = pipelineSourceSchema;
export const graphTextSlotSchema = textValue(2000, true);

export function expressionCapabilities(facts: ExpressionFacts): string[] {
  return [...new Set([
    ...[...facts.needs].map(need => `sh.${need}@1`),
    ...(facts.usedOperands ? ['sh.operands@1'] : []),
    ...(facts.references.length || facts.optimisticReferences.length ? ['sh.bindings@1'] : []),
  ])].sort();
}

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
