import { compositionEditorSchema, defaultField, fieldVariants, resolveField, variantName } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { checkedBody, expandRef, expandSources, isSourceKey, ownedSources, privateNames, renameSources } from '../../shared/composition/components';
import { plainDocument } from '../data/logic/logicPlain';
import type { ComponentRefNode } from '../../shared/composition/schema';
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

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Source fields after the compiler's component binding/namespace expansion, including value parameters. */
export function dataReferences(document: CompositionDocument, value: unknown): { sources: string[]; entities: string[] } {
  const found: string[] = [], entities: string[] = [];
  const fill = (value: unknown, args: Record<string, unknown>): unknown => {
    if (Array.isArray(value)) return value.map(item => fill(item, args));
    if (!record(value)) return value;
    if (value.type === 'hole' && typeof value.name === 'string') return args[value.name] ?? value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fill(child, args)]));
  };
  const walk = (value: unknown, args: Record<string, unknown> = {}, stack = new Set<string>(), field = '') => {
    if (typeof value === 'string' && (/entity_?ids?$/i.test(field) || field === 'copySourceId') && /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) entities.push(value);
    if (Array.isArray(value)) { value.forEach(item => walk(item, args, stack, field)); return; }
    if (!record(value)) return;
    if (value.type === 'component-ref') {
      const entry = document.componentLibrary?.find(item => item.id === value.componentId);
      if (entry) {
        const ref = value as ComponentRefNode;
        // The compiler checks declared source arguments even when no binding currently consumes them.
        for (const param of entry.params ?? []) {
          const id = ref.args?.[param.name];
          if (param.kind === 'source-id' && typeof id === 'string') found.push(id);
        }
        walk(expandRef(ref, entry), args, stack);
        walk(expandSources(ref, entry), args, stack);
      }
      return;
    }
    if (value.type === 'logic-ref') {
      const entry = document.logicLibrary?.find(item => item.id === value.logicId);
      if (entry && !stack.has(entry.id)) {
        walk(entry.body, record(value.args) ? fill(value.args, args) as Record<string, unknown> : {}, new Set([...stack, entry.id]), field);
      }
      return;
    }
    if (value.type === 'hole') {
      if (typeof value.name === 'string' && args[value.name] !== undefined) walk(args[value.name], {}, stack, field);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const resolved = isSourceKey(key) || /(?:source|provider)Ids$/i.test(key) ? fill(child, args) : child;
      if (isSourceKey(key) && typeof resolved === 'string') found.push(resolved);
      else if (/(?:source|provider)Ids$/i.test(key) && Array.isArray(resolved)) {
        for (const id of resolved) if (typeof id === 'string') found.push(id);
      }
      walk(child, args, stack, key === 'value' ? value.type === 'entity-id' ? 'entityId' : field : key);
    }
  };
  walk(value);
  return { sources: found, entities };
}

/** The compiler checks library defaults as well as placed expansions; neither may lose a referenced global source. */
export function sourceUses(document: CompositionDocument): Map<string, number> {
  const uses = new Map<string, number>(document.dataSources.map(source => [source.id, 0]));
  const plain = plainDocument(document);
  const add = (value: unknown, context = plain) => {
    for (const id of dataReferences(context, value).sources) if (uses.has(id)) uses.set(id, uses.get(id)! + 1);
  };
  // Logic arguments must become source fields before private names are rewritten, as in the compiler.
  const { componentLibrary, logicLibrary: _logicLibrary, ...rest } = plain;
  add(rest);
  for (const entry of componentLibrary ?? []) {
    add(checkedBody(entry));
    add(renameSources(ownedSources(entry), privateNames(entry.id, entry)));
  }
  for (const entry of document.logicLibrary ?? []) {
    add({ type: 'logic-ref', logicId: entry.id, args: Object.fromEntries(entry.params.filter(param => param.sample !== undefined).map(param => [param.name, param.sample])) }, document);
  }
  return uses;
}

/** Entity sources are Studio-managed. Pruning and the edit that orphaned them share one history entry. Models stay editable. */
export function pruneEntitySources(before: CompositionDocument, document: CompositionDocument): CompositionDocument {
  const previous = sourceUses(before);
  let next = document;
  for (;;) {
    const uses = sourceUses(next);
    const dataSources = next.dataSources.filter(source => source.kind !== 'ha-entity' || !previous.get(source.id) || (uses.get(source.id) ?? 0) > 0);
    if (dataSources.length === next.dataSources.length) return next;
    next = { ...next, dataSources };
  }
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
