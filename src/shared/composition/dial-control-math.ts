/**
 * The arithmetic of a dial control (`sh.dial-control@1`): one or two stoppers on a ring, each writing a value, with a rule between them. It is the thermostat
 * dial's own clamp (`ThermostatTargets.setting`: the low handle at or below the high one) made generic, and the shared evaluation corpus
 * (`contract/corpus/evaluation/dialctl-*.json`) pins it, so the app's dial must give the same numbers. Nothing here draws.
 *
 * - **The ring is fixed**: 270 degrees from 135 degrees (lower left, clockwise on screen, 3 o'clock is 0), open at the bottom. A value is placed by its share
 *   of `min` to `max`.
 * - **Values live on a grid**: `min`, `min + step`, `min + 2 step` and so on, up to the last one at or below `max`. A move snaps to the nearest grid value; a half
 *   goes up. Answers are rounded to nine decimals so `0.1 + 0.2` is `0.3`.
 * - **A stopper that is missing a value is not drawn** and takes no part: no stop of its own, and the other stopper is not held against it. With none drawn
 *   the dial is `unavailable`.
 * - **`between`.** `free`: two independent values. `stop`: the first stopper is the lower; it may not pass the second, and each stays `gap` short of the other
 *   (`gap` absent is 0, the thermostat's rule). A stopper's own `limit` (`min`, `max`) holds it too. The tightest of all the bounds, and the ring's ends, wins.
 * - **Always away, never forced.** Two values closer than the gap, or a value past its limit, are drawn as reported and nothing is sent. A stopper in that state
 *   may stay where it is or move away from what holds it (toward the allowed side), never further in: a bound that the value already passes is moved out to the
 *   value. The ring's own ends are absolute.
 * - **A gap or limit that cannot be read** (an authored read that gives no number, a gap below 0) makes the whole dial `read-only`: no stopper moves.
 * - **A stop mark** is drawn while a stopper is dragged, at the bound that holds it, only when that bound is a gap above 0 or a limit short of the ring's end.
 *   The thermostat's own stop (gap 0, no limits) has none.
 * - **No push**: a stopper never moves another.
 */

/** The ring's range: values from `min` to `max` on a grid of `step`. */
export interface DialControlRange { min: number; max: number; step: number }
/**
 * One stopper as the dial reads it now. `value` is `null` when it cannot be read (not drawn). A `limit` side is `undefined` when not authored, a number when it
 * reads, and `null` when it is authored and cannot be read.
 */
export interface DialControlStopper { id: string; value: number | null; limit?: { min?: number | null; max?: number | null } }
/** The rule between two stoppers. `gap` is `undefined` when not authored (0), a number when it reads and `null` when it is authored and cannot be read. */
export interface DialControlBetween { rule: 'free' | 'stop'; gap?: number | null }
/** What the dial arithmetic needs: the range, the stoppers in authored order (one or two) and the rule between two. */
export interface DialControlInput { range: DialControlRange; stoppers: DialControlStopper[]; between?: DialControlBetween }
/** Whether the dial can be used: `unavailable` (no stopper has a value), `read-only` (a gap or a limit cannot be read) or `editable`. */
export type DialControlState = 'unavailable' | 'read-only' | 'editable';
/** The most steps a range may hold, and the most tick dots a ring may draw. */
export const DIAL_CONTROL_MAX_STEPS = 2000;
export const DIAL_CONTROL_MAX_TICKS = 60;
/** The ring: 270 degrees from 135 degrees, the thermostat's. */
export const DIAL_CONTROL_SWEEP = { start: 135, length: 270 } as const;

/** A number cleaned of binary noise: nine decimals, and never `-0`. */
const clean = (value: number): number => Math.round(value * 1e9) / 1e9 + 0;
/** A small allowance so a ratio that is a whole number in decimals (0.3 / 0.1) counts as one. */
const EPSILON = 1e-9;
const isNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

/** The index of the last grid value: `floor((max - min) / step)`. */
export const lastStepIndex = (range: DialControlRange): number => Math.floor((range.max - range.min) / range.step + EPSILON);
/** The grid value at an index. */
export const valueAtStep = (range: DialControlRange, index: number): number => clean(range.min + index * range.step);

/** How a value is brought onto the grid: to the nearest value (a half goes up), the one at or below it, or the one at or above it. */
export type SnapMode = 'nearest' | 'down' | 'up';
/** A value on the grid, held inside the ring. */
export function snapToStep(range: DialControlRange, value: number, mode: SnapMode = 'nearest'): number {
  const position = (Math.min(range.max, Math.max(range.min, value)) - range.min) / range.step;
  const index = mode === 'nearest' ? Math.round(position + EPSILON) : mode === 'down' ? Math.floor(position + EPSILON) : Math.ceil(position - EPSILON);
  return valueAtStep(range, Math.min(lastStepIndex(range), Math.max(0, index)));
}

/** Where a value stands along the ring, 0 to 1, held at the ends. */
export function ringShare(range: DialControlRange, value: number): number {
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
}
/** The angle of a value on the ring in degrees (clockwise from 3 o'clock); `mirrored` flips it about the vertical axis for a right-to-left layout that asks for it. */
export function ringAngle(range: DialControlRange, value: number, mirrored = false): number {
  const angle = DIAL_CONTROL_SWEEP.start + ringShare(range, value) * DIAL_CONTROL_SWEEP.length;
  return clean(mirrored ? 180 - angle : angle);
}

/** The values the tick dots stand at: `min`, then every `every` up to `max`. At most {@link DIAL_CONTROL_MAX_TICKS}, which the compiler holds. */
export function tickValues(range: DialControlRange, every: number): number[] {
  const count = Math.floor((range.max - range.min) / every + EPSILON) + 1;
  return Array.from({ length: count }, (_, index) => clean(range.min + index * every));
}

/** The stoppers that are drawn: those that have a value. */
export const drawnStoppers = (input: DialControlInput): DialControlStopper[] => input.stoppers.filter(stopper => isNumber(stopper.value));

/** Whether a gap or a limit is authored and cannot be read, or a gap is below 0. */
function unreadable(input: DialControlInput): boolean {
  const gap = input.between?.rule === 'stop' ? input.between.gap : undefined;
  if (gap === null || (gap !== undefined && (!isNumber(gap) || gap < 0))) return true;
  return input.stoppers.some(stopper => [stopper.limit?.min, stopper.limit?.max].some(side => side === null || (side !== undefined && !isNumber(side))));
}
/** The dial's state. */
export function dialControlState(input: DialControlInput): DialControlState {
  if (drawnStoppers(input).length === 0) return 'unavailable';
  return unreadable(input) ? 'read-only' : 'editable';
}

/**
 * Where a stopper may go: the lowest and highest value it may take, and where a stop mark stands. `lower` and `upper` are inside the ring; a mark is a value, or
 * `null` when that side has none (the ring's end, or the thermostat's own stop). `null` for a stopper that is not drawn or a dial that is not editable.
 */
export interface StopBounds { lower: number; upper: number; lowerMark: number | null; upperMark: number | null }
export function stopBounds(input: DialControlInput, id: string): StopBounds | null {
  if (dialControlState(input) !== 'editable') return null;
  const index = input.stoppers.findIndex(stopper => stopper.id === id);
  const stopper = input.stoppers[index];
  if (!stopper || !isNumber(stopper.value)) return null;
  const { range } = input, current = stopper.value;
  // Every bound that holds the stopper, as a value and whether it earns a stop mark. A bound the value already passes moves out to the value: away, never forced.
  const uppers: { at: number; mark: boolean }[] = [{ at: range.max, mark: false }];
  const lowers: { at: number; mark: boolean }[] = [{ at: range.min, mark: false }];
  const upper = (at: number, mark: boolean) => uppers.push({ at: Math.max(at, current), mark });
  const lower = (at: number, mark: boolean) => lowers.push({ at: Math.min(at, current), mark });
  if (isNumber(stopper.limit?.max)) upper(stopper.limit.max, stopper.limit.max < range.max);
  if (isNumber(stopper.limit?.min)) lower(stopper.limit.min, stopper.limit.min > range.min);
  const other = input.stoppers.length === 2 ? input.stoppers[1 - index] : undefined;
  if (input.between?.rule === 'stop' && other && isNumber(other.value)) {
    const gap = isNumber(input.between.gap) ? input.between.gap : 0;
    if (index === 0) upper(other.value - gap, gap > 0);
    else lower(other.value + gap, gap > 0);
  }
  const tightest = (list: typeof uppers, pick: (a: number, b: number) => number) => {
    const at = list.map(entry => entry.at).reduce((a, b) => pick(a, b));
    return { at, mark: list.some(entry => entry.at === at && entry.mark) };
  };
  const top = tightest(uppers, Math.min), bottom = tightest(lowers, Math.max);
  return {
    lower: clean(bottom.at), upper: clean(top.at),
    lowerMark: bottom.mark && bottom.at > range.min ? clean(bottom.at) : null,
    upperMark: top.mark && top.at < range.max ? clean(top.at) : null,
  };
}

/**
 * The value a stopper takes when it is dragged or tapped to `raw`: held inside its bounds and the ring, then on the grid. A bound that falls between two grid
 * values gives the one inside it. With no grid value inside its bounds, or when the stopper cannot move at all, it keeps its value. `stopped` is true when the
 * bound, not the finger, set the answer.
 */
export function moveStopper(input: DialControlInput, id: string, raw: number): { value: number; stopped: boolean } | null {
  const bounds = stopBounds(input, id);
  const stopper = input.stoppers.find(entry => entry.id === id);
  if (!bounds || !stopper || !isNumber(stopper.value)) return null;
  const keep = { value: stopper.value, stopped: true };
  if (!isNumber(raw)) return keep;
  const { range } = input;
  const low = Math.max(bounds.lower, range.min), high = Math.min(bounds.upper, range.max);
  const lowest = snapToStep(range, low, 'up'), highest = snapToStep(range, high, 'down');
  if (lowest > highest || low > high) return keep;
  const value = Math.min(highest, Math.max(lowest, snapToStep(range, Math.min(high, Math.max(low, raw)))));
  const wanted = snapToStep(range, raw);
  return { value, stopped: value !== wanted };
}

/** One step on from where a stopper is, up or down, inside its bounds (the VoiceOver adjust action and its named Raise and Lower). The same value when it cannot move. */
export function adjustStopper(input: DialControlInput, id: string, direction: 1 | -1): number | null {
  const stopper = input.stoppers.find(entry => entry.id === id);
  if (!stopper || !isNumber(stopper.value)) return null;
  const position = (stopper.value - input.range.min) / input.range.step;
  // The next grid value strictly beyond the current one, which for a value off the grid is the grid value on that side.
  const next = direction === 1 ? Math.floor(position + EPSILON) + 1 : Math.ceil(position - EPSILON) - 1;
  const moved = moveStopper(input, id, input.range.min + next * input.range.step);
  if (!moved) return null;
  return (direction === 1 ? moved.value > stopper.value : moved.value < stopper.value) ? moved.value : stopper.value;
}

/**
 * The stopper a tap on the ring at `raw` moves: the nearest drawn one. A tie goes to the first stopper, except that two stoppers at the same value and a tap above
 * them move the second. `null` when the dial is not editable.
 */
export function nearestStopper(input: DialControlInput, raw: number): string | null {
  if (dialControlState(input) !== 'editable' || !isNumber(raw)) return null;
  const drawn = drawnStoppers(input);
  let best: DialControlStopper | null = null;
  for (const stopper of drawn) {
    if (best === null) { best = stopper; continue; }
    const near = Math.abs(stopper.value! - raw), held = Math.abs(best.value! - raw);
    if (near < held - EPSILON || (Math.abs(near - held) <= EPSILON && stopper.value === best.value && raw > stopper.value!)) best = stopper;
  }
  return best?.id ?? null;
}
