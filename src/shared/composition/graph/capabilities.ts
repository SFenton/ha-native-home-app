import { z } from 'zod/v4';
import type { Json } from '../../types';
import { parseCompositionShape } from '../compiler';
import { CompositionValidationError, type CompositionIssue } from '../json';
import { checkPipelineSource, FLOW_AVERAGE_CAPABILITY, type PipelineFacts } from '../pipeline/compile';
import { pipelineInputsSchema, pipelineSourceSchema, stepSchema } from '../pipeline/schema';
import { conditional, symbolSlot, textValue } from '../slots';
import { operandKind, type ExpressionFacts } from '../expression';
import type { GraphPipelineSource } from './types';

export const AVERAGE_CAPABILITY = FLOW_AVERAGE_CAPABILITY;
export const TEXT_KEEP_CAPABILITY = 'sh.text-keep@1';
export const graphStepSchema = stepSchema;
export const graphInputsSchema = pipelineInputsSchema;
export const graphSourceSchema = pipelineSourceSchema;
export const graphTextSlotSchema = textValue(2000, true);
const [literalSymbol, , boundSymbol] = symbolSlot.options;
export const graphSlotSchema = z.discriminatedUnion('type', [
  ...graphTextSlotSchema.options, literalSymbol, boundSymbol, conditional(z.json()),
]);

export function checkGraphSlot(value: Json, at: string): { issues: CompositionIssue[]; capabilities: string[] } {
  let slot: z.infer<typeof graphSlotSchema>;
  try { slot = parseCompositionShape(graphSlotSchema, value); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return { issues: error.issues.map(issue => ({ ...issue, pointer: at + issue.pointer })), capabilities: [] };
  }
  const issues: CompositionIssue[] = [], capabilities: string[] = [];
  if (slot.type === 'expr' || slot.type === 'conditional' || slot.type === 'bound-symbol' || slot.type === 'read' && slot.fallback !== undefined) capabilities.push('sh.rules@1');
  if ('whenUnavailable' in slot && slot.whenUnavailable !== undefined) capabilities.push(TEXT_KEEP_CAPABILITY);
  if (slot.type === 'expr' || slot.type === 'bound-symbol') {
    const kind = operandKind(slot.value);
    if (slot.type === 'expr' ? kind === 'structure' : kind !== undefined && kind !== 'string') issues.push({ code: 'binding_type', pointer: `${at}/value` });
  }
  if (slot.type === 'read' && slot.as !== 'string') issues.push({ code: 'binding_type', pointer: `${at}/as` });
  return { issues, capabilities };
}

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
