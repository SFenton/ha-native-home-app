import { LabeledRow, Switch, TextInput } from '../editors/controls';
import ColorField, { type ColorValue } from './ColorField';
import type { SolidColor } from './savedColors';

/** An exact colour with an opacity (`sh.text-style@1`). */
export interface RgbaColor { type: 'rgba'; red: number; green: number; blue: number; alpha: number }
/** One side of an ink: a `solid-rgb` or an `rgba`. */
export type InkSide = SolidColor | RgbaColor;
/** What an ink slot holds: one colour, or a colour for each appearance. */
export type InkValue = InkSide | { type: 'solid-appearance'; light: InkSide; dark: InkSide };

/** The alpha of a side: 1 for a `solid-rgb`. */
const alphaOf = (side: InkSide) => side.type === 'rgba' ? side.alpha : 1;
const solidOf = (side: InkSide): SolidColor => ({ type: 'solid-rgb', red: side.red, green: side.green, blue: side.blue });
/** The side with `color`'s channels and the alpha it had: still an `rgba` when it was one. */
const recolor = (side: InkSide, color: SolidColor): InkSide => side.type === 'rgba' ? { type: 'rgba', red: color.red, green: color.green, blue: color.blue, alpha: side.alpha } : color;
/** The side at `percent` opacity (0 to 100): an `rgba`, written even at 100 once the person has used the control. */
const withOpacity = (side: InkSide, percent: number): RgbaColor => ({ type: 'rgba', red: side.red, green: side.green, blue: side.blue, alpha: Math.round(Math.max(0, Math.min(100, percent))) / 100 });

/** The colour and the opacity of one side. */
function Side({ label, value, onChange, path }: { label: string; value: InkSide; onChange: (next: InkSide, live?: boolean) => void; path?: string }) {
  return <div className="w2-ink-side">
    <ColorField label={label} value={solidOf(value)} allowStandard={false} path={path}
      onChange={(next: ColorValue, live) => { if (next.type === 'solid-rgb') onChange(recolor(value, next), live); }}/>
    <LabeledRow label={`${label} opacity`}><TextInput number label={`${label} opacity`} value={String(Math.round(alphaOf(value) * 100))}
      onCommit={text => { const percent = Number(text); if (text.trim() !== '' && Number.isFinite(percent)) onChange(withOpacity(value, percent)); }}/><span className="w2-unit">%</span></LabeledRow>
  </div>;
}

/**
 * The colour control of a slot `sh.text-style@1` adds (a text's colour, a stack's fill, a line, a shape, a tint): the colour picker, an Opacity in
 * percent, and the switch "<Label> differs in dark mode" that makes it one colour for each appearance, each with its own opacity.
 */
export default function InkField({ label, value, onChange, path, allowPair }: { label: string; value: InkValue; onChange: (next: InkValue, live?: boolean) => void; path?: string; allowPair: boolean }) {
  if (value.type !== 'solid-appearance') {
    return <div className="w2-color-pair-field w2-ink-field" data-field-path={path}>
      <Side label={label} value={value} onChange={onChange} path={path}/>
      {allowPair && <div className="w2-row-segment w2-color-pair-switch"><Switch label={`${label} differs in dark mode`} checked={false} onChange={() => onChange({ type: 'solid-appearance', light: { ...value }, dark: { ...value } })}/></div>}
    </div>;
  }
  return <div className="w2-color-pair-field w2-color-pair w2-ink-field" role="group" aria-label={label} data-field-path={path}>
    <Side label={`${label} in light mode`} value={value.light} path={path && `${path}/light`} onChange={(next, live) => onChange({ ...value, light: next }, live)}/>
    <Side label={`${label} in dark mode`} value={value.dark} path={path && `${path}/dark`} onChange={(next, live) => onChange({ ...value, dark: next }, live)}/>
    <div className="w2-row-segment w2-color-pair-switch"><Switch label={`${label} differs in dark mode`} checked onChange={() => onChange(value.light)}/></div>
  </div>;
}
