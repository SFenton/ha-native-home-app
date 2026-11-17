import type { CompositionIssue } from '../json';
import { pointer as join } from '../json';
import {
  ANY, BOOLEAN, INTEGER, NEVER, NUMBER, STRING, elementOf, fieldOf, hasObject, kindsOf, merge, objectOf, orNull, shapeAt, text, withField, withoutNull,
  type Member, type Shape,
} from './shape';
import { MAX_RULE_CASES } from '../expression';
import { mathArity, PIPELINE_LIMITS, type PipelineOperand, type PipelineStep, type ReadKind, type Where } from './schema';
import { flowExtrasDateStyles } from '../expression';

/**
 * The typing rules of a Data Flow: each operand, condition and step has a rule from the shapes it is given to the shape it gives, computed
 * without running anything. The compiler uses them to check a flow against its authored shapes, and the Studio uses the same functions to
 * show the shape after each step and to offer only the steps and fields that fit.
 *
 * `null` is tolerated everywhere: every operand is total, so a missing value is `null` and no rule refuses a shape for being nullable. A rule
 * refuses only a kind that can never fit (a list where a number is needed) or a name that does not exist.
 */

/** What walking the operands and steps of one flow found. Pointers are relative to the base the caller gave. */
export interface TypeFacts {
  issues: CompositionIssue[];
  /** Every `read` operand, for the compiler's source checks. */
  reads: { read: Extract<PipelineOperand, { type: 'read' }>; pointer: string }[];
  /** Every `param` operand, for the acyclic check and the reference check. */
  paramRefs: { name: string; pointer: string }[];
  /** Whether an `item`, `param`, `clock` or `date` operand appears: the flow then needs `sh.pipeline-operands@1`. */
  newOperands: boolean;
  /** Whether a `format` asks for the `words` case: the flow then needs `sh.text-case-words@1`. */
  wordsCase: boolean;
  /** Whether a `choose` appears: the flow then needs `sh.rules@1`. */
  usesRules: boolean;
  /** Whether a step, a date style or a `date` operation of `sh.flow-extras@1` appears: the flow then needs it. */
  flowExtras: boolean;
  /** Whether an `index` operand appears: the flow then needs `sh.repeat@1`. */
  usesRepeat: boolean;
}
export const newFacts = (): TypeFacts => ({ issues: [], reads: [], paramRefs: [], newOperands: false, wordsCase: false, usesRules: false, flowExtras: false, usesRepeat: false });

/** Where an operand stands: what it may read and what `item` means there. */
export interface TypeScope {
  /** The shape of `item`; absent outside a step and a row. */
  item?: Shape;
  /** The declared parameters and their kinds. */
  params: ReadonlyMap<string, ReadKind>;
  /** A `read` of another source: parameters only. */
  allowRead: boolean;
  /** A `viewer` operand: parameters and the request only. */
  allowViewer: boolean;
}
/** The shape a parameter of the given kind has. */
export const parameterShape = (kind: ReadKind): Shape => kind === 'string' ? STRING : kind === 'number' ? NUMBER : kind === 'boolean' ? BOOLEAN : text('entity-id');

const scalarKinds: Member['kind'][] = ['boolean', 'number', 'string'];
/** The non-null kinds a shape can take; `any` is all of them. */
const kinds = (shape: Shape): Set<Member['kind']> => kindsOf(withoutNull(shape));
const nullable = (shape: Shape): boolean => kindsOf(shape).has('null') || shape.kind === 'any';

/** An issue of `code` at `at`. */
function report(facts: TypeFacts, code: CompositionIssue['code'], at: string) { facts.issues.push({ code, pointer: at }); }
/** Requires a shape to be able to take one of `allowed`; `never` (no value was ever seen) fits anything. */
function expectKinds(facts: TypeFacts, shape: Shape, allowed: Member['kind'][], at: string, code: CompositionIssue['code'] = 'binding_type') {
  const have = kinds(shape);
  if (have.size && !allowed.some(kind => have.has(kind))) report(facts, code, at);
}
/** Two shapes can be compared when they can take a scalar kind in common. */
function comparable(a: Shape, b: Shape): boolean {
  const left = kinds(a), right = kinds(b);
  if (!left.size || !right.size) return true;
  return scalarKinds.some(kind => left.has(kind) && right.has(kind));
}

// MARK: Operands

/** The budget of one operand tree: nodes left. */
export interface NodeBudget { nodes: number }
const holeName = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
const entityIdFormat = text('entity-id');

/** Types one operand. Issues, reads and parameter references go to `facts`; the result is `any` where the operand is wrong. */
export function typeOperand(operand: PipelineOperand, scope: TypeScope, at: string, facts: TypeFacts, budget: NodeBudget = { nodes: PIPELINE_LIMITS.operandNodes }, depth = 1): Shape {
  if (depth > PIPELINE_LIMITS.operandDepth || budget.nodes <= 0) { report(facts, 'limit_exceeded', at); return ANY; }
  budget.nodes -= 1;
  const sub = (child: PipelineOperand, ...parts: (string | number)[]) => typeOperand(child, scope, parts.reduce<string>(join, at), facts, budget, depth + 1);
  switch (operand.type) {
    case 'literal': {
      const value = operand.value;
      const size = (candidate: unknown, level: number): boolean => typeof candidate === 'string' ? candidate.length <= 2000
        : candidate !== null && typeof candidate === 'object' ? level <= 4 && Object.values(candidate).length <= 64 && Object.values(candidate).every(item => size(item, level + 1)) : true;
      if (!size(value, 1)) report(facts, 'limit_exceeded', join(at, 'value'));
      return inferLiteral(value);
    }
    case 'read':
      if (!scope.allowRead) report(facts, 'invalid_combination', at);
      checkSegments(operand.from.path, join(join(at, 'from'), 'path'), facts);
      facts.reads.push({ read: operand, pointer: at });
      return orNull(parameterShape(operand.as));
    case 'viewer':
      if (!scope.allowViewer) report(facts, 'invalid_combination', at);
      return operand.field === 'isAdmin' ? orNull(BOOLEAN) : orNull(operand.field === 'personEntityId' ? entityIdFormat : STRING);
    case 'item': {
      facts.newOperands = true;
      if (!scope.item) { report(facts, 'invalid_combination', at); return ANY; }
      checkSegments(operand.path, join(at, 'path'), facts);
      const found = shapeAt(scope.item, operand.path);
      if (!found) { report(facts, 'invalid_reference', join(at, 'path')); return ANY; }
      return found;
    }
    case 'param': {
      facts.newOperands = true;
      facts.paramRefs.push({ name: operand.name, pointer: join(at, 'name') });
      const kind = scope.params.get(operand.name);
      return kind ? orNull(parameterShape(kind)) : ANY;
    }
    case 'clock':
      facts.newOperands = true;
      return text(operand.part === 'today' ? 'date' : 'date-time');
    case 'index':
      // The position of the item a step looks at (`sh.repeat@1`); a parameter or the request has no item.
      facts.usesRepeat = true;
      if (!scope.item) report(facts, 'invalid_combination', at);
      return INTEGER;
    case 'date': {
      facts.newOperands = true;
      const from = sub(operand.from, 'from'), to = sub(operand.to, 'to');
      expectKinds(facts, from, ['string'], join(at, 'from')); expectKinds(facts, to, ['string'], join(at, 'to'));
      // `progress` (`sh.flow-extras@1`): a fraction of the span, null when either moment or the clock is not a date.
      if (operand.op === 'progress') { facts.flowExtras = true; return orNull(NUMBER); }
      const dated = (shape: Shape) => !nullable(shape) && memberFormat(shape);
      return dated(from) && dated(to) ? INTEGER : orNull(INTEGER);
    }
    case 'format': {
      const names = Object.keys(operand.args).sort();
      if (names.length > 16) report(facts, 'limit_exceeded', join(at, 'args'));
      let anyNull = false;
      const args = new Map<string, Shape>();
      for (const name of names) {
        if (!holeName.test(name)) report(facts, 'invalid_value', join(join(at, 'args'), name));
        const shape = sub(operand.args[name], 'args', name);
        expectKinds(facts, shape, scalarKinds, join(join(at, 'args'), name));
        anyNull ||= nullable(shape); args.set(name, shape);
      }
      let rest = operand.pattern;
      for (let open = rest.indexOf('{'); open >= 0; open = rest.indexOf('{')) {
        const close = rest.indexOf('}', open);
        if (close < 0) { report(facts, 'invalid_value', join(at, 'pattern')); break; }
        if (!Object.hasOwn(operand.args, rest.slice(open + 1, close))) report(facts, 'invalid_reference', join(at, 'pattern'));
        rest = rest.slice(close + 1);
      }
      if (!operand.pattern.trim()) report(facts, 'invalid_value', join(at, 'pattern'));
      for (const name of Object.keys(operand.formats ?? {}).sort()) {
        const spec = operand.formats![name], where = join(join(at, 'formats'), name);
        if (!Object.hasOwn(operand.args, name)) report(facts, 'invalid_reference', where);
        else if ('text' in spec) { if (spec.text.case === 'title') facts.newOperands = true; else facts.wordsCase = true; expectKinds(facts, args.get(name)!, ['string'], where); }
        else if ('date' in spec) {
          // A date style draws a date or a date and time, which is text; `hour` and `weekday` are `sh.flow-extras@1`'s.
          facts.newOperands = true;
          if (flowExtrasDateStyles.includes(spec.date.style)) facts.flowExtras = true;
          expectKinds(facts, args.get(name)!, ['string'], where);
        } else {
          if ('number' in spec && spec.number.minimumFractionDigits !== undefined) {
            facts.newOperands = true;
            if (spec.number.minimumFractionDigits > spec.number.maximumFractionDigits) report(facts, 'invalid_combination', join(join(where, 'number'), 'minimumFractionDigits'));
          }
          expectKinds(facts, args.get(name)!, ['number'], where);
        }
      }
      return anyNull ? orNull(STRING) : STRING;
    }
    case 'map': {
      const subject = sub(operand.of, 'of');
      let result = sub(operand.otherwise, 'otherwise');
      if (!operand.cases.length || operand.cases.length > 32) report(facts, 'limit_exceeded', join(at, 'cases'));
      operand.cases.forEach((entry, index) => { result = merge(result, sub(entry.then, 'cases', index, 'then')); });
      return nullable(subject) ? orNull(result) : result;
    }
    case 'math': {
      const [low, high] = mathArity[operand.op];
      if (operand.args.length < low || operand.args.length > high) report(facts, 'invalid_combination', join(at, 'args'));
      let anyNull = ['divide', 'scale', 'clamp', 'round'].includes(operand.op);
      operand.args.forEach((arg, index) => {
        const shape = sub(arg, 'args', index);
        expectKinds(facts, shape, ['number'], join(join(at, 'args'), index));
        anyNull ||= nullable(shape);
      });
      return anyNull ? orNull(NUMBER) : NUMBER;
    }
    case 'object': {
      const names = Object.keys(operand.fields).sort();
      if (names.length > PIPELINE_LIMITS.mapFields * 2) report(facts, 'limit_exceeded', join(at, 'fields'));
      const fields: Record<string, Shape> = {};
      for (const name of names) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) report(facts, 'invalid_value', join(join(at, 'fields'), name));
        fields[name] = sub(operand.fields[name], 'fields', name);
      }
      return objectOf(fields);
    }
    case 'control': case 'raw-state': case 'list-count': case 'list-includes': report(facts, 'invalid_combination', at); return ANY;
    case 'choose': {
      facts.usesRules = true;
      if (!operand.cases.length || operand.cases.length > MAX_RULE_CASES) report(facts, 'limit_exceeded', join(at, 'cases'));
      let result = sub(operand.otherwise, 'otherwise');
      const branches: [Shape, string][] = [];
      operand.cases.forEach((entry, index) => {
        typeWhere(entry.when, scope, join(join(join(at, 'cases'), index), 'when'), facts);
        branches.push([sub(entry.then, 'cases', index, 'then'), join(join(join(at, 'cases'), index), 'then')]);
      });
      // The branches give one kind: a branch with no kind in common with the first reports at itself.
      const first = branches[0]?.[0] ?? result;
      for (const [shape, pointer] of branches) if (!comparable(first, shape)) { report(facts, 'binding_type', pointer); break; }
      if (!comparable(first, result)) report(facts, 'binding_type', join(at, 'otherwise'));
      for (const [shape] of branches) result = merge(result, shape);
      return result;
    }
    case 'list': {
      if (operand.items.length > 64) report(facts, 'limit_exceeded', join(at, 'items'));
      let result: Shape = NEVER;
      operand.items.forEach((item, index) => { result = merge(result, sub(item, 'items', index)); });
      return { kind: 'array', of: result };
    }
  }
}
function inferLiteral(value: unknown): Shape {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return BOOLEAN;
  if (typeof value === 'number') return Number.isInteger(value) ? INTEGER : NUMBER;
  if (typeof value === 'string') return STRING;
  if (Array.isArray(value)) return { kind: 'array', of: value.reduce<Shape>((shape, item) => merge(shape, inferLiteral(item)), NEVER) };
  return objectOf(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, inferLiteral(item)])));
}
const memberFormat = (shape: Shape): boolean => shape.kind === 'string' && (shape.format === 'date' || shape.format === 'date-time');
/** A path segment is `[A-Za-z0-9_-]`, never all digits, never a reserved name: a list cannot be indexed. */
export function checkSegments(path: readonly string[], at: string, facts: TypeFacts) {
  path.forEach((segment, index) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(segment) || /^\d+$/.test(segment) || ['__proto__', 'prototype', 'constructor'].includes(segment)) report(facts, 'invalid_reference', join(at, index));
  });
}

// MARK: Conditions

/** Types a condition. Operands inside it are checked against `scope`. */
export function typeWhere(where: Where, scope: TypeScope, at: string, facts: TypeFacts, counter = { nodes: PIPELINE_LIMITS.whereNodes }, depth = 1): void {
  if (counter.nodes <= 0 || depth > 6) { report(facts, 'limit_exceeded', at); return; }
  counter.nodes -= 1;
  const operand = (value: PipelineOperand, ...parts: string[]) => typeOperand(value, scope, parts.reduce(join, at), facts);
  switch (where.type) {
    case 'all': case 'any': where.of.forEach((part, index) => typeWhere(part, scope, join(join(at, 'of'), index), facts, counter, depth + 1)); return;
    case 'not': typeWhere(where.of, scope, join(at, 'of'), facts, counter, depth + 1); return;
    // The document leaves read a source or the signed-in person by name; a flow reads through a parameter's `read` and `viewer` instead.
    case 'state': case 'numeric': case 'viewer': case 'viewer-person': report(facts, 'invalid_combination', at); return;
    case 'exists': operand(where.value, 'value'); return;
    case 'in': {
      const subject = operand(where.value, 'value');
      where.in.forEach((option, index) => { if (!comparable(subject, typeOperand(option, scope, join(join(at, 'in'), index), facts))) report(facts, 'binding_type', join(join(at, 'in'), index)); });
      return;
    }
    case 'compare': {
      const left = operand(where.left, 'left'), right = operand(where.right, 'right');
      switch (where.op) {
        case 'eq': case 'ne': if (!comparable(left, right)) report(facts, 'binding_type', join(at, 'right')); return;
        case 'above': case 'below':
          expectKinds(facts, left, ['number'], join(at, 'left')); expectKinds(facts, right, ['number'], join(at, 'right')); return;
        case 'before': case 'after':
          expectKinds(facts, left, ['string'], join(at, 'left')); expectKinds(facts, right, ['string'], join(at, 'right')); return;
      }
    }
  }
}

// MARK: Steps

/** The scope a step's operands see: `item` is each element of a list, or the object itself for `map` and `default` on one record. */
const stepScope = (base: Omit<TypeScope, 'item'>, item?: Shape): TypeScope => ({ ...base, item });
/**
 * The shape a step gives when it receives `input`. A step that cannot apply to the shape reports `binding_type` at its `op`; a name that does not
 * exist reports `invalid_reference` at the name; the result is then `any`, so one mistake reports once.
 */
export function typeStep(step: PipelineStep, input: Shape, params: TypeScope['params'], at: string, facts: TypeFacts): Shape {
  const base = { params, allowRead: false, allowViewer: false };
  const list = (): Shape | undefined => {
    const element = elementOf(input);
    if (element === undefined) report(facts, 'binding_type', join(at, 'op'));
    return element;
  };
  const operand = (value: PipelineOperand, item: Shape | undefined, ...parts: (string | number)[]) =>
    typeOperand(value, stepScope(base, item), parts.reduce<string>(join, at), facts);
  switch (step.op) {
    case 'get': {
      if (!hasObject(input)) { report(facts, 'binding_type', join(at, 'op')); return ANY; }
      const found = shapeAt(input, step.path);
      if (!found) { report(facts, 'invalid_reference', join(at, 'path')); return ANY; }
      checkSegments(step.path, join(at, 'path'), facts);
      return found;
    }
    case 'select-key': {
      const key = operand(step.key, undefined, 'key');
      expectKinds(facts, key, ['string'], join(at, 'key'));
      const holder = withoutNull(input);
      if (holder.kind !== 'object') { if (holder.kind !== 'any') report(facts, 'binding_type', join(at, 'op')); return ANY; }
      if (step.key.type === 'literal' && typeof step.key.value === 'string') {
        const found = fieldOf(holder, step.key.value);
        if (!found) { report(facts, 'invalid_reference', join(join(at, 'key'), 'value')); return ANY; }
        return found;
      }
      let all: Shape = NEVER;
      for (const field of Object.values(holder.fields)) all = merge(all, field.optional ? orNull(field.shape) : field.shape);
      return all.kind === 'never' ? ANY : orNull(all);
    }
    case 'filter': {
      const element = list();
      typeWhere(step.where, stepScope(base, element ?? ANY), join(at, 'where'), facts);
      return element ? input : ANY;
    }
    case 'sort': {
      const element = list();
      step.by.forEach((by, index) => {
        const shape = operand(by.value, element ?? ANY, 'by', index, 'value');
        expectKinds(facts, shape, by.kind === 'number' ? ['number'] : ['string'], join(join(join(at, 'by'), index), 'value'));
      });
      return element ? input : ANY;
    }
    case 'limit': return list() ? input : ANY;
    case 'map': {
      const names = Object.keys(step.fields).sort();
      if (!names.length || names.length > PIPELINE_LIMITS.mapFields) report(facts, 'limit_exceeded', join(at, 'fields'));
      const many = kindsOf(withoutNull(input)).has('array') || input.kind === 'any';
      const single = !many && hasObject(input);
      if (!many && !single) { report(facts, 'binding_type', join(at, 'op')); return ANY; }
      const item = many ? elementOf(input) : withoutNull(input);
      const fields: Record<string, Shape> = {};
      for (const name of names) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) report(facts, 'invalid_value', join(join(at, 'fields'), name));
        fields[name] = operand(step.fields[name], item, 'fields', name);
      }
      const built = objectOf(fields);
      return many ? { kind: 'array', of: built } : orNull(built);
    }
    case 'group': {
      const element = list();
      const key = operand(step.by, element ?? ANY, 'by');
      expectKinds(facts, key, scalarKinds, join(at, 'by'));
      if (!element) return ANY;
      const keyShape = withoutNull(key);
      return { kind: 'array', of: objectOf({ key: orNull(keyShape.kind === 'string' ? { kind: 'string' } : keyShape), count: INTEGER, items: { kind: 'array', of: element } }) };
    }
    case 'count': return list() ? INTEGER : ANY;
    case 'sum': {
      const element = list();
      expectKinds(facts, operand(step.value, element ?? ANY, 'value'), ['number'], join(at, 'value'));
      return element ? NUMBER : ANY;
    }
    case 'first': { const element = list(); return element ? orNull(element) : ANY; }
    case 'flatten': {
      const element = list();
      if (!element) return ANY;
      const inner = shapeAt(element, step.path);
      if (!inner) { report(facts, 'invalid_reference', join(at, 'path')); return ANY; }
      checkSegments(step.path, join(at, 'path'), facts);
      const items = elementOf(inner);
      if (items === undefined) { report(facts, 'binding_type', join(at, 'path')); return ANY; }
      return { kind: 'array', of: items };
    }
    case 'unique': {
      const element = list();
      expectKinds(facts, operand(step.by, element ?? ANY, 'by'), scalarKinds, join(at, 'by'));
      return element ? input : ANY;
    }
    // `sh.flow-extras@1`. `min` and `max` reduce a list to one number (null when it holds none), as `sum` does; `running-sum` and `annotate` keep the
    // list and write a field onto every object in it.
    case 'min': case 'max': {
      facts.flowExtras = true;
      const element = list();
      expectKinds(facts, operand(step.value, element ?? ANY, 'value'), ['number'], join(at, 'value'));
      return element ? orNull(NUMBER) : ANY;
    }
    case 'running-sum': case 'annotate': {
      facts.flowExtras = true;
      const element = list();
      if (!element) return ANY;
      if (!hasObject(element)) { report(facts, 'binding_type', join(at, 'op')); return ANY; }
      const written: [string, Shape, string][] = [];
      if (step.op === 'running-sum') {
        expectKinds(facts, operand(step.value, element, 'value'), ['number'], join(at, 'value'));
        written.push([step.into, step.nullPropagates ? orNull(NUMBER) : NUMBER, join(at, 'into')]);
      } else {
        const names = Object.keys(step.fields).sort();
        if (!names.length || names.length > PIPELINE_LIMITS.mapFields) report(facts, 'limit_exceeded', join(at, 'fields'));
        for (const name of names) {
          const own = join(join(at, 'fields'), name);
          expectKinds(facts, operand(step.fields[name].value, element, 'fields', name, 'value'), ['number'], join(own, 'value'));
          written.push([name, orNull(NUMBER), own]);
        }
      }
      let updated: Shape | undefined = element;
      for (const [name, shape, where] of written) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) { report(facts, 'invalid_value', where); continue; }
        updated = updated && withField(updated, [name], shape);
      }
      return updated ? { kind: 'array', of: updated } : ANY;
    }
    case 'default': {
      const many = kindsOf(withoutNull(input)).has('array');
      const item = many ? elementOf(input) : withoutNull(input);
      if (!item || !hasObject(item)) { report(facts, 'binding_type', join(at, 'op')); return ANY; }
      checkSegments(step.path, join(at, 'path'), facts);
      const fill = operand(step.value, item, 'value');
      const current = shapeAt(item, step.path);
      const leaf = current === undefined ? fill : merge(withoutNull(current), withoutNull(fill));
      const updated = withField(item, step.path, leaf);
      if (!updated) { report(facts, 'invalid_reference', join(at, 'path')); return ANY; }
      return many ? { kind: 'array', of: updated } : updated;
    }
  }
}
/** The shape after every step, with each step's shape on the way (what the Studio's outline shows at "After Step 3"). */
export function typeSteps(steps: readonly PipelineStep[], input: Shape, params: TypeScope['params'], at: string, facts: TypeFacts): Shape[] {
  const shapes: Shape[] = [];
  let current = input;
  steps.forEach((step, index) => {
    current = typeStep(step, current, params, join(join(at, 'steps'), index), facts);
    shapes.push(current);
  });
  return shapes;
}
