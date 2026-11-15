import { useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronRight, X } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { Modal, PushStack, useNarrow, usePush } from '../kit';
import { createDraft, useDiscardPrompt, type Draft } from './draft';
import '../pickers/pickers.css';

/** The narrow properties sheet goes to full height while an editor is pushed, and back to half after (spec 5.5). */
export const SHEET_SNAP_EVENT = 'w2:sheet-snap';
const snapSheet = (to: 'full' | 'half') => window.dispatchEvent(new CustomEvent(SHEET_SNAP_EVENT, { detail: to }));

/** "Discard changes?" (the app's wording, modal-sheet item 15). */
function DiscardPrompt({ draft, onDiscard }: { draft: Draft; onDiscard: () => void }) {
  const open = useDiscardPrompt(draft);
  return <Modal open={open} onOpenChange={next => draft.prompt.set(next)} title="Discard changes?" size="s" dismissable={false}
    footer={<><button type="button" onClick={() => draft.prompt.set(false)}>Keep Editing</button><button type="button" className="w2-danger-button" onClick={() => { draft.prompt.set(false); onDiscard(); }}>Discard Changes</button></>}/>;
}

/** Props of {@link EditorRow}. */
export interface EditorRowProps {
  /** The row's label ("When tapped") and the editor's title. */
  label: string;
  /** The one-line summary the row shows trailing. */
  summary: string;
  /** The edited item's name, trailing in the dialog header. */
  itemName: string;
  document: CompositionDocument;
  /** Receives the draft's document when "Done" is chosen: one change, one undo step. */
  onApply: (document: CompositionDocument) => void;
  /** The body, given the draft it edits. */
  children: (draft: Draft) => ReactNode;
  /** The footer's leading action ("Remove Action"); it changes the draft's document and closes. */
  remove?: { label: string; run: (draft: Draft) => void };
  path?: string;
  /** Extra summary tags (a rule that hides the node shows "Hidden by Rule"). */
  tag?: ReactNode;
}

/**
 * A row that opens a modal editor (spec 5.5): a 560 px dialog when wide (nested pages push inside it with Back), and a page
 * pushed inside the open properties sheet at full height when narrow, never a second sheet. Edits work on a copy; "Done"
 * applies it as one undo step; closing with changes asks "Discard changes?".
 */
export default function EditorRow({ label, summary, itemName, document, onApply, children, remove, path, tag }: EditorRowProps) {
  const narrow = useNarrow(), push = usePush();
  const [wide, setWide] = useState<Draft>();
  const finish = (draft: Draft) => { onApply(draft.get()); };
  const start = () => {
    const draft = createDraft(document);
    if (narrow && push) {
      snapSheet('full');
      const done = () => { if (draft.dirty()) finish(draft); push.pop(); snapSheet('half'); };
      const body = <PushedEditor draft={draft} onDiscard={() => { push.pop(); snapSheet('half'); }} remove={remove ? { label: remove.label, run: () => { remove.run(draft); finish(draft); push.pop(); snapSheet('half'); } } : undefined}>{children(draft)}</PushedEditor>;
      push.push({ title: label, body, done: <button type="button" className="w2-primary w2-done" onClick={done}>Done</button>, guard: () => { const leave = draft.tryLeave(); if (leave) snapSheet('half'); return leave; } });
    } else setWide(draft);
  };
  const close = () => setWide(undefined);
  return <>
    <button type="button" className="w2-disclosure-head" data-disclosure={path} data-field-path={path} onClick={start}><span className="w2-row-label">{label}</span><span className="w2-summary">{summary}</span>{tag}<ChevronRight size={16} aria-hidden/></button>
    {wide && <Dialog.Root open onOpenChange={next => { if (!next && wide.tryLeave()) close(); }}>
      <Dialog.Portal><Dialog.Backdrop className="w2-backdrop"/><Dialog.Viewport className="w2-dialog-viewport"><Dialog.Popup className="w2-scope w2-dialog w2-dialog-m w2-editor" aria-label={label}>
        <header className="w2-dialog-head w2-editor-head">
          <Dialog.Close className="w2-icon-button" aria-label="Close"><X size={18} aria-hidden/></Dialog.Close>
          <Dialog.Title>{label}</Dialog.Title><span className="w2-editor-item">{itemName}</span>
        </header>
        <div className="w2-dialog-body w2-editor-body"><PushStack rootTitle={label} root={children(wide)}/></div>
        <footer className="w2-dialog-foot w2-editor-foot">
          {remove && <button type="button" className="w2-editor-remove" onClick={() => { remove.run(wide); finish(wide); close(); }}>{remove.label}</button>}
          <button type="button" onClick={() => { if (wide.tryLeave()) close(); }}>Cancel</button>
          <button type="button" className="w2-primary" onClick={() => { if (wide.dirty()) finish(wide); close(); }}>Done</button>
        </footer>
        <DiscardPrompt draft={wide} onDiscard={close}/>
      </Dialog.Popup></Dialog.Viewport></Dialog.Portal>
    </Dialog.Root>}
  </>;
}

/** The pushed page's content on narrow: the body, "Remove" at the foot, and the discard prompt. */
function PushedEditor({ draft, onDiscard, remove, children }: { draft: Draft; onDiscard: () => void; remove?: { label: string; run: () => void }; children: ReactNode }) {
  return <div className="w2-editor-page">{children}{remove && <button type="button" className="w2-editor-remove w2-editor-remove-narrow" onClick={remove.run}>{remove.label}</button>}<DiscardPrompt draft={draft} onDiscard={onDiscard}/></div>;
}
