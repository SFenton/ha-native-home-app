import { operandBase } from '../expression';
import { inferShape } from '../pipeline/infer';
import { newFacts, typeOperand, type TypeScope } from '../pipeline/typing';
import { isAssignable, merge, orNull, withoutNull, type Shape } from '../pipeline/shape';
import type { Json } from '../../types';
import type { GraphNode, GraphPort, GraphScope, PortType } from './types';
import { copy, copyShape, record } from './json';
import { describeGrammar, expressionChildren } from './grammar';

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
export function expressionScope(value: Json, scopeId: string, scopes: readonly GraphScope[]): string | undefined {
  const depends = (candidate: Json, names: readonly string[]): boolean => record(candidate) && (names.includes(String(candidate.type))
    || expressionChildren(candidate, 'operand').some(child => depends(child.value, names)));
  if (depends(value, ['item', 'index', 'hole'])) return scopeId;
  if (!depends(value, ['param'])) return undefined;
  let scope = scopes.find(scope => scope.id === scopeId);
  while (scope && scope.kind !== 'flow') scope = scopes.find(parent => parent.id === scope?.parentId);
  return scope?.id ?? scopeId;
}
export function inputType(node: Pick<GraphNode, 'payload' | 'scopeId'>, binding: string, actual: PortType): PortType {
  const kind = node.payload.kind === 'template' || node.payload.kind === 'logic-ref' ? node.payload.representation
    : node.payload.kind === 'hole' ? 'auto' : node.payload.kind;
  const child = describeGrammar(copy(node.payload.value), kind).children.find(child => child.binding === binding);
  const representation = child?.kind === 'condition' ? 'condition' : child?.kind === 'source-selection' ? 'source-selection'
    : child?.kind === 'operand' ? 'operand' : child ? 'stream' : actual.representation;
  if (representation === 'source-selection') return { ...portType({ kind: 'string' }, representation, node.scopeId), valueType: 'entity' };
  if (representation === 'condition') return portType({ kind: 'boolean' }, representation, node.scopeId);
  const value = copy(node.payload.value);
  let shape: Shape = { kind: 'any' };
  if (!record(value)) return { ...portType(shape, representation, node.scopeId), nullable: true };
  if (value.type === 'math' || value.type === 'numeric') shape = orNull({ kind: 'number' });
  else if (value.type === 'date') shape = orNull({ kind: 'string' });
  else if (value.type === 'format' || value.type === 'list-includes' || value.type === 'expr') shape = orNull(scalarShape);
  else if (value.type === 'bound-symbol') shape = orNull({ kind: 'string' });
  else if (value.type === 'compare') shape = ['above', 'below'].includes(String(value.op)) ? orNull({ kind: 'number' })
    : ['before', 'after'].includes(String(value.op)) ? orNull({ kind: 'string' }) : { kind: 'any' };
  else if (node.payload.kind === 'step' && ['sum', 'min', 'max', 'average', 'running-sum'].includes(String(value.op)) && binding === '/value') shape = orNull({ kind: 'number' });
  const expected = { ...portType(shape, representation, node.scopeId), ...(shape.kind === 'any' ? { nullable: true } : {}) };
  return value.type === 'date' || value.type === 'compare' && ['before', 'after'].includes(String(value.op)) ? { ...expected, valueType: 'time' } : expected;
}

export function scopesCompatible(output: PortType, input: PortType, scopes: readonly GraphScope[] = []): boolean {
  if (!output.scopeId || output.scopeId === input.scopeId) return true;
  if (scopes.find(scope => scope.id === output.scopeId)?.kind !== 'flow') return false;
  let scope = scopes.find(scope => scope.id === input.scopeId);
  const seen = new Set<string>();
  while (scope && !seen.has(scope.id)) {
    if (scope.id === output.scopeId) return true;
    seen.add(scope.id); scope = scopes.find(parent => parent.id === scope?.parentId);
  }
  return false;
}
export function portsCompatible(output: PortType, input: PortType, scopes: readonly GraphScope[] = []): { compatible: boolean; reason?: string } {
  if (output.representation !== input.representation) return { compatible: false, reason: 'Representations differ; add an explicit adapter.' };
  if (!scopesCompatible(output, input, scopes)) return { compatible: false, reason: 'An item value cannot cross its lexical scope.' };
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
