import type { CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { componentLocations, moveCompositionNode, removeCompositionItem, reorderCompositionItem, replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { cloneNode } from './util';
import { nodeTitle } from '../shared/composition/components';
import { createId } from '../shared/ids';
import { omitFoldSide } from '../shared/composition/fold-sides';
import { editSubtrees } from './editors/provenance';

const split = (path: EditorPath) => ({ list: path.slice(0, -1), index: Number(path.at(-1)) });

/** Moves the node one place earlier (-1) or later (1) among its siblings; unchanged at either end. */
export function moveNodeBy(document: CompositionDocument, path: EditorPath, offset: -1 | 1): CompositionDocument {
  const { list, index } = split(path);
  return editSubtrees(document, reorderCompositionItem(document, list, index, offset));
}

/** Inserts a copy of the node (fresh ids) right after it. Returns the new document and the path of the copy. */
export function duplicateNode(document: CompositionDocument, path: EditorPath): { document: CompositionDocument; path: EditorPath } {
  const { list, index } = split(path);
  const siblings = valueAt(document, list) as CompositionNode[], source = siblings[index];
  // A place that uses a saved component has no title of its own: the copy is another place, linked to the same component.
  const copy = (source.type === 'component-ref' ? cloneNode(source) : { ...cloneNode(source), title: `${source.title} copy` }) as CompositionNode;
  const next = [...siblings.slice(0, index + 1), copy, ...siblings.slice(index + 1)];
  const to = [...list, index + 1];
  return { document: editSubtrees(document, replaceAt(document, list, next), { copied: [{ from: path, to }] }), path: to };
}

/** Removes the node. The compiler's reference guard applies to the pages and sheets, not to tiles, so a tile always goes. */
export function deleteNode(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const { list, index } = split(path);
  const siblings = valueAt(document, list);
  if (!Array.isArray(siblings)) throw new Error('The selected item no longer exists');
  return editSubtrees(document, replaceAt(document, list, siblings.filter((_, at) => at !== index)), { deleted: [path] });
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
    ...(document.levels ?? []).map(level => ({ label: 'The level itself', where: level.title, group: `${level.title} · Level`, trail: [], parent: { kind: 'surface' as const, id: level.id } })),
  ];
  for (const { node, path } of locations) {
    if (node.id === id || inside(path)) continue;
    const surface = (path[0] === 'pages' ? document.pages : path[0] === 'levels' ? document.levels ?? [] : document.modals)[Number(path[1])];
    const where = surface?.title ?? '', group = `${where} · ${path[0] === 'pages' ? 'Page' : path[0] === 'levels' ? 'Level' : 'Sheet'}`;
    const trail = locations.filter(other => other.node.id !== node.id && path.length > other.path.length && path.slice(0, other.path.length).join('/') === other.path.join('/'))
      .sort((a, b) => a.path.length - b.path.length).map(other => nodeTitle(other.node, document));
    if (node.type === 'tile-grid') targets.push({ label: node.title, where, group, trail, parent: { kind: 'grid', id: node.id } });
    else if (node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section' || node.type === 'stack' || node.type === 'repeat') targets.push({ label: node.title, where, group, trail, parent: { kind: 'section', id: node.id } });
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
export function moveNodeTo(document: CompositionDocument, id: string, parent: MoveTarget['parent']): CompositionDocument {
  const moved = moveCompositionNode(document, id, parent);
  const source = componentLocations(document, true).find(location => location.node.id === id);
  return editSubtrees(document, { ...document, pages: moved.pages, modals: moved.modals,
    ...(document.levels ? { levels: moved.levels } : {}),
    ...(source?.path[0] === 'componentLibrary' ? { componentLibrary: moved.componentLibrary } : {}),
  });
}
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

// MARK: Overlay commands

/** The insets an overlay child can sit at, in points (the Inset pop-up of the Position group). */
export const overlayInsets: readonly { value: number; label: string }[] = [
  { value: 0, label: 'None' }, { value: 4, label: 'Extra Small · 4' }, { value: 8, label: 'Small · 8' },
  { value: 12, label: 'Medium · 12' }, { value: 16, label: 'Large · 16' }, { value: 24, label: 'Extra Large · 24' },
];

/** Wraps a Map or tile in an Overlay as its base (one document change, so one undo step); the new overlay keeps the node's place. */
export function putControlsOnTop(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const { list, index } = split(path);
  const siblings = valueAt(document, list) as CompositionNode[], base = siblings[index];
  // The overlay takes the node's place on the page, so it takes the node's side of the hinge too (`sh.fold-sides@1`); the base inside holds none.
  const side = (base.layout as { foldSide?: string }).foldSide;
  const overlay = { id: createId('overlay'), title: 'Overlay', type: 'overlay', layout: side === undefined ? {} : { foldSide: side }, props: { anchors: [] }, children: [{ ...base, layout: omitFoldSide(base.layout) }] } as unknown as CompositionNode;
  return editSubtrees(document, replaceAt(document, list, siblings.map((item, at) => at === index ? overlay : item)));
}

/** Takes the overlay off: its base takes its place and the controls on top are removed. */
export function takeOffOverlay(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const { list, index } = split(path);
  const siblings = valueAt(document, list) as CompositionNode[], overlay = siblings[index];
  if (overlay.type !== 'overlay' || overlay.children.length === 0) throw new Error('The selected item is not an overlay with a base');
  return editSubtrees(document, replaceAt(document, list, siblings.map((item, at) => {
    if (at !== index) return item;
    // The base takes the overlay's place, and its side of the hinge with it.
    const side = (overlay.layout as { foldSide?: string }).foldSide;
    return side === undefined ? overlay.children[0] : { ...overlay.children[0], layout: { ...overlay.children[0].layout, foldSide: side } } as CompositionNode;
  })), { deleted: [path] });
}

/** Puts the control at one of the five places of its overlay, keeping its inset (Medium, 12, when it has none yet). */
export function setOverlayPosition(document: CompositionDocument, overlayPath: EditorPath, childId: string, anchor: string, inset?: number): CompositionDocument {
  const overlay = valueAt(document, overlayPath) as { children: { id: string }[]; props: { anchors: { childId: string; anchor: string; inset: { type: string; value?: number } }[] } };
  const kept = overlay.props.anchors.find(item => item.childId === childId);
  const points = inset ?? (kept?.inset.type === 'points' ? kept.inset.value : undefined) ?? 12;
  const next = overlay.children.slice(1).flatMap(child => child.id === childId
    ? [{ childId, anchor, inset: { type: 'points', value: points } }]
    : overlay.props.anchors.filter(item => item.childId === child.id));
  return replaceAt(document, [...overlayPath, 'props', 'anchors'], next);
}
