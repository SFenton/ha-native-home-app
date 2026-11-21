import { describe, expect, it } from 'vitest';
import { canvasObservations } from '../../../src/workspace2/logic-simulation/observations';
import { displayValue, editClock, localTime, changedAgo } from '../../../src/workspace2/logic-simulation/presentation';
import { runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { simulationFixture } from './fixture';
import { lift } from '../../../src/shared/composition/graph';
import { createSimulationProgram } from '../../../src/workspace2/logic-simulation/program';
import { formatObservedValue } from '../../../src/workspace2/logic-simulation/observations';

describe('human-readable simulation and canvas observation seam', () => {
  it.each(['unknown', 'unavailable'])('keeps computed literal %s known on blocks, ports and the completed result', text => {
    const formatted = { type: 'format', pattern: '{value}', args: { value: { type: 'literal', value: text } } } as const;
    const graph = lift({ type: 'format', pattern: '{value}', args: { value: formatted } },
      { kind: 'operand', anchor: { kind: 'logic', id: 'demo_format', field: '/body' } }).graph;
    const program = createSimulationProgram([graph]), run = runSimulation(program, simulationFixture().held);
    const observation = canvasObservations(program, run);
    const inner = graph.nodes.find(node => node.catalogKey === 'operand.format.value' && node.id !== graph.roots[0].nodeId)!;
    expect(observation.blocks[inner.id]).toMatchObject({ observed: true, state: 'known', value: text });
    expect(observation.blocks[inner.id].ports).toContainEqual(expect.objectContaining({ direction: 'output', state: 'known', value: text }));
    expect(observation.blocks[graph.roots[0].nodeId].ports).toContainEqual(expect.objectContaining({ direction: 'input', state: 'known', value: text }));
    expect(observation.results?.[graph.roots[0].nodeId]).toMatchObject({ observed: true, state: 'known', value: text });
    expect(formatObservedValue(observation.results?.[graph.roots[0].nodeId])).toBe(text);
    expect(displayValue(run.outputs[0].result, { name: 'Formatted text' }, observation.results?.[graph.roots[0].nodeId])).toBe(text);
    expect(run.outputs[0].result).toEqual({ kind: 'operand', answer: { status: 'value', value: text } });
  });
  it.each(['unknown', 'unavailable'])('does not treat computed flow text %s as an HA sentinel reading', text => {
    const graph = lift({ type: 'read', from: { type: 'source', sourceId: 'demo_flow', path: ['value'] }, as: 'string', missing: 'unavailable' },
      { kind: 'operand' }).graph;
    const program = createSimulationProgram([graph], { flows: [{ id: 'demo_flow', inputs: {
      title: 'Demo text', parameters: [], request: { type: 'none', value: { type: 'literal', value: text } },
      steps: [], output: { kind: 'scalar' }, schema: { kind: 'string' },
    } }] });
    const run = runSimulation(program, simulationFixture().held);
    const observation = canvasObservations(program, run);
    expect(observation.results?.[graph.roots[0].nodeId]).toMatchObject({ observed: true, state: 'known', value: text });
    expect(formatObservedValue(observation.results?.[graph.roots[0].nodeId])).toBe(text);
    expect(displayValue(run.outputs[0].result, { name: 'Flow text' }, observation.results?.[graph.roots[0].nodeId])).toBe(text);
  });
  it.each(['unknown', 'unavailable', 'ordinary text'])('keeps literal %s known on its block and connected inputs while preserving real HA raw-state treatment', text => {
    const graph = lift({ type: 'compare', op: 'eq', left: { type: 'raw-state', sourceId: 'demo_mode' }, right: { type: 'literal', value: text } },
      { kind: 'condition', anchor: { kind: 'logic', id: 'demo_compare', field: '/body' } }).graph;
    const program = createSimulationProgram([graph], { sourceEntities: { demo_mode: 'input_select.demo_mode' } });
    const held = { ...simulationFixture().held, base: { ...simulationFixture().held.base,
      reads: [{ sourceId: 'demo_mode', access: 'raw-state' as const, answer: { status: 'value' as const, value: text } }] } };
    const run = runSimulation(program, held), observation = canvasObservations(program, run);
    const literal = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'literal')!;
    const read = graph.nodes.find(node => node.payload.kind === 'operand' && node.payload.value.type === 'raw-state')!;
    expect(observation.blocks[literal.id]).toMatchObject({ state: 'known', value: text });
    expect(observation.blocks[literal.id].ports).toContainEqual(expect.objectContaining({ direction: 'output', state: 'known', value: text }));
    expect(observation.blocks[graph.roots[0].nodeId].ports).toContainEqual(expect.objectContaining({ portId: '/right', state: 'known', value: text }));
    expect(formatObservedValue(observation.blocks[literal.id])).toBe(text);
    expect(observation.blocks[read.id].state).toBe(text === 'unknown' ? 'cant-tell' : text === 'unavailable' ? 'unavailable' : 'known');
    expect(displayValue(observation.blocks[read.id].result, { name: 'HA state' }, observation.blocks[read.id]))
      .toBe(text === 'unknown' ? "Can't tell" : text === 'unavailable' ? 'Unavailable' : text);
    expect(formatObservedValue(observation.results?.[graph.roots[0].nodeId])).toBe('Yes');
    expect(run.outputs[0].result).toEqual({ kind: 'condition', answer: 'yes' });
  });
  it.each([
    [25, { name: 'Bedroom', unit: '°C' }, '25.0 °C'],
    ['2026-11-18', { name: 'Today', format: 'date' as const }, 'Nov 18, 2026'],
  ])('preserves unit and date presentation for observed value %s', (value, presentation, expected) => {
    const graph = lift({ type: 'literal', value }, { kind: 'operand' }).graph;
    const program = createSimulationProgram([graph]), run = runSimulation(program, simulationFixture().held);
    const observation = canvasObservations(program, run);
    expect(displayValue(run.outputs[0].result, presentation, observation.results?.[graph.roots[0].nodeId])).toBe(expected);
  });
  it('formats units, unknowns, local clock and change times without IDs or ISO timestamps', () => {
    expect(displayValue({ kind: 'operand', answer: { status: 'value', value: 25 } }, { name: 'Bedroom', unit: '°C' })).toBe('25.0 °C');
    expect(displayValue({ kind: 'condition', answer: 'unknown' })).toBe("Can't tell");
    expect(displayValue({ kind: 'operand', answer: { status: 'value', value: 'unknown' } })).toBe("Can't tell");
    expect(localTime('2026-11-18T23:30:00')).toBe('11:30 PM');
    expect(changedAgo('2026-11-18T23:59:47Z', '2026-11-18T23:59:59Z')).toBe('changed 12 seconds ago');
    expect(editClock({ now: '2026-11-18T23:59:59', utcOffsetMinutes: 330 }, '2026-11-19', '00:00')).toEqual({ now: '2026-11-19T00:00:00', utcOffsetMinutes: 330 });
    expect(editClock({ now: '2026-11-18T23:59:59', utcOffsetMinutes: 0 }, '2026-02-30', '12:00')).toBeUndefined();
  });
  it('projects actual output ports with local/scenario provenance, unavailable state and unchanged answers/costs', () => {
    const { program, held, bedroomPin, offline, blockNames } = simulationFixture();
    const local = runSimulation(program, held, { pins: [bedroomPin] }), before = JSON.stringify(local);
    const observed = canvasObservations(program, local, { pins: [bedroomPin] });
    expect(observed.blocks[bedroomPin.blockId]).toMatchObject({ observed: true, source: 'pinned', mode: 'Simulated', state: 'known', value: 25,
      ports: expect.arrayContaining([expect.objectContaining({ direction: 'output', source: 'pinned', value: 25 })]) });
    const root = program.roots[0], add = root.graph.nodes.find(node => blockNames[node.id] === 'Add'
      && root.graph.edges.some(edge => edge.to.nodeId === node.id && blockNames[edge.from.nodeId] === 'Bedroom'))!;
    expect(observed.blocks[add.id]).toMatchObject({ source: 'mixed', ports: expect.arrayContaining([
      expect.objectContaining({ direction: 'input', portId: '/args/0', source: 'live', mode: 'Live', value: 23.6 }),
      expect.objectContaining({ direction: 'input', portId: '/args/1', source: 'pinned', mode: 'Simulated', value: 25 }),
    ]) });
    expect(JSON.stringify(local)).toBe(before);
    const scenario = canvasObservations(program, runSimulation(program, held, { scenario: offline }), { scenario: offline, pins: offline.pins });
    expect(scenario.blocks[bedroomPin.blockId]).toMatchObject({ source: 'scenario', state: 'unavailable' });
    expect(scenario.blocks[add.id]).toMatchObject({ state: 'cant-tell', ports: expect.arrayContaining([
      expect.objectContaining({ direction: 'input', portId: '/args/1', source: 'scenario', state: 'unavailable' }),
    ]) });
    const living = program.roots[0].graph.nodes.find(node => blockNames[node.id] === 'Living Room')!;
    expect(scenario.blocks[living.id]).toMatchObject({ source: 'live', freshness: 'captured', pinned: false });
    const liveBlocks = new Set([bedroomPin.blockId]);
    const restored = canvasObservations(program, runSimulation(program, held, { scenario: offline, liveBlocks }), {
      scenario: offline, liveBlocks, freshness: 'held',
    });
    expect(restored.blocks[add.id].ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: 'input', portId: '/args/0', source: 'live', freshness: 'captured', value: 23.6 }),
      expect.objectContaining({ direction: 'input', portId: '/args/1', source: 'live', freshness: 'held', value: 21.9 }),
    ]));
    const plain = canvasObservations(program, runSimulation(program, held, { observe: false }));
    expect(plain.blocks[bedroomPin.blockId]).toMatchObject({ observed: false, state: 'not-observed' });
    expect(plain.order).toEqual([]);
  });
  it('uses the authored zone across daylight-saving edges and can return a scenario clock to held Live', () => {
    const base = { now: '2026-03-07T12:00:00', utcOffsetMinutes: -480 };
    expect(editClock(base, '2026-03-08', '02:30', 'America/Los_Angeles')).toBeUndefined();
    expect(editClock(base, '2026-03-08', '03:30', 'America/Los_Angeles')).toEqual({ now: '2026-03-08T03:30:00', utcOffsetMinutes: -420 });
    const { program, held, offline } = simulationFixture(true);
    const scenario = { ...offline, clock: { now: '2026-11-19T00:00:00', utcOffsetMinutes: 0 } };
    const pinned = runSimulation(program, held, { scenario }), live = runSimulation(program, held, { scenario, liveClock: true });
    expect(pinned.outputs.find(output => output.output.id === 'today')?.result).toMatchObject({ answer: { value: '2026-11-19' } });
    expect(live.outputs.find(output => output.output.id === 'today')?.result).toMatchObject({ answer: { value: '2026-11-18' } });
    expect(live.modified).toBe(true);
  });
  it('reports a kept value only with an observed unanswered expression and the actual native resolved seed', () => {
    const { program, held, offline } = simulationFixture(true);
    const run = runSimulation(program, held, { scenario: offline });
    const subtitle = program.roots.find(root => root.anchor.id === 'subtitle')!.graph.roots[0].nodeId;
    const options = { scenario: offline, pins: offline.pins, previousText: offline.base.previousText };
    expect(canvasObservations(program, run, options).blocks[subtitle]).toMatchObject({ value: 'Too Warm', kept: true });
    const live = canvasObservations(program, runSimulation(program, held), { previousText: held.base.previousText });
    expect(live.blocks[subtitle]).toMatchObject({ value: 'Comfortable', kept: false });
    const unobserved = canvasObservations(program, runSimulation(program, held, { scenario: offline, observe: false }), options);
    expect(unobserved.blocks[subtitle].kept).toBeUndefined();
    const cut = { ...run, outputs: run.outputs.map(output => ({ ...output, trace: { ...output.trace, truncated: true,
      events: output.trace.events.filter(event => event.pointer !== '/value') } })) };
    expect(canvasObservations(program, cut, options).blocks[subtitle].kept).toBeUndefined();
  });
});
