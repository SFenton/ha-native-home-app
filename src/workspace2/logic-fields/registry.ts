import { replaceAt, valueAt, type EditorPath, type SchemaField } from '../../composition-editor';
import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { childLists } from '../../shared/composition/components';
import type { Json } from '../../shared/types';
import { canonicalOfBounded, pointer } from '../../shared/composition/json';
import { lift, type GraphDestination, type LogicAnchor } from '../../shared/composition/graph';
import { atPointer, record, resolveLogicAnchor, type ResolvedLogicAnchor } from '../../shared/composition/studio-logic/anchors';

export type LogicFieldKind = GraphDestination['kind'];
interface FieldAdapter {
  readonly destination: LogicFieldKind;
  readonly output: 'yes/no' | 'value' | 'text' | 'action' | 'flow' | 'structure';
  read(document: CompositionDocument, path: EditorPath): Json;
  write(document: CompositionDocument, path: EditorPath, value: Json): CompositionDocument;
}
const direct = (destination: LogicFieldKind, output: FieldAdapter['output']): FieldAdapter => ({
  destination, output,
  read: (document, path) => valueAt(document, path) as Json,
  write: (document, path, value) => {
    if (canonicalOfBounded(valueAt(document, path)) === canonicalOfBounded(value)) return document;
    return replaceAt(document, path, value);
  },
});
// This is intentionally keyed by the graph contract, not an independently maintained field-kind union.
export const fieldAdapters = {
  condition: direct('condition', 'yes/no'),
  operand: direct('operand', 'value'),
  slot: direct('slot', 'value'),
  call: direct('call', 'action'),
  flow: direct('flow', 'flow'),
  document: direct('document', 'structure'),
  fragment: direct('fragment', 'structure'),
} satisfies Record<LogicFieldKind, FieldAdapter>;

const escape = (part: string | number) => {
  const text = String(part);
  return text.includes('~') || text.includes('/') ? text.replace(/~/g, '~0').replace(/\//g, '~1') : text;
};
export const fieldPointer = (path: EditorPath): string => path.length ? `/${path.map(escape).join('/')}` : '';
export const pointerPath = (pointer: string): EditorPath => pointer === '' ? [] : pointer.includes('~')
  ? pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')) : pointer.slice(1).split('/');
const ownerKinds = { pages: 'page', modals: 'modal', componentLibrary: 'component', logicLibrary: 'logic', dataSources: 'flow' } as const;
export type AuthoredNode = { node: CompositionNode; path: EditorPath; identity: string };
/** `authoredNodes`' walk of one owner, `document[key][index]`, appended to `nodes`. */
function visitOwner(key: WalkedOwnerList, index: number, owner: unknown, nodes: AuthoredNode[]): void {
  const visit = (node: CompositionNode, path: EditorPath, scope: string) => {
    nodes.push({ node, path, identity: JSON.stringify([scope, node.id]) });
    for (const list of childLists(node)) list.nodes.forEach((child, at) => visit(child, [...path, ...list.path, at], scope));
  };
  if (key === 'componentLibrary') {
    const entry = owner as NonNullable<CompositionDocument['componentLibrary']>[number];
    visit(entry.node, ['componentLibrary', index, 'node'], `component:${entry.id}`);
  } else (owner as CompositionDocument['pages'][number]).components.forEach((node, at) => visit(node, [key, index, 'components', at], 'surface'));
}
export function authoredNodes(document: CompositionDocument): AuthoredNode[] {
  const nodes: AuthoredNode[] = [];
  for (const key of ['pages', 'modals'] as const) document[key].forEach((surface, index) => visitOwner(key, index, surface, nodes));
  document.componentLibrary?.forEach((entry, index) => visitOwner('componentLibrary', index, entry, nodes));
  return nodes;
}
/**
 * The nodes of `authoredNodes(document)` inside the owner `path` runs through (none for a path outside the walked owner
 * lists): the only ones `fieldAnchor` can find for `path`. Like the walk, it throws on an owner it cannot walk. Memoized
 * by the owner object and its index, for an immutable (committed) document only.
 */
const ownerNodeWalks = new WeakMap<object, { readonly index: number; readonly nodes: readonly AuthoredNode[] }>();
export function ownerAuthoredNodes(document: CompositionDocument, path: EditorPath): readonly AuthoredNode[] {
  const key = path[0], index = Number(path[1]);
  if (!(walkedOwnerLists as readonly unknown[]).includes(key) || path.length < 2 || !Number.isInteger(index) || index < 0) return [];
  const list: unknown = Reflect.get(document, key as string), owner: unknown = Array.isArray(list) ? list[index] : undefined;
  if (owner === null || typeof owner !== 'object') return [];
  const known = ownerNodeWalks.get(owner);
  if (known?.index === index) return known.nodes;
  const nodes: AuthoredNode[] = [];
  visitOwner(key as WalkedOwnerList, index, owner, nodes);
  ownerNodeWalks.set(owner, { index, nodes });
  return nodes;
}
/**
 * Whether `authoredNodes` walks `node` (and everything below it) without throwing, for JSON values. It reads each node's
 * `id`, so a missing (`null` or `undefined`) node throws; a primitive has no `id`, `type` or child lists and is walked.
 * Then `childLists`: a `local-tabs` node's `tabs` and `blocks` must each be absent or a list (`(holder.tabs ?? []).map`),
 * every entry an area whose `children` is a list (`tab.children`, then `list.nodes.forEach`); any other node's truthy
 * `children` must be a list. Objects in `known` were walked before and are not walked again (a node's subtree is fixed
 * by its identity once committed); objects walked are added to `walked`.
 */
export function walkableNode(node: unknown, known?: WeakSet<object>, walked?: object[]): boolean {
  if (node === null || node === undefined) return false;
  if (typeof node !== 'object' || known?.has(node)) return true;
  const holder = node as { type?: unknown; children?: unknown; tabs?: unknown; blocks?: unknown };
  const lists: unknown[][] = [];
  if (holder.type === 'local-tabs') {
    for (const areas of [holder.tabs ?? [], holder.blocks ?? []]) {
      // `every` and `forEach` skip holes, as the walk's `map` does.
      const area = (value: unknown) => value === null || value === undefined ? undefined : (value as { children?: unknown }).children;
      if (!Array.isArray(areas) || !areas.every(value => Array.isArray(area(value)))) return false;
      areas.forEach(value => lists.push(area(value) as unknown[]));
    }
  } else if (holder.children) {
    if (!Array.isArray(holder.children)) return false;
    lists.push(holder.children);
  }
  if (!lists.every(list => list.every(child => walkableNode(child, known, walked)))) return false;
  walked?.push(node);
  return true;
}
/** The owner lists `authoredNodes` walks: `pages` and `modals` must be lists, `componentLibrary` absent or a list. */
export const walkedOwnerLists = ['pages', 'modals', 'componentLibrary'] as const;
export type WalkedOwnerList = typeof walkedOwnerLists[number];
export const walkableList = (list: WalkedOwnerList, value: unknown) => Array.isArray(value) || list === 'componentLibrary' && (value === null || value === undefined);
/**
 * Whether `authoredNodes` walks `owner`, an entry of `list`, without throwing: a page or modal must have a list of
 * `components` (`surface.components.forEach`), a component entry a `node` (`entry.node`), and each node must be walkable.
 * `known` and `walked` hold nodes, as for {@link walkableNode}.
 */
export function walkableOwner(list: WalkedOwnerList, owner: unknown, known?: WeakSet<object>, walked?: object[]): boolean {
  if (owner === null || owner === undefined) return false;
  if (list === 'componentLibrary') return walkableNode((owner as { node?: unknown }).node, known, walked);
  const components = (owner as { components?: unknown }).components;
  return Array.isArray(components) && components.every(node => walkableNode(node, known, walked));
}
/** Each walk's nodes by pointer, so `fieldAnchor` finds the deepest one on a path by its prefixes (a walk is never changed). */
const nodesByPath = new WeakMap<readonly AuthoredNode[], Map<string, AuthoredNode>>();
function deepestNode(nodes: readonly AuthoredNode[], path: EditorPath): AuthoredNode | undefined {
  let byPath = nodesByPath.get(nodes);
  if (!byPath) {
    byPath = new Map();
    for (const location of nodes) byPath.set(fieldPointer(location.path), location);
    nodesByPath.set(nodes, byPath);
  }
  for (let depth = path.length; depth > 2; depth--) {
    const found = byPath.get(fieldPointer(path.slice(0, depth)));
    if (found) return found;
  }
  return undefined;
}
/**
 * `nodes` may give `authoredNodes(document)` for this same document, to share one walk across calls: computed already, or
 * a function computing it, called only for a page, modal or component field (no other field walks the owners). `resolve`
 * may give `resolveLogicAnchor` over this same document (an {@link AnchorResolver}'s, say).
 */
export function fieldAnchor(document: CompositionDocument, path: EditorPath, nodes?: readonly AuthoredNode[] | (() => readonly AuthoredNode[]),
  resolve: (anchor: LogicAnchor) => ResolvedLogicAnchor | undefined = anchor => resolveLogicAnchor(document, anchor)): LogicAnchor {
  const collection = path[0], index = path[1];
  if (typeof collection === 'string' && Object.hasOwn(ownerKinds, collection) && index !== undefined) {
    const owner = valueAt(document, path.slice(0, 2)) as { id?: string } | undefined;
    if (!owner?.id) throw new Error('The logic owner no longer exists.');
    const kind = ownerKinds[collection as keyof typeof ownerKinds];
    let nodeId: string | undefined, depth = 2;
    if (kind === 'page' || kind === 'modal' || kind === 'component') {
      // The deepest walked node whose path is a prefix of this one (longer than the owner's).
      const location = deepestNode((typeof nodes === 'function' ? nodes() : nodes) ?? authoredNodes(document), path);
      if (location) { nodeId = location.node.id; depth = location.path.length; }
    }
    const anchor: LogicAnchor = { kind, id: owner.id, ...(nodeId ? { nodeId } : {}), field: fieldPointer(path.slice(depth)) };
    if (resolve(anchor)?.pointer !== fieldPointer(path)) throw new Error('This field does not have an unambiguous logic owner.');
    return anchor;
  }
  return { kind: 'document', id: document.id, field: fieldPointer(path), fingerprint: canonicalOfBounded(valueAt(document, path)) };
}

type Located = NonNullable<ResolvedLogicAnchor['node']>;
/**
 * Memos keyed by objects. Objects of committed revisions are immutable, so their entries are kept across revisions; any
 * other object (one a candidate built: a refused candidate may be mutated and offered again) is kept only for one caller.
 */
class ObjectMemo<T> {
  private readonly local = new Map<object, T>();
  constructor(private readonly shared: WeakMap<object, T>, private readonly committed: (value: object) => boolean) {}
  get(value: object): T | undefined { return this.local.get(value) ?? this.shared.get(value); }
  set(value: object, result: T): T {
    if (this.committed(value)) this.shared.set(value, result); else this.local.set(value, result);
    return result;
  }
}
/**
 * The logic nodes `resolveLogicAnchor` finds at and below `value` (anchors.ts `nodes`: records with a string `type` and
 * `id`, through `children` and, for `local-tabs`, each record area's `children` under `tabs` and `blocks`), each with its
 * pointer relative to `value`.
 */
const candidatesBelow = new WeakMap<object, readonly Located[]>();
function logicNodes(value: unknown, memo: ObjectMemo<readonly Located[]>): readonly Located[] {
  if (!record(value) || typeof value.type !== 'string' || typeof value.id !== 'string') return [];
  const known = memo.get(value);
  if (known) return known;
  const result: Located[] = [{ value, pointer: '' }];
  const children = (list: unknown, base: string) => {
    if (Array.isArray(list)) list.forEach((child, index) => {
      const at = pointer(base, index);
      for (const found of logicNodes(child, memo)) result.push({ value: found.value, pointer: `${at}${found.pointer}` });
    });
  };
  children(value.children, '/children');
  if (value.type === 'local-tabs') for (const key of ['tabs', 'blocks']) {
    const list = value[key];
    if (Array.isArray(list)) list.forEach((tab, index) => {
      if (record(tab)) children(tab.children, `${pointer(pointer('', key), index)}/children`);
    });
  }
  return memo.set(value, result);
}
/** Each owner's logic nodes by ID, pointers relative to the owner (anchors.ts: an entry's `node`, a surface's `components`). */
const entryNodes = new WeakMap<object, ReadonlyMap<string, readonly Located[]>>(), surfaceNodes = new WeakMap<object, ReadonlyMap<string, readonly Located[]>>();
const ownerListKeys = { page: 'pages', modal: 'modals', component: 'componentLibrary', logic: 'logicLibrary', flow: 'dataSources' } as const;
/**
 * `resolveLogicAnchor` over one document, answering repeated lookups from indexes: each owner list's IDs (per resolver)
 * and each owner's logic nodes (per owner object). It gives exactly the canonical result, the same object identities
 * included, and falls back to the canonical resolver for every anchor shape the indexes do not cover (document anchors,
 * IDs that are not text). Indexes of objects `committed` admits are kept across revisions that share them; the rest only
 * for this resolver, so a candidate may be resolved too, as long as `committed` admits only objects of committed revisions.
 */
export class AnchorResolver {
  private readonly lists = new Map<string, Map<string, number[]>>();
  private readonly nodes: ObjectMemo<readonly Located[]>;
  private readonly owners_: { component: ObjectMemo<ReadonlyMap<string, readonly Located[]>>; surface: ObjectMemo<ReadonlyMap<string, readonly Located[]>> };
  constructor(readonly document: unknown, committed: (value: object) => boolean = () => true) {
    this.nodes = new ObjectMemo(candidatesBelow, committed);
    this.owners_ = { component: new ObjectMemo(entryNodes, committed), surface: new ObjectMemo(surfaceNodes, committed) };
  }

  /** Indices of the records in `key` whose `id` is `id` (the owner list scan). */
  owners(key: string, id: string): readonly number[] {
    let byId = this.lists.get(key);
    if (!byId) {
      byId = new Map();
      const list = record(this.document) ? this.document[key] : undefined;
      if (Array.isArray(list)) list.forEach((value, index) => {
        if (!record(value) || typeof value.id !== 'string') return;
        const same = byId!.get(value.id);
        if (same) same.push(index); else byId!.set(value.id, [index]);
      });
      this.lists.set(key, byId);
    }
    return byId.get(id) ?? [];
  }

  /** The owner's logic nodes by ID, pointers relative to the owner. */
  ownerNodes(kind: 'component' | 'page' | 'modal', owner: Record<string, unknown>): ReadonlyMap<string, readonly Located[]> {
    const memo = kind === 'component' ? this.owners_.component : this.owners_.surface, known = memo.get(owner);
    if (known) return known;
    const byId = new Map<string, Located[]>();
    const add = (value: unknown, base: string) => {
      for (const found of logicNodes(value, this.nodes)) {
        const id = found.value.id as string, entry = { value: found.value, pointer: `${base}${found.pointer}` }, same = byId.get(id);
        if (same) same.push(entry); else byId.set(id, [entry]);
      }
    };
    if (kind === 'component') add(owner.node, '/node');
    else if (Array.isArray(owner.components)) owner.components.forEach((value, index) => add(value, `/components/${index}`));
    return memo.set(owner, byId);
  }

  resolve(anchor: LogicAnchor): ResolvedLogicAnchor | undefined {
    const document = this.document;
    if (!record(document)) return undefined;
    if (anchor.kind === 'document' || !Object.hasOwn(ownerListKeys, anchor.kind) || typeof anchor.id !== 'string'
      || anchor.nodeId !== undefined && typeof anchor.nodeId !== 'string') return resolveLogicAnchor(document, anchor);
    const key = ownerListKeys[anchor.kind], list = document[key];
    if (!Array.isArray(list)) return undefined;
    const matches = this.owners(key, anchor.id);
    if (matches.length !== 1) return undefined;
    const owner: Located = { value: list[matches[0]] as Record<string, unknown>, pointer: `/${key}/${matches[0]}` };
    let node: Located | undefined;
    if (anchor.nodeId !== undefined) {
      const found = anchor.kind === 'component' || anchor.kind === 'page' || anchor.kind === 'modal'
        ? this.ownerNodes(anchor.kind, owner.value).get(anchor.nodeId) ?? [] : [];
      if (found.length !== 1) return undefined;
      node = { value: found[0].value, pointer: `${owner.pointer}${found[0].pointer}` };
    }
    const base = node ?? owner, value = atPointer(base.value, anchor.field);
    return value === undefined ? undefined : { value, pointer: `${base.pointer}${anchor.field}`, node, owner };
  }
}

export function liftField(document: CompositionDocument, path: EditorPath, kind: LogicFieldKind) {
  const anchor = fieldAnchor(document, path);
  const adapter = fieldAdapters[kind];
  return lift(adapter.read(document, path), {
    anchor, kind: adapter.destination,
    context: { document: document as unknown as Json, pointer: fieldPointer(path) },
  });
}
export function schemaFieldKind(schema: SchemaField): LogicFieldKind | undefined {
  if (schema.xValue) return 'slot';
  if (schema.properties?.model?.const === 'pipeline@1') return 'flow';
  const variants = schema.anyOf ?? schema.oneOf ?? [schema];
  const types = new Set(variants.flatMap(variant => typeof variant.properties?.type?.const === 'string' ? [variant.properties.type.const] : []));
  if (types.has('compare') || types.has('all') || types.has('viewer-person') || types.has('state') && types.has('not')) return 'condition';
  if (types.has('math') || types.has('choose') || types.has('raw-state')) return 'operand';
  if (types.has('call-service') && types.size === 1) return 'call';
  return undefined;
}
