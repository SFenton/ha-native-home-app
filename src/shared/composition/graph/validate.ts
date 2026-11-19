import { catalogByKey } from './catalog';
import { atPointer, copy, copyShape, fingerprint, record, replaceAt, sameJSON } from './json';
import { expressionPort, expressionScope, inputType, portsCompatible, scopesCompatible } from './ports';
import { expressionChildren, grammarChildren, type FragmentKind } from './grammar';
import type { Json } from '../../types';
import type { GraphDiagnostic, GraphEdge, GraphJSON, GraphNode, GraphPort, LogicGraph, PortType } from './types';
import { assertCompositionBounds, CompositionValidationError } from '../json';
import { elementOf, type Shape } from '../pipeline/shape';
import { requestShape } from '../pipeline/sources';
import { newFacts, typeOperand, typeStep, type TypeScope } from '../pipeline/typing';
import { requestSchema } from '../pipeline/schema';
import { graphInputsSchema, graphStepSchema } from './capabilities';

function readonlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = {
    get size() { return map.size; },
    get: key => map.get(key), has: key => map.has(key),
    keys: () => map.keys(), values: () => map.values(), entries: () => map.entries(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
    forEach: (callback, receiver) => { for (const [key, value] of map) callback.call(receiver, value, key, view); },
  };
  return Object.freeze(view);
}
const constructionSeal = Symbol('immutable graph data');
const constructionAuthority = Symbol();
class ConstructionSeal {
  readonly #value: object;
  readonly #batch: Readonly<{ complete: boolean }>;
  constructor(value: object, batch: Readonly<{ complete: boolean }>, authority: typeof constructionAuthority) {
    if (authority !== constructionAuthority) throw new TypeError('Graph construction seals are private.');
    this.#value = value;
    this.#batch = batch;
    Object.freeze(this);
  }
  static holds(value: object): boolean {
    const seal: unknown = Object.getOwnPropertyDescriptor(value, constructionSeal)?.value;
    return seal instanceof ConstructionSeal && #value in seal && seal.#value === value && seal.#batch.complete;
  }
}
Object.freeze(ConstructionSeal.prototype);
Object.freeze(ConstructionSeal);
function freezeRevision(graph: LogicGraph): void {
  if (ConstructionSeal.holds(graph)) return;
  const seen = new Set<object>(), pending: object[] = [graph], created: object[] = [];
  while (pending.length) {
    const value = pending.pop()!;
    if (ConstructionSeal.holds(value) || seen.has(value)) continue;
    seen.add(value);
    created.push(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const child: unknown = value[i];
        if (child !== null && typeof child === 'object') pending.push(child);
      }
    } else for (const key of Object.getOwnPropertyNames(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') pending.push(child);
    }
  }
  const batch = { complete: false };
  for (let i = created.length - 1; i >= 0; i--) {
    const value = created[i];
    if (Object.isExtensible(value)) Object.defineProperty(value, constructionSeal, { value: new ConstructionSeal(value, batch, constructionAuthority) });
    Object.freeze(value);
  }
  // Cycles and shared children become trusted only after the whole batch is frozen.
  batch.complete = true;
  Object.freeze(batch);
}
/** Constructs immutable data once; later revisions reuse sealed nodes and payloads. */
export function constructGraphRevision(graph: LogicGraph): LogicGraph {
  if (ConstructionSeal.holds(graph)) return graph;
  const revision = Object.isExtensible(graph) ? graph : { ...graph };
  freezeRevision(revision);
  if (revision !== graph) Object.freeze(graph);
  return revision;
}
function sameUnboundJSON(left: GraphJSON, right: GraphJSON, bindings: ReadonlyMap<string | undefined, readonly GraphPort[]>, at = ''): boolean {
  if (left === right || bindings.has(at)) return true;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i] && !sameUnboundJSON(left[i], right[i], bindings, `${at}/${i}`)) return false;
    return true;
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key)) return false;
    if (left[key] === right[key]) continue;
    const encoded = key.includes('~') || key.includes('/') ? key.replace(/~/g, '~0').replace(/\//g, '~1') : key;
    if (!sameUnboundJSON(left[key], right[key], bindings, `${at}/${encoded}`)) return false;
  }
  return true;
}
class RevisionIndex {
  readonly #graph: LogicGraph;
  readonly #graphs: WeakSet<LogicGraph>;
  readonly #immutable: boolean;
  readonly #nodes = new Map<string, GraphNode>();
  readonly #incoming = new Map<string, Map<string, GraphEdge[]>>();
  readonly #dependencies = new Map<string, GraphEdge[]>();
  readonly #bindings = new Map<GraphNode, Map<string | undefined, GraphPort[]>>();
  readonly #wide = new Map<GraphNode, { inputs: Map<string, GraphPort>; outputs: Map<string, GraphPort>; scopes: Map<string | undefined, string | undefined> }>();
  readonly #children = new Map<GraphNode, readonly ReturnType<typeof grammarChildren>[number][]>();
  readonly #empty: readonly never[] = Object.freeze([]);
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly incomingNodes: ReadonlyMap<string, readonly GraphEdge[]>;
  constructor(graph: LogicGraph, immutable = false) {
    if (immutable) freezeRevision(graph);
    this.#immutable = immutable;
    this.#graph = graph;
    this.#graphs = new WeakSet([graph]);
    for (const node of graph.nodes) {
      this.#nodes.set(node.id, node);
      if (node.inputs.length > 8 || node.outputs.length > 8) {
        const inputs = new Map<string, GraphPort>(), outputs = new Map<string, GraphPort>(), scopes = new Map<string | undefined, string | undefined>();
        for (const input of node.inputs) {
          if (!inputs.has(input.id)) inputs.set(input.id, input);
          if (!scopes.has(input.type.scopeId)) scopes.set(input.type.scopeId, input.binding);
        }
        for (const output of node.outputs) if (!outputs.has(output.id)) outputs.set(output.id, output);
        this.#wide.set(node, { inputs, outputs, scopes });
      }
      if (!node.inputs.length) continue;
      const bindings = new Map<string | undefined, GraphPort[]>();
      for (const input of node.inputs) {
        let group = bindings.get(input.binding);
        if (!group) bindings.set(input.binding, group = []);
        group.push(input);
      }
      for (const group of bindings.values()) Object.freeze(group);
      this.#bindings.set(node, bindings);
    }
    for (const edge of graph.edges) {
      let ports = this.#incoming.get(edge.to.nodeId), edges = ports?.get(edge.to.portId), dependencies = this.#dependencies.get(edge.to.nodeId);
      if (!ports) this.#incoming.set(edge.to.nodeId, ports = new Map());
      if (!edges) ports.set(edge.to.portId, edges = []);
      if (!dependencies) this.#dependencies.set(edge.to.nodeId, dependencies = []);
      edges.push(edge); dependencies.push(edge);
    }
    for (const ports of this.#incoming.values()) for (const edges of ports.values()) Object.freeze(edges);
    for (const edges of this.#dependencies.values()) Object.freeze(edges);
    this.nodes = readonlyMap(this.#nodes);
    this.incomingNodes = readonlyMap(this.#dependencies);
    Object.freeze(this);
  }
  static matches(candidate: RevisionIndex, graph: LogicGraph): boolean {
    return candidate instanceof RevisionIndex && #graphs in candidate && Object.getPrototypeOf(candidate) === RevisionIndex.prototype && candidate.#immutable && candidate.#graphs.has(graph);
  }
  get graph(): LogicGraph { return this.#graph; }
  get nodeCount(): number { return this.#nodes.size; }
  node(id: string): GraphNode | undefined { return this.#nodes.get(id); }
  incoming(nodeId: string, portId: string): readonly GraphEdge[] { return this.#incoming.get(nodeId)?.get(portId) ?? this.#empty; }
  dependencies(nodeId: string): readonly GraphEdge[] { return this.#dependencies.get(nodeId) ?? this.#empty; }
  matchingInputs(node: GraphNode, binding: string): readonly GraphPort[] { return this.#bindings.get(node)?.get(binding) ?? this.#empty; }
  port(node: GraphNode, id: string, direction: 'input' | 'output'): GraphPort | undefined {
    const wide = this.#wide.get(node);
    if (wide) return wide[direction === 'input' ? 'inputs' : 'outputs'].get(id);
    for (const port of node[direction === 'input' ? 'inputs' : 'outputs']) if (port.id === id) return port;
    return undefined;
  }
  scopeBinding(node: GraphNode, scopeId: string | undefined): string | undefined {
    const wide = this.#wide.get(node);
    if (wide) return wide.scopes.get(scopeId);
    for (const input of node.inputs) if (input.type.scopeId === scopeId) return input.binding;
    return undefined;
  }
  sameUnbound(node: GraphNode, original: GraphJSON): boolean {
    const bindings = this.#bindings.get(node);
    return bindings ? sameUnboundJSON(node.payload.value, original, bindings) : sameJSON(node.payload.value, original);
  }
  children(node: GraphNode): readonly ReturnType<typeof grammarChildren>[number][] {
    if (node.payload.kind === 'source-selection' || record(node.payload.value) && 'type' in node.payload.value
      && (node.payload.value.type === 'hole' || node.payload.value.type === 'literal' && (node.payload.kind === 'operand' || node.payload.kind === 'condition'))) return this.#empty;
    let children = this.#children.get(node);
    if (!children) {
      const kind: FragmentKind = node.payload.kind === 'template' || node.payload.kind === 'logic-ref' ? node.payload.representation
        : node.payload.kind === 'hole' || node.payload.kind === 'opaque' ? 'auto' : node.payload.kind;
      const value = node.payload.value;
      const descriptors = (kind === 'operand' || kind === 'condition') && record(value) && 'type' in value && (value.type === 'math' || value.type === 'item')
        ? expressionChildren(value, kind) : grammarChildren(value, kind);
      children = Object.freeze(descriptors.map(child => Object.freeze(child)));
      this.#children.set(node, children);
    }
    return children;
  }
}
Object.freeze(RevisionIndex.prototype);
Object.freeze(RevisionIndex);
export type GraphRevisionIndex = RevisionIndex;
export function prepareGraphRevision(graph: LogicGraph): GraphRevisionIndex { return new RevisionIndex(graph, true); }
function revisionIndex(graph: LogicGraph, prepared?: GraphRevisionIndex): GraphRevisionIndex {
  if (prepared === undefined) return new RevisionIndex(graph);
  if (!RevisionIndex.matches(prepared, graph)) throw new TypeError('Expected indexes for this exact immutable graph revision.');
  return prepared;
}
class ValidatedGraph {
  readonly #graph: LogicGraph;
  readonly #states: WeakMap<LogicGraph, { readonly graph: LogicGraph; readonly diagnostics: readonly GraphDiagnostic[]; readonly index: GraphRevisionIndex }>;
  constructor(graph: LogicGraph, prepared?: GraphRevisionIndex) {
    this.#graph = graph;
    const index = prepared === undefined ? prepareGraphRevision(graph) : revisionIndex(graph, prepared);
    const diagnostics = Object.freeze(validateGraph(graph, { index }).map(diagnostic => Object.freeze(diagnostic)));
    this.#states = new WeakMap([[graph, Object.freeze({ graph, diagnostics, index })]]);
    Object.freeze(this);
  }
  get graph(): LogicGraph { return this.#graph; }
  get diagnostics(): readonly GraphDiagnostic[] { return this.#states.get(this.#graph)!.diagnostics; }
  static read(candidate: ValidatedGraph): { graph: LogicGraph; diagnostics: readonly GraphDiagnostic[]; index: GraphRevisionIndex } {
    if (!(candidate instanceof ValidatedGraph) || !(#graph in candidate)) throw new TypeError('Expected an authentic graph validation handoff.');
    const state = candidate.#states.get(candidate.#graph);
    if (!state) throw new TypeError('Expected validation for this exact immutable graph revision.');
    return state;
  }
}
Object.freeze(ValidatedGraph.prototype);
Object.freeze(ValidatedGraph);
export type GraphValidation = ValidatedGraph;
/** Validates constructed immutable data, importing uncertified input before issuing a handoff. */
export function validateForLowering(graph: LogicGraph, index?: GraphRevisionIndex): GraphValidation {
  return new ValidatedGraph(graph, index);
}
export function readGraphValidation(validated: GraphValidation): { graph: LogicGraph; diagnostics: readonly GraphDiagnostic[]; index: GraphRevisionIndex } {
  return ValidatedGraph.read(validated);
}
export function validateGraph(graph: LogicGraph, options: { readonly projection?: boolean; readonly index?: GraphRevisionIndex } = {}): readonly GraphDiagnostic[] {
  try {
    assertCompositionBounds(graph.original);
    for (const node of graph.nodes) assertCompositionBounds(node.payload.value);
    return validateGraphChecked(graph, options, revisionIndex(graph, options.index));
  } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return error.issues.map(issue => ({
      severity: 'error', code: issue.code, pointer: issue.pointer, message: 'Graph exceeds the existing JSON resource/safety boundary.',
      anchor: graph.roots[0]?.anchor ?? { kind: 'document', id: 'document', field: '', fingerprint: '' },
    }));
  }
}
function validateGraphChecked(graph: LogicGraph, options: { readonly projection?: boolean }, index: GraphRevisionIndex): readonly GraphDiagnostic[] {
  const errors: GraphDiagnostic[] = [];
  const anchor = graph.roots[0]?.anchor ?? { kind: 'document' as const, id: 'document', field: '', fingerprint: fingerprint(graph.original) };
  let firstOrigins: Map<string, string> | undefined;
  const report = (code: GraphDiagnostic['code'], message: string, nodeId?: string, portId?: string, hint = false) => {
    if (hint && options.projection) return;
    if (nodeId !== undefined && !firstOrigins) {
      firstOrigins = new Map();
      for (const node of graph.nodes) if (!firstOrigins.has(node.id)) firstOrigins.set(node.id, node.origins[0] ?? '');
    }
    errors.push({ severity: hint ? 'warning' : 'error', ...(hint ? { hint: true as const } : {}), code, message: hint ? `Wiring hint: ${message}` : message, anchor, nodeId, portId, pointer: nodeId === undefined ? '' : firstOrigins!.get(nodeId) ?? '' });
  };
  const nodes = { get: (id: string) => index.node(id) };
  if (index.nodeCount !== graph.nodes.length) report('duplicate_id', 'Block IDs must be unique.');
  if (new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) report('duplicate_id', 'Connection IDs must be unique.');
  const scopes = new Map(graph.scopes.map(scope => [scope.id, scope]));
  const descriptions = new Map<string, ReadonlyMap<string, ReturnType<typeof grammarChildren>[number]>>(), emptyChildren = new Map<string, ReturnType<typeof grammarChildren>[number]>();
  for (const node of graph.nodes) {
    if (node.payload.kind === 'opaque') continue;
    const children = index.children(node), bindings = children.length ? new Map<string, typeof children[number]>() : emptyChildren;
    for (const child of children) if (!bindings.has(child.binding)) bindings.set(child.binding, child);
    descriptions.set(node.id, bindings);
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
      const key = own.slice(parent.length + 1);
      value = Array.isArray(value) ? Object.hasOwn(value, key) ? value[Number(key)] : undefined
        : record(value) && Object.hasOwn(value, key) ? value[key] : undefined;
      originalValues.set(own, value); parent = own;
    }
    return value;
  };
  const unchangedNodes = new Map<string, boolean>(), checkingUnchanged = new Set<string>();
  const isUnchanged = (node: GraphNode): boolean => {
    const cached = unchangedNodes.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.origins.length || node.provenance !== 'lifted' && node.provenance !== 'opaque') return false;
    if (!node.inputs.length) {
      const original = originalAt(node.origins[0]), unchanged = original !== undefined && sameJSON(node.payload.value, original);
      unchangedNodes.set(node.id, unchanged);
      return unchanged;
    }
    if (checkingUnchanged.has(node.id)) return false;
    checkingUnchanged.add(node.id);
    const original = originalAt(node.origins[0]);
    const unchanged = original !== undefined
      && index.sameUnbound(node, original)
      && node.inputs.every(input => {
        const edges = index.incoming(node.id, input.id), child = edges.length === 1 ? nodes.get(edges[0].from.nodeId) : undefined;
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
      const edges = index.incoming(id, input.id);
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
        const port = index.matchingInputs(owner, binding)[0];
        const edges = port ? index.incoming(owner.id, port.id) : undefined;
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
      const flow = typedFlows.get(owner.id), binding = index.scopeBinding(owner, scope?.id);
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
    const output = from && index.port(from, edge.from.portId, 'output');
    const input = to && index.port(to, edge.to.portId, 'input');
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
    if (node.inputs.length + node.outputs.length > 1) {
      const ids = new Set<string>();
      for (const input of node.inputs) ids.add(input.id);
      for (const output of node.outputs) ids.add(`out:${output.id}`);
      if (ids.size !== node.inputs.length + node.outputs.length) report('duplicate_id', 'Port IDs must be unique.', node.id);
    }
    if (node.payload.kind !== 'opaque') {
      const expected = descriptions.get(node.id)!;
      for (const binding of expected.keys()) {
        const matching = index.matchingInputs(node, binding);
        if (matching?.length !== 1 || !matching[0].required) report('missing_required', 'Each grammar child requires one named input.', node.id);
      }
      for (const input of node.inputs) if (input.binding === undefined || !expected.has(input.binding)) report('invalid_reference', 'Input binding is not a child of this grammar node.', node.id, input.id);
    }
    for (const input of node.inputs) {
      const count = index.incoming(node.id, input.id).length;
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
    for (const edge of index.dependencies(id)) visit(edge.from.nodeId);
    active.delete(id); visited.add(id);
  };
  graph.nodes.forEach(node => visit(node.id));
  if (!graph.roots.length) report('missing_required', 'A graph must have an output.');
  for (const root of graph.roots) {
    const rootNode = nodes.get(root.nodeId), output = rootNode && index.port(rootNode, root.portId, 'output');
    if (!output) report('invalid_reference', 'Output block or port is missing.', root.nodeId, root.portId);
    else if (!options.projection) {
      const actual = actualOutput(nodes.get(root.nodeId)!) ?? output.type;
      if (actual.valueType !== 'unresolved' && root.destination.type && !portsCompatible(actual, root.destination.type).compatible) report('binding_type', 'The output does not fit its destination.', root.nodeId, root.portId, true);
    }
  }
  return errors;
}
