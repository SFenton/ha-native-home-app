import { Plus } from 'lucide-react';
import { PickerRow } from './PickerField';

/** One choice in a short list: pages, sheets, tabs, local states. */
export interface Choice { id: string; label: string; detail?: string; /** A heading the choice sits under: choices with one are listed in groups, in order of first appearance. */ group?: string }

/**
 * A row that picks one of a short list. `create` adds the "New Page…" or "New Sheet…" row first (hidden when there is no flow
 * to start); it closes the list, runs the flow over the editor and picks what it made. Choices with a `group` are listed under that heading, in groups.
 */
export default function ChoiceField({ label, title, choices, value, onPick, create, creates, path, empty }: {
  label: string; title?: string; choices: readonly Choice[]; value: string; onPick: (id: string) => void; create?: { label: string; run: (done: (id: string) => void) => void }; /** More than one creation row ("New Page…", "New Sheet…"). */ creates?: readonly { label: string; run: (done: (id: string) => void) => void }[]; path?: string; empty?: string;
}) {
  const current = choices.find(choice => choice.id === value);
  const make = [...(create ? [create] : []), ...(creates ?? [])];
  const groups = [...new Set(choices.map(choice => choice.group).filter((group): group is string => group !== undefined))];
  const option = (choice: Choice, close: () => void) => <button type="button" role="option" key={choice.id} aria-selected={choice.id === value} className="w2-choice" data-choice={choice.id} onClick={() => { onPick(choice.id); close(); }}>
    <span className="w2-entity-text"><span className="w2-entity-name">{choice.label}</span>{choice.detail && <code className="w2-entity-id">{choice.detail}</code>}</span></button>;
  return <PickerRow label={label} title={title ?? label} path={path} primary={current?.label ?? (value || <span className="w2-placeholder">Choose</span>)} secondary={current?.detail}>
    {close => <div className="w2-choice-list" role="listbox" aria-label={title ?? label}>
      {make.map(item => <button type="button" role="option" key={item.label} aria-selected={false} className="w2-choice w2-choice-create" onClick={() => { close(); item.run(onPick); }}><Plus size={16} aria-hidden/>{item.label}</button>)}
      {groups.length === 0 ? choices.map(choice => option(choice, close))
        : groups.map(group => <div key={group} role="group" aria-label={group} className="w2-choice-group"><div className="w2-choice-heading" aria-hidden="true">{group}</div>{choices.filter(choice => choice.group === group).map(choice => option(choice, close))}</div>)}
      {choices.length === 0 && make.length === 0 && <p className="w2-empty">{empty ?? 'Nothing to choose.'}</p>}
    </div>}
  </PickerRow>;
}
