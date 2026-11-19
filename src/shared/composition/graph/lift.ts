import type { Json } from '../../types';
import { assertCompositionBounds } from '../json';
import { parseCompositionJSON } from '../json';
import { z } from 'zod/v4';
import { requestShape } from '../pipeline/sources';
import { elementOf, type Shape } from '../pipeline/shape';
import { newFacts, typeSteps, type TypeScope } from '../pipeline/typing';
import { describeGrammar, inferFragment, type FragmentKind } from './grammar';
import { atPointer, copy, copyShape, fingerprint, record, segments, withoutCanvasMetadata } from './json';
import { autoLayout } from './layout';
import { expressionPort, expressionScope, inputType, outputPort, portType } from './ports';
import { graphSourceSchema, typingSteps } from './capabilities';
import type { GraphDestination, GraphDiagnostic, GraphEdge, GraphNode, GraphScope, GraphSourceLocation, LiftResult, LogicAnchor, LogicGraph, OpaqueRegion, PortType, StudioCanvasMetadata } from './types';

export interface LiftOptions {
  readonly anchor?: LogicAnchor;
  readonly kind?: FragmentKind;
  readonly metadata?: unknown;
  readonly scope?: GraphScope;
  readonly context?: GraphDestination['context'];
  readonly sourceId?: string;
}
export function liftJSON(bytes: Uint8Array, options: LiftOptions = {}): LiftResult {
  return lift(z.json().parse(parseCompositionJSON(bytes)), options);
}
export function lift(ast: Json, options: LiftOptions = {}): LiftResult {
  assertCompositionBounds(ast);
  const original = copy(ast);
  const kind = inferFragment(ast, options.kind);
  const anchor = options.anchor ?? { kind: 'document', id: 'document', field: '', fingerprint: fingerprint(kind === 'document' ? withoutCanvasMetadata(original) : original) };
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], sourceMap: GraphSourceLocation[] = [], opaqueRegions: OpaqueRegion[] = [], warnings: GraphDiagnostic[] = [];
  const nodeIds = new Set<string>();
  const scopes: GraphScope[] = [options.scope ?? { id: 'document', kind: 'document' }];
  const ensureScope = (scope: GraphScope) => { if (!scopes.some(held => held.id === scope.id)) scopes.push(scope); };
  const scopeFor = (at: string, inherited: string): string => {
    const path = segments(at);
    for (let depth = path.length; depth >= 0; depth--) {
      const base = depth ? '/' + path.slice(0, depth).map(segment => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '';
      const owner = atPointer(original, base);
      if (record(owner) && owner.type === 'source' && record(owner.x) && Object.hasOwn(owner, 'y')) {
        const id = `chart:${base}`;
        ensureScope({ id, kind: 'repeat', parentId: inherited });
        return id;
      }
      if (record(owner) && owner.type === 'repeat') {
        const relative = path.slice(depth);
        if (relative[0] !== 'children') continue;
        const id = `repeat:${base}`, placeholder = relative[1] !== '0';
        const selected = placeholder ? `${id}:placeholder` : id;
        ensureScope({ id: selected, kind: placeholder ? 'placeholder' : 'repeat', parentId: inherited });
        return selected;
      }
    }
    return inherited;
  };
  const visit = (value: Json, hint: FragmentKind, at: string, inherited: string, typing: TypeScope): GraphNode => {
    const description = describeGrammar(value, hint), baseId = liftedId(at, at === '' && hint === 'document' ? withoutCanvasMetadata(value) : value);
    let id = baseId, collision = 0;
    while (nodeIds.has(id)) id = `${baseId}-${++collision}`;
    nodeIds.add(id);
    let scopeId = scopeFor(at, inherited);
    if (description.payload.kind === 'logic-entry') {
      scopeId = `template:${description.payload.value.id}`;
      ensureScope({ id: scopeId, kind: 'template', parentId: inherited, ownerNodeId: id });
    }
    if (description.payload.kind === 'flow') {
      scopeId = `flow:${description.payload.value.id}`;
      ensureScope({ id: scopeId, kind: 'flow', parentId: inherited, ownerNodeId: id });
    }
    const payload = description.payload.kind === 'opaque' ? { ...description.payload, pointer: at } : description.payload;
    const portScope = expressionScope(value, scopeId, scopes);
    let type = expressionPort(value, hint === 'condition' || payload.kind === 'condition' || payload.kind === 'logic-ref' && payload.representation === 'condition', typing, portScope);
    if (!['operand', 'condition', 'logic-ref', 'hole'].includes(payload.kind)) type = portType({ kind: 'object', fields: {} }, 'stream');
    if (hint === 'source-selection' || payload.kind === 'source-selection') type = { ...portType({ kind: 'string' }, 'source-selection', portScope), valueType: 'entity' };
    let node: GraphNode = { id, catalogKey: description.key, payload, inputs: [], outputs: [outputPort(type)], scopeId, origins: [at], provenance: payload.kind === 'opaque' ? 'opaque' : 'lifted' };
    const index = nodes.length;
    nodes.push(node); sourceMap.push({ pointer: at, nodeId: id, portId: 'value', anchor });
    if (payload.kind === 'opaque') {
      opaqueRegions.push({ nodeId: id, pointer: at, original: copy(value), reason: payload.reason });
      warnings.push({ severity: 'warning', code: 'opaque_region', message: payload.reason, anchor, nodeId: id, pointer: at });
    }
    const flow = graphSourceSchema.safeParse(value);
    const inputs = flow.success ? flow.data.inputs : undefined;
    const flowTyping: TypeScope = inputs ? { params: new Map(inputs.parameters.map(parameter => [parameter.name, parameter.type])), allowRead: false, allowViewer: false } : typing;
    for (const child of description.children) {
      let childScope = scopeId, childTyping = flowTyping;
      const childAt = at + child.binding;
      if (payload.kind === 'flow' && inputs) {
        // The inputs structural node owns its own parameter/request/step scopes.
        childTyping = flowTyping;
      }
      if (payload.kind === 'flow-inputs') {
        const step = /^\/steps\/(\d+)$/.exec(child.binding);
        const kind = step ? 'flow-step' : child.binding === '/request' ? 'flow-request' : child.binding === '/output' ? 'flow-output' : 'flow-parameter';
        childScope = `${scopeId}:${at}${child.binding}`;
        const owning = graphSourceSchema.safeParse(atPointer(original, at.slice(0, -'/inputs'.length)));
        let item: Shape | undefined;
        if (owning.success) {
          const own = owning.data.inputs;
          const start = own.request.type === 'none' ? copyShape(expressionPort(own.request.value, false, flowTyping).shape) : requestShape(own.request);
          const shapes = [start, ...typeSteps(typingSteps(own.steps), start, flowTyping.params, '', newFacts())];
          const current = step ? shapes[Number(step[1])] : shapes.at(-1)!;
          item = kind === 'flow-step' || kind === 'flow-output' ? elementOf(current) ?? current : undefined;
        }
        ensureScope({ id: childScope, kind, parentId: scopeId, ownerNodeId: id, ...(item ? { itemShape: item } : {}) });
        childTyping = { ...flowTyping, item, allowRead: kind === 'flow-parameter', allowViewer: kind === 'flow-parameter' || kind === 'flow-request' };
      }
      const inner = visit(child.value, child.kind, childAt, childScope, childTyping);
      const actual = inner.outputs[0].type;
      const input = { id: child.binding, label: child.binding, type: inputType({ ...node, scopeId: inner.scopeId }, child.binding, actual, child.kind), required: true, binding: child.binding };
      node = { ...node, inputs: [...node.inputs, input] };
      edges.push({ id: `edge-${edges.length + 1}`, kind: actual.representation, from: { nodeId: inner.id, portId: 'value' }, to: { nodeId: id, portId: input.id }, binding: child.binding });
      sourceMap.push({ pointer: childAt, nodeId: id, portId: input.id, anchor });
    }
    // Computed values carry the shape of the complete original, not the placeholder skeleton.
    nodes[index] = node;
    return node;
  };
  const root = visit(ast, kind, '', scopes[0].id, { params: new Map(), allowRead: true, allowViewer: true, ...(scopes[0].itemShape ? { item: copyShape(scopes[0].itemShape) } : {}) });
  const destination = kind === 'call' ? 'call' : kind === 'condition' ? 'condition' : kind === 'operand' ? 'operand' : kind === 'flow' || kind === 'flow-inputs' ? 'flow' : kind === 'slot' ? 'slot' : kind === 'fragment' ? 'fragment' : 'document';
  let graph: LogicGraph = { version: 1, nodes, edges, roots: [{ nodeId: root.id, portId: 'value', anchor, destination: { kind: destination, ...(options.context ? { context: options.context } : {}), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }) } }], scopes, frames: [], original };
  const rawMetadata = options.metadata !== undefined ? options.metadata : record(ast) ? ast.studioCanvas : undefined;
  if (rawMetadata !== undefined) {
    const metadata = rawMetadata;
    const valid = isMetadata(metadata);
    if (!valid) warnings.push({ severity: 'warning', code: 'invalid_layout', message: "Saved layout can't be used.", anchor, pointer: '/studioCanvas' });
    else {
      const candidates = metadata.canvases.filter(canvas => canvas.roots.some(root => fingerprint(root) === fingerprint(anchor)));
      const canvas = candidates.length === 1 ? candidates[0] : undefined;
      if (candidates.length > 1) warnings.push({ severity: 'warning', code: 'invalid_layout', message: 'Ambiguous saved canvas association ignored.', anchor, pointer: '/studioCanvas' });
      const used = new Set<string>();
      graph = { ...graph, nodes: graph.nodes.map(node => {
        const matches = canvas?.nodes.filter(saved => saved.id === node.id && saved.origins.length === node.origins.length && saved.origins.every((origin, i) => origin === node.origins[i])) ?? [];
        if (matches.length !== 1 || used.has(matches[0].id)) {
          if (matches.length > 1) warnings.push({ severity: 'warning', code: 'invalid_layout', message: 'Ambiguous saved layout association ignored.', anchor, nodeId: node.id, pointer: node.origins[0] });
          return node;
        }
        used.add(matches[0].id);
        return { ...node, position: { x: matches[0].x, y: matches[0].y } };
      }) };
      if (canvas?.nodes.some(saved => !used.has(saved.id))) warnings.push({ severity: 'warning', code: 'invalid_layout', message: 'Stale or ambiguous saved layout associations ignored.', anchor, pointer: '/studioCanvas' });
    }
  }
  return { graph: autoLayout(graph), sourceMap, opaqueRegions, warnings };
}
function liftedId(pointer: string, value: Json): string {
  const text = pointer + '\0' + fingerprint(value);
  let first = 2166136261, second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(i);
  }
  return `lift-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}
function isMetadata(value: unknown): value is StudioCanvasMetadata {
  return metadataSchema.safeParse(value).success;
}
const pointerSchema = z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/);
const ownerAnchor = {
  id: z.string().min(1), nodeId: z.string().min(1).optional(), field: pointerSchema,
};
const anchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...ownerAnchor, kind: z.enum(['page', 'modal', 'component', 'logic', 'flow']) }),
  z.strictObject({ id: ownerAnchor.id, field: pointerSchema, kind: z.literal('document'), fingerprint: z.string().min(1) }),
]);
const metadataSchema = z.strictObject({
  version: z.literal(1),
  canvases: z.array(z.strictObject({
    id: z.string().min(1), roots: z.array(anchorSchema),
    nodes: z.array(z.strictObject({ id: z.string().min(1), origins: z.array(pointerSchema), x: z.number(), y: z.number() })),
    viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number().positive() }).optional(),
    groups: z.array(z.strictObject({ id: z.string(), label: z.string(), nodeIds: z.array(z.string()) })).optional(),
  })),
  bundles: z.array(z.strictObject({ id: z.string(), name: z.string(), outputs: z.array(z.strictObject({ name: z.string(), logicId: z.string() })) })).optional(),
});
