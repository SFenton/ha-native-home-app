import fixture from '../../fixtures/composition-first-slice.json';
import { compositionDocumentSchema, type CompositionDocument } from '../../../src/shared/composition/schema';
import { demoHouse } from '../../../src/preview2/demo-house';
import { createEnvironment } from '../../../src/preview2/projections';
import { lift } from '../../../src/shared/composition/graph/lift';
import type { Json } from '../../../src/shared/types';
import type { Operand, Predicate } from '../../../src/shared/composition/expression';
import type { LogicGraph, SimulationCase, SimulationPin } from '../../../src/shared/composition/graph/types';
import type { PipelineInputs } from '../../../src/shared/composition/pipeline/schema';
import { arrayOf, todoItemShape } from '../../../src/shared/composition/pipeline';
import { captureScenario, type HeldSnapshot } from '../../../src/workspace2/logic-simulation/engine';
import { createSimulationProgram, flowFingerprint, sourceCaptureForNode } from '../../../src/workspace2/logic-simulation/program';
import { CHORES_RESPONSE, FIXTURE_CLOCK } from './data';
export { CHORES_RESPONSE, FIXTURE_CLOCK } from './data';

const read = (sourceId: string): Operand => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'number', missing: 'unavailable' });
function graph(value: Json, kind: 'operand' | 'condition' | 'flow', id: string): LogicGraph {
  const graph = lift(value, { kind, anchor: { kind: kind === 'flow' ? 'flow' : 'logic', id, field: kind === 'flow' ? '/inputs' : '/body' } }).graph;
  const prefix = (value: string) => `${id}-${value}`;
  return {
    ...graph,
    roots: graph.roots.map(root => ({ ...root, nodeId: prefix(root.nodeId) })),
    nodes: graph.nodes.map(node => ({ ...node, id: prefix(node.id), scopeId: prefix(node.scopeId),
      inputs: node.inputs.map(port => ({ ...port, type: { ...port.type, ...(port.type.scopeId ? { scopeId: prefix(port.type.scopeId) } : {}) } })),
      outputs: node.outputs.map(port => ({ ...port, type: { ...port.type, ...(port.type.scopeId ? { scopeId: prefix(port.type.scopeId) } : {}) } })) })),
    edges: graph.edges.map(edge => ({ ...edge, id: prefix(edge.id), from: { ...edge.from, nodeId: prefix(edge.from.nodeId) }, to: { ...edge.to, nodeId: prefix(edge.to.nodeId) } })),
    scopes: graph.scopes.map(scope => ({ ...scope, id: prefix(scope.id), ...(scope.parentId ? { parentId: prefix(scope.parentId) } : {}), ...(scope.ownerNodeId ? { ownerNodeId: prefix(scope.ownerNodeId) } : {}) })),
    frames: [],
  };
}
export function simulationFixture() {
  const document: CompositionDocument = compositionDocumentSchema.parse(fixture.document);
  const sourceEntities = { living: 'sensor.demo_living_temperature', bedroom: 'sensor.demo_bedroom_temperature', thermostat: 'climate.demo_thermostat', window: 'binary_sensor.demo_window', lamp: 'light.demo_lamp' };
  document.dataSources.push(...Object.entries(sourceEntities).map(([id, entityId]) => ({ id, kind: 'ha-entity' as const, entityId: { type: 'literal' as const, value: entityId } })));
  const warning: Predicate = { type: 'all', of: [
    { type: 'compare', op: 'above', left: { type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [read('living'), read('bedroom')] }, { type: 'literal', value: 2 }] },
      right: { type: 'math', op: 'add', args: [{ type: 'read', from: { type: 'source', sourceId: 'thermostat', path: ['attributes', 'temperature'] }, as: 'number', missing: 'unavailable' }, { type: 'literal', value: 2 }] } },
    { type: 'state', sourceId: 'window', path: ['state'], in: ['off'] },
  ] };
  const subtitle: Operand = { type: 'choose', cases: [{ when: warning, then: { type: 'literal', value: 'Too Warm' } }], otherwise: { type: 'literal', value: 'Comfortable' } };
  const count: Operand = { type: 'count', of: [
    { test: { type: 'state', sourceId: 'lamp', path: ['state'], in: ['on'] } },
    { test: { type: 'state', sourceId: 'window', path: ['state'], in: ['on'] } },
    { test: { type: 'state', sourceId: 'lamp', path: ['state'], in: ['on'] }, viewer: { personEntityIds: ['person.someone_else'] } },
  ] };
  const common: PipelineInputs = {
    title: 'Chores', parameters: [], request: { type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.example_chores' } },
    steps: [
      { id: 'items', op: 'get', path: ['items'] },
      { id: 'keep', op: 'filter', where: { type: 'compare', op: 'eq', left: { type: 'item', path: ['status'] }, right: { type: 'literal', value: 'needs_action' } } },
    ],
    output: { kind: 'scalar' }, schema: { kind: 'number' },
  };
  const flows = [
    { id: 'chores-count', inputs: { ...common, steps: [...common.steps, { id: 'count', op: 'count' as const }] } },
    { id: 'chores-display', inputs: { ...common, steps: [...common.steps, { id: 'first-five', op: 'limit' as const, count: 5 }],
      output: { kind: 'rows' as const, max: 5, row: { id: { type: 'item' as const, path: ['uid'] }, title: { type: 'item' as const, path: ['summary'] } } },
      schema: arrayOf(todoItemShape) } },
  ];
  const graphs = [
    graph(warning as Json, 'condition', 'warning'), graph(subtitle as Json, 'operand', 'subtitle'), graph(read('bedroom') as Json, 'operand', 'bedroom'),
    graph({ type: 'clock', part: 'today' }, 'operand', 'today'), graph(count as Json, 'operand', 'lights'),
    ...flows.map(flow => graph({ id: flow.id, kind: 'model', model: 'pipeline@1', inputs: flow.inputs } as Json, 'flow', flow.id)),
  ];
  const program = createSimulationProgram(graphs, { sourceEntities });
  const demo = demoHouse(document), states = [...demo.states!.values()].map(state => ({
    ...state,
    ...(state.entityId === sourceEntities.living ? { state: '23.6' } : {}),
    ...(state.entityId === sourceEntities.bedroom ? { state: '21.9' } : {}),
    ...(state.entityId === sourceEntities.thermostat ? { temperature: 22 } : {}),
    ...(state.entityId === sourceEntities.lamp ? { state: 'on' } : {}),
  }));
  const house = { states: new Map(states.map(state => [state.entityId, state])), viewer: { userId: 'fixture', isAdmin: false, personEntityId: 'person.fixture' } };
  const environment = createEnvironment(document, house), at = '2026-11-18T23:59:59.000Z';
  const held: HeldSnapshot = {
    at, base: {
      reads: program.reads.map(required => ({ ...required, answer: environment.read(required.sourceId, [...(required.path ?? [])]) })) as SimulationCase['base']['reads'],
      flowResponses: flows.map(flow => ({ sourceId: flow.id, requestFingerprint: flowFingerprint(flow.inputs), response: CHORES_RESPONSE, at, trimmed: false })),
      clock: FIXTURE_CLOCK, previousText: [], viewer: house.viewer,
    },
  };
  const bedroom = program.roots.find(root => root.anchor.id === 'bedroom')!.graph.nodes[0];
  const bedroomPin: SimulationPin = { kind: 'source', blockId: bedroom.id, sourceId: 'bedroom', path: ['state'], answer: { status: 'value', value: '25' } };
  const hot = captureScenario(program, held, { id: 'hot', name: 'Hot afternoon', pins: [bedroomPin] });
  const failed: SimulationCase = { ...structuredClone(hot), id: 'wrong', name: 'Wrong expectation', expected: hot.expected.map(expected =>
    expected.output.id === 'warning' && expected.kind === 'condition' ? { ...expected, answer: 'no' } : expected) };
  const incomplete: SimulationCase = { ...structuredClone(hot), id: 'missing', name: 'Missing input', base: { ...hot.base, reads: hot.base.reads.filter(read => read.sourceId !== 'living') } };
  const blockNames = Object.fromEntries(program.roots.flatMap(root => root.graph.nodes.map(node => {
    const source = sourceCaptureForNode(node, program);
    return [node.id, root.anchor.id === 'bedroom' && node.id === root.graph.roots[0].nodeId ? 'Bedroom' : `${root.anchor.id}: ${source?.sourceId ?? node.catalogKey}`];
  })));
  return { document, program, graphs, held, bedroomPin, blockNames, states, scenarios: [hot, failed, incomplete] };
}
