import { z } from 'zod/v4';
import { identifierSchema } from '../../validation';
import { operandBase } from '../expression';
import { parseCompositionShape } from '../compiler';
import { CompositionValidationError } from '../json';
import { checkPipelineSource, type PipelineFacts } from '../pipeline/compile';
import { pipelineInputsSchema, pipelineSourceSchema, stepSchema } from '../pipeline/schema';
import type { GraphPipelineSource } from './types';

export const AVERAGE_CAPABILITY = 'sh.flow-average@1';
export const TEXT_KEEP_CAPABILITY = 'sh.text-keep@1';
const averageStep = z.strictObject({ id: identifierSchema, op: z.literal('average'), value: operandBase });
export const graphStepSchema = z.union([stepSchema, averageStep]);
export const graphInputsSchema = pipelineInputsSchema.extend({ steps: z.array(graphStepSchema).max(32) });
export const graphSourceSchema = pipelineSourceSchema.extend({ inputs: graphInputsSchema });

/**
 * Until PR #20 lands, min is the existing nullable-number typing rule for average.
 * This validates shape/scope only; it does not pretend the baseline runtime runs average.
 */
export function checkGraphPipeline(source: GraphPipelineSource, at: string): PipelineFacts {
  try { parseCompositionShape(graphSourceSchema, source); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { issues: error.issues.map(issue => ({ ...issue, pointer: at + issue.pointer })), reads: [], dependencies: [], capabilities: [] };
  }
  const native = pipelineSourceSchema.safeParse(source);
  if (native.success) return checkPipelineSource(native.data, at);
  const nullable = pipelineSourceSchema.parse({
    ...source, inputs: { ...source.inputs, steps: source.inputs.steps.map(step => step.op === 'average' ? { ...step, op: 'min' } : step) },
  });
  const neutral = pipelineSourceSchema.parse({
    ...source, inputs: { ...source.inputs, steps: source.inputs.steps.map(step => step.op === 'average' ? { ...step, op: 'sum' } : step) },
  });
  const facts = checkPipelineSource(nullable, at);
  const capabilities = checkPipelineSource(neutral, at).capabilities;
  return { ...facts, capabilities: [...new Set([...capabilities, AVERAGE_CAPABILITY])].sort() };
}
export function typingSteps(steps: GraphPipelineSource['inputs']['steps']) {
  return steps.map(step => stepSchema.parse(step.op === 'average' ? { ...step, op: 'min' } : step));
}
