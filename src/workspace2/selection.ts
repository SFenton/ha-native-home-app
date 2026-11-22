import type { DocumentIndex, SelectionKey } from '../preview2/model';
import type { NavSurface } from '../preview2/navigation';
import type { CompositionDocument } from '../shared/composition/schema';
import { levelOwners, type SurfaceRef } from './outline';

/**
 * The selection that survives a change to the document: the same key while the index still holds it, nothing once the
 * change (an Undo that removes the node, a Redo that deletes it) took it away. Undo and Redo therefore keep the
 * properties sheet open on the same selection and close it only when that selection is gone.
 */
export function survivingSelection(selection: SelectionKey | undefined, index: DocumentIndex | undefined): SelectionKey | undefined {
  if (!selection || !index) return selection;
  return index.get(selection) ? selection : undefined;
}

/**
 * The surface that is still there: the same page, sheet or level while the document holds it. A level that a change removed (its add undone, it deleted)
 * falls back to the sheet it was shown in when that sheet is left; anything else that is gone is nothing, and the caller shows the first page.
 */
export function survivingSurface(surface: NavSurface | undefined, document: CompositionDocument): NavSurface | undefined {
  if (!surface) return undefined;
  if (surface.kind !== 'level') return (surface.kind === 'page' ? document.pages : document.modals).some(item => item.id === surface.id) ? surface : undefined;
  if (document.levels?.some(item => item.id === surface.id)) return surface;
  return surface.sheetId !== undefined && document.modals.some(item => item.id === surface.sheetId) ? { kind: 'modal', id: surface.sheetId } : undefined;
}

/**
 * The sheet a level is shown in when the Studio goes to it: the sheet already open (`held` is that sheet, or a level inside it) when it reaches the level,
 * else the sheet {@link listedSurface} finds, the first in document order. Undefined when no sheet reaches the level.
 */
export function sheetForLevel(held: NavSurface | undefined, document: CompositionDocument, levelId: string): string | undefined {
  const open = held?.kind === 'modal' ? held.id : held?.kind === 'level' ? held.sheetId : undefined;
  if (open !== undefined && levelOwners(document).reach.get(open)?.has(levelId)) return open;
  return listedSurface({ kind: 'level', id: levelId }, document)?.id;
}

/**
 * The page or sheet a surface stands for in the panels that list pages and sheets: the page or sheet itself, or for a level the sheet it is shown in
 * (the one named, else the one that opens it). A level no sheet opens stands for nothing.
 */
export function listedSurface(surface: NavSurface | undefined, document: CompositionDocument): SurfaceRef | undefined {
  if (!surface) return undefined;
  if (surface.kind !== 'level') return surface;
  if (surface.sheetId !== undefined && document.modals.some(item => item.id === surface.sheetId)) return { kind: 'modal', id: surface.sheetId };
  const owners = levelOwners(document);
  const sheetId = [...owners.reach].find(([, levels]) => levels.has(surface.id))?.[0];
  return sheetId === undefined ? undefined : { kind: 'modal', id: sheetId };
}
