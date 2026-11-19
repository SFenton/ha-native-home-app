import { describe, expect, it } from 'vitest';
import { canvasObservations } from '../../../src/workspace2/logic-simulation/observations';
import { displayValue, editClock, localTime, changedAgo } from '../../../src/workspace2/logic-simulation/presentation';
import { runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { simulationFixture } from './fixture';

describe('human-readable simulation and canvas observation seam', () => {
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
