import { compositionEditorSchema, defaultField, fieldVariants, resolveField, variantName } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { compositionDependencies } from '../../shared/composition/compiler';
import type { CompositionDependencies } from '../../shared/composition/dependencies';
import { plainDocument } from '../data/logic/logicPlain';
import type { Json } from '../../shared/types';

/** A data source of the document. */
export type Source = CompositionDocument['dataSources'][number];

/** The app's words for the models a source can be (spec 5.7: "Home status, Weather, Camera, …"). Unlisted ones are the model name in words. */
const modelWords: Record<string, string> = {
  'home-status': 'Home status', 'home-weather': 'Weather', 'home-light': 'Light', 'camera-stream': 'Camera', climate: 'Climate',
  'alarm-mode': 'Alarm', 'power-toggle': 'Power switch', 'security-door': 'Door', vacuum: 'Vacuum', 'profile-account': 'Account',
  'sprinkler-state': 'Sprinkler', 'household-away-status': 'Away status', 'inventory-summary': 'Inventory summary', 'inventory-list': 'Inventory list',
  'room-navigation': 'Rooms', 'todo-counts': 'To-do counts', 'settings-provider': 'Settings',
};

/** The words for a model id such as `home-status@1`. */
export function modelName(model: string): string {
  const base = model.replace(/@\d+$/, '');
  const known = modelWords[base];
  if (known) return known;
  const text = base.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const literal = (value: unknown): string | undefined => value && typeof value === 'object' && (value as { type?: string }).type === 'literal' ? String((value as { value: Json }).value) : undefined;

/** What a source is called in the list: the entity it reads, or its model, with what sets it apart. */
export function sourceName(source: Source, entityNames?: ReadonlyMap<string, string>): string {
  if (source.kind === 'ha-entity') {
    const entityId = literal(source.entityId);
    return (entityId && entityNames?.get(entityId)) || entityId || 'Entity';
  }
  const model = modelName(source.model);
  const inputs = (source as { inputs?: Record<string, unknown> }).inputs;
  const detail = typeof inputs?.projection === 'string' ? inputs.projection.replace(/-/g, ' ') : undefined;
  return detail ? `${model} · ${detail}` : model;
}

/** One dependency graph for retention and named entity readers, in compiler expansion order. */
const dependencyCache = new WeakMap<CompositionDocument, CompositionDependencies>();
export function documentDependencies(document: CompositionDocument): CompositionDependencies {
  const held = dependencyCache.get(document);
  if (held) return held;
  const plain = plainDocument(document);
  // An unused, half-made logic template must not stop the compiler checking the rest of the editable draft.
  const { logicLibrary: _library, ...withoutLibrary } = plain;
  const graph = compositionDependencies(plain.logicLibrary ? withoutLibrary : plain, document.logicLibrary);
  dependencyCache.set(document, graph);
  return graph;
}

/** The compiler checks library defaults as well as placed expansions; neither may lose a referenced global source. */
export function sourceUses(document: CompositionDocument): Map<string, number> {
  const uses = new Map<string, number>(document.dataSources.map(source => [source.id, 0]));
  for (const { target } of documentDependencies(document).edges) {
    if (target.type === 'source' && uses.has(target.id)) uses.set(target.id, uses.get(target.id)! + 1);
  }
  return uses;
}

/** Entity sources are Studio-managed. Pruning and the edit that orphaned them share one history entry. Models stay editable. */
export function pruneEntitySources(before: CompositionDocument, document: CompositionDocument): CompositionDocument {
  const previous = sourceUses(before);
  let next = document;
  for (;;) {
    if (!documentDependencies(next).complete) return next;
    const uses = sourceUses(next);
    const dataSources = next.dataSources.filter(source => source.kind !== 'ha-entity' || !previous.get(source.id) || (uses.get(source.id) ?? 0) > 0);
    if (dataSources.length === next.dataSources.length) return next;
    next = { ...next, dataSources };
  }
}

/** The document without the sources nothing reads. */
export function removeUnusedSources(document: CompositionDocument): CompositionDocument {
  if (!documentDependencies(document).complete) return document;
  const uses = sourceUses(document);
  return { ...document, dataSources: document.dataSources.filter(source => (uses.get(source.id) ?? 0) > 0) };
}

/** A model a new source can be, and the source it starts as. */
export interface ModelChoice { model: string; name: string; make: (document: CompositionDocument) => Source }
/** Every model the schema allows, by its app name. Entity sources are made by the entity picker, never here. */
export function modelChoices(): ModelChoice[] {
  const items = resolveField(compositionEditorSchema.properties!.dataSources).items;
  const variants = fieldVariants(Array.isArray(items) ? {} : items ?? {});
  return variants.filter(variant => variant.properties?.kind?.const === 'model')
    .map(variant => ({ model: variantName(variant), name: modelName(variantName(variant)), make: (document: CompositionDocument) => defaultField(variant, document) as unknown as Source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
