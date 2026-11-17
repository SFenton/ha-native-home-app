import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Plus } from 'lucide-react';
import { PickerRow } from './PickerField';
import { colorName, hexOf, presetColors, removeSavedColor, saveColor, solidOf, useSavedColors, SAVED_COLORS_LIMIT, type SolidColor } from './savedColors';

/** What a color field holds: a solid color, or (where the contract allows it) the standard one. */
export type ColorValue = SolidColor | { type: 'standard' };

/** Props of {@link ColorField}. */
export interface ColorFieldProps {
  label: string;
  value: ColorValue;
  /** Whether the field may be the standard color: "Standard" is then a choice. */
  allowStandard: boolean;
  /** Applies a color. `live` marks the system picker's drag: the caller joins those changes into one undo step. */
  onChange: (next: ColorValue, live?: boolean) => void;
  path?: string;
}

const swatchStyle = (hex: string) => ({ background: hex });

/** The system color picker: a native `<input type="color">` that applies as it is dragged (at most once a frame) and ends on `change`. */
function SystemPicker({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef(0), waiting = useRef('');
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => { if (input.current && input.current.value.toUpperCase() !== hex) input.current.value = hex; }, [hex]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const drag = () => {
      waiting.current = element.value;
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => { frame.current = 0; latest.current(waiting.current); });
    };
    const done = () => { if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; } latest.current(element.value); };
    element.addEventListener('input', drag);
    element.addEventListener('change', done);
    return () => { element.removeEventListener('input', drag); element.removeEventListener('change', done); if (frame.current) cancelAnimationFrame(frame.current); };
  }, []);
  return <label className="w2-color-custom">
    <input ref={input} type="color" className="w2-color-well" aria-label="Custom Color…" defaultValue={hex}/>
    <span className="w2-color-custom-text"><span>Custom Color…</span><small>Opens the system color picker</small></span>
    <code>{hex}</code>
  </label>;
}

type Live = Pick<ColorFieldProps, 'value' | 'allowStandard' | 'onChange'>;
/**
 * What the field holds right now. A page pushed inside the sheet is drawn once, outside the row that opened it, so it reads the
 * value and the change handler through this box instead of the props it was opened with.
 */
function liveBox(first: Live) {
  let current = first;
  const listeners = new Set<() => void>();
  return { get: () => current, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: Live) { if (next.value !== current.value || next.allowStandard !== current.allowStandard) { current = next; listeners.forEach(listener => listener()); } else current = next; } };
}

/** The panel a color field opens: presets, Saved Colors, the system picker and the buttons. */
function ColorPanel({ box }: { box: ReturnType<typeof liveBox> }) {
  const { value: held, allowStandard } = useSyncExternalStore(box.subscribe, box.get);
  // In the sheet the row that opened this page is gone while it shows, so the page keeps what it applied itself.
  const [mine, setMine] = useState<ColorValue>();
  useEffect(() => setMine(undefined), [held]);
  const value = mine ?? held;
  const onChange: Live['onChange'] = (...args) => { setMine(args[0]); box.get().onChange(...args); };
  const saved = useSavedColors();
  const hex = value.type === 'solid-rgb' ? hexOf(value) : undefined;
  const isSaved = hex !== undefined && saved.includes(hex);
  const swatch = (name: string, color: string, key = color) => <button type="button" key={key} role="radio" aria-checked={hex === color} aria-label={name} className="w2-swatch" onClick={() => onChange(solidOf(color))}>
    <span className="w2-swatch-chip" style={swatchStyle(color)}/></button>;
  return <div className="w2-color-panel">
    <h4 className="w2-color-heading" id="w2-colors-title">Colors</h4>
    <div className="w2-swatch-grid" role="radiogroup" aria-labelledby="w2-colors-title">{presetColors.map(preset => swatch(preset.name, preset.hex))}</div>
    <h4 className="w2-color-heading" id="w2-saved-title">Saved Colors</h4>
    <div className="w2-swatch-grid w2-swatch-saved" role="radiogroup" aria-labelledby="w2-saved-title">
      {saved.map(color => swatch(color, color))}
      <button type="button" className="w2-swatch w2-swatch-add" aria-label="Save current color" disabled={!hex || isSaved || saved.length >= SAVED_COLORS_LIMIT} onClick={() => hex && saveColor(hex)}><Plus size={16} aria-hidden/></button>
    </div>
    <SystemPicker hex={hex ?? '#FFFFFF'} onChange={next => onChange(solidOf(next), true)}/>
    <div className="w2-color-actions">
      {isSaved
        ? <button type="button" onClick={() => removeSavedColor(hex)}>Remove From Saved</button>
        : <button type="button" className="w2-tonal" disabled={!hex || saved.length >= SAVED_COLORS_LIMIT} onClick={() => hex && saveColor(hex)}>Save Color</button>}
      {allowStandard && <button type="button" className="w2-link-button" aria-pressed={value.type === 'standard'} onClick={() => onChange({ type: 'standard' })}>Standard</button>}
    </div>
  </div>;
}

/**
 * The one color control (pick 6A): a row with a swatch, the color's name and a chevron, opening a popover (a pushed page in the
 * sheet) of presets, Saved Colors and the system picker. Every choice applies at once. It replaces the Red, Green and Blue rows
 * wherever the contract holds a free color.
 */
export default function ColorField({ label, value, allowStandard, onChange, path }: ColorFieldProps) {
  const hex = value.type === 'solid-rgb' ? hexOf(value) : undefined;
  const box = useMemo(() => liveBox({ value, allowStandard, onChange }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { box.set({ value, allowStandard, onChange }); });
  return <PickerRow label={label} title={label} path={path} popupClassName="w2-color-pop"
    glyph={hex ? <span className="w2-swatch-chip w2-swatch-small" style={swatchStyle(hex)} aria-hidden/> : <span className="w2-swatch-chip w2-swatch-small w2-swatch-standard" aria-hidden/>}
    primary={hex ? colorName(hex) : 'Standard'}>
    {() => <ColorPanel box={box}/>}
  </PickerRow>;
}
