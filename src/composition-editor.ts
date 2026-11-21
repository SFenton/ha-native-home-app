import { z } from 'zod/v4';
import { compositionDocumentSchema, type CompositionDocument, type CompositionNode } from './shared/composition/schema';
import { compileCompositionDocument } from './shared/composition/compiler';
import { canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_ENVELOPE_BYTES, type CompositionIssue } from './shared/composition/json';
import { omitFoldSide } from './shared/composition/fold-sides';
import { createId as uid } from './shared/ids';
import type { Json } from './shared/types';
import { formatCompositionIssue } from './shared/composition/workspace';

export type SchemaField = {
  $ref?: string; type?: string | string[]; const?: Json; enum?: Json[];
  properties?: Record<string, SchemaField>; items?: SchemaField | SchemaField[];
  additionalProperties?: SchemaField | boolean; propertyNames?: SchemaField; pattern?: string;
  required?: string[];
  oneOf?: SchemaField[]; anyOf?: SchemaField[]; allOf?: SchemaField[]; definitions?: Record<string, SchemaField>;
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number; maxLength?: number;
  /** Set where the generator dropped a `expr` (text) or `conditional` (look) variant: the field is a value the Studio draws with ValueField. */
  xValue?: 'text' | 'look';
  /** The slot also accepts a value that follows an entity (`bound-color`, `bound-symbol`): From Entity is offered. */
  xBound?: boolean;
};
const schemaField: z.ZodType<SchemaField> = z.lazy(() => z.object({
  xValue: z.enum(['text', 'look']).optional(),
  xBound: z.boolean().optional(),
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
/**
 * Variants the contract has and the form editor cannot author yet: an authored string made by an operand (`expr`) and a look that follows a condition
 * (`conditional`). They are left out of the generated form so a field keeps the one look it has; a document that uses them still validates and compiles.
 * TODO(L-expr editor): the Rules editor and the token editor build these, and this list goes.
 */
/** The variants the form generator leaves out because ValueField draws them: a text slot's `expr` and a look's `conditional`. */
const valueVariants: Record<string, 'text' | 'look'> = { expr: 'text', conditional: 'look', 'bound-color': 'look', 'bound-symbol': 'look' };
/**
 * Fields the contract has and the form editor does not draw yet, by node type: `own` are fields of the node, `props` fields of its props. Empty now: the List's
 * `rowAction`, `refreshable` and `emptyMessage` are drawn by the Data tab's inspector rows (L-data), the last entry that was here.
 */
const notYetAuthoredFields: Record<string, { own?: string[]; props?: string[] }> = {};
const actionTypes = new Set(['push', 'call-service', 'select-tab', 'present', 'back', 'dismiss', 'set-local', 'domain', 'dismiss-then-push']);
function pruneUnauthored(node: unknown): void {
  if (Array.isArray(node)) { node.forEach(pruneUnauthored); return; }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, any>;
  const left = typeof record.properties?.type?.const === 'string' ? notYetAuthoredFields[record.properties.type.const] : undefined;
  if (left) {
    for (const key of left.own ?? []) delete record.properties[key];
    for (const key of left.props ?? []) delete record.properties.props?.properties?.[key];
    if (record.required) record.required = record.required.filter((key: string) => record.properties[key] !== undefined);
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const variants = record[key] as Record<string, any>[] | undefined;
    if (!variants) continue;
    // An action slot also takes `conditional` (By Rule): the action editor draws it, so it stays a variant there.
    const flat = (variant: Record<string, any>): Record<string, any>[] => (variant.anyOf ?? variant.oneOf)?.flatMap(flat) ?? [variant];
    const action = variants.flatMap(flat).some(variant => actionTypes.has(variant.properties?.type?.const));
    const drawn = (variant: Record<string, any>) => valueVariants[variant.properties?.type?.const] && !(action && variant.properties?.type?.const === 'conditional');
    const kept = variants.filter(variant => !drawn(variant));
    if (kept.length === variants.length) continue;
    const marker = valueVariants[variants.find(drawn)!.properties.type.const];
    if (kept.length === 1) { delete record[key]; Object.assign(record, kept[0]); } else record[key] = kept;
    record.xValue = marker;
    if (variants.some(variant => variant.properties?.type?.const === 'bound-color' || variant.properties?.type?.const === 'bound-symbol')) record.xBound = true;
  }
  Object.values(record).forEach(pruneUnauthored);
}
const generated = z.toJSONSchema(compositionDocumentSchema, { target: 'draft-7' });
pruneUnauthored(generated);
export const compositionEditorSchema = schemaField.parse(generated);
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
  const exact = variants.find(variant => {
    if (value === null) return variant.type === 'null';
    if (typeof value !== 'object') return variant.type === typeof value;
    if (Array.isArray(value)) return variant.type === 'array';
    return Object.entries(variant.properties ?? {}).every(([key, child]) => child.const === undefined || value[key] === child.const);
  });
  // A value still missing a fixed field (a new service call before the compiler adds its feedback) is the variant its `type` names.
  const named = !exact && value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string'
    ? variants.find(variant => variant.properties?.type?.const === value.type) : undefined;
  return exact ?? named ?? variants[0];
}
export function defaultField(schema: SchemaField, document: CompositionDocument, key = ''): Json {
  schema = resolveField(schema);
  if (schema.const !== undefined) return schema.const;
  const tag = schema.properties?.type?.const;
  if (tag === 'call-service') return { type: 'call-service', domain: 'light', service: 'turn_on' };
  if (tag === 'state' && schema.properties?.in) return { type: 'state', sourceId: document.dataSources.find(source => source.kind === 'ha-entity')?.id ?? '', path: ['state'], in: ['on'] };
  // A tint starts as the system grey the icon already draws, so adding one changes nothing until the colour is picked.
  if ((key === 'glyphTint' || key === 'discGlyphTint') && (schema.oneOf || schema.anyOf)) return { type: 'solid-rgb', red: 142, green: 142, blue: 147 };
  // An ink (`sh.text-style@1`) added to a part starts as the system grey, which reads on a light and a dark surface alike.
  if ((schema.oneOf || schema.anyOf) && fieldVariants(schema).some(variant => variant.properties?.type?.const === 'rgba')) return { type: 'solid-rgb', red: 142, green: 142, blue: 147 };
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
/**
 * Returns `root` with `value` placed at `path`. Only the objects and arrays along the path are copied; every other
 * subtree is shared with `root`, so an untouched node keeps its identity and a memoised view can skip it. `value` is
 * adopted as is (not cloned), so documents are treated as immutable: change one only through this function.
 */
export function replaceAt<T>(root: T, path: EditorPath, value: unknown): T {
  if (!path.length) throw new Error('Cannot replace the workspace identity');
  const rebuild = (current: unknown, depth: number): unknown => {
    if (!current || typeof current !== 'object') throw new Error('The selected composition property no longer exists');
    const key = path[depth];
    const copy: unknown = Array.isArray(current) ? [...current] : { ...current };
    Reflect.set(copy as object, key, depth === path.length - 1 ? value : rebuild(Reflect.get(current, key), depth + 1));
    return copy;
  };
  return rebuild(root, 0) as T;
}
/** What compiling said about a document, by document: a document is never changed in place, and every caller wants the same answer. */
const compiled = new WeakMap<object, CompositionIssue[]>();
const manifests = new WeakMap<object, string[]>();
/** The compiler's issues for a document, or none when it compiles. Compiling a large document is the costly step, so it happens once per document. */
export function compilerIssuesOf(document: unknown): CompositionIssue[] {
  const known = typeof document === 'object' && document ? compiled.get(document) : undefined;
  if (known) return known;
  let issues: CompositionIssue[] = [];
  try { const result = compileCompositionDocument(document); if (typeof document === 'object' && document) manifests.set(document, result.capabilities); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    issues = error.issues;
  }
  if (typeof document === 'object' && document) compiled.set(document, issues);
  return issues;
}
/** The capabilities a document declares, from the same compile as `compilerIssuesOf` (one compile per document); none for a document that does not compile. */
export function capabilitiesOf(document: object): string[] {
  compilerIssuesOf(document);
  return manifests.get(document) ?? [];
}
export function compositionErrors(document: unknown): string[] {
  return compilerIssuesOf(document).map(formatCompositionIssue);
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
/** One list of child nodes a container holds: where it lives under the container and the `parent` label its nodes carry. */
export type ChildSlot = { path: EditorPath; parent: string; nodes: CompositionNode[] };
/**
 * Every child list of a container, covering the same children as `compositionChildren` (grids, sections, rails, room
 * sections, paged rows, pinned actions and each local tab), with the path of each list relative to the node.
 */
export function childSlots(node: CompositionNode): ChildSlot[] {
  switch (node.type) {
    case 'tile-grid': case 'section': case 'status-rail': case 'room-section': case 'paged-row': case 'overlay': case 'stack': case 'repeat':
      return [{ path: ['children'], parent: node.id, nodes: node.children }];
    case 'pinned-actions':
      return node.children ? [{ path: ['children'], parent: node.id, nodes: node.children }] : [];
    case 'local-tabs':
      // With `blocks` the tabs' own children are empty (the compiler says so), and an area may be named like its tab: only the areas are slots.
      return [...(node.blocks ? [] : node.tabs.map((tab, index) => ({ path: ['tabs', index, 'children'], parent: `${node.id}:${tab.id}`, nodes: tab.children }))),
        ...(node.blocks ?? []).map((block, index) => ({ path: ['blocks', index, 'children'], parent: `${node.id}:${block.id}`, nodes: block.children }))];
    default: return [];
  }
}
/**
 * Every node of the pages and sheets with its path, in document order. `library` also visits the bodies of saved components (`componentLibrary`):
 * a body node's path is its place in the library, and the same node serves every place that uses it, so a caller that lists targets leaves them out.
 */
export function componentLocations(document: CompositionDocument, library = false): ComponentLocation[] {
  const result: ComponentLocation[] = [];
  const visit = (nodes: CompositionNode[], path: EditorPath, parent: string) => nodes.forEach((node, index) => {
    const at = [...path, index];
    result.push({ node, path: at, parent });
    for (const slot of childSlots(node)) visit(slot.nodes, [...at, ...slot.path], slot.parent);
  });
  for (const kind of ['pages', 'modals'] as const) document[kind].forEach((surface, index) => visit(surface.components, [kind, index, 'components'], surface.id));
  if (library) document.componentLibrary?.forEach((entry, index) => visit([entry.node], ['componentLibrary', index, 'node'], `component:${entry.id}`));
  return result;
}
export function moveCompositionNode(document: CompositionDocument, id: string, parent: { kind: 'surface' | 'grid' | 'section' | 'local-tab'; id: string; tabId?: string }): CompositionDocument {
  const locations = componentLocations(document), entry = locations.find(item => item.node.id === id) ?? componentLocations(document, true).find(item => item.node.id === id);
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
  const children = surface?.components ?? (container?.type === 'tile-grid' || container?.type === 'section' || container?.type === 'status-rail' || container?.type === 'room-section' || container?.type === 'stack' || container?.type === 'repeat' ? container.children
    : container?.type === 'local-tabs' ? (container.blocks ? container.blocks.find(block => block.id === parent.tabId)?.children : container.tabs.find(tab => tab.id === parent.tabId)?.children)
    : container?.type === 'overlay' ? container.children : undefined);
  if (!children) throw new Error('Choose a page, modal, grid, section or local tab as the parent');
  // A side belongs to a component at the top level of a page: a move into a modal or a container drops it.
  const onPage = surface !== undefined && next.pages.some(page => page.id === surface.id);
  const moved = structuredClone(entry.node);
  if (!onPage) moved.layout = omitFoldSide(moved.layout) as typeof moved.layout;
  if (container?.type !== 'tile-grid') moved.layout.span = 1;
  children.push(moved);
  return next;
}
export function compositionSourceText(document: CompositionDocument, pretty = false): string {
  const formatted = pretty ? JSON.stringify(document, null, 2) : canonicalCompositionJSON(document);
  return new TextEncoder().encode(formatted).byteLength + 1 <= MAX_COMPOSITION_ENVELOPE_BYTES
    ? `${formatted}\n` : `${canonicalCompositionJSON(document)}\n`;
}
