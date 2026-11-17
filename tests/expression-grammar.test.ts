import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { resolveLook, type Environment } from '../src/shared/composition/evaluator';
import { checkOperand, checkPredicate, operandKind, type Operand, type Predicate } from '../src/shared/composition/expression';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { Meter, OverBudget, evaluateOperand, entityRows, type FlowContext } from '../src/shared/composition/pipeline';
import { appStateFields, appStateTopics } from '../src/shared/composition/app-state';

type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (value: unknown): J => ({ type: 'literal', value });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const cmp = (op: string, left: J, right: J): J => ({ type: 'compare', op, left, right });
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  { id: 'lights', kind: 'model', model: 'home-status@1', inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
    labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' } },
  ...appStateTopics.map(topic => ({ id: `app-${topic}`, kind: 'model', model: 'app-state@1', inputs: { topic } })),
];
const text = (extra: J, value: J = lit('Shown')): J => ({ id: 't', title: 't', type: 'text', layout: { span: 1 }, props: { value, style: 'body', unavailableText: 'None' }, ...extra });
function compile(components: J[], more: J[] = sources) {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...more);
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] as CompositionIssue[] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [] as string[], issues: error.issues }; }
}
const codes = (result: { issues: CompositionIssue[] }) => result.issues.map(issue => `${issue.code} ${issue.pointer.replace('/document/pages/2/components/0', '~')}`);
const hot = cmp('above', read('temp', ['attributes', 'max'], 'number'), lit(75));

describe('one grammar for conditions and values', () => {
  it('requires nothing new of a document that keeps to the old leaves', () => {
    const result = compile([text({ visibleWhen: { type: 'state', sourceId: 'temp', path: ['state'], in: ['on'] } })]);
    expect(result.issues).toEqual([]);
    expect(result.capabilities).not.toContain('sh.conditions@1');
    expect(result.capabilities).not.toContain('sh.rules@1');
  });
  it('names sh.conditions@1 for compare, in and exists, and sh.rules@1 for a rule or an authored string', () => {
    expect(compile([text({ visibleWhen: hot })]).capabilities).toContain('sh.conditions@1');
    expect(compile([text({ visibleWhen: { type: 'exists', value: read('temp', ['attributes', 'x']) } })]).capabilities).toContain('sh.conditions@1');
    const rule = compile([text({}, { type: 'expr', value: { type: 'choose', cases: [{ when: hot, then: lit('a') }], otherwise: lit('b') } })]);
    expect(rule.capabilities).toEqual(expect.arrayContaining(['sh.rules@1', 'sh.conditions@1']));
    expect(compile([text({}, { type: 'expr', value: lit('x') })]).capabilities).toContain('sh.rules@1');
  });
  it('gives the flow-only operands no place outside a flow and the control value no place in one', () => {
    expect(codes(compile([text({ visibleWhen: cmp('eq', { type: 'item', path: ['a'] }, lit('x')) })]))).toEqual(['invalid_combination ~/visibleWhen/left']);
    expect(checkOperand({ type: 'item', path: ['a'] }, '', false, true).issues).toEqual([]);
    expect(checkOperand({ type: 'control' }, '', true, true).issues.map(issue => issue.code)).toEqual(['invalid_combination']);
  });
  it('limits a rule to 16 cases, and a condition inside a flow or a rule to 32 nodes and depth 6, while a document predicate keeps the shipped depth of 8', () => {
    const deep = (levels: number): Predicate => { let leaf: Predicate = cmp('eq', lit(1), lit(1)) as Predicate; for (let i = 1; i < levels; i++) leaf = { type: 'not', of: leaf }; return leaf; };
    expect(checkPredicate(deep(7), '').issues).toEqual([]);
    expect(checkPredicate(deep(7), '', true).issues.map(issue => issue.code)).toEqual(['limit_exceeded']);
    expect(checkPredicate(deep(6), '', true).issues).toEqual([]);
    const wide: Predicate = { type: 'all', of: Array.from({ length: 16 }, () => ({ type: 'any', of: [cmp('eq', lit(1), lit(1)), cmp('eq', lit(1), lit(1))] })) } as Predicate;
    expect(checkPredicate(wide, '', true).issues.map(issue => issue.code)).toContain('limit_exceeded');
  });
  it('tells the kind of a rule from its branches', () => {
    expect(operandKind({ type: 'choose', cases: [{ when: hot as Predicate, then: lit('a') as Operand }], otherwise: lit('b') as Operand })).toBe('string');
    expect(operandKind(lit(null) as Operand)).toBeUndefined();
    expect(operandKind({ type: 'list', items: [] })).toBe('structure');
  });
});

describe('reading any model', () => {
  it('reads a home status count in a condition, under sh.home-status-counts@1', () => {
    const result = compile([text({ visibleWhen: cmp('above', read('lights', ['count'], 'number'), lit(0)) })]);
    expect(result.issues).toEqual([]);
    expect(result.capabilities).toContain('sh.home-status-counts@1');
  });
  it('reads a home status count in a slot too, and keeps the old fields free of the counts capability', () => {
    expect(compile([text({}, read('lights', ['total'], 'number') as J)]).issues.map(issue => issue.code)).toEqual(['binding_type']);
    expect(compile([text({}, read('lights', ['stateText']))]).capabilities).not.toContain('sh.home-status-counts@1');
  });
  it('refuses a field the model lacks and a model that is not read by name', () => {
    expect(codes(compile([text({ visibleWhen: cmp('eq', read('lights', ['nothing']), lit('a')) })]))).toEqual(['invalid_reference ~/visibleWhen/left/from/path']);
    const unreadable: J = { id: 'rooms', kind: 'model', model: 'room-navigation@1', inputs: {} };
    expect(compile([text({ visibleWhen: { type: 'state', sourceId: 'rooms', path: ['state'], in: ['x'] } })], [...sources, unreadable]).issues.length).toBeGreaterThan(0);
  });
  it('has a topic of app state per concern, none for the kind of device', () => {
    expect([...appStateTopics]).toEqual(['window', 'clock', 'os', 'notifications', 'preferences']);
    expect(Object.keys(appStateFields.window)).toEqual(['widthClass', 'heightClass', 'width', 'height', 'orientation', 'phase']);
    for (const topic of appStateTopics) expect(appStateFields[topic].phase).toBe('string');
    expect(JSON.stringify(appStateFields)).not.toMatch(/idiom|device/);
  });
  it('names sh.app-state@1 for the source and checks each topic read', () => {
    const result = compile([text({ visibleWhen: cmp('eq', read('app-window', ['widthClass']), lit('regular')) })]);
    expect(result.issues).toEqual([]);
    expect(result.capabilities).toContain('sh.app-state@1');
    expect(codes(compile([text({ visibleWhen: cmp('eq', read('app-window', ['hour']), lit('1')) })]))).toEqual(['invalid_reference ~/visibleWhen/left/from/path']);
  });
});

describe('the one evaluator', () => {
  const env: Environment = { read: () => ({ status: 'unavailable' }) };
  it('picks the look of a conditional slot: the first case that holds, else otherwise, and a plain look as it is', () => {
    const red = { type: 'solid-rgb', red: 255, green: 0, blue: 0 }, grey = { type: 'solid-rgb', red: 9, green: 9, blue: 9 };
    const yes = { type: 'compare', op: 'eq', left: lit(1), right: lit(1) } as Predicate, never = { type: 'compare', op: 'eq', left: lit(1), right: lit(2) } as Predicate;
    expect(resolveLook({ type: 'conditional', cases: [{ when: never, then: grey }, { when: yes, then: red }], otherwise: grey }, env)).toBe(red);
    expect(resolveLook({ type: 'conditional', cases: [{ when: never, then: red }], otherwise: grey }, env)).toBe(grey);
    const unknown = { type: 'compare', op: 'eq', left: read('x', ['state']), right: lit(1) } as Predicate;
    expect(resolveLook({ type: 'conditional', cases: [{ when: unknown, then: red }], otherwise: grey }, env)).toBe(grey);
    expect(resolveLook(red, env)).toBe(red);
  });
  it('spends the flow budget on every operand and condition node, and stops when it runs out', () => {
    const context: FlowContext = { clock: { now: '2026-11-15T09:30:00', utcOffsetMinutes: 0 } };
    const rule = { type: 'choose', cases: [{ when: cmp('eq', lit(1), lit(1)), then: lit('a') }], otherwise: lit('b') } as Operand;
    const meter = new Meter(1000);
    expect(evaluateOperand(rule, { params: new Map() }, context, meter)).toBe('a');
    // choose 1 + condition 1 + two literals in the compare + the chosen branch 1
    expect(meter.spent).toBe(5);
    expect(() => evaluateOperand(rule, { params: new Map() }, context, new Meter(3))).toThrow(OverBudget);
  });
});

describe('the entities request', () => {
  const request = { type: 'entities' as const, entityIds: [lit('light.demo_a'), lit('light.demo_b')] as any, attributes: ['brightness', 'state'] };
  it('gives one row per listed entity in the order listed, with the state and each attribute', () => {
    const rows = entityRows(request, id => id === 'light.demo_a' ? { state: 'on', attributes: { brightness: 200 } } : undefined);
    expect(rows).toEqual([{ entityId: 'light.demo_a', state: 'on', brightness: 200 }, { entityId: 'light.demo_b', state: 'unavailable', brightness: null }]);
  });
});
