/**
 * The CSS a solid look draws as: `rgb()` for an exact colour, `light-dark()` of two `rgb()` for a `solid-appearance` pair
 * (`sh.solid-appearance@1`). `light-dark()` follows the `color-scheme` of the element the colour lands on, so the preview needs no appearance state of its own.
 * Anything that is not an exact colour (the standard fill, a rule, nothing) is undefined.
 */
type Rgb = { type?: string; red?: number; green?: number; blue?: number };
type Look = Rgb | { type?: string; light?: Rgb; dark?: Rgb } | undefined | null;

const channels = (fill: Rgb | undefined) => fill?.type === 'solid-rgb' ? `rgb(${fill.red} ${fill.green} ${fill.blue})` : undefined;

/** The CSS colour of `fill`, or undefined when it is not an exact colour. */
export function solidColor(fill: unknown): string | undefined {
  const look = fill as Look;
  if (look?.type === 'solid-appearance') {
    const pair = look as { light?: Rgb; dark?: Rgb }, light = channels(pair.light), dark = channels(pair.dark);
    return light && dark ? `light-dark(${light}, ${dark})` : undefined;
  }
  return channels(look as Rgb | undefined);
}
