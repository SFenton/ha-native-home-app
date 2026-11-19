import type { Json } from '../../shared/types';
import { z } from 'zod/v4';
import { lower, semanticFingerprint, type LowerOptions } from '../../shared/composition/graph/lower';
import type { GraphNode, GraphSourceLocation, LogicAnchor, LogicGraph, PortType, ReadCapture, SimulationPin } from '../../shared/composition/graph/types';
import { atPointer, copy, copyShape } from '../../shared/composition/graph/json';
import { expandLogic } from '../../shared/composition/logic-library';
import { operandSchema, predicateSchema, type Operand, type Predicate } from '../../shared/composition/expression';
import { textValue } from '../../shared/composition/slots';
import type { TextSlot } from '../../shared/composition/evaluator';
import { coerce } from '../../shared/composition/evaluator';
import { inferShape, isAssignable, pipelineInputsSchema, requestShape, typeOperand, typeSteps, newFacts, type PipelineInputs } from '../../shared/composition/pipeline';
import { portType } from '../../shared/composition/graph/ports';
import { canonicalCompositionJSON } from '../../shared/composition/json';
import { anchorKey, pinKey, pinSchema, readKey, sourceKey } from './contracts';

export type SimulationBody =
  | { kind: 'operand'; value: Operand }
  | { kind: 'condition'; value: Predicate }
  | { kind: 'slot'; value: TextSlot }
  | { kind: 'flow'; value: PipelineInputs; sourceId: string };
export interface SimulationRoot {
  readonly anchor: LogicAnchor;
  readonly name: string;
  readonly body: SimulationBody;
  readonly graph: LogicGraph;
  readonly sourceMap: readonly GraphSourceLocation[];
}
export interface SimulationProgram {
  readonly fingerprint: string;
  readonly roots: readonly SimulationRoot[];
  readonly flows: ReadonlyMap<string, PipelineInputs>;
  readonly reads: readonly Omit<ReadCapture, 'answer'>[];
  readonly viewerFields: ReadonlySet<'userId' | 'isAdmin' | 'personEntityId'>;
  readonly viewerPerson: boolean;
  readonly sourceEntities: Readonly<Record<string, string>>;
}
export const flowFingerprint = (inputs: PipelineInputs): string => canonicalCompositionJSON([inputs.request, inputs.parameters]);
export function walkJSON(value: unknown, visit: (value: Record<string, unknown>, pointer: string) => void, at = ''): void {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) visit(value as Record<string, unknown>, at);
  if ('type' in value && value.type === 'literal') return;
  Object.entries(value).forEach(([key, child]) => walkJSON(child, visit, `${at}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
}
/** Compile once per canonical edit, not once per streaming value. Invalid buffers remain explicit errors. */
export function createSimulationProgram(graphs: readonly LogicGraph[], options: LowerOptions & {
  readonly flows?: readonly { readonly id: string; readonly inputs: PipelineInputs }[];
  readonly names?: Readonly<Record<string, string>>;
  readonly sourceEntities?: Readonly<Record<string, string>>;
} = {}): SimulationProgram {
  const roots: SimulationRoot[] = [], flows = new Map((options.flows ?? []).map(flow => [flow.id, pipelineInputsSchema.parse(flow.inputs)]));
  const ids = new Set<string>();
  for (const graph of new Set(graphs)) for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new Error('Simulation requires canvas-wide unique block IDs across root graphs.');
    ids.add(node.id);
  }
  for (const graph of graphs) {
    const lowered = lower(graph, options);
    if (!lowered.ok) throw new Error(`Simulation requires valid logic: ${lowered.errors.map(error => `${error.code} at ${error.pointer || '/'}`).join(', ')}`);
    const values = graph.roots.length === 1 ? [lowered.ast] : Array.isArray(lowered.ast) ? lowered.ast : [];
    graph.roots.forEach((root, index) => {
      const ast = values[index];
      const expanded = options.library?.length ? z.object({ value: z.json() }).parse(expandLogic({ logicLibrary: options.library, value: ast }).document).value : ast;
      let body: SimulationBody;
      switch (root.destination.kind) {
        case 'operand': body = { kind: 'operand', value: operandSchema.parse(expanded) }; break;
        case 'condition': body = { kind: 'condition', value: predicateSchema.parse(expanded) }; break;
        case 'slot': body = { kind: 'slot', value: textValue(16384, true).parse(expanded) }; break;
        case 'flow': {
          const value = expanded && typeof expanded === 'object' && !Array.isArray(expanded) && 'inputs' in expanded ? expanded.inputs : expanded;
          const inputs = pipelineInputsSchema.parse(value);
          const sourceId = root.destination.sourceId ?? root.anchor.id;
          flows.set(sourceId, inputs);
          body = { kind: 'flow', value: inputs, sourceId }; break;
        }
        default: throw new Error(`Simulation of ${root.destination.kind} roots is not supported; open its typed output.`);
      }
      const prefix = body.kind === 'flow' && expanded && typeof expanded === 'object' && !Array.isArray(expanded) && 'inputs' in expanded ? '/inputs' : '';
      roots.push({ anchor: root.anchor, name: options.names?.[anchorKey(root.anchor)] ?? root.anchor.id, body, graph, sourceMap: lowered.sourceMap
        .filter(location => anchorKey(location.anchor) === anchorKey(root.anchor) && location.pointer.startsWith(prefix))
        .map(location => ({ ...location, pointer: location.pointer.slice(prefix.length) })) });
    });
  }
  const reads = new Map<string, Omit<ReadCapture, 'answer'>>();
  const viewerFields = new Set<'userId' | 'isAdmin' | 'personEntityId'>();
  let viewerPerson = false;
  const scan = (node: Record<string, unknown>) => {
    const sourceId = typeof node.sourceId === 'string' ? node.sourceId : undefined;
    if (sourceId && (node.type === 'raw-state' || node.type === 'last-changed')) {
      const capture = { sourceId, access: node.type as 'raw-state' | 'last-changed' }; reads.set(readKey(capture), capture);
    } else if (sourceId && (node.type === 'state' || node.type === 'numeric') && Array.isArray(node.path)) {
      const capture = { sourceId, path: node.path as string[] }; reads.set(readKey(capture), capture);
    }
    if ((node.type === 'read' || node.type === 'list-count' || node.type === 'list-includes') && node.from && typeof node.from === 'object') {
      const from = node.from as { sourceId: string; path: string[] };
      const capture = { sourceId: from.sourceId, path: from.path }; reads.set(readKey(capture), capture);
    }
    if (node.type === 'viewer') {
      if (node.field === 'userId' || node.field === 'isAdmin' || node.field === 'personEntityId') viewerFields.add(node.field);
      if (node.isAdmin !== undefined) viewerFields.add('isAdmin');
      if (node.userIds !== undefined) viewerFields.add('userId');
    }
    if (node.personEntityIds !== undefined) viewerFields.add('personEntityId');
    if (node.type === 'viewer-person') { viewerPerson = true; viewerFields.add('personEntityId'); }
  };
  roots.forEach(root => walkJSON(root.body.value, scan));
  flows.forEach(inputs => walkJSON(inputs, scan));
  return { fingerprint: canonicalCompositionJSON([graphs.map(semanticFingerprint), [...flows], options.sourceEntities ?? {}]), roots, flows, reads: [...reads.values()], viewerFields, viewerPerson, sourceEntities: options.sourceEntities ?? {} };
}
export function nodeFor(root: SimulationRoot, at: string): GraphNode | undefined {
  const locations = root.sourceMap.filter(location => location.pointer === at);
  const location = locations.reverse().find(entry => entry.stage === 'expanded') ?? locations[locations.length - 1];
  return root.graph.nodes.find(node => node.id === location?.nodeId);
}
export function pinProblems(program: SimulationProgram, candidates: readonly SimulationPin[]): string[] {
  const problems: string[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    const parsed = pinSchema.safeParse(candidate);
    if (!parsed.success) { problems.push('Invalid pin data.'); continue; }
    const pin = parsed.data, key = pinKey(pin);
    if (seen.has(key)) problems.push('Conflicting pins on the same target.');
    seen.add(key);
    const nodes = program.roots.flatMap(root => root.graph.nodes).filter(node => node.id === pin.blockId);
    if (!nodes.length) { problems.push(`Unresolved pin: ${pin.blockId}`); continue; }
    if (pin.kind === 'source') {
      const matching = nodes.some(node => {
        const source = sourceCaptureForNode(node, program);
        if (!source || readKey(source) !== readKey(pin)) return false;
        if (pin.answer.status !== 'value') return true;
        const value = projectedNodeValue(program, node);
        if ((pin.access && pin.access !== 'read' || program.sourceEntities[pin.sourceId] && pin.path?.length === 1 && pin.path[0] === 'state') && typeof pin.answer.value !== 'string') return false;
        if (value && typeof value === 'object' && !Array.isArray(value) && value.type === 'read') {
          const parsed = operandSchema.safeParse(value);
          return parsed.success && parsed.data.type === 'read' && coerce(pin.answer.value, parsed.data.as) !== undefined;
        }
        if (value && typeof value === 'object' && !Array.isArray(value) && value.type === 'numeric') return coerce(pin.answer.value, 'number') !== undefined;
        return typeof pin.answer.value === 'string';
      });
      if (!matching) problems.push(`Unresolved or wrongly typed source pin: ${pin.sourceId}`);
    } else {
      const node = nodes[0], port = node.outputs.find(port => port.id === pin.portId);
      const type = port && ['operand', 'condition', 'logic-ref', 'step', 'request'].includes(node.payload.kind) ? simulationPort(program, node, port.id) : undefined;
      if (!type || !resultFits(pin.result, type)) problems.push(`Unresolved or wrongly typed output pin: ${pin.blockId}.${pin.portId}`);
      if (program.roots.some(root => root.body.kind === 'flow' && root.graph.nodes.includes(node))
        && (pin.result.kind === 'condition' ? pin.result.answer === 'unknown' : pin.result.answer.status !== 'value')) {
        problems.push('Flow output pins require a value (null for a gap) or a Yes/No condition.');
      }
    }
  }
  return problems;
}
function resultFits(result: import('../../shared/composition/graph/types').SimulationResult, port: PortType): boolean {
  if (result.kind === 'condition') return port.representation === 'condition';
  if (port.representation === 'condition' || port.representation === 'source-selection') return false;
  if (result.answer.status !== 'value') return port.representation === 'operand';
  return isAssignable(inferShape(result.answer.value as Json), copyShape(port.shape));
}
function projectedNodeValue(program: SimulationProgram, node: GraphNode): Json {
  for (const root of program.roots) {
    if (!root.graph.nodes.includes(node)) continue;
    for (const location of root.sourceMap.filter(location => location.nodeId === node.id).sort((a, b) => a.pointer.length - b.pointer.length)) {
      const value = atPointer(root.body.value as Json, location.pointer);
      if (value !== undefined) return copy(value);
    }
  }
  return copy(node.payload.value);
}
export function sourceCaptureForNode(node: GraphNode, program: SimulationProgram): Omit<ReadCapture, 'answer'> | undefined {
  if (!['source-selection', 'operand', 'condition'].includes(node.payload.kind)) return undefined;
  const value = projectedNodeValue(program, node);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return node.payload.kind === 'source-selection' ? { sourceId: node.payload.value, path: ['state'] } : undefined;
  if (value.type === 'read' && value.from && typeof value.from === 'object' && !Array.isArray(value.from)) return { sourceId: String(value.from.sourceId), path: value.from.path as string[] };
  if (value.type === 'raw-state' || value.type === 'last-changed') return { sourceId: String(value.sourceId), access: value.type };
  if (value.type === 'state' || value.type === 'numeric') return { sourceId: String(value.sourceId), path: value.path as string[] };
  return undefined;
}
/** Structural graph sockets are hints; stream pin validation uses the native flow typer. */
export function simulationPort(program: SimulationProgram, node: GraphNode, portId = 'value'): PortType | undefined {
  const port = node.outputs.find(port => port.id === portId);
  if (!port) return undefined;
  for (const root of program.roots) {
    if (root.body.kind !== 'flow' || !root.graph.nodes.includes(node)) continue;
    const inputs = root.body.value, facts = newFacts();
    const params = new Map(inputs.parameters.map(parameter => [parameter.name, parameter.type]));
    const start = inputs.request.type === 'none' ? typeOperand(inputs.request.value, { params, allowRead: false, allowViewer: true }, '', facts) : requestShape(inputs.request);
    if (node.payload.kind === 'request') return portType(start, 'stream');
    const location = root.sourceMap.find(location => location.nodeId === node.id && /^\/steps\/\d+$/.test(location.pointer));
    if (location) {
      const index = Number(location.pointer.split('/')[2]);
      return portType(typeSteps(inputs.steps, start, params, '', facts)[index], 'stream');
    }
  }
  return port.type;
}
export function blockSources(program: SimulationProgram, node: GraphNode, pins: readonly SimulationPin[], scenario: boolean, clock: boolean, liveBlocks?: ReadonlySet<string>): ReadonlySet<'live' | 'scenario' | 'pin'> {
  const sources = new Set<'live' | 'scenario' | 'pin'>();
  const visited = new Set<string>();
  const visit = (own: GraphNode) => {
    if (visited.has(own.id)) return;
    visited.add(own.id);
    const source = sourceCaptureForNode(own, program);
    if (pins.some(pin => pin.kind === 'output' && pin.blockId === own.id || pin.kind === 'source' && source && sourceKey(pin) === sourceKey(source))) { sources.add('pin'); return; }
    if (source) {
      const explicitlyLive = program.roots.some(root => root.graph.nodes.some(candidate => liveBlocks?.has(candidate.id) && sourceKey(sourceCaptureForNode(candidate, program) ?? { sourceId: '' }) === sourceKey(source)));
      sources.add(scenario && !explicitlyLive ? 'scenario' : 'live'); return;
    }
    if (own.payload.kind === 'operand' && own.payload.value.type === 'clock') { sources.add(clock ? 'pin' : scenario ? 'scenario' : 'live'); return; }
    const upstream = program.roots.flatMap(root => root.graph.edges.filter(edge => edge.to.nodeId === own.id)
      .flatMap(edge => root.graph.nodes.filter(candidate => candidate.id === edge.from.nodeId)));
    upstream.forEach(visit);
    if (own.payload.kind === 'request') sources.add(scenario ? 'scenario' : 'live');
  };
  visit(node);
  if (!sources.size) sources.add(scenario ? 'scenario' : 'live');
  return sources;
}
export function blockMode(program: SimulationProgram, node: GraphNode, pins: readonly SimulationPin[], scenario: boolean, clock: boolean, liveBlocks?: ReadonlySet<string>): 'Live' | 'Simulated' | 'Mixed' {
  const sources = blockSources(program, node, pins, scenario, clock, liveBlocks);
  return sources.has('live') ? sources.size > 1 ? 'Mixed' : 'Live' : 'Simulated';
}
export { atPointer };
