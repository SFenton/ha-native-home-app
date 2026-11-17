import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import { callServiceSchema, operandBase, predicateSchema, type Operand } from './expression';
import { conditional, text, textValue } from './slots';
import { DIAL_CONTROL_MAX_STEPS, DIAL_CONTROL_MAX_TICKS } from './dial-control-math';

/**
 * A dial control (`sh.dial-control@1`): the thermostat's ring made a control anyone can author. One or two stoppers sit on a ring of fixed shape (270 degrees from
 * 135 degrees), each writing a value; a rule between two says whether they may pass each other and how far they stay apart; each may have a lowest and a highest.
 * What a release sends is one call for the dial, or one call per stopper. Its arithmetic is `dial-control-math.ts`; the thermostat's own kind
 * (`climate-control` kind `dial`) is unchanged and not an alias of this.
 *
 * The schema lives here, apart from `schema.ts`, and takes the ink schema from it, so that module can use it without a cycle.
 */
const object = z.strictObject;
const id = identifierSchema;
const integer = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);

/** The word a stopper's id may not be: it names the reading in `center.value.shows`. */
export const READING_ID = 'reading';
/** The one token the texts of a stopper and of a failure may hold. */
export const VALUE_TOKEN = 'value';

/** A fixed ink, or one chosen by rule (`sh.rules@1`: the first case that holds, else `otherwise`). */
const ruled = <T extends z.ZodType>(ink: T) => z.union([ink, conditional(ink)]);

/** Builds the props schema of the node over the document's ink schema. */
export function dialControlPropsSchema<Ink extends z.ZodType>(ink: Ink) {
  const ruledInk = ruled(ink);
  const stopper = object({
    id,
    /** A number; missing or unreadable, the stopper is not drawn. */
    value: operandBase,
    /** What VoiceOver says for the handle: "Hall heat to". */
    label: textValue(240, false),
    /** The spoken value; `{value}` is the number. Absent, VoiceOver says the number and the unit. */
    spokenValue: text(240).optional(),
    ink: ruledInk,
    trail: z.enum(['none', 'from-start', 'to-end']).optional(), trailInk: ruledInk.optional(),
    limit: object({ min: operandBase.optional(), max: operandBase.optional() }).optional(),
    /** The per-stopper form: only this stopper's call is sent; inside it a bare `control` is this stopper's value. */
    action: callServiceSchema.optional(),
  });
  return object({
    range: object({ min: z.number(), max: z.number(), step: z.number().min(0.01) }),
    size: z.enum(['page', 'modal', 'compact']),
    stoppers: z.array(stopper).min(1).max(2),
    between: object({ rule: z.enum(['free', 'stop']), gap: operandBase.optional() }).optional(),
    reading: object({ value: operandBase, ink: ruledInk }).optional(),
    bands: z.array(object({ from: z.number(), to: z.number(), ink })).max(4).optional(),
    ticks: object({ every: z.number().positive() }).optional(),
    center: object({
      top: textValue(240, true).optional(),
      value: object({ shows: z.union([z.literal(READING_ID), id]), fractionDigits: integer(0, 2), unit: text(8, true) }),
      caption: z.union([z.literal('stoppers'), textValue(240, true)]).optional(),
    }),
    dimmedWhen: predicateSchema.optional(),
    unavailableText: text(240), failureText: text(240),
    /** Whether a right-to-left layout flips the ring. Absent: it does not, as the thermostat does not. */
    mirrors: z.boolean().optional(),
  });
}
/** A structural problem and where it is, relative to the node (`/props/range/max`). */
export interface DialControlProblem { code: 'invalid_value' | 'limit_exceeded' | 'duplicate_id' | 'missing_required' | 'invalid_combination' | 'invalid_reference'; at: string }

const literalNumber = (operand: Operand | undefined): number | undefined =>
  operand?.type === 'literal' && typeof operand.value === 'number' ? operand.value : undefined;
/** The tokens of a text in braces other than `{value}`, or a brace that does not close: the rule a stopper's spoken value and the failure text follow. */
export function tokenProblem(value: string): 'invalid_reference' | 'invalid_value' | undefined {
  let rest = value;
  for (let open = rest.indexOf('{'); open >= 0; open = rest.indexOf('{')) {
    const close = rest.indexOf('}', open);
    if (close < 0) return 'invalid_value';
    if (rest.slice(open + 1, close) !== VALUE_TOKEN) return 'invalid_reference';
    rest = rest.slice(close + 1);
  }
  return rest.includes('}') ? 'invalid_value' : undefined;
}

/**
 * The rules of a dial control that need no walk of operands. The range is a range and holds at most {@link DIAL_CONTROL_MAX_STEPS} steps; stopper ids are unique
 * and are not `reading`; two stoppers have a `between` and one has none; a gap is only for `stop`, and a literal one is 0 or more and under the range; the call is
 * one for the dial or one on each stopper, never a mix and never none; a limit says a side and a literal pair is in order; the dots are at most
 * {@link DIAL_CONTROL_MAX_TICKS}; a band is a stretch of the range; the middle shows the reading (if there is one) or a stopper of the node; and the tokens are
 * `{value}`. The ring's sweep is not authored, so there is nothing to refuse.
 */
export function dialControlProblems(shape: { props: unknown; action?: unknown }, spoken: { at: string; text: string }[] = []): DialControlProblem[] {
  const out: DialControlProblem[] = [];
  const add = (code: DialControlProblem['code'], at: string) => out.push({ code, at });
  const props = shape.props as {
    range: { min: number; max: number; step: number };
    stoppers: { id: string; action?: unknown; limit?: { min?: Operand; max?: Operand } }[];
    between?: { rule: 'free' | 'stop'; gap?: Operand };
    reading?: unknown; bands?: { from: number; to: number }[]; ticks?: { every: number }; center: { value: { shows: string } };
  };
  const { min, max, step } = props.range, span = max - min;
  if (max <= min) add('invalid_value', '/props/range/max');
  else if (span / step > DIAL_CONTROL_MAX_STEPS + 1e-9) add('limit_exceeded', '/props/range/step');
  const seen = new Set<string>();
  props.stoppers.forEach((stopper, index) => {
    if (stopper.id === READING_ID) add('invalid_value', `/props/stoppers/${index}/id`);
    if (seen.has(stopper.id)) add('duplicate_id', `/props/stoppers/${index}/id`);
    seen.add(stopper.id);
    const limit = stopper.limit;
    if (limit && limit.min === undefined && limit.max === undefined) add('invalid_value', `/props/stoppers/${index}/limit`);
    const lowest = literalNumber(limit?.min), highest = literalNumber(limit?.max);
    if (lowest !== undefined && highest !== undefined && lowest >= highest) add('invalid_value', `/props/stoppers/${index}/limit/max`);
  });
  const two = props.stoppers.length === 2;
  if (two && !props.between) add('missing_required', '/props/between');
  if (!two && props.between) add('invalid_combination', '/props/between');
  if (props.between?.gap !== undefined) {
    if (props.between.rule !== 'stop') add('invalid_combination', '/props/between/gap');
    const gap = literalNumber(props.between.gap);
    if (gap !== undefined && (gap < 0 || gap >= span)) add('invalid_value', '/props/between/gap');
  }
  // Exactly one call form: the dial's own `action`, or an `action` on every stopper.
  const own = shape.action !== undefined;
  const given = props.stoppers.filter(stopper => stopper.action !== undefined).length;
  if (own) props.stoppers.forEach((stopper, index) => { if (stopper.action !== undefined) add('invalid_combination', `/props/stoppers/${index}/action`); });
  else if (given === 0) add('missing_required', '/action');
  else props.stoppers.forEach((stopper, index) => { if (stopper.action === undefined) add('missing_required', `/props/stoppers/${index}/action`); });
  if (props.ticks && Math.floor(span / props.ticks.every + 1e-9) + 1 > DIAL_CONTROL_MAX_TICKS) add('limit_exceeded', '/props/ticks/every');
  props.bands?.forEach((band, index) => {
    if (band.from >= band.to) add('invalid_value', `/props/bands/${index}/to`);
    if (band.from < min) add('invalid_value', `/props/bands/${index}/from`);
    if (band.to > max) add('invalid_value', `/props/bands/${index}/to`);
  });
  const shows = props.center.value.shows;
  if (shows === READING_ID) { if (!props.reading) add('invalid_combination', '/props/center/value/shows'); }
  else if (!seen.has(shows)) add('invalid_reference', '/props/center/value/shows');
  for (const entry of spoken) { const problem = tokenProblem(entry.text); if (problem) add(problem, entry.at); }
  return out;
}
