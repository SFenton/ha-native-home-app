import type { CompositionDocument } from '../../shared/composition/schema';
import { replaceAt, type EditorPath } from '../../composition-editor';
import type { DocumentIndex, SelectionKey } from '../../preview2/model';
import { createId } from '../../shared/ids';
import { addArea, areasOf, areasToNode, removeArea, type Area, type TabsNode } from '../../shared/composition/layout-blocks';
import { cloneNode } from '../util';
import { editSubtrees } from '../editors/provenance';

/** An area found in the document: its container, where the container is, and the area's id (the tab's id in the shipped shape). */
export interface AreaAt { node: TabsNode; path: EditorPath; areaId: string; areas: Area[]; position: number }

/** The area a `local-tab` key names, with its container; undefined for any other key. */
export function areaAt(document: CompositionDocument, index: DocumentIndex, key: SelectionKey): AreaAt | undefined {
  const entry = index.get(key);
  const parent = entry?.kind === 'local-tab' && entry.parent ? index.get(entry.parent) : undefined;
  if (!entry || !parent?.node || parent.node.type !== 'local-tabs') return undefined;
  const node = parent.node as TabsNode, areaId = key.split('/').at(-1) ?? '';
  const areas = areasOf(node);
  const position = areas.findIndex(area => area.id === areaId);
  return position < 0 ? undefined : { node, path: parent.path, areaId, areas, position };
}

const set = (document: CompositionDocument, at: AreaAt, node: TabsNode) => editSubtrees(document, replaceAt(document, at.path, node));

/** The container with the area moved by `offset` places in draw order (others shift). Moving off either end changes nothing. */
export function moveArea(document: CompositionDocument, at: AreaAt, offset: number): CompositionDocument {
  const to = at.position + offset;
  if (to < 0 || to >= at.areas.length) return document;
  const areas = [...at.areas];
  const [moved] = areas.splice(at.position, 1);
  areas.splice(to, 0, moved);
  return set(document, at, areasToNode(at.node, areas));
}

/** The container with a copy of the area (fresh ids for it and for what it holds) right after it, stored as blocks: two areas for one tab is not the shipped shape. */
export function duplicateArea(document: CompositionDocument, at: AreaAt): { document: CompositionDocument; areaId: string } {
  const source = at.areas[at.position];
  const areaId = createId('area');
  const copy: Area = { ...source, id: areaId, children: source.children.map(child => cloneNode(child)) };
  const areas = [...at.areas.slice(0, at.position + 1), copy, ...at.areas.slice(at.position + 1)];
  return { document: set(document, at, areasToNode(at.node, areas)), areaId };
}

/** The container without the area; one that still holds controls is refused. */
export function removeAreaAt(document: CompositionDocument, at: AreaAt): CompositionDocument {
  return set(document, at, removeArea(at.node, at.areaId));
}

/**
 * The container with a new empty area after the one at `after` (else at the end): a Shared Area, or a Tab Area for `tabId` (the tab the simulator
 * shows). Returns the new area's id.
 */
export function insertArea(document: CompositionDocument, path: EditorPath, node: TabsNode, options: { shared: boolean; tabId?: string; after?: string }): { document: CompositionDocument; areaId: string } {
  const areaId = createId('area');
  const grown = addArea(node, { id: areaId, shared: options.shared });
  const areas = areasOf(grown);
  const added = areas.at(-1)!;
  const tabs: Area['tabs'] = options.shared ? 'all' : [options.tabId && node.tabs.some(tab => tab.id === options.tabId) ? options.tabId : node.tabs[0].id];
  const rest = areas.slice(0, -1);
  const at = options.after ? rest.findIndex(area => area.id === options.after) : -1;
  const placed = at < 0 ? [...rest, { ...added, tabs }] : [...rest.slice(0, at + 1), { ...added, tabs }, ...rest.slice(at + 1)];
  return { document: editSubtrees(document, replaceAt(document, path, areasToNode(node, placed))), areaId };
}
