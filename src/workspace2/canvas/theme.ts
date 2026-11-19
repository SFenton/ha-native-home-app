import { ensureContrast, parseColor, toCss, type DerivedTheme } from '../theme';
import type { PortType } from '../../shared/composition/graph';

const seeds = {
  number: ['#1765b8', '#79b8ff'], text: ['#8a5300', '#f6c56f'], condition: ['#26703c', '#87d69b'],
  time: ['#7650a5', '#c6a5ef'], list: ['#006d77', '#6ed3df'], entity: ['#596273', '#b6c1d2'], record: ['#596273', '#b6c1d2'],
};
export const wireKind = (type: PortType): keyof typeof seeds => type.representation === 'condition' ? 'condition' : type.valueType === 'yes/no' ? 'condition' : type.valueType === 'unresolved' ? 'record' : type.valueType;
export function canvasTheme(theme: DerivedTheme): Record<string, string> {
  const ground = parseColor(theme.variables['--w2-bg'])!, card = parseColor(theme.variables['--w2-card'])!, ink = parseColor(theme.variables['--w2-ink'])!;
  const result: Record<string, string> = {};
  for (const [kind, pair] of Object.entries(seeds)) {
    const color = ensureContrast(ensureContrast(parseColor(pair[theme.dark ? 1 : 0])!, ground, ink), card, ink);
    result[`--w2-wire-${kind}`] = toCss(color);
  }
  result['--w2-observation-pinned'] = result['--w2-wire-time'];
  const focusSurfaces = ['--w2-bg', '--w2-card', '--w2-field', '--w2-hover', '--w2-selected'];
  result['--w2-canvas-focus'] = toCss(focusSurfaces.reduce((color, surface) => ensureContrast(color, parseColor(theme.variables[surface])!, ink, 3.05), parseColor(theme.selection)!));
  return result;
}
