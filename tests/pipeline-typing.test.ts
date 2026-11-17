import { describe, expect, it } from 'vitest';
import {
  ANY, BOOLEAN, INTEGER, NULL, NUMBER, STRING, arrayOf, newFacts, objectOf, orNull, text, typeOperand, typeStep, typeSteps, typeWhere, todoItemShape, requestShape,
  type PipelineOperand, type PipelineStep, type ReadKind, type Shape, type Where,
} from '../src/shared/composition/pipeline';

const lit = (value: unknown): PipelineOperand => ({ type: 'literal', value: value as never });
const item = (...path: string[]): PipelineOperand => ({ type: 'item', path });
const params = new Map<string, ReadKind>([['list', 'entity-id'], ['limit', 'number']]);

const chores = arrayOf(objectOf({ uid: STRING, summary: STRING, due: orNull(text('date')), qty: INTEGER }, ['due']));
function step(value: PipelineStep, input: Shape) {
  const facts = newFacts();
  const shape = typeStep(value, input, params, '/s', facts);
  return { shape, issues: facts.issues };
}
function operand(value: PipelineOperand, scope: Partial<{ item: Shape; read: boolean; viewer: boolean }> = {}) {
  const facts = newFacts();
  const shape = typeOperand(value, { item: scope.item, params, allowRead: scope.read ?? false, allowViewer: scope.viewer ?? false }, '/o', facts);
  return { shape, issues: facts.issues, facts };
}
const element = objectOf({ uid: STRING, due: orNull(text('date')), qty: INTEGER, label: orNull(STRING) });

describe('operand typing', () => {
  it('types literals, parameters, the clock and the viewer', () => {
    expect(operand(lit('a')).shape).toEqual(STRING);
    expect(operand(lit(2)).shape).toEqual(INTEGER);
    expect(operand(lit([1, 'a'])).shape).toEqual(arrayOf({ kind: 'union', of: [{ kind: 'number', integer: true }, STRING] }));
    expect(operand({ type: 'param', name: 'limit' }).shape).toEqual(orNull(NUMBER));
    expect(operand({ type: 'param', name: 'list' }).shape).toEqual(orNull(text('entity-id')));
    expect(operand({ type: 'clock', part: 'today' }).shape).toEqual(text('date'));
    expect(operand({ type: 'clock', part: 'now' }).shape).toEqual(text('date-time'));
    expect(operand({ type: 'viewer', field: 'isAdmin' }, { viewer: true }).shape).toEqual(orNull(BOOLEAN));
    expect(operand({ type: 'viewer', field: 'userId' }, { viewer: true }).issues).toEqual([]);
  });

  it('marks the four flow operands so the document asks for the operands capability', () => {
    expect(operand(lit('a')).facts.newOperands).toBe(false);
    expect(operand({ type: 'format', pattern: '{a}', args: { a: lit(1) } }).facts.newOperands).toBe(false);
    for (const value of [item('uid'), { type: 'param', name: 'limit' }, { type: 'clock', part: 'today' }, { type: 'date', op: 'days-between', from: lit('2026-01-01'), to: lit('2026-01-02') }] as PipelineOperand[]) {
      expect(operand(value, { item: element }).facts.newOperands, value.type).toBe(true);
    }
  });

  it('puts each operand only where it may stand', () => {
    expect(operand(item('uid')).issues).toEqual([{ code: 'invalid_combination', pointer: '/o' }]);
    expect(operand({ type: 'viewer', field: 'userId' }).issues).toEqual([{ code: 'invalid_combination', pointer: '/o' }]);
    expect(operand({ type: 'read', from: { type: 'source', sourceId: 'x', path: ['state'] }, as: 'string', missing: 'unavailable' }).issues).toEqual([{ code: 'invalid_combination', pointer: '/o' }]);
    expect(operand({ type: 'read', from: { type: 'source', sourceId: 'x', path: ['state'] }, as: 'string', missing: 'unavailable' }, { read: true }).issues).toEqual([]);
  });

  it('follows an item path through the shape, naming the segment that is missing', () => {
    expect(operand(item('uid'), { item: element }).shape).toEqual(STRING);
    expect(operand(item('due'), { item: element }).shape).toEqual(orNull(text('date')));
    expect(operand(item(), { item: element }).shape).toEqual(element);
    expect(operand(item('nope'), { item: element }).issues).toEqual([{ code: 'invalid_reference', pointer: '/o/path' }]);
    expect(operand(item('0'), { item: ANY }).issues).toEqual([{ code: 'invalid_reference', pointer: '/o/path/0' }]);
  });

  it('types days-between as an integer, or a nullable one when a side may not be a date', () => {
    const today: PipelineOperand = { type: 'clock', part: 'today' };
    expect(operand({ type: 'date', op: 'days-between', from: today, to: today }).shape).toEqual(INTEGER);
    expect(operand({ type: 'date', op: 'days-between', from: item('due'), to: today }, { item: element }).shape).toEqual(orNull(INTEGER));
    expect(operand({ type: 'date', op: 'days-between', from: item('qty'), to: today }, { item: element }).issues).toEqual([{ code: 'binding_type', pointer: '/o/from' }]);
  });

  it('types format as text that is null when an argument may be, and checks its holes and digits', () => {
    expect(operand({ type: 'format', pattern: '{a}', args: { a: item('uid') } }, { item: element }).shape).toEqual(STRING);
    expect(operand({ type: 'format', pattern: '{a}', args: { a: item('label') } }, { item: element }).shape).toEqual(orNull(STRING));
    expect(operand({ type: 'format', pattern: '{b}', args: { a: lit(1) } }).issues).toEqual([{ code: 'invalid_reference', pointer: '/o/pattern' }]);
    expect(operand({ type: 'format', pattern: '{a', args: { a: lit(1) } }).issues).toEqual([{ code: 'invalid_value', pointer: '/o/pattern' }]);
    expect(operand({ type: 'format', pattern: '{a}', args: { a: lit('x') }, formats: { a: { number: { maximumFractionDigits: 1 } } } }).issues).toEqual([{ code: 'binding_type', pointer: '/o/formats/a' }]);
    expect(operand({ type: 'format', pattern: '{a}', args: { a: lit([1]) } }).issues).toEqual([{ code: 'binding_type', pointer: '/o/args/a' }]);
    expect(operand({ type: 'format', pattern: ' ', args: {} }).issues).toEqual([{ code: 'invalid_value', pointer: '/o/pattern' }]);
  });

  it('types map as the merge of its branches, null when the subject may be', () => {
    const cases = [{ equals: 1, then: lit('one') }];
    expect(operand({ type: 'map', of: item('qty'), cases, otherwise: lit('many') }, { item: element }).shape).toEqual(STRING);
    expect(operand({ type: 'map', of: item('label'), cases, otherwise: lit(0) }, { item: element }).shape).toEqual({ kind: 'union', of: [NULL, INTEGER, STRING] });
    expect(operand({ type: 'map', of: lit(1), cases: [], otherwise: lit(0) }).issues).toEqual([{ code: 'limit_exceeded', pointer: '/o/cases' }]);
  });

  it('types math as a number, nullable when it can divide by zero, and checks arity and arguments', () => {
    expect(operand({ type: 'math', op: 'add', args: [lit(1), lit(2)] }).shape).toEqual(NUMBER);
    expect(operand({ type: 'math', op: 'divide', args: [lit(1), lit(2)] }).shape).toEqual(orNull(NUMBER));
    expect(operand({ type: 'math', op: 'subtract', args: [lit(1)] }).issues).toEqual([{ code: 'invalid_combination', pointer: '/o/args' }]);
    expect(operand({ type: 'math', op: 'add', args: [lit(1), lit('x')] }).issues).toEqual([{ code: 'binding_type', pointer: '/o/args/1' }]);
  });

  it('types object and list operands and limits depth and size', () => {
    expect(operand({ type: 'object', fields: { a: lit(1), b: lit('x') } }).shape).toEqual(objectOf({ a: INTEGER, b: STRING }));
    expect(operand({ type: 'list', items: [lit(1), lit(2.5)] }).shape).toEqual(arrayOf(NUMBER));
    expect(operand({ type: 'object', fields: { 'a b': lit(1) } }).issues).toEqual([{ code: 'invalid_value', pointer: '/o/fields/a b' }]);
    let deep: PipelineOperand = lit(1);
    for (let level = 0; level < 8; level++) deep = { type: 'math', op: 'round', args: [deep] };
    expect(operand(deep).issues.map(issue => issue.code)).toEqual(['limit_exceeded']);
    const wide: PipelineOperand = { type: 'list', items: Array.from({ length: 64 }, () => ({ type: 'list', items: [lit(1)] }) as PipelineOperand) };
    expect(operand(wide).issues.map(issue => issue.code)).toContain('limit_exceeded');
  });
});

describe('condition typing', () => {
  const where = (value: Where) => { const facts = newFacts(); typeWhere(value, { item: element, params, allowRead: false, allowViewer: false }, '/w', facts); return facts.issues; };
  it('accepts comparisons of kinds that can meet and refuses ones that cannot', () => {
    expect(where({ type: 'compare', op: 'eq', left: item('uid'), right: lit('a') })).toEqual([]);
    expect(where({ type: 'compare', op: 'eq', left: item('label'), right: lit('a') })).toEqual([]);
    expect(where({ type: 'compare', op: 'eq', left: item('uid'), right: lit(1) })).toEqual([{ code: 'binding_type', pointer: '/w/right' }]);
    expect(where({ type: 'compare', op: 'above', left: item('qty'), right: lit(1) })).toEqual([]);
    expect(where({ type: 'compare', op: 'above', left: item('uid'), right: lit(1) })).toEqual([{ code: 'binding_type', pointer: '/w/left' }]);
    expect(where({ type: 'compare', op: 'before', left: item('due'), right: { type: 'clock', part: 'now' } })).toEqual([]);
    expect(where({ type: 'compare', op: 'before', left: item('qty'), right: { type: 'clock', part: 'now' } })).toEqual([{ code: 'binding_type', pointer: '/w/left' }]);
  });
  it('types in, exists and the combinators, and limits their size', () => {
    expect(where({ type: 'in', value: item('uid'), in: [lit('a'), lit('b')] })).toEqual([]);
    expect(where({ type: 'in', value: item('uid'), in: [lit(1)] })).toEqual([{ code: 'binding_type', pointer: '/w/in/0' }]);
    expect(where({ type: 'exists', value: item('due') })).toEqual([]);
    expect(where({ type: 'not', of: { type: 'any', of: [{ type: 'exists', value: item('due') }] } })).toEqual([]);
    let deep: Where = { type: 'exists', value: item('due') };
    for (let level = 0; level < 6; level++) deep = { type: 'not', of: deep };
    expect(where(deep)).toEqual([{ code: 'limit_exceeded', pointer: '/w/of/of/of/of/of/of' }]);
  });
});

describe('step typing', () => {
  const flat = (value: Partial<PipelineStep> & { op: PipelineStep['op'] }) => ({ id: 'x', ...value }) as PipelineStep;
  it('get follows a path, adding null where a field is optional, and names a missing field', () => {
    expect(step(flat({ op: 'get', path: ['items'] }), requestShape({ type: 'ha-subscription', kind: 'todo-items', entityId: { type: 'literal', value: 'todo.demo' } })).shape).toEqual(arrayOf(todoItemShape));
    expect(step(flat({ op: 'get', path: ['a', 'b'] }), objectOf({ a: objectOf({ b: STRING }) }, ['a'])).shape).toEqual(orNull(STRING));
    expect(step(flat({ op: 'get', path: ['nope'] }), objectOf({ a: STRING })).issues).toEqual([{ code: 'invalid_reference', pointer: '/s/path' }]);
    expect(step(flat({ op: 'get', path: ['a'] }), STRING).issues).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
    expect(step(flat({ op: 'get', path: ['a'] }), ANY).shape).toEqual(ANY);
  });
  it('select-key gives the entry for a literal key and the merge of every entry for any other key', () => {
    const answer = objectOf({ 'todo.demo_a': objectOf({ items: arrayOf(INTEGER) }), 'todo.demo_b': objectOf({ items: arrayOf(STRING) }) });
    expect(step(flat({ op: 'select-key', key: lit('todo.demo_a') }), answer).shape).toEqual(objectOf({ items: arrayOf(INTEGER) }));
    expect(step(flat({ op: 'select-key', key: lit('todo.demo_z') }), answer).issues).toEqual([{ code: 'invalid_reference', pointer: '/s/key/value' }]);
    expect(step(flat({ op: 'select-key', key: { type: 'param', name: 'list' } }), answer).shape).toEqual({
      kind: 'union', of: [NULL, { kind: 'object', fields: { items: { shape: { kind: 'array', of: { kind: 'union', of: [INTEGER, STRING] } } } } }],
    });
    expect(step(flat({ op: 'select-key', key: lit(1) }), answer).issues).toEqual([{ code: 'binding_type', pointer: '/s/key' }]);
    expect(step(flat({ op: 'select-key', key: lit('a') }), arrayOf(STRING)).issues).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
  });
  it('filter, sort, limit and unique keep the list; each needs one', () => {
    for (const value of [
      flat({ op: 'filter', where: { type: 'exists', value: item('due') } }),
      flat({ op: 'sort', by: [{ value: item('due'), direction: 'ascending', kind: 'date' }] }),
      flat({ op: 'limit', count: 3 }),
      flat({ op: 'unique', by: item('uid') }),
    ]) {
      expect(step(value, chores), value.op).toEqual({ shape: chores, issues: [] });
      expect(step(value, STRING).issues, value.op).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
    }
  });
  it('sort checks each key against its kind', () => {
    expect(step(flat({ op: 'sort', by: [{ value: item('qty'), direction: 'descending', kind: 'number' }] }), chores).issues).toEqual([]);
    expect(step(flat({ op: 'sort', by: [{ value: item('uid'), direction: 'descending', kind: 'number' }] }), chores).issues).toEqual([{ code: 'binding_type', pointer: '/s/by/0/value' }]);
    expect(step(flat({ op: 'sort', by: [{ value: item('qty'), direction: 'descending', kind: 'text' }] }), chores).issues).toEqual([{ code: 'binding_type', pointer: '/s/by/0/value' }]);
  });
  it('map builds an object per item, or one object from an object, and sees item as each', () => {
    const built = step(flat({ op: 'map', fields: { id: item('uid'), late: { type: 'date', op: 'days-between', from: item('due'), to: { type: 'clock', part: 'today' } } } }), chores);
    expect(built).toEqual({ shape: arrayOf(objectOf({ id: STRING, late: orNull(INTEGER) })), issues: [] });
    expect(step(flat({ op: 'map', fields: { id: item('uid') } }), objectOf({ uid: STRING })).shape).toEqual(orNull(objectOf({ id: STRING })));
    expect(step(flat({ op: 'map', fields: { id: item('uid') } }), STRING).issues).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
    expect(step(flat({ op: 'map', fields: {} }), chores).issues).toEqual([{ code: 'limit_exceeded', pointer: '/s/fields' }]);
  });
  it('group gives key, count and items; count an integer; sum a number; first the item or null', () => {
    expect(step(flat({ op: 'group', by: item('uid') }), chores).shape).toEqual(arrayOf(objectOf({ key: orNull(STRING), count: INTEGER, items: chores })));
    expect(step(flat({ op: 'count' }), chores).shape).toEqual(INTEGER);
    expect(step(flat({ op: 'sum', value: item('qty') }), chores).shape).toEqual(NUMBER);
    expect(step(flat({ op: 'sum', value: item('uid') }), chores).issues).toEqual([{ code: 'binding_type', pointer: '/s/value' }]);
    expect(step(flat({ op: 'first' }), chores).shape).toEqual(orNull((chores as { of: Shape }).of));
    expect(step(flat({ op: 'count' }), objectOf({})).issues).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
    expect(step(flat({ op: 'group', by: lit([1]) }), chores).issues).toEqual([{ code: 'binding_type', pointer: '/s/by' }]);
  });
  it('flatten joins the lists at a path, and default sets a field as required and never null', () => {
    const nested = arrayOf(objectOf({ name: STRING, stock: arrayOf(objectOf({ lot: STRING, qty: orNull(NUMBER) })) }));
    expect(step(flat({ op: 'flatten', path: ['stock'] }), nested).shape).toEqual(arrayOf(objectOf({ lot: STRING, qty: orNull(NUMBER) })));
    expect(step(flat({ op: 'flatten', path: ['name'] }), nested).issues).toEqual([{ code: 'binding_type', pointer: '/s/path' }]);
    expect(step(flat({ op: 'flatten', path: ['nope'] }), nested).issues).toEqual([{ code: 'invalid_reference', pointer: '/s/path' }]);
    expect(step(flat({ op: 'flatten', path: [] }), arrayOf(arrayOf(INTEGER))).shape).toEqual(arrayOf(INTEGER));
    const lots = arrayOf(objectOf({ lot: STRING, qty: orNull(NUMBER) }));
    expect(step(flat({ op: 'default', path: ['qty'], value: lit(0) }), lots).shape).toEqual(arrayOf(objectOf({ lot: STRING, qty: NUMBER })));
    expect(step(flat({ op: 'default', path: ['note'], value: lit('none') }), lots).shape).toEqual(arrayOf(objectOf({ lot: STRING, qty: orNull(NUMBER), note: STRING })));
    expect(step(flat({ op: 'default', path: ['a', 'b'], value: lit(0) }), lots).issues).toEqual([{ code: 'invalid_reference', pointer: '/s/path' }]);
    expect(step(flat({ op: 'default', path: ['qty'], value: lit(0) }), STRING).issues).toEqual([{ code: 'binding_type', pointer: '/s/op' }]);
  });
  it('types a whole list of steps and gives the shape after each', () => {
    const facts = newFacts();
    const shapes = typeSteps([flat({ op: 'filter', where: { type: 'exists', value: item('due') } }), flat({ op: 'count' })], chores, params, '/p', facts);
    expect(shapes).toEqual([chores, INTEGER]);
    expect(facts.issues).toEqual([]);
  });
  it('reports one mistake once: a failed step gives any, which the next step accepts', () => {
    const facts = newFacts();
    typeSteps([flat({ op: 'get', path: ['nope'] }), flat({ op: 'limit', count: 2 }), flat({ op: 'filter', where: { type: 'exists', value: item('a') } })], objectOf({ a: STRING }), params, '/p', facts);
    expect(facts.issues).toEqual([{ code: 'invalid_reference', pointer: '/p/steps/0/path' }]);
  });
});
