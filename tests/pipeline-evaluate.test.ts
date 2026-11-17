import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusCaseFile } from './corpusCase';
import {
  PIPELINE_BUDGET, evaluateParameters, evaluatePipeline, evaluateWhere, evaluateOperand, Meter, OverBudget, resolveServiceCall, runStep,
  type FlowContext, type PipelineInputs, type PipelineOperand, type PipelineStep,
} from '../src/shared/composition/pipeline';
import type { Json } from '../src/shared/types';

const clock = { now: '2026-11-15T09:30:00', utcOffsetMinutes: -480 };
const context: FlowContext = { clock, viewer: { userId: 'user-1', isAdmin: false, personEntityId: 'person.demo_alex' } };
const lit = (value: Json): PipelineOperand => ({ type: 'literal', value });
const item = (...path: string[]): PipelineOperand => ({ type: 'item', path });
const meter = () => new Meter(PIPELINE_BUDGET);
const scope = (value?: Json) => ({ item: value, params: new Map<string, Json>() });
/** An accepted case lives under `accept/`; a refusal under `reject/`. */
const corpusFile = (name: string) => corpusCaseFile(path.resolve(__dirname, '../contract/corpus'), `pipeline-${name}`);
const accepted = (name: string) => JSON.parse(readFileSync(corpusFile(name), 'utf8')).document.dataSources.at(-1).inputs as PipelineInputs;

describe('evaluating operands', () => {
  const run = (operand: PipelineOperand, value?: Json, ctx = context) => evaluateOperand(operand, scope(value), ctx, meter());
  it('reads the item by path, and a missing step is null', () => {
    expect(run(item('a', 'b'), { a: { b: 1 } })).toBe(1);
    expect(run(item('a', 'b'), { a: 5 })).toBeNull();
    expect(run(item(), 'whole')).toBe('whole');
    expect(run(item('a'))).toBeNull();
    expect(run(item('__proto__'), {})).toBeNull();
    expect(run(item('constructor'), {})).toBeNull();
  });
  it('reads the viewer and the clock', () => {
    expect(run({ type: 'viewer', field: 'userId' })).toBe('user-1');
    expect(run({ type: 'viewer', field: 'isAdmin' })).toBe(false);
    expect(run({ type: 'viewer', field: 'userId' }, undefined, { clock })).toBeNull();
    expect(run({ type: 'clock', part: 'today' })).toBe('2026-11-15');
  });
  it('coerces a read to its kind and gives null for a value of the wrong kind', () => {
    const asRead = (as: 'string' | 'number' | 'boolean' | 'entity-id', value: Json | undefined) => evaluateOperand(
      { type: 'read', from: { type: 'source', sourceId: 's', path: ['state'] }, as, missing: 'unavailable' }, scope(), { clock, read: () => value }, meter());
    expect(asRead('number', '3.5')).toBe(3.5);
    expect(asRead('number', 'abc')).toBeNull();
    expect(asRead('number', undefined)).toBeNull();
    expect(asRead('boolean', 'true')).toBe(true);
    expect(asRead('boolean', 'on')).toBeNull();
    expect(asRead('string', 4)).toBeNull();
    expect(asRead('entity-id', 'todo.demo')).toBe('todo.demo');
    expect(asRead('entity-id', 'Todo Demo')).toBeNull();
  });
  it('compares map cases by NFC text and by number', () => {
    const map = (of: Json): PipelineOperand => ({ type: 'map', of: lit(of), cases: [{ equals: '\u00e9', then: lit('yes') }, { equals: 2, then: lit('two') }], otherwise: lit('no') });
    expect(run(map('e\u0301'))).toBe('yes');
    expect(run(map(2))).toBe('two');
    expect(run(map('2'))).toBe('two');
    expect(run(map(3))).toBe('no');
    expect(run(map(null))).toBeNull();
  });
  it('spends one unit per node', () => {
    const counted = new Meter(100);
    evaluateOperand({ type: 'math', op: 'add', args: [lit(1), lit(2)] }, scope(), context, counted);
    expect(counted.spent).toBe(3);
  });
  it('throws the budget error, and only that, past the limit', () => {
    expect(() => evaluateOperand({ type: 'math', op: 'add', args: [lit(1), lit(2)] }, scope(), context, new Meter(2))).toThrow(OverBudget);
  });
  it('evaluates every part of all and any, in a fixed cost', () => {
    const first: PipelineOperand = lit(1);
    const where = { type: 'any' as const, of: [{ type: 'exists' as const, value: first }, { type: 'exists' as const, value: first }] };
    const counted = new Meter(100);
    expect(evaluateWhere(where, scope(), context, counted)).toBe(true);
    expect(counted.spent).toBe(5);
  });
});

describe('evaluating steps', () => {
  const step = (value: PipelineStep, input: Json) => runStep(value, input, scope(), context, meter());
  it('gives the empty result of its kind when it meets the wrong kind of value', () => {
    expect(step({ id: 'a', op: 'filter', where: { type: 'exists', value: item() } }, 'x')).toEqual([]);
    expect(step({ id: 'a', op: 'sort', by: [{ value: item(), direction: 'ascending', kind: 'text' }] }, null)).toEqual([]);
    expect(step({ id: 'a', op: 'limit', count: 2 }, { a: 1 })).toEqual([]);
    expect(step({ id: 'a', op: 'count' }, 'x')).toBe(0);
    expect(step({ id: 'a', op: 'sum', value: item() }, 5)).toBe(0);
    expect(step({ id: 'a', op: 'first' }, {})).toBeNull();
    expect(step({ id: 'a', op: 'flatten', path: [] }, 4)).toEqual([]);
    expect(step({ id: 'a', op: 'unique', by: item() }, null)).toEqual([]);
    expect(step({ id: 'a', op: 'group', by: item() }, 'x')).toEqual([]);
    expect(step({ id: 'a', op: 'map', fields: { a: item() } }, 'x')).toBeNull();
    expect(step({ id: 'a', op: 'default', path: ['a'], value: lit(1) }, 'x')).toBe('x');
    expect(step({ id: 'a', op: 'get', path: ['a'] }, [1])).toBeNull();
    expect(step({ id: 'a', op: 'select-key', key: lit(1) }, { a: 1 })).toBeNull();
  });
  it('does not change its input', () => {
    const input = [{ n: 3, k: null }, { n: 1, k: 'a' }];
    const copy = structuredClone(input);
    step({ id: 'a', op: 'sort', by: [{ value: item('n'), direction: 'ascending', kind: 'number' }] }, input);
    step({ id: 'a', op: 'default', path: ['k'], value: lit('z') }, input);
    step({ id: 'a', op: 'map', fields: { n: item('n') } }, input);
    expect(input).toEqual(copy);
  });
  it('sorts by every key in turn, breaks the last tie by position and flips only the direction, never the missing ones', () => {
    const input = [{ a: 1, b: 'y' }, { a: 1, b: 'x' }, { a: null, b: 'a' }, { a: 0, b: 'z' }, { a: 1, b: 'x' }].map((entry, index) => ({ ...entry, index }));
    const sorted = (direction: 'ascending' | 'descending') => (step({ id: 'a', op: 'sort', by: [
      { value: item('a'), direction, kind: 'number' }, { value: item('b'), direction: 'ascending', kind: 'text' }] }, input) as { index: number }[]).map(entry => entry.index);
    expect(sorted('ascending')).toEqual([3, 1, 4, 0, 2]);
    expect(sorted('descending')).toEqual([1, 4, 0, 3, 2]);
  });
  it('groups scalars by kind and text, so 1 and "1" are two groups, and null or a non-scalar is one group', () => {
    const groups = step({ id: 'a', op: 'group', by: item('k') }, [{ k: 1 }, { k: '1' }, { k: true }, { k: 'true' }, { k: { a: 1 } }, { k: null }]) as { key: Json; count: number }[];
    expect(groups.map(entry => [entry.key, entry.count])).toEqual([[1, 1], ['1', 1], [true, 1], ['true', 1], [null, 2]]);
  });
});

describe('evaluating a flow', () => {
  const chores = accepted('upcoming-chores');
  const response: Json = { 'todo.demo_chores': { items: [
    { uid: 'u1', summary: 'Water plants', status: 'needs_action', due: '2026-11-15' },
    { uid: 'u2', summary: 'Sweep', status: 'needs_action', due: '2026-11-18 08:00:00' },
    { uid: 'u3', summary: 'Mow', status: 'needs_action', due: '2026-12-30' },
    { uid: 'u4', summary: 'Old', status: 'needs_action', due: '2026-11-01' },
    { uid: 'u5', summary: 'No date', status: 'needs_action' },
  ] } };

  it('runs the upcoming-chores flow end to end, with a trace of what each step left', () => {
    const result = evaluatePipeline(chores, response, { ...context, viewer: { userId: 'user-9' } });
    expect(result).toMatchObject({ status: 'ok', output: [
      { id: 'u1', title: 'Water plants', subtitle: 'Due today' }, { id: 'u2', title: 'Sweep', subtitle: 'Due in 3 days' },
    ] });
    if (result.status !== 'ok') throw new Error('over budget');
    expect(result.trace).toEqual([
      { id: 'entry', op: 'select-key', size: null }, { id: 'items', op: 'get', size: 5 }, { id: 'soon', op: 'filter', size: 2 },
      { id: 'soonest', op: 'sort', size: 2 }, { id: 'few', op: 'limit', size: 2 }, { id: 'shape', op: 'map', size: 2 },
    ]);
  });

  it('takes its parameter from the viewer, so another person reads another list', () => {
    expect(resolveServiceCall(chores, { ...context, viewer: { userId: 'user-1' } })).toEqual({
      domain: 'todo', service: 'get_items', target: { entity_id: 'todo.demo_chores_alex' }, data: { status: ['needs_action'] },
    });
    expect(resolveServiceCall(chores, { ...context, viewer: { userId: 'user-9' } })?.target).toEqual({ entity_id: 'todo.demo_chores' });
    expect(resolveServiceCall(chores, { clock })?.target).toEqual({});
    expect(resolveServiceCall(accepted('expired-food'), context)).toBeUndefined();
  });

  it('leaves out a target or data key whose value is missing', () => {
    const inputs = structuredClone(chores);
    if (inputs.request.type !== 'service-response') throw new Error('not a service');
    inputs.request.data = { type: 'object', fields: { status: { type: 'viewer', field: 'personEntityId' }, keep: lit('x') } };
    expect(resolveServiceCall(inputs, { clock })?.data).toEqual({ keep: 'x' });
    expect(resolveServiceCall(inputs, { clock }, 3)).toBeUndefined();
  });

  it('gives no data, and says which step, when it runs out of budget', () => {
    const other = { ...context, viewer: { userId: 'user-9' } };
    // 3 for the parameter, 2 for select-key, 1 for get, then the filter spends 1 and 5 items, and its first condition goes over.
    expect(evaluatePipeline(chores, response, other, 12)).toEqual({ status: 'over-budget', visits: 13, stepId: 'soon' });
    expect(evaluatePipeline(chores, response, other, 5)).toEqual({ status: 'over-budget', visits: 6, stepId: 'items' });
    expect(evaluatePipeline(chores, response, other, 2)).toEqual({ status: 'over-budget', visits: 3, stepId: null });
    expect(evaluatePipeline(chores, response, other).status).toBe('ok');
  });

  it('evaluates parameters in dependency order and leaves a cycle null instead of looping', () => {
    const cycle = { parameters: [
      { name: 'a', type: 'string' as const, value: { type: 'param' as const, name: 'b' } }, { name: 'b', type: 'string' as const, value: { type: 'param' as const, name: 'a' } },
    ] };
    expect([...evaluateParameters(cycle, context, meter())]).toEqual([['b', null], ['a', null]]);
  });

  it('makes a row of any scalar, drops a row it cannot name and keeps the budget for the output too', () => {
    const inputs = accepted('expired-food');
    const result = evaluatePipeline(inputs, [
      { name: 'Milk', expiry_date: '2026-11-10', location: 'Fridge' }, { name: 'Rice', expiry_date: '2026-11-20', location: 'Pantry' },
      { name: 'Eggs', expiry_date: '2026-11-14', location: 'Fridge', quantity: 6 },
    ], context);
    expect(result).toMatchObject({ status: 'ok', output: [
      { id: 'Milk-2026-11-10', title: 'Milk', subtitle: 'Fridge', value: '5d' }, { id: 'Eggs-2026-11-14', title: 'Eggs', subtitle: 'Fridge', value: '1d' },
    ] });
  });

  it('rebuilds the live chores flow from a to-do push', () => {
    const result = evaluatePipeline(accepted('overdue-chores'), { items: [
      { uid: 'a', summary: 'Water plants', status: 'needs_action', due: '2026-11-14' }, { uid: 'b', summary: 'Sweep', status: 'completed', due: '2026-11-01' },
      { uid: 'c', summary: 'Mow', status: 'needs_action', due: '2026-11-10' }, { uid: 'd', summary: 'Plan', status: 'needs_action' },
    ] }, context);
    expect(result).toMatchObject({ status: 'ok', output: [
      { id: 'c', title: 'Mow', subtitle: '5 days overdue' }, { id: 'a', title: 'Water plants', subtitle: '1 day overdue' },
    ] });
  });
});

describe('totality', () => {
  /** A small deterministic generator, so a failure repeats. */
  function random(seed: number) { let state = seed; return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; }; }
  function junk(next: () => number, depth = 0): Json {
    const pick = Math.floor(next() * (depth > 3 ? 6 : 8));
    switch (pick) {
      case 0: return null;
      case 1: return next() < 0.5;
      case 2: return Math.floor(next() * 200) - 100 + (next() < 0.5 ? 0.5 : 0);
      case 3: return ['', 'a', '2026-11-15', '2026-11-15T10:00:00Z', 'needs_action', 'todo.demo', '\u00e9', 'e\u0301', 'x'.repeat(70)][Math.floor(next() * 9)];
      case 4: return String(Math.floor(next() * 50));
      case 5: return ['uid', 'summary', 'due', 'status', 'items', 'expired_list', 'name', 'expiry_date', 'location'][Math.floor(next() * 9)];
      case 6: return Array.from({ length: Math.floor(next() * 5) }, () => junk(next, depth + 1));
      default: return Object.fromEntries(['uid', 'summary', 'due', 'status', 'items', 'name', 'expiry_date', 'location', 'quantity', 'forecast', 'datetime', 'condition', 'temperature']
        .filter(() => next() < 0.35).map(name => [name, junk(next, depth + 1)]));
    }
  }
  const flows = ['overdue-chores', 'upcoming-chores', 'expired-food', 'forecast-live', 'scalar-read', 'record-read', 'every-step', 'sum', 'parameters'].map(name => [name, accepted(name === 'scalar-read' ? 'scalar-read' : name)] as const);
  it.each(flows)('%s never throws on arbitrary data', (_name, inputs) => {
    const next = random(7);
    for (let round = 0; round < 150; round++) {
      const result = evaluatePipeline(inputs, junk(next), { ...context, read: () => 'x' }, 400);
      expect(['ok', 'over-budget']).toContain(result.status);
    }
  });
  it('is deterministic: the same inputs give the same answer', () => {
    const inputs = accepted('upcoming-chores'), data = { 'todo.demo_chores': { items: [{ uid: 'a', summary: 's', due: '2026-11-16' }] } };
    expect(evaluatePipeline(inputs, data, context)).toEqual(evaluatePipeline(inputs, structuredClone(data), context));
  });
});
