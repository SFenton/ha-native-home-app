import { useOpenDraft, useStepNames } from '../editors/draft';
import type { Workspace2 } from '../useWorkspace2';

/**
 * What the top bar's Undo and Redo do (spec "Undo"): while an editor page is open they step its draft ("Undo in This Editor"); otherwise
 * they step the document, and say which edit ("Undo Only Show When on Guest Room").
 */
export function useUndo(ws: Workspace2) {
  const draft = useOpenDraft();
  const names = useStepNames(ws.document);
  if (draft) return {
    undo: () => draft.undo(), redo: () => draft.redo(), canUndo: draft.canUndo(), canRedo: draft.canRedo(), undoTitle: 'Undo in This Editor', redoTitle: 'Redo in This Editor',
  };
  return {
    undo: ws.studio.undo, redo: ws.studio.redo, canUndo: ws.studio.canUndo, canRedo: ws.studio.canRedo,
    undoTitle: names.undo ? `Undo ${names.undo}` : 'Undo', redoTitle: names.redo ? `Redo ${names.redo}` : 'Redo',
  };
}
