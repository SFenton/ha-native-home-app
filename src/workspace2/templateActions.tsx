import { useState, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { componentUses } from '../shared/composition/components';
import { deleteComponent } from './linked';
import { templateWords as words } from './templateWords';
import { toastManager } from './toasts';
import type { Workspace2 } from './useWorkspace2';

/** The part of the workspace a template's delete reads and writes, so a test can stand in for it. */
export type TemplateDeleteHost = Pick<Workspace2, 'document' | 'templateId' | 'openTemplate' | 'usesId' | 'setUsesId'> & { studio: Pick<Workspace2['studio'], 'apply' | 'undo'>; linked: Pick<Workspace2['linked'], 'say'> };

/**
 * Deletes the template `id` in one `studio.apply`: every place becomes its own copy and the entry goes (`deleteComponent`), so one Undo restores the entry and all
 * its places. Closes the editor and the Uses level if they show it, and leaves the toast with Undo. Says why on the status line when it cannot.
 */
export function deleteTemplate(ws: TemplateDeleteHost, id: string): void {
  const document = ws.document!;
  const entry = document.componentLibrary?.find(item => item.id === id);
  if (!entry) return;
  const used = componentUses(document, id).length;
  try {
    ws.studio.apply(deleteComponent(document, id));
    if (ws.templateId === id) ws.openTemplate(undefined);
    if (ws.usesId === id) ws.setUsesId(undefined);
    toastManager.add({ title: used > 0 ? words.deletedCopies(entry.name, used) : words.deleted(entry.name), actionProps: { children: 'Undo', onClick: () => ws.studio.undo() } });
  } catch (error) { ws.linked.say(error instanceof Error ? error.message : String(error)); }
}

/**
 * Delete for a template, shared by the list's More menu and the editor, on `useLogicActions`' pattern. A used template asks first (the count, and what each
 * place becomes); an unused one goes at once, with the toast and its Undo.
 */
export function useTemplateActions(ws: Workspace2): { remove: (id: string) => void; dialog: ReactNode } {
  const [asking, setAsking] = useState<string>();
  const document = ws.document!;
  const entryOf = (id: string) => document.componentLibrary?.find(item => item.id === id);
  const entry = asking ? entryOf(asking) : undefined;
  const count = entry ? componentUses(document, entry.id).length : 0;
  const dialog = <AlertDialog.Root open={Boolean(entry)} onOpenChange={next => { if (!next) setAsking(undefined); }}>
    <AlertDialog.Portal><AlertDialog.Backdrop className="w2-backdrop"/><AlertDialog.Viewport className="w2-dialog-viewport">
      {entry && <AlertDialog.Popup className="w2-scope w2-dialog w2-dialog-s w2-linked-question" data-testid="delete-component" data-modal>
        <header className="w2-dialog-head"><AlertDialog.Title>{words.deleteTitle(entry.name)}</AlertDialog.Title></header>
        <AlertDialog.Description className="w2-dialog-text">{words.deleteText(count)}</AlertDialog.Description>
        <div className="w2-linked-actions">
          <button type="button" onClick={() => setAsking(undefined)}>{words.cancel}</button>
          <button type="button" className="w2-danger-button" onClick={() => { const id = entry.id; setAsking(undefined); deleteTemplate(ws, id); }}>{words.deleteConfirm}</button>
        </div>
      </AlertDialog.Popup>}
    </AlertDialog.Viewport></AlertDialog.Portal>
  </AlertDialog.Root>;
  return { remove: id => { if (componentUses(document, id).length > 0) setAsking(id); else deleteTemplate(ws, id); }, dialog };
}
