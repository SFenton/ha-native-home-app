import { z } from 'zod/v4';
import { callServiceSchema, operandBase } from './expression';
import { text } from './slots';

/**
 * `sh.tile-swipe@1`: swipe to adjust a tile. An optional `props.swipe` on `light-group-tile` and `state-tile` only. Absent means no recogniser, no
 * adjustable trait and no hint: off, and byte-identical to a tile that has no concept of it. The tile tracks the finger absolutely (the band's edge is
 * where the finger is), sends one call when the finger lifts, and the bubble always names the value the release will send (`build/design/tile-swipe.md`).
 */
const object = z.strictObject;

/** The most steps a range may hold: 100 steps is 1.5 points of travel a step on the narrowest tile (150 points). */
export const MAX_SWIPE_STEPS = 100;
/** The most detents (haptic ticks and VoiceOver steps) a range may hold: 6 points between ticks on the narrowest tile. */
export const MAX_SWIPE_DETENTS = 25;

export const swipeSchema = object({
  /** A closed list of one: a vertical drag belongs to the scroll. */
  axis: z.literal('horizontal'),
  /** Finite numbers with `min` below `max`; decimals are allowed (a setpoint steps by 0.5). */
  range: object({ min: z.number(), max: z.number(), step: z.number() }),
  /** The number the tile shows now. Required on a `state-tile`, refused on a `light-group-tile` (its source owns the value). */
  value: operandBase.optional(),
  /** The call a release sends; `control` carries the committed number. Required on a `state-tile`, refused on a `light-group-tile`. */
  action: callServiceSchema.optional(),
  /** A closed list of one: one call when the finger lifts. A throttled live mode would be `@2`. */
  commit: z.literal('release'),
  /** The haptic spacing and the VoiceOver step: a multiple of `step`, at most 25 across the range. Default a tenth of the range. */
  detent: z.number().optional(),
  haptic: z.enum(['detent', 'none']).optional(),
  /** Whether the tile draws its band, at rest and in a drag. Default true. The bubble is always drawn. */
  band: z.boolean().optional(),
  /** The bubble and the spoken value: `{value}` stands for the number ("{value}%"). Refused on a `light-group-tile`, whose words are its own. */
  format: text(80).optional(),
  /** What is adjusted, for VoiceOver ("Swipe up or down to adjust position."). Required on a `state-tile`; a light group tile is fixed to "brightness". */
  label: text(40).optional(),
});
export type TileSwipe = z.infer<typeof swipeSchema>;

/** The tiles that take a swipe. */
export type SwipeTile = 'light-group-tile' | 'state-tile';

const EPS = 1e-9;
/** How many whole steps the range holds, tolerating the float noise of decimals (0.5 over 60 to 85 is 50). */
export const swipeSteps = (range: TileSwipe['range']) => Math.round((range.max - range.min) / range.step * 1e6) / 1e6;
/** Whether `value` is a multiple of `step`, tolerating float noise. */
export const isMultipleOf = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < EPS * 1e3;
/** The default detent: a tenth of the span, rounded up to a multiple of `step`. */
export function defaultDetent(range: TileSwipe['range']): number {
  const raw = (range.max - range.min) / 10;
  return Math.ceil(raw / range.step - EPS) * range.step;
}
/** The detent in force: the authored one, else the default. */
export const detentOf = (swipe: Pick<TileSwipe, 'range' | 'detent'>) => swipe.detent ?? defaultDetent(swipe.range);

/** The first problem a bubble format has, or undefined: it must hold `{value}` and no other token. */
export function formatProblem(format: string): boolean {
  const tokens = format.match(/\{[^}]*\}/g) ?? [];
  return tokens.length === 0 || tokens.some(token => token !== '{value}') || /[{}]/.test(format.replace(/\{value\}/g, ''));
}

/** One problem the shape of a swipe has that the schema cannot say, as a code at a pointer below `props/swipe`. */
export interface SwipeProblem { code: 'invalid_value' | 'limit_exceeded' | 'invalid_combination' | 'missing_required'; at: string }

/**
 * The checks of the range, the detent and the fields that belong to one tile type only. The checks that need the call or the value operand (the call
 * uses `control`, asks nothing first, the value is a number) are the compiler's, which walks those.
 */
export function swipeProblems(swipe: TileSwipe, tile: SwipeTile): SwipeProblem[] {
  const found: SwipeProblem[] = [];
  const { min, max, step } = swipe.range;
  if (!(min < max)) found.push({ code: 'invalid_value', at: '/range/max' });
  else if (!(step > 0)) found.push({ code: 'invalid_value', at: '/range/step' });
  else {
    if (swipeSteps(swipe.range) > MAX_SWIPE_STEPS) found.push({ code: 'limit_exceeded', at: '/range/step' });
    if (swipe.detent !== undefined) {
      const span = max - min;
      if (!(swipe.detent > 0) || swipe.detent > span + EPS || !isMultipleOf(swipe.detent, step)) found.push({ code: 'invalid_value', at: '/detent' });
      else if (span / swipe.detent > MAX_SWIPE_DETENTS + 1e-6) found.push({ code: 'limit_exceeded', at: '/detent' });
    }
  }
  if (swipe.format !== undefined && formatProblem(swipe.format)) found.push({ code: 'invalid_value', at: '/format' });
  if (tile === 'light-group-tile') {
    for (const key of ['value', 'action', 'format', 'label'] as const) if (swipe[key] !== undefined) found.push({ code: 'invalid_combination', at: `/${key}` });
    // The light source owns the call, and it takes whole percentages of one light: the range is the light's own.
    if (min !== 0 || max !== 100 || step !== 1) found.push({ code: 'invalid_value', at: '/range' });
  } else {
    for (const key of ['value', 'action', 'label'] as const) if (swipe[key] === undefined) found.push({ code: 'missing_required', at: `/${key}` });
  }
  return found;
}
