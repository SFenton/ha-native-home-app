import { useState, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import type { Workspace2 } from '../../useWorkspace2';
import { toastManager } from '../../toasts';
import { deleteEntry, duplicateEntry, entryOf, useCount } from './logicModel';
import { logicWords } from './logicWords';

/** Focuses the Name field of the open logic template, once the editor is on screen. */
export function focusLogicName(): void {
  const find = (tries: number) => { const input = document.querySelector<HTMLInputElement>('[data-testid="logic-name"] input'); if (input) { input.focus(); input.select(); } else if (tries > 0) setTimeout(() => find(tries - 1), 30); };
  find(20);
}

/** What the Data panel's row menu and the editor's Delete share: delete (with its question when the template is used), duplicate, rename, and the dialog. */
export function useLogicActions(ws: Workspace2, onError: (message: string) => void): {
  remove: (id: string) => void; duplicate: (id: string) => void; rename: (id: string) => void; dialog: ReactNode;
} {
  const [asking, setAsking] = useState<string>();
  const document = ws.document!;
  const run = (operation: () => void) => { try { operation(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const finish = (id: string) => run(() => {
    const entry = entryOf(document, id);
    if (!entry) return;
    const used = useCount(document, id);
    ws.studio.apply(deleteEntry(document, id));
    if (ws.logicId === id) ws.openLogic(undefined);
    toastManager.add({ title: used > 0 ? logicWords.deletedUnlinked(entry.name) : logicWords.deleted(entry.name) });
  });
  const entry = asking ? entryOf(document, asking) : undefined;
  const dialog = <AlertDialog.Root open={Boolean(entry)} onOpenChange={next => { if (!next) setAsking(undefined); }}>
    <AlertDialog.Portal><AlertDialog.Backdrop className="w2-backdrop"/><AlertDialog.Viewport className="w2-dialog-viewport">
      {entry && <AlertDialog.Popup className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="logic-question" data-modal>
        <header className="w2-dialog-head"><AlertDialog.Title>{logicWords.deleteTitle(entry.name)}</AlertDialog.Title></header>
        <AlertDialog.Description className="w2-dialog-text">{logicWords.deleteText(useCount(document, entry.id))}</AlertDialog.Description>
        <div className="w2-linked-actions">
          <button type="button" onClick={() => setAsking(undefined)}>{logicWords.cancel}</button>
          <button type="button" className="w2-danger-button" onClick={() => { const id = entry.id; setAsking(undefined); finish(id); }}>{logicWords.deleteConfirm}</button>
        </div>
      </AlertDialog.Popup>}
    </AlertDialog.Viewport></AlertDialog.Portal>
  </AlertDialog.Root>;
  return {
    remove: id => { if (useCount(document, id) > 0) setAsking(id); else finish(id); },
    duplicate: id => run(() => { const made = duplicateEntry(document, id); ws.studio.apply(made.document); ws.openLogic(made.id); }),
    rename: id => { ws.openLogic(id); focusLogicName(); },
    dialog,
  };
}
