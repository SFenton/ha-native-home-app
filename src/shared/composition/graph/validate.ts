import { catalogByKey } from './catalog';
import { atPointer, copy, copyShape, fingerprint, replaceAt } from './json';
import { expressionPort, inputType, portsCompatible } from './ports';
import { describeGrammar, type FragmentKind } from './grammar';
import type { Json } from '../../types';
import type { GraphDiagnostic, GraphEdge, GraphNode, LogicGraph } from './types';
import { assertCompositionBounds, CompositionValidationError } from '../json';

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
  const report = (code: GraphDiagnostic['code'], message: string, nodeId?: string, portId?: string) => {
    errors.push({ severity: 'error', code, message, anchor, nodeId, portId, pointer: graph.nodes.find(node => node.id === nodeId)?.origins[0] ?? '' });
  };
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (nodes.size !== graph.nodes.length) report('duplicate_id', 'Block IDs must be unique.');
  if (new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) report('duplicate_id', 'Connection IDs must be unique.');
  const scopes = new Map(graph.scopes.map(scope => [scope.id, scope]));
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
      const edges = graph.edges.filter(edge => edge.to.nodeId === id && edge.to.portId === input.id);
      if (edges.length !== 1) continue;
      const child = assemble(edges[0].from.nodeId, depth + 1);
      if (child === undefined || atPointer(value, input.binding) === undefined) continue;
      value = replaceAt(value, input.binding, child);
    }
    assembling.delete(id); assembled.set(id, value);
    return value;
  };
  const actualOutput = (node: GraphNode) => {
    const output = node.outputs[0]?.type;
    if (!output) return undefined;
    const current = assemble(node.id), scope = scopes.get(node.scopeId);
    const owner = scope?.ownerNodeId ? nodes.get(scope.ownerNodeId) : undefined;
    const params = owner?.payload.kind === 'flow-inputs' ? new Map(owner.payload.value.parameters.map(parameter => [parameter.name, parameter.type])) : new Map();
    return current !== undefined && (node.payload.kind === 'operand' || node.payload.kind === 'condition')
      ? expressionPort(current, node.payload.kind === 'condition', { params, allowRead: true, allowViewer: true, ...(scope?.itemShape ? { item: copyShape(scope.itemShape) } : {}) }, output.scopeId) : output;
  };
  if (scopes.size !== graph.scopes.length) report('duplicate_id', 'Scope IDs must be unique.');
  for (const scope of graph.scopes) {
    const seen = new Set([scope.id]);
    let parent = scope.parentId;
    while (parent) {
      if (seen.has(parent)) { report('cycle', 'Lexical scopes cannot contain a cycle.'); break; }
      seen.add(parent);
      if (!scopes.has(parent)) { report('invalid_reference', 'Unknown parent scope.'); break; }
      parent = scopes.get(parent)?.parentId;
    }
  }
  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from.nodeId), to = nodes.get(edge.to.nodeId);
    const output = from?.outputs.find(port => port.id === edge.from.portId);
    const input = to?.inputs.find(port => port.id === edge.to.portId);
    if (!from || !to || !output || !input) { report('invalid_reference', 'Connection names a missing block or port.', edge.to.nodeId, edge.to.portId); continue; }
    const key = `${to.id}:${input.id}`;
    incoming.set(key, [...incoming.get(key) ?? [], edge]);
    if (edge.binding !== input.binding) report('invalid_reference', 'Connection binding does not match the input.', to.id, input.id);
    if (edge.kind !== output.type.representation) report('binding_type', 'Connection representation does not match its output.', to.id, input.id);
    const destinationScope = scopes.get(to.scopeId);
    const sourceEntry = catalogByKey.get(from.catalogKey);
    if (!options.projection && destinationScope && sourceEntry && !sourceEntry.scopes.includes(destinationScope.kind) && from.payload.kind !== 'hole'
      && !['flow', 'flow-inputs', 'logic-entry', 'document'].includes(to.payload.kind)) report('scope_mismatch', 'The connected block is unavailable in the destination scope.', to.id, input.id);
    // Existing accepted grammar is losslessly retained, including unresolved types.
    // New or edited wiring must prove its destination type; a live sample never suffices.
    const original = atPointer(graph.original, to.origins[0] + edge.binding);
    const fromOriginal = atPointer(graph.original, from.origins[0]);
    const current = assemble(from.id);
    const unchanged = (from.provenance === 'lifted' || from.provenance === 'opaque') && to.provenance === 'lifted'
      && from.origins[0] === to.origins[0] + edge.binding
      && original !== undefined && fromOriginal !== undefined
      && current !== undefined && fingerprint(current) === fingerprint(fromOriginal);
    const actual = actualOutput(from) ?? output.type;
    const match = portsCompatible(actual, inputType(to, edge.binding, input.type));
    if (!match.compatible && !unchanged) report(actual.scopeId && actual.scopeId !== input.type.scopeId ? 'scope_mismatch' : 'binding_type', match.reason!, to.id, input.id);
    if (output.type.scopeId && output.type.scopeId !== input.type.scopeId) report('scope_mismatch', 'Item-scoped values cannot leave their scope.', to.id, input.id);
  }
  for (const node of graph.nodes) {
    if (!scopes.has(node.scopeId)) report('invalid_reference', 'Block scope is missing.', node.id);
    const ids = [...node.inputs, ...node.outputs.map(port => ({ ...port, id: `out:${port.id}` }))].map(port => port.id);
    if (new Set(ids).size !== ids.length) report('duplicate_id', 'Port IDs must be unique.', node.id);
    if (node.payload.kind !== 'opaque') {
      const kind: FragmentKind = node.payload.kind === 'template' || node.payload.kind === 'logic-ref' ? node.payload.representation
        : node.payload.kind === 'hole' ? 'auto' : node.payload.kind;
      const expected = new Set(describeGrammar(copy(node.payload.value), kind).children.map(child => child.binding));
      for (const binding of expected) {
        const ports = node.inputs.filter(input => input.binding === binding);
        if (ports.length !== 1 || !ports[0].required) report('missing_required', 'Each grammar child requires one named input.', node.id);
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
    if (!options.projection && entry && scope && !entry.scopes.includes(scope.kind)) report('invalid_combination', `This block is not available in ${scope.kind} scope.`, node.id);
    if (entry?.disabledReason) report('recipe_disabled', entry.disabledReason, node.id);
    if (node.payload.kind === 'opaque') {
      if (node.inputs.length || node.provenance !== 'opaque' || atPointer(graph.original, node.payload.pointer) === undefined
        || fingerprint(node.payload.value) !== fingerprint(atPointer(graph.original, node.payload.pointer)!)) report('opaque_region', 'An opaque region cannot be edited or interpreted.', node.id);
    }
  }
  const active = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { report('cycle', 'Connections cannot contain a cycle.', id); return; }
    if (active.size >= 40) { report('limit_exceeded', 'Graph exceeds the existing JSON depth boundary.', id); return; }
    if (visited.has(id)) return;
    active.add(id);
    graph.edges.filter(edge => edge.to.nodeId === id).forEach(edge => visit(edge.from.nodeId));
    active.delete(id); visited.add(id);
  };
  graph.nodes.forEach(node => visit(node.id));
  if (!graph.roots.length) report('missing_required', 'A graph must have an output.');
  for (const root of graph.roots) {
    const output = nodes.get(root.nodeId)?.outputs.find(port => port.id === root.portId);
    if (!output) report('invalid_reference', 'Output block or port is missing.', root.nodeId, root.portId);
    else {
      const actual = actualOutput(nodes.get(root.nodeId)!) ?? output.type;
      if (actual.valueType !== 'unresolved' && root.destination.type && !portsCompatible(actual, root.destination.type).compatible) report('binding_type', 'The output does not fit its destination.', root.nodeId, root.portId);
    }
  }
  return errors;
}
