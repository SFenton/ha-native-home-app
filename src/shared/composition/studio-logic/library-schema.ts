import { z } from 'zod/v4';
import { identifierSchema } from '../../validation';
import { parameterName } from '../expression';

/** Entries a library holds. */
export const MAX_LOGIC_ENTRIES = 100;
/** Parameters an entry declares. */
export const MAX_LOGIC_PARAMS = 8;

/** What a parameter takes: an id of a data source, a text, a number, an operand, or a condition. */
export const logicParamKinds = ['source-id', 'text', 'number', 'operand', 'condition'] as const;
export type LogicParamKind = typeof logicParamKinds[number];
const object = z.strictObject;
const label = z.string().min(1).max(80).refine(value => Boolean(value.trim()) && !/[\p{Cc}\p{Cf}]/u.test(value));

/**
 * `sample` is an example argument of the parameter's kind, for an editor's preview; it also stands in for the argument when the library checks the entry's body.
 * `display` is a hint for the editor only (a `number` that the Studio draws as a time of day, or a `text` that holds a person's entity id and is drawn as a person picker); it changes nothing a use or an expansion does.
 */
export const logicParamSchema = object({ name: parameterName, kind: z.enum(logicParamKinds), label: label.optional(), sample: z.json().optional(), display: z.enum(['time', 'person']).optional() });
export const logicEntrySchema = object({
  id: identifierSchema,
  name: label,
  kind: z.enum(['operand', 'condition']),
  params: z.array(logicParamSchema).max(MAX_LOGIC_PARAMS),
  /** An operand or a condition, with holes where the arguments go. */
  body: z.record(z.string(), z.json()),
});
export const logicLibrarySchema = z.array(logicEntrySchema).max(MAX_LOGIC_ENTRIES);
/** A use: stands where an operand or a condition stands, in a draft. */
export const logicRefSchema = object({ type: z.literal('logic-ref'), logicId: identifierSchema, args: z.record(z.string(), z.json()) });
/** A hole: stands for one argument inside an entry's body. */
export const logicHoleSchema = object({ type: z.literal('hole'), name: parameterName });
export type LogicEntry = z.infer<typeof logicEntrySchema>;
export type LogicLibrary = z.infer<typeof logicLibrarySchema>;
export type LogicRef = z.infer<typeof logicRefSchema>;
export type LogicHole = z.infer<typeof logicHoleSchema>;
