import type { Json } from '../../types';

/**
 * The text and number rules a Data Flow defines for itself, because JavaScript and Swift disagree on them (measured on Node 26 and
 * Swift 6.4, pinned by `contract/corpus/pipelines` and `tests/pipeline-divergences.test.ts`):
 *
 * - Strings are equal when their NFC forms are equal, and ordered by the scalar values of their NFC forms. JavaScript compares UTF-16
 *   units and code units, so U+1F600 sorts before U+FF5E there and after it in Swift, and "e" + U+0301 differs from U+00E9 only in JS.
 * - A number prints as Swift prints a `Double`, except that a whole number below 1e15 has no ".0": 1e-05, 1.5e-07, 1e+16, 1000000000000000.0.
 * - Rounding sends a tie away from zero (`-2.5` gives `-3`); `Math.round` sends it up.
 */

/** NFC equality, which is Swift's `String ==`. */
export const textEquals = (a: string, b: string): boolean => a === b || a.normalize('NFC') === b.normalize('NFC');
/** Orders by the Unicode scalar values of the NFC forms, which is Swift's `String <`. */
export function compareText(a: string, b: string): number {
  const x = a.normalize('NFC'), y = b.normalize('NFC');
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    const left = x.codePointAt(i)!, right = y.codePointAt(j)!;
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1; j += right > 0xffff ? 2 : 1;
  }
  return i < x.length ? 1 : j < y.length ? -1 : 0;
}
/** A finite number from a number or a numeric string (a Home Assistant state is always text). */
export function finiteNumber(value: Json | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

// MARK: Numbers

/**
 * A number as Swift prints a `Double`: shortest digits that read back exactly; no fraction on a whole number below 1e15; ".0" from 1e15
 * to 1e16; exponent form from 1e16 and below 1e-4, with an exponent of at least two digits (`1e-05`, `1.2345678901234568e+20`).
 * Negative zero prints as `0`.
 */
export function numberText(n: number): string {
  if (n === 0 || !Number.isFinite(n)) return '0';
  const magnitude = Math.abs(n);
  if (magnitude >= 1e16) return exponentText(n);
  if (Number.isInteger(n)) return magnitude < 1e15 ? String(n) : `${n}.0`;
  return magnitude < 1e-4 ? exponentText(n) : String(n);
}
function exponentText(n: number): string {
  const [digits, exponent] = n.toExponential().split('e');
  const sign = exponent[0], size = exponent.slice(1);
  return `${digits}e${sign}${size.length < 2 ? `0${size}` : size}`;
}
/** A scalar as text: strings as they are, numbers as `numberText`, booleans as `true` and `false`; anything else has none. */
export function scalarText(value: Json | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? numberText(value) : undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}
/** Swift's `.rounded()`: a tie goes away from zero (`Math.round` sends -2.5 to -2). */
export const roundHalfAwayFromZero = (x: number): number => x < 0 ? -Math.round(-x) : Math.round(x);
/**
 * `n` with exactly `digits` fraction digits, rounded like C's `printf("%.Nf")`: the exact binary value is rounded, and only a value
 * exactly halfway goes to the even digit (2.5 gives "2", 3.5 gives "4", 0.125 gives "0.12"). `toFixed` rounds those ties up.
 */
function fixed(n: number, digits: number): string {
  const magnitude = Math.abs(n);
  let out = magnitude < 1e21 ? magnitude.toFixed(digits) : `${BigInt(magnitude)}${digits ? `.${'0'.repeat(digits)}` : ''}`;
  if (magnitude < 1e21) {
    const exact = magnitude.toFixed(100), dot = exact.indexOf('.');
    if (/^50*$/.test(exact.slice(dot + 1 + digits))) {
      const kept = digits === 0 ? exact.slice(0, dot) : exact.slice(0, dot + 1 + digits);
      if (Number(kept.at(-1)) % 2 === 0) out = kept;
    }
  }
  return n < 0 ? `-${out}` : out;
}
/**
 * The text of a number with at most `digits` fraction digits and no trailing zeros, except that at least `minimum` fraction digits stay
 * (`sh.pipeline-operands@1`): 72 with a maximum and a minimum of 1 is "72.0", 72.25 with 1 and 1 is "72.3" (a tie goes to the even digit, see `fixed`).
 * `minimum` is held to `digits`. A result that rounds to zero has no sign: `-0.04` with 1 and 1 is "0.0".
 */
export function formatNumber(n: number, digits: number, minimum = 0): string {
  const most = Math.max(0, Math.min(6, digits)), least = Math.max(0, Math.min(most, minimum));
  let out = fixed(n, most);
  if (out.includes('.')) {
    const [whole, fraction] = out.split('.');
    const kept = fraction.replace(/0+$/, '').padEnd(least, '0');
    out = kept ? `${whole}.${kept}` : whole;
  }
  return /^-0(\.0*)?$/.test(out) ? out.slice(1) : out;
}
/**
 * The title case a `format` argument can ask for (`sh.pipeline-operands@1`), the rule of the web's `titleCaseState` and the app's `StateText.titleCase`:
 * only `_` separates words, each word's first character is made upper case, the rest stays, and the words are joined by one space ("armed_away" is
 * "Armed Away", "heat cool" is "Heat cool"). Only an ASCII letter changes, so JavaScript and Swift cannot disagree on a case mapping.
 */
export function titleCase(text: string): string {
  return text.split('_').map(word => /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
}
/**
 * The case `{ text: { case: "words" } }` asks for (`sh.text-case-words@1`): every word starts with a capital, so "wheel stuck" is "Wheel Stuck".
 * A word ends at `_` or at a space (U+0020 only; no other separator). Each part's first character is made upper case only when it is an ASCII `a` to
 * `z`, the rest stays, and the parts are joined by one space. Empty parts stay, as in {@link titleCase} ("a  b" is "A  B", "_x" is " X"), and empty
 * text is empty. Swift reads the same rule over `unicodeScalars`, never `capitalized`, so the two cannot differ on a case mapping.
 */
export function wordsCase(text: string): string {
  return text.split(/[_ ]/).map(word => /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
}
