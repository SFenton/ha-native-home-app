import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronRight, X } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { Modal, PushStack, useNarrow, usePush } from '../kit';
import { createDraft, openDraft, recordStep, useDiscardPrompt, useDraftDocument, type Draft } from './draft';
import { useWorkspaceData } from '../pickers/WorkspaceData';
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
  /** Why the draft cannot be applied yet, in words; "Done" is disabled while it returns one. */
  blocked?: (document: CompositionDocument) => string | undefined;
  /** Extra summary tags (a rule that hides the node shows "Hidden by Rule"). */
  tag?: ReactNode;
  /** The page's title when it is not the label: "Only Show When" for the row "Only show when". */
  title?: string;
  /** Draws the row's face in place of the disclosure head; `start` opens the editor. */
  head?: (start: () => void) => ReactNode;
}

/** "Done" of a pushed editor: disabled, with the reason as its title, while the draft cannot be applied. */
function DoneButton({ draft, blocked, onDone }: { draft: Draft; blocked?: EditorRowProps['blocked']; onDone: () => void }) {
  const problem = blocked?.(useDraftDocument(draft));
  return <button type="button" className="w2-primary w2-done" disabled={Boolean(problem)} title={problem} onClick={onDone}>Done</button>;
}

/**
 * A row that opens an editor (spec 5.5, pick 5): a page pushed inside the open properties surface, so the simulator stays in
 * view; on a narrow window the sheet goes to full height meanwhile. Where nothing can push (outside the properties surface)
 * it is a 560 px dialog. Edits work on a copy; "Done" applies it as one undo step; leaving with changes asks "Discard changes?".
 */
export default function EditorRow({ label, summary, itemName, document, onApply, children, remove, path, tag, blocked, title = label, head }: EditorRowProps) {
  const narrow = useNarrow(), push = usePush();
  const { tried } = useWorkspaceData();
  const [wide, setWide] = useState<Draft>();
  const closeDraft = useRef<() => void>(undefined);
  /** Done is one document change, and the top bar names it. */
  const finish = (draft: Draft) => { const next = draft.get(); onApply(next); recordStep(`${title}${itemName ? ` on ${itemName}` : ''}`, document, next); };
  /** The draft is no longer the open one, and the Try Values it set end with the page (D8). */
  const release = () => { closeDraft.current?.(); closeDraft.current = undefined; tried.reset(); };
  const start = () => {
    const draft = createDraft(document);
    draft.name = `${title}${itemName ? ` on ${itemName}` : ''}`;
    closeDraft.current = openDraft(draft);
    if (push) {
      if (narrow) snapSheet('full');
      const leave = () => { release(); push.pop(); if (narrow) snapSheet('half'); };
      const done = () => { if (blocked?.(draft.get())) return; if (draft.dirty()) finish(draft); leave(); };
      const removal = remove ? { label: remove.label, run: () => { remove.run(draft); finish(draft); leave(); } } : undefined;
      const body = <PushedEditor draft={draft} inline={!narrow} onDiscard={leave} remove={removal}>{children(draft)}</PushedEditor>;
      push.push({ title, body, done: <DoneButton draft={draft} blocked={blocked} onDone={done}/>, guard: () => { const ok = draft.tryLeave(); if (ok) { release(); if (narrow) snapSheet('half'); } return ok; } });
    } else setWide(draft);
  };
  const close = () => { release(); setWide(undefined); };
  return <>
    {head ? head(start) : <button type="button" className="w2-disclosure-head" data-disclosure={path} data-field-path={path} onClick={start}><span className="w2-row-label">{label}</span><span className="w2-summary">{summary}</span>{tag}<ChevronRight size={16} aria-hidden/></button>}
    {wide && <Dialog.Root open onOpenChange={next => { if (!next && wide.tryLeave()) close(); }}>
      <Dialog.Portal><Dialog.Backdrop className="w2-backdrop"/><Dialog.Viewport className="w2-dialog-viewport"><Dialog.Popup data-modal className="w2-scope w2-dialog w2-dialog-m w2-editor" aria-label={title}>
        <header className="w2-dialog-head w2-editor-head">
          <Dialog.Close className="w2-icon-button" aria-label="Close"><X size={18} aria-hidden/></Dialog.Close>
          <Dialog.Title>{title}</Dialog.Title><span className="w2-editor-item">{itemName}</span>
        </header>
        <div className="w2-dialog-body w2-editor-body"><PushStack rootTitle={title} root={children(wide)}/></div>
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

/**
 * The pushed page's content: the body, the discard prompt, and the footer. Inside the inspector (`inline`) the footer has Cancel and
 * the remove action; in the narrow sheet only the remove action, since Back already asks before discarding.
 */
function PushedEditor({ draft, inline, onDiscard, remove, children }: { draft: Draft; inline: boolean; onDiscard: () => void; remove?: { label: string; run: () => void }; children: ReactNode }) {
  return <div className="w2-editor-page">{children}
    {inline
      ? <footer className="w2-editor-foot-inline">
        {remove && <button type="button" className="w2-editor-remove" onClick={remove.run}>{remove.label}</button>}
        <button type="button" onClick={() => { if (draft.tryLeave()) onDiscard(); }}>Cancel</button>
      </footer>
      : remove && <button type="button" className="w2-editor-remove w2-editor-remove-narrow" onClick={remove.run}>{remove.label}</button>}
    <DiscardPrompt draft={draft} onDiscard={onDiscard}/></div>;
}
