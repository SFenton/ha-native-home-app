import { useContext } from 'react';
import { SelectField } from '../ui';
import { SelectMenusContext } from './SelectMenu';

/** A row whose value is one of a few words, drawn as a segment filling the value column. */
export function SegmentRow<T extends string | number>({ label, path, value, choices, onPick }: { label: string; path?: string; value: T; choices: readonly { value: T; label: string; /** Why the choice cannot be picked now; it is dimmed and says so. */ unavailable?: string }[]; onPick: (value: T) => void }) {
  return <div className="w2-row-segment" data-field-path={path}><span className="w2-row-label">{label}</span>
    <div className="w2-segment-field" role="group" aria-label={label}>{choices.map(choice => <button type="button" key={String(choice.value)} aria-pressed={choice.value === value} aria-disabled={choice.unavailable ? true : undefined} title={choice.unavailable} className={choice.unavailable ? 'w2-segment-dim' : undefined} onClick={() => !choice.unavailable && choice.value !== value && onPick(choice.value)}>{choice.label}</button>)}</div>
    {choices.map(choice => choice.unavailable && choice.value !== value ? <p key={String(choice.value)} className="w2-caption" role="note">{choice.label} is not available: {choice.unavailable}</p> : null)}
  </div>;
}

/** The narrowest properties panel (px), and what a segment of it has to spare for words: the value column less a 4 px frame. */
const PANEL = 320, VALUE_COLUMN = PANEL - 132 - 16 - 4;
/** Whether every label fits a segment at the narrowest panel (13 px type is about 6.6 px a character, with 8 px either side of each word). */
export const choiceFits = (labels: readonly string[]) => labels.reduce((sum, text) => sum + text.length * 6.6 + 16, 0) <= VALUE_COLUMN;

/**
 * A choice among words. Two words, or more, that all fit the narrowest panel are a segment; otherwise a menu. Outside the workspace
 * (a bare form) it stays the plain select.
 */
export function ChoiceRow({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }) {
  const menus = useContext(SelectMenusContext);
  if (menus && options.length >= 2 && choiceFits(options.map(option => option.label)))
    return <SegmentRow label={label} value={value} choices={options} onPick={onChange}/>;
  return <SelectField label={label} value={value} options={[...options]} onChange={onChange}/>;
}
