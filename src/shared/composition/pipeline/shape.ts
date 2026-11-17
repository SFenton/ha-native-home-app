import { z } from 'zod/v4';

/**
 * The shape language of a Data Flow (`sh.pipeline@1`): what a value looks like, without its data. The Studio infers one from a
 * sample, each step has a typing rule from the shape it receives to the shape it gives, and the document carries the authored
 * `responseShape` and `schema` the compiler checks the steps against. Nothing here runs a step; `evaluate.ts` does that.
 *
 * Nullability is a union with `null`; an object field that may be absent is `optional`. A value of kind `never` has been seen
 * nowhere (an empty list's items) and merges into anything; `any` is a value nothing is known about and absorbs everything.
 */

// MARK: Types

/** The text patterns the Studio recognizes and offers steps for. */
export const stringFormats = ['date', 'date-time', 'entity-id', 'url', 'numeric'] as const;
export type StringFormat = typeof stringFormats[number];

/** Limits shared by inference, the schema and the compiler. */
export const SHAPE_LIMITS = { depth: 6, fields: 64, enumValues: 8, enumLength: 64, unionMembers: 6, fieldName: 160 } as const;

export type Shape =
  | { kind: 'never' }
  | { kind: 'any' }
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'number'; integer?: true }
  | { kind: 'string'; format?: StringFormat; enum?: string[] }
  | { kind: 'array'; of: Shape }
  | { kind: 'object'; fields: Record<string, ShapeField> }
  | { kind: 'union'; of: Shape[] };
/** One field of an object shape. A field that is not `optional` is present in every value. */
export type ShapeField = { shape: Shape; optional?: true };
/** A shape that is not a union and not `never`. */
export type Member = Exclude<Shape, { kind: 'union' | 'never' }>;

export const NEVER: Shape = { kind: 'never' };
export const ANY: Shape = { kind: 'any' };
export const NULL: Shape = { kind: 'null' };
export const BOOLEAN: Shape = { kind: 'boolean' };
export const NUMBER: Shape = { kind: 'number' };
export const INTEGER: Shape = { kind: 'number', integer: true };
export const STRING: Shape = { kind: 'string' };
export const text = (format?: StringFormat): Shape => format ? { kind: 'string', format } : { kind: 'string' };
export const arrayOf = (of: Shape): Shape => ({ kind: 'array', of });
/** An object whose fields are all required, unless named in `optional`. */
export function objectOf(fields: Record<string, Shape>, optional: readonly string[] = []): Shape {
  return { kind: 'object', fields: Object.fromEntries(Object.entries(fields).map(([name, shape]) => [name, optional.includes(name) ? { shape, optional: true as const } : { shape }])) };
}

// MARK: Structure (Zod)

const fieldName = z.string().min(1).max(SHAPE_LIMITS.fieldName).regex(/^[A-Za-z0-9_.-]+$/).refine(name => !['__proto__', 'prototype', 'constructor'].includes(name));
const object = z.strictObject;
export const shapeSchema: z.ZodType<Shape> = z.lazy(() => z.discriminatedUnion('kind', [
  object({ kind: z.literal('never') }),
  object({ kind: z.literal('any') }),
  object({ kind: z.literal('null') }),
  object({ kind: z.literal('boolean') }),
  object({ kind: z.literal('number'), integer: z.literal(true).optional() }),
  object({
    kind: z.literal('string'), format: z.enum(stringFormats).optional(),
    enum: z.array(z.string().max(SHAPE_LIMITS.enumLength)).min(1).max(SHAPE_LIMITS.enumValues).optional(),
  }),
  object({ kind: z.literal('array'), of: shapeSchema }),
  object({ kind: z.literal('object'), fields: z.record(fieldName, object({ shape: shapeSchema, optional: z.literal(true).optional() })) }),
  object({ kind: z.literal('union'), of: z.array(shapeSchema).min(2).max(SHAPE_LIMITS.unionMembers) }),
]));

/** The first problem in a shape's size or form that the Zod structure cannot say, as a pointer suffix and code; undefined when sound. */
export function shapeProblem(shape: Shape, pointer = '', depth = 1): { code: 'limit_exceeded' | 'invalid_value'; pointer: string } | undefined {
  if (depth > SHAPE_LIMITS.depth) return { code: 'limit_exceeded', pointer };
  switch (shape.kind) {
    case 'array': return shapeProblem(shape.of, `${pointer}/of`, depth + 1);
    case 'object': {
      const names = Object.keys(shape.fields).sort();
      if (names.length > SHAPE_LIMITS.fields) return { code: 'limit_exceeded', pointer: `${pointer}/fields` };
      for (const name of names) {
        const found = shapeProblem(shape.fields[name].shape, `${pointer}/fields/${name}/shape`, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    case 'union': {
      const seen = new Set<string>();
      for (const [index, member] of shape.of.entries()) {
        if (member.kind === 'union' || member.kind === 'never' || seen.has(member.kind)) return { code: 'invalid_value', pointer: `${pointer}/of/${index}` };
        seen.add(member.kind);
        const found = shapeProblem(member, `${pointer}/of/${index}`, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    case 'string':
      if (shape.enum && (shape.format || new Set(shape.enum).size !== shape.enum.length)) return { code: 'invalid_value', pointer: `${pointer}/enum` };
      return undefined;
    default: return undefined;
  }
}

// MARK: Members and unions

const order: Member['kind'][] = ['null', 'boolean', 'number', 'string', 'array', 'object', 'any'];
/** The members of a shape: a union's, or the shape itself; `never` has none. */
export function members(shape: Shape): Member[] {
  if (shape.kind === 'never') return [];
  if (shape.kind === 'union') return shape.of as Member[];
  return [shape];
}
/** The one member of `kind` in a shape, if any. */
export const memberOf = <K extends Member['kind']>(shape: Shape, kind: K): Extract<Member, { kind: K }> | undefined =>
  members(shape).find((member): member is Extract<Member, { kind: K }> => member.kind === kind);
/** The kinds a shape can take; `any` is every kind. */
export function kindsOf(shape: Shape): Set<Member['kind']> {
  const found = new Set(members(shape).map(member => member.kind));
  return found.has('any') ? new Set(order) : found;
}
/** A shape without its `null` member. */
export function withoutNull(shape: Shape): Shape {
  return shape.kind === 'union' ? combine(shape.of.filter(member => member.kind !== 'null')) : shape.kind === 'null' ? NEVER : shape;
}
/** A shape that may also be `null`. */
export const orNull = (shape: Shape): Shape => merge(shape, NULL);
function combine(list: Shape[]): Shape {
  let result: Shape = NEVER;
  for (const item of list) result = merge(result, item);
  return result;
}

// MARK: Merge

/**
 * The shape that fits both. Same-kind members merge (an object keeps every field, a field missing from one side becomes optional;
 * a string keeps its enum only while both sides have one and it stays within eight values; two different formats drop the format);
 * different kinds make a union, in the closed order null, boolean, number, string, array, object. `any` absorbs, `never` is the identity.
 */
export function merge(a: Shape, b: Shape): Shape {
  if (a.kind === 'never') return b;
  if (b.kind === 'never') return a;
  if (a.kind === 'any' || b.kind === 'any') return ANY;
  const slots = new Map<Member['kind'], Member>();
  for (const member of [...members(a), ...members(b)]) {
    const held = slots.get(member.kind);
    slots.set(member.kind, held ? mergeMember(held, member) : member);
  }
  const list = [...slots.values()].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
  return list.length === 1 ? list[0] : { kind: 'union', of: list };
}
function mergeMember(a: Member, b: Member): Member {
  switch (a.kind) {
    case 'number': return a.integer && (b as typeof a).integer ? a : { kind: 'number' };
    case 'string': {
      const other = b as typeof a;
      const format = a.format && a.format === other.format ? a.format : undefined;
      let values: string[] | undefined;
      if (a.enum && other.enum && !format) {
        const all = [...new Set([...a.enum, ...other.enum])].sort(compareScalars);
        if (all.length <= SHAPE_LIMITS.enumValues) values = all;
      }
      return { kind: 'string', ...(format ? { format } : {}), ...(values ? { enum: values } : {}) };
    }
    case 'array': return { kind: 'array', of: merge(a.of, (b as typeof a).of) };
    case 'object': {
      const other = b as typeof a, fields: Record<string, ShapeField> = {};
      for (const name of [...new Set([...Object.keys(a.fields), ...Object.keys(other.fields)])].sort(compareScalars)) {
        const left = a.fields[name], right = other.fields[name];
        if (left && right) fields[name] = { shape: merge(left.shape, right.shape), ...(left.optional || right.optional ? { optional: true as const } : {}) };
        else fields[name] = { shape: (left ?? right).shape, optional: true };
      }
      return { kind: 'object', fields };
    }
    default: return a;
  }
}
/** Orders names the way the app does: by Unicode scalar value, so shapes print the same everywhere. */
function compareScalars(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let index = 0; index < Math.min(x.length, y.length); index++) {
    const difference = x[index].codePointAt(0)! - y[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return x.length - y.length;
}

// MARK: Fit

/**
 * Whether every value of `value` is a value of `target`. A target field the value lacks must be optional; extra fields on the value
 * are fine; `any` fits only `any`; a string with an enum fits a string with the same or a wider enum; an integer fits a number.
 */
export function isAssignable(value: Shape, target: Shape): boolean {
  if (target.kind === 'any' || value.kind === 'never') return true;
  if (value.kind === 'any') return false;
  if (value.kind === 'union') return value.of.every(member => isAssignable(member, target));
  if (target.kind === 'never') return false;
  if (target.kind === 'union') return target.of.some(member => isAssignable(value, member));
  if (value.kind !== target.kind) return false;
  switch (value.kind) {
    case 'number': return !(target as typeof value).integer || Boolean(value.integer);
    case 'string': {
      const other = target as typeof value;
      if (other.format && value.format !== other.format) return false;
      return !other.enum || Boolean(value.enum && value.enum.every(item => other.enum!.includes(item)));
    }
    case 'array': return isAssignable(value.of, (target as typeof value).of);
    case 'object': {
      const other = target as typeof value;
      return Object.entries(other.fields).every(([name, field]) => {
        const have = value.fields[name];
        return have ? (!have.optional || Boolean(field.optional)) && isAssignable(have.shape, field.shape) : Boolean(field.optional);
      });
    }
    default: return true;
  }
}

// MARK: Reading a shape

/** The shape of the field `name` of an object, or of the fields of every object in a union; `null` and `any` members pass through. */
export function fieldOf(shape: Shape, name: string): Shape | undefined {
  let result: Shape | undefined;
  for (const member of members(shape)) {
    if (member.kind === 'any') return ANY;
    if (member.kind === 'null') { result = merge(result ?? NEVER, NULL); continue; }
    if (member.kind !== 'object') continue;
    const field = Object.hasOwn(member.fields, name) ? member.fields[name] : undefined;
    if (!field) { result = merge(result ?? NEVER, NULL); continue; }
    result = merge(result ?? NEVER, field.optional ? orNull(field.shape) : field.shape);
  }
  // Only an object that has the field makes it reachable; a union of objects that all lack it is an unknown field.
  return members(shape).some(member => member.kind === 'any' || (member.kind === 'object' && Object.hasOwn(member.fields, name))) ? result : undefined;
}
/** The shape at `path`, or undefined when a segment names no field. An empty path is the shape itself. */
export function shapeAt(shape: Shape, path: readonly string[]): Shape | undefined {
  let current: Shape | undefined = shape;
  for (const segment of path) {
    if (current === undefined) return undefined;
    current = fieldOf(current, segment);
  }
  return current;
}
/** The item shape of a list (`any` for an unknown list); `null` members count as an empty list. Undefined when the shape is not a list. */
export function elementOf(shape: Shape): Shape | undefined {
  let result: Shape | undefined;
  for (const member of members(shape)) {
    if (member.kind === 'any') return ANY;
    if (member.kind === 'array') result = merge(result ?? NEVER, member.of);
  }
  return result;
}
/** Whether the shape has an object member (or is `any`). */
export const hasObject = (shape: Shape): boolean => kindsOf(shape).has('object');
/** A copy of an object shape with the field at `path` set to `leaf` (required). The parents must be objects; undefined when they are not. */
export function withField(shape: Shape, path: readonly string[], leaf: Shape): Shape | undefined {
  const [head, ...rest] = path;
  const slots = members(shape);
  if (!slots.some(member => member.kind === 'object')) return shape.kind === 'any' ? ANY : undefined;
  let result: Shape = NEVER;
  for (const member of slots) {
    if (member.kind !== 'object') { result = merge(result, member); continue; }
    const field = member.fields[head];
    const next = rest.length ? (field ? withField(field.shape, rest, leaf) : undefined) : leaf;
    if (next === undefined) return undefined;
    result = merge(result, { kind: 'object', fields: { ...member.fields, [head]: { shape: next } } });
  }
  return result;
}
/** Whether the shape is made only of scalar kinds (and `null`), so it can be compared, sorted or printed. */
export const isScalar = (shape: Shape): boolean => members(shape).every(member => member.kind === 'any' || ['null', 'boolean', 'number', 'string'].includes(member.kind));
