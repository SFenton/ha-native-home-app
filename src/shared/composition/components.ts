import { COMPONENT_ENTRY_LIMITS, type ComponentEntry, type ComponentStringKind, type ComponentRefNode, type CompositionDocument, type CompositionNode } from './schema';
import { omitFoldSide } from './fold-sides';

/**
 * Saved components (`sh.component-ref@1`): a document-level library of nodes, and `component-ref` nodes that stand for one of them. A reference is
 * expanded at compile time, so what the app and the preview draw are plain nodes. This file holds the one pure expansion both the compiler and the
 * Studio preview use, and the small walks around it (uses, counts, where a node sits in a body).
 */

/** The capability a document needs when it holds a `componentLibrary` key or a `component-ref` node. */
export const COMPONENT_REF_CAPABILITY = 'sh.component-ref@1';
/** The capability a document needs when a parameter has the kind `value` or a `component-ref` holds a `values` key (a pending id: the app does not list it yet). */
export const COMPONENT_VALUES_CAPABILITY = 'sh.component-values@1';

/** The most entries a library holds, and the most parameters, bindings and private sources one component declares. */
export const COMPONENT_LIMITS = { entries: 100, ...COMPONENT_ENTRY_LIMITS } as const;

/** A data source of a document (`dataSources[n]`). */
export type DocumentSource = CompositionDocument['dataSources'][number];
/** A data source a component owns: an entity (`entry.sources[n]`) or a Data Flow (`entry.flows[n]`, `sh.repeat@1`). */
export type ComponentSource = NonNullable<ComponentEntry['sources']>[number] | NonNullable<ComponentEntry['flows']>[number];
/** Every data source a component owns, entities first and then flows, in the order they are written. */
export const ownedSources = (entry: Pick<ComponentEntry, 'sources' | 'flows'>): ComponentSource[] => [...(entry.sources ?? []), ...(entry.flows ?? [])];

/** A step on the way down a node: a key, or a list index. */
export type NodePath = (string | number)[];

/** One list of child nodes a container holds, with its path under the container. */
export type ChildList = { path: NodePath; nodes: CompositionNode[] };

// MARK: - Shape

/** Every child list of a container (grids, sections, rails, paged rows, pinned actions and each local tab). A `component-ref` has none: its children are its body's. */
export function childLists(node: CompositionNode): ChildList[] {
  const holder = node as { children?: CompositionNode[]; tabs?: { children: CompositionNode[] }[]; blocks?: { children: CompositionNode[] }[] };
  if (node.type === 'local-tabs') return [...(holder.tabs ?? []).map((tab, index) => ({ path: ['tabs', index, 'children'], nodes: tab.children })),
    ...(holder.blocks ?? []).map((block, index) => ({ path: ['blocks', index, 'children'], nodes: block.children }))];
  return holder.children ? [{ path: ['children'], nodes: holder.children }] : [];
}

/** `node` with each child run through `visit` (every tab's and every area's children too); the same object when it has no children. */
export function mapChildren(node: CompositionNode, visit: (child: CompositionNode) => CompositionNode): CompositionNode {
  const holder = node as unknown as { children?: CompositionNode[]; tabs?: { children: CompositionNode[] }[]; blocks?: { children: CompositionNode[] }[] };
  if (node.type === 'local-tabs') return { ...node, tabs: holder.tabs!.map(tab => ({ ...tab, children: tab.children.map(visit) })),
    ...(holder.blocks ? { blocks: holder.blocks.map(block => ({ ...block, children: block.children.map(visit) })) } : {}) } as CompositionNode;
  if (holder.children) return { ...node, children: holder.children.map(visit) } as CompositionNode;
  return node;
}

/** How many nodes a body holds, itself included. */
export function bodyCount(node: CompositionNode): number {
  let count = 1;
  for (const list of childLists(node)) for (const child of list.nodes) count += bodyCount(child);
  return count;
}

/** How many levels a body spans: 1 for a node with nothing inside. */
export function bodyHeight(node: CompositionNode): number {
  let deepest = 0;
  for (const list of childLists(node)) for (const child of list.nodes) deepest = Math.max(deepest, bodyHeight(child));
  return deepest + 1;
}

/** The path from `node` to the node with `id` (empty for `node` itself), or undefined when no node under it has that id. */
export function findNodePath(node: CompositionNode, id: string): NodePath | undefined {
  if (node.id === id) return [];
  for (const list of childLists(node)) {
    for (let index = 0; index < list.nodes.length; index++) {
      const found = findNodePath(list.nodes[index], id);
      if (found) return [...list.path, index, ...found];
    }
  }
  return undefined;
}

/** The node with `id` inside `node` (itself included). */
export function findNode(node: CompositionNode, id: string): CompositionNode | undefined {
  if (node.id === id) return node;
  for (const list of childLists(node)) for (const child of list.nodes) { const found = findNode(child, id); if (found) return found; }
  return undefined;
}

/** Every node of a body, the root first. */
export function bodyNodes(node: CompositionNode): CompositionNode[] {
  return [node, ...childLists(node).flatMap(list => list.nodes.flatMap(bodyNodes))];
}

// MARK: - Fields

/** A bound field's path under its node: `props/sourceId` is `['props', 'sourceId']`. */
export const fieldSteps = (field: string): string[] => field.split('/').filter(step => step.length > 0);

/** The value at `field` under `node`, or undefined when a step is missing. */
export function readField(node: unknown, field: string): unknown {
  return fieldSteps(field).reduce<unknown>((value, step) => value !== null && typeof value === 'object' && Object.hasOwn(value, step) ? Reflect.get(value, step) : undefined, node);
}

/** `node` with `field` set to `value`; only the objects on the way are copied. The same object when a step is missing. */
export function writeField<T>(node: T, field: string, value: unknown): T {
  const steps = fieldSteps(field);
  if (!steps.length) return node;
  const set = (current: unknown, depth: number): unknown => {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, steps[depth])) return undefined;
    const copy: Record<string, unknown> = Array.isArray(current) ? [...current] as unknown as Record<string, unknown> : { ...current };
    if (depth === steps.length - 1) { copy[steps[depth]] = value; return copy; }
    const inner = set(Reflect.get(current, steps[depth]), depth + 1);
    if (inner === undefined) return undefined;
    copy[steps[depth]] = inner;
    return copy;
  };
  return (set(node, 0) as T | undefined) ?? node;
}

/**
 * `node` with `field` set to `value` for a `value` parameter (`sh.component-values@1`): the same copy-on-write walk as {@link writeField}, except that the
 * last step is created when the object that holds it exists, and `null` removes it. A missing object on the way, or a list on the last step, leaves `node`
 * as it is (a list's place cannot be removed, or grown, without moving its neighbours).
 */
export function writeValue<T>(node: T, field: string, value: unknown): T {
  const steps = fieldSteps(field);
  if (!steps.length) return node;
  const set = (current: unknown, depth: number): unknown => {
    if (current === null || typeof current !== 'object') return undefined;
    const last = depth === steps.length - 1;
    if (Array.isArray(current) && last && (!Object.hasOwn(current, steps[depth]) || value === null)) return undefined;
    if (!last && !Object.hasOwn(current, steps[depth])) return undefined;
    const copy: Record<string, unknown> = Array.isArray(current) ? [...current] as unknown as Record<string, unknown> : { ...current };
    if (last) {
      if (value === null) delete copy[steps[depth]]; else copy[steps[depth]] = value;
      return copy;
    }
    const inner = set(Reflect.get(current, steps[depth]), depth + 1);
    if (inner === undefined) return undefined;
    copy[steps[depth]] = inner;
    return copy;
  };
  return (set(node, 0) as T | undefined) ?? node;
}

/**
 * What a field holds, as far as a binding cares, from where it sits: a `pageId`, a `modalId`, a `stateId`, a source or provider id, an entity id
 * (an `entityId` or `...EntityId` key, a `copySourceId`, or the literal under an `entityId` or `entity_id` key), the name of an SF Symbol, the value of a
 * literal, or a node's own `title`. Undefined for any field a parameter may not fill. `node` is a body node or one of an entry's private sources.
 */
export function fieldKind(node: unknown, field: string): ComponentStringKind | undefined {
  const steps = fieldSteps(field);
  const last = steps.at(-1);
  if (last === undefined) return undefined;
  const parent = readField(node, steps.slice(0, -1).join('/'));
  const own = readField(node, field);
  if (typeof own !== 'string') return undefined;
  const parentType = parent !== null && typeof parent === 'object' ? Reflect.get(parent, 'type') : undefined;
  if (last === 'pageId') return 'page-id';
  if (last === 'modalId') return 'modal-id';
  if (last === 'stateId') return 'state-id';
  if (last === 'entityId' || last === 'copySourceId' || /EntityId$/.test(last)) return 'entity-id';
  if (last === 'value' && parentType === 'literal' && (steps.at(-2) === 'entityId' || steps.at(-2) === 'entity_id')) return 'entity-id';
  if (isSourceKey(last)) return 'source-id';
  if (last === 'name' && parentType === 'sf-symbol') return 'symbol';
  if (last === 'value' && parentType === 'literal') return 'text';
  if (steps.length === 1 && last === 'title') return 'text';
  return undefined;
}

/** Whether a key names a data source (or provider) by id: `sourceId`, `providerId`, `titleSourceId`, `scopeProviderId`. A `copySourceId` names an entity. */
export const isSourceKey = (key: string): boolean => key !== 'copySourceId' && /(?:source|provider)Id$/i.test(key);
const isSourceListKey = (key: string): boolean => /(?:source|provider)Ids$/i.test(key);

// MARK: - Expansion

/** The id of a node inside the instance `refId`: `~` is outside the identifier alphabet, so it never equals an authored id. */
export const derivedId = (refId: string, innerId: string): string => `${refId}~${innerId}`;

/** The id a node has in the library body when `id` is a derived one (`<reference id>~<id>`); any other id as it is. */
export const bodyIdOf = (id: string): string => id.includes('~') ? id.slice(id.indexOf('~') + 1) : id;

/** The id the instance `refId` gives the node `innerId`: the reference's own for the root. */
export const instanceNodeId = (refId: string, innerId: string, root: boolean): string => root ? refId : derivedId(refId, innerId);

/** `value` with every source key that names an id in `names` rewritten to the mapped id; the same object when nothing changes. */
export function renameSources<T>(value: T, names: ReadonlyMap<string, string>): T {
  const through = (list: unknown[], rename: (item: unknown) => unknown): unknown[] => {
    const next = list.map(rename);
    return next.some((item, index) => item !== list[index]) ? next : list;
  };
  if (Array.isArray(value)) return through(value, item => renameSources(item, names)) as T;
  if (value === null || typeof value !== 'object') return value;
  let copy: Record<string, unknown> | undefined;
  const record = value as Record<string, unknown>;
  for (const [key, inner] of Object.entries(record)) {
    const next = typeof inner === 'string' && isSourceKey(key) ? names.get(inner) ?? inner
      : Array.isArray(inner) && isSourceListKey(key) ? through(inner, item => typeof item === 'string' ? names.get(item) ?? item : item)
        : renameSources(inner, names);
    if (next === inner) continue;
    copy ??= { ...record };
    copy[key] = next;
  }
  return (copy ?? value) as T;
}

/** The private sources of `entry` as the names they take in the instance `refId`: `<reference id>~<source id>`. */
export const privateNames = (refId: string, entry: Pick<ComponentEntry, 'sources' | 'flows'>): Map<string, string> =>
  new Map(ownedSources(entry).map(source => [source.id, derivedId(refId, source.id)]));

/**
 * The data sources one use of `entry` adds to the document: a copy of each of the entry's `sources` with the id `<reference id>~<source id>`, each bound
 * field (a binding with a `sourceId`) taking the reference's argument. Empty for an entry with no sources.
 */
export function expandSources(ref: ComponentRefNode, entry: ComponentEntry): DocumentSource[] {
  return ownedSources(entry).map(source => {
    let next: unknown = { ...source, id: derivedId(ref.id, source.id) };
    for (const binding of entry.bindings ?? []) {
      const value = binding.sourceId === source.id ? ref.args?.[binding.param] : undefined;
      if (value !== undefined) next = writeField(next, binding.field, value);
    }
    return next as DocumentSource;
  });
}

/** Whether two field paths are one, or one lies under the other (`props/tone` and `props/tone/color`). */
export const fieldsOverlap = (first: string, second: string): boolean => {
  const a = fieldSteps(first), b = fieldSteps(second), shared = Math.min(a.length, b.length);
  return a.slice(0, shared).every((step, index) => step === b[index]);
};


const expansions = new WeakMap<object, Map<string, CompositionNode>>();

/**
 * The body of `entry` as one use of it: the root takes the reference's id and width, every other node `<reference id>~<its id>`, and each bound
 * field takes the reference's argument for its parameter (a parameter with no argument keeps the body's value). A `sourceId` (or `providerId`) that
 * names one of the entry's private sources becomes that source's id in this use (`expandSources` adds the source). Nothing else changes: local tab
 * ids, option ids, document source ids, `modalId`, `pageId` and local state fields are document-level names and stay as written. Memoised on the body's
 * identity and then the reference's id, width and arguments, so an unchanged component is expanded once.
 */
export function expandRef(ref: ComponentRefNode, entry: ComponentEntry): CompositionNode {
  const key = `${ref.id}\0${ref.layout.span}\0${ref.layout.foldSide ?? ''}\0${ref.args ? JSON.stringify(ref.args) : ''}\0${ref.values ? JSON.stringify(ref.values) : ''}\0${entry.bindings ? JSON.stringify(entry.bindings) : ''}\0${entry.sources ? JSON.stringify(entry.sources) : ''}\0${entry.flows ? JSON.stringify(entry.flows) : ''}`;
  const cache = expansions.get(entry.node) ?? new Map<string, CompositionNode>();
  const known = cache.get(key);
  if (known) return known;
  const names = privateNames(ref.id, entry);
  const bindings = new Map<string, { field: string; value: unknown; whole?: true }[]>();
  for (const binding of entry.bindings ?? []) {
    const value = ref.args?.[binding.param];
    if (value === undefined || binding.nodeId === undefined) continue;
    bindings.set(binding.nodeId, [...bindings.get(binding.nodeId) ?? [], { field: binding.field, value }]);
  }
  // A `value` argument is written after the strings, and a source key inside it that names one of the entry's own sources is this use's copy.
  const valued = new Set((entry.params ?? []).filter(param => param.kind === 'value').map(param => param.name));
  for (const binding of entry.bindings ?? []) {
    if (!valued.has(binding.param) || binding.nodeId === undefined || !ref.values || !Object.hasOwn(ref.values, binding.param)) continue;
    const value = names.size ? renameSources(ref.values[binding.param], names) : ref.values[binding.param];
    bindings.set(binding.nodeId, [...bindings.get(binding.nodeId) ?? [], { field: binding.field, value, whole: true }]);
  }
  const rename = (node: CompositionNode, root: boolean): CompositionNode => {
    let next: CompositionNode = node;
    for (const { field, value, whole } of bindings.get(node.id) ?? []) next = whole ? writeValue(next, field, value) : writeField(next, field, value);
    next = mapChildren(next, child => rename(child, false));
    const id = instanceNodeId(ref.id, node.id, root);
    // The root takes the reference's width and its side of the hinge (`sh.fold-sides@1`); a body's own side is not read, the place says where it sits.
    const layout = root ? { ...omitFoldSide(next.layout), span: ref.layout.span, ...(ref.layout.foldSide !== undefined ? { foldSide: ref.layout.foldSide } : {}) } : next.layout;
    return next.id === id && layout === next.layout ? next : { ...next, id, layout } as CompositionNode;
  };
  // Private source names are rewritten first, so an argument that happens to equal one (a `source-id` parameter) is never rewritten.
  const expanded = rename(names.size ? renameSources(entry.node, names) : entry.node, true);
  cache.set(key, expanded);
  expansions.set(entry.node, cache);
  return expanded;
}

/** `node` as the library check sees an entry's body: its private source names replaced by `<entry id>~<source id>`, the names of the sources the check registers. */
export const checkedBody = (entry: ComponentEntry): CompositionNode => ownedSources(entry).length ? renameSources(entry.node, privateNames(entry.id, entry)) : entry.node;

/** The library entries of a document by id. */
export const libraryById = (document: Pick<CompositionDocument, 'componentLibrary'>): Map<string, ComponentEntry> =>
  new Map((document.componentLibrary ?? []).map(entry => [entry.id, entry]));

const expandedDocuments = new WeakMap<object, CompositionDocument>();

/**
 * The document with every `component-ref` replaced by its expansion, the private sources of each use added to `dataSources` (after the document's own,
 * in document order), and `componentLibrary` removed. A reference to a missing entry stays as it is (the compiler reports it). A document without a
 * library is returned as it is. Checks and tests read this; the draft and the publication stay unexpanded.
 */
export function expandDocument(document: CompositionDocument): CompositionDocument {
  if (!document.componentLibrary) return document;
  const known = expandedDocuments.get(document);
  if (known) return known;
  const entries = libraryById(document);
  const added: DocumentSource[] = [];
  const visit = (node: CompositionNode): CompositionNode => {
    if (node.type === 'component-ref') {
      const entry = entries.get(node.componentId);
      if (!entry) return node;
      added.push(...expandSources(node, entry));
      return expandRef(node, entry);
    }
    return mapChildren(node, visit);
  };
  const surfaces = <T extends { components: CompositionNode[] }>(list: T[]): T[] => list.map(surface => ({ ...surface, components: surface.components.map(visit) }));
  const { componentLibrary: _library, ...rest } = document;
  const pages = surfaces(document.pages), modals = surfaces(document.modals);
  const expanded = { ...rest, dataSources: added.length ? [...document.dataSources, ...added] : document.dataSources, pages, modals } as CompositionDocument;
  expandedDocuments.set(document, expanded);
  return expanded;
}

// MARK: - Uses

/** One place a saved component is used. */
export type ComponentUse = {
  ref: ComponentRefNode;
  /** Where the reference sits: `['pages', 0, 'components', 2, ...]`. */
  path: NodePath;
  surface: { kind: 'page' | 'modal'; id: string; title: string; index: number };
  /** The title of the nearest local tab the reference sits in, when it sits in one. */
  tab?: { id: string; label: string };
};

/** Every `component-ref` of the pages and modals (not the library, which holds none), in document order. */
export function componentReferences(document: Pick<CompositionDocument, 'pages' | 'modals'>): ComponentUse[] {
  const found: ComponentUse[] = [];
  const visit = (nodes: CompositionNode[], path: NodePath, surface: ComponentUse['surface'], tab?: ComponentUse['tab']) => nodes.forEach((node, index) => {
    const at = [...path, index];
    if (node.type === 'component-ref') { found.push({ ref: node, path: at, surface, ...(tab ? { tab } : {}) }); return; }
    if (node.type === 'local-tabs') {
      node.tabs.forEach((entry, position) => visit(entry.children, [...at, 'tabs', position, 'children'], surface, { id: entry.id, label: entry.label }));
      node.blocks?.forEach((block, position) => visit(block.children, [...at, 'blocks', position, 'children'], surface, block.tabs === 'all' ? undefined : { id: block.tabs[0], label: node.tabs.find(tab => tab.id === block.tabs[0])?.label ?? block.tabs[0] }));
    }
    else for (const list of childLists(node)) visit(list.nodes, [...at, ...list.path], surface, tab);
  });
  for (const kind of ['pages', 'modals'] as const) {
    document[kind].forEach((entry, index) => visit(entry.components, [kind, index, 'components'], { kind: kind === 'pages' ? 'page' : 'modal', id: entry.id, title: entry.title, index }));
  }
  return found;
}

/** The places that use the component `id`, in document order. */
export function componentUses(document: Pick<CompositionDocument, 'pages' | 'modals'>, id: string): ComponentUse[] {
  return componentReferences(document).filter(use => use.ref.componentId === id);
}

// MARK: - Titles

/**
 * What a node is called in a list or a message: its title, or for a `component-ref` (which has none) the name of the entry it uses, or its own
 * id when the entry is missing.
 */
export function nodeTitle(node: CompositionNode, library?: Pick<CompositionDocument, 'componentLibrary'>): string {
  if (node.type !== 'component-ref') return node.title;
  return library?.componentLibrary?.find(entry => entry.id === node.componentId)?.name ?? node.id;
}
