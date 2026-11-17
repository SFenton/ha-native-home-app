import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { StatePreview } from '../../preview2/render-context';
import type { StateClass } from '../../shared/composition/state-styles';
import { classWord, phaseWords, stateName, type StateEntry } from './words';

/** The dot before a state's name: its class in colour, and in shape for people who cannot tell the colours apart. */
export function ClassDot({ stateClass }: { stateClass: StateClass }) {
  return <span className="w2-class-dot" data-class={stateClass} aria-hidden/>;
}

const keyOf = (preview: Pick<StatePreview, 'state' | 'phase'>) => preview.phase ? `phase:${preview.phase}` : `state:${preview.state}`;

/**
 * "Show state": a menu of a style's states, each with its class dot and class word and "Edited" where this tile overrides it. A
 * second section, "After a tap", lists Sending and Didn't Respond when the style has a tap. It is a choice of what the simulator
 * draws and writes nothing.
 */
export function StateMenu({ label = 'Show state', entries, value, edited, afterTap, onPick }: {
  label?: string; entries: readonly StateEntry[]; value: Pick<StatePreview, 'state' | 'phase'>; edited?: ReadonlySet<string>; afterTap: boolean; onPick: (next: { state: string; phase?: 'sending' | 'failed' }) => void;
}) {
  const current = keyOf(value);
  const choose = (next: string | null) => {
    if (next === null || next === current) return;
    const [kind, rest] = [next.slice(0, next.indexOf(':')), next.slice(next.indexOf(':') + 1)];
    onPick(kind === 'phase' ? { state: value.state, phase: rest as 'sending' | 'failed' } : { state: rest });
  };
  const shown = value.phase ? phaseWords[value.phase] : stateName(value.state);
  return <Select.Root value={current} onValueChange={choose}>
    <Select.Trigger className="w2-select" aria-label={label}>
      <Select.Value className="w2-select-text">{() => shown}</Select.Value>
      <Select.Icon className="w2-select-icon"><ChevronDown size={16} aria-hidden/></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="w2-positioner">
      <Select.Popup className="w2-scope w2-menu w2-select-pop w2-state-pop"><Select.List>
        <Select.Group>
          {entries.map(entry => <Select.Item key={entry.state} value={`state:${entry.state}`} className="w2-menu-item w2-select-item w2-state-item">
            <Select.ItemIndicator className="w2-select-check"><Check size={14} aria-hidden/></Select.ItemIndicator>
            <ClassDot stateClass={entry.state === 'unavailable' || entry.state === 'unknown' ? 'unknown' : entry.rule.class}/>
            <Select.ItemText>{stateName(entry.state)}</Select.ItemText>
            <span className="w2-state-class">{classWord[entry.state === 'unavailable' || entry.state === 'unknown' ? 'unknown' : entry.rule.class]}</span>
            {edited?.has(entry.state) && <span className="w2-state-edited">Edited</span>}
          </Select.Item>)}
        </Select.Group>
        {afterTap && <Select.Group>
          <Select.GroupLabel className="w2-state-group-label">After a tap</Select.GroupLabel>
          {(['sending', 'failed'] as const).map(phase => <Select.Item key={phase} value={`phase:${phase}`} className="w2-menu-item w2-select-item w2-state-item">
            <Select.ItemIndicator className="w2-select-check"><Check size={14} aria-hidden/></Select.ItemIndicator>
            <ClassDot stateClass={phase === 'sending' ? 'in-progress' : 'error'}/>
            <Select.ItemText>{phaseWords[phase]}</Select.ItemText>
            <span className="w2-state-class">{classWord[phase === 'sending' ? 'in-progress' : 'error']}</span>
          </Select.Item>)}
        </Select.Group>}
      </Select.List></Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>;
}
