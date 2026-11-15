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
/**
 * One place a node can move to. `where` is the page or sheet it is on and `group` the same with its kind ("Home · Page"), so a list can
 * group by surface; `trail` is the containers it sits inside on that surface, outermost first, which tells two containers of the same name apart.
 */
export interface MoveTarget { label: string; where: string; group: string; trail: string[]; parent: { kind: 'surface' | 'grid' | 'section' | 'local-tab'; id: string; tabId?: string } }

/** The pages, sheets and containers a node can be moved into (never itself or what it holds). */
export function moveTargets(document: CompositionDocument, id: string): MoveTarget[] {
  const locations = componentLocations(document);
  const own = locations.find(item => item.node.id === id);
  const inside = (path: EditorPath) => own && path.slice(0, own.path.length).join('/') === own.path.join('/');
  const targets: MoveTarget[] = [
    ...document.pages.map(page => ({ label: 'The page itself', where: page.title, group: `${page.title} · Page`, trail: [], parent: { kind: 'surface' as const, id: page.id } })),
    ...document.modals.map(modal => ({ label: 'The sheet itself', where: modal.title, group: `${modal.title} · Sheet`, trail: [], parent: { kind: 'surface' as const, id: modal.id } })),
  ];
  for (const { node, path } of locations) {
    if (node.id === id || inside(path)) continue;
    const surface = (path[0] === 'pages' ? document.pages : document.modals)[Number(path[1])];
    const where = surface?.title ?? '', group = `${where} · ${path[0] === 'pages' ? 'Page' : 'Sheet'}`;
    const trail = locations.filter(other => other.node.id !== node.id && path.length > other.path.length && path.slice(0, other.path.length).join('/') === other.path.join('/'))
      .sort((a, b) => a.path.length - b.path.length).map(other => other.node.title);
    if (node.type === 'tile-grid') targets.push({ label: node.title, where, group, trail, parent: { kind: 'grid', id: node.id } });
    else if (node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section') targets.push({ label: node.title, where, group, trail, parent: { kind: 'section', id: node.id } });
    else if (node.type === 'local-tabs') for (const tab of node.tabs) targets.push({ label: `${node.title} / ${tab.label}`, where, group, trail, parent: { kind: 'local-tab', id: node.id, tabId: tab.id } });
  }
  // Containers that share a name, a surface and the same parents (siblings named alike) are numbered, so no two rows read the same.
  const place = (target: MoveTarget) => `${target.group}|${target.trail.join('>')}|${target.label}`;
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const target of targets) total.set(place(target), (total.get(place(target)) ?? 0) + 1);
  return targets.map(target => {
    if ((total.get(place(target)) ?? 0) < 2) return target;
    const number = (seen.get(place(target)) ?? 0) + 1;
    seen.set(place(target), number);
    return { ...target, label: `${target.label} (${number})` };
  });
}

/** Moves a node to the end of another parent. */
export const moveNodeTo = (document: CompositionDocument, id: string, parent: MoveTarget['parent']) => moveCompositionNode(document, id, parent);
export { removeCompositionItem };

/** The targets whose name, page or containers contain every word of `query`. An empty query keeps them all. */
export function filterMoveTargets(targets: readonly MoveTarget[], query: string): MoveTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...targets];
  return targets.filter(target => { const text = [target.label, target.group, ...target.trail].join(' ').toLowerCase(); return words.every(word => text.includes(word)); });
}

/** The targets in groups, one per page or sheet, in document order. */
export function groupMoveTargets(targets: readonly MoveTarget[]): { group: string; targets: MoveTarget[] }[] {
  const groups = new Map<string, MoveTarget[]>();
  for (const target of targets) groups.set(target.group, [...groups.get(target.group) ?? [], target]);
  return [...groups].map(([group, list]) => ({ group, targets: list }));
}
