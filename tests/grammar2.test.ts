import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, evaluatePredicate, loading, unavailable, value, type Environment } from '../src/shared/composition/evaluator';
import { checkOperand, operandKind, operandSchema, type Operand } from '../src/shared/composition/expression';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { typeOperand } from '../src/shared/composition/pipeline/typing';
import { newFacts } from '../src/shared/composition/pipeline';
import { formatNumber, titleCase } from '../src/shared/composition/pipeline/text';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { createEnvironment, houseFrom } from '../src/preview2/projections';
import { environmentFor } from '../src/workspace2/expr/useTryValues';
import type { Json } from '../src/shared/types';

/**
 * The four generic grammar additions the climate controls need (CT1): fixed fraction digits (N1), title case (T1), a list read (A1) and a raw state
 * read (A2). The evaluation and publication corpora pin the answers byte for byte; these tests pin the pieces the corpus cannot: the helpers, the
 * capability each addition needs, the issues, the flow refusal and the Studio's own environments.
 */
type J = Record<string, any>;
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (v: unknown): J => ({ type: 'literal', value: v });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
  { id: 'fan', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') },
  { id: 'lights', kind: 'model', model: 'home-status@1', inputs: { projection: 'lights', format: 'summary', entityIds: [lit('light.demo_study')], awayEntityIds: [] },
    labels: { idle: 'All Off', active: 'On', countSuffix: ' On', loading: 'Loading', unavailable: 'Unavailable', empty: 'No lights', hidden: 'Hidden' } },
];
const exprText = (operand: J): J[] => [{ id: 't', title: 't', type: 'text', layout: { span: 1 }, props: { value: { type: 'expr', value: operand }, style: 'body', unavailableText: 'None' } }];
function compile(operand: J) {
  const document = structuredClone(base.document);
  document.pages[2].components = exprText(operand);
  document.dataSources.push(...sources);
  try { return { capabilities: compileCompositionDocument(document).capabilities, issues: [] as CompositionIssue[] }; }
  catch (error) { if (!(error instanceof CompositionValidationError)) throw error; return { capabilities: [] as string[], issues: error.issues }; }
}
const where = (result: { issues: CompositionIssue[] }) => result.issues.map(issue => `${issue.code} ${issue.pointer.replace('/document/pages/2/components/0/props/value/value', '~')}`);
const env = (reads: Record<string, Json>, extra: Partial<Environment> = {}): Environment => ({
  read: (sourceId, segments) => { const found = reads[`${sourceId}/${segments.join('/')}`]; return found === undefined ? unavailable : value(found); }, ...extra,
});
const run = (operand: J, e: Environment) => evaluateOperand(operand as Operand, e);
const list = (sourceId = 'fan'): J => ({ type: 'source', sourceId, path: ['attributes', 'preset_modes'] });

describe('N1: fixed fraction digits', () => {
  it('keeps zeros down to the minimum and trims the rest', () => {
    expect(formatNumber(72, 1, 1)).toBe('72.0');
    expect(formatNumber(72.5, 3, 1)).toBe('72.5');
    expect(formatNumber(72, 3, 2)).toBe('72.00');
    expect(formatNumber(72.125, 3, 0)).toBe('72.125');
    expect(formatNumber(2.5, 2)).toBe('2.5');
    expect(formatNumber(72.4, 0, 0)).toBe('72');
  });
  it('holds the minimum to the maximum and never prints a negative zero', () => {
    expect(formatNumber(1, 1, 5)).toBe('1.0');
    expect(formatNumber(-0.04, 1, 1)).toBe('0.0');
    expect(formatNumber(-0.04, 0, 0)).toBe('0');
    expect(formatNumber(-3, 1, 1)).toBe('-3.0');
  });
  it('needs sh.pipeline-operands@1, only when the minimum is there', () => {
    expect(compile(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: { number: { maximumFractionDigits: 1 } } })).capabilities).not.toContain('sh.pipeline-operands@1');
    const result = compile(fmt('{t}', { t: read('temp', ['state'], 'number') }, { t: { number: { maximumFractionDigits: 1, minimumFractionDigits: 1 } } }));
    expect(result.issues).toEqual([]);
    expect(result.capabilities).toContain('sh.pipeline-operands@1');
  });
  it('refuses a minimum above the maximum, at the minimum', () => {
    expect(where(compile(fmt('{t}', { t: lit(1) }, { t: { number: { maximumFractionDigits: 1, minimumFractionDigits: 2 } } })))).toEqual(['invalid_combination ~/formats/t/number/minimumFractionDigits']);
  });
  it('is the minimum the format gives when evaluated', () => {
    expect(run(fmt('{t}°F', { t: lit(72) }, { t: { number: { maximumFractionDigits: 1, minimumFractionDigits: 1 } } }), env({})))
      .toEqual(value('72.0°F'));
  });
});

describe('T1: title case', () => {
  it('follows the app\'s state text rule: only _ separates words, only an ASCII first letter changes', () => {
    expect(titleCase('heat_cool')).toBe('Heat Cool');
    expect(titleCase('heat cool')).toBe('Heat cool');
    expect(titleCase('AUTO')).toBe('AUTO');
    expect(titleCase('')).toBe('');
    expect(titleCase('a__b')).toBe('A  B');
    expect(titleCase('élan_vital')).toBe('élan Vital');
    expect(titleCase('2nd_floor')).toBe('2nd Floor');
  });
  it('needs sh.pipeline-operands@1 and a text argument', () => {
    const ok = compile(fmt('{m}', { m: read('fan', ['state']) }, { m: { text: { case: 'title' } } }));
    expect(ok.issues).toEqual([]);
    expect(ok.capabilities).toContain('sh.pipeline-operands@1');
    expect(where(compile(fmt('{m}', { m: read('temp', ['state'], 'number') }, { m: { text: { case: 'title' } } })))).toEqual(['binding_type ~/formats/m']);
  });
  it('draws the text of a number as it is', () => {
    expect(run(fmt('{m}', { m: lit(72) }, { m: { text: { case: 'title' } } }), env({}))).toEqual(value('72'));
  });
  it('refuses another case and a second format on one argument', () => {
    expect(operandSchema.safeParse(fmt('{m}', { m: lit('a') }, { m: { text: { case: 'upper' } } })).success).toBe(false);
    expect(operandSchema.safeParse(fmt('{m}', { m: lit('a') }, { m: { text: { case: 'title' }, number: { maximumFractionDigits: 1 } } })).success).toBe(false);
  });
});

describe('A1: list read', () => {
  const count: J = { type: 'list-count', from: list() }, includes = (needle: J): J => ({ type: 'list-includes', from: list(), value: needle });
  const modes = { 'fan/attributes/preset_modes': ['auto', 'sleep'] as Json };
  it('counts and searches an attribute list', () => {
    expect(run(count, env(modes))).toEqual(value(2));
    expect(run(includes(lit('sleep')), env(modes))).toEqual(value(true));
    expect(run(includes(lit('turbo')), env(modes))).toEqual(value(false));
    expect(operandKind(count as Operand)).toBe('number');
    expect(operandKind(includes(lit('a')) as Operand)).toBe('boolean');
  });
  it('is unavailable when the attribute is missing or is not a list, and loading while it loads', () => {
    expect(run(count, env({}))).toEqual(unavailable);
    expect(run(count, env({ 'fan/attributes/preset_modes': 'auto' }))).toEqual(unavailable);
    expect(run(includes(lit('a')), env({ 'fan/attributes/preset_modes': 'auto' }))).toEqual(unavailable);
    expect(run(count, { read: () => loading })).toEqual(loading);
  });
  it('is a gap (null) in a flow, which has no reads of its own', () => {
    expect(run(count, env(modes, { flow: true }))).toEqual(value(null));
  });
  it('needs sh.list-read@1', () => {
    const result = compile({ type: 'list-count', from: list() });
    expect(result.issues).toEqual([]);
    expect(result.capabilities).toContain('sh.list-read@1');
  });
  it('stands on an entity attribute and nowhere else', () => {
    expect(where(compile({ type: 'list-count', from: { type: 'source', sourceId: 'fan', path: ['state'] } }))).toEqual(['invalid_reference ~/from/path']);
    expect(where(compile({ type: 'list-count', from: { type: 'source', sourceId: 'lights', path: ['attributes', 'x'] } }))).toEqual(['binding_type ~/from/sourceId']);
    expect(where(compile({ type: 'list-count', from: { type: 'source', sourceId: 'none', path: ['attributes', 'x'] } }))).toEqual(['invalid_reference ~/from/sourceId']);
    expect(where(compile({ type: 'list-includes', from: list(), value: lit(['a']) }))).toEqual(['binding_type ~/value']);
  });
  it('is refused inside a flow, in the checker and in the flow\'s typing', () => {
    expect(checkOperand(count as Operand, '', false, true).issues.map(issue => issue.code)).toEqual(['invalid_combination']);
    const facts = newFacts();
    typeOperand(count as Operand, { params: new Map(), allowRead: true, allowViewer: false }, '/o', facts);
    expect(facts.issues.map(issue => issue.code)).toEqual(['invalid_combination']);
  });
  it('reads the state of the house in the Studio\'s environment', () => {
    const document = { dataSources: [{ id: 'fan', kind: 'ha-entity', entityId: lit('fan.demo_bath_fan') }] } as never;
    const house = houseFrom({ states: [{ entityId: 'fan.demo_bath_fan', state: 'on', name: 'Fan', presetModes: ['auto', 'sleep'] }] });
    expect(evaluateOperand(count as Operand, createEnvironment(document, house))).toEqual(value(2));
  });
});

describe('A2: raw state read', () => {
  const raw: J = { type: 'raw-state', sourceId: 'temp' };
  it('gives the state text, unknown and unavailable included, and tells them apart', () => {
    expect(run(raw, { read: () => unavailable, readRaw: () => value('unknown') })).toEqual(value('unknown'));
    expect(run(raw, { read: () => unavailable, readRaw: () => value('unavailable') })).toEqual(value('unavailable'));
    expect(evaluatePredicate({ type: 'compare', op: 'eq', left: raw as Operand, right: { type: 'literal', value: 'unavailable' } }, { read: () => unavailable, readRaw: () => value('unknown') })).toBe('no');
  });
  it('is unavailable for a host without it, and in a flow', () => {
    expect(run(raw, { read: () => value('on') })).toEqual(unavailable);
    expect(run(raw, { read: () => unavailable, readRaw: () => value('on'), flow: true })).toEqual(value(null));
  });
  it('needs sh.raw-state@1 and an entity source', () => {
    const result = compile(raw);
    expect(result.issues).toEqual([]);
    expect(result.capabilities).toContain('sh.raw-state@1');
    expect(where(compile({ type: 'raw-state', sourceId: 'lights' }))).toEqual(['binding_type ~/sourceId']);
    expect(where(compile({ type: 'raw-state', sourceId: 'none' }))).toEqual(['invalid_reference ~/sourceId']);
    expect(operandKind(raw as Operand)).toBe('string');
  });
  it('is refused inside a flow', () => {
    expect(checkOperand(raw as Operand, '', false, true).issues.map(issue => issue.code)).toEqual(['invalid_combination']);
  });
  it('reads the house\'s state as it is, and only a source with no entity is unavailable', () => {
    const document = { dataSources: [{ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') }, { id: 'miss', kind: 'ha-entity', entityId: lit('sensor.demo_absent') }] } as never;
    const stateOf = (state: string) => createEnvironment(document, houseFrom({ states: [{ entityId: 'sensor.demo_bath_temperature', state, name: 'T' }] }));
    for (const state of ['72.5', 'unknown', 'unavailable']) expect(evaluateOperand(raw as Operand, stateOf(state))).toEqual(value(state));
    expect(evaluateOperand({ type: 'raw-state', sourceId: 'miss' }, stateOf('on'))).toEqual(unavailable);
    expect(evaluateOperand(raw as Operand, createEnvironment(document, {}))).toEqual(loading);
  });
  it('keeps unavailable as text when a value is tried as Unavailable', () => {
    const document = { dataSources: [{ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') }] } as never;
    const house = houseFrom({ states: [{ entityId: 'sensor.demo_bath_temperature', state: '72', name: 'T' }] });
    const tries = (kind: 'unavailable' | 'loading' | 'value') => ({ count: 1, overrides: new Map([['sensor.demo_bath_temperature', kind === 'value' ? { kind, value: 'unknown' } : { kind }]]) }) as never;
    expect(evaluateOperand(raw as Operand, environmentFor(document, house, undefined, tries('unavailable')))).toEqual(value('unavailable'));
    expect(evaluateOperand(raw as Operand, environmentFor(document, house, undefined, tries('loading')))).toEqual(loading);
    expect(evaluateOperand(raw as Operand, environmentFor(document, house, undefined, tries('value')))).toEqual(value('unknown'));
  });
});

describe('the pending list', () => {
  it('is sorted, holds only the ids the app does not ship yet, and no longer holds an id the app ships', () => {
    // Native has not taken the map controls (`sh.surface-orientation@1`, `sh.surface-controls@1`) or the style parts yet.
    expect([...pendingCompositionCapabilities]).toEqual(['sh.arc-track@1', 'sh.chart@1', 'sh.choice-icons@1', 'sh.dial@1', 'sh.flow-extras@1', 'sh.grid-state-groups@1', 'sh.linear-gauge@1', 'sh.repeat@1', 'sh.stack@1', 'sh.state-words@1', 'sh.surface-controls@1', 'sh.surface-orientation@1', 'sh.symbol-part@1', 'sh.text-style@1', 'sh.tile-ink-default@1', 'sh.tile-swipe@1']);
    for (const id of ['sh.pipeline@1', 'sh.pipeline-operands@1', 'sh.list-parts@1', 'sh.text-case-words@1', 'sh.solid-appearance@1', 'sh.tile-ink@1', 'sh.list-read@1', 'sh.raw-state@1', 'sh.state-style-fills@1', 'sh.bound-options-read@1', 'sh.tile-disc-rules@1', 'sh.grid-min-columns@1', 'sh.bound-row-parts@1', 'sh.check-face@1']) expect(pendingCompositionCapabilities).not.toContain(id);
    expect([...pendingCompositionCapabilities]).toEqual([...pendingCompositionCapabilities].sort());
  });
});
