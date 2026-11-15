import type { CompositionDocument } from '../../shared/composition/schema';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import { holdsEntity } from './catalog';

type Source = CompositionDocument['dataSources'][number];
const literal = (value: string) => ({ type: 'literal' as const, value });

/** The entity a data source reads, when it reads exactly one. */
export function sourceEntity(source: Source | undefined): string | undefined {
  if (!source) return undefined;
  if (source.kind === 'ha-entity') return source.entityId.type === 'literal' ? source.entityId.value : undefined;
  const inputs = (source as { inputs?: { entityId?: { type?: string; value?: string } } }).inputs;
  return inputs?.entityId?.type === 'literal' ? inputs.entityId.value : undefined;
}

/** A source that reads `entityId` (`model` limits it to that model), or a new one. Reuses before it creates. */
export function ensureSource(document: CompositionDocument, entityId: string, model?: 'power-toggle@1'): { document: CompositionDocument; sourceId: string } {
  const found = document.dataSources.find(source => holdsEntity(source, model, entityId));
  if (found) return { document, sourceId: found.id };
  const taken = new Set(document.dataSources.map(item => item.id));
  const base = `${model ? 'power' : 'entity'}-${entityId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  let id = base, count = 1;
  while (taken.has(id)) id = `${base}-${++count}`;
  const source: Source = model ? { id, kind: 'model', model, inputs: { entityId: literal(entityId) } } : { id, kind: 'ha-entity', entityId: literal(entityId) };
  return { document: { ...document, dataSources: [...document.dataSources, source] }, sourceId: id };
}

/**
 * Points the node at `path` at an entity: finds or creates the data source and rewrites the node's own references to it
 * (`binding.sourceId`, `props.sourceId`, and a power action's `sourceId`), in one document so it is one undo step.
 */
export function bindEntity(document: CompositionDocument, path: EditorPath, entityId: string): CompositionDocument {
  const node = valueAt(document, path) as { type: string; binding?: { sourceId: string }; props?: Record<string, unknown>; action?: { type: string; sourceId?: string } } | undefined;
  if (!node) throw new Error('The selected item no longer exists');
  const power = node.type === 'action-tile' || node.action?.type === 'domain';
  const { document: withSource, sourceId } = ensureSource(document, entityId, power ? 'power-toggle@1' : undefined);
  let next = withSource;
  if (node.binding) next = replaceAt(next, [...path, 'binding', 'sourceId'], sourceId);
  if (node.props && 'sourceId' in node.props) next = replaceAt(next, [...path, 'props', 'sourceId'], sourceId);
  if (node.action?.type === 'domain') next = replaceAt(next, [...path, 'action', 'sourceId'], sourceId);
  return next;
}

/** The entity a node is bound to, if its source reads one. */
export function boundEntity(document: CompositionDocument, path: EditorPath): string | undefined {
  const node = valueAt(document, path) as { binding?: { sourceId: string }; props?: { sourceId?: string } } | undefined;
  const id = node?.binding?.sourceId ?? node?.props?.sourceId;
  return sourceEntity(document.dataSources.find(source => source.id === id));
}
