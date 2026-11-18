import type { ComponentEntry, ComponentRefNode, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { expandRef } from '../shared/composition/components';
import { staticallyHiddenTypes } from '../shared/composition/fold-sides';
import { childSlots, type EditorPath } from '../composition-editor';

type PlainOrRef = PlainNode | ComponentRefNode;

/** A node that draws itself: every node but a `component-ref`, which stands for the body of a saved component. */
export type PlainNode = Exclude<CompositionNode, ComponentRefNode>;

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
  /**
   * The node itself, for `node` entries. For a place that uses a saved component (a `component-ref`) and for everything inside one it is the
   * expanded node: the ids are the derived ones (`<reference id>~<inner id>`), the root's id is the reference's.
   */
  node?: PlainNode;
  /** For a `local-tab` entry (an area of a tab container): the tabs it draws on, in tab order. The shipped shape's area is its one tab. */
  tabs?: string[];
  /** For a `local-tab` entry: whether the area is for every tab (a Shared Area). */
  shared?: boolean;
  /** For a linked component: the key of the instance's root (itself for the root), which is where the selection session and the badge live. */
  instance?: SelectionKey;
  /** For a linked component: the library entry the instance and everything inside it comes from. */
  component?: string;
  /** For the root of an instance: where the body is edited (`componentLibrary/<i>/node`); `path` is the reference's own path on the page. */
  bodyPath?: EditorPath;
  /** For a `component-ref` whose entry is missing: the reference itself, which the Studio can still select and delete. */
  dangling?: ComponentRefNode;
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
  /**
   * The key at a path (path to key); undefined when nothing is indexed there. A path inside a saved component's body belongs to every place that
   * uses it: `instance` picks the place, and without it the first one answers.
   */
  keyAt(path: EditorPath, instance?: SelectionKey): SelectionKey | undefined;
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
 * Node types the document still carries but the Studio no longer shows or edits: the app owns the behaviour. Today that is the
 * notification-permission banner ("Get door and camera alerts"), which the app turns on by default. The contract keeps the type,
 * so an existing draft that has one still validates, compiles, saves and publishes unchanged.
 */
export const hiddenNodeTypes: readonly string[] = staticallyHiddenTypes;
/** Whether the Studio leaves this node out of the canvas, the selection index and the properties. */
export const isHiddenNode = (node: { type: string }): boolean => hiddenNodeTypes.includes(node.type);

/**
 * Indexes `document`: pages, modals, every node at any depth (including paged-row and pinned-actions children and each
 * local tab), navigation tabs, chrome groups and items (root and per-surface toolbars) and data sources.
 * A repeated id within one kind keeps its first entry, so a document the compiler would reject still indexes.
 */
export function buildDocumentIndex(document: CompositionDocument): DocumentIndex {
  const known = built.get(document);
  if (known) return known;
  const index = indexDocument(document);
  built.set(document, index);
  return index;
}

/** Indexes already built, by document: a document is never changed in place, so every caller of one document shares one index. */
const built = new WeakMap<CompositionDocument, DocumentIndex>();

function indexDocument(document: CompositionDocument): DocumentIndex {
  const entries = new Map<SelectionKey, IndexEntry>();
  const byPath = new Map<string, SelectionKey>();
  /** A path inside a saved component's body, by the place that uses it. */
  const byInstancePath = new Map<string, SelectionKey>();
  const library = new Map<string, { entry: ComponentEntry; index: number }>();
  document.componentLibrary?.forEach((entry, index) => { if (!library.has(entry.id)) library.set(entry.id, { entry, index }); });
  const kids = new Map<SelectionKey, SelectionKey[]>();
  const add = (entry: Omit<IndexEntry, 'key'>) => {
    const key = selectionKey(entry.kind, entry.id);
    if (entries.has(key)) return undefined;
    entries.set(key, { ...entry, key });
    if (entry.component !== undefined && entry.instance !== undefined) {
      byInstancePath.set(`${entry.instance}|${pathId(entry.path)}`, key);
      // The root of a place sits at the reference's own path on the page, so that path answers to it. A node inside the body sits at a library path that
      // every place shares, so the first place answers to it (`instance` picks another).
      if (entry.bodyPath !== undefined || !byPath.has(pathId(entry.path))) byPath.set(pathId(entry.path), key);
    } else byPath.set(pathId(entry.path), key);
    if (entry.parent) {
      const siblings = kids.get(entry.parent);
      if (siblings) siblings.push(key); else kids.set(entry.parent, [key]);
    }
    return key;
  };
  const chrome = (groups: { id: string; items: { id: string }[] }[], path: EditorPath, surface?: SelectionKey) =>
    groups.forEach((group, g) => {
      const groupKey = add({ kind: 'chrome-group', id: group.id, path: [...path, g], surface });
      group.items.forEach((item, i) => add({ kind: 'chrome-item', id: item.id, path: [...path, g, 'items', i], parent: groupKey, surface }));
    });
  type Linked = { instance: SelectionKey; component: string };
  /**
   * Indexes `list`, whose first node sits at `path`. A `component-ref` is indexed as its expansion: the root takes the reference's own path (and `bodyPath`
   * says where its body is edited), and every node under it takes the path it has inside the library body, so an edit through it lands in the component.
   */
  const nodes = (list: PlainOrRef[], path: EditorPath, parent: SelectionKey, surface: SelectionKey, linked?: Linked) =>
    // A reject-corpus document may hold a `children` that is not a list (`stack-children-not-a-list`); Checks still indexes it, with no children.
    (Array.isArray(list) ? list : []).forEach((original, index) => {
      if (isHiddenNode(original)) return;
      const at = [...path, index];
      let node: PlainNode, context = linked, extra: Partial<IndexEntry> = {};
      if (original.type === 'component-ref') {
        const found = library.get(original.componentId);
        if (!found) { add({ kind: 'node', id: original.id, path: at, parent, surface, dangling: original }); return; }
        node = expandRef(original, found.entry) as PlainNode;
        const instance = selectionKey('node', original.id);
        context = { instance, component: found.entry.id };
        extra = { instance, component: found.entry.id, bodyPath: ['componentLibrary', found.index, 'node'] };
        const key = add({ kind: 'node', id: node.id, path: at, parent, surface, node, ...extra });
        if (key) descend(node, ['componentLibrary', found.index, 'node'], key, surface, context);
        return;
      }
      node = original;
      if (linked) extra = { instance: linked.instance, component: linked.component };
      const key = add({ kind: 'node', id: node.id, path: at, parent, surface, node, ...extra });
      if (key) descend(node, at, key, surface, context);
    });
  /** The children of an indexed node, each list at its path under `at`. */
  const descend = (node: PlainNode, at: EditorPath, key: SelectionKey, surface: SelectionKey, linked?: Linked) => {
    for (const slot of childSlots(node)) {
      if (node.type !== 'local-tabs') { nodes(slot.nodes, [...at, ...slot.path], key, surface, linked); continue; }
      // An area: a tab's own children in the shipped shape, or one block of `blocks` (`sh.tab-blocks@1`); both are `local-tab` entries.
      const area = slot.path[0] === 'blocks' ? node.blocks![slot.path[1] as number] : undefined;
      const tab = area ? undefined : node.tabs[slot.path[1] as number];
      const id = (area ?? tab)!.id;
      const tabs = area ? (area.tabs === 'all' ? node.tabs.map(item => item.id) : area.tabs) : [tab!.id];
      const tabKey = add({ kind: 'local-tab', id: `${node.id}/${id}`, path: [...at, area ? 'blocks' : 'tabs', slot.path[1]], parent: key, surface, tabs, shared: area?.tabs === 'all',
        ...(linked ? { instance: linked.instance, component: linked.component } : {}) });
      if (tabKey) nodes(slot.nodes, [...at, ...slot.path], tabKey, surface, linked);
    }
  };
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
    keyAt: (path, instance) => (instance ? byInstancePath.get(`${instance}|${pathId(path)}`) : undefined) ?? byPath.get(pathId(path)),
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
