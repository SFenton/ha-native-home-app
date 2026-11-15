import type { CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { componentLocations, moveCompositionNode, removeCompositionItem, reorderCompositionItem, replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { cloneNode } from './util';

const split = (path: EditorPath) => ({ list: path.slice(0, -1), index: Number(path.at(-1)) });

/** Moves the node one place earlier (-1) or later (1) among its siblings; unchanged at either end. */
export function moveNodeBy(document: CompositionDocument, path: EditorPath, offset: -1 | 1): CompositionDocument {
  const { list, index } = split(path);
  return reorderCompositionItem(document, list, index, offset);
}

/** Inserts a copy of the node (fresh ids) right after it. Returns the new document and the path of the copy. */
export function duplicateNode(document: CompositionDocument, path: EditorPath): { document: CompositionDocument; path: EditorPath } {
  const { list, index } = split(path);
  const siblings = valueAt(document, list) as CompositionNode[], source = siblings[index];
  const copy = { ...cloneNode(source), title: `${source.title} copy` } as CompositionNode;
  const next = [...siblings.slice(0, index + 1), copy, ...siblings.slice(index + 1)];
  return { document: replaceAt(document, list, next), path: [...list, index + 1] };
}

/** Removes the node. The compiler's reference guard applies to the pages and sheets, not to tiles, so a tile always goes. */
export function deleteNode(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const { list, index } = split(path);
  const siblings = valueAt(document, list);
  if (!Array.isArray(siblings)) throw new Error('The selected item no longer exists');
  return replaceAt(document, list, siblings.filter((_, at) => at !== index));
}

/** One place a node can be moved to. */
export interface MoveTarget { label: string; where: string; parent: { kind: 'surface' | 'grid' | 'section' | 'local-tab'; id: string; tabId?: string } }

/** The pages, sheets and containers a node can be moved into (never itself or what it holds). */
export function moveTargets(document: CompositionDocument, id: string): MoveTarget[] {
  const locations = componentLocations(document);
  const own = locations.find(item => item.node.id === id);
  const inside = (path: EditorPath) => own && path.slice(0, own.path.length).join('/') === own.path.join('/');
  const targets: MoveTarget[] = [
    ...document.pages.map(page => ({ label: page.title, where: 'Page', parent: { kind: 'surface' as const, id: page.id } })),
    ...document.modals.map(modal => ({ label: modal.title, where: 'Sheet', parent: { kind: 'surface' as const, id: modal.id } })),
  ];
  for (const { node, path } of locations) {
    if (node.id === id || inside(path)) continue;
    const surface = (path[0] === 'pages' ? document.pages : document.modals)[Number(path[1])];
    const where = surface?.title ?? '';
    if (node.type === 'tile-grid') targets.push({ label: node.title, where, parent: { kind: 'grid', id: node.id } });
    else if (node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section') targets.push({ label: node.title, where, parent: { kind: 'section', id: node.id } });
    else if (node.type === 'local-tabs') for (const tab of node.tabs) targets.push({ label: `${node.title} / ${tab.label}`, where, parent: { kind: 'local-tab', id: node.id, tabId: tab.id } });
  }
  return targets;
}

/** Moves a node to the end of another parent. */
export const moveNodeTo = (document: CompositionDocument, id: string, parent: MoveTarget['parent']) => moveCompositionNode(document, id, parent);
export { removeCompositionItem };
