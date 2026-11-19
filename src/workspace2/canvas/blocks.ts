import { blockCatalog, catalogAvailability, type BlockCatalogEntry, type GraphNode, type GraphScopeKind } from '../../shared/composition/graph';
import { mathArity, type Operand, type Predicate } from '../../shared/composition/expression';
import type { Json } from '../../shared/types';
import type { FragmentKind } from '../../shared/composition/graph/grammar';
import { newStep, stepNames } from '../data/flow';
import type { PipelineStep } from '../../shared/composition/pipeline/schema';
import { copy, record } from '../../shared/composition/graph/json';

const words: Record<string, string> = {
  'boolean': 'Yes / No', 'entity-id': 'Entity ID', 'structured': 'Structured Value', 'source': 'Entity',
  'read': 'Read Value', 'raw-state': 'Raw State', 'last-changed': 'Last Changed', 'list-count': 'List Size', 'list-includes': 'List Contains',
  'viewer': 'Viewer Value', 'control': 'Control Value', 'item': 'This Item', 'index': 'Item Position', 'param': 'Flow Setting',
  'today': 'Today', 'now': 'Now', 'now-second': 'Now Each Second', 'days-between': 'Days Between', 'seconds-between': 'Seconds Between',
  'progress': 'Progress Between', 'map': 'Match Value', 'choose': 'Choose', 'list': 'Make List', 'object': 'Make Record',
  'count': 'How Many Checks', 'format': 'Format', 'state': 'Entity State', 'numeric': 'Entity Number',
  'viewer-person': "Viewer's Person State", 'eq': 'Is / Is Not', 'ne': 'Is Not', 'above': 'Is Above', 'below': 'Is Below',
  'before': 'Is Before', 'after': 'Is After', 'in': 'Is One Of', 'exists': 'Has Value', 'all': 'All Of', 'any': 'Any Of', 'not': 'Not',
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
export function nodeName(node: GraphNode): string { return blockName(node.catalogKey); }
export function portLabel(binding: string): string {
  const parts = binding.split('/').filter(Boolean);
  if (parts[0] === 'cases') return `Rule ${Number(parts[1]) + 1} ${parts[2] === 'when' ? 'If' : 'Then'}`;
  if (parts[0] === 'of' || parts[0] === 'args' && /^\d+$/.test(parts[1] ?? '')) return `Value ${Number(parts[1]) + 1}`;
  if (binding.endsWith('/sourceId')) return 'Entity';
  return parts.map(part => title(part.replaceAll('~1', '/').replaceAll('~0', '~'))).join(' ');
}
export function blockGroup(entry: BlockCatalogEntry): string {
  if (entry.grammar.startsWith('predicate')) return ['all', 'any', 'not'].some(name => entry.grammar === `predicate.${name}`) ? 'Combine' : 'Checks';
  if (entry.grammar === 'operand.math' || entry.grammar === 'recipe') return 'Maths';
  if (entry.grammar === 'operand.date' || entry.grammar === 'operand.clock' || entry.grammar === 'operand.last-changed') return 'Time';
  if (entry.grammar.startsWith('template')) return 'Templates';
  if (entry.grammar.startsWith('destination') || entry.grammar === 'output') return 'Outputs';
  if (entry.grammar.startsWith('request') || entry.key === 'selection.source' || ['read', 'raw-state', 'list-count', 'list-includes'].some(name => entry.grammar === `operand.${name}`)) return 'Data';
  if (entry.grammar === 'step' || entry.grammar === 'frame' || entry.grammar === 'renderer.repeat') return 'Lists & Flows';
  if (entry.grammar === 'operand.choose' || entry.grammar === 'operand.map') return 'Rules';
  return 'Values';
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
export function nodeDetail(node: GraphNode): string {
  const value = copy(node.payload.value);
  if (node.payload.kind === 'source-selection') return String(value);
  if (!record(value)) return '';
  if (value.type === 'literal') return JSON.stringify(value.value);
  if (value.type === 'state') return `State is ${Array.isArray(value.in) ? value.in.join(' or ') : ''}`;
  return String(value.op ?? value.part ?? value.field ?? value.pattern ?? '');
}
