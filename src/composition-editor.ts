import { z } from 'zod/v4';
import { compositionDocumentSchema, type CompositionDocument, type CompositionNode } from './shared/composition/schema';
import { compileCompositionDocument } from './shared/composition/compiler';
import { canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES, parseCompositionJSON } from './shared/composition/json';
import { uid } from './editor';
import type { Json } from './shared/types';
import { formatCompositionIssue } from './shared/composition/workspace';

export type SchemaField = {
  $ref?: string; type?: string | string[]; const?: Json; enum?: Json[];
  properties?: Record<string, SchemaField>; items?: SchemaField | SchemaField[];
  additionalProperties?: SchemaField | boolean; propertyNames?: SchemaField; pattern?: string;
  required?: string[];
  oneOf?: SchemaField[]; anyOf?: SchemaField[]; allOf?: SchemaField[]; definitions?: Record<string, SchemaField>;
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number; maxLength?: number;
};
const schemaField: z.ZodType<SchemaField> = z.lazy(() => z.object({
  $ref: z.string().optional(), type: z.union([z.string(), z.array(z.string())]).optional(),
  const: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  properties: z.record(z.string(), schemaField).optional(),
  additionalProperties: z.union([schemaField, z.boolean()]).optional(),
  propertyNames: schemaField.optional(), pattern: z.string().optional(),
  required: z.array(z.string()).optional(),
  items: z.union([schemaField, z.array(schemaField), z.boolean().transform(() => ({}))]).optional(),
  oneOf: z.array(schemaField).optional(), anyOf: z.array(schemaField).optional(), allOf: z.array(schemaField).optional(),
  definitions: z.record(z.string(), schemaField).optional(),
  minimum: z.number().optional(), maximum: z.number().optional(), minItems: z.number().optional(),
  maxItems: z.number().optional(), maxLength: z.number().optional(),
}));
export const compositionEditorSchema = schemaField.parse(z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' }));
/** The generated definition of a composition node (the recursive union every container's children share). */
export function nodeDefinition(): SchemaField {
  const found = Object.values(compositionEditorSchema.definitions ?? {}).find(definition =>
    (definition.anyOf ?? definition.oneOf)?.some(variant => variant.properties?.type?.const === 'tile-grid'));
  if (!found) throw new Error('The node definition is missing from the generated schema');
  return found;
}
export type EditorPath = (string | number)[];
export function resolveField(schema: SchemaField): SchemaField {
  // A schema carrying only a reference and a check is emitted as a single-member allOf.
  if (schema.allOf?.length === 1 && !schema.$ref) return resolveField(schema.allOf[0]);
  if (!schema.$ref) return schema;
  const definition = compositionEditorSchema.definitions?.[schema.$ref.split('/').at(-1)!];
  if (!definition) throw new Error('Unsupported composition schema reference');
  return definition;
}
export function fieldVariants(schema: SchemaField): SchemaField[] {
  const resolved = resolveField(schema);
  return (resolved.oneOf ?? resolved.anyOf)?.flatMap(fieldVariants) ?? [resolved];
}
export function variantName(schema: SchemaField): string {
  return String(schema.properties?.type?.const ?? schema.properties?.model?.const ?? schema.properties?.control?.const ?? schema.properties?.kind?.const ?? schema.type ?? 'value');
}
export function selectedVariant(schema: SchemaField, value: Json): SchemaField {
  const variants = fieldVariants(schema);
  return variants.find(variant => {
    if (value === null) return variant.type === 'null';
    if (typeof value !== 'object') return variant.type === typeof value;
    if (Array.isArray(value)) return variant.type === 'array';
    return Object.entries(variant.properties ?? {}).every(([key, child]) => child.const === undefined || value[key] === child.const);
  }) ?? variants[0];
}
export function defaultField(schema: SchemaField, document: CompositionDocument, key = ''): Json {
  schema = resolveField(schema);
  if (schema.const !== undefined) return schema.const;
  const tag = schema.properties?.type?.const;
  if (tag === 'call-service') return { type: 'call-service', domain: 'light', service: 'turn_on' };
  if (tag === 'state' && schema.properties?.in) return { type: 'state', sourceId: document.dataSources.find(source => source.kind === 'ha-entity')?.id ?? '', path: ['state'], in: ['on'] };
  if (schema.oneOf || schema.anyOf) return defaultField(fieldVariants(schema)[0], document, key);
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') {
    const fields = Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([name]) => schema.required?.includes(name))
      .map(([name, child]) => [name, defaultField(child, document, name)]));
    if (schema.properties?.presentation && schema.properties.toolbar) fields.toolbar = { type: 'replace', groups: [] };
    return fields;
  }
  if (schema.type === 'array') {
    if (Array.isArray(schema.items)) return schema.items.map(item => defaultField(item, document));
    const items = schema.items ?? {};
    return Array.from({ length: schema.minItems ?? 0 }, () => defaultField(items, document));
  }
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  if (schema.type === 'boolean') return key === 'showsChevron';
  if (schema.type === 'null') return null;
  if (key === 'id') return uid('native');
  if (key === 'pageId' || key === 'initialPageId') return document.pages[0].id;
  if (key === 'tabId') return document.navigation.tabs[0]?.id ?? '';
  if (key === 'modalId') return document.modals[0]?.id ?? '';
  if (key === 'sourceId') return document.dataSources[0]?.id ?? '';
  if (key === 'stateId') return document.localState?.[0]?.id ?? '';
  if (key === 'providerId' || key === 'searchProviderId') return 'sample-provider';
  if (key === 'key') return 'name';
  if (key === 'saveLabel') return 'Save';
  if (key === 'searchPrompt') return 'Search';
  if (key === 'emptyText') return 'No items';
  if (key === 'name') return 'square.grid.2x2';
  if (key === 'title' || key === 'label' || key === 'menuLabel') return 'New item';
  if (key === 'unavailableText') return 'Unavailable';
  if (key === 'confirmLabel') return 'Confirm';
  if (key === 'cancelLabel') return 'Cancel';
  if (key === 'tonightLabel') return 'Tonight';
  if (key === 'allNightsLabel') return 'All nights';
  if (key === 'fallbackName') return 'Signed In';
  if (key === 'loadingText') return 'Loading';
  return '';
}
export function changeFieldVariant(schema: SchemaField, previous: Json, document: CompositionDocument, key: string): Json {
  const next = defaultField(schema, document, key);
  if (next && typeof next === 'object' && !Array.isArray(next) && previous && typeof previous === 'object' && !Array.isArray(previous)) {
    for (const field of ['id', 'title', 'label', 'icon', 'layout'])
      if (Object.hasOwn(next, field) && Object.hasOwn(previous, field)) next[field] = structuredClone(previous[field]);
  }
  return next;
}
export function valueAt(root: unknown, path: EditorPath): unknown {
  return path.reduce<unknown>((value, key) => value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined, root);
}
export function replaceAt<T>(root: T, path: EditorPath, value: unknown): T {
  if (!path.length) throw new Error('Cannot replace the workspace identity');
  const next = structuredClone(root);
  const owner = valueAt(next, path.slice(0, -1));
  if (!owner || typeof owner !== 'object') throw new Error('The selected composition property no longer exists');
  Reflect.set(owner, path.at(-1)!, structuredClone(value));
  return next;
}
export function compositionErrors(document: unknown): string[] {
  try { compileCompositionDocument(document); return []; }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return error.issues.map(formatCompositionIssue);
  }
}
export function removeCompositionItem(document: CompositionDocument, path: EditorPath, index: number): CompositionDocument {
  const items = valueAt(document, path);
  if (!Array.isArray(items) || index < 0 || index >= items.length) throw new Error('The selected item no longer exists');
  const removed = items[index], collection = path.join('/');
  const referenceKeys = new Set(
    collection === 'pages' ? ['pageId', 'initialPageId'] : collection === 'modals' ? ['modalId']
      : collection === 'navigation/tabs' ? ['tabId', 'initialTabId'] : collection === 'dataSources' ? ['sourceId']
        : collection === 'assets' ? ['assetId'] : collection === 'localState' ? ['stateId'] : [],
  );
  const removedId = removed && typeof removed === 'object' && 'id' in removed ? removed.id : undefined;
  const next = replaceAt(document, path, items.filter((_, position) => position !== index));
  const references: string[] = [];
  const check = (value: unknown, at: string) => {
    if (!value || typeof value !== 'object') return;
    Object.entries(value).forEach(([key, child]) => {
      if (referenceKeys.has(key) && typeof child === 'string' && child === removedId) references.push(`${at}/${key}`);
      check(child, `${at}/${key}`);
    });
  };
  check(next, '/document');
  if (references.length) throw new Error(`Cannot delete a referenced item. Reassign these relationships first:\n${references.join('\n')}`);
  if (!next.pages.length) throw new Error('At least one page is required');
  return next;
}
export function reorderCompositionItem(document: CompositionDocument, path: EditorPath, index: number, offset: number) {
  const items = valueAt(document, path);
  if (!Array.isArray(items) || index + offset < 0 || index + offset >= items.length) return document;
  const next = [...items], [item] = next.splice(index, 1);
  next.splice(index + offset, 0, item);
  return replaceAt(document, path, next);
}
export type ComponentLocation = { node: CompositionNode; path: EditorPath; parent: string };
export function componentLocations(document: CompositionDocument): ComponentLocation[] {
  const result: ComponentLocation[] = [];
  const visit = (nodes: CompositionNode[], path: EditorPath, parent: string) => nodes.forEach((node, index) => {
    const at = [...path, index];
    result.push({ node, path: at, parent });
    if (node.type === 'tile-grid' || node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section') visit(node.children, [...at, 'children'], node.id);
    if (node.type === 'local-tabs') node.tabs.forEach((tab, tabIndex) =>
      visit(tab.children, [...at, 'tabs', tabIndex, 'children'], `${node.id}:${tab.id}`));
  });
  for (const kind of ['pages', 'modals'] as const) document[kind].forEach((surface, index) => visit(surface.components, [kind, index, 'components'], surface.id));
  return result;
}
export function moveCompositionNode(document: CompositionDocument, id: string, parent: { kind: 'surface' | 'grid' | 'section' | 'local-tab'; id: string; tabId?: string }): CompositionDocument {
  const locations = componentLocations(document), entry = locations.find(item => item.node.id === id);
  if (!entry) throw new Error('Select a component to move');
  const target = parent.kind !== 'surface' ? locations.find(item => item.node.id === parent.id) : undefined;
  if (target && target.path.slice(0, entry.path.length).join('/') === entry.path.join('/'))
    throw new Error('A component cannot be moved into itself or its descendants');
  const next = structuredClone(document);
  const siblings = valueAt(next, entry.path.slice(0, -1));
  if (!Array.isArray(siblings)) throw new Error('Component parent is unavailable');
  siblings.splice(Number(entry.path.at(-1)), 1);
  const surface = parent.kind === 'surface' ? [...next.pages, ...next.modals].find(surface => surface.id === parent.id) : undefined;
  const container = parent.kind !== 'surface' ? componentLocations(next).find(item => item.node.id === parent.id)?.node : undefined;
  const children = surface?.components ?? (container?.type === 'tile-grid' || container?.type === 'section' || container?.type === 'status-rail' || container?.type === 'room-section' ? container.children
    : container?.type === 'local-tabs' ? container.tabs.find(tab => tab.id === parent.tabId)?.children : undefined);
  if (!children) throw new Error('Choose a page, modal, grid, section or local tab as the parent');
  const moved = structuredClone(entry.node);
  if (container?.type !== 'tile-grid') moved.layout.span = 1;
  children.push(moved);
  return next;
}
export function importCompositionText(text: string, documentId: string): CompositionDocument {
  const parsed = parseCompositionJSON(new TextEncoder().encode(text));
  const { document } = compileCompositionDocument(parsed);
  // Import is explicitly content-only; publisher and document identity belong to this workspace.
  return { ...document, id: documentId };
}
export function compositionSourceText(document: CompositionDocument, pretty = false): string {
  const formatted = pretty ? JSON.stringify(document, null, 2) : canonicalCompositionJSON(document);
  return new TextEncoder().encode(formatted).byteLength + 1 <= MAX_COMPOSITION_ENVELOPE_BYTES
    ? `${formatted}\n` : `${canonicalCompositionJSON(document)}\n`;
}
