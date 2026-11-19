import type { Operand, Predicate } from '../../../../src/shared/composition/expression';
import type { LogicEntry } from '../../../../src/shared/composition/logic-library';
import type { PipelineSource } from '../../../../src/shared/composition/pipeline/schema';
import type { Immutable } from '../../../../src/shared/composition/graph/types';

export function immutable<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

const read = (sourceId: string, path = ['state']): Operand => ({
  type: 'read', from: { type: 'source', sourceId, path }, as: 'number', missing: 'unavailable',
});

export const tooWarmWarning = immutable<Predicate>({
  type: 'all',
  of: [
    {
      type: 'compare', op: 'above',
      left: {
        type: 'math', op: 'divide',
        args: [
          { type: 'math', op: 'add', args: [read('living-temperature'), read('bedroom-temperature')] },
          { type: 'literal', value: 2 },
        ],
      },
      right: { type: 'math', op: 'add', args: [read('thermostat', ['attributes', 'temperature']), { type: 'literal', value: 2 }] },
    },
    { type: 'state', sourceId: 'window', path: ['state'], in: ['off'] },
  ],
});

export const exampleA = immutable({
  logicLibrary: [
    { id: 'too-warm-warning', name: 'Too Warm Warning', kind: 'condition', params: [], body: tooWarmWarning },
    {
      id: 'too-warm-subtitle', name: 'Too Warm Subtitle', kind: 'operand', params: [],
      body: {
        type: 'choose',
        cases: [{ when: { type: 'logic-ref', logicId: 'too-warm-warning', args: {} }, then: { type: 'literal', value: 'Too Warm' } }],
        otherwise: { type: 'literal', value: 'Comfortable' },
      },
    },
  ],
  subtitle: { type: 'expr', value: { type: 'logic-ref', logicId: 'too-warm-subtitle', args: {} }, fallback: 'Temperature unavailable' },
});

export const downstairsLights = immutable<Operand>({
  type: 'count',
  of: ['a', 'b', 'c', 'd', 'e'].map(letter => ({
    test: { type: 'state', sourceId: `light-${letter}`, path: ['state'], in: ['on'] },
  })),
});

export const brightnessPrefix = immutable<PipelineSource['inputs']>({
  title: 'Downstairs brightness total', parameters: [],
  request: {
    type: 'entities',
    entityIds: ['a', 'b', 'c', 'd', 'e'].map(letter => ({ type: 'literal', value: `light.demo_${letter}` })),
    attributes: ['brightness'],
  },
  steps: [{
    id: 'percent', op: 'map',
    fields: {
      value: {
        type: 'math', op: 'scale',
        args: [{ type: 'item', path: ['brightness'] }, ...[0, 255, 0, 100].map(value => ({ type: 'literal' as const, value }))],
      },
    },
  }],
  output: { kind: 'scalar' }, schema: { kind: 'number' },
});

const brightnessRead = (id: string) => read(id, ['value']);
export const exampleB = immutable({
  logicLibrary: [{
    id: 'lights-on', name: 'Downstairs Lights On', kind: 'operand', params: [], body: downstairsLights,
  }],
  any: { type: 'compare', op: 'above', left: { type: 'logic-ref', logicId: 'lights-on', args: {} }, right: { type: 'literal', value: 0 } },
  all: { type: 'compare', op: 'eq', left: { type: 'logic-ref', logicId: 'lights-on', args: {} }, right: { type: 'literal', value: 5 } },
  dataSources: [
    { id: 'brightness-sum', kind: 'model', model: 'pipeline@1', inputs: { ...brightnessPrefix, steps: [...brightnessPrefix.steps, { id: 'total', op: 'sum', value: { type: 'item', path: ['value'] } }] } },
    {
      id: 'brightness-valid-count', kind: 'model', model: 'pipeline@1',
      inputs: {
        ...brightnessPrefix, title: 'Downstairs available brightness count',
        steps: [...brightnessPrefix.steps, { id: 'valid', op: 'filter', where: { type: 'exists', value: { type: 'item', path: ['value'] } } }, { id: 'count', op: 'count' }],
      },
    },
  ],
  subtitle: {
    type: 'expr',
    value: {
      type: 'format', pattern: '{on} On \u00b7 {brightness}%',
      args: {
        on: { type: 'logic-ref', logicId: 'lights-on', args: {} },
        brightness: { type: 'math', op: 'divide', args: [brightnessRead('brightness-sum'), brightnessRead('brightness-valid-count')] },
      },
      formats: { brightness: { number: { maximumFractionDigits: 0 } } },
    },
    fallback: 'Brightness unavailable',
  },
});

export const sourceParameterTemplate = immutable<LogicEntry>({
  id: 'is-on', name: 'Is On', kind: 'condition',
  params: [{ name: 'source', kind: 'source-id', sample: 'light-a' }],
  body: { type: 'state', sourceId: { type: 'hole', name: 'source' }, path: ['state'], in: ['on'] },
});
