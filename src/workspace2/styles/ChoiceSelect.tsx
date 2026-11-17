import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/** One choice of a {@link ChoiceSelect}: a choice may be disabled, with the reason as a second line. */
export interface Choice { value: string; label: string; disabled?: boolean; note?: string; lead?: ReactNode }
/** A section of choices with an optional heading, such as "Built-In" and "Saved". */
export interface ChoiceGroup { heading?: string; choices: readonly Choice[] }

/**
 * A menu field whose choices can be disabled, grouped, and followed by a command. Used where {@link SelectMenu} is too plain: the
 * Style row (Built-In, Saved, Manage Styles…) and the Indicator row (Arc Spinner disabled, with its reason).
 */
export function ChoiceSelect({ label, value, groups, shown, onChange, disabled, describedBy }: {
  label: string; value: string; groups: readonly ChoiceGroup[]; /** The words in the field; the chosen choice's label by default. */ shown?: string; onChange: (value: string) => void; disabled?: boolean; describedBy?: string;
}) {
  const all = groups.flatMap(group => group.choices);
  return <Select.Root value={value} onValueChange={next => { if (next !== null && next !== value) onChange(String(next)); }} disabled={disabled}>
    <Select.Trigger className="w2-select" aria-label={label} aria-describedby={describedBy}>
      <Select.Value className="w2-select-text">{(current: string | null) => shown ?? all.find(choice => choice.value === current)?.label ?? ''}</Select.Value>
      <Select.Icon className="w2-select-icon"><ChevronDown size={16} aria-hidden/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="w2-positioner">
      <Select.Popup className="w2-scope w2-menu w2-select-pop"><Select.List>
        {groups.map((group, at) => <Select.Group key={group.heading ?? at}>
          {group.heading && <Select.GroupLabel className="w2-state-group-label">{group.heading}</Select.GroupLabel>}
          {group.choices.map(choice => <Select.Item key={choice.value} value={choice.value} disabled={choice.disabled} className="w2-menu-item w2-select-item w2-choice-item">
            <Select.ItemIndicator className="w2-select-check"><Check size={14} aria-hidden/></Select.ItemIndicator>
            {choice.lead}
            <span className="w2-choice-text"><Select.ItemText>{choice.label}</Select.ItemText>{choice.note && <small className="w2-choice-note">{choice.note}</small>}</span>
          </Select.Item>)}
        </Select.Group>)}
      </Select.List></Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>;
}
