import type { LogicGraph } from '../../../src/shared/composition/graph';
import type { BlockObservation, CanvasObservations, PortObservation } from '../../../src/workspace2/canvas/observations';

const live = (value: string | number | boolean): PortObservation => ({ state: 'known', source: 'live', value });
const unknown: PortObservation = { state: 'cant-tell', source: 'live' };
const offline: PortObservation = { state: 'unavailable', source: 'scenario' };

// Scripted presentation snapshots, not evaluation or a connection to Home Assistant.
export function observationFixture(graph: LogicGraph): CanvasObservations {
  const blocks: Record<string, BlockObservation> = {};
  const at = (pointer: string, observation: BlockObservation) => {
    const node = graph.nodes.find(node => node.origins[0] === pointer);
    if (!node) throw new Error(`Missing observation fixture block: ${pointer}`);
    blocks[node.id] = observation;
  };
  at('/cases/0/when/of/0/left/args/0/args/0', { outputs: { value: live(23.6) } });
  at('/cases/0/when/of/0/left/args/0/args/1', { scenarioPinned: true, outputs: { value: offline } });
  at('/cases/0/when/of/0/left/args/0', { inputs: { '/args/0': live(23.6), '/args/1': offline }, outputs: { value: unknown } });
  at('/cases/0/when/of/0/left/args/1', { outputs: { value: { state: 'known', source: 'pinned', value: 2 } } });
  at('/cases/0/when/of/0/left', { inputs: { '/args/0': unknown, '/args/1': { state: 'known', source: 'pinned', value: 2 } }, outputs: { value: unknown } });
  at('/cases/0/when/of/0/right', { outputs: { value: live(24) } });
  at('/cases/0/when/of/0', { inputs: { '/left': unknown, '/right': live(24) }, outputs: { value: unknown } });
  at('/cases/0/when/of/1/left', { outputs: { value: live('closed') } });
  at('/cases/0/when/of/1/right', { outputs: { value: live('closed') } });
  at('/cases/0/when/of/1', { inputs: { '/left': live('closed'), '/right': live('closed') }, outputs: { value: live(true) } });
  at('/cases/0/when', { inputs: { '/of/0': unknown, '/of/1': live(true) }, outputs: { value: unknown } });
  at('/cases/0/then', { outputs: { value: live('Too warm') } });
  at('/otherwise', { outputs: { value: live('') } });
  at('', { inputs: { '/cases/0/when': unknown, '/cases/0/then': live('Too warm'), '/otherwise': live('') }, outputs: { value: { state: 'known', source: 'live', value: 'Too warm', kept: true } } });
  return blocks;
}
