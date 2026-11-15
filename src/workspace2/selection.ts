import type { DocumentIndex, SelectionKey } from '../preview2/model';

/**
 * The selection that survives a change to the document: the same key while the index still holds it, nothing once the
 * change (an Undo that removes the node, a Redo that deletes it) took it away. Undo and Redo therefore keep the
 * properties sheet open on the same selection and close it only when that selection is gone.
 */
export function survivingSelection(selection: SelectionKey | undefined, index: DocumentIndex | undefined): SelectionKey | undefined {
  if (!selection || !index) return selection;
  return index.get(selection) ? selection : undefined;
}
