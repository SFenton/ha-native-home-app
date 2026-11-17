import { roundHalfAwayFromZero } from './pipeline/text';

/**
 * The one color parser and the app's contrast clamp, for every place a document turns text into a color (`bound-color`, `sh.rules@1`).
 *
 * **Tier 1 syntaxes** (what an entity's text may be): `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`; `rgb()` and `rgba()` with three channels (a
 * number from 0 to 255 or a percentage); `hsl()` and `hsla()` with a hue (a number or `deg`), a saturation and a lightness (percentages). The
 * comma form and the space form with an optional `/ alpha` both parse. Alpha is ignored, except that alpha 0 means "no color". Anything else
 * (a name, a list, a number out of range, a trailing word) is not a color. A `read` cannot return a list, so the `rgb_color` and `hs_color`
 * attributes of Home Assistant wait for a later tier. Rounding is half away from zero, as the app's `rounded()`.
 *
 * **The clamp** is a port of the app's `ChipTint.fromWeb` (`apple/Sources/HassDesign/ChipTint.swift:66-90`, with `ColorFamily.mix` at
 * `apple/Sources/HassDesign/ColorFamily.swift:228-234`, read at native-home ab201d81): a color Home Assistant supplies is scaled toward black until
 * white text passes 4.5:1 on it, also under the chip's top highlight, and the color itself is lightened toward white until the glyph keeps 3:1.
 * It is deterministic, so the same text always gives the same chip. A conditional case holds a literal fill and is never clamped.
 */

/** A color as three channels, each 0 to 255. */
export interface Rgb { red: number; green: number; blue: number }
/** A chip's computed look as `0xRRGGBB`, the app's `ChipTint`. */
export interface ChipTint { fill: number; glyph: number }

// MARK: Parsing

const number = /^\d+(?:\.\d+)?$|^\.\d+$/;
const channel = (token: string): number | undefined => {
  if (token.endsWith('%')) {
    const part = token.slice(0, -1);
    if (!number.test(part) || Number(part) > 100) return undefined;
    return roundHalfAwayFromZero(Number(part) * 255 / 100);
  }
  if (!number.test(token) || Number(token) > 255) return undefined;
  return roundHalfAwayFromZero(Number(token));
};
/** An alpha token as 0 to 1, or undefined when it is not one. */
const alpha = (token: string): number | undefined => {
  if (token.endsWith('%')) return number.test(token.slice(0, -1)) && Number(token.slice(0, -1)) <= 100 ? Number(token.slice(0, -1)) / 100 : undefined;
  return number.test(token) && Number(token) <= 1 ? Number(token) : undefined;
};
const percent = (token: string): number | undefined =>
  token.endsWith('%') && number.test(token.slice(0, -1)) && Number(token.slice(0, -1)) <= 100 ? Number(token.slice(0, -1)) / 100 : undefined;

function hexColor(body: string): Rgb | undefined {
  if (!/^[0-9a-f]+$/i.test(body) || ![3, 4, 6, 8].includes(body.length)) return undefined;
  const digits = body.length <= 4 ? [...body].map(digit => digit + digit) : body.match(/../g)!;
  const [red, green, blue, opacity] = digits.map(pair => parseInt(pair, 16));
  return opacity === 0 ? undefined : { red, green, blue };
}
/** The tokens of a function's arguments: three, then an optional alpha, in the comma form or the space form with `/`. */
function tokens(body: string): { parts: string[]; opacity?: string } | undefined {
  if (body.includes(',')) {
    if (body.includes('/')) return undefined;
    const list = body.split(',').map(part => part.trim());
    return list.length === 3 || list.length === 4 ? { parts: list.slice(0, 3), opacity: list[3] } : undefined;
  }
  const [colors, ...rest] = body.split('/');
  if (rest.length > 1) return undefined;
  const parts = colors.trim().split(/\s+/);
  const opacity = rest[0]?.trim();
  return parts.length === 3 && (rest.length === 0 || opacity) ? { parts, opacity } : undefined;
}
function hslColor(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs(sector % 2 - 1));
  const [r, g, b] = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma] : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const lift = lightness - chroma / 2;
  const byte = (value: number) => roundHalfAwayFromZero((value + lift) * 255);
  return { red: byte(r), green: byte(g), blue: byte(b) };
}

/**
 * Parses text as a tier 1 color, or undefined when it is not one (or when its alpha is 0). Case and the spaces around the text do not matter.
 */
export function parseColor(input: string): Rgb | undefined {
  const text = input.trim().toLowerCase();
  if (text.startsWith('#')) return hexColor(text.slice(1));
  const match = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!match) return undefined;
  const found = tokens(match[2].trim());
  if (!found) return undefined;
  if (found.opacity !== undefined) {
    const opacity = alpha(found.opacity);
    if (opacity === undefined || opacity === 0) return undefined;
  }
  if (match[1].startsWith('rgb')) {
    const [red, green, blue] = found.parts.map(channel);
    return red === undefined || green === undefined || blue === undefined ? undefined : { red, green, blue };
  }
  const hueToken = found.parts[0].endsWith('deg') ? found.parts[0].slice(0, -3) : found.parts[0];
  const [saturation, lightness] = [percent(found.parts[1]), percent(found.parts[2])];
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(hueToken) || saturation === undefined || lightness === undefined) return undefined;
  return hslColor(Number(hueToken), saturation, lightness);
}

/** `0xRRGGBB` of a color. */
export const packRgb = ({ red, green, blue }: Rgb): number => red * 65536 + green * 256 + blue;
/** The channels of `0xRRGGBB`. */
export const unpackRgb = (value: number): Rgb => ({ red: Math.floor(value / 65536) % 256, green: Math.floor(value / 256) % 256, blue: value % 256 });

// MARK: The app's clamp

/** The share of a web color kept in the fill (`ChipTint.fillScale`). */
export const fillScale = 0.73;
/** The chip's top highlight opacity (`ChipTint.highlight`). */
export const highlight = 0.12;
/** Body text contrast (`ChipTint.textContrast`, WCAG 1.4.3). */
export const textContrast = 4.5;
/** Non-text contrast for the glyph (`ChipTint.glyphContrast`, WCAG 1.4.11). */
export const glyphContrast = 3;

/** `amount` of `a`, the rest `b`, per channel and rounded (`ColorFamily.mix`). */
export function mix(a: number, b: number, amount: number): number {
  const part = (shift: number) => {
    const from = Math.floor(a / 2 ** shift) % 256, to = Math.floor(b / 2 ** shift) % 256;
    return roundHalfAwayFromZero(from * amount + to * (1 - amount)) * 2 ** shift;
  };
  return part(16) + part(8) + part(0);
}
/** WCAG relative luminance of `0xRRGGBB` (`ChipTint.luminance`). */
export function luminance(value: number): number {
  const linear = (shift: number) => {
    const c = (Math.floor(value / 2 ** shift) % 256) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0);
}
/** WCAG contrast ratio between two `0xRRGGBB` colors (`ChipTint.contrast`). */
export function contrast(a: number, b: number): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** The ground under the chip's text near the top, where the chip lays a 12% white highlight (`ChipTint.liftedFill`). */
export const liftedFill = (fill: number): number => mix(0xFFFFFF, fill, highlight);

/**
 * The chip tint for a web color (`ChipTint.fromWeb`): the fill is the color scaled toward black until white text reads on it, also under the
 * highlight; the glyph is `preferredGlyph` when it reads, else the color lightened toward white until it keeps 3:1.
 */
export function clampTint(color: number, preferredGlyph?: number): ChipTint {
  let fill = mix(color, 0x000000, fillScale);
  while (contrast(0xFFFFFF, liftedFill(fill)) < textContrast && fill !== 0) fill = mix(fill, 0x000000, 0.95);
  const reads = (glyph: number) => contrast(glyph, fill) >= glyphContrast && contrast(glyph, liftedFill(fill)) >= glyphContrast;
  if (preferredGlyph !== undefined && reads(preferredGlyph)) return { fill, glyph: preferredGlyph };
  let amount = 0, glyph = color;
  while (!reads(glyph) && amount < 1) { amount += 0.05; glyph = mix(0xFFFFFF, color, amount); }
  return { fill, glyph };
}

/** What a bound color becomes in a slot: the chip's fill, or its glyph. */
export type ColorRole = 'fill' | 'glyph';
/** The clamped color a slot of `role` draws for text that parsed as `rgb`. */
export function clampedColor(rgb: Rgb, role: ColorRole): Rgb {
  const tint = clampTint(packRgb(rgb));
  return unpackRgb(role === 'fill' ? tint.fill : tint.glyph);
}
