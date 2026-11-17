import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import { MAX_RULE_CASES, operandBase, predicateBase } from './expression';
import { symbolUnavailable } from './symbol-unavailable';

/**
 * The slot shapes several nodes share, kept apart from `schema.ts` so a node's own module (the vacuum, the surface controls) can use them
 * without importing the whole document schema.
 */
const object = z.strictObject;
const id = identifierSchema;
/** Text of at most `maximum` characters; blank only when `blank`. */
export const text = (maximum: number, blank = false) => z.string().max(maximum).refine(value => blank || Boolean(value.trim()));
/** Short words: a label, at most 80 characters. */
export const label = text(80);
/** An SF Symbol and what to do when the device lacks it. */
export const symbol = object({
  type: z.literal('sf-symbol'), name: text(80),
  rendering: z.literal('canonical'), unavailable: symbolUnavailable,
});
export const read = object({
  type: z.literal('read'),
  from: object({ type: z.literal('source'), sourceId: id, path: z.array(text(160)).min(1).max(8) }),
  as: z.enum(['string', 'number', 'boolean', 'entity-id']),
  missing: z.literal('unavailable'),
});
/**
 * A text slot also takes `expr`: any operand (a format, a rule, a count) whose result is text, a number or a boolean (`sh.rules@1`).
 * Its `read` and `expr` take an optional `fallback`: the text drawn while the value is unavailable; while it is loading the slot keeps what it showed.
 */
export const textValue = (maximum: number, blank: boolean) => z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), value: text(maximum, blank) }),
  read.extend({ fallback: text(maximum, blank).optional() }),
  object({ type: z.literal('expr'), value: operandBase, fallback: text(maximum, blank).optional() }),
]);
/** A slot whose look depends on a condition: the first case that holds, else `otherwise`. Both hold literal looks, so the author's color stays exact (`sh.rules@1`). */
export const conditional = <T extends z.ZodType>(then: T) => object({
  type: z.literal('conditional'), cases: z.array(object({ when: predicateBase, then })).min(1).max(MAX_RULE_CASES), otherwise: then,
});
/** A symbol that may follow a rule or an entity's text: exact, a `conditional` of symbols, or a `bound-symbol` with a required fallback (`sh.rules@1`). */
export const symbolSlot = z.discriminatedUnion('type', [symbol, conditional(symbol), object({ type: z.literal('bound-symbol'), value: operandBase, fallback: symbol })]);
/** Pushing a page. */
export const push = object({
  type: z.literal('push'), pageId: id, arguments: object({}),
  origin: z.literal('sender'), duplicate: z.literal('reuse-nearest'),
});
/** The navigation a node accepts: push, select a tab, present a modal, or dismiss and then push. */
export const navigationAction = z.discriminatedUnion('type', [
  push,
  object({ type: z.literal('select-tab'), tabId: id }),
  object({ type: z.literal('present'), modalId: id, arguments: object({}), ifPresented: z.enum(['reject', 'replace']) }),
  object({ type: z.literal('dismiss-then-push'), destination: push }),
]);
