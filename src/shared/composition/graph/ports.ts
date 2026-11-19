import { operandBase } from '../expression';
import { inferShape } from '../pipeline/infer';
import { newFacts, typeOperand, type TypeScope } from '../pipeline/typing';
import { isAssignable, merge, orNull, withoutNull, type Shape } from '../pipeline/shape';
import type { Json } from '../../types';
import type { GraphNode, GraphPort, PortType } from './types';
import { copy, copyShape, record } from './json';

export function portType(shape: Shape, representation: PortType['representation'] = 'operand', scopeId?: string): PortType {
  const core = withoutNull(shape);
  const valueType: PortType['valueType'] = core.kind === 'number' ? 'number' : core.kind === 'boolean' ? 'yes/no'
    : core.kind === 'array' ? 'list' : core.kind === 'object' ? 'record'
      : core.kind === 'string' ? core.format === 'entity-id' ? 'entity' : core.format === 'date' || core.format === 'date-time' ? 'time' : 'text' : 'unresolved';
  return { valueType, representation, shape, nullable: shape.kind === 'null' || shape.kind === 'union' && shape.of.some(member => member.kind === 'null'), ...(scopeId ? { scopeId } : {}) };
}
export const scalarShape: Shape = { kind: 'union', of: [{ kind: 'boolean' }, { kind: 'number' }, { kind: 'string' }] };
export function expressionPort(value: Json, condition: boolean, scope: TypeScope, scopeId?: string): PortType {
  if (condition) return portType({ kind: 'boolean' }, 'condition', scopeId);
  const parsed = operandBase.safeParse(value);
  if (!parsed.success) return portType({ kind: 'any' }, 'operand', scopeId);
  const operand = parsed.data;
  const shape = operand.type === 'literal' ? inferShape(operand.value)
    : operand.type === 'count' || operand.type === 'list-count' ? { kind: 'number' } as const
      : operand.type === 'raw-state' ? { kind: 'string' } as const
        : operand.type === 'last-changed' ? { kind: 'string', format: 'date-time' } as const
          : operand.type === 'list-includes' ? { kind: 'boolean' } as const
            : typeOperand(operand, { ...scope, allowRead: true, allowViewer: true }, '', newFacts());
  return portType(shape, 'operand', scopeId);
}
export function inputType(node: Pick<GraphNode, 'payload'>, binding: string, actual: PortType): PortType {
  if (actual.representation === 'source-selection') return actual;
  const value = copy(node.payload.value);
  if (!record(value)) return actual;
  let shape: Shape | undefined;
  if (value.type === 'math' || value.type === 'numeric') shape = orNull({ kind: 'number' });
  else if (value.type === 'date') shape = orNull({ kind: 'string' });
  else if (value.type === 'format' || value.type === 'list-includes' || value.type === 'expr') shape = orNull(scalarShape);
  else if (value.type === 'bound-symbol') shape = orNull({ kind: 'string' });
  else if (value.type === 'compare') shape = ['above', 'below'].includes(String(value.op)) ? orNull({ kind: 'number' })
    : ['before', 'after'].includes(String(value.op)) ? orNull({ kind: 'string' }) : undefined;
  else if (node.payload.kind === 'step' && ['sum', 'min', 'max', 'average', 'running-sum'].includes(String(value.op)) && binding === '/value') shape = orNull({ kind: 'number' });
  const expected = shape ? portType(shape, actual.representation, actual.scopeId) : actual;
  return value.type === 'date' || value.type === 'compare' && ['before', 'after'].includes(String(value.op)) ? { ...expected, valueType: 'time' } : expected;
}

export function portsCompatible(output: PortType, input: PortType): { compatible: boolean; reason?: string } {
  if (output.representation !== input.representation) return { compatible: false, reason: 'Representations differ; add an explicit adapter.' };
  if (output.scopeId && output.scopeId !== input.scopeId) return { compatible: false, reason: 'An item value cannot cross its lexical scope.' };
  if (input.valueType === 'time' && output.valueType !== 'time') return { compatible: false, reason: 'Time inputs require date or date-time text.' };
  if (input.unit && input.unit !== output.unit) return { compatible: false, reason: 'Units differ; add an explicit conversion.' };
  if (output.valueType === 'unresolved' || output.shape.kind === 'any') return { compatible: false, reason: 'Unresolved type requires an existing narrowing operation.' };
  if (output.nullable && !input.nullable) return { compatible: false, reason: 'The destination does not accept null.' };
  if (!isAssignable(copyShape(output.shape), copyShape(input.shape))) return { compatible: false, reason: 'Value shapes do not match; no implicit coercion is available.' };
  return { compatible: true };
}
export function commonPort(types: readonly PortType[]): PortType {
  const shape = types.reduce<Shape>((held, type) => merge(held, copyShape(type.shape)), { kind: 'never' });
  return portType(shape, types[0]?.representation);
}
export const outputPort = (type: PortType): GraphPort => ({ id: 'value', label: 'Value', type, required: false });
