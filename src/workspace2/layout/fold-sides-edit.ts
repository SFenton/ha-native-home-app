import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { holdsSlot, foldSideLabels, isTopLevelPageComponent, type FoldSide } from '../../shared/composition/fold-sides';
import { libraryById } from '../../shared/composition/components';
import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { planFoldSides } from '../../preview2/fold-sides-plan';
import { duoWindow, hingeAxisOf, poseOfWindow, type PreviewWindow } from '../../preview2';
import { postureOf } from '../simulator';
import { pendingCompositionCapabilities } from '../../shared/composition/pending';

/** Whether the app has shipped `sh.fold-sides@1`: it is no longer in the Studio's pending list. Until then a publication that declares it is refused by the app, so nothing turns it on by itself. */
export const foldSidesShipped = (): boolean => !pendingCompositionCapabilities.includes('sh.fold-sides@1');

/**
 * The edits behind the Partly Folded rows (`sh.fold-sides@1`): which side a top-level section takes and what "Automatic" means for it, the page switch, Reset Sides and
 * "Use two sides on every page". Each returns a whole document, so the caller applies it once and one undo step undoes it.
 */

type Page = CompositionDocument['pages'][number];

/** Whether `path` is a component at the top level of a page: the only place a side means anything. */
export { isTopLevelPageComponent };

/** The words a side reads as in a row. */
export const sideWords = foldSideLabels;

/** What Automatic gives the component at `path`: its side with its own word left out, by the one rule (`resolveFoldSides`). Undefined when the component holds no slot (a floating bar) or its page would stay one column. */
export function automaticSideAt(document: CompositionDocument, path: EditorPath): FoldSide | undefined {
  if (!isTopLevelPageComponent(path)) return undefined;
  const page = document.pages[path[1] as number], at = path[3] as number;
  const node = page?.components[at];
  if (!node || !holdsSlot(node)) return undefined;
  const { foldSide: _said, ...layout } = node.layout as { span?: number; foldSide?: FoldSide }; void _said;
  const components = page.components.map((item, index) => index === at ? { ...item, layout } as CompositionNode : item);
  const plan = planFoldSides({ layout: page.layout, components }, libraryById(document));
  // A page that would stay one column has no side to name.
  return plan.active ? plan.sides.get(node.id) : undefined;
}

/** The document with the component at `path` pinned to `side`, or back to Automatic when `side` is undefined. */
export function setFoldSide(document: CompositionDocument, path: EditorPath, side: FoldSide | undefined): CompositionDocument {
  const layout = valueAt(document, [...path, 'layout']) as { span?: number; foldSide?: FoldSide } | undefined;
  if (!layout) return document;
  const { foldSide: _gone, ...rest } = layout; void _gone;
  return replaceAt(document, [...path, 'layout'], side === undefined ? rest : { ...rest, foldSide: side });
}

/** The page's layout with the switch on (`foldSides: 'auto'`) or off (the field gone). */
export function setPageSides(document: CompositionDocument, pagePath: EditorPath, on: boolean): CompositionDocument {
  const layout = valueAt(document, [...pagePath, 'layout']) as Page['layout'] | undefined;
  if (!layout) return document;
  const { foldSides: _gone, ...rest } = layout; void _gone;
  return replaceAt(document, [...pagePath, 'layout'], on ? { ...rest, foldSides: 'auto' } : rest);
}

/** How many top-level components of the page are pinned to a side (any word). */
export const overrideCount = (page: Page): number => page.components.filter(node => (node.layout as { foldSide?: FoldSide }).foldSide !== undefined).length;

/** Reset Sides: every top-level component of the page back to Automatic; the page switch stays. One document, so one undo step. */
export function resetSides(document: CompositionDocument, pagePath: EditorPath): CompositionDocument {
  const page = valueAt(document, pagePath) as Page | undefined;
  if (!page || overrideCount(page) === 0) return document;
  const components = page.components.map(node => {
    const { foldSide: _gone, ...layout } = node.layout as { span?: number; foldSide?: FoldSide }; void _gone;
    return (node.layout as { foldSide?: FoldSide }).foldSide === undefined ? node : { ...node, layout } as CompositionNode;
  });
  return replaceAt(document, [...pagePath, 'components'], components);
}

/** The pages that do not use two sides yet. */
export const pagesWithoutSides = (document: CompositionDocument): number[] => document.pages.flatMap((page, index) => page.layout.foldSides === 'auto' ? [] : [index]);

/** "Use two sides on every page": the switch on for every page that lacks it, in one document. */
export function twoSidesOnEveryPage(document: CompositionDocument): CompositionDocument {
  return pagesWithoutSides(document).reduce((next, index) => setPageSides(next, ['pages', index], true), document);
}

/** Whether the simulator already shows a vertical hinge partly folded, where sides apply. */
export const showsPartlyFolded = (win: PreviewWindow): boolean => postureOf(win) === 'partly' && win.hinge?.axis === 'vertical';

/**
 * The window "Show Partly Folded" moves the simulator to: the Duo partly folded with a vertical hinge. A Duo keeps its turn when that already gives a vertical hinge (and the
 * fold changes on the cover's swing or the halves' tilt, as the rail does); another device, or a turn with a horizontal hinge, becomes the Duo at turn 0.
 */
export function partlyFoldedWindow(win: PreviewWindow): PreviewWindow {
  const pose = poseOfWindow(win);
  return duoWindow({ turn: pose && hingeAxisOf(pose.turn) === 'vertical' ? pose.turn : 0, fold: 'partly' });
}
