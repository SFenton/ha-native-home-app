import { childLists, mapChildren } from './components';
import { omitFoldSide } from './fold-sides';
import type { CompositionDocument, CompositionNode } from './schema';

const hasSide = (node: CompositionNode): boolean => 'foldSide' in (node.layout as object);

/** Whether `node` or anything under it holds a `foldSide` (no allocation, so the common edit pays a walk and nothing more). */
function holdsSide(node: CompositionNode, top: boolean): boolean {
  if (!top && hasSide(node)) return true;
  return childLists(node).some(list => list.nodes.some(child => holdsSide(child, false)));
}

/** `node` with every `foldSide` below the top level removed; the same object when there is none. */
function clean(node: CompositionNode, top: boolean): CompositionNode {
  if (!holdsSide(node, top)) return node;
  const inner = mapChildren(node, child => clean(child, false));
  return !top && hasSide(inner) ? { ...inner, layout: omitFoldSide(inner.layout) } as CompositionNode : inner;
}

/**
 * The one rule behind every edit (`sh.fold-sides@1`): a component takes a side of the hinge only at the top level of a page, so a node anywhere else (inside a section or
 * an overlay, on a sheet, the root or inside of a template body) holds none. Studio runs every change through this before it is applied, so an edit that wraps, moves,
 * copies or nests a node cannot leave a side where the compiler refuses it. The same document when nothing needs removing; untouched parts keep their identity.
 */
export function normaliseFoldSides(document: CompositionDocument): CompositionDocument {
  let changed = false;
  const list = (nodes: CompositionNode[], top: boolean): CompositionNode[] => {
    const next = nodes.map(node => clean(node, top));
    if (next.some((node, at) => node !== nodes[at])) { changed = true; return next; }
    return nodes;
  };
  const pages = document.pages.map(page => { const components = list(page.components, true); return components === page.components ? page : { ...page, components }; });
  const modals = document.modals.map(modal => { const components = list(modal.components, false); return components === modal.components ? modal : { ...modal, components }; });
  const library = document.componentLibrary?.map(entry => { const node = clean(entry.node, false); if (node !== entry.node) changed = true; return node === entry.node ? entry : { ...entry, node }; });
  return changed ? { ...document, pages, modals, ...(library ? { componentLibrary: library } : {}) } : document;
}
