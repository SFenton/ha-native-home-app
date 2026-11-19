import { catalogByKey } from './catalog';
import { atPointer, copy, copyShape, fingerprint, replaceAt, sameJSON } from './json';
import { expressionPort, expressionScope, inputType, portsCompatible, scopesCompatible } from './ports';
import { grammarChildren, type FragmentKind } from './grammar';
import type { Json } from '../../types';
import type { GraphDiagnostic, GraphEdge, GraphJSON, GraphNode, LogicGraph, PortType } from './types';
import { assertCompositionBounds, CompositionValidationError } from '../json';
import { elementOf, type Shape } from '../pipeline/shape';
import { requestShape } from '../pipeline/sources';
import { newFacts, typeOperand, typeStep, type TypeScope } from '../pipeline/typing';
import { requestSchema } from '../pipeline/schema';
import { graphInputsSchema, graphStepSchema } from './capabilities';

const validationBrand: unique symbol = Symbol('GraphValidation');
export interface GraphValidation {
  readonly [validationBrand]: true;
  readonly graph: LogicGraph;
  readonly diagnostics: readonly GraphDiagnostic[];
}
/** Explicit handoff for one immutable graph revision; never reuse after mutating it. */
export function validateForLowering(graph: LogicGraph): GraphValidation {
  return { [validationBrand]: true, graph, diagnostics: validateGraph(graph) };
}
export function validateGraph(graph: LogicGraph, options: { readonly projection?: boolean } = {}): readonly GraphDiagnostic[] {
  try {
    assertCompositionBounds(graph.original);
    for (const node of graph.nodes) assertCompositionBounds(node.payload.value);
    return validateGraphChecked(graph, options);
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return error.issues.map(issue => ({
      severity: 'error', code: issue.code, pointer: issue.pointer, message: 'Graph exceeds the existing JSON resource/safety boundary.',
      anchor: graph.roots[0]?.anchor ?? { kind: 'document', id: 'document', field: '', fingerprint: '' },
    }));
  }
}
function validateGraphChecked(graph: LogicGraph, options: { readonly projection?: boolean }): readonly GraphDiagnostic[] {
  const errors: GraphDiagnostic[] = [];
  const anchor = graph.roots[0]?.anchor ?? { kind: 'document' as const, id: 'document', field: '', fingerprint: fingerprint(graph.original) };
  const firstOrigins = new Map<string, string>();
  for (const node of graph.nodes) if (!firstOrigins.has(node.id)) firstOrigins.set(node.id, node.origins[0] ?? '');
  const ports = new Map(graph.nodes.filter(node => node.inputs.length > 8 || node.outputs.length > 8).map(node => {
    const inputs = new Map<string, typeof node.inputs[number]>(), outputs = new Map<string, typeof node.outputs[number]>();
    const bindings = new Map<string | undefined, typeof node.inputs[number][]>(), scopeBindings = new Map<string | undefined, string | undefined>();
    for (const input of node.inputs) {
      if (!inputs.has(input.id)) inputs.set(input.id, input);
      const group = bindings.get(input.binding);
      if (group) group.push(input); else bindings.set(input.binding, [input]);
      if (!scopeBindings.has(input.type.scopeId)) scopeBindings.set(input.type.scopeId, input.binding);
    }
    for (const output of node.outputs) if (!outputs.has(output.id)) outputs.set(output.id, output);
    return [node, { inputs, outputs, bindings, scopeBindings }] as const;
  }));
  const report = (code: GraphDiagnostic['code'], message: string, nodeId?: string, portId?: string, hint = false) => {
    if (hint && options.projection) return;
    errors.push({ severity: hint ? 'warning' : 'error', ...(hint ? { hint: true as const } : {}), code, message: hint ? `Wiring hint: ${message}` : message, anchor, nodeId, portId, pointer: nodeId === undefined ? '' : firstOrigins.get(nodeId) ?? '' });
  };
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (nodes.size !== graph.nodes.length) report('duplicate_id', 'Block IDs must be unique.');
  if (new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) report('duplicate_id', 'Connection IDs must be unique.');
  const scopes = new Map(graph.scopes.map(scope => [scope.id, scope]));
  const descriptions = new Map(graph.nodes.filter(node => node.payload.kind !== 'opaque').map(node => {
    const kind: FragmentKind = node.payload.kind === 'template' || node.payload.kind === 'logic-ref' ? node.payload.representation
      : node.payload.kind === 'hole' || node.payload.kind === 'opaque' ? 'auto' : node.payload.kind;
    const children = new Map<string, ReturnType<typeof grammarChildren>[number]>();
    for (const child of grammarChildren(node.payload.value, kind)) if (!children.has(child.binding)) children.set(child.binding, child);
    return [node.id, children] as const;
  }));
  const incoming = new Map<string, GraphEdge[]>(), dependencies = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const key = `${edge.to.nodeId}:${edge.to.portId}`;
    const input = incoming.get(key), dependency = dependencies.get(edge.to.nodeId);
    if (input) input.push(edge); else incoming.set(key, [edge]);
    if (dependency) dependency.push(edge); else dependencies.set(edge.to.nodeId, [edge]);
  }
  const originalValues = new Map<string, GraphJSON | undefined>([['', graph.original]]);
  const originalAt = (at: string): GraphJSON | undefined => {
    const cached = originalValues.get(at);
    if (cached !== undefined || originalValues.has(at)) return cached;
    if (!at.startsWith('/') || at.includes('~')) return atPointer(graph.original, at);
    const pending: string[] = [];
    let parent = at;
    while (!originalValues.has(parent)) {
      if (pending.length === 40) return atPointer(graph.original, at);
      pending.push(parent); parent = parent.slice(0, parent.lastIndexOf('/'));
    }
    let value = originalValues.get(parent);
    for (const own of pending.reverse()) {
      value = value === undefined ? undefined : atPointer(value, own.slice(parent.length));
      originalValues.set(own, value); parent = own;
    }
    return value;
  };
  const unchangedNodes = new Map<string, boolean>(), checkingUnchanged = new Set<string>();
  const isUnchanged = (node: GraphNode): boolean => {
    const cached = unchangedNodes.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.origins.length || node.provenance !== 'lifted' && node.provenance !== 'opaque') return false;
    if (checkingUnchanged.has(node.id)) return false;
    checkingUnchanged.add(node.id);
    const original = originalAt(node.origins[0]);
    const omitted = node.inputs.length ? new Set(node.inputs.flatMap(input => input.binding === undefined ? [] : [input.binding])) : undefined;
    const unchanged = (node.provenance === 'lifted' || node.provenance === 'opaque') && original !== undefined
      && sameJSON(node.payload.value, original, omitted)
      && node.inputs.every(input => {
        const edges = incoming.get(`${node.id}:${input.id}`), child = edges?.length === 1 ? nodes.get(edges[0].from.nodeId) : undefined;
        return child !== undefined && child.origins[0] === node.origins[0] + input.binding && isUnchanged(child);
      });
    checkingUnchanged.delete(node.id); unchangedNodes.set(node.id, unchanged);
    return unchanged;
  };
  const assembled = new Map<string, Json>(), assembling = new Set<string>();
  const assemble = (id: string, depth = 1): Json | undefined => {
    if (depth > 40) throw new CompositionValidationError([{ code: 'limit_exceeded', pointer: nodes.get(id)?.origins[0] ?? '' }]);
    if (assembled.has(id)) return assembled.get(id);
    if (assembling.has(id)) return undefined;
    const node = nodes.get(id);
    if (!node) return undefined;
    assembling.add(id);
    let value = copy(node.payload.value);
    for (const input of node.inputs) {
      if (input.binding === undefined) continue;
      const edges = incoming.get(`${id}:${input.id}`) ?? [];
      if (edges.length !== 1) continue;
      const child = assemble(edges[0].from.nodeId, depth + 1);
      if (child === undefined || atPointer(value, input.binding) === undefined) continue;
      value = replaceAt(value, input.binding, child);
    }
    assembling.delete(id); assembled.set(id, value);
    return value;
  };
  const typedFlows = new Map<string, { params: TypeScope['params']; initial: Shape; steps: Shape[]; stepCount: number } | undefined>();
  const actualOutputs = new Map<GraphNode, PortType | undefined>();
  const computeOutput = (node: GraphNode) => {
    const output = node.outputs[0]?.type;
    if (!output || node.payload.kind !== 'operand' && node.payload.kind !== 'condition') return output;
    const current = assemble(node.id), scope = scopes.get(node.scopeId);
    const owner = scope?.ownerNodeId ? nodes.get(scope.ownerNodeId) : undefined;
    let params: TypeScope['params'] = new Map();
    let item = owner?.payload.kind !== 'flow-inputs' && scope?.itemShape ? copyShape(scope.itemShape) : undefined;
    if (owner?.payload.kind === 'flow-inputs') {
      const childValue = (binding: string) => {
        const port = ports.get(owner)?.bindings.get(binding)?.[0] ?? owner.inputs.find(input => input.binding === binding);
        const edges = port ? incoming.get(`${owner.id}:${port.id}`) : undefined;
        return edges?.length === 1 ? assemble(edges[0].from.nodeId) : undefined;
      };
      if (!typedFlows.has(owner.id)) {
        const parsed = graphInputsSchema.safeParse(owner.payload.value), request = requestSchema.safeParse(childValue('/request'));
        if (parsed.success && request.success) {
          const inputs = parsed.data, params = new Map(inputs.parameters.map(parameter => [parameter.name, parameter.type])), facts = newFacts();
          const initial = request.data.type === 'none' ? typeOperand(request.data.value, { params, allowRead: false, allowViewer: true }, '', facts) : requestShape(request.data);
          typedFlows.set(owner.id, { params, initial, steps: [], stepCount: inputs.steps.length });
        } else typedFlows.set(owner.id, undefined);
      }
      const flow = typedFlows.get(owner.id), binding = ports.get(owner)?.scopeBindings.get(scope?.id) ?? owner.inputs.find(input => input.type.scopeId === scope?.id)?.binding;
      params = flow?.params ?? new Map();
      item = undefined;
      if (flow && binding) {
        const step = /^\/steps\/(\d+)$/.exec(binding);
        const needed = step ? Number(step[1]) : binding === '/output' ? flow.stepCount : 0;
        while (flow.steps.length < needed) {
          const index = flow.steps.length, parsed = graphStepSchema.safeParse(childValue(`/steps/${index}`));
          if (!parsed.success) break;
          flow.steps.push(typeStep(parsed.data, flow.steps.at(-1) ?? flow.initial, flow.params, `/steps/${index}`, newFacts()));
        }
        const shape = step ? Number(step[1]) === 0 ? flow.initial : flow.steps[Number(step[1]) - 1]
          : binding === '/output' && flow.steps.length === flow.stepCount ? flow.steps.at(-1) ?? flow.initial : undefined;
        if (shape) item = elementOf(shape) ?? shape;
      }
    }
    return current !== undefined
      ? expressionPort(current, node.payload.kind === 'condition', { params, allowRead: true, allowViewer: true, ...(item ? { item } : {}) }, expressionScope(current, node.scopeId, graph.scopes)) : output;
  };
  const actualOutput = (node: GraphNode) => {
    if (!actualOutputs.has(node)) actualOutputs.set(node, computeOutput(node));
    return actualOutputs.get(node);
  };
  if (scopes.size !== graph.scopes.length) report('duplicate_id', 'Scope IDs must be unique.', undefined, undefined, true);
  for (const scope of graph.scopes) {
    const seen = new Set([scope.id]);
    let parent = scope.parentId;
    while (parent) {
      if (seen.has(parent)) { report('cycle', 'Lexical scopes cannot contain a cycle.', undefined, undefined, true); break; }
      seen.add(parent);
      if (!scopes.has(parent)) { report('invalid_reference', 'Unknown parent scope.', undefined, undefined, true); break; }
      parent = scopes.get(parent)?.parentId;
    }
  }
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from.nodeId), to = nodes.get(edge.to.nodeId);
    const output = from && (ports.get(from)?.outputs.get(edge.from.portId) ?? from.outputs.find(port => port.id === edge.from.portId));
    const input = to && (ports.get(to)?.inputs.get(edge.to.portId) ?? to.inputs.find(port => port.id === edge.to.portId));
    if (!from || !to || !output || !input) { report('invalid_reference', 'Connection names a missing block or port.', edge.to.nodeId, edge.to.portId); continue; }
    if (edge.binding !== input.binding) report('invalid_reference', 'Connection binding does not match the input.', to.id, input.id);
    if (edge.kind !== output.type.representation) report('binding_type', 'Connection representation does not match its output.', to.id, input.id, true);
    const destinationScope = scopes.get(to.scopeId);
    const sourceEntry = catalogByKey.get(from.catalogKey);
    if (!options.projection && destinationScope && sourceEntry && !sourceEntry.scopes.includes(destinationScope.kind) && from.payload.kind !== 'hole'
      && !['flow', 'flow-inputs', 'logic-entry', 'document'].includes(to.payload.kind)) report('scope_mismatch', 'The connected block is unavailable in the destination scope.', to.id, input.id, true);
    if (options.projection) continue;
    if (output.type.representation === 'stream' && input.type.representation === 'stream') continue;
    const unchanged = to.provenance === 'lifted' && from.origins[0] === to.origins[0] + edge.binding && isUnchanged(from);
    if (unchanged && from.scopeId === to.scopeId) continue;
    const actual = actualOutput(from) ?? output.type;
    const destinationScopeId = ['document', 'flow', 'flow-inputs', 'logic-entry'].includes(to.payload.kind) ? input.type.scopeId ?? to.scopeId : to.scopeId;
    const expected = inputType({ ...to, scopeId: destinationScopeId }, edge.binding, input.type, descriptions.get(to.id)?.get(edge.binding)?.kind);
    const sameScope = scopesCompatible(actual, expected, graph.scopes);
    const match = portsCompatible(actual, expected, graph.scopes);
    if (!match.compatible && (!unchanged || !sameScope)) report(sameScope ? 'binding_type' : 'scope_mismatch', match.reason!, to.id, input.id, true);
  }
  for (const node of graph.nodes) {
    if (!scopes.has(node.scopeId)) report('invalid_reference', 'Block scope is missing.', node.id, undefined, true);
    const ids = new Set<string>();
    for (const input of node.inputs) ids.add(input.id);
    for (const output of node.outputs) ids.add(`out:${output.id}`);
    if (ids.size !== node.inputs.length + node.outputs.length) report('duplicate_id', 'Port IDs must be unique.', node.id);
    if (node.payload.kind !== 'opaque') {
      const expected = descriptions.get(node.id)!;
      for (const binding of expected.keys()) {
        const matching = ports.get(node)?.bindings.get(binding) ?? node.inputs.filter(input => input.binding === binding);
        if (matching?.length !== 1 || !matching[0].required) report('missing_required', 'Each grammar child requires one named input.', node.id);
      }
      for (const input of node.inputs) if (input.binding === undefined || !expected.has(input.binding)) report('invalid_reference', 'Input binding is not a child of this grammar node.', node.id, input.id);
    }
    for (const input of node.inputs) {
      const count = incoming.get(`${node.id}:${input.id}`)?.length ?? 0;
      if (count > 1) report('occupied_input', 'An input accepts at most one connection.', node.id, input.id);
      if (!count && input.required) report('missing_required', 'A required input is disconnected.', node.id, input.id);
    }
    const scope = scopes.get(node.scopeId);
    const entry = catalogByKey.get(node.catalogKey);
    if (!options.projection && entry && scope && !entry.scopes.includes(scope.kind)) report('invalid_combination', `This block is not available in ${scope.kind} scope.`, node.id, undefined, true);
    if (entry?.disabledReason) report('recipe_disabled', entry.disabledReason, node.id, undefined, true);
    if (node.payload.kind === 'opaque') {
      const original = originalAt(node.payload.pointer);
      if (node.inputs.length || node.provenance !== 'opaque' || original === undefined
        || fingerprint(node.payload.value) !== fingerprint(original)) report('opaque_region', 'An opaque region cannot be edited or interpreted.', node.id);
    }
  }
  const active = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { report('cycle', 'Connections cannot contain a cycle.', id); return; }
    if (active.size >= 40) { report('limit_exceeded', 'Graph exceeds the existing JSON depth boundary.', id); return; }
    if (visited.has(id)) return;
    active.add(id);
    dependencies.get(id)?.forEach(edge => visit(edge.from.nodeId));
    active.delete(id); visited.add(id);
  };
  graph.nodes.forEach(node => visit(node.id));
  if (!graph.roots.length) report('missing_required', 'A graph must have an output.');
  for (const root of graph.roots) {
    const rootNode = nodes.get(root.nodeId), output = rootNode && (ports.get(rootNode)?.outputs.get(root.portId) ?? rootNode.outputs.find(port => port.id === root.portId));
    if (!output) report('invalid_reference', 'Output block or port is missing.', root.nodeId, root.portId);
    else if (!options.projection) {
      const actual = actualOutput(nodes.get(root.nodeId)!) ?? output.type;
      if (actual.valueType !== 'unresolved' && root.destination.type && !portsCompatible(actual, root.destination.type).compatible) report('binding_type', 'The output does not fit its destination.', root.nodeId, root.portId, true);
    }
  }
  return errors;
}
