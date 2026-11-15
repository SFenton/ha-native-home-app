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

type NodeRefs = { type: string; binding?: { sourceId: string }; props?: Record<string, unknown>; action?: { type: string; sourceId?: string } };

/** The id of the data source a node reads through `binding.sourceId` or `props.sourceId`. */
export function nodeSourceId(document: CompositionDocument, path: EditorPath): string | undefined {
  const node = valueAt(document, path) as NodeRefs | undefined;
  const id = node?.binding?.sourceId ?? node?.props?.sourceId;
  return typeof id === 'string' && id ? id : undefined;
}

/** A model source that reads one entity through a literal `entityId` input (a power switch, a light, a camera, a door, an alarm). */
const entityModel = (source: Source | undefined) => source?.kind === 'model' && sourceEntity(source) !== undefined ? source : undefined;

/**
 * The source for a node that now reads `entityId`: when the node's current source is a model that reads one entity, a copy of it
 * with the entity swapped (any input that named the old entity follows, the member list of a group is dropped), reused when the
 * document already holds an identical one; otherwise the plain entity source.
 */
function sourceForNode(document: CompositionDocument, current: Source | undefined, entityId: string, power: boolean): { document: CompositionDocument; sourceId: string } {
  const model = entityModel(current) as (Source & { kind: 'model'; inputs: Record<string, unknown> }) | undefined;
  if (!model || model.model === 'power-toggle@1' || power) return ensureSource(document, entityId, power || model?.model === 'power-toggle@1' ? 'power-toggle@1' : undefined);
  const old = sourceEntity(model);
  const swap = (value: unknown): unknown => value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: string }).type === 'literal' && (value as { value?: unknown }).value === old ? literal(entityId) : value;
  const inputs = Object.fromEntries(Object.entries(model.inputs).filter(([key]) => key !== 'memberEntityIds').map(([key, value]) => [key, swap(value)]));
  const twin = document.dataSources.find(source => source.kind === 'model' && source.model === model.model && JSON.stringify((source as { inputs?: unknown }).inputs) === JSON.stringify(inputs));
  if (twin) return { document, sourceId: twin.id };
  const taken = new Set(document.dataSources.map(item => item.id));
  const base = `${model.model.replace(/@\d+$/, '')}-${entityId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  let id = base, count = 1;
  while (taken.has(id)) id = `${base}-${++count}`;
  return { document: { ...document, dataSources: [...document.dataSources, { ...model, id, inputs } as Source] }, sourceId: id };
}

/** Rewrites the node's own references to `sourceId` (`binding.sourceId`, `props.sourceId`, a power action's `sourceId`). */
function pointAt(document: CompositionDocument, path: EditorPath, sourceId: string): CompositionDocument {
  const node = valueAt(document, path) as NodeRefs | undefined;
  if (!node) throw new Error('The selected item no longer exists');
  let next = document;
  if (node.binding) next = replaceAt(next, [...path, 'binding', 'sourceId'], sourceId);
  if (node.props && 'sourceId' in node.props) next = replaceAt(next, [...path, 'props', 'sourceId'], sourceId);
  if (node.action?.type === 'domain') next = replaceAt(next, [...path, 'action', 'sourceId'], sourceId);
  return next;
}

/**
 * Points the node at `path` at an entity: finds or creates the data source (of the model the node already reads, so a light
 * stays a light) and rewrites the node's own references to it, in one document so it is one undo step.
 */
export function bindEntity(document: CompositionDocument, path: EditorPath, entityId: string): CompositionDocument {
  const node = valueAt(document, path) as NodeRefs | undefined;
  if (!node) throw new Error('The selected item no longer exists');
  const power = node.type === 'action-tile' || node.action?.type === 'domain';
  const currentId = nodeSourceId(document, path);
  const { document: withSource, sourceId } = sourceForNode(document, document.dataSources.find(source => source.id === currentId), entityId, power);
  return pointAt(withSource, path, sourceId);
}

/** Points the node at an existing source (a "Models" choice). */
export const bindSource = (document: CompositionDocument, path: EditorPath, sourceId: string): CompositionDocument => pointAt(document, path, sourceId);

/**
 * What a node's data field offers: whether a Home Assistant entity can be picked (the node reads one entity, or nothing yet),
 * and the model sources it may switch to (same model as now, reading no single entity).
 */
export function sourceChoices(document: CompositionDocument, path: EditorPath): { acceptsEntity: boolean; models: Source[] } {
  const current = document.dataSources.find(source => source.id === nodeSourceId(document, path));
  const acceptsEntity = !current || sourceEntity(current) !== undefined;
  const models = document.dataSources.filter(source => source.kind === 'model' && sourceEntity(source) === undefined && (!current || (current.kind === 'model' && current.model === source.model)));
  return { acceptsEntity, models };
}

/** The entity a node is bound to, if its source reads one. */
export function boundEntity(document: CompositionDocument, path: EditorPath): string | undefined {
  const node = valueAt(document, path) as { binding?: { sourceId: string }; props?: { sourceId?: string } } | undefined;
  const id = node?.binding?.sourceId ?? node?.props?.sourceId;
  return sourceEntity(document.dataSources.find(source => source.id === id));
}
