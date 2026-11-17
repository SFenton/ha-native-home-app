import { describe, expect, it } from 'vitest';
import {
  ANY, BOOLEAN, INTEGER, NEVER, NULL, NUMBER, STRING, arrayOf, elementOf, fieldOf, inferShape, inferShapeFromSamples, isAssignable, isEntityKeyed,
  merge, objectOf, orNull, shapeAt, shapeProblem, shapeSchema, stringFormat, text, withField, withoutNull, type Shape,
} from '../src/shared/composition/pipeline';

describe('shape inference', () => {
  it('types each scalar, keeping integers apart from other numbers', () => {
    expect(inferShape(null)).toEqual(NULL);
    expect(inferShape(true)).toEqual(BOOLEAN);
    expect(inferShape(3)).toEqual(INTEGER);
    expect(inferShape(3.5)).toEqual(NUMBER);
    expect(inferShape(-0.0)).toEqual(INTEGER);
  });

  it('recognizes the string formats in a fixed order', () => {
    expect(stringFormat('2026-11-15')).toBe('date');
    expect(stringFormat('2026-11-15 09:30:00')).toBe('date-time');
    expect(stringFormat('2026-11-15T09:30:00.250+02:00')).toBe('date-time');
    expect(stringFormat('todo.demo_chores')).toBe('entity-id');
    expect(stringFormat('https://example.invalid/a')).toBe('url');
    expect(stringFormat('-12.5')).toBe('numeric');
    expect(stringFormat('2026-13-45')).toBeUndefined();
    expect(stringFormat('2026-02-30')).toBeUndefined();
    expect(stringFormat('2026-11-15T25:00:00')).toBeUndefined();
    expect(stringFormat('Water plants')).toBeUndefined();
  });

  it('makes an enum candidate of a short plain string and none of a long one', () => {
    expect(inferShape('needs_action')).toEqual({ kind: 'string', enum: ['needs_action'] });
    expect(inferShape('x'.repeat(65))).toEqual(STRING);
    expect(inferShape('2026-11-15')).toEqual(text('date'));
  });

  it('infers lists as the merge of their items and an empty list as a list of nothing', () => {
    expect(inferShape([])).toEqual(arrayOf(NEVER));
    expect(inferShape([1, 2.5])).toEqual(arrayOf(NUMBER));
    expect(inferShape([1, 2])).toEqual(arrayOf(INTEGER));
    expect(inferShape([1, 'a', null])).toEqual(arrayOf({ kind: 'union', of: [NULL, INTEGER, { kind: 'string', enum: ['a'] }] }));
  });

  it('infers objects with every field required, and merges samples so a missing field becomes optional', () => {
    const shape = inferShapeFromSamples([{ uid: 'a', due: '2026-11-15' }, { uid: 'b' }]);
    expect(shape).toEqual({
      kind: 'object', fields: { due: { shape: text('date'), optional: true }, uid: { shape: { kind: 'string', enum: ['a', 'b'] } } },
    });
  });

  it('keeps an enum only while at most 8 different strings were seen', () => {
    const eight = Array.from({ length: 8 }, (_, index) => `s${index}`);
    expect(inferShapeFromSamples(eight)).toEqual({ kind: 'string', enum: [...eight].sort() });
    expect(inferShapeFromSamples([...eight, 's8'])).toEqual(STRING);
  });

  it('drops a format two samples disagree on, and a format meeting an enum', () => {
    expect(inferShapeFromSamples(['2026-11-15', '2026-11-15 09:00:00'])).toEqual(STRING);
    expect(inferShapeFromSamples(['2026-11-15', 'soon'])).toEqual(STRING);
    expect(inferShapeFromSamples(['2026-11-15', '2026-12-01'])).toEqual(text('date'));
  });

  it('merges different kinds into a union in the closed order and absorbs into any', () => {
    expect(merge(STRING, NULL)).toEqual({ kind: 'union', of: [NULL, STRING] });
    expect(merge({ kind: 'union', of: [NULL, STRING] }, NUMBER)).toEqual({ kind: 'union', of: [NULL, NUMBER, STRING] });
    expect(merge(ANY, STRING)).toEqual(ANY);
    expect(merge(NEVER, NUMBER)).toEqual(NUMBER);
    expect(merge(INTEGER, NUMBER)).toEqual(NUMBER);
    expect(merge(INTEGER, INTEGER)).toEqual(INTEGER);
  });

  it('merges nested objects and lists recursively', () => {
    const a = inferShape({ items: [{ x: 1 }] }), b = inferShape({ items: [{ x: 2, y: 'k' }] });
    expect(merge(a, b)).toEqual(objectOf({ items: arrayOf({ kind: 'object', fields: { x: { shape: INTEGER }, y: { shape: { kind: 'string', enum: ['k'] }, optional: true } } }) }));
  });

  it('recognizes a response keyed by entity id', () => {
    expect(isEntityKeyed(inferShape({ 'todo.demo_a': { items: [] }, 'todo.demo_b': { items: [] } }))).toBe(true);
    expect(isEntityKeyed(inferShape({ items: [] }))).toBe(false);
    expect(isEntityKeyed(inferShape({}))).toBe(false);
    expect(isEntityKeyed(STRING)).toBe(false);
  });

  it('produces shapes the schema accepts', () => {
    for (const sample of [[], { a: [1, { b: null }] }, 'x', 7, [[1], ['a']]]) expect(shapeSchema.safeParse(inferShape(sample as any)).success).toBe(true);
  });
});

describe('shape fit and reading', () => {
  const item = objectOf({ uid: STRING, due: orNull(text('date')), n: INTEGER }, ['due']);

  it('says a value fits a wider target', () => {
    expect(isAssignable(INTEGER, NUMBER)).toBe(true);
    expect(isAssignable(NUMBER, INTEGER)).toBe(false);
    expect(isAssignable(text('date'), STRING)).toBe(true);
    expect(isAssignable(STRING, text('date'))).toBe(false);
    expect(isAssignable({ kind: 'string', enum: ['a'] }, { kind: 'string', enum: ['a', 'b'] })).toBe(true);
    expect(isAssignable({ kind: 'string', enum: ['a', 'c'] }, { kind: 'string', enum: ['a', 'b'] })).toBe(false);
    expect(isAssignable(STRING, { kind: 'string', enum: ['a'] })).toBe(false);
    expect(isAssignable(NEVER, STRING)).toBe(true);
    expect(isAssignable(ANY, STRING)).toBe(false);
    expect(isAssignable(STRING, ANY)).toBe(true);
  });

  it('lets an object carry extra fields but not lack a required one', () => {
    expect(isAssignable(item, objectOf({ uid: STRING }))).toBe(true);
    expect(isAssignable(objectOf({ uid: STRING }), item)).toBe(false);
    expect(isAssignable(objectOf({ uid: STRING }), objectOf({ uid: STRING, due: STRING }, ['due']))).toBe(true);
    expect(isAssignable(objectOf({ uid: STRING }, ['uid']), objectOf({ uid: STRING }))).toBe(false);
  });

  it('fits a union member by member', () => {
    expect(isAssignable(orNull(STRING), orNull(STRING))).toBe(true);
    expect(isAssignable(orNull(STRING), STRING)).toBe(false);
    expect(isAssignable(STRING, orNull(STRING))).toBe(true);
    expect(isAssignable(arrayOf(INTEGER), arrayOf(NUMBER))).toBe(true);
  });

  it('reads a field: an optional field may be null, a field of no member is unknown, any passes through', () => {
    expect(fieldOf(item, 'uid')).toEqual(STRING);
    expect(fieldOf(item, 'due')).toEqual(orNull(text('date')));
    expect(fieldOf(item, 'nope')).toBeUndefined();
    expect(fieldOf(ANY, 'anything')).toEqual(ANY);
    expect(fieldOf(orNull(item), 'uid')).toEqual(orNull(STRING));
    expect(fieldOf(STRING, 'uid')).toBeUndefined();
  });

  it('reads a path, the item of a list and sets a field', () => {
    expect(shapeAt(objectOf({ a: objectOf({ b: INTEGER }) }), ['a', 'b'])).toEqual(INTEGER);
    expect(shapeAt(objectOf({ a: INTEGER }), ['a', 'b'])).toBeUndefined();
    expect(shapeAt(STRING, [])).toEqual(STRING);
    expect(elementOf(arrayOf(STRING))).toEqual(STRING);
    expect(elementOf(orNull(arrayOf(STRING)))).toEqual(STRING);
    expect(elementOf(STRING)).toBeUndefined();
    expect(elementOf(ANY)).toEqual(ANY);
    expect(withField(item, ['n'], STRING)).toEqual(objectOf({ uid: STRING, due: orNull(text('date')), n: STRING }, ['due']));
    expect(withField(objectOf({ a: objectOf({}) }), ['a', 'z'], INTEGER)).toEqual(objectOf({ a: objectOf({ z: INTEGER }) }));
    expect(withField(objectOf({}), ['a', 'z'], INTEGER)).toBeUndefined();
    expect(withField(STRING, ['a'], INTEGER)).toBeUndefined();
    expect(withoutNull(orNull(STRING))).toEqual(STRING);
    expect(withoutNull(NULL)).toEqual(NEVER);
  });

  it('reports a shape that is too deep, too wide or a malformed union', () => {
    let deep: Shape = STRING;
    for (let level = 0; level < 6; level++) deep = arrayOf(deep);
    expect(shapeProblem(deep)).toEqual({ code: 'limit_exceeded', pointer: '/of/of/of/of/of/of' });
    expect(shapeProblem(arrayOf(STRING))).toBeUndefined();
    const wide = objectOf(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`f${index}`, STRING])));
    expect(shapeProblem(wide)).toEqual({ code: 'limit_exceeded', pointer: '/fields' });
    expect(shapeProblem({ kind: 'union', of: [STRING, STRING] })).toEqual({ code: 'invalid_value', pointer: '/of/1' });
    expect(shapeProblem({ kind: 'string', format: 'date', enum: ['a'] })).toEqual({ code: 'invalid_value', pointer: '/enum' });
  });

  it('refuses unknown keys, a one-member union and an enum of more than 8 values in the schema', () => {
    expect(shapeSchema.safeParse({ kind: 'string', colour: 'red' }).success).toBe(false);
    expect(shapeSchema.safeParse({ kind: 'union', of: [{ kind: 'null' }] }).success).toBe(false);
    expect(shapeSchema.safeParse({ kind: 'string', enum: Array.from({ length: 9 }, (_, index) => `s${index}`) }).success).toBe(false);
  });
});
