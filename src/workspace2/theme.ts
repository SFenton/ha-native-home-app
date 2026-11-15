/**
 * Studio chrome theming (spec section 11). The chrome takes its colours from Home Assistant's theme when the parent
 * frame is readable, else from `prefers-color-scheme`. Derived tokens are corrected until their text pairs reach 4.5:1.
 * The preview never reads any of this: it keeps the S+H look and only inherits `--studio-selection`.
 */

/** An sRGB colour with channels 0 to 255 and alpha 0 to 1. */
export interface Rgb { r: number; g: number; b: number; a: number }

const clamp = (value: number, low = 0, high = 255) => Math.min(high, Math.max(low, value));

/** Parses hex, `rgb()`, `rgba()`, `hsl()` and `color(srgb …)`; anything else is undefined. */
export function parseColor(text: string | undefined): Rgb | undefined {
  const value = text?.trim().toLowerCase();
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
    const channel = (at: number) => parseInt(digits.slice(at, at + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const numbers = (body: string) => body.split(/[\s,/]+/).filter(Boolean).map(part => part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part));
  const rgb = /^rgba?\((.+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return undefined;
    const channel = (part: string) => part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    return Object.values(color).every(Number.isFinite) ? { ...color, r: clamp(color.r), g: clamp(color.g), b: clamp(color.b), a: clamp(color.a, 0, 1) } : undefined;
  }
  const srgb = /^color\(srgb\s+(.+)\)$/.exec(value);
  if (srgb) {
    const [r, g, b, a = 1] = numbers(srgb[1]);
    return [r, g, b, a].every(Number.isFinite) ? { r: clamp(r * 255), g: clamp(g * 255), b: clamp(b * 255), a: clamp(a, 0, 1) } : undefined;
  }
  const hsl = /^hsla?\((.+)\)$/.exec(value);
  if (hsl) {
    const [hue, saturation, lightness, alpha = 1] = numbers(hsl[1].replace(/deg/g, ''));
    if (![hue, saturation, lightness, alpha].every(Number.isFinite)) return undefined;
    const s = saturation, l = lightness, k = (n: number) => (n + hue / 30) % 12;
    const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: clamp(alpha, 0, 1) };
  }
  return undefined;
}

/** CSS text for a colour. */
export const toCss = (color: Rgb) => color.a >= 1
  ? `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`
  : `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)} / ${Number(color.a.toFixed(3))})`;

/** WCAG relative luminance. */
export function luminance(color: Rgb): number {
  const linear = (channel: number) => { const unit = channel / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** Paints `top` over an opaque `ground`. */
export const over = (top: Rgb, ground: Rgb): Rgb => ({
  r: top.r * top.a + ground.r * (1 - top.a), g: top.g * top.a + ground.g * (1 - top.a), b: top.b * top.a + ground.b * (1 - top.a), a: 1,
});

/** WCAG contrast ratio of `foreground` on an opaque `ground`. */
export function contrast(foreground: Rgb, ground: Rgb): number {
  const a = luminance(over(foreground, ground)), b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `from` moved `amount` (0 to 1) toward `to`, opaque. */
export const mix = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount, a: 1,
});

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 }, BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

/**
 * `color` mixed toward `target` just far enough to reach `minimum`:1 on `ground`. When the target cannot reach it the
 * result is the target itself (black or white always can on a ground that is not mid grey).
 */
export function ensureContrast(color: Rgb, ground: Rgb, target: Rgb, minimum = 4.5): Rgb {
  const start = { ...color, a: 1 };
  // A small margin, because the colour is rounded to whole channels when it is written out.
  const needed = minimum + 0.05;
  if (contrast(start, ground) >= needed) return start;
  for (let step = 1; step <= 40; step++) {
    const next = mix(start, target, step / 40);
    if (contrast(next, ground) >= needed) return next;
  }
  const opposite = luminance(ground) > 0.179 ? BLACK : WHITE;
  return mix(start, opposite, 1);
}

/** The Home Assistant variables the chrome reads. */
export const haVariables = [
  '--primary-background-color', '--card-background-color', '--primary-text-color', '--secondary-text-color', '--divider-color',
  '--primary-color', '--text-primary-color', '--error-color', '--warning-color', '--success-color',
  '--ha-card-border-radius', '--ha-box-shadow-m', '--ha-font-family-body',
] as const;
export type HaVariable = typeof haVariables[number];
export type HaVariables = Partial<Record<HaVariable, string>>;

/** Fallbacks for the default theme (section 11 table). */
export const fallbackTheme: Record<'light' | 'dark', Record<HaVariable, string>> = {
  light: {
    '--primary-background-color': '#fafafa', '--card-background-color': '#ffffff', '--primary-text-color': '#212121', '--secondary-text-color': '#727272',
    '--divider-color': 'rgba(0,0,0,.12)', '--primary-color': '#03a9f4', '--text-primary-color': '#ffffff', '--error-color': '#db4437', '--warning-color': '#ffa600', '--success-color': '#43a047',
    '--ha-card-border-radius': '12px', '--ha-box-shadow-m': '0 2px 8px rgba(0,0,0,.18), 0 8px 28px rgba(0,0,0,.14)', '--ha-font-family-body': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  dark: {
    '--primary-background-color': '#111111', '--card-background-color': '#1c1c1c', '--primary-text-color': '#e1e1e1', '--secondary-text-color': '#9b9b9b',
    '--divider-color': 'rgba(225,225,225,.12)', '--primary-color': '#03a9f4', '--text-primary-color': '#ffffff', '--error-color': '#db4437', '--warning-color': '#ffa600', '--success-color': '#43a047',
    '--ha-card-border-radius': '12px', '--ha-box-shadow-m': '0 2px 8px rgba(0,0,0,.5), 0 8px 28px rgba(0,0,0,.45)', '--ha-font-family-body': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
};

/** Whether a ground reads as dark: white text on it contrasts more than black text. */
export const isDark = (ground: Rgb) => contrast(WHITE, ground) > contrast(BLACK, ground);

/** The derived tokens: CSS custom properties for the Studio root, plus the scheme they imply. */
export interface DerivedTheme { dark: boolean; variables: Record<string, string>; cardColor: string; selection: string }

/**
 * Builds the chrome tokens. `read` holds what Home Assistant set (missing or unparsable values fall back);
 * `preferDark` decides the fallback scheme when the background is not read.
 */
export function deriveTheme(read: HaVariables, preferDark: boolean): DerivedTheme {
  const readColor = (name: HaVariable) => parseColor(read[name]);
  const background = readColor('--primary-background-color');
  const dark = background ? isDark(background) : preferDark;
  const base = fallbackTheme[dark ? 'dark' : 'light'];
  const color = (name: HaVariable) => readColor(name) ?? parseColor(base[name])!;
  const bg = over(color('--primary-background-color'), dark ? BLACK : WHITE);
  const card = over(color('--card-background-color'), bg);
  const toward = dark ? WHITE : BLACK;
  const ink = ensureContrast(color('--primary-text-color'), card, toward);
  const inkOnBg = ensureContrast(ink, bg, toward);
  const muted = ensureContrast(ensureContrast(color('--secondary-text-color'), card, toward), bg, toward);
  const primary = over(color('--primary-color'), card);
  const line = color('--divider-color');
  const status = (name: HaVariable) => over(color(name), card);
  const text = (source: Rgb) => ensureContrast(source, card, ink);
  // Text on the primary colour: HA's own pair when it reaches 4.5:1, else whichever of the two extremes contrasts more.
  const haOnPrimary = readColor('--text-primary-color');
  const onPrimary = haOnPrimary && contrast(haOnPrimary, primary) >= 4.5 ? { ...haOnPrimary, a: 1 }
    : contrast({ r: 6, g: 34, b: 46, a: 1 }, primary) >= contrast(WHITE, primary) ? { r: 6, g: 34, b: 46, a: 1 } : WHITE;
  // The filled button's ground: the primary colour, darkened (or lightened) just far enough for its text to reach 4.5:1.
  const fillStart = { ...primary, a: 1 }, away = onPrimary.r + onPrimary.g + onPrimary.b > 382 ? BLACK : WHITE;
  let primaryFill = fillStart;
  for (let step = 1; step <= 40 && contrast(onPrimary, primaryFill) < 4.55; step++) primaryFill = mix(fillStart, away, step / 40);
  const withAlpha = (source: Rgb, alpha: number): Rgb => ({ ...source, a: alpha });
  const fill = (source: Rgb, alpha: number) => toCss(over(withAlpha(source, alpha), card));
  const pick = (name: HaVariable) => read[name]?.trim() || base[name];
  const variables: Record<string, string> = {
    '--w2-bg': toCss(bg), '--w2-card': toCss(card), '--w2-ink': toCss(inkOnBg), '--w2-ink-card': toCss(ink), '--w2-muted': toCss(muted),
    '--w2-line': toCss(line.a < 1 ? line : { ...line, a: 0.14 }),
    '--w2-primary': toCss(primary), '--w2-primary-fill': toCss(primaryFill), '--w2-on-primary': toCss(onPrimary),
    '--w2-err': toCss(status('--error-color')), '--w2-warn': toCss(status('--warning-color')), '--w2-ok': toCss(status('--success-color')),
    '--w2-err-text': toCss(text(status('--error-color'))), '--w2-warn-text': toCss(text(status('--warning-color'))), '--w2-ok-text': toCss(text(status('--success-color'))),
    '--w2-link': toCss(text(primary)),
    '--w2-field': fill(ink, 0.07), '--w2-hover': fill(ink, 0.05), '--w2-selected': fill(primary, 0.16),
    '--w2-radius': pick('--ha-card-border-radius'), '--w2-shadow': pick('--ha-box-shadow-m'), '--w2-font': pick('--ha-font-family-body'),
  };
  return { dark, variables, cardColor: variables['--w2-card'], selection: variables['--w2-primary'] };
}

/** The text and ground pairs the theme promises to keep at 4.5:1, for tests and the contrast probe. */
export const textPairs: [text: string, ground: string][] = [
  ['--w2-ink', '--w2-bg'], ['--w2-ink-card', '--w2-card'], ['--w2-muted', '--w2-bg'], ['--w2-muted', '--w2-card'], ['--w2-link', '--w2-card'],
  ['--w2-err-text', '--w2-card'], ['--w2-warn-text', '--w2-card'], ['--w2-ok-text', '--w2-card'], ['--w2-on-primary', '--w2-primary-fill'],
];

/**
 * Reads Home Assistant's theme from the parent frame. Returns undefined outside a frame or when the parent is another
 * origin (reading it throws).
 */
export function readParentVariables(frame: Window = window): HaVariables | undefined {
  try {
    if (frame.parent === frame) return undefined;
    const style = frame.parent.getComputedStyle(frame.parent.document.documentElement);
    const read: HaVariables = {};
    for (const name of haVariables) { const value = style.getPropertyValue(name).trim(); if (value) read[name] = value; }
    return read;
  } catch { return undefined; }
}

/** Calls `listener` whenever the parent's root element changes its style or class (a theme switch). Returns a stop function. */
export function observeParentTheme(listener: () => void, frame: Window = window): () => void {
  try {
    if (frame.parent === frame) return () => {};
    const Observer = (frame.parent as Window & typeof globalThis).MutationObserver;
    const observer = new Observer(listener);
    observer.observe(frame.parent.document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => observer.disconnect();
  } catch { return () => {}; }
}
