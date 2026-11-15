import { describe, expect, it } from 'vitest';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import { evaluateOperand, scalarText, evaluatePredicate, formatNumber, isSelected, isShown, loading, unavailable, value, type Environment, type Tri } from '../src/preview2/evaluate';
import type { Json } from '../src/shared/types';

/** A tiny environment: `data` maps `source/path` to a value; absent is unavailable, `LOADING` is loading. */
const LOADING = Symbol('loading');
const env = (data: Record<string, Json | typeof LOADING>, extra: Partial<Environment> = {}): Environment => ({
  read: (sourceId, path) => {
    const found = data[`${sourceId}/${path.join('/')}`];
    return found === undefined ? unavailable : found === LOADING ? loading : value(found);
  },
  ...extra,
});
const lit = (v: Json): Operand => ({ type: 'literal', value: v });
const read = (sourceId: string, path: string[], as: 'string' | 'number' | 'boolean' | 'entity-id' = 'string'): Operand =>
  ({ type: 'read', from: { type: 'source', sourceId, path }, as, missing: 'unavailable' });
const math = (op: Extract<Operand, { type: 'math' }>['op'], ...args: Operand[]): Operand => ({ type: 'math', op, args });
const v = (operand: Operand, e = env({})) => evaluateOperand(operand, e);

describe('operands', () => {
  it('literal, control and viewer', () => {
    expect(v(lit('a'))).toEqual(value('a'));
    expect(v({ type: 'control' })).toEqual(unavailable);
    expect(v({ type: 'control' }, env({}, { controlValue: 4 }))).toEqual(value(4));
    expect(v({ type: 'viewer', field: 'userId' })).toEqual(loading);
    const viewer = env({}, { viewer: { userId: 'u1', isAdmin: false } });
    expect(v({ type: 'viewer', field: 'userId' }, viewer)).toEqual(value('u1'));
    expect(v({ type: 'viewer', field: 'isAdmin' }, viewer)).toEqual(value(false));
    expect(v({ type: 'viewer', field: 'personEntityId' }, viewer)).toEqual(unavailable);
  });

  it('read coerces to its kind and is unavailable when it cannot', () => {
    const e = env({ 's/state': '21.5', 'b/state': 'true', 'x/state': 'warm', 'l/state': LOADING });
    expect(v(read('s', ['state'], 'number'), e)).toEqual(value(21.5));
    expect(v(read('s', ['state'], 'string'), e)).toEqual(value('21.5'));
    expect(v(read('b', ['state'], 'boolean'), e)).toEqual(value(true));
    expect(v(read('x', ['state'], 'number'), e)).toEqual(unavailable);
    expect(v(read('x', ['state'], 'boolean'), e)).toEqual(unavailable);
    expect(v(read('missing', ['state']), e)).toEqual(unavailable);
    expect(v(read('l', ['state']), e)).toEqual(loading);
  });

  it('format fills holes, formats numbers, and blocks on a missing argument', () => {
    const e = env({ 't/state': '21.456', 'gone/state': 'unavailable' });
    const pattern = (text: string, args: Record<string, Operand>, formats?: Record<string, { number: { maximumFractionDigits: number } }>): Operand =>
      ({ type: 'format', pattern: text, args, formats });
    expect(v(pattern('{t}° in {room}', { t: read('t', ['state'], 'number'), room: lit('Den') }, { t: { number: { maximumFractionDigits: 1 } } }), e)).toEqual(value('21.5° in Den'));
    expect(v(pattern('{n}', { n: lit(2.5) }, { n: { number: { maximumFractionDigits: 0 } } }))).toEqual(value('2'));
    expect(v(pattern('{n}', { n: lit(3) }))).toEqual(value('3'));
    expect(v(pattern('{a}', { a: read('nope', ['state']) }), e)).toEqual(unavailable);
    expect(v(pattern('{a}{b}', { a: read('nope', ['state']), b: read('l', ['state']) }), env({ 'l/state': LOADING }))).toEqual(loading);
    expect(v(pattern('{unknown}', {}))).toEqual(unavailable);
    expect(v(pattern('open {', {}))).toEqual(value('open {'));
    expect(formatNumber(-0.0001, 2)).toBe('0');
    expect(formatNumber(2.5, 3)).toBe('2.5');
  });

  it('format rounds like the app: the exact binary value, and an exact tie to the even digit', () => {
    // Values checked against Swift `String(format: "%.Nf")` on macOS.
    const table: [number, number, string][] = [
      [2.5, 0, '2'], [3.5, 0, '4'], [-2.5, 0, '-2'], [-3.5, 0, '-4'], [22.5, 0, '22'], [23.5, 0, '24'], [0.5, 0, '0'], [1.5, 0, '2'], [-0.5, 0, '0'],
      [0.125, 2, '0.12'], [0.375, 2, '0.38'], [-0.125, 2, '-0.12'], [2.675, 2, '2.67'], [1.005, 2, '1'], [21.456, 1, '21.5'], [2.25, 1, '2.2'], [2.35, 1, '2.4'],
      [1234.5, 0, '1234'], [1235.5, 0, '1236'], [10, 3, '10'], [0.1 + 0.2, 6, '0.3'], [5e-7, 6, '0'], [1e21, 2, '1000000000000000000000'],
    ];
    for (const [input, digits, text] of table) expect([input, digits, formatNumber(input, digits)]).toEqual([input, digits, text]);
  });

  it('prints whole numbers as Swift does from 1e15', () => {
    expect(scalarText(21)).toBe('21');
    expect(scalarText(1e15)).toBe('1000000000000000.0');
    expect(scalarText(1e16)).toBe('1e+16');
    expect(scalarText(-1.5e17)).toBe('-1.5e+17');
    expect(scalarText(2.5)).toBe('2.5');
  });

  it('map picks the first matching case, comparing scalars as text, else otherwise', () => {
    const mapped = (of: Operand): Operand => ({ type: 'map', of, cases: [{ equals: 'on', then: lit('Lit') }, { equals: 1, then: lit('One') }], otherwise: lit('Other') });
    expect(v(mapped(lit('on')))).toEqual(value('Lit'));
    expect(v(mapped(lit('1')))).toEqual(value('One'));
    expect(v(mapped(lit(1)))).toEqual(value('One'));
    expect(v(mapped(lit('off')))).toEqual(value('Other'));
    expect(v(mapped(read('nope', ['state'])))).toEqual(unavailable);
    expect(v(mapped(read('l', ['state'])), env({ 'l/state': LOADING }))).toEqual(loading);
  });

  it('math: every operation, arity, division by zero and unavailable arguments', () => {
    const n = (...values: number[]) => values.map(lit);
    expect(v(math('add', ...n(1, 2, 3)))).toEqual(value(6));
    expect(v(math('subtract', ...n(5, 2)))).toEqual(value(3));
    expect(v(math('multiply', ...n(2, 3, 4)))).toEqual(value(24));
    expect(v(math('divide', ...n(9, 3)))).toEqual(value(3));
    expect(v(math('divide', ...n(9, 0)))).toEqual(unavailable);
    expect(v(math('min', ...n(4, 2, 8)))).toEqual(value(2));
    expect(v(math('max', ...n(4, 2, 8)))).toEqual(value(8));
    expect(v(math('round', ...n(2.567)))).toEqual(value(3));
    expect(v(math('round', ...n(2.567, 2)))).toEqual(value(2.57));
    // Swift's `.rounded()`: a tie goes away from zero.
    for (const [input, places, expected] of [[2.5, 0, 3], [3.5, 0, 4], [-2.5, 0, -3], [-3.5, 0, -4], [22.5, 0, 23], [0.5, 0, 1], [-0.5, 0, -1], [0.125, 2, 0.13], [-0.125, 2, -0.13], [2.567, 2, 2.57]] as const) {
      expect([input, places, v(math('round', ...n(input, places)))]).toEqual([input, places, value(expected)]);
    }
    expect(v(math('round', ...n(-0.4)))).toEqual(value(0));
    expect(v(math('round', ...n(2.567, 7)))).toEqual(unavailable);
    expect(v(math('round', ...n(2.567, 1.5)))).toEqual(unavailable);
    expect(v(math('clamp', ...n(15, 0, 10)))).toEqual(value(10));
    expect(v(math('clamp', ...n(5, 10, 0)))).toEqual(unavailable);
    expect(v(math('scale', ...n(50, 0, 100, 0, 255)))).toEqual(value(127.5));
    expect(v(math('scale', ...n(5, 1, 1, 0, 10)))).toEqual(unavailable);
    expect(v(math('add', lit(1)))).toEqual(unavailable);
    expect(v(math('add', lit(1), lit('x')))).toEqual(unavailable);
    expect(v(math('add', lit(1), lit('2')))).toEqual(value(3));
    expect(v(math('add', lit(1), read('nope', ['state'], 'number')))).toEqual(unavailable);
    expect(v(math('add', lit(1), read('l', ['state'], 'number')), env({ 'l/state': LOADING }))).toEqual(loading);
  });

  it('object and list collect their parts and wait on any missing one', () => {
    expect(v({ type: 'object', fields: { a: lit(1), b: lit('x') } })).toEqual(value({ a: 1, b: 'x' }));
    expect(v({ type: 'list', items: [lit(1), lit(true)] })).toEqual(value([1, true]));
    expect(v({ type: 'list', items: [lit(1), read('nope', ['state'])] })).toEqual(unavailable);
    expect(v({ type: 'object', fields: { a: read('nope', ['state']) } })).toEqual(unavailable);
  });
});

const state = (sourceId: string, values: string[], path = ['state']): Predicate => ({ type: 'state', sourceId, path, in: values });
const yes = state('a', ['on']), no = state('a', ['off']), unknown = state('gone', ['on']);
const world = env({ 'a/state': 'on', 'n/state': '70', 'lim/state': '65' });
const p = (predicate: Predicate, e = world): Tri => evaluatePredicate(predicate, e);

describe('predicates', () => {
  it('state compares as text and is unknown when the value is not there', () => {
    expect(p(yes)).toBe('yes');
    expect(p(no)).toBe('no');
    expect(p(unknown)).toBe('unknown');
    expect(p(state('n', ['70']))).toBe('yes');
    expect(p(state('a', ['on'], ['attributes', 'x']))).toBe('unknown');
    expect(p(yes, env({ 'a/state': LOADING }))).toBe('unknown');
  });

  it('numeric: above, below, both, an operand bound and unknowns', () => {
    const numeric = (extra: Partial<Extract<Predicate, { type: 'numeric' }>>): Predicate => ({ type: 'numeric', sourceId: 'n', path: ['state'], ...extra });
    expect(p(numeric({ above: lit(60) }))).toBe('yes');
    expect(p(numeric({ above: lit(70) }))).toBe('no');
    expect(p(numeric({ below: lit(80) }))).toBe('yes');
    expect(p(numeric({ above: lit(60), below: lit(65) }))).toBe('no');
    expect(p(numeric({ above: read('lim', ['state'], 'number') }))).toBe('yes');
    expect(p(numeric({ above: read('nope', ['state'], 'number') }))).toBe('unknown');
    expect(p(numeric({ above: lit(60), below: read('nope', ['state'], 'number') }))).toBe('unknown');
    expect(p(numeric({ above: lit(100), below: read('nope', ['state'], 'number') }))).toBe('no');
    expect(p({ type: 'numeric', sourceId: 'gone', path: ['state'], above: lit(1) })).toBe('unknown');
    expect(p({ type: 'numeric', sourceId: 'a', path: ['state'], above: lit(1) })).toBe('unknown');
  });

  it('viewer and viewer-person', () => {
    const signedIn = env({ 'person/state': 'home' }, { viewer: { userId: 'u1', isAdmin: true }, viewerPersonState: () => value('home') });
    expect(p({ type: 'viewer', isAdmin: true }, signedIn)).toBe('yes');
    expect(p({ type: 'viewer', isAdmin: false }, signedIn)).toBe('no');
    expect(p({ type: 'viewer', userIds: ['u1', 'u2'] }, signedIn)).toBe('yes');
    expect(p({ type: 'viewer', isAdmin: true, userIds: ['u9'] }, signedIn)).toBe('no');
    expect(p({ type: 'viewer', isAdmin: true })).toBe('unknown');
    expect(p({ type: 'viewer', isAdmin: true }, env({}, { viewer: { userId: 'u1' } }))).toBe('unknown');
    expect(p({ type: 'viewer', userIds: ['u1'] }, env({}, { viewer: { isAdmin: true } }))).toBe('unknown');
    expect(p({ type: 'viewer-person', in: ['home'] }, signedIn)).toBe('yes');
    expect(p({ type: 'viewer-person', in: ['away'] }, signedIn)).toBe('no');
    expect(p({ type: 'viewer-person', in: ['home'] })).toBe('unknown');
  });

  it('all, any and not follow the three-valued truth table', () => {
    const values: [Predicate, Tri][] = [[yes, 'yes'], [no, 'no'], [unknown, 'unknown']];
    const all = (a: Predicate, b: Predicate) => p({ type: 'all', of: [a, b] });
    const any = (a: Predicate, b: Predicate) => p({ type: 'any', of: [a, b] });
    const andTable: Record<string, Tri> = { 'yes,yes': 'yes', 'yes,no': 'no', 'yes,unknown': 'unknown', 'no,no': 'no', 'no,unknown': 'no', 'unknown,unknown': 'unknown' };
    const orTable: Record<string, Tri> = { 'yes,yes': 'yes', 'yes,no': 'yes', 'yes,unknown': 'yes', 'no,no': 'no', 'no,unknown': 'unknown', 'unknown,unknown': 'unknown' };
    for (const [a, left] of values) for (const [b, right] of values) {
      const key = [left, right].join(','), flipped = [right, left].join(',');
      expect(all(a, b)).toBe(andTable[key] ?? andTable[flipped]);
      expect(any(a, b)).toBe(orTable[key] ?? orTable[flipped]);
    }
    expect(p({ type: 'not', of: yes })).toBe('no');
    expect(p({ type: 'not', of: no })).toBe('yes');
    expect(p({ type: 'not', of: unknown })).toBe('unknown');
  });
});

describe('visibility and whenUnknown', () => {
  it('no rule is shown; a known answer ignores the policy', () => {
    expect(isShown({}, world)).toBe(true);
    for (const whenUnknown of ['show', 'hide', 'keep'] as const) {
      expect(isShown({ visibleWhen: yes, whenUnknown }, world, false)).toBe(true);
      expect(isShown({ visibleWhen: no, whenUnknown }, world, true)).toBe(false);
    }
  });

  it('an unknown answer follows the policy: show, hide, keep (default) and keep when never answered', () => {
    expect(isShown({ visibleWhen: unknown, whenUnknown: 'show' }, world, false)).toBe(true);
    expect(isShown({ visibleWhen: unknown, whenUnknown: 'hide' }, world, true)).toBe(false);
    expect(isShown({ visibleWhen: unknown, whenUnknown: 'keep' }, world, true)).toBe(true);
    expect(isShown({ visibleWhen: unknown, whenUnknown: 'keep' }, world, false)).toBe(false);
    expect(isShown({ visibleWhen: unknown, whenUnknown: 'keep' }, world)).toBe(true);
    expect(isShown({ visibleWhen: unknown }, world, false)).toBe(false);
    expect(isShown({ visibleWhen: unknown }, world)).toBe(true);
  });

  it('a reconnect (state back to unknown) keeps what the node was doing', () => {
    const rule = { visibleWhen: no, whenUnknown: 'keep' as const };
    const shown = isShown(rule, world);
    expect(shown).toBe(false);
    expect(isShown({ ...rule, visibleWhen: state('gone', ['off']) }, env({}), shown)).toBe(false);
  });

  it('selectedWhen counts unknown as not selected', () => {
    expect(isSelected(yes, world)).toBe(true);
    expect(isSelected(no, world)).toBe(false);
    expect(isSelected(unknown, world)).toBe(false);
  });
});
