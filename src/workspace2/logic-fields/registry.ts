import { replaceAt, valueAt, type EditorPath, type SchemaField } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
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
export function fieldAnchor(document: CompositionDocument, path: EditorPath): LogicAnchor {
  const collection = path[0], index = path[1];
  if (typeof collection === 'string' && Object.hasOwn(ownerKinds, collection) && index !== undefined) {
    const owner = valueAt(document, path.slice(0, 2)) as { id?: string } | undefined;
    if (!owner?.id) throw new Error('The logic owner no longer exists.');
    const kind = ownerKinds[collection as keyof typeof ownerKinds];
    let nodeId: string | undefined, depth = 2;
    if (kind === 'page' || kind === 'modal' || kind === 'component') for (let at = 3; at < path.length; at++) {
      const node = valueAt(document, path.slice(0, at)) as { id?: unknown; type?: unknown } | undefined;
      if (node && typeof node.id === 'string' && typeof node.type === 'string') { nodeId = node.id; depth = at; }
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
