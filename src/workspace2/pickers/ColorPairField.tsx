import { Switch } from '../editors/controls';
import ColorField, { type ColorValue } from './ColorField';
import { pairOf, type SolidColor, type SolidPair } from './savedColors';

/** What a color field with a pair holds: a color, the standard one (where the contract allows it), or a color for each appearance. */
export type ColorPairValue = ColorValue | SolidPair;

/** Props of {@link ColorPairField}. */
export interface ColorPairFieldProps {
  label: string;
  value: ColorPairValue;
  /** Whether the field may be the standard color. */
  allowStandard: boolean;
  /** Whether the contract takes a `solid-appearance` here (`sh.solid-appearance@1`). Without it this is the plain color field. */
  allowPair: boolean;
  onChange: (next: ColorPairValue, live?: boolean) => void;
  path?: string;
}

/**
 * The color field with a Light and Dark pair. A single color is the existing {@link ColorField}; the switch "<Label> differs in dark mode" turns it into two
 * of them, one for each appearance, both starting at the color it had. Turning it off keeps the Light color. The Studio stays the author of both colors:
 * there is no named family to pick.
 */
export default function ColorPairField({ label, value, allowStandard, allowPair, onChange, path }: ColorPairFieldProps) {
  if (!allowPair) return <ColorField label={label} value={value as ColorValue} allowStandard={allowStandard} onChange={onChange} path={path}/>;
  if (value.type !== 'solid-appearance') {
    return <div className="w2-color-pair-field">
      <ColorField label={label} value={value} allowStandard={allowStandard} onChange={onChange} path={path}/>
      {value.type === 'solid-rgb' && <PairSwitch label={label} on={false} onChange={() => onChange(pairOf(value as SolidColor))}/>}
    </div>;
  }
  const part = (which: 'light' | 'dark') => (next: ColorValue, live?: boolean) => { if (next.type === 'solid-rgb') onChange({ ...value, [which]: next }, live); };
  return <div className="w2-color-pair-field w2-color-pair" role="group" aria-label={label} data-field-path={path}>
    <ColorField label={`${label} in light mode`} value={value.light} allowStandard={false} onChange={part('light')} path={path && `${path}/light`}/>
    <ColorField label={`${label} in dark mode`} value={value.dark} allowStandard={false} onChange={part('dark')} path={path && `${path}/dark`}/>
    <PairSwitch label={label} on onChange={() => onChange(value.light)}/>
  </div>;
}

/** The switch that makes a color a pair and back. */
function PairSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return <div className="w2-row-segment w2-color-pair-switch"><Switch label={`${label} differs in dark mode`} checked={on} onChange={onChange}/></div>;
}
