import { z } from 'zod/v4';
import type { Json } from './types';

/**
 * The value rules every Studio contract shares: identifiers, Home Assistant entity ids, bounded JSON and the
 * prototype-pollution guard. The composition schema and the server's Home Assistant reads build on these.
 */
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, 'Use 1-80 letters, numbers, dots, underscores or hyphens')
  .refine((value) => !unsafeKeys.has(value), 'Reserved key');
export const entityIdSchema = z.string().max(160).regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/, 'Expected an entity ID such as light.demo_living_room');
const primitive = z.union([z.string().max(16384), z.number().finite(), z.boolean(), z.null()]);
const safeKey = z.string().max(160).refine((value) => !unsafeKeys.has(value), 'Reserved key');
export const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  primitive,
  z.array(jsonSchema).max(1000),
  z.record(safeKey, jsonSchema).refine((value) => Object.keys(value).length <= 100, 'At most 100 object keys'),
]));

export class DocumentValidationError extends Error {
  constructor(public readonly errors: string[]) { super('Document validation failed'); }
}

export function assertJsonBounds(input: unknown): void {
  // Bound recursion before Zod follows lazy schemas, including direct SDK callers.
  const pending: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const { value, depth, exit } = pending.pop()!;
    if (exit && typeof value === 'object' && value !== null) { ancestors.delete(value); continue; }
    if (++nodes > 30000 || depth > 40) throw new DocumentValidationError(['document: exceeds the size or nesting limit']);
    if (typeof value === 'object' && value !== null) {
      if (ancestors.has(value)) throw new DocumentValidationError(['document: cyclic object references are not JSON']);
      ancestors.add(value);
      pending.push({ value, depth, exit: true });
      if (Object.keys(value).length > 1000) throw new DocumentValidationError(['document: too many object entries']);
      for (const [key, nested] of Object.entries(value)) {
        if (unsafeKeys.has(key)) throw new DocumentValidationError([`document: reserved object key "${key}"`]);
        pending.push({ value: nested, depth: depth + 1 });
      }
    }
  }
}
