import { defaultDetent, type TileSwipe } from '../shared/composition/tile-swipe';

/**
 * The maths of a tile swipe, pure so the drag and its tests share one answer (`build/design/tile-swipe.md`, sections 1 and 2). The mapping is absolute: the
 * band's edge is where the finger is. Nothing here touches the DOM.
 */
export type SwipeRange = TileSwipe['range'];

/** A pointer drag of this many screen pixels, more horizontal than vertical, begins the swipe (React's threshold, `LightBrightnessCard.tsx:11-14`). */
export const SWIPE_THRESHOLD = 6;
/** The bubble: a 32 point capsule at least 60 wide, 44 and 84 at accessibility text sizes (design values). */
export const BUBBLE = { height: 32, minWidth: 60, padding: 12, rise: 24 } as const;
export const BUBBLE_LARGE = { height: 44, minWidth: 84, padding: 12, rise: 30 } as const;

const EPS = 1e-9;
/** Decimal places a step has, so a snapped value carries no float noise (0.5 gives 1). */
const places = (step: number) => { const text = String(step); const dot = text.indexOf('.'); return dot < 0 ? 0 : text.length - dot - 1; };
/** `value` pulled onto the range's step grid and into the range. */
export function snap(value: number, range: SwipeRange): number {
  const stepped = range.min + Math.round((value - range.min) / range.step + EPS) * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, stepped));
  return Number(clamped.toFixed(Math.max(places(range.step), places(range.min))));
}
/** The share of the range `value` is, 0 to 1: the band's width. */
export const fraction = (value: number, range: SwipeRange) => Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
/** The value under a finger `x` points from the tile's leading edge, across `width`: clamped, then snapped. Right to left mirrors it, so the minimum stays on the leading edge. */
export function valueAtX(x: number, width: number, range: SwipeRange, rtl = false): number {
  if (!(width > 0)) return range.min;
  const share = Math.min(1, Math.max(0, x / width));
  return snap(range.min + (rtl ? 1 - share : share) * (range.max - range.min), range);
}
/** The index of the detent line at or below `value`: lines sit at min + k * detent. */
const lineOf = (value: number, range: SwipeRange, detent: number) => Math.floor((value - range.min) / detent + EPS);
/** Whether moving from `from` to `to` crosses a detent line (the ends included), in either direction. Never on the first sample (`from` undefined). */
export function crossesDetent(from: number | undefined, to: number, range: SwipeRange, detent = defaultDetent(range)): boolean {
  if (from === undefined || from === to) return false;
  // Arriving at either end ticks, as passing a line does.
  return to === range.min || to === range.max || lineOf(from, range, detent) !== lineOf(to, range, detent);
}
/** The value one VoiceOver step (or an arrow key) away: `direction` is 1 or -1, clamped and snapped to the range. */
export const adjust = (value: number, direction: 1 | -1, range: SwipeRange, detent = defaultDetent(range)) => snap(value + direction * detent, range);
/** A release plans a call only when it lands on a value other than the one the tile shows. */
export const releasePlans = (shown: number | undefined, released: number) => shown === undefined || Math.abs(shown - released) > EPS;

/** A number as text: whole numbers have no fraction and a decimal has no trailing zeros ("0.5", "72"). */
export const numberText = (value: number) => String(Number(value.toFixed(6)));
/** The bubble and the spoken value: `format` with `{value}` replaced by the number, else the bare number. */
export const formatSwipe = (format: string | undefined, value: number) => (format ?? '{value}').replace(/\{value\}/g, numberText(value));
/** What the bubble says: a light group tile says its own words ("Off" at 0, else the level), every other tile its `format`. */
export function bubbleText(kind: 'light' | 'state', value: number, format: string | undefined, words: { off?: string; level?: string } = {}): string {
  if (kind === 'light') return value <= 0 ? words.off ?? 'Off' : (words.level ?? '{value}%').replace(/\{value\}/g, numberText(value));
  return formatSwipe(format, value);
}
/** The bubble's width: its text at about 8 points a character, padded, never narrower than the minimum nor wider than the tile. */
export function bubbleWidth(text: string, tileWidth: number, large = false): number {
  const spec = large ? BUBBLE_LARGE : BUBBLE;
  return Math.min(tileWidth, Math.max(spec.minWidth, text.length * (large ? 12 : 8.5) + spec.padding * 2));
}
/**
 * The bubble's centre across the tile: on the band's edge, clamped so the whole bubble stays inside the tile (flush with the leading edge at the
 * minimum and the trailing edge at the maximum). `share` is the value's share of the range; right to left mirrors the edge.
 */
export function bubbleCenter(share: number, tileWidth: number, bubble: number, rtl = false): number {
  const edge = (rtl ? 1 - share : share) * tileWidth;
  return Math.min(tileWidth - bubble / 2, Math.max(bubble / 2, edge));
}
/**
 * The bubble centre's offset from the tile's top edge, negative above it: 24 points above (8 clear of the tile), or pulled down only as far as needed to stay
 * `inset` points inside the visible scroll area when `room` (the space between the tile's top and the area's top) is under 44. It never flips below the tile.
 */
export function bubbleTop(room: number, large = false, inset = 4): number {
  const spec = large ? BUBBLE_LARGE : BUBBLE;
  return Math.max(-spec.rise, -room + inset + spec.height / 2);
}
