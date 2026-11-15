import type { CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { childSlots, type EditorPath } from '../composition-editor';

/**
 * The id and path index of a 2.0 document.
 *
 * Ids are unique only inside one catalog (a tile and a tab may share a string), so a selection is a key `kind:id`.
 * Identifiers never contain `:` or `/`, so a key splits at its first colon and a local tab's id can join its node and
 * tab ids with a slash.
 */
export type SelectionKind = 'node' | 'page' | 'modal' | 'tab' | 'local-tab' | 'chrome-group' | 'chrome-item' | 'source';
/** A selection key such as `node:hc-lights` or `page:home`. */
export type SelectionKey = `${SelectionKind}:${string}`;

/** One indexed thing: where it lives in the document and what encloses it. */
export interface IndexEntry {
  key: SelectionKey;
  kind: SelectionKind;
  /** The id as the document spells it; for a local tab `nodeId/tabId`. */
  id: string;
  path: EditorPath;
  /** The key of the enclosing node, local tab or surface; undefined for a surface, tab or source. */
  parent?: SelectionKey;
  /** The key of the page or modal that holds a node, local tab or surface chrome item. */
  surface?: SelectionKey;
  /** The node itself, for `node` entries. */
  node?: CompositionNode;
}

/** A built index. Rebuild it when the document changes; it holds no document state of its own. */
export interface DocumentIndex {
  /** Every key in document order (surfaces, their nodes, tabs, chrome, sources). */
  keys: readonly SelectionKey[];
  entries: ReadonlyMap<SelectionKey, IndexEntry>;
  /** The entry for a key. */
  get(key: SelectionKey): IndexEntry | undefined;
  /** The path a key stands for (key to path). */
  pathOf(key: SelectionKey): EditorPath | undefined;
  /** The key at a path (path to key); undefined when nothing is indexed there. */
  keyAt(path: EditorPath): SelectionKey | undefined;
  /** The keys from the surface down to the entry, outermost first (for Esc-to-parent and breadcrumbs). */
  ancestors(key: SelectionKey): SelectionKey[];
  /** The direct children of a node or local tab, in order. */
  children(key: SelectionKey): SelectionKey[];
}

/** Builds a key. */
export const selectionKey = (kind: SelectionKind, id: string): SelectionKey => `${kind}:${id}`;
/** Splits a key into its kind and id. */
export function parseSelectionKey(key: string): { kind: SelectionKind; id: string } | undefined {
  const at = key.indexOf(':');
  if (at <= 0) return undefined;
  return { kind: key.slice(0, at) as SelectionKind, id: key.slice(at + 1) };
}
const pathId = (path: EditorPath) => JSON.stringify(path);

/**
 * Indexes `document`: pages, modals, every node at any depth (including paged-row and pinned-actions children and each
 * local tab), navigation tabs, chrome groups and items (root and per-surface toolbars) and data sources.
 * A repeated id within one kind keeps its first entry, so a document the compiler would reject still indexes.
 */
export function buildDocumentIndex(document: CompositionDocument): DocumentIndex {
  const entries = new Map<SelectionKey, IndexEntry>();
  const byPath = new Map<string, SelectionKey>();
  const kids = new Map<SelectionKey, SelectionKey[]>();
  const add = (entry: Omit<IndexEntry, 'key'>) => {
    const key = selectionKey(entry.kind, entry.id);
    if (entries.has(key)) return undefined;
    entries.set(key, { ...entry, key });
    byPath.set(pathId(entry.path), key);
    if (entry.parent) kids.set(entry.parent, [...(kids.get(entry.parent) ?? []), key]);
    return key;
  };
  const chrome = (groups: { id: string; items: { id: string }[] }[], path: EditorPath, surface?: SelectionKey) =>
    groups.forEach((group, g) => {
      const groupKey = add({ kind: 'chrome-group', id: group.id, path: [...path, g], surface });
      group.items.forEach((item, i) => add({ kind: 'chrome-item', id: item.id, path: [...path, g, 'items', i], parent: groupKey, surface }));
    });
  const nodes = (list: CompositionNode[], path: EditorPath, parent: SelectionKey, surface: SelectionKey) =>
    list.forEach((node, index) => {
      const at = [...path, index];
      const key = add({ kind: 'node', id: node.id, path: at, parent, surface, node });
      if (!key) return;
      for (const slot of childSlots(node)) {
        if (node.type !== 'local-tabs') { nodes(slot.nodes, [...at, ...slot.path], key, surface); continue; }
        const tab = node.tabs[slot.path[1] as number];
        const tabKey = add({ kind: 'local-tab', id: `${node.id}/${tab.id}`, path: [...at, 'tabs', slot.path[1]], parent: key, surface });
        if (tabKey) nodes(slot.nodes, [...at, ...slot.path], tabKey, surface);
      }
    });
  for (const kind of ['page', 'modal'] as const) {
    const collection = kind === 'page' ? 'pages' : 'modals';
    document[collection].forEach((surface, index) => {
      const base: EditorPath = [collection, index];
      const key = add({ kind, id: surface.id, path: base });
      if (!key) return;
      if (surface.toolbar.type === 'replace') chrome(surface.toolbar.groups, [...base, 'toolbar', 'groups'], key);
      nodes(surface.components, [...base, 'components'], key, key);
    });
  }
  document.navigation.tabs.forEach((tab, index) => add({ kind: 'tab', id: tab.id, path: ['navigation', 'tabs', index] }));
  chrome(document.navigation.chrome.groups, ['navigation', 'chrome', 'groups']);
  document.dataSources.forEach((source, index) => add({ kind: 'source', id: source.id, path: ['dataSources', index] }));

  return {
    keys: [...entries.keys()],
    entries,
    get: key => entries.get(key),
    pathOf: key => entries.get(key)?.path,
    keyAt: path => byPath.get(pathId(path)),
    ancestors(key) {
      const chain: SelectionKey[] = [];
      for (let at = entries.get(key)?.parent; at; at = entries.get(at)?.parent) chain.unshift(at);
      const surface = entries.get(key)?.surface;
      if (surface && chain[0] !== surface) chain.unshift(surface);
      return chain;
    },
    children: key => kids.get(key) ?? [],
  };
}
