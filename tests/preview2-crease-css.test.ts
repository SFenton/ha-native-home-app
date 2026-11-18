import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The fold is one display bent, not two with a line between them (owner feedback on PR #11): the crease is a falloff and nothing is stroked on the hinge. */
const css = readFileSync(new URL('../src/preview2/preview2.css', import.meta.url), 'utf8');
const rig = readFileSync(new URL('../src/preview2/duo-rig.css', import.meta.url), 'utf8');

describe('the crease and the halves meet without a line', () => {
  it('draws the crease as gradients only: no stroke, no pseudo-element line', () => {
    const rules = css.split('\n').filter(line => /\.sh-crease/.test(line));
    expect(rules.some(line => /::after|::before|border|outline|box-shadow/.test(line))).toBe(false);
    expect(rules.filter(line => /linear-gradient/.test(line))).toHaveLength(2);
  });

  it('shades the second half as a falloff that starts at nothing on the hinge, never a uniform step', () => {
    const light = rig.split('\n').filter(line => /\.sh-light\b/.test(line) && /background/.test(line));
    expect(light.length).toBeGreaterThanOrEqual(2);
    for (const line of light) expect(line).toMatch(/linear-gradient\(to (right|bottom), rgba\(0, 0, 0, 0\)/);
  });

  it('holds each screen in front of its half body so the body never shows on the hinge', () => {
    expect(rig).toMatch(/\.sh-clip \{[^}]*translateZ\(3px\)/);
  });

  it('keeps the rig rules inside their one scope: braces balance', () => {
    const open = (rig.match(/\{/g) ?? []).length, close = (rig.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });
});
