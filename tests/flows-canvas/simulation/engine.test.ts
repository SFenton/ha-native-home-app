import { describe, expect, it, vi } from 'vitest';
import { lift } from '../../../src/shared/composition/graph/lift';
import { blockMode, createSimulationProgram, pinProblems } from '../../../src/workspace2/logic-simulation/program';
import { captureScenario, capturedEnvironment, runAll, runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { caseSchema, clockSchema, parseScenarios } from '../../../src/workspace2/logic-simulation/contracts';
import { loadScenarios, saveScenarios } from '../../../src/workspace2/logic-simulation/storage';
import { resultText } from '../../../src/workspace2/logic-simulation/words';
import { resolveText } from '../../../src/shared/composition/evaluator';
import { simulationFixture } from './fixture';
import { nativeContext } from '../graph/fixtures/native';

describe('S-pins immutable Studio overlays', () => {
  it('pins bedroom 25 -> Too Warm, then Live 21.9 without changing captured data or logic', () => {
    const { program, held, bedroomPin } = simulationFixture(), before = JSON.stringify({ program, held });
    const answer = (run: ReturnType<typeof runSimulation>, id: string) => resultText(run.outputs.find(output => output.output.id === id)?.result);
    expect(answer(runSimulation(program, held), 'bedroom')).toBe('21.9');
    const pinned = runSimulation(program, held, { pins: [bedroomPin] });
    expect(pinned.mode).toBe('Simulated'); expect(answer(pinned, 'subtitle')).toBe('Too Warm');
    expect(answer(pinned, 'bedroom')).toBe('25');
    expect(answer(runSimulation(program, held), 'bedroom')).toBe('21.9');
    expect(JSON.stringify({ program, held })).toBe(before);
  });
  it('validates computed pins, records an explicit override and never forges upstream trace values', () => {
    const { program, held } = simulationFixture(), root = program.roots.find(root => root.anchor.id === 'subtitle')!;
    const pin = { kind: 'output' as const, blockId: root.graph.roots[0].nodeId, portId: 'value', result: { kind: 'operand' as const, answer: { status: 'value' as const, value: 'Pinned answer' } } };
    const output = runSimulation(program, held, { pins: [pin] }).outputs.find(output => output.output.id === 'subtitle')!;
    expect(resultText(output.result)).toBe('Pinned answer');
    expect(output.trace.events.filter(event => event.state === 'evaluated')).toHaveLength(0);
    expect(output.trace.events.find(event => event.pointer === '')).toMatchObject({ state: 'overridden', provenance: 'pin' });
    expect(output.trace.events.some(event => event.state === 'skipped')).toBe(true);
    expect(pinProblems(program, [{ ...pin, result: { kind: 'operand', answer: { status: 'value', value: 12 } } }])).not.toEqual([]);
    expect(pinProblems(program, [pin, pin])).toContain('Conflicting pins on the same target.');
    expect(pinProblems(program, [{ ...pin, blockId: 'deleted' }])[0]).toContain('Unresolved');
  });
  it('shares a state pin with raw-state reads, preserving missing and literal unavailable distinctions', () => {
    const { program, held, bedroomPin } = simulationFixture();
    const env = capturedEnvironment(held.base, [bedroomPin], held.base.clock, new Set());
    expect(env.read('bedroom', ['state'])).toEqual(env.readRaw?.('bedroom'));
    expect(capturedEnvironment(held.base, [{ ...bedroomPin, answer: { status: 'value', value: 'unavailable' } }], held.base.clock, new Set()).read('bedroom', ['state']))
      .toEqual({ status: 'value', value: 'unavailable' });
    const offline = { ...bedroomPin, answer: { status: 'value' as const, value: 'unavailable' } };
    expect(pinProblems(program, [offline])).toEqual([]);
    expect(runSimulation(program, held, { pins: [offline] }).outputs.find(output => output.output.id === 'bedroom')?.result)
      .toEqual({ kind: 'operand', answer: { status: 'unavailable' } });
  });
  it('pins real step outputs without executing their upstream prefix or mutating the graph', () => {
    const { program, held } = simulationFixture(), root = program.roots.find(root => root.anchor.id === 'chores-count')!;
    const node = root.graph.nodes.find(node => node.payload.kind === 'step' && node.payload.value.id === 'count')!;
    const pin = { kind: 'output' as const, blockId: node.id, portId: 'value', result: { kind: 'operand' as const, answer: { status: 'value' as const, value: 12 } } };
    expect(pinProblems(program, [pin])).toEqual([]);
    const output = runSimulation(program, held, { pins: [pin] }).outputs.find(output => output.output.id === 'chores-count')!;
    expect(resultText(output.result)).toBe('12');
    expect(output.trace.steps).toEqual([]);
    expect(output.trace.events).toContainEqual(expect.objectContaining({ blockId: node.id, pointer: '/steps/2', state: 'overridden', provenance: 'pin' }));
    expect(root.body.kind === 'flow' && root.body.value.steps).toHaveLength(3);
    expect(pinProblems(program, [{ ...pin, result: { kind: 'operand', answer: { status: 'value', value: 'wrong' } } }])).not.toEqual([]);
  });
  it('labels only dependent blocks Mixed and explicitly restores a scenario source from held Live', () => {
    const { program, held, bedroomPin, scenarios } = simulationFixture();
    const bedroom = program.roots.find(root => root.anchor.id === 'bedroom')!.graph.nodes[0];
    const warning = program.roots.find(root => root.anchor.id === 'warning')!.graph.nodes[0];
    const today = program.roots.find(root => root.anchor.id === 'today')!.graph.nodes[0];
    expect(blockMode(program, bedroom, [bedroomPin], false, false)).toBe('Simulated');
    expect(blockMode(program, warning, [bedroomPin], false, false)).toBe('Mixed');
    expect(blockMode(program, today, [bedroomPin], false, false)).toBe('Live');
    const live = runSimulation(program, held, { scenario: scenarios[0], liveBlocks: new Set([bedroom.id]) });
    expect(resultText(live.outputs.find(output => output.output.id === 'bedroom')?.result)).toBe('21.9');
    expect(resultText(live.outputs.find(output => output.output.id === 'subtitle')?.result)).toBe('Comfortable');
    expect(pinProblems(program, [{ ...bedroomPin, blockId: warning.id }])[0]).toContain('Unresolved');
  });
});
describe('S-scenarios independent offline cases', () => {
  it('does not interpret read/viewer-looking literal data as captured dependencies', () => {
    const graph = lift({ type: 'literal', value: { type: 'read', from: { sourceId: 'not-an-input', path: ['state'] }, as: 'number' } },
      { kind: 'operand', anchor: { kind: 'logic', id: 'data', field: '/body' } }).graph;
    const program = createSimulationProgram([graph]), held = simulationFixture().held;
    expect(program.reads).toEqual([]); expect(program.viewerFields.size).toBe(0);
    const scenario = captureScenario(program, held, { id: 'literal', name: 'Literal data' });
    expect(runAll(program, [scenario], held)[0].status).toBe('Passed');
  });
  it('returns explicit pass/fail/incomplete, uses saved captures, preserves local pin precedence and freezes the clock', () => {
    const { program, held, scenarios, bedroomPin } = simulationFixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    try {
      expect(runAll(program, scenarios, held).map(result => result.status)).toEqual(['Passed', 'Failed', 'Incomplete']);
      expect(fetch).not.toHaveBeenCalled();
      const local = { ...bedroomPin, answer: { status: 'value' as const, value: '20' } };
      const modified = runSimulation(program, held, { scenario: scenarios[0], pins: [local], clock: { now: '2026-11-19T00:00:00', utcOffsetMinutes: 0 } });
      expect(modified.modified).toBe(true);
      expect(resultText(modified.outputs.find(output => output.output.id === 'subtitle')?.result)).toBe('Comfortable');
      expect(resultText(modified.outputs.find(output => output.output.id === 'today')?.result)).toBe('2026-11-19');
      expect(runAll(program, scenarios, { ...held, base: { ...held.base, reads: [] } }).map(result => result.status)).toEqual(['Passed', 'Failed', 'Incomplete']);
    } finally { fetch.mockRestore(); }
  });
  it('captures, saves, reloads and exports only explicit scenario data; quota failure retains the unsaved value', () => {
    const { program, held } = simulationFixture(), memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
    const scenario = captureScenario(program, held, { id: 'captured', name: 'Captured' });
    expect(saveScenarios('document', 'canvas', [scenario], storage).ok).toBe(true);
    expect(loadScenarios('document', 'canvas', storage)).toEqual({ ok: true, value: [scenario] });
    expect([...memory.keys()]).toEqual(['sh-studio.logic-scenarios.v1:document:canvas']);
    const failing = { ...storage, setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); } };
    expect(saveScenarios('document', 'canvas', [scenario], failing)).toMatchObject({ ok: false });
    expect(scenario.name).toBe('Captured');
    expect(loadScenarios('other', 'canvas', { ...storage, getItem: () => { throw new Error('Denied'); } }).ok).toBe(false);
    expect(() => parseScenarios('{"version":1,"scenarios":[],"token":"not-scenario-data"}')).toThrow();
    expect(() => parseScenarios('{"version":1,"version":1,"scenarios":[]}')).toThrow();
    expect(saveScenarios('document', 'canvas', Array.from({ length: 21 }, (_, index) => ({ ...scenario, id: String(index) })), storage).ok).toBe(false);
    expect(saveScenarios('document', 'canvas', [{ ...scenario, fingerprint: 'x'.repeat(256 * 1024) }], storage).ok).toBe(false);
    expect(() => parseScenarios(JSON.stringify({ version: 1, scenarios: [{ ...scenario, base: { ...scenario.base,
      flowResponses: scenario.base.flowResponses.map(flow => ({ ...flow, response: { access_token: 'fixture-only-not-a-real-token' } })) } }] }))).toThrow('credential');
  });
  it('replays a saved Sensor offline keep seed through the actual slot root', () => {
    const context = nativeContext(), from = { type: 'source' as const, sourceId: 'light', path: ['state'] };
    const slot = { type: 'expr' as const, value: { type: 'read' as const, from, as: 'string' as const, missing: 'unavailable' as const }, fallback: 'No reading', whenUnavailable: 'keep' as const };
    const graph = lift(slot, { kind: 'slot', context, anchor: { kind: 'component', id: 'keep', field: context.pointer } }).graph;
    const program = createSimulationProgram([graph]), held = simulationFixture().held;
    const offline = { ...held, base: { ...held.base, reads: [{ sourceId: 'light', path: ['state'], answer: { status: 'unavailable' as const } }],
      flowResponses: [], previousText: [{ output: program.roots[0].anchor, text: 'Previous reading' }] } };
    const scenario = captureScenario(program, offline, { id: 'keep', name: 'Sensor offline' });
    expect(resultText(runSimulation(program, offline, { scenario }).outputs[0].result)).toBe('Previous reading');
    expect(runAll(program, [scenario], held)[0].status).toBe('Passed');
  });
  it('marks changed logic Needs review, blocks unresolved pins and refuses missing/full-list expectations from truncated captures', () => {
    const { program, held, scenarios } = simulationFixture();
    expect(runAll({ ...program, fingerprint: 'changed' }, [scenarios[0]], held)[0].status).toBe('Incomplete');
    const stale = { ...scenarios[0], pins: [{ ...scenarios[0].pins[0], blockId: 'deleted' }] };
    expect(runAll(program, [scenarios[0], stale], held).every(result => result.status === 'Incomplete')).toBe(true);
    const trimmed = { ...scenarios[0], base: { ...scenarios[0].base, flowResponses: scenarios[0].base.flowResponses.map(flow => ({ ...flow, trimmed: true })) } };
    expect(runAll(program, [trimmed], held)[0].status).toBe('Incomplete');
    expect(caseSchema.safeParse({ ...scenarios[0], expected: scenarios[0].expected.map(expected => ({ ...expected, absoluteTolerance: -1 })) }).success).toBe(false);
  });
  it('supports exact/canonical outputs, explicit numeric tolerance and separate keep seeds, including loading and midnight edges', () => {
    const { program, held } = simulationFixture();
    const scenario = captureScenario(program, held, { id: 'numeric', name: 'Numeric' });
    const tolerant = { ...scenario, expected: scenario.expected.map(expected => expected.output.id === 'bedroom' && expected.kind === 'operand'
      ? { ...expected, answer: { status: 'value' as const, value: 22 }, absoluteTolerance: 0.11 } : expected) };
    expect(runAll(program, [tolerant], held)[0].status).toBe('Passed');
    expect(clockSchema.safeParse({ now: '2026-02-30T00:00:00', utcOffsetMinutes: 0 }).success).toBe(false);
    expect(clockSchema.safeParse({ now: '2026-11-18T23:59', utcOffsetMinutes: 0 }).success).toBe(false);
    const slot = { type: 'expr' as const, value: { type: 'read' as const, from: { type: 'source' as const, sourceId: 'offline', path: ['state'] }, as: 'string' as const, missing: 'unavailable' as const }, fallback: 'No reading', whenUnavailable: 'keep' as const };
    const env = capturedEnvironment({ ...held.base, previousText: [{ output: program.roots[0].anchor, text: 'Previous reading' }] }, [], held.base.clock, new Set());
    expect(resolveText(slot, env, 'Previous reading')).toEqual({ status: 'value', value: 'Previous reading' });
    expect(resolveText(slot, env)).toEqual({ status: 'value', value: 'No reading' });
  });
});
describe('S-trace actual evidence', () => {
  it('observes each real iteration and filter reason with actual counts, without changing answers or flow costs', () => {
    const { program, held } = simulationFixture();
    const plain = runSimulation(program, held, { observe: false }), observed = runSimulation(program, held);
    expect(observed.outputs.map(output => output.result)).toEqual(plain.outputs.map(output => output.result));
    expect(observed.outputs.map(output => output.flow)).toEqual(plain.outputs.map(output => output.flow));
    expect(observed.outputs.map(output => output.source)).toEqual(plain.outputs.map(output => output.source));
    const count = observed.outputs.find(output => output.output.id === 'chores-count')!;
    expect(resultText(count.result)).toBe('6');
    expect(count.trace.steps.find(step => step.id === 'keep')).toMatchObject({ before: 8, after: 6 });
    expect(count.trace.iterations.filter(row => row.reason.startsWith('Condition Yes'))).toHaveLength(6);
    expect(count.trace.iterations.filter(row => row.reason.startsWith('Condition No'))).toHaveLength(2);
    expect(observed.outputs.find(output => output.output.id === 'chores-display')?.trace.steps.find(step => step.id === 'first-five')).toMatchObject({ before: 6, after: 5 });
    const lights = observed.outputs.find(output => output.output.id === 'lights')!;
    expect(lights.trace.iterations.map(row => row.reason)).toEqual(['Yes - counted', 'No - not counted', 'Viewer excluded']);
    expect(lights.trace.iterations.map(row => row.index)).toEqual([0, 1, 2]);
    expect(lights.trace.iterations[0]).toMatchObject({ identity: 'lamp', reads: [{ sourceId: 'lamp', path: ['state'], answer: { status: 'value', value: 'on' } }] });
    expect(lights.trace.iterations[2].reads).toBeUndefined();
  });
});
