import { createContext, useContext } from 'react';
import type { NavSurface } from '../../preview2/navigation';
import type { CompositionDocument } from '../../shared/composition/schema';

/**
 * Moves keyboard focus to the surface the simulator now shows, once it is drawn: the editor that held focus has closed, and focus would otherwise fall to the page body.
 * The surface takes focus as a landing point only (`tabindex=-1`), so it is not a tab stop.
 */
export function focusShownSurface(root: ParentNode = document, tries = 5): void {
  const surface = [...root.querySelectorAll<HTMLElement>('[data-preview-root] .sh-sheet')].at(-1) ?? root.querySelector<HTMLElement>('[data-preview-root] .sh-page[data-current]');
  if (surface) { if (!surface.hasAttribute('tabindex')) surface.tabIndex = -1; surface.focus({ preventScroll: true }); return; }
  if (tries > 0) requestAnimationFrame(() => focusShownSurface(root, tries - 1));
}

/** What an editor can ask of the simulator: the surface on show, and a way to show another with nothing selected. Absent outside the workspace. */
export interface SurfaceActions { current?: NavSurface; show(surface: NavSurface): void }
/** Provided by the workspace's field host, which holds the workspace. */
export const SurfaceActionsContext = createContext<SurfaceActions | undefined>(undefined);
/** The simulator actions an editor may use. */
export const useSurfaceActions = () => useContext(SurfaceActionsContext);

/** Applies the open editor's draft as Done does (one Undo step), closes it, then runs `then`. Absent outside an editor. */
export type FinishEditor = (then?: () => void) => void;
/** The open editor's Done, and the check that says why Done is unavailable for a draft's document (the words `blocked` answers), when it is. */
export interface EditorFinish { run: FinishEditor; blocked?: (document: CompositionDocument) => string | undefined }
/** Provided by `EditorRow` around the body it draws. */
export const FinishEditorContext = createContext<EditorFinish | undefined>(undefined);
/** The open editor's Done, for a control inside it that must apply the draft before it acts. */
export const useFinishEditor = () => useContext(FinishEditorContext);
