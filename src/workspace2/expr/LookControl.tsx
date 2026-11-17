import type { Json } from '../../shared/types';
import ColorPairField, { type ColorPairValue } from '../pickers/ColorPairField';
import { IconField } from '../pickers/PickerField';
import { GlyphByName } from '../../preview2/nodes/shared';
import { colorName, hexOf, type SolidPair } from '../pickers/savedColors';
import { iconName } from '../pickers/icons';
import { PlainSelect } from '../../ui';
import { toneName, toneOptions, toneSwatch } from '../layout/tones';

/** The swatch of a Light and Dark pair: the Light color over the first half and the Dark color over the second. */
const pairBackground = (pair: SolidPair) => `linear-gradient(135deg, ${hexOf(pair.light)} 50%, ${hexOf(pair.dark)} 50%)`;
/** A pair in words: "Orange in light mode, Purple in dark mode". */
export const pairName = (pair: SolidPair) => `${colorName(hexOf(pair.light))} in light mode, ${colorName(hexOf(pair.dark))} in dark mode`;

/** The looks a value can be: an icon, a glyph color, a fill color, or a readout's tone (one of six words). */
export type LookKind = 'icon' | 'glyph' | 'fill' | 'tone';
/** Whether a look is a color. */
export const isColorLook = (look: LookKind) => look === 'glyph' || look === 'fill';

/**
 * The fixed control of a look: the color row or the icon row, as the Studio draws them elsewhere (spec: "Used as the Fixed controls inside
 * ValueField; no change of their own look"). It edits a value, so a rule's Then and a field's Fixed share it.
 */
export default function LookControl({ look, value, onChange, label, path }: { look: LookKind; value: Json | undefined; onChange: (next: Json, live?: boolean) => void; label: string; path?: string }) {
  if (look === 'tone') return <div className="w2-picker-row" data-field-path={path}><span className="w2-row-label">{label}</span><PlainSelect label={label} value={String(value ?? 'neutral')} options={toneOptions} onChange={next => onChange(next)}/></div>;
  if (look === 'icon') {
    const symbol = (value ?? { type: 'sf-symbol', name: 'questionmark.circle' }) as { name: string };
    return <IconField label={label} symbol={symbol.name} path={path} onPick={name => onChange({ ...symbol, name } as Json)}/>;
  }
  return <ColorPairField label={label} path={path} value={(value ?? { type: 'standard' }) as unknown as ColorPairValue} allowStandard={look === 'fill'} allowPair
    onChange={(next, live) => onChange(next as unknown as Json, live)}/>;
}

/** A look in words, with its swatch or glyph: "Orange", "Standard", "Lightbulb". */
export function LookSummary({ look, value }: { look: LookKind; value: Json | undefined }) {
  if (look === 'tone') return <span className="w2-expr-looksum"><span className="w2-expr-swatch" style={{ background: toneSwatch[value as keyof typeof toneSwatch] ?? '#8e8e93' }} aria-hidden/>{toneName(value)}</span>;
  if (look === 'icon') {
    const name = (value as { name?: string } | undefined)?.name ?? '';
    return <span className="w2-expr-looksum"><span className="w2-picker-glyph"><GlyphByName name={name} size={16}/></span>{iconName(name) ?? name}</span>;
  }
  const fill = value as unknown as ColorPairValue | undefined;
  if (!fill || fill.type === 'standard') return <span className="w2-expr-looksum"><span className="w2-expr-swatch" data-standard aria-hidden/>Standard</span>;
  if (fill.type === 'solid-appearance') return <span className="w2-expr-looksum"><span className="w2-expr-swatch" style={{ background: pairBackground(fill) }} data-pair aria-hidden/>{pairName(fill)}</span>;
  const hex = hexOf(fill);
  return <span className="w2-expr-looksum"><span className="w2-expr-swatch" style={{ background: hex }} aria-hidden/>{colorName(hex)}</span>;
}
/** The plain-text name of a look, for an accessible name. */
export function lookName(look: LookKind, value: Json | undefined): string {
  if (look === 'tone') return toneName(value);
  if (look === 'icon') { const name = (value as { name?: string } | undefined)?.name ?? ''; return iconName(name) ?? name; }
  const fill = value as unknown as ColorPairValue | undefined;
  return !fill || fill.type === 'standard' ? 'Standard' : fill.type === 'solid-appearance' ? pairName(fill) : colorName(hexOf(fill));
}

/** Just the glyph or swatch of a look, for the face of a field. */
export function LookGlyph({ look, value }: { look: LookKind; value: Json | undefined }) {
  if (look === 'tone') return <span className="w2-expr-swatch" style={{ background: toneSwatch[value as keyof typeof toneSwatch] ?? '#8e8e93' }} aria-hidden/>;
  if (look === 'icon') return <span className="w2-picker-glyph"><GlyphByName name={(value as { name?: string } | undefined)?.name ?? ''} size={18}/></span>;
  const fill = value as unknown as ColorPairValue | undefined;
  return !fill || fill.type === 'standard' ? <span className="w2-expr-swatch" data-standard aria-hidden/>
    : <span className="w2-expr-swatch" style={{ background: fill.type === 'solid-appearance' ? pairBackground(fill) : hexOf(fill) }} data-pair={fill.type === 'solid-appearance' || undefined} aria-hidden/>;
}
