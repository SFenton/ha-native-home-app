import type { CompositionDocument } from '../../shared/composition/schema';
import type { SurfaceRef } from '../outline';

/** What the New Page dialog starts with. */
export interface CreatePageOptions {
  /** Where "Link from" starts: the page being edited (default), no link, or a given page or sheet. */
  from?: 'current' | 'none' | SurfaceRef;
  /** Hide "Link from": the caller makes the link itself (the action editor's "New Page…"). Implies no tile. */
  hideLink?: boolean;
  /** Move the preview to the new page (default true). */
  switchTo?: boolean;
  /** Folds one more change into the same undo step as the new page (the caller points its action or tab at it). */
  connect?: (document: CompositionDocument, pageId: string) => CompositionDocument;
}
/** What the New Sheet dialog starts with. */
export interface CreateSheetOptions {
  /** Open the new sheet presented in the preview (default true). */
  open?: boolean;
}

/** A dialog the navigation host can show. `resolve` answers the entry point's promise with the new id, or undefined when cancelled. */
export type NavigationRequest =
  | { kind: 'page'; options: CreatePageOptions; resolve: (id: string | undefined) => void }
  | { kind: 'sheet'; options: CreateSheetOptions; resolve: (id: string | undefined) => void }
  | { kind: 'tab'; resolve: (id: string | undefined) => void }
  | { kind: 'rename'; surface: SurfaceRef }
  | { kind: 'delete'; surface: SurfaceRef };

let listener: ((request: NavigationRequest) => void) | undefined;
/** Registers the one mounted host; returns its release. */
export function listenForNavigation(next: (request: NavigationRequest) => void): () => void {
  listener = next;
  return () => { if (listener === next) listener = undefined; };
}
const ask = <T extends NavigationRequest>(make: (resolve: (id: string | undefined) => void) => T): Promise<string | undefined> =>
  new Promise(resolve => { if (listener) listener(make(resolve)); else resolve(undefined); });

/**
 * Opens "New Page" and resolves to the new page's id, or undefined when cancelled. The Pages overlay's "Page" button and the
 * action editor's "New Page…" row both come here, so there is one flow (spec 5.6).
 */
export const createPage = (options: CreatePageOptions = {}) => ask(resolve => ({ kind: 'page', options, resolve }));
/** Opens "New Sheet" and resolves to the new sheet's id, or undefined when cancelled. */
export const createSheet = (options: CreateSheetOptions = {}) => ask(resolve => ({ kind: 'sheet', options, resolve }));
/** Opens "New Tab" and resolves to the new tab's id, or undefined when cancelled. */
export const createTab = () => ask(resolve => ({ kind: 'tab', resolve }));
/** Opens the rename dialog for a page or sheet. */
export const renameSurfaceDialog = (surface: SurfaceRef) => { listener?.({ kind: 'rename', surface }); };
/** Opens the delete confirmation for a page or sheet. */
export const deleteSurfaceDialog = (surface: SurfaceRef) => { listener?.({ kind: 'delete', surface }); };
