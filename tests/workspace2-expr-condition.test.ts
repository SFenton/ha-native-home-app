import { describe, expect, it } from 'vitest';
import type { Operand, Predicate } from '../src/shared/composition/expression';
import {
  closeLeaf, closeRoot, comparisonsFor, kindOf, operandForChoice, readChoiceOf, sourceOfOperand, withLeft, conditionCount, fitsSimple, groupDepth, groupOf, groupPredicate, growProblem, inputsOf, markerOf, moveItem, openLeaf, openRoot, openSimple,
  operandName, readOperand, resultText as resultWords, sentence, summary, timeWords, type NameContext,
} from '../src/workspace2/expr/condition';

const ctx: NameContext = {
  document: { dataSources: [
    { id: 'guest', kind: 'ha-entity', entityId: { type: 'literal', value: 'input_boolean.demo_guests' } },
    { id: 'count', kind: 'ha-entity', entityId: { type: 'literal', value: 'sensor.demo_count' } },
    { id: 'app', kind: 'model', model: 'app-state@1' },
  ] },
  entityName: id => ({ 'input_boolean.demo_guests': 'Guest Mode', 'sensor.demo_count': 'Lights On' })[id],
};
const state = (sourceId: string): Operand => readOperand(sourceId, ['state'], 'string');
const sameJson = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

describe('Simple writes the shipped leaves (D6), never compare', () => {
  it('"is on" is state with in, "is not" is not over state, "is above" is numeric', () => {
    expect(closeLeaf({ left: state('guest'), comparison: 'is', right: [{ type: 'literal', value: 'on' }] })).toEqual({ type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] });
    expect(closeLeaf({ left: state('guest'), comparison: 'is not', right: [{ type: 'literal', value: 'on' }] })).toEqual({ type: 'not', of: { type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] } });
    expect(closeLeaf({ left: state('guest'), comparison: 'is one of', right: [{ type: 'literal', value: 'on' }, { type: 'literal', value: 'home' }] })).toEqual({ type: 'state', sourceId: 'guest', path: ['state'], in: ['on', 'home'] });
    const above = closeLeaf({ left: readOperand('count', ['state'], 'number'), comparison: 'is above', right: [{ type: 'literal', value: 10 }] });
    expect(above).toMatchObject({ type: 'numeric', sourceId: 'count', path: ['state'], above: { type: 'literal', value: 10 } });
    for (const made of [above]) expect(made.type).not.toBe('compare');
  });

  it('an attribute uses the attributes path', () => {
    const made = closeLeaf({ left: readOperand('guest', ['attributes', 'brightness'], 'string'), comparison: 'is', right: [{ type: 'literal', value: '5' }] });
    expect(made).toMatchObject({ type: 'state', path: ['attributes', 'brightness'] });
  });

  it('a value that is not an entity read is compare, in or exists', () => {
    expect(closeLeaf({ left: { type: 'clock', part: 'now' }, comparison: 'is after', right: [{ type: 'literal', value: '2026-01-01' }] }).type).toBe('compare');
    expect(closeLeaf({ left: { type: 'viewer', field: 'isAdmin' } as Operand, comparison: 'has a value', right: [] }).type).toBe('exists');
  });

  it('opening then closing a stored condition is byte-identical', () => {
    const samples: Predicate[] = [
      { type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] },
      { type: 'not', of: { type: 'state', sourceId: 'guest', path: ['state'], in: ['on', 'home'] } },
      { type: 'numeric', sourceId: 'count', path: ['state'], above: { type: 'literal', value: 10 } },
      { type: 'compare', op: 'eq', left: { type: 'clock', part: 'now' }, right: { type: 'literal', value: 'x' } },
    ];
    for (const sample of samples) {
      const leaf = openLeaf(sample);
      expect(leaf, JSON.stringify(sample)).toBeDefined();
      sameJson(closeLeaf(leaf!), sample);
    }
  });
});

describe('groups', () => {
  const a: Predicate = { type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] };
  const b: Predicate = { type: 'state', sourceId: 'count', path: ['state'], in: ['off'] };
  it('none is not over any, and reads back as none', () => {
    const none = groupPredicate({ mode: 'none', items: [a, b] });
    expect(none).toEqual({ type: 'not', of: { type: 'any', of: [a, b] } });
    expect(groupOf(none)).toEqual({ mode: 'none', items: [a, b] });
  });
  it('a root that is one leaf opens as an all group and closes back to the leaf', () => {
    const root = openRoot(a);
    expect(root.group.items).toEqual([a]);
    sameJson(closeRoot(root), a);
    expect(closeRoot(openRoot(undefined))).toBeUndefined();
  });
  it('counts conditions and depth through nesting', () => {
    const nested = groupPredicate({ mode: 'all', items: [a, groupPredicate({ mode: 'any', items: [b, groupPredicate({ mode: 'all', items: [a] })] })] });
    expect(conditionCount(nested)).toBe(3);
    expect(groupDepth(nested)).toBe(3);
  });
  it('says why a group or row cannot be added at the limits', () => {
    expect(growProblem(a, 'document', 'condition', 16, 1)).toMatch(/too large|too many|16/i);
    expect(growProblem(a, 'document', 'group', 1, 99)).toMatch(/^Groups can go \d+ deep\.$/);
    expect(growProblem(a, 'document', 'condition', 1, 1)).toBeUndefined();
  });
  it('moves an item and refuses to leave the list', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});

describe('Simple fits', () => {
  it('fits nothing, one entity comparison, and a one-row all group', () => {
    expect(fitsSimple(undefined, ctx).fits).toBe(true);
    const leaf: Predicate = { type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] };
    expect(fitsSimple(leaf, ctx).fits).toBe(true);
    expect(fitsSimple(groupPredicate({ mode: 'all', items: [leaf] }), ctx).fits).toBe(true);
    expect(openSimple(groupPredicate({ mode: 'all', items: [leaf] }))).toBeDefined();
  });
  it('gives the reason it cannot, with the count', () => {
    const leaf: Predicate = { type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] };
    const three = groupPredicate({ mode: 'all', items: [leaf, leaf, leaf] });
    const fit = fitsSimple(three, ctx);
    expect(fit.fits).toBe(false);
    expect(fit.fits === false && fit.reason).toBe('Simple holds one entity and one comparison. This has 3 conditions.');
    const person = fitsSimple({ type: 'viewer', field: 'isAdmin', is: true } as unknown as Predicate, ctx);
    expect(person.fits).toBe(false);
  });
});

describe('the words', () => {
  it('names entities by their friendly names and sentences read plainly', () => {
    expect(operandName(state('guest'), ctx)).toBe('Guest Mode');
    expect(sentence({ type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] }, ctx)).toBe('Guest Mode is on');
    expect(sentence({ type: 'numeric', sourceId: 'count', path: ['state'], above: { type: 'literal', value: 10 } }, ctx)).toBe('Lights On is above 10');
    expect(summary(undefined, ctx)).toBe('Always');
  });
  it('writes a time of day', () => {
    expect(timeWords(21 * 60)).toBe('9:00 PM');
    expect(timeWords(0)).toBe('12:00 AM');
    expect(timeWords(12 * 60 + 5)).toBe('12:05 PM');
  });
  it('offers the comparisons each kind follows', () => {
    expect(comparisonsFor('yesno')).toEqual(['is']);
    expect(comparisonsFor('number')).toContain('is above');
    expect(comparisonsFor('text')).toContain('is one of');
    expect(comparisonsFor('date')).toEqual(['is before', 'is after', 'is']);
  });
  it('says the result for every place', () => {
    const places = ['show', 'enable', 'active', 'filled', 'error', 'ask', 'rule', 'filter'] as const;
    for (const place of places) for (const tri of ['yes', 'no', 'unknown'] as const) expect(resultWords(place, tri).length, `${place} ${tri}`).toBeGreaterThan(0);
    expect(resultWords('show', 'yes')).toBe('Shown now');
    expect(resultWords('show', 'no')).toBe('Hidden now');
    expect(resultWords('enable', 'yes')).toBe('Enabled now');
    expect(resultWords('ask', 'no')).toBe('Not asking now');
  });
  it('marks a result with a shape', () => {
    expect(markerOf('yes')).toBe('check');
    expect(markerOf('no')).toBe('ring');
    expect(markerOf('unknown')).toBe('unknown');
    expect(markerOf('yes', true)).toBe('problem');
  });
  it('lists what a condition reads', () => {
    const found = inputsOf(groupPredicate({ mode: 'all', items: [{ type: 'state', sourceId: 'guest', path: ['state'], in: ['on'] }, { type: 'numeric', sourceId: 'count', path: ['state'], above: { type: 'literal', value: 1 } }] }));
    expect(found.map(item => item.sourceId).sort()).toEqual(['count', 'guest']);
  });
});

describe('reading an entity beyond its state: raw state and lists (CT1)', () => {
  const raw = operandForChoice('guest', 'raw'), count = operandForChoice('guest', 'c:preset_modes'), has = operandForChoice('guest', 'i:preset_modes', 'string', 'auto');
  it('names a choice for every way to read an entity, and reads it back', () => {
    expect(raw).toEqual({ type: 'raw-state', sourceId: 'guest' });
    expect(count).toEqual({ type: 'list-count', from: { type: 'source', sourceId: 'guest', path: ['attributes', 'preset_modes'] } });
    expect(has).toMatchObject({ type: 'list-includes', value: { type: 'literal', value: 'auto' } });
    expect(['state', 'raw', 'a:brightness', 'c:preset_modes', 'i:preset_modes'].map(choice => readChoiceOf(operandForChoice('guest', choice as never)))).toEqual(['state', 'raw', 'a:brightness', 'c:preset_modes', 'i:preset_modes']);
    expect([raw, count, has, state('guest')].map(sourceOfOperand)).toEqual(['guest', 'guest', 'guest', 'guest']);
    expect(sourceOfOperand({ type: 'literal', value: 1 })).toBeUndefined();
  });
  it('gives each a kind and a starting comparison', () => {
    expect([raw, count, has].map(item => kindOf(item))).toEqual(['text', 'number', 'yesno']);
    const leaf = { left: state('guest'), comparison: 'is' as const, right: [{ type: 'literal' as const, value: 'on' }] };
    expect(withLeft(leaf, raw)).toEqual({ left: raw, comparison: 'is', right: [{ type: 'literal', value: 'unknown' }] });
    expect(withLeft(leaf, count)).toEqual({ left: count, comparison: 'is above', right: [{ type: 'literal', value: 0 }] });
    expect(withLeft(leaf, has)).toEqual({ left: has, comparison: 'is', right: [{ type: 'literal', value: true }] });
  });
  it('writes compare, which the shipped leaves cannot hold, and Simple can show', () => {
    expect(closeLeaf(withLeft({ left: state('guest'), comparison: 'is', right: [] }, raw))).toEqual({ type: 'compare', op: 'eq', left: raw, right: { type: 'literal', value: 'unknown' } });
    expect(fitsSimple(closeLeaf(withLeft({ left: state('guest'), comparison: 'is', right: [] }, count)), ctx)).toEqual({ fits: true });
    expect(openLeaf(closeLeaf(withLeft({ left: state('guest'), comparison: 'is', right: [] }, has)))).toEqual({ left: has, comparison: 'is', right: [{ type: 'literal', value: true }] });
  });
  it('names them in words and lists them as inputs for Try Values', () => {
    expect(operandName(raw, ctx)).toBe('Guest Mode · raw state');
    expect(operandName(count, ctx)).toBe('Guest Mode · preset_modes count');
    expect(operandName(has, ctx)).toBe('Guest Mode · preset_modes includes auto');
    expect(sentence(closeLeaf({ left: raw, comparison: 'is', right: [{ type: 'literal', value: 'unknown' }] }), ctx)).toBe('Guest Mode · raw state is unknown');
    expect(sentence(closeLeaf({ left: has, comparison: 'is', right: [{ type: 'literal', value: true }] }), ctx)).toBe('Guest Mode · preset_modes includes auto');
    expect(sentence(closeLeaf({ left: has, comparison: 'is', right: [{ type: 'literal', value: false }] }), ctx)).toBe('Guest Mode · preset_modes does not include auto');
    expect(inputsOf({ type: 'compare', op: 'eq', left: raw, right: { type: 'literal', value: 'unknown' } })).toEqual([{ sourceId: 'guest', path: ['state'] }]);
    expect(inputsOf({ type: 'compare', op: 'above', left: count, right: { type: 'literal', value: 0 } })).toEqual([{ sourceId: 'guest', path: ['attributes', 'preset_modes'] }]);
  });
});
