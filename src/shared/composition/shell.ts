import { z } from 'zod/v4';
import { identifierSchema as id } from '../schema';

const object = z.strictObject;
const text = (max: number, blank = false) => z.string().max(max).refine(value => blank || Boolean(value.trim()));
const number = z.number().min(-1_000_000).max(1_000_000);

/** Scene values only. These are not HA state, domain commands, persisted settings, or credentials. */
export const localFieldSchema = z.discriminatedUnion('type', [
  object({ id, type: z.literal('string'), initial: text(16384, true), maxLength: z.number().int().min(1).max(16384) }),
  object({ id, type: z.literal('boolean'), initial: z.boolean() }),
  object({ id, type: z.literal('number'), initial: number, minimum: number, maximum: number, step: z.number().min(0.000001).max(1000000) }),
  object({ id, type: z.literal('choice'), initial: id, options: z.array(object({ id, label: text(80) })).min(2).max(12) }),
]);
export const localValueSchema = z.discriminatedUnion('type', [
  object({ type: z.literal('string'), value: text(16384, true) }),
  object({ type: z.literal('boolean'), value: z.boolean() }),
  object({ type: z.literal('number'), value: number }),
]);
export type LocalField = z.infer<typeof localFieldSchema>;
export type LocalValue = z.infer<typeof localValueSchema>;

export function acceptsLocalValue(field: LocalField, value: LocalValue): boolean {
  switch (field.type) {
    case 'string': return value.type === 'string' && value.value.length <= field.maxLength;
    case 'boolean': return value.type === 'boolean';
    case 'choice': return value.type === 'string' && field.options.some(option => option.id === value.value);
    case 'number': {
      if (value.type !== 'number' || !Number.isFinite(value.value) || field.minimum > field.maximum || field.step <= 0 ||
          value.value < field.minimum || value.value > field.maximum) return false;
      const steps = (value.value - field.minimum) / field.step;
      return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) <= 0.000001;
    }
  }
}
export function initialLocalValue(field: LocalField): LocalValue {
  switch (field.type) {
    case 'string': case 'choice': return { type: 'string', value: field.initial };
    case 'boolean': return { type: 'boolean', value: field.initial };
    case 'number': return { type: 'number', value: field.initial };
  }
}
