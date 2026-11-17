/**
 * The CSS an ink draws as (`sh.text-style@1`): `rgb()` for a `solid-rgb`, `rgb(r g b / a)` for an `rgba`, and `light-dark()` of two of those for a
 * `solid-appearance` pair, which follows the `color-scheme` of the element it lands on. Anything else (no ink) is undefined.
 */
type Channels = { type?: string; red?: number; green?: number; blue?: number; alpha?: number };
type Ink = Channels | { type?: string; light?: Channels; dark?: Channels } | undefined | null;

const one = (color: Channels | undefined): string | undefined => color?.type === 'solid-rgb' ? `rgb(${color.red} ${color.green} ${color.blue})`
  : color?.type === 'rgba' ? `rgb(${color.red} ${color.green} ${color.blue} / ${color.alpha})` : undefined;

/** The CSS colour of an ink, or undefined when it is not one. */
export function inkColor(ink: unknown): string | undefined {
  const look = ink as Ink;
  if (look?.type === 'solid-appearance') {
    const pair = look as { light?: Channels; dark?: Channels }, light = one(pair.light), dark = one(pair.dark);
    return light && dark ? `light-dark(${light}, ${dark})` : undefined;
  }
  return one(look as Channels | undefined);
}
