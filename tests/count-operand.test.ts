import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, loading, unavailable, value, type Environment } from '../src/shared/composition/evaluator';
import { MAX_COUNT_ENTRIES, MAX_EXPRESSION_NODES, checkOperand, operandKind, operandSchema, type Operand } from '../src/shared/composition/expression';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';

/**
 * The `count` operand (`sh.count@1`). The evaluation and publication corpora (`count-operand-*`) pin the answers byte for byte; these tests pin what
 * they cannot: the cost in nodes, the capability a document needs only when it uses one, the evaluation spend, and that a document without one is untouched.
 */
type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const on = (sourceId: string): J => ({ type: 'state', sourceId, path: ['state'], in: ['on'] });
const names = (total: number) => Array.from({ length: total }, (_, index) => `e${index + 1}`);
const count = (total: number): J => ({ type: 'count', of: names(total).map(name => ({ test: on(name) })) });
const lit = (v: unknown): J => ({ type: 'literal', value: v });
const exprText = (operand: J): J[] => [{ id: 't', title: 't', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None' } }];
function compile(components: J[], sourceNames: string[] = names(32)) {
  const document = structuredClone(base.document);
  document.pages[2].components = components;
  document.dataSources.push(...sourceNames.map(name => ({ id: name, kind: 'ha-entity', entityId: lit(`binary_sensor.demo_${name}`) })));
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] as CompositionIssue[] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [] as string[], issues: error.issues }; }
}
const reading = (states: Record<string, string>): Environment => ({ read: (sourceId, segments) => states[`${sourceId}/${segments.join('/')}`] === undefined ? unavailable : value(states[`${sourceId}/${segments.join('/')}`]) });

describe('count: cost and limits', () => {
  it('is shipped, so it no longer needs a pending capability', () => {
    expect(pendingCompositionCapabilities).not.toContain('sh.count@1');
  });
  it('costs one node plus its tests: 32 entries are 33 nodes of the 64', () => {
    expect(MAX_COUNT_ENTRIES).toBe(32);
    expect(checkOperand(count(32) as Operand, '', false).issues).toEqual([]);
    // 1 for the sum, 33 for the first count and 1 + 29 for the second is 64; one more entry is 65.
    const sum = (second: number): Operand => ({ type: 'math', op: 'add', args: [count(32), count(second)] }) as Operand;
    expect(MAX_EXPRESSION_NODES).toBe(64);
    expect(checkOperand(sum(29), '', false).issues).toEqual([]);
    expect(checkOperand(sum(30), '', false).issues.map(issue => issue.code)).toEqual(['limit_exceeded']);
  });
  it('is a number', () => {
    expect(operandKind(count(2) as Operand)).toBe('number');
  });
  it('refuses no entries and more than 32 at the schema, and a person that is not a person', () => {
    expect(operandSchema.safeParse({ type: 'count', of: [] }).success).toBe(false);
    expect(operandSchema.safeParse(count(33)).success).toBe(false);
    expect(operandSchema.safeParse(count(32)).success).toBe(true);
    const filtered = (person: string) => ({ type: 'count', of: [{ test: on('e1'), viewer: { personEntityIds: [person] } }] });
    expect(operandSchema.safeParse(filtered('person.demo_sam')).success).toBe(true);
    expect(operandSchema.safeParse(filtered('light.demo_sam')).success).toBe(false);
  });
});

describe('count: capability', () => {
  it('declares sh.count@1 only when a document uses a count', () => {
    expect(compile(exprText(count(3))).capabilities).toContain('sh.count@1');
    expect(compile(exprText(lit('hello'))).capabilities).not.toContain('sh.count@1');
  });
  it('reports a malformed count by its own issue, not as the profile count node', () => {
    expect(compile(exprText({ type: 'count', of: [] })).issues.map(issue => issue.code)).toEqual(['limit_exceeded']);
    // The profile `count` node (an id, a layout) is still the unsupported `sh.profile-count@1`.
    const node = { id: 'n', title: 'n', type: 'count', layout: { span: 1 }, props: {} };
    expect(compile([node]).issues[0]).toMatchObject({ code: 'unsupported_capability', capability: 'sh.profile-count@1' });
  });
  it('is refused inside a Data Flow', () => {
    expect(checkOperand(count(2) as Operand, '', false, true).issues.map(issue => issue.code)).toContain('invalid_combination');
  });
});

describe('count: evaluation', () => {
  it('is evaluated once: one spend for the operand and one for each test', () => {
    let spent = 0;
    const env: Environment = { ...reading({ 'e1/state': 'on', 'e2/state': 'off', 'e3/state': 'on' }), spend: () => { spent += 1; } };
    expect(evaluateOperand(count(3) as Operand, env)).toEqual(value(2));
    expect(spent).toBe(4);
  });
  it('does not read an entity whose entry the viewer is not in', () => {
    const asked: string[] = [];
    const env: Environment = { read: (sourceId) => { asked.push(sourceId); return value('on'); }, viewer: { personEntityId: 'person.demo_alex' } };
    const operand = { type: 'count', of: [{ test: on('e1'), viewer: { personEntityIds: ['person.demo_sam'] } }, { test: on('e2') }] } as Operand;
    expect(evaluateOperand(operand, env)).toEqual(value(1));
    expect(asked).toEqual(['e2']);
  });
  it('is loading with no viewer yet only when an entry has a filter', () => {
    const filtered = { type: 'count', of: [{ test: on('e1'), viewer: { personEntityIds: ['person.demo_sam'] } }] } as Operand;
    const env = reading({ 'e1/state': 'on' });
    expect(evaluateOperand(filtered, env)).toEqual(loading);
    expect(evaluateOperand(count(1) as Operand, env)).toEqual(value(1));
  });
  it('says loading when every entry waits on a source that is loading, and unavailable when a source is missing', () => {
    expect(evaluateOperand(count(2) as Operand, { read: () => loading })).toEqual(loading);
    expect(evaluateOperand(count(2) as Operand, { read: () => unavailable })).toEqual(unavailable);
  });
  it('is null in a flow, where a document source has no meaning', () => {
    expect(evaluateOperand(count(2) as Operand, { ...reading({ 'e1/state': 'on' }), flow: true })).toEqual(value(null));
  });
});

describe('a document without a count', () => {
  it('compiles as it did: its capabilities do not change', () => {
    const before = compileCompositionDocument(structuredClone(base.document)).capabilities;
    expect(before).toEqual(base.capabilities);
  });
});

describe('count: every read path reports loading', () => {
  const raw = (id: string): Operand => ({ type: 'count', of: [{ test: { type: 'compare', op: 'eq', left: { type: 'raw-state', sourceId: id }, right: lit('on') } }] }) as Operand;
  it('treats raw-state, last-changed and the viewer\'s person state like a read', () => {
    const none: Environment = { read: () => unavailable };
    expect(evaluateOperand(raw('a'), { ...none, readRaw: () => loading })).toEqual(loading);
    expect(evaluateOperand(raw('a'), none)).toEqual(unavailable);
    const changed = { type: 'count', of: [{ test: { type: 'compare', op: 'after', left: { type: 'last-changed', sourceId: 'a' }, right: lit('2026-01-01T00:00:00Z') } }] } as Operand;
    expect(evaluateOperand(changed, { ...none, readChanged: () => loading })).toEqual(loading);
    const person = { type: 'count', of: [{ test: { type: 'viewer-person', in: ['home'] } }] } as Operand;
    expect(evaluateOperand(person, { ...none, viewerPersonState: () => loading })).toEqual(loading);
    expect(evaluateOperand(person, none)).toEqual(unavailable);
  });
  it('treats a viewer not known yet as waiting', () => {
    const admin = { type: 'count', of: [{ test: { type: 'viewer', isAdmin: true } }] } as Operand;
    expect(evaluateOperand(admin, { read: () => unavailable })).toEqual(loading);
    expect(evaluateOperand(admin, { read: () => unavailable, viewer: {} })).toEqual(unavailable);
  });
  it('reports a stray id on an operand as an unknown field, and a profile count node as unsupported', () => {
    expect(compile(exprText({ type: 'count', id: 'x', of: [{ test: on('e1') }] })).issues[0]).toMatchObject({ code: 'unknown_field' });
  });
});
