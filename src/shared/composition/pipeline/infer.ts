import type { Json } from '../../types';
import { isDateText, isDateTimeText } from './dates';
import { ANY, INTEGER, NEVER, NULL, NUMBER, BOOLEAN, SHAPE_LIMITS, merge, type Shape, type StringFormat, type ShapeField } from './shape';

/**
 * Shape inference: the shape of a sample, and the merge of many. The rules are fixed so the Studio and the app show the same outline:
 *
 * - A whole number is `number` with `integer`; any other number is `number`.
 * - A string is recognized as `date`, `date-time`, `entity-id` (`domain.object`), `url` (`http://` or `https://`) or `numeric` (digits with
 *   an optional sign and fraction), in that order; any other string of at most 64 characters is a candidate for an `enum`.
 * - A list is the merge of its items (an empty list is a list of `never`); an object lists its fields, each required.
 * - Merging keeps an enum only while at most 8 different strings were seen, drops a format two samples disagree on, keeps a field optional
 *   when some sample lacks it, and makes a union of different kinds.
 */

const entityId = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const numeric = /^-?\d{1,18}(?:\.\d{1,18})?$/;
/** The format a string is recognized as, if any. */
export function stringFormat(value: string): StringFormat | undefined {
  if (isDateText(value)) return 'date';
  if (isDateTimeText(value)) return 'date-time';
  if (entityId.test(value) && value.length <= 160) return 'entity-id';
  if (/^https?:\/\/\S+$/.test(value)) return 'url';
  if (numeric.test(value)) return 'numeric';
  return undefined;
}
/** The shape of one value. */
export function inferShape(value: Json, depth = 1): Shape {
  if (value === null) return NULL;
  if (typeof value === 'boolean') return BOOLEAN;
  if (typeof value === 'number') return Number.isInteger(value) ? INTEGER : NUMBER;
  if (typeof value === 'string') {
    const format = stringFormat(value);
    if (format) return { kind: 'string', format };
    return value.length <= SHAPE_LIMITS.enumLength ? { kind: 'string', enum: [value] } : { kind: 'string' };
  }
  if (depth > 32) return ANY;
  if (Array.isArray(value)) return { kind: 'array', of: value.reduce<Shape>((shape, item) => merge(shape, inferShape(item, depth + 1)), NEVER) };
  const fields: Record<string, ShapeField> = {};
  for (const [name, item] of Object.entries(value)) fields[name] = { shape: inferShape(item, depth + 1) };
  return { kind: 'object', fields };
}
/** The shape that fits every sample (`never` for none). */
export const inferShapeFromSamples = (samples: readonly Json[]): Shape => samples.reduce<Shape>((shape, sample) => merge(shape, inferShape(sample)), NEVER);

/**
 * Whether an object shape is a Home Assistant response keyed by entity id (`{ "todo.demo": { items: [...] } }`). The Studio shows
 * "Entries by Entity" for it and offers a Choose Entry step (`select-key`) instead of one group per entity.
 */
export function isEntityKeyed(shape: Shape): boolean {
  if (shape.kind !== 'object') return false;
  const names = Object.keys(shape.fields);
  return names.length > 0 && names.every(name => entityId.test(name));
}
