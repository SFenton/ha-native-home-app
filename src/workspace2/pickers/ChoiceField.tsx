import { Plus } from 'lucide-react';
import { PickerRow } from './PickerField';

/** One choice in a short list: pages, sheets, tabs, local states. */
export interface Choice { id: string; label: string; detail?: string }

/**
 * A row that picks one of a short list. `create` adds the "New Page…" or "New Sheet…" row first (hidden when there is no flow
 * to start); it closes the list, runs the flow over the editor and picks what it made.
 */
export default function ChoiceField({ label, title, choices, value, onPick, create, path, empty }: {
  label: string; title?: string; choices: readonly Choice[]; value: string; onPick: (id: string) => void; create?: { label: string; run: (done: (id: string) => void) => void }; path?: string; empty?: string;
}) {
  const current = choices.find(choice => choice.id === value);
  return <PickerRow label={label} title={title ?? label} path={path} primary={current?.label ?? (value || <span className="w2-placeholder">Choose</span>)} secondary={current?.detail}>
    {close => <div className="w2-choice-list" role="listbox" aria-label={title ?? label}>
      {create && <button type="button" role="option" aria-selected={false} className="w2-choice w2-choice-create" onClick={() => { close(); create.run(onPick); }}><Plus size={16} aria-hidden/>{create.label}</button>}
      {choices.map(choice => <button type="button" role="option" key={choice.id} aria-selected={choice.id === value} className="w2-choice" data-choice={choice.id} onClick={() => { onPick(choice.id); close(); }}>
        <span className="w2-entity-text"><span className="w2-entity-name">{choice.label}</span>{choice.detail && <code className="w2-entity-id">{choice.detail}</code>}</span></button>)}
      {choices.length === 0 && !create && <p className="w2-empty">{empty ?? 'Nothing to choose.'}</p>}
    </div>}
  </PickerRow>;
}
