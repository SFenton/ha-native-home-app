import { replaceAt, valueAt, type EditorPath, type SchemaField } from '../../composition-editor';
import type { CompositionDocument, CompositionNode } from '../../shared/composition/schema';
import { childLists } from '../../shared/composition/components';
import type { Json } from '../../shared/types';
import { canonicalOfBounded } from '../../shared/composition/json';
import { lift, type GraphDestination, type LogicAnchor } from '../../shared/composition/graph';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';

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

const escape = (part: string | number) => String(part).replace(/~/g, '~0').replace(/\//g, '~1');
export const fieldPointer = (path: EditorPath): string => path.length ? `/${path.map(escape).join('/')}` : '';
export const pointerPath = (pointer: string): EditorPath => pointer === '' ? [] : pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
const ownerKinds = { pages: 'page', modals: 'modal', componentLibrary: 'component', logicLibrary: 'logic', dataSources: 'flow' } as const;
export type AuthoredNode = { node: CompositionNode; path: EditorPath; identity: string };
export function authoredNodes(document: CompositionDocument): AuthoredNode[] {
  const nodes: AuthoredNode[] = [];
  const visit = (node: CompositionNode, path: EditorPath, scope: string) => {
    nodes.push({ node, path, identity: JSON.stringify([scope, node.id]) });
    for (const list of childLists(node)) list.nodes.forEach((child, index) => visit(child, [...path, ...list.path, index], scope));
  };
  for (const key of ['pages', 'modals'] as const) document[key].forEach((surface, index) => {
    surface.components.forEach((node, at) => visit(node, [key, index, 'components', at], 'surface'));
  });
  document.componentLibrary?.forEach((entry, index) => visit(entry.node, ['componentLibrary', index, 'node'], `component:${entry.id}`));
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
/**
 * `nodes` may give `authoredNodes(document)` for this same document, to share one walk across calls: computed already, or
 * a function computing it, called only for a page, modal or component field (no other field walks the owners).
 */
export function fieldAnchor(document: CompositionDocument, path: EditorPath, nodes?: readonly AuthoredNode[] | (() => readonly AuthoredNode[])): LogicAnchor {
  const collection = path[0], index = path[1];
  if (typeof collection === 'string' && Object.hasOwn(ownerKinds, collection) && index !== undefined) {
    const owner = valueAt(document, path.slice(0, 2)) as { id?: string } | undefined;
    if (!owner?.id) throw new Error('The logic owner no longer exists.');
    const kind = ownerKinds[collection as keyof typeof ownerKinds];
    let nodeId: string | undefined, depth = 2;
    if (kind === 'page' || kind === 'modal' || kind === 'component') for (const location of (typeof nodes === 'function' ? nodes() : nodes) ?? authoredNodes(document)) {
      if (location.path.length <= path.length && location.path.length > depth
        && location.path.every((part, index) => String(part) === String(path[index]))) {
        nodeId = location.node.id; depth = location.path.length;
      }
    }
    const anchor: LogicAnchor = { kind, id: owner.id, ...(nodeId ? { nodeId } : {}), field: fieldPointer(path.slice(depth)) };
    if (resolveLogicAnchor(document, anchor)?.pointer !== fieldPointer(path)) throw new Error('This field does not have an unambiguous logic owner.');
    return anchor;
  }
  return { kind: 'document', id: document.id, field: fieldPointer(path), fingerprint: canonicalOfBounded(valueAt(document, path)) };
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
