import { describe, expect, it } from 'vitest';
import { canvasPortObservations } from '../../../src/workspace2/logic-fields/observations';
import { canvasObservations, formatObservedValue, itemContextText } from '../../../src/workspace2/logic-simulation/observations';
import { captureScenario, runSimulation } from '../../../src/workspace2/logic-simulation/engine';
import { nodeFor } from '../../../src/workspace2/logic-simulation/program';
import { todoFlowInputs, todoItemFixture } from './per-item-fixture';

const todayAt = '/steps/1/where/of/2/left/to', itemAt = '/steps/1/where/of/0/left';
const items = [
  { uid: 'demo-first', summary: 'First task', status: 'needs_action', due: '2026-11-20' },
  { uid: 'demo-second', summary: 'Older task', status: 'needs_action', due: '2026-11-19' },
];
function observe(fixture: ReturnType<typeof todoItemFixture>, options: Parameters<typeof runSimulation>[2] = {}) {
  const run = runSimulation(fixture.program, fixture.held, options);
  const values = canvasObservations(fixture.program, run, {
    scenario: options.scenario, pins: [...options.scenario?.pins ?? [], ...options.pins ?? []], localPins: options.pins,
    clockPinned: Boolean(options.clock || options.scenario?.clock), localClockPinned: Boolean(options.clock),
  });
  const at = (pointer: string) => values.blocks[nodeFor(fixture.program.roots[0], pointer)!.id];
  return { run, values, at, ports: canvasPortObservations(values) };
}
describe('per-item observations', () => {
  it('shows the real clock, constants and pure expressions on empty input without changing runtime answers, costs or execution evidence', () => {
    const inputs = todoFlowInputs();
    const filter = inputs.steps[1];
    if (filter.op !== 'filter' || filter.where.type !== 'all') throw new Error('Expected the todo filter.');
    filter.where.of.push(
      { type: 'exists', value: { type: 'clock', part: 'now' } },
      { type: 'compare', op: 'above', left: { type: 'date', op: 'days-between', from: { type: 'literal', value: '2026-11-19' }, to: { type: 'clock', part: 'today' } }, right: { type: 'math', op: 'add', args: [{ type: 'literal', value: 0 }, { type: 'literal', value: 1 }] } },
    );
    const fixture = todoItemFixture([], inputs), { run, at, ports } = observe(fixture);
    const plain = runSimulation(fixture.program, fixture.held, { observe: false });
    expect(run.outputs[0].flow).toEqual(plain.outputs[0].flow);
    expect(run.outputs[0].trace.events.some(event => event.pointer === todayAt)).toBe(false);
    // Step callbacks, unlike expression callbacks, are real execution evidence even for an empty list.
    expect(run.outputs[0].trace.steps.find(step => step.id === 'late')).toMatchObject({ before: 0, after: 0 });
    expect(at(todayAt)).toMatchObject({ observed: true, value: '2026-11-21', source: 'live' });
    expect(at('/steps/1/where/of/3/value').value).toBe('2026-11-21T12:34:56');
    expect(at('/steps/1/where/of/4/left').value).toBe(2);
    expect(at('/steps/1/where/of/4/right').value).toBe(1);
    expect(at('/steps/1/where/of/0/right').value).toBe('needs_action');
    expect(at('/steps/1/where/of/4').value).toBe('yes');
    expect(at(itemAt)).toMatchObject({ observed: false, item: { step: 'Keep overdue tasks', count: 0 } });
    expect(formatObservedValue(at(itemAt))).toBe("Didn't run: no items reached Keep overdue tasks");
    expect(ports[at(itemAt).blockId].outputs?.value).toEqual({ state: 'no-items', item: { step: 'Keep overdue tasks', count: 0 } });
    expect(ports[at('/steps/1/where/of/2/left').blockId].inputs?.['/to']).toMatchObject({ state: 'known', value: '2026-11-21' });
    expect(ports[nodeFor(fixture.program.roots[0], '/steps/1')!.id].inputs?.['/where']).toMatchObject({ state: 'no-items' });
    expect(ports[nodeFor(fixture.program.roots[0], '/output')!.id].inputs?.['/row/title']).toMatchObject({ state: 'no-items' });
    expect(run.outputs[0].perItem?.trace.events.filter(event => event.pointer === todayAt)).toHaveLength(1);
    expect(plain.outputs[0].perItem).toBeUndefined();
  });
  it('uses the first actual item and the count entering each step, with the same independent value', () => {
    const fixture = todoItemFixture(items), { run, at, ports } = observe(fixture);
    expect(at(todayAt).value).toBe('2026-11-21');
    expect(at(itemAt).value).toBe('needs_action');
    expect(at('/steps/1/where/of/2/left/from').value).toBe('2026-11-20');
    expect(at('/steps/3/fields/title').value).toBe('Older task');
    expect(itemContextText(at(itemAt).item)).toBe('Item 1 of 2');
    expect(ports[at(itemAt).blockId].outputs?.value).toMatchObject({ item: { count: 2, index: 0 } });
    expect(run.outputs[0].flow).toEqual(runSimulation(fixture.program, fixture.held, { observe: false }).outputs[0].flow);
  });
  it('uses Scenario and local clock/output pins on empty input, never a made-up Live date', () => {
    const fixture = todoItemFixture();
    const clock = { now: '2026-11-22T00:00:01', utcOffsetMinutes: 330 };
    const scenario = captureScenario(fixture.program, fixture.held, { id: 'demo-clock', name: 'Tomorrow', clock });
    const selected = observe(fixture, { scenario });
    expect(selected.at(todayAt)).toMatchObject({ value: '2026-11-22', source: 'scenario', pinned: true });
    const pinned = observe(fixture, { scenario, clock: { ...clock, now: '2026-11-23T00:00:01' } });
    expect(pinned.at(todayAt)).toMatchObject({ value: '2026-11-23', source: 'pinned' });
    const captured = observe(fixture, { scenario: { ...scenario, clock: undefined } });
    expect(captured.ports[captured.at(todayAt).blockId].outputs?.value).toMatchObject({ source: 'scenario', value: '2026-11-21' });
    const blockId = nodeFor(fixture.program.roots[0], todayAt)!.id;
    const outputPin = { kind: 'output' as const, blockId, portId: 'value', result: { kind: 'operand' as const, answer: { status: 'value' as const, value: '2026-12-01' } } };
    expect(observe(fixture, { pins: [outputPin] }).at(todayAt)).toMatchObject({ value: '2026-12-01', source: 'pinned' });
  });
  it('distinguishes a downstream empty step, generated step names, and unanswered or overridden upstream steps', () => {
    const fixture = todoItemFixture([{ ...items[0], status: 'completed' }], todoFlowInputs(), false), values = observe(fixture);
    expect(values.at(itemAt).observed).toBe(true);
    expect(values.at('/steps/3/fields/title')).toMatchObject({ observed: false, item: { count: 0 } });
    expect(formatObservedValue(values.at('/steps/3/fields/title'))).toContain('no items reached Set Fields');
    const missing = { ...fixture, held: { ...fixture.held, base: { ...fixture.held.base, flowResponses: [] } } };
    expect(formatObservedValue(observe(missing).at(itemAt))).toBe('Not observed');
    const blockId = nodeFor(fixture.program.roots[0], '/steps/2')!.id;
    const skipped = observe(fixture, { pins: [{ kind: 'output', blockId, portId: 'value', result: { kind: 'operand', answer: { status: 'value', value: [] } } }] });
    expect(formatObservedValue(skipped.at(itemAt))).toBe('Not observed');
    expect(skipped.at('/steps/3/fields/title').item?.count).toBe(0);
  });
  it('reuses native parameter coercion and ignores item-looking literal data when determining independence', () => {
    const inputs = todoFlowInputs();
    inputs.parameters = [{ name: 'days', type: 'number', value: { type: 'read', from: { type: 'source', sourceId: 'demo-days', path: ['state'] }, as: 'number', missing: 'unavailable' } }];
    const filter = inputs.steps[1];
    if (filter.op !== 'filter' || filter.where.type !== 'all') throw new Error('Expected the todo filter.');
    filter.where.of.push(
      { type: 'compare', op: 'above', left: { type: 'math', op: 'add', args: [{ type: 'param', name: 'days' }, { type: 'literal', value: 1 }] }, right: { type: 'literal', value: 0 } },
      { type: 'exists', value: { type: 'literal', value: { type: 'item', path: ['not-a-dependency'] } } },
    );
    const initial = todoItemFixture([], inputs), fixture = { ...initial, held: { ...initial.held, base: {
      ...initial.held.base, reads: [{ sourceId: 'demo-days', path: ['state'], answer: { status: 'value' as const, value: '2' } }],
    } } };
    const { at } = observe(fixture);
    expect(at('/steps/1/where/of/3/left').value).toBe(3);
    expect(at('/steps/1/where/of/4/value').observed).toBe(true);
  });
  it('observes pure text choices without treating structural case containers as expressions, and keeps Item Position dependent', () => {
    const inputs = todoFlowInputs(), filter = inputs.steps[1];
    if (filter.op !== 'filter' || filter.where.type !== 'all') throw new Error('Expected the todo filter.');
    filter.where.of.push(
      { type: 'compare', op: 'eq', left: { type: 'map', of: { type: 'literal', value: 1 }, cases: [{
        equals: 1, then: { type: 'format', pattern: 'Date {day}', args: { day: { type: 'clock', part: 'today' } } },
      }], otherwise: { type: 'literal', value: 'Other' } }, right: { type: 'literal', value: 'Date 2026-11-21' } },
      { type: 'compare', op: 'above', left: { type: 'index' }, right: { type: 'literal', value: -1 } },
    );
    const empty = observe(todoItemFixture([], inputs)), populated = observe(todoItemFixture(items, inputs));
    expect(empty.at('/steps/1/where/of/3/left').value).toBe('Date 2026-11-21');
    expect(empty.at('/steps/1/where/of/4/left')).toMatchObject({ observed: false, item: { count: 0 } });
    expect(populated.at('/steps/1/where/of/4/left')).toMatchObject({ value: 0, item: { count: 2, index: 0 } });
  });
  it('uses current canvas labels when a read-only preview lens has stripped annotations', () => {
    const fixture = todoItemFixture([], todoFlowInputs(), false), run = runSimulation(fixture.program, fixture.held);
    const step = nodeFor(fixture.program.roots[0], '/steps/1')!, item = nodeFor(fixture.program.roots[0], itemAt)!;
    const values = canvasObservations(fixture.program, run, { blockNames: { [step.id]: 'Keep overdue tasks, Filter' } });
    expect(formatObservedValue(values.blocks[item.id])).toBe("Didn't run: no items reached Keep overdue tasks");
  });
});
