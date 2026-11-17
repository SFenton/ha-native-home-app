import { describe, expect, it } from 'vitest';
import { clampTint, clampedColor, contrast, liftedFill, mix, packRgb, parseColor, unpackRgb } from '../src/shared/composition/color';

/** The tier 1 color parser and the port of the app's `ChipTint.fromWeb`; the expected numbers are written by hand. */
describe('parseColor', () => {
  it('reads the four hex lengths, in any case', () => {
    expect(parseColor('#0f8')).toEqual({ red: 0, green: 255, blue: 136 });
    expect(parseColor('#0f8c')).toEqual({ red: 0, green: 255, blue: 136 });
    expect(parseColor('#009688')).toEqual({ red: 0, green: 150, blue: 136 });
    expect(parseColor(' #009688FF ')).toEqual({ red: 0, green: 150, blue: 136 });
  });
  it('reads rgb and rgba in the comma and the space forms, with numbers or percentages', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ red: 10, green: 20, blue: 30 });
    expect(parseColor('rgba(10,20,30,0.5)')).toEqual({ red: 10, green: 20, blue: 30 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ red: 10, green: 20, blue: 30 });
    expect(parseColor('rgb(100%, 0%, 50%)')).toEqual({ red: 255, green: 0, blue: 128 });
  });
  it('reads hsl and hsla, with a unitless or deg hue', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ red: 255, green: 0, blue: 0 });
    expect(parseColor('hsl(120deg 100% 25%)')).toEqual({ red: 0, green: 128, blue: 0 });
    expect(parseColor('hsla(240, 100%, 50%, 0.4)')).toEqual({ red: 0, green: 0, blue: 255 });
  });
  it('gives no color for alpha 0, out-of-range numbers, names, lists and stray text', () => {
    for (const text of ['#00968800', 'rgba(1,2,3,0)', 'rgb(1 2 3 / 0)', 'rgb(256, 0, 0)', 'rgb(1,2)', 'red', '[1,2,3]', '#12', '#12345', 'rgb(1,2,3) x',
      'hsl(10, 50, 50)', 'hsl(10, 101%, 50%)', 'rgb(1, 2, 3 / 0.5)', '', 'rgba(1,2,3,2)']) expect(parseColor(text), text).toBeUndefined();
  });
});

describe('the clamp', () => {
  it('packs and unpacks channels', () => {
    expect(packRgb({ red: 1, green: 2, blue: 3 })).toBe(0x010203);
    expect(unpackRgb(0x010203)).toEqual({ red: 1, green: 2, blue: 3 });
  });
  it('mixes per channel, rounding half away from zero', () => {
    expect(mix(0xFFFFFF, 0x000000, 0.5)).toBe(0x808080);
    expect(mix(0x000000, 0xFFFFFF, 0)).toBe(0xFFFFFF);
  });
  it('turns #009688 into fill 0,110,99 and glyph 166,218,213 (the app\'s anchor)', () => {
    expect(clampTint(0x009688)).toEqual({ fill: 0x006E63, glyph: 0xA6DAD5 });
    expect(clampedColor({ red: 0, green: 150, blue: 136 }, 'fill')).toEqual({ red: 0, green: 110, blue: 99 });
    expect(clampedColor({ red: 0, green: 150, blue: 136 }, 'glyph')).toEqual({ red: 166, green: 218, blue: 213 });
  });
  it('darkens white to a fill that carries white text, and lifts black to a glyph that holds 3:1', () => {
    const white = clampTint(0xFFFFFF), black = clampTint(0x000000);
    expect(contrast(0xFFFFFF, liftedFill(white.fill))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(black.glyph, black.fill)).toBeGreaterThanOrEqual(3);
  });
  it('keeps every color on a coarse sweep readable: white text 4.5:1 under the highlight and a glyph of 3:1', () => {
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
      const tint = clampTint(packRgb({ red: r, green: g, blue: b }));
      expect(contrast(0xFFFFFF, liftedFill(tint.fill)), `${r},${g},${b}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tint.glyph, tint.fill), `${r},${g},${b}`).toBeGreaterThanOrEqual(3);
    }
  });
});
