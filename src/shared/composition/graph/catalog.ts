import { compareOperations, dateOperations, mathOperations } from '../expression';
import { flowExtrasSteps, stepOperations } from '../pipeline/schema';
import type { GraphScopeKind } from './types';

export interface BlockCatalogEntry {
  readonly key: string;
  readonly grammar: string;
  readonly lowering: readonly string[];
  readonly variant: string;
  readonly scopes: readonly GraphScopeKind[];
  readonly capabilities: readonly string[];
  readonly cost: 'expression' | 'step' | 'structural' | 'expanded-recipe';
  readonly disabledReason?: string;
}
const all: readonly GraphScopeKind[] = ['document', 'template', 'flow', 'flow-parameter', 'flow-request', 'flow-step', 'flow-output', 'repeat', 'placeholder'];
const document: readonly GraphScopeKind[] = ['document', 'template', 'repeat', 'placeholder'];
const flow: readonly GraphScopeKind[] = ['flow-parameter', 'flow-request', 'flow-step', 'flow-output'];
const entries: BlockCatalogEntry[] = [];
const add = (grammar: string, variants: readonly string[], scopes = all, capabilities: readonly string[] = [], cost: BlockCatalogEntry['cost'] = 'expression') => {
  for (const variant of variants) {
    const lowering = grammar === 'recipe' ? variant === 'average-two-flow' ? ['request', 'step.sum', 'step.filter', 'predicate.exists', 'step.count', 'operand.read', 'operand.math.divide']
      : variant === 'average-fixed' ? ['operand.math.divide', 'operand.math.add', 'operand.literal']
        : ['operand.count', 'predicate.compare']
      : grammar === 'frame' ? [] : grammar === 'destination' ? variant === 'field' ? [] : variant === 'text' ? ['expr', 'operand.read', 'operand.literal']
        : variant === 'bound-symbol' ? ['bound-symbol'] : ['conditional']
        : grammar === 'renderer.repeat' ? ['repeat'] : [grammar === 'step' || grammar === 'output' || grammar === 'request' ? `${grammar}.${variant}` : grammar];
    entries.push(Object.freeze({ key: `${grammar}.${variant}`, grammar, lowering, variant, scopes, capabilities, cost }));
  }
};
add('operand.literal', ['number', 'text', 'boolean', 'entity-id', 'structured']);
add('operand.literal', ['null'], flow);
entries.push(Object.freeze({ key: 'selection.source', grammar: 'sourceId', lowering: ['operand.read', 'predicate.state', 'predicate.numeric'], variant: 'source', scopes: all, capabilities: [], cost: 'structural' }));
for (const name of ['read', 'viewer']) add(`operand.${name}`, ['value'], name === 'read' ? [...document, 'flow-parameter'] : [...document, 'flow-parameter', 'flow-request']);
for (const [name, capability] of [['raw-state', 'raw-state'], ['last-changed', 'entity-time'], ['list-count', 'list-read'], ['list-includes', 'list-read'], ['count', 'count']] as const) {
  add(`operand.${name}`, ['value'], document, [`sh.${capability}@1`]);
}
add('operand.control', ['value'], document);
add('operand.item', ['value'], ['flow-step', 'flow-output', 'repeat'], ['sh.pipeline-operands@1']);
add('operand.index', ['value'], ['flow-step', 'flow-output', 'repeat', 'placeholder'], ['sh.repeat@1']);
add('operand.param', ['value'], flow, ['sh.pipeline-operands@1']);
add('operand.clock', ['today', 'now'], all, ['sh.pipeline-operands@1']);
add('operand.clock', ['now-second'], document, ['sh.pipeline-operands@1', 'sh.countdown@1']);
for (const op of dateOperations) add('operand.date', [op], all, ['sh.pipeline-operands@1', ...(op === 'progress' ? ['sh.flow-extras@1'] : op === 'seconds-between' ? ['sh.countdown@1'] : [])]);
for (const op of mathOperations) add('operand.math', [op], all, op === 'truncate' ? ['sh.math-truncate@1'] : []);
for (const name of ['format', 'map', 'list', 'object']) add(`operand.${name}`, ['value']);
add('operand.choose', ['value'], all, ['sh.rules@1']);
add('template.logic-ref', ['operand', 'condition'], all);
add('template.hole', ['value'], ['template']);
for (const name of ['state', 'numeric', 'viewer', 'viewer-person']) add(`predicate.${name}`, ['value'], document);
add('predicate.compare', compareOperations);
for (const name of ['in', 'exists', 'all', 'any', 'not']) add(`predicate.${name}`, ['value']);
for (const name of ['text', 'look-rules', 'bound-symbol', 'action-rules', 'field']) add('destination', [name], document, [], 'structural');
for (const name of ['entities', 'none', 'entity-attribute', 'service-response']) add('request', [name], flow, ['sh.pipeline@1'], 'structural');
add('request.ha-subscription', ['todo-items', 'weather-forecast'], flow, ['sh.pipeline@1'], 'structural');
for (const op of new Set([...stepOperations, ...flowExtrasSteps, 'average'])) add('step', [op], flow, ['sh.pipeline@1', ...(op === 'average' ? ['sh.flow-average@1'] : flowExtrasSteps.some(extra => extra === op) ? ['sh.flow-extras@1'] : [])], 'step');
add('output', ['scalar', 'record', 'rows'], flow, ['sh.pipeline@1'], 'structural');
add('output', ['records'], flow, ['sh.pipeline@1', 'sh.repeat@1'], 'structural');
add('frame', ['for-each', 'bundle-outputs', 'group'], all, [], 'structural');
add('renderer.repeat', ['records'], document, ['sh.repeat@1'], 'structural');
for (const recipe of ['any-count', 'all-count', 'average-fixed', 'average-two-flow']) add('recipe', [recipe], all, [], 'expanded-recipe');
entries.push(Object.freeze({
  key: 'recipe.A-number-state', grammar: 'operand.math', lowering: ['step.map', 'operand.math.add', 'operand.item', 'operand.literal'], variant: 'add', scopes: flow, capabilities: [], cost: 'expanded-recipe',
  disabledReason: 'A-number-state: entities.state is statically text; numeric normalization is not approved by the compiler/native contract.',
}));
export const blockCatalog: readonly BlockCatalogEntry[] = Object.freeze(entries);
export const catalogByKey: ReadonlyMap<string, BlockCatalogEntry> = new Map(blockCatalog.map(entry => [entry.key, entry]));

export function catalogAvailability(key: string, scope: GraphScopeKind, targetCapabilities: readonly string[]): { enabled: boolean; reason?: string } {
  const entry = catalogByKey.get(key);
  if (!entry) return { enabled: false, reason: 'Unknown block.' };
  if (entry.disabledReason) return { enabled: false, reason: entry.disabledReason };
  if (!entry.scopes.includes(scope)) return { enabled: false, reason: `Not available in ${scope} scope.` };
  const missing = entry.capabilities.filter(capability => !targetCapabilities.includes(capability));
  return missing.length ? { enabled: false, reason: `Target does not support ${missing.join(', ')}.` } : { enabled: true };
}
