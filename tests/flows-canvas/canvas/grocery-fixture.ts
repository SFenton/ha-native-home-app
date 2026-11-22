import corpus from '../../../contract/corpus/accept/pipeline-todo-get-items-service.json';
import { lift, type LogicGraph } from '../../../src/shared/composition/graph';
import { pipelineSourceSchema } from '../../../src/shared/composition/pipeline/schema';
import type { CanvasObservations } from '../../../src/workspace2/canvas/observations';

export function groceryPipeline() {
  const source = pipelineSourceSchema.parse(corpus.document.dataSources.find(source => source.model === 'pipeline@1'));
  if (source.inputs.request.type !== 'service-response') throw new Error('Expected service response fixture.');
  const response = source.inputs.request.responseShape;
  if (response.kind !== 'object') throw new Error('Expected record response fixture.');
  const { refresh: _refresh, ...inputs } = source.inputs;
  const { data: _data, ...request } = source.inputs.request;
  return pipelineSourceSchema.parse({ ...source, inputs: {
    ...inputs, title: 'Grocery rows', parameters: [],
    request: { ...request, target: { entity_id: { type: 'literal', value: 'todo.demo_groceries' } }, responseShape: { kind: 'object', fields: { 'todo.demo_groceries': response.fields['todo.demo_chores'] } } },
    steps: [{ id: 'entry', op: 'select-key', key: { type: 'literal', value: 'todo.demo_groceries' } }, { id: 'items', op: 'get', path: ['items'] }],
    output: { kind: 'rows', max: 20, row: { id: { type: 'item', path: ['uid'] }, title: { type: 'item', path: ['summary'] }, subtitle: { type: 'item', path: ['description'] } } },
  } });
}
export function groceryGraph(): LogicGraph {
  const source = groceryPipeline(), graph = lift(source.inputs, { kind: 'flow-inputs', sourceId: source.id }).graph;
  const positions: Readonly<Record<string, { x: number; y: number }>> = {
    '': { x: 600, y: 24 }, '/request': { x: 312, y: 24 }, '/request/target/entity_id': { x: 24, y: 24 },
    '/steps/0': { x: 312, y: 212 }, '/steps/0/key': { x: 24, y: 168 },
    '/steps/1': { x: 24, y: 312 }, '/output': { x: 312, y: 400 },
    '/output/row/id': { x: 24, y: 456 }, '/output/row/title': { x: 24, y: 600 }, '/output/row/subtitle': { x: 24, y: 744 },
  };
  return { ...graph, nodes: graph.nodes.map(node => {
    const position = positions[node.origins[0]];
    if (!position) throw new Error(`Unexpected grocery block: ${node.origins[0]}`);
    return { ...node, position };
  }) };
}
export const groceryRows = ['Milk', 'Eggs', 'Bread', 'Apples', 'Rice', 'Coffee', 'Dish soap'].map((title, i) => ({ id: `row-${i + 1}`, title, subtitle: `Item ${i + 1}` }));
export function groceryObservations(graph: LogicGraph): CanvasObservations {
  const items = groceryRows.map(row => ({ uid: row.id, summary: row.title, description: row.subtitle }));
  const response = { 'todo.demo_groceries': { items } };
  return Object.fromEntries(graph.nodes.map(node => [node.id, {
    inputs: Object.fromEntries(node.inputs.map(port => [port.id, { state: 'known', source: 'scenario',
      value: port.id.endsWith('/title') ? 'Milk' : port.id.endsWith('/id') ? 'row-1'
        : ['/key', '/target/entity_id'].includes(port.id) ? 'todo.demo_groceries'
          : port.id === '/request' ? response : port.id === '/steps/0' ? { items } : port.id === '/steps/1' ? items : port.id === '/output' ? groceryRows : 'Item 1',
    }])),
    outputs: { value: { state: 'known', source: 'scenario',
      value: node.catalogKey === 'output.rows' || node.payload.kind === 'flow-inputs' ? groceryRows
        : node.catalogKey === 'step.select-key' ? { items } : node.catalogKey === 'request.service-response' ? response
          : node.catalogKey === 'operand.literal.text' || node.catalogKey === 'operand.literal.entity-id' ? 'todo.demo_groceries'
            : node.origins[0].endsWith('/id') ? 'row-1' : node.origins[0].endsWith('/title') ? 'Milk'
              : node.origins[0].endsWith('/subtitle') ? 'Item 1' : items,
    } },
  }]));
}
