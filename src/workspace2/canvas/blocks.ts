import { blockCatalog, catalogAvailability, type BlockCatalogEntry, type CanvasHost, type GraphNode, type GraphScopeKind, type LogicGraph } from '../../shared/composition/graph';
import { mathArity, type Operand, type Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import type { FragmentKind } from '../../shared/composition/graph/grammar';
import { newStep, stepNames } from '../data/flow';
import type { PipelineStep } from '../../shared/composition/pipeline/schema';
import { copy, record } from '../../shared/composition/graph/json';

const words: Record<string, string> = {
  'boolean': 'Yes / No', 'entity-id': 'Entity ID', 'structured': 'Structured Value', 'source': 'Entity',
  'read': 'Attribute', 'raw-state': 'Entity State', 'last-changed': 'Last Changed', 'list-count': 'List Size', 'list-includes': 'List Contains',
  'viewer': 'Viewer Value', 'control': 'Control Value', 'item': 'This Item', 'index': 'Item Position', 'param': 'Flow Setting',
  'today': 'Today', 'now': 'Now', 'now-second': 'Now Each Second', 'days-between': 'Days Between', 'seconds-between': 'Seconds Between',
  'progress': 'Progress Between', 'map': 'Match Value', 'choose': 'If / Otherwise', 'list': 'Make List', 'object': 'Make Record',
  'count': 'How Many Checks', 'format': 'Format', 'state': 'Entity State', 'numeric': 'Entity Number',
  'viewer-person': "Viewer's Person State", 'eq': 'Is', 'ne': 'Is Not', 'above': 'Is Above', 'below': 'Is Below', 'entities': 'Many Entities',
  'before': 'Is Before', 'after': 'Is After', 'in': 'Is One Of', 'exists': 'Has a Value', 'all': 'All Of', 'any': 'Any Of', 'not': 'Not',
  'logic-ref': 'Use Output', 'hole': 'Template Setting', 'text': 'Text Slot', 'look-rules': 'Look Rules', 'action-rules': 'Action Rules',
  'bound-symbol': 'Bound Symbol', 'field': 'Field', 'for-each': 'For Each', 'bundle-outputs': 'Output Bundle', 'group': 'Group',
};
const title = (text: string) => text.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
export function blockName(key: string): string {
  const entry = blockCatalog.find(entry => entry.key === key);
  if (!entry) return key === 'opaque' ? 'Preserved JSON' : title(key.replaceAll('.', ' '));
  if (entry.grammar === 'step') return stepNames[entry.variant as PipelineStep['op']];
  if (entry.grammar === 'operand.viewer') return 'Viewer Value';
  if (entry.grammar === 'predicate.viewer') return 'Viewer Matches';
  if (entry.grammar.startsWith('destination')) return words[entry.variant] ?? title(entry.variant);
  const keyName = ['value', 'operand', 'condition'].includes(entry.variant) ? entry.grammar.split('.').at(-1)! : entry.variant;
  if (entry.grammar === 'operand.literal' && entry.variant === 'text') return 'Text';
  return words[keyName] ?? title(keyName);
}
export function fixedAverage(graph: LogicGraph, node: GraphNode): boolean {
  if (node.catalogKey !== 'operand.math.divide') return false;
  const from = (id: string, port: string) => graph.nodes.find(held => held.id === graph.edges.find(edge => edge.to.nodeId === id && edge.to.portId === port)?.from.nodeId);
  const sum = from(node.id, '/args/0'), divisor = from(node.id, '/args/1');
  const value = divisor && copy(divisor.payload.value);
  return sum?.catalogKey === 'operand.math.add' && sum.inputs.length >= 2 && sum.inputs.length <= 8
    && record(value) && value.type === 'literal' && value.value === sum.inputs.length;
}
export function nodeName(node: GraphNode, graph?: LogicGraph): string { return graph && fixedAverage(graph, node) ? 'Average' : blockName(node.catalogKey); }
export function portLabel(binding: string, node?: GraphNode, graph?: LogicGraph): string {
  if (node) {
    if (binding === 'value') return 'Result';
    if (graph && fixedAverage(graph, node)) return binding === '/args/0' ? 'Total' : 'Count';
    if (['predicate.all.value', 'predicate.any.value'].includes(node.catalogKey) && binding.startsWith('/of/')) {
      const source = graph?.nodes.find(held => held.id === graph.edges.find(edge => edge.to.nodeId === node.id && edge.to.portId === binding)?.from.nodeId);
      return source ? nodeName(source, graph) : `Check ${Number(binding.split('/').at(-1)) + 1}`;
    }
    const value = copy(node.payload.value);
    if (record(value) && value.type === 'math') {
      const index = Number(binding.split('/').at(-1));
      const labels: Record<string, string[]> = { add: ['Value', 'Plus'], subtract: ['Value', 'Minus'], multiply: ['Value', 'Times'], divide: ['Value', 'By'], clamp: ['Value', 'Minimum', 'Maximum'], scale: ['Value', 'From minimum', 'From maximum', 'To minimum', 'To maximum'] };
      return labels[String(value.op)]?.[index] ?? (index ? `Value ${index + 1}` : 'Value');
    }
    if (record(value) && value.type === 'compare') return binding === '/left' ? 'Value' : ['above', 'below', 'before', 'after'].includes(String(value.op)) ? 'Than' : 'Equals';
    if (binding === '/cases/0/when') return 'If';
    if (binding === '/cases/0/then') return 'Then';
  }
  const parts = binding.split('/').filter(Boolean);
  if (parts[0] === 'cases') return `Rule ${Number(parts[1]) + 1} ${parts[2] === 'when' ? 'If' : 'Then'}`;
  if (parts[0] === 'of' || parts[0] === 'args' && /^\d+$/.test(parts[1] ?? '')) return `Value ${Number(parts[1]) + 1}`;
  if (binding.endsWith('/sourceId')) return 'Entity';
  return parts.map(part => title(part.replaceAll('~1', '/').replaceAll('~0', '~'))).join(' ');
}
export function blockGroup(entry: BlockCatalogEntry): string {
  if (entry.grammar.startsWith('predicate')) return ['all', 'any', 'not'].some(name => entry.grammar === `predicate.${name}`) ? 'Combine' : ['viewer', 'viewer-person'].some(name => entry.grammar === `predicate.${name}`) ? 'App' : ['predicate.state', 'predicate.numeric'].includes(entry.grammar) ? 'From Home' : 'Compare';
  if (entry.grammar === 'operand.math' || entry.grammar === 'recipe' && entry.variant.startsWith('average')) return 'Math';
  if (entry.grammar === 'operand.date' || entry.grammar === 'operand.clock' || entry.grammar === 'operand.format') return 'Text & Time';
  if (entry.grammar.startsWith('template')) return 'Templates';
  if (entry.grammar.startsWith('destination') || ['operand.viewer', 'operand.control'].includes(entry.grammar)) return 'App';
  if (entry.grammar.startsWith('request') || entry.key === 'selection.source' || ['read', 'raw-state', 'last-changed'].some(name => entry.grammar === `operand.${name}`)) return 'From Home';
  if (['step', 'output', 'frame', 'renderer.repeat', 'recipe', 'operand.list', 'operand.list-count', 'operand.list-includes', 'operand.count'].includes(entry.grammar)) return 'Lists & Repeats';
  if (entry.grammar === 'operand.choose' || entry.grammar === 'operand.map') return 'Choose';
  return 'Values';
}
export const paletteGroups = ['In This Flow', 'From Home', 'Compare', 'Combine', 'Math', 'Choose', 'Lists & Repeats', 'Text & Time', 'App', 'Values', 'Templates'] as const;
export function blockResult(entry: BlockCatalogEntry): string {
  if (entry.grammar.startsWith('predicate') || entry.variant === 'boolean' || entry.grammar === 'operand.list-includes') return 'condition';
  if (entry.variant === 'number' || entry.grammar === 'operand.math' || entry.grammar === 'recipe' && entry.variant.startsWith('average') || ['operand.read', 'operand.count', 'operand.list-count', 'operand.index'].includes(entry.grammar)) return 'number';
  if (entry.variant === 'text' || ['operand.format', 'operand.raw-state'].includes(entry.grammar)) return 'text';
  if (entry.grammar === 'operand.clock' || entry.grammar === 'operand.last-changed' || entry.grammar === 'operand.date') return 'time';
  if (entry.grammar === 'sourceId' || entry.variant === 'entity-id') return 'entity';
  if (['operand.list', 'step', 'request', 'request.ha-subscription', 'renderer.repeat'].includes(entry.grammar)) return 'list';
  return 'record';
}
const literal = (value: Json = 0): Operand => ({ type: 'literal', value });
const check = (): Predicate => ({ type: 'compare', op: 'eq', left: literal(1), right: literal(1) });
export interface BlockSeed { value: Json; kind: FragmentKind }
export function blockSeed(entry: BlockCatalogEntry, sourceId = 'entity'): BlockSeed | undefined {
  const name = entry.grammar.split('.').at(-1)!;
  if (entry.grammar === 'selection.source' || entry.key === 'selection.source') return { value: sourceId, kind: 'source-selection' };
  if (entry.grammar.startsWith('operand.')) {
    let value: Json;
    switch (name) {
      case 'literal': value = literal(entry.variant === 'number' ? 0 : entry.variant === 'boolean' ? true : entry.variant === 'entity-id' ? 'light.example' : entry.variant === 'structured' ? {} : entry.variant === 'null' ? null : 'Text'); break;
      case 'math': value = { type: 'math', op: entry.variant, args: Array.from({ length: mathArity[entry.variant as keyof typeof mathArity][0] }, () => literal(1)) }; break;
      case 'read': value = { type: 'read', from: { type: 'source', sourceId, path: ['state'] }, as: 'number', missing: 'unavailable' }; break;
      case 'raw-state': case 'last-changed': value = { type: name, sourceId }; break;
      case 'list-count': case 'list-includes': value = { type: name, from: { type: 'source', sourceId, path: ['attributes', 'items'] }, ...(name === 'list-includes' ? { value: literal('on') } : {}) }; break;
      case 'viewer': value = { type: name, field: 'userId' }; break;
      case 'control': case 'index': value = { type: name }; break;
      case 'item': value = { type: name, path: [] }; break;
      case 'param': value = { type: name, name: 'value' }; break;
      case 'clock': value = { type: name, part: entry.variant }; break;
      case 'date': value = { type: name, op: entry.variant, from: { type: 'clock', part: 'today' }, to: { type: 'clock', part: 'now' } }; break;
      case 'format': value = { type: name, pattern: '{value}', args: { value: literal('Text') } }; break;
      case 'choose': value = { type: name, cases: [{ when: check(), then: literal('Yes') }], otherwise: literal('No') }; break;
      case 'map': value = { type: name, of: literal(1), cases: [{ equals: 1, then: literal('Yes') }], otherwise: literal('No') }; break;
      case 'list': value = { type: name, items: [literal(1)] }; break;
      case 'object': value = { type: name, fields: { value: literal(1) } }; break;
      case 'count': value = { type: name, of: [{ test: check() }] }; break;
      default: return undefined;
    }
    return { value, kind: 'operand' };
  }
  if (entry.grammar.startsWith('predicate.')) {
    const value: Json = name === 'state' ? { type: name, sourceId, path: ['state'], in: ['on'] }
      : name === 'numeric' ? { type: name, sourceId, path: ['state'], above: literal(0) }
        : name === 'viewer' ? { type: name, isAdmin: true }
          : name === 'viewer-person' ? { type: name, in: ['home'] }
            : name === 'compare' ? { ...check(), op: entry.variant }
              : name === 'in' ? { type: name, value: literal(1), in: [literal(1)] }
                : name === 'exists' ? { type: name, value: literal(1) }
                  : name === 'not' ? { type: name, of: check() } : { type: name, of: [check(), check()] };
    return { value, kind: 'condition' };
  }
  if (entry.grammar === 'step') return { value: newStep(entry.variant as PipelineStep['op'], 'step'), kind: 'step' };
  if (entry.grammar === 'output') return { value: { kind: entry.variant, ...(['rows', 'records'].includes(entry.variant) ? { row: { title: literal('Text') } } : {}) }, kind: 'output' };
  if (entry.grammar === 'request') return { kind: 'request', value: entry.variant === 'none' ? { type: 'none', value: { type: 'list', items: [] } }
    : entry.variant === 'entities' ? { type: 'entities', entityIds: [literal('light.example')], attributes: [] }
      : entry.variant === 'entity-attribute' ? { type: 'entity-attribute', entityId: literal('sensor.example'), attribute: 'items' }
        : { type: 'service-response', domain: 'calendar', service: 'get_events', responseShape: { kind: 'object', fields: {} } } };
  if (entry.grammar === 'destination' && entry.variant === 'text') return { kind: 'slot', value: { type: 'expr', value: literal('Text'), fallback: '' } };
  return undefined;
}
export function paletteAvailability(entry: BlockCatalogEntry, scope: GraphScopeKind, capabilities: readonly string[], sourceId?: string): { enabled: boolean; reason?: string } {
  const available = catalogAvailability(entry.key, scope, capabilities);
  if (!available.enabled) return available;
  return blockSeed(entry, sourceId) ? available : { enabled: false, reason: 'Requires a destination or template supplied by the workspace host. Existing blocks remain preserved and editable in the canvas.' };
}
export function nodeDetail(node: GraphNode, sources: CanvasHost['data']['sources'] = [], graph?: LogicGraph): string {
  const value = copy(node.payload.value);
  if (node.payload.kind === 'source-selection') return String(value);
  if (!record(value)) return '';
  if (graph && fixedAverage(graph, node)) return 'Fixed values · total divided by count';
  if (value.type === 'literal') return '';
  if (value.type === 'state') return `State is ${Array.isArray(value.in) ? value.in.join(' or ') : ''}`;
  const from = value.from;
  if (record(from) && typeof from.sourceId === 'string') return [sources.find(source => source.id === from.sourceId)?.name, Array.isArray(from.path) ? from.path.join(' · ') : ''].filter(Boolean).join(' · ');
  if (typeof value.sourceId === 'string') return sources.find(source => source.id === value.sourceId)?.name ?? value.sourceId;
  if (value.type === 'math' || value.type === 'compare' || value.type === 'all' || value.type === 'any') return '';
  return String(value.part ?? value.field ?? value.pattern ?? '');
}
