import { describe, expect, it } from 'vitest';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import { fixedOf, mixedKinds, modeOf, rulesOf, rulesProblem, ruleStatus, seedRules, toSlot, type RulesDraft } from '../src/workspace2/expr/value';

const lit = (value: string | number): Operand => ({ type: 'literal', value });
const read: Operand = { type: 'read', from: { type: 'source', sourceId: 's', path: ['state'] }, as: 'string', missing: 'unavailable' };
const when: Predicate = { type: 'state', sourceId: 's', path: ['state'], in: ['on'] };
const orange = { type: 'solid-rgb', red: 255, green: 149, blue: 0 };

describe('modeOf', () => {
  it('reads each stored form', () => {
    expect(modeOf({ type: 'literal', value: 'x' }, 'text')).toBe('fixed');
    expect(modeOf(read as never, 'text')).toBe('entity');
    expect(modeOf({ type: 'expr', value: { type: 'format', pattern: '{a}', args: { a: read } } }, 'text')).toBe('entity');
    expect(modeOf({ type: 'expr', value: { type: 'choose', cases: [{ when, then: lit('a') }], otherwise: lit('b') } }, 'text')).toBe('rules');
    expect(modeOf({ type: 'expr', value: { type: 'math', op: 'add', args: [lit(1), lit(2)] } as unknown as Operand }, 'text')).toBe('custom');
    expect(modeOf({ type: 'conditional', cases: [{ when, then: orange }], otherwise: orange }, 'color')).toBe('rules');
    expect(modeOf({ type: 'bound-color', value: read, fallback: orange }, 'color')).toBe('entity');
    expect(modeOf({ type: 'bound-symbol', value: read, fallback: { type: 'sf-symbol', name: 'bolt' } }, 'icon')).toBe('entity');
    expect(modeOf(orange, 'color')).toBe('fixed');
    expect(modeOf(undefined, 'color')).toBe('fixed');
  });
});

describe('Rules', () => {
  it('seeds the current value as Otherwise and one empty rule', () => {
    const seeded = seedRules(orange);
    expect(seeded.otherwise).toEqual(orange);
    expect(seeded.cases).toHaveLength(1);
    expect(seeded.cases[0].when).toBeUndefined();
    expect(seeded.cases[0].then).toEqual(orange);
    expect(seeded.cases[0].then).not.toBe(seeded.otherwise);
  });

  it('a look writes conditional, text writes expr holding choose', () => {
    const look = toSlot('rules', { rules: { cases: [{ when, then: orange }], otherwise: orange } }, 'color', undefined);
    expect(look).toEqual({ type: 'conditional', cases: [{ when, then: orange }], otherwise: orange });
    const text = toSlot('rules', { rules: { cases: [{ when, then: lit('a') }], otherwise: lit('b') } }, 'text', undefined);
    expect(text).toEqual({ type: 'expr', value: { type: 'choose', cases: [{ when, then: lit('a') }], otherwise: lit('b') } });
  });

  it('keeps a rule that has no condition yet in the slot, so Done can wait for it', () => {
    const rules: RulesDraft<unknown> = { cases: [{ when: undefined, then: orange }], otherwise: orange };
    const slot = toSlot('rules', { rules: rules as RulesDraft<never> }, 'color', undefined) as unknown as { cases: unknown[] };
    expect(slot.cases).toHaveLength(1);
    expect(rulesOf(slot as never, 'color')!.cases[0].when).toBeUndefined();
    expect(rulesProblem(rulesOf(slot as never, 'color')!, 'color')).toBe('Rule 1 needs a condition.');
  });

  it('reads rules back and gives Otherwise as the fixed value', () => {
    const slot = { type: 'conditional', cases: [{ when, then: orange }], otherwise: { type: 'standard' } };
    expect(rulesOf(slot, 'color')!.cases).toHaveLength(1);
    expect(fixedOf(slot, 'color')).toEqual({ type: 'standard' });
    expect(fixedOf({ type: 'bound-color', value: read, fallback: orange }, 'color')).toEqual(orange);
  });

  it('From Entity on a color keeps the fixed value as the fallback', () => {
    const slot = toSlot('entity', { entity: read, fixed: orange }, 'color', undefined);
    expect(slot).toEqual({ type: 'bound-color', value: read, fallback: orange });
    expect(toSlot('entity', { entity: read, fixed: { type: 'sf-symbol', name: 'bolt' } }, 'icon', undefined)).toMatchObject({ type: 'bound-symbol' });
  });

  it('reports mixed kinds at the second rule', () => {
    const rules: RulesDraft<Operand> = { cases: [{ when, then: lit('a') }, { when, then: lit(2) }], otherwise: lit('b') };
    expect(mixedKinds(rules)).toEqual({ at: 1, words: 'Every rule must give text. Rule 2 gives a number.' });
    expect(rulesProblem(rules as RulesDraft<never>, 'text')).toBe('Every rule must give text. Rule 2 gives a number.');
    expect(mixedKinds({ cases: [{ when, then: lit('a') }], otherwise: lit('b') })).toBeUndefined();
  });

  it('with no environment no rule is used; the first rule that holds is', () => {
    const rules: RulesDraft<unknown> = { cases: [{ when, then: 1 }], otherwise: 2 };
    expect(ruleStatus(rules, undefined, 'color').used).toBeUndefined();
  });
});
