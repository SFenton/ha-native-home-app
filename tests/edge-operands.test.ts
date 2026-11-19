// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastChangedText } from '../server/native-home';
import { EntityCache } from '../server/ha-live';
import { usePreviewClock, wallClock, readsSecondClock } from '../src/preview2/clock';
import { DEMO_LAST_CHANGED, demoHouse } from '../src/preview2/demo-house';
import { createEnvironment, emptyOverlay, houseFrom } from '../src/preview2/projections';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { formatDuration } from '../src/shared/composition/duration-format';
import { evaluateOperand, evaluatePredicate, loading, unavailable, value, type Environment } from '../src/shared/composition/evaluator';
import { operandKind, operandSchema, type Operand } from '../src/shared/composition/expression';
import { CompositionValidationError, type CompositionIssue } from '../src/shared/composition/json';
import { newFacts, typeOperand } from '../src/shared/composition/pipeline';
import { secondsBetween } from '../src/shared/composition/pipeline/dates';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import { comparisonsFor, fitsSimple, operandForChoice, operandName, readChoiceOf, sourceOfOperand, withLeft, kindOf } from '../src/workspace2/expr/condition';
import { knownAttributes } from '../src/workspace2/expr/appState';
import { attributeOf } from '../src/preview2/projections';
import { newToken, parseLine, writeLine } from '../src/workspace2/expr/tokens';
import { environmentFor } from '../src/workspace2/expr/useTryValues';

/**
 * The four edge-logic ids of `ne-operands`: `sh.entity-time@1` (`last-changed`), `sh.countdown@1` (`seconds-between`, `now-second`), `sh.duration-format@1`
 * and `sh.math-truncate@1`. The evaluation and publication corpora pin the answers byte for byte; these tests pin the pieces the corpus cannot: the helpers,
 * the capability each operand needs, the issues, the flow refusals, the Studio's own environments, the data path from Home Assistant, the editors' words and
 * the preview's timer (it runs once a second only while a document reads `now-second`).
 */
type J = Record<string, any>;
afterEach(cleanup);
const base: J = JSON.parse(readFileSync(path.resolve(__dirname, '../contract/corpus/accept/fixture-composition-first-slice.json'), 'utf8'));
const lit = (v: unknown): J => ({ type: 'literal', value: v });
const read = (sourceId: string, segments: string[], as = 'string'): J => ({ type: 'read', from: { type: 'source', sourceId, path: segments }, as, missing: 'unavailable' });
const fmt = (pattern: string, args: J, formats?: J): J => ({ type: 'format', pattern, args, ...(formats ? { formats } : {}) });
const sources: J[] = [
  { id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') },
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
const run = (operand: J, env: Environment) => evaluateOperand(operand as Operand, env);
const clockAt = (now: string, utcOffsetMinutes = 0) => ({ now, utcOffsetMinutes });
const changedAt = (text: string | undefined): Environment => ({ read: () => unavailable, clock: clockAt('2026-11-17T23:10:05'), readChanged: () => text === undefined ? unavailable : value(text) });

describe('formatDuration', () => {
  it('draws the compact style from seconds, rounding up, and from minutes, rounding to the nearest', () => {
    expect([0, -1, 1, 60, 61, 3600, 3601, 5400].map(n => formatDuration('compact', 'seconds', n))).toEqual([undefined, undefined, '1m', '1m', '2m', '1h', '1h 1m', '1h 30m']);
    expect([0, 0.4, 0.5, 59, 59.5, 90, -2].map(n => formatDuration('compact', 'minutes', n))).toEqual([undefined, undefined, '1m', '59m', '1h', '1h 30m', undefined]);
    expect(formatDuration('compact', undefined, 90)).toBe('2m');
  });
  it('draws the clock and minutes-seconds styles, never below zero', () => {
    expect([300, 3600, 59, 3599, 0, -4, 299.9, 3661, 360000].map(n => formatDuration('clock', undefined, n))).toEqual(['05:00', '01:00:00', '00:59', '59:59', '00:00', '00:00', '04:59', '01:01:01', '100:00:00']);
    expect([270, 0, 4500, 269.1, -3, 59.2].map(n => formatDuration('minutes-seconds', undefined, n))).toEqual(['4:30', '0:00', '75:00', '4:30', '0:00', '1:00']);
  });
  it('draws the span style in the bucket of the size of the number', () => {
    const day = 86400;
    expect([0, 1800, 3600, 5400, 86399, day, 1.4 * day, 20 * day, 21 * day, 59 * day, 60 * day, 90 * day, -2 * 3600].map(n => formatDuration('span', undefined, n)))
      .toEqual(['1 hour', '1 hour', '1 hour', '2 hours', '24 hours', '1 day', '1 day', '20 days', '3 weeks', '8 weeks', '2 months', '3 months', '2 hours']);
  });
  it('has no text for a number that is not finite or is 1e13 or more', () => {
    expect(formatDuration('clock', undefined, Number.NaN)).toBeUndefined();
    expect(formatDuration('span', undefined, 1e13)).toBeUndefined();
    expect(formatDuration('span', undefined, -1e13)).toBeUndefined();
    expect(formatDuration('clock', undefined, 9.9e12)).toBe('2750000000:00:00');
  });
});

describe('secondsBetween', () => {
  it('is whole seconds, signed, on the clock\'s wall', () => {
    expect(secondsBetween('2026-11-17T10:00:00', '2026-11-17T10:05:00', 0)).toBe(300);
    expect(secondsBetween('2026-11-17T10:05:00', '2026-11-17T10:00:00', 0)).toBe(-300);
    expect(secondsBetween('2026-11-17T10:00:00Z', '2026-11-17T12:00:00+02:00', 0)).toBe(0);
    expect(secondsBetween('2026-11-17', '2026-11-18', 0)).toBe(86400);
    expect(secondsBetween('nope', '2026-11-18', 0)).toBeUndefined();
  });
});

describe('the operands', () => {
  it('truncates toward zero, with places 0 to 6, and never gives -0', () => {
    const t = (...args: J[]) => run({ type: 'math', op: 'truncate', args }, { read: () => unavailable });
    expect(t(lit(71.99), lit(1))).toEqual(value(71.9));
    expect(t(lit(-71.99), lit(1))).toEqual(value(-71.9));
    expect(Object.is((t(lit(-0.04), lit(1)) as { value: number }).value, 0)).toBe(true);
    expect(t(lit(2.9))).toEqual(value(2));
    expect(t(lit(0.57), lit(2))).toEqual(value(0.56));
    expect(t(lit(1.5), lit(7))).toEqual(unavailable);
    expect(t(lit(1.5), lit(1.5))).toEqual(unavailable);
    expect(t(lit('hot'))).toEqual(unavailable);
    expect(t(lit(1), lit(1), lit(1))).toEqual(unavailable);
  });
  it('reads the last change as text, and gives a gap for a flow', () => {
    const op = { type: 'last-changed', sourceId: 'temp' };
    expect(run(op, changedAt('2026-11-17T21:30:00.000Z'))).toEqual(value('2026-11-17T21:30:00.000Z'));
    expect(run(op, changedAt(undefined))).toEqual(unavailable);
    expect(run(op, { read: () => unavailable })).toEqual(unavailable);
    expect(run(op, { read: () => unavailable, readChanged: () => value(5) })).toEqual(unavailable);
    expect(run(op, { read: () => unavailable, readChanged: () => loading })).toEqual(loading);
    expect(run(op, { ...changedAt('2026-11-17T21:30:00.000Z'), flow: true })).toEqual(value(null));
  });
  it('gives the wall time to the second for now-second, and counts the seconds to a moment', () => {
    const env: Environment = { read: () => value('2026-11-17T10:05:00+00:00'), clock: clockAt('2026-11-17T10:00:07') };
    expect(run({ type: 'clock', part: 'now-second' }, env)).toEqual(value('2026-11-17T10:00:07'));
    expect(run({ type: 'clock', part: 'now-second' }, { read: () => unavailable })).toEqual(unavailable);
    expect(run({ type: 'date', op: 'seconds-between', from: { type: 'clock', part: 'now-second' }, to: read('timer', ['attributes', 'finishes_at']) }, env)).toEqual(value(293));
    expect(evaluatePredicate({ type: 'compare', op: 'before', left: { type: 'clock', part: 'now-second' }, right: lit('2026-11-17T10:00:08') } as never, env)).toBe('yes');
  });
  it('draws a duration through a format, and leaves the format without text when there is none', () => {
    const draw = (n: J, spec: J) => run(fmt('Off in {n}', { n }, { n: spec }), { read: () => unavailable });
    expect(draw(lit(300), { duration: { style: 'clock' } })).toEqual(value('Off in 05:00'));
    expect(draw(lit(0), { duration: { style: 'compact', unit: 'seconds' } })).toEqual(unavailable);
    expect(draw(lit('soon'), { duration: { style: 'clock' } })).toEqual(unavailable);
    expect(draw(lit('90'), { duration: { style: 'clock' } })).toEqual(value('Off in 01:30'));
  });
  it('types each as the kind it gives', () => {
    expect(operandKind({ type: 'last-changed', sourceId: 'temp' })).toBe('string');
    expect(operandKind({ type: 'clock', part: 'now-second' })).toBe('string');
    expect(operandKind({ type: 'date', op: 'seconds-between', from: lit('a'), to: lit('b') } as unknown as Operand)).toBe('number');
    expect(operandKind({ type: 'math', op: 'truncate', args: [lit(1)] } as Operand)).toBe('number');
  });
  it('refuses a second format on one duration argument and an unknown style', () => {
    expect(operandSchema.safeParse(fmt('{m}', { m: lit(1) }, { m: { duration: { style: 'clock' }, number: { maximumFractionDigits: 1 } } })).success).toBe(false);
    expect(operandSchema.safeParse(fmt('{m}', { m: lit(1) }, { m: { duration: { style: 'long' } } })).success).toBe(false);
    expect(operandSchema.safeParse(fmt('{m}', { m: lit(1) }, { m: { duration: { style: 'compact', unit: 'minutes' } } })).success).toBe(true);
  });
});

describe('compiling', () => {
  it('asks for the id each operand needs, and only that', () => {
    expect(compile({ type: 'last-changed', sourceId: 'temp' }).capabilities).toContain('sh.entity-time@1');
    const seconds = compile({ type: 'date', op: 'seconds-between', from: { type: 'clock', part: 'now-second' }, to: lit('2026-11-17T10:00:00') });
    expect(seconds.issues).toEqual([]);
    expect(seconds.capabilities).toEqual(expect.arrayContaining(['sh.countdown@1', 'sh.pipeline-operands@1']));
    expect(compile({ type: 'clock', part: 'now-second' }).capabilities).toContain('sh.countdown@1');
    expect(compile(fmt('{m}', { m: lit(5) }, { m: { duration: { style: 'clock' } } })).capabilities).toContain('sh.duration-format@1');
    expect(compile({ type: 'math', op: 'truncate', args: [lit(1.5), lit(1)] }).capabilities).toContain('sh.math-truncate@1');
    for (const id of ['sh.entity-time@1', 'sh.countdown@1', 'sh.duration-format@1', 'sh.math-truncate@1']) {
      expect(compile({ type: 'math', op: 'round', args: [lit(1.5)] }).capabilities).not.toContain(id);
      expect(compile({ type: 'clock', part: 'now' }).capabilities).not.toContain(id);
      expect(pendingCompositionCapabilities).not.toContain(id);
    }
  });
  it('puts the last change on an entity source only', () => {
    expect(where(compile({ type: 'last-changed', sourceId: 'lights' }))).toEqual(['binding_type ~/sourceId']);
    expect(where(compile({ type: 'last-changed', sourceId: 'nowhere' }))).toEqual(['invalid_reference ~/sourceId']);
  });
  it('holds a duration to a number, and its unit to a compact style', () => {
    expect(where(compile(fmt('{m}', { m: lit('soon') }, { m: { duration: { style: 'clock' } } })))).toEqual(['binding_type ~/formats/m']);
    expect(where(compile(fmt('{m}', { m: lit(5) }, { m: { duration: { style: 'span', unit: 'minutes' } } })))).toEqual(['invalid_combination ~/formats/m/duration/unit']);
    expect(compile(fmt('{m}', { m: read('temp', ['state'], 'number') }, { m: { duration: { style: 'compact', unit: 'minutes' } } })).issues).toEqual([]);
  });
});

describe('inside a flow', () => {
  const typed = (operand: J) => { const facts = newFacts(); typeOperand(operand as never, { params: new Map(), allowRead: false, allowViewer: false }, '/o', facts); return facts; };
  it('refuses the last change and the second clock, which a flow never has', () => {
    expect(typed({ type: 'last-changed', sourceId: 'temp' }).issues.map(issue => issue.code)).toEqual(['invalid_combination']);
    expect(typed({ type: 'clock', part: 'now-second' }).issues.map(issue => issue.code)).toEqual(['invalid_combination']);
    expect(typed({ type: 'clock', part: 'now' }).issues).toEqual([]);
  });
  it('allows seconds between, a duration and a truncation, and asks for their ids', () => {
    const facts = typed({ type: 'object', fields: {
      a: { type: 'date', op: 'seconds-between', from: lit('2026-11-17T10:00:00'), to: lit('2026-11-17T10:00:09') },
      b: fmt('{n}', { n: lit(3) }, { n: { duration: { style: 'span' } } }),
      c: { type: 'math', op: 'truncate', args: [lit(1.25), lit(1)] },
    } });
    expect(facts.issues).toEqual([]);
    expect([...facts.edge].sort()).toEqual(['countdown', 'duration-format', 'math-truncate']);
  });
});

describe('the Studio environments', () => {
  const document = { dataSources: [{ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') }, { id: 'lights', kind: 'model', model: 'home-status@1', inputs: {} }] } as never;
  const states = (lastChanged?: string) => houseFrom({ states: [{ entityId: 'sensor.demo_bath_temperature', state: '72', name: 'T', ...(lastChanged ? { lastChanged } : {}) }] });
  it('reads the time of an entity the house carries, and nothing for a source that is not one', () => {
    const op = { type: 'last-changed', sourceId: 'temp' };
    expect(run(op, createEnvironment(document, states('2026-11-17T21:30:00.000Z')))).toEqual(value('2026-11-17T21:30:00.000Z'));
    expect(run(op, createEnvironment(document, states()))).toEqual(unavailable);
    expect(run(op, createEnvironment(document, {}))).toEqual(loading);
    expect(run({ type: 'last-changed', sourceId: 'lights' }, createEnvironment(document, states('2026-11-17T21:30:00.000Z')))).toEqual(unavailable);
    expect(run({ type: 'last-changed', sourceId: 'gone' }, createEnvironment(document, states('2026-11-17T21:30:00.000Z')))).toEqual(unavailable);
  });
  it('gives the clock it is handed to clock and date operands', () => {
    const env = createEnvironment(document, states(), emptyOverlay, undefined, clockAt('2026-11-17T10:00:07'));
    expect(run({ type: 'clock', part: 'now-second' }, env)).toEqual(value('2026-11-17T10:00:07'));
    expect(run({ type: 'clock', part: 'now-second' }, createEnvironment(document, states()))).toEqual(unavailable);
  });
  it('lets Try Values make a time unavailable or loading, and keeps the clock', () => {
    const tries = (kind: string) => ({ count: 1, overrides: new Map([['sensor.demo_bath_temperature', { kind }]]) }) as never;
    const op = { type: 'last-changed', sourceId: 'temp' };
    const house = states('2026-11-17T21:30:00.000Z');
    expect(run(op, environmentFor(document, house, undefined, tries('unavailable')))).toEqual(unavailable);
    expect(run(op, environmentFor(document, house, undefined, tries('loading')))).toEqual(loading);
    expect(run(op, environmentFor(document, house, undefined, tries('value'), clockAt('2026-11-17T10:00:07')))).toEqual(value('2026-11-17T21:30:00.000Z'));
  });
  it('gives the demo house a time, so a Since line has something to draw', () => {
    const house = demoHouse({ dataSources: [], pages: [{ components: [{ x: 'sensor.demo_bath_temperature' }] }] } as never);
    expect(house.states?.get('sensor.demo_bath_temperature')?.lastChanged).toBe(DEMO_LAST_CHANGED);
  });
});

describe('the data path from Home Assistant', () => {
  it('turns a REST time or a stream time into the contract\'s text', () => {
    expect(lastChangedText('2026-11-17T21:30:00.123456+00:00')).toBe('2026-11-17T21:30:00.123Z');
    expect(lastChangedText('2026-11-17T16:30:00-05:00')).toBe('2026-11-17T21:30:00.000Z');
    expect(lastChangedText(1_794_951_000.5)).toBe('2026-11-17T21:30:00.500Z');
    expect(lastChangedText('yesterday')).toBeUndefined();
    expect(lastChangedText(undefined)).toBeUndefined();
    expect(lastChangedText(Number.NaN)).toBeUndefined();
  });
  it('keeps the stream\'s time for an entity and moves it with a change', () => {
    const cache = new EntityCache();
    cache.apply({ a: { 'sensor.demo_a': { s: '1', a: {}, lc: 100 } } }, true);
    expect(cache.get('sensor.demo_a')?.lastChanged).toBe(100);
    cache.apply({ c: { 'sensor.demo_a': { '+': { s: '2', lc: 200 } } } });
    expect(cache.get('sensor.demo_a')?.lastChanged).toBe(200);
    cache.apply({ c: { 'sensor.demo_a': { '+': { a: { x: 1 } } } } });
    expect(cache.get('sensor.demo_a')?.lastChanged).toBe(200);
    cache.apply({ a: { 'sensor.demo_b': { s: '1', a: {} } } });
    expect(cache.get('sensor.demo_b')?.lastChanged).toBeUndefined();
  });
});

describe('the editors', () => {
  const ctx = { document: { dataSources: [{ id: 'temp', kind: 'ha-entity', entityId: lit('sensor.demo_bath_temperature') }] } } as never;
  it('offers Last Changed beside State and Raw State, and names it', () => {
    const op = operandForChoice('temp', 'changed');
    expect(op).toEqual({ type: 'last-changed', sourceId: 'temp' });
    expect(readChoiceOf(op)).toBe('changed');
    expect(sourceOfOperand(op)).toBe('temp');
    expect(operandName(op, ctx)).toMatch(/last changed$/);
    expect(operandName({ type: 'clock', part: 'now-second' }, ctx)).toBe('Now, to the second');
    expect(kindOf(op)).toBe('date');
    expect(withLeft({ left: lit('') as Operand, comparison: 'is', right: [] }, op)).toEqual({ left: op, comparison: 'is before', right: [] });
  });
  it('keeps a duration on the token line through a write and a read', () => {
    const operand = fmt('Off in {a}', { a: read('temp', ['state'], 'number') }, { a: { duration: { style: 'compact', unit: 'minutes' } } }) as Operand;
    const parts = parseLine(operand)!;
    expect(parts.find(part => 'token' in part)).toMatchObject({ token: { duration: { style: 'compact', unit: 'minutes' } } });
    expect(writeLine(parts)).toEqual(operand);
  });
});

describe('the preview clock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T10:00:00')); });
  afterEach(() => { vi.useRealTimers(); });
  it('finds a document that reads the second clock', () => {
    expect(readsSecondClock({ nodes: [{ value: { type: 'clock', part: 'now-second' } }] })).toBe(true);
    expect(readsSecondClock({ nodes: [{ value: { type: 'clock', part: 'now' } }] })).toBe(false);
  });
  it('ticks once a minute, and once a second only while told to, clearing the timer when it stops', () => {
    const { result, rerender } = renderHook(({ every }) => usePreviewClock(every), { initialProps: { every: false } });
    const first = result.current.now;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.now).toBe(first);
    expect(vi.getTimerCount()).toBe(1);
    rerender({ every: true });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.now).toBe('2026-11-17T10:00:08');
    expect(vi.getTimerCount()).toBe(1);
    rerender({ every: false });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.now).toBe('2026-11-17T10:00:08');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.now).toBe('2026-11-17T10:01:08');
  });
  it('starts no timer once it is gone', () => {
    const { unmount } = renderHook(() => usePreviewClock(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reads the wall clock of this browser\'s zone', () => {
    expect(wallClock(new Date('2026-11-17T10:00:07'))).toEqual({ now: '2026-11-17T10:00:07', utcOffsetMinutes: -480 });
  });
});

describe('the contract documents the ids', () => {
  it('lists the four ids with the words of what they cover', () => {
    const doc = readFileSync(path.resolve(__dirname, '../docs/native-composition.md'), 'utf8');
    for (const id of ['sh.entity-time@1', 'sh.countdown@1', 'sh.duration-format@1', 'sh.math-truncate@1']) expect(doc).toContain(id);
  });
});

describe('the editor pieces', () => {
  const names = { document: { dataSources: [{ id: 's', kind: 'ha-entity', entityId: { type: 'literal', value: 'fan.demo_bath_fan' } }] }, entityName: () => 'Bath Fan' } as never;
  it('offers no last_changed attribute: the time of last change is the operand, not an attribute the phone can read', () => {
    expect(knownAttributes({ entityId: 'a.b', state: 'on', lastChanged: '2026-11-15T21:30:00.000Z', presetModes: ['x'] }).map(item => item.name)).toEqual(['preset_modes']);
    expect(attributeOf({ entityId: 'a.b', name: 'A', state: 'on', lastChanged: '2026-11-15T21:30:00.000Z' }, 'last_changed')).toBeUndefined();
  });
  it('compares a last change only before or after a moment', () => {
    expect(comparisonsFor('date', { type: 'last-changed', sourceId: 's' })).toEqual(['is before', 'is after']);
    expect(comparisonsFor('date', { type: 'clock', part: 'today' })).toEqual(['is before', 'is after', 'is']);
    const leaf = { left: { type: 'last-changed', sourceId: 's' } as Operand, comparison: 'is before' as const, right: [] };
    expect(withLeft({ ...leaf, comparison: 'is' as never }, leaf.left).comparison).toBe('is before');
  });
  it('shows a last change in Simple, before or after a moment', () => {
    const predicate = { type: 'compare', op: 'before', left: { type: 'last-changed', sourceId: 's' }, right: { type: 'literal', value: '2026-11-15T21:30:00Z' } } as never;
    expect(fitsSimple(predicate, names)).toEqual({ fits: true });
  });
  it('names the seconds to a time in words', () => {
    const until: Operand = { type: 'date', op: 'seconds-between', from: { type: 'clock', part: 'now-second' }, to: { type: 'last-changed', sourceId: 's' } };
    expect(operandName(until, names)).toBe('Seconds until Bath Fan · last changed');
    const since: Operand = { type: 'date', op: 'seconds-between', from: { type: 'last-changed', sourceId: 's' }, to: { type: 'clock', part: 'now-second' } };
    expect(operandName(since, names)).toBe('Seconds since Bath Fan changed');
    expect(operandName({ type: 'date', op: 'days-between', from: { type: 'clock', part: 'today' }, to: { type: 'clock', part: 'today' } }, names)).toBe('a value');
  });
  it('writes a cut-off number as truncate under its own decimals, and reads it back', () => {
    const read: Operand = { type: 'read', from: { type: 'source', sourceId: 's', path: ['state'] }, as: 'number', missing: 'unavailable' };
    const line = writeLine([{ token: { operand: read, digits: 1, truncate: true } }]);
    expect(line).toMatchObject({ type: 'format', args: { a: { type: 'math', op: 'truncate', args: [read, { type: 'literal', value: 1 }] } }, formats: { a: { number: { maximumFractionDigits: 1 } } } });
    expect(parseLine(line)).toEqual([{ text: '' }, { token: { operand: read, truncate: true, digits: 1 } }].filter(part => !('text' in part && !part.text)));
    // Rounding stays when no cut is asked, and a duration is never cut.
    expect(writeLine([{ token: { operand: read, digits: 1 } }])).toMatchObject({ args: { a: read } });
    expect(writeLine([{ token: { operand: read, digits: 1, truncate: true, duration: { style: 'clock' } } }])).toMatchObject({ args: { a: read } });
  });
  it('starts a moment drawn as a time, so a Since line shows a time and not the raw time stamp', () => {
    const changed: Operand = { type: 'last-changed', sourceId: 's' };
    expect(newToken(changed)).toEqual({ operand: changed, dateStyle: 'time' });
    expect(newToken({ type: 'clock', part: 'now-second' })).toEqual({ operand: { type: 'clock', part: 'now-second' }, dateStyle: 'time' });
    expect(newToken({ type: 'clock', part: 'today' })).toEqual({ operand: { type: 'clock', part: 'today' } });
    const line = writeLine([{ text: 'Since ' }, { token: newToken(changed) }]);
    expect(line).toMatchObject({ type: 'format', pattern: 'Since {a}', args: { a: changed }, formats: { a: { date: { style: 'time' } } } });
  });
});
