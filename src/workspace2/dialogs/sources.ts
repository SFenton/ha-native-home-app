import { compositionEditorSchema, defaultField, fieldVariants, resolveField, variantName } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
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

/** How many places read each source: every string in the document, outside a source's own `id`, that is one source's id. */
export function sourceUses(document: CompositionDocument): Map<string, number> {
  const uses = new Map<string, number>(document.dataSources.map(source => [source.id, 0]));
  const walk = (value: unknown, own?: boolean) => {
    if (typeof value === 'string') { if (uses.has(value)) uses.set(value, uses.get(value)! + 1); return; }
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (own && key === 'id') continue; walk(child); }
  };
  const { dataSources, ...rest } = document;
  walk(rest);
  for (const source of dataSources) walk(source, true);
  return uses;
}

/** The document without the sources nothing reads. */
export function removeUnusedSources(document: CompositionDocument): CompositionDocument {
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
