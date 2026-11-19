import type { Json } from '../../../../src/shared/types';
import { pipelineSourceSchema } from '../../../../src/shared/composition/pipeline/schema';

export function largeGraphFlow() {
  const literal = (value: Json): Json => ({ type: 'literal', value });
  return pipelineSourceSchema.parse({
    id: 'large-flow', kind: 'model', model: 'pipeline@1',
    inputs: {
      title: 'Large multi-metric flow', parameters: [],
      request: { type: 'none', value: literal(Array.from({ length: 12 }, (_, n) => Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`n${k}`, n + k])))) },
      steps: Array.from({ length: 32 }, (_, n) => ({
        id: `transform-${n}`, op: 'map',
        fields: Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`n${k}`, {
          type: 'math', op: 'clamp', args: [{ type: 'math', op: 'add', args: [{ type: 'item', path: [`n${k}`] }, literal(1)] }, literal(0), literal(100)],
        }])),
      })),
      output: { kind: 'records', max: 100 },
      schema: { kind: 'array', of: { kind: 'object', fields: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${i}`, { shape: { kind: 'union', of: [{ kind: 'null' }, { kind: 'number' }] } }])) } },
    },
  });
}
