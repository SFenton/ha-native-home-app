import { z } from 'zod/v4';
import type { Json } from './types';

export const nativeTodoItemSchema = z.object({
  uid: z.string().min(1).max(512),
  summary: z.string().max(2000),
  status: z.enum(['needs_action', 'completed']),
  description: z.string().max(16384).optional(),
  due: z.string().max(80).refine(value =>
    /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(value)
    && z.iso.date().safeParse(value.slice(0, 10)).success && Number.isFinite(Date.parse(value)), 'Invalid todo due date').optional(),
}).strict();
export const nativeTodoReadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), items: z.array(nativeTodoItemSchema).max(1000) }).strict(),
  z.object({ status: z.enum(['error', 'unavailable']), message: z.string().max(240) }).strict(),
]);

export const choreRecord = (value: Json | undefined): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const choreRecords = (value: Json | undefined) => Array.isArray(value) ? value.map(choreRecord) : [];
