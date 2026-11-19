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
import { anchorKey } from '../../../src/workspace2/logic-simulation/contracts';
import type { SimulationPresentation } from '../../../src/workspace2/logic-simulation/presentation';
export { CHORES_RESPONSE, FIXTURE_CLOCK } from './data';

const read = (sourceId: string): Operand => ({ type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'number', missing: 'unavailable' });
function graph(value: Json, kind: 'operand' | 'condition' | 'flow' | 'slot', id: string, document?: Json): LogicGraph {
  const graph = lift(value, { kind, ...(kind === 'slot' && document ? { context: { document, pointer: '/pages/1/components/0/props/value' } } : {}), anchor: { kind: kind === 'flow' ? 'flow' : 'logic', id, field: kind === 'flow' ? '/inputs' : '/body' } }).graph;
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
export function simulationFixture(keep = false) {
  const document: CompositionDocument = compositionDocumentSchema.parse(fixture.document);
  const sourceEntities = { living: 'sensor.demo_living_temperature', bedroom: 'sensor.demo_bedroom_temperature', thermostat: 'climate.demo_thermostat', window: 'binary_sensor.demo_window', lamp: 'light.demo_lamp' };
  document.dataSources.push(...Object.entries(sourceEntities).map(([id, entityId]) => ({ id, kind: 'ha-entity' as const, entityId: { type: 'literal' as const, value: entityId } })));
  const warning: Predicate = { type: 'all', of: [
    { type: 'compare', op: 'above', left: { type: 'math', op: 'divide', args: [{ type: 'math', op: 'add', args: [read('living'), read('bedroom')] }, { type: 'literal', value: 2 }] },
      right: { type: 'math', op: 'add', args: [{ type: 'read', from: { type: 'source', sourceId: 'thermostat', path: ['attributes', 'temperature'] }, as: 'number', missing: 'unavailable' }, { type: 'literal', value: 2 }] } },
    { type: 'state', sourceId: 'window', path: ['state'], in: ['off'] },
  ] };
  const subtitle: Operand = { type: 'choose', cases: [{ when: warning, then: { type: 'literal', value: 'Too Warm' } }], otherwise: { type: 'literal', value: 'Comfortable' } };
  const badge: Operand = { type: 'choose', cases: [
    { when: { type: 'state', sourceId: 'bedroom', path: ['state'], in: ['unavailable', 'unknown'] }, then: { type: 'literal', value: 'Hidden' } },
    { when: warning, then: { type: 'literal', value: 'Shown' } },
  ], otherwise: { type: 'literal', value: 'Hidden' } };
  const count: Operand = { type: 'count', of: [
    { test: { type: 'state', sourceId: 'lamp', path: ['state'], in: ['on'] } },
    { test: { type: 'state', sourceId: 'window', path: ['state'], in: ['on'] } },
    { test: { type: 'state', sourceId: 'lamp', path: ['state'], in: ['on'] }, viewer: { personEntityIds: ['person.demo_someone_else'] } },
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
    graph(warning as Json, 'condition', 'warning'),
    graph(keep ? { type: 'expr', value: subtitle as Json, whenUnavailable: 'keep', fallback: 'No reading' } : subtitle as Json, keep ? 'slot' : 'operand', 'subtitle', document as Json), graph(read('bedroom') as Json, 'operand', 'bedroom'),
    graph({ type: 'clock', part: 'today' }, 'operand', 'today'), graph(count as Json, 'operand', 'lights'),
    ...flows.map(flow => graph({ id: flow.id, kind: 'model', model: 'pipeline@1', inputs: flow.inputs } as Json, 'flow', flow.id)),
    ...(keep ? [graph(badge as Json, 'operand', 'badge')] : []),
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
      clock: FIXTURE_CLOCK, previousText: keep ? [{ output: program.roots.find(root => root.anchor.id === 'subtitle')!.anchor, text: 'Too Warm' }] : [], viewer: house.viewer,
    },
  };
  const bedroom = program.roots.find(root => root.anchor.id === 'bedroom')!.graph.nodes[0];
  const bedroomPin: SimulationPin = { kind: 'source', blockId: bedroom.id, sourceId: 'bedroom', path: ['state'], answer: { status: 'value', value: '25' } };
  const hot = captureScenario(program, held, { id: 'hot', name: 'Hot afternoon', pins: [bedroomPin] });
  const failed: SimulationCase = { ...structuredClone(hot), id: 'wrong', name: 'Wrong expectation', ...(keep ? { pins: [] } : {}),
    expected: keep ? hot.expected : hot.expected.map(expected => expected.output.id === 'warning' && expected.kind === 'condition' ? { ...expected, answer: 'no' } : expected) };
  const incomplete: SimulationCase = { ...structuredClone(hot), id: 'missing', name: 'Missing input', base: { ...hot.base, reads: hot.base.reads.filter(read => read.sourceId !== 'living') } };
  const sourceNames: Record<string, string> = { living: 'Living Room', bedroom: 'Bedroom', thermostat: 'Target', window: 'Window', lamp: 'Lamp' };
  const stepNames: Readonly<Record<string, string>> = { filter: 'Keep Where', limit: 'First Few', count: 'How Many', get: 'Items' };
  const outputNames: Record<string, string> = { warning: 'Warning', subtitle: 'Subtitle', bedroom: 'Bedroom', today: 'Today', lights: 'Lights on', 'chores-count': 'Chores count', 'chores-display': 'Chores display', badge: 'Badge' };
  const blockNames = Object.fromEntries(program.roots.flatMap(root => root.graph.nodes.map(node => {
    const source = sourceCaptureForNode(node, program), value = node.payload.kind === 'operand' || node.payload.kind === 'condition' ? node.payload.value : undefined;
    const name = source ? sourceNames[source.sourceId] : node.id === root.graph.roots[0].nodeId ? outputNames[root.anchor.id]
      : value?.type === 'math' ? value.op === 'divide' ? 'Average' : 'Add' : value?.type === 'compare' ? 'Is Above' : value?.type === 'choose' ? 'If / Otherwise'
        : value?.type === 'all' ? 'All Of' : value?.type === 'literal' ? typeof value.value === 'number' ? 'Number' : 'Words'
          : node.payload.kind === 'step' ? (stepNames[node.payload.value.op] ?? 'Step') : 'Value';
    return [node.id, name];
  })));
  const presentation: SimulationPresentation = {
    blocks: Object.fromEntries(program.roots.flatMap(root => root.graph.nodes.map(node => {
      const source = sourceCaptureForNode(node, program);
      return [node.id, { name: blockNames[node.id], ...(source && ['living', 'bedroom', 'thermostat'].includes(source.sourceId) ? { unit: '°C', changedAt: '2026-11-18T23:59:47.000Z' } : {}),
        ...(source?.sourceId === 'window' ? { states: { off: 'Closed', on: 'Open' }, traceName: 'Is' } : {}) }];
    }))),
    outputs: Object.fromEntries(program.roots.map(root => [anchorKey(root.anchor), { name: outputNames[root.anchor.id],
      ...(root.anchor.id === 'bedroom' ? { unit: '°C' } : {}), ...(root.anchor.id === 'today' ? { format: 'date' as const } : {}) }])),
    entities: { ...sourceNames, ...Object.fromEntries(Object.entries(sourceEntities).map(([id, entity]) => [entity, sourceNames[id]])) },
    traceBlocks: program.roots.filter(root => root.anchor.id === 'subtitle').flatMap(root =>
      root.graph.nodes.filter(node => blockNames[node.id] !== 'Number' && blockNames[node.id] !== 'Words').map(node => node.id))
      .concat(program.roots.filter(root => root.anchor.id === 'badge').flatMap(root => root.graph.roots.map(root => root.nodeId))),
    scenarioInputs: program.roots.find(root => root.anchor.id === 'warning')!.graph.nodes.filter(node => {
      const source = sourceCaptureForNode(node, program);
      return node.payload.kind !== 'source-selection' && source && ['living', 'bedroom', 'thermostat', 'window'].includes(source.sourceId);
    }).map(node => node.id),
    scenarioOutputs: program.roots.filter(root => ['subtitle', 'badge'].includes(root.anchor.id)).map(root => anchorKey(root.anchor)),
  };
  const offline = captureScenario(program, held, { id: 'offline', name: 'Sensor offline', pins: [{ ...bedroomPin, answer: { status: 'value', value: 'unavailable' } }],
    clock: { now: '2026-11-18T23:30:00', utcOffsetMinutes: 0 } });
  return { document, program, graphs, held, bedroomPin, blockNames, presentation, states, offline, scenarios: [hot, failed, incomplete] };
}
