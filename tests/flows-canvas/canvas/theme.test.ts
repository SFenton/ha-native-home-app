import { describe, expect, it } from 'vitest';
import { contrast, deriveTheme, parseColor } from '../../../src/workspace2/theme';
import { canvasTheme } from '../../../src/workspace2/canvas/theme';

describe('C-themes wire/glyph and focus contrast', () => {
  it.each([
    ['light', {}],
    ['dark', { '--primary-background-color': '#111111', '--card-background-color': '#202020', '--primary-text-color': '#eeeeee' }],
    ['custom HA', { '--primary-color': '#9b7ac4', '--primary-background-color': '#f3edf7', '--card-background-color': '#fbf8ff', '--primary-text-color': '#312043', '--secondary-text-color': '#72577e' }],
  ])('%s keeps labels >=4.5 and focus >=3 against card and canvas', (_, values) => {
    const theme = deriveTheme(values, false), wires = canvasTheme(theme);
    for (const [name, value] of Object.entries(wires)) for (const ground of ['--w2-bg', '--w2-card']) {
      expect(contrast(parseColor(value)!, parseColor(theme.variables[ground])!)).toBeGreaterThanOrEqual(name.includes('focus') ? 3 : 4.5);
    }
  });
});
