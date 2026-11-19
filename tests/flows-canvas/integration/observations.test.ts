import { expect, it } from 'vitest';
import { canvasPortObservations } from '../../../src/workspace2/logic-fields/observations';
import type { PortObservation } from '../../../src/workspace2/logic-simulation/observations';

const port = (portId: string, extra: Partial<PortObservation> = {}): PortObservation => ({
  portId, direction: 'output', source: 'live', mode: 'Live', state: 'known', freshness: 'live', observed: true, pinned: false, value: 0, ...extra,
});
it('preserves typed false/zero/text values, output keep evidence and direct scenario pins', () => {
  const mapped = canvasPortObservations({ order: ['root'], truncated: false, blocks: { root: {
    ...port('value', { source: 'scenario', pinned: true }), blockId: 'root', ports: [
      port('false', { value: false }), port('zero'), port('text', { value: 'unavailable' }),
      port('kept', { source: 'scenario', state: 'loading', value: 'Previous words', kept: true }),
      port('input', { direction: 'input', kept: true }),
    ],
  } } });
  expect(mapped.root).toEqual({ scenarioPinned: true, inputs: { input: { source: 'live', state: 'known', value: 0 } }, outputs: {
    false: { source: 'live', state: 'known', value: false }, zero: { source: 'live', state: 'known', value: 0 },
    text: { source: 'live', state: 'known', value: 'unavailable' },
    kept: { source: 'scenario', state: 'cant-tell', value: 'Previous words', kept: true },
  } });
});
it('never invents Live or known observations for mixed, short-circuited or loading ports', () => {
  const mapped = canvasPortObservations({ order: [], truncated: true, blocks: { root: {
    ...port('value'), blockId: 'root', ports: [
      port('mixed', { source: 'mixed', mode: 'Mixed' }), port('skipped', { observed: false }),
      port('absent', { state: 'not-observed' }), port('pending', { state: 'loading', value: undefined }),
    ],
  } } });
  expect(mapped.root).toEqual({ inputs: {}, outputs: { pending: { source: 'live', state: 'cant-tell' } } });
});
