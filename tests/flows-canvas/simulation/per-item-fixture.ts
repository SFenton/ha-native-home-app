import { lift } from '../../../src/shared/composition/graph';
import type { PipelineInputs } from '../../../src/shared/composition/pipeline';
import type { Json } from '../../../src/shared/types';
import { createSimulationProgram, flowFingerprint } from '../../../src/workspace2/logic-simulation/program';
import type { HeldSnapshot } from '../../../src/workspace2/logic-simulation/engine';

export const TODO_CLOCK = { now: '2026-11-21T12:34:56', utcOffsetMinutes: -480 };
export function todoFlowInputs(): PipelineInputs {
  return {
    title: 'Past Due Tasks', parameters: [],
    request: { type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.demo_past_due' } },
    steps: [
      { id: 'items', op: 'get', path: ['items'] },
      { id: 'late', op: 'filter', where: { type: 'all', of: [
        { type: 'compare', op: 'eq', left: { type: 'item', path: ['status'] }, right: { type: 'literal', value: 'needs_action' } },
        { type: 'exists', value: { type: 'item', path: ['due'] } },
        { type: 'compare', op: 'above', left: { type: 'date', op: 'days-between', from: { type: 'item', path: ['due'] }, to: { type: 'clock', part: 'today' } }, right: { type: 'literal', value: 0 } },
      ] } },
      { id: 'oldest', op: 'sort', by: [{ value: { type: 'item', path: ['due'] }, direction: 'ascending', kind: 'date' }] },
      { id: 'labels', op: 'map', fields: {
        id: { type: 'item', path: ['uid'] }, title: { type: 'item', path: ['summary'] },
        late: { type: 'date', op: 'days-between', from: { type: 'item', path: ['due'] }, to: { type: 'clock', part: 'today' } },
      } },
    ],
    output: { kind: 'rows', max: 50, row: { id: { type: 'item', path: ['id'] }, title: { type: 'item', path: ['title'] } } },
    schema: { kind: 'array', of: { kind: 'object', fields: {
      id: { shape: { kind: 'string' } }, title: { shape: { kind: 'string' } },
      late: { shape: { kind: 'union', of: [{ kind: 'null' }, { kind: 'number', integer: true }] } },
    } } },
  };
}
export function todoItemFixture(items: Json[] = [], inputs = todoFlowInputs(), annotated = true) {
  const lifted = lift({ id: 'demo-todo-rows', kind: 'model', model: 'pipeline@1', inputs }, { kind: 'flow', sourceId: 'demo-todo-rows', anchor: { kind: 'flow', id: 'demo-todo-rows', field: '/inputs' } }).graph;
  const graph = { ...lifted, nodes: lifted.nodes.map(node => annotated && node.payload.kind === 'step' && node.payload.value.id === 'late'
    ? { ...node, annotation: { label: 'Keep overdue tasks' } } : node) };
  const program = createSimulationProgram([graph]);
  const held: HeldSnapshot = {
    at: '2026-11-21T20:34:56Z', origin: 'live',
    base: { reads: [], previousText: [], clock: TODO_CLOCK, flowResponses: [{
      sourceId: 'demo-todo-rows', requestFingerprint: flowFingerprint(inputs), response: { items }, at: '2026-11-21T20:34:56Z', trimmed: false,
    }] },
  };
  return { graph, program, held };
}
