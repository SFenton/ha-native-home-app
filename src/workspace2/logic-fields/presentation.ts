import type { GraphNode, LogicGraph } from '../../shared/composition/graph';
import { projectGraph } from '../../shared/composition/graph/lower';
import { nodeName } from '../canvas/blocks';
import { wireKind } from '../canvas/theme';
import { entityOfSource, type NameContext } from '../expr/condition';
import { logicOperandName } from '../data/logic/logicNames';
import type { Predicate } from '../../shared/composition/expression';
import { indexGraph, type CanvasGraphIndex } from '../canvas/graph-index';
import { modelName } from '../dialogs/sources';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const words = (value: string) => value.replace(/_/g, ' ');
const join = (values: string[], conjunction = 'and') => values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} ${conjunction} ${values.at(-1)}`;

export function sourceLabel(sourceId: unknown, ctx: NameContext): string {
  const setting = logicOperandName(sourceId, ctx.logic);
  if (setting) return setting;
  if (typeof sourceId !== 'string') return 'Entity';
  const entityId = entityOfSource(ctx, sourceId);
  const source = ctx.document.dataSources.find(source => source.id === sourceId);
  if (source?.kind === 'model') {
    const title = object(source.inputs)?.title;
    return source.model === 'pipeline@1' ? typeof title === 'string' && title.trim() ? title.trim() : 'Flow'
      : typeof source.model === 'string' ? modelName(source.model) : 'Model';
  }
  return entityId ? ctx.entityName?.(entityId) ?? words(entityId.split('.').at(-1) ?? entityId)
    : source ? 'Entity' : 'Missing source';
}

function readLabel(from: unknown, ctx: NameContext): string {
  const read = object(from), name = sourceLabel(read?.sourceId, ctx), path = list(read?.path);
  return path[0] === 'attributes' && typeof path[1] === 'string' ? `${name}'s ${words(path.slice(1).join(' '))}` : name;
}

/** Describes the projected graph, so edits and rewired inputs use their current values. */
export function graphSentence(graph: LogicGraph, ctx: NameContext): string {
  return describeLogic(projectGraph(graph).ast, ctx).replace(/^./, letter => letter.toUpperCase());
}

export function describeLogic(value: unknown, ctx: NameContext): string {
  const special = logicOperandName(value, ctx.logic);
  if (special) return special;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null) return 'Empty';
  const node = object(value);
  if (!node) return 'No value';
  const say = (next: unknown) => describeLogic(next, ctx);
  switch (node.type) {
    case 'literal': return typeof node.value === 'object' && node.value !== null
      ? Array.isArray(node.value) ? `${node.value.length} items` : `${Object.keys(node.value).length} fields` : say(node.value);
    case 'expr': return say(node.value);
    case 'read': return readLabel(node.from, ctx);
    case 'raw-state': return `${sourceLabel(node.sourceId, ctx)}'s raw state`;
    case 'last-changed': return `when ${sourceLabel(node.sourceId, ctx)} last changed`;
    case 'state': return `${readLabel({ sourceId: node.sourceId, path: node.path }, ctx)} is ${join(list(node.in).map(value => words(String(value)).replace(/^./, letter => letter.toUpperCase())), 'or')}`;
    case 'numeric': return [
      node.above !== undefined ? `${readLabel({ sourceId: node.sourceId, path: node.path }, ctx)} is above ${say(node.above)}` : '',
      node.below !== undefined ? `${readLabel({ sourceId: node.sourceId, path: node.path }, ctx)} is below ${say(node.below)}` : '',
    ].filter(Boolean).join(' and ');
    case 'all': case 'any': {
      const parts = list(node.of).map(child => {
        const nested = object(child);
        const text = say(child);
        return nested && (nested.type === 'all' || nested.type === 'any') && nested.type !== node.type ? `(${text})` : text;
      });
      return join(parts, node.type === 'all' ? 'and' : 'or');
    }
    case 'not': return `not (${say(node.of)})`;
    case 'compare': {
      const comparison = { eq: 'is', ne: 'is not', above: 'is above', below: 'is below', before: 'is before', after: 'is after' } satisfies Record<Extract<Predicate, { type: 'compare' }>['op'], string>;
      return `${say(node.left)} ${comparison[node.op as keyof typeof comparison] ?? words(String(node.op))} ${say(node.right)}`;
    }
    case 'in': return `${say(node.value)} is one of ${join(list(node.in).map(say), 'or')}`;
    case 'exists': return `${say(node.value)} has a value`;
    case 'viewer': return node.field ? `the person's ${words(String(node.field))}`
      : node.isAdmin !== undefined ? `the person using the app ${node.isAdmin ? 'is an admin' : 'is not an admin'}` : 'the person is one of the selected people';
    case 'viewer-person': return `the person is ${join(list(node.in).map(String), 'or')}`;
    case 'math': {
      const args = list(node.args), sum = object(args[0]), count = object(args[1]);
      if (node.op === 'divide' && sum?.type === 'math' && sum.op === 'add' && count?.type === 'literal' && count.value === list(sum.args).length)
        return `the Average of ${join(list(sum.args).map(say))}`;
      const binary = { add: ' + ', subtract: ' - ', multiply: ' × ', divide: ' ÷ ' };
      if (typeof node.op === 'string' && Object.hasOwn(binary, node.op)) return args.map(arg => {
        const nested = object(arg);
        return nested?.type === 'math' && ['add', 'subtract'].includes(String(nested.op)) && ['multiply', 'divide'].includes(String(node.op)) ? `(${say(arg)})` : say(arg);
      }).join(binary[node.op as keyof typeof binary]);
      return `${words(String(node.op))} of ${join(args.map(say))}`;
    }
    case 'format': return String(node.pattern).replace(/\{([^{}]+)\}/g, (_, key: string) => say(object(node.args)?.[key]));
    case 'choose': return `${list(node.cases).map(item => { const choice = object(item); return `${say(choice?.then)} if ${say(choice?.when)}`; }).join('; ')}, otherwise ${say(node.otherwise)}`;
    case 'map': return `match ${say(node.of)} to ${list(node.cases).length} choices, otherwise ${say(node.otherwise)}`;
    case 'count': return `how many of ${list(node.of).map(item => say(object(item)?.test)).join('; ')} are true`;
    case 'list-count': return `the number of items in ${readLabel(node.from, ctx)}`;
    case 'list-includes': return `${readLabel(node.from, ctx)} includes ${say(node.value)}`;
    case 'list': return join(list(node.items).map(say));
    case 'object': return Object.entries(object(node.fields) ?? {}).map(([name, value]) => `${words(name)}: ${say(value)}`).join(', ');
    case 'item': return `this item's ${list(node.path).join(' ') || 'value'}`;
    case 'param': return String(node.name);
    case 'control': return 'the control value';
    case 'index': return 'the item position';
    case 'clock': return words(String(node.part));
    case 'date': return `${words(String(node.op))} from ${say(node.from)} to ${say(node.to)}`;
    case 'call-service': return `${words(String(node.service))} (${words(String(node.domain))})`;
    default: return node.model === 'pipeline@1' ? 'Request, steps and typed output' : 'A value built from logic';
  }
}

export function graphBlockLabel(node: GraphNode, graph: LogicGraph, ctx: NameContext, index: CanvasGraphIndex = indexGraph(graph)): { name: string; detail: string } {
  const value = object(node.payload.value), special = logicOperandName(node.payload.value, ctx.logic);
  if (node.payload.kind === 'source-selection') return { name: sourceLabel(node.payload.value, ctx), detail: 'Entity' };
  if (special) return { name: special, detail: nodeName(node, graph, index) };
  const sourcePort = node.inputs.find(port => port.binding === '/sourceId' || port.binding === '/from/sourceId');
  const connected = sourcePort ? index.source(node.id, sourcePort.id) : undefined;
  const source = connected?.payload.value ?? value?.sourceId ?? object(value?.from)?.sourceId;
  return source !== undefined ? { name: sourceLabel(source, ctx), detail: nodeName(node, graph, index) }
    : { name: nodeName(node, graph, index), detail: value?.type === 'literal' ? describeLogic(value, ctx) : '' };
}

export function miniMapModel(graph: LogicGraph, ctx: NameContext) {
  const index = indexGraph(graph);
  const depths = new Map<string, number>(), incoming = new Map<string, string[]>();
  for (const edge of graph.edges) incoming.set(edge.to.nodeId, [...incoming.get(edge.to.nodeId) ?? [], edge.from.nodeId]);
  const depth = (id: string, visiting = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) throw new Error('The logic mini-map contains a cycle.');
    const next = new Set(visiting).add(id);
    const result = Math.max(0, ...(incoming.get(id) ?? []).map(parent => depth(parent, next) + 1));
    depths.set(id, result); return result;
  };
  const rows = new Map<number, number>();
  const nodes = graph.nodes.map(node => {
    const column = depth(node.id), row = rows.get(column) ?? 0; rows.set(column, row + 1);
    return { id: node.id, x: 8 + column * 100, y: 10 + row * 64, ...graphBlockLabel(node, graph, ctx, index),
      kind: node.outputs[0] ? wireKind(node.outputs[0].type) : 'record' };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { nodes, width: Math.max(220, ...nodes.map(node => node.x + 94)), height: Math.max(76, ...nodes.map(node => node.y + 60)),
    edges: graph.edges.map(edge => ({ id: edge.id, from: byId.get(edge.from.nodeId)!, to: byId.get(edge.to.nodeId)! })) };
}
