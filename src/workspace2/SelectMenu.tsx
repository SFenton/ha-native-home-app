import { createContext } from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';

/** Whether menu fields draw as {@link SelectMenu}: true inside the workspace, false in a bare form. */
export const SelectMenusContext = createContext(false);

/** One choice of a {@link SelectMenu}. */
export interface SelectChoice { value: string; label: string }

/**
 * The Studio's one menu field: a filled field with a chevron, its words ending in an ellipsis before the chevron, opening a
 * menu drawn by the Studio, never the browser's (Studio spec "Rule 1"). Used wherever a row picks one of several words.
 */
export function SelectMenu({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly (string | SelectChoice)[]; onChange: (value: string) => void; disabled?: boolean }) {
  const choices: SelectChoice[] = options.map(option => typeof option === 'string' ? { value: option, label: option } : option);
  return <Select.Root items={choices} value={value} onValueChange={next => { if (next !== null && next !== value) onChange(String(next)); }} disabled={disabled}>
    <Select.Trigger className="w2-select" aria-label={label}>
      <Select.Value className="w2-select-text">{(current: string | null) => choices.find(choice => choice.value === current)?.label ?? ''}</Select.Value>
      <Select.Icon className="w2-select-icon"><ChevronDown size={16} aria-hidden/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="w2-positioner">
      <Select.Popup className="w2-scope w2-menu w2-select-pop"><Select.List>
        {choices.map(choice => <Select.Item key={choice.value} value={choice.value} className="w2-menu-item w2-select-item">
          <Select.ItemIndicator className="w2-select-check"><Check size={14} aria-hidden/></Select.ItemIndicator>
          <Select.ItemText>{choice.label}</Select.ItemText>
        </Select.Item>)}
      </Select.List></Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>;
}
