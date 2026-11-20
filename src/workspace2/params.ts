import { fieldVariants, replaceAt, valueAt, selectedVariant, variantName, type EditorPath } from '../composition-editor';
import {
  bodyNodes, COMPONENT_LIMITS, componentUses, fieldKind, fieldSteps, fieldsOverlap, findNode, findNodePath, nodeTitle, ownedSources, privateNames, readField, renameSources, type ComponentUse,
} from '../shared/composition/components';
import type { ComponentEntry, ComponentParamKind, ComponentRefNode, ComponentStringKind, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { identifierSchema } from '../shared/validation';
import { labelText, mechanicalLabel } from './labels';
import { dialRowLabel } from './dial/dialLabels';
import { schemaAt } from './schemaAt';
import { editSubtrees } from './editors/provenance';

/**
 * Settings of a template as pure operations (templates spec, "any field"). The author marks a field of a node inside the template as set per place;
 * the field's value in the body is the default. A field that fits one of the seven string kinds becomes a parameter of that kind and each place holds
 * its own string in `args`; any other field becomes a parameter of the kind `value`, whose place values (`values`, `sh.component-values@1`) are JSON
 * and default to the template's. Each function returns a new document.
 */

/** The words for a string kind, as the inspector says them. A `value` has none: its type is the field's. */
export const kindWords: Record<ComponentStringKind, string> = { 'source-id': 'Data source', 'page-id': 'Page', 'modal-id': 'Sheet', 'entity-id': 'Entity', 'state-id': 'State', text: 'Text', symbol: 'Symbol' };

/** What a field is called: its authored label, else its key in words, with a literal's `value` taking its wrapper's name. */
export function fieldLabel(owner: string, steps: readonly string[]): string {
  const parts = steps.map(step => /^\d+$/.test(step) ? Number(step) : step);
  const wrapped = parts.length > 1 && parts.at(-1) === 'value' ? parts.slice(0, -1) : parts;
  return labelText(owner, wrapped);
}

/** A name for a new parameter: the field's label as an identifier, made free by a number. */
export function suggestName(entry: ComponentEntry, field: { label: string }): string {
  const base = field.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'parameter';
  const names = new Set((entry.params ?? []).map(param => param.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Why a name cannot be used, in words, or undefined when it can. A name an existing parameter of the same kind has adds a field to that parameter. */
export function nameProblem(entry: ComponentEntry, name: string, kind: ComponentParamKind): string | undefined {
  if (!identifierSchema.safeParse(name).success) return 'Use letters, numbers, dots, underscores or hyphens, up to 80.';
  const same = entry.params?.find(param => param.name === name);
  if (same && same.kind !== kind) return 'That setting holds another kind of value.';
  if (!same && (entry.params?.length ?? 0) >= COMPONENT_LIMITS.params) return `A template holds ${COMPONENT_LIMITS.params} settings.`;
  return undefined;
}

const entryAt = (document: CompositionDocument, entryId: string) => {
  const index = document.componentLibrary?.findIndex(item => item.id === entryId) ?? -1;
  if (index < 0) throw new Error('That template is gone');
  return { index, entry: document.componentLibrary![index] };
};

/** The places of an entry with each reference run through `change`, one write for each. */
function rewritePlaces(document: CompositionDocument, entryId: string, change: (ref: ComponentRefNode) => ComponentRefNode): CompositionDocument {
  return componentUses(document, entryId).reduce((current: CompositionDocument, use: ComponentUse) => replaceAt(current, use.path, change(use.ref)), document);
}

/** `ref` with `key` as `next` (`undefined` takes the key off); an empty record goes too, so a place that sets nothing holds neither key. */
function withRecord(ref: ComponentRefNode, key: 'args' | 'values', next: Record<string, unknown> | undefined): ComponentRefNode {
  const { [key]: old, ...rest } = ref;
  void old;
  return (next && Object.keys(next).length ? { ...rest, [key]: next } : rest) as ComponentRefNode;
}

/** One parameter of an entry. */
export type Param = NonNullable<ComponentEntry['params']>[number];
/** How a parameter's field is written: a field of a body node, or a field of one of the entry's own sources. */
export type BindingTarget = { nodeId: string; sourceId?: undefined; field: string } | { sourceId: string; nodeId?: undefined; field: string };

/** The most characters a parameter's label holds (the contract's limit, `params[].label`). */
export const PARAM_LABEL_MAX = 80;
/** A parameter's label as the form shows it: its own, else its name in words. */
export const paramLabel = (param: Pick<Param, 'name' | 'label'>): string => param.label ?? mechanicalLabel(param.name);
/** Whether a label fits the contract: 1 to 80 characters once trimmed, no control or format characters. */
export const labelValid = (label: string): boolean => label.trim().length > 0 && label.trim().length <= PARAM_LABEL_MAX && !/[\p{Cc}\p{Cf}]/u.test(label);

const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const sameTarget = (binding: { nodeId?: string; sourceId?: string; field: string }, target: BindingTarget) =>
  binding.field === target.field && binding.nodeId === target.nodeId && binding.sourceId === target.sourceId;

/**
 * Adds one binding: a new `name` adds the parameter (with `label`) and, for a string kind, gives every place the field's current value as its own (a
 * `value` parameter gives the places nothing: they follow the template until they set their own); a name that exists (of the same kind) fills one more
 * field, and the places keep what they have. `value` is what the field holds now. `adopt` changes the entry first (a template taking a copy of a source).
 */
function bind(document: CompositionDocument, entryId: string, target: BindingTarget, kind: ComponentParamKind, name: string, value: string | undefined, label?: string, adopt?: (entry: ComponentEntry) => ComponentEntry): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const problem = nameProblem(entry, name, kind);
  if (problem) throw new Error(problem);
  if ((entry.bindings ?? []).some(binding => sameTarget(binding, target))) throw new Error('That field is already set per place');
  if ((entry.bindings?.length ?? 0) >= COMPONENT_LIMITS.bindings) throw new Error(`A template holds ${COMPONENT_LIMITS.bindings} fields as settings.`);
  const exists = entry.params?.some(param => param.name === name) ?? false;
  const base = adopt ? adopt(entry) : entry;
  const next: ComponentEntry = {
    ...base,
    params: exists ? entry.params : [...(entry.params ?? []), { name, kind, ...(label ? { label } : {}) }],
    bindings: [...(entry.bindings ?? []), { param: name, ...(target.nodeId !== undefined ? { nodeId: target.nodeId } : { sourceId: target.sourceId }), field: target.field }],
  };
  const written = replaceAt(document, ['componentLibrary', index], next);
  return exists || kind === 'value' ? written : rewritePlaces(written, entryId, ref => withRecord(ref, 'args', { ...(ref.args ?? {}), [name]: value! }));
}

// MARK: - Set per place

/** What Choose Fields can do with one row of a body node, and how. */
export interface PerPlaceTarget {
  kind: ComponentParamKind;
  /** The field's label, which becomes the setting's label. */
  label: string;
  /** Where the binding is written. */
  binding: BindingTarget;
  /** What the field holds now: the string of a string kind, else any JSON (`undefined` when the field is absent from the body). */
  value: unknown;
  /** For a `value`: the field's schema and whether it is optional, as one string, so a setting is offered only to a field of the same shape. */
  shape?: string;
  /** For an entity the node reads through a source the template does not own yet: the template takes a copy under the same id. */
  adopt?: { sourceId: string };
}

const sourceFields = new Set(['binding/sourceId', 'props/sourceId']);
/** The keys the expansion owns on a node, which no place may set: its identity and its child lists. */
const ownKeys = new Set(['id', 'type', 'children', 'tabs', 'blocks']);

/** Where a body node sits in the document, for the editor schema: `['componentLibrary', 0, 'node', 'children', 1]`. */
function libraryPath(document: Pick<CompositionDocument, 'componentLibrary'>, entry: ComponentEntry, node: CompositionNode): EditorPath | undefined {
  const index = document.componentLibrary?.findIndex(item => item.id === entry.id) ?? -1;
  const inside = findNodePath(entry.node, node.id);
  return index < 0 || !inside ? undefined : ['componentLibrary', index, 'node', ...inside];
}

/** `value` as JSON text with its keys in order, so two equal schemas give one string. */
const stable = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(',')}}`;

/**
 * The shape of one field of a body node: its schema in the editor (what the row draws) and whether it is optional, as canonical JSON. Two fields of one
 * shape accept the same values, so a `value` setting is shared only between them. Undefined when the node is not in the entry.
 */
export function schemaKey(document: CompositionDocument, entry: ComponentEntry, node: CompositionNode, field: string): string | undefined {
  const base = libraryPath(document, entry, node), steps = fieldSteps(field);
  if (!base || !steps.length) return undefined;
  const holder = [...base, ...steps.slice(0, -1)];
  const parent = valueAt(document, holder) as Record<string, never> | undefined;
  const required = parent ? selectedVariant(schemaAt(document, holder), parent).required?.includes(steps.at(-1)!) ?? false : false;
  return stable({ schema: schemaAt(document, [...base, ...steps]), required });
}

/** Whether the schema of the row at `steps` is the single variant `name` (a literal or an SF Symbol and nothing else). */
function onlyVariant(document: CompositionDocument, base: EditorPath, steps: string[], name: string): boolean {
  const variants = fieldVariants(schemaAt(document, [...base, ...steps]));
  return variants.length === 1 && variantName(variants[0]) === name;
}

/**
 * What a row of a body node can be set per place as, or undefined (templates spec, "any field", section 2). The first that fits:
 *
 * 1. An entity or a state: a field of kind `entity-id` or `state-id`, and the Entity row of a node that reads one entity through a source
 *    (`binding/sourceId`, `props/sourceId`), which the template owns a copy of.
 * 2. Another string kind, when the whole of what the row edits is one string of that kind: a title, a page, a sheet, a source, a literal that is only a
 *    literal, a symbol.
 * 3. A `value`, on the row's whole value, for everything else: a colour, a number, a switch, a choice, a rule, a condition, a union.
 *
 * Not a node's id, type or child lists, an overlay's anchors, the root's width, or a row inside or around a field that is already set (a rule list
 * that is one setting cannot also have one of its rules set).
 */
export function rowTarget(document: CompositionDocument, entry: ComponentEntry, node: CompositionNode, field: string): PerPlaceTarget | undefined {
  const steps = fieldSteps(field);
  if (!steps.length || node.type === 'component-ref') return undefined;
  const label = (node.type === 'dial-control' ? dialRowLabel(node, steps) : undefined) ?? fieldLabel(node.type, steps);
  const kind = fieldKind(node, field);
  if (kind === 'entity-id' || kind === 'state-id') return { kind, label, binding: { nodeId: node.id, field }, value: readField(node, field) };
  if (kind === 'source-id' && sourceFields.has(field)) {
    const id = readField(node, field) as string;
    const owned = entry.sources?.find(source => source.id === id);
    if (owned) return { kind: 'entity-id', label: 'Entity', binding: { sourceId: owned.id, field: 'entityId/value' }, value: owned.entityId.value };
    const shared = document.dataSources.find(source => source.id === id);
    if (shared?.kind !== 'ha-entity' || shared.entityId.type !== 'literal') return undefined;
    return { kind: 'entity-id', label: 'Entity', binding: { sourceId: id, field: 'entityId/value' }, value: shared.entityId.value, adopt: { sourceId: id } };
  }
  // Another setting's field, over or under this row, keeps it out of reach: one field is set one way.
  if (entry.bindings?.some(binding => binding.nodeId === node.id && binding.field !== field && fieldsOverlap(binding.field, field))) return undefined;
  const base = libraryPath(document, entry, node);
  if (kind) return { kind, label, binding: { nodeId: node.id, field }, value: readField(node, field) };
  if (ownKeys.has(steps[0]) || (node.type === 'overlay' && field.startsWith('props/anchors')) || (node.id === entry.node.id && steps[0] === 'layout')) return undefined;
  if (base) {
    const text = fieldKind(node, `${field}/value`), name = fieldKind(node, `${field}/name`);
    if (text === 'text' && onlyVariant(document, base, steps, 'literal')) return { kind: 'text', label, binding: { nodeId: node.id, field: `${field}/value` }, value: readField(node, `${field}/value`) };
    if (name === 'symbol' && onlyVariant(document, base, steps, 'sf-symbol')) return { kind: 'symbol', label, binding: { nodeId: node.id, field: `${field}/name` }, value: readField(node, `${field}/name`) };
  }
  const holder = readField(node, steps.slice(0, -1).join('/'));
  if (holder === null || typeof holder !== 'object' || Array.isArray(holder)) return undefined;
  return { kind: 'value', label, binding: { nodeId: node.id, field }, value: readField(node, field), shape: schemaKey(document, entry, node, field) };
}

/** The parameter a row is set per place as, or undefined. */
export function perPlaceParam(document: CompositionDocument, entry: ComponentEntry, node: CompositionNode, field: string): Param | undefined {
  const target = rowTarget(document, entry, node, field);
  const binding = target && entry.bindings?.find(item => sameTarget(item, target.binding));
  return binding ? entry.params?.find(param => param.name === binding.param) : undefined;
}

/**
 * The settings a row may join (the "Use Light" menu): for a string kind, the settings of that kind; for a `value`, the settings of that kind whose first
 * field has the same shape (the same editor schema and the same optionality).
 */
export function shareable(document: CompositionDocument, entry: ComponentEntry, target: PerPlaceTarget): Param[] {
  return (entry.params ?? []).filter(param => {
    if (param.kind !== target.kind) return false;
    if (target.kind !== 'value') return true;
    const first = entry.bindings?.find(binding => binding.param === param.name && binding.nodeId !== undefined);
    const owner = first?.nodeId !== undefined ? findNode(entry.node, first.nodeId) : undefined;
    return Boolean(owner && first) && schemaKey(document, entry, owner!, first!.field) === target.shape;
  });
}

/** The label a new setting takes: the field's, or "Title of Demo Fan" when another setting already has it (cut to the contract's 80 characters). */
export function uniqueLabel(entry: ComponentEntry, label: string, owner: string): string {
  const taken = new Set((entry.params ?? []).map(param => paramLabel(param).toLowerCase()));
  const next = taken.has(label.toLowerCase()) ? `${label} of ${owner}` : label;
  return next.length > PARAM_LABEL_MAX ? next.slice(0, PARAM_LABEL_MAX).trimEnd() : next;
}

/**
 * Sets a row of the node `nodeId` per place: every place can then have its own value. With no `join` it adds a parameter named by `suggestName`
 * and labelled with the field's label; with `join`, the name of a setting `shareable` offers, it fills this field from that setting too, so one
 * entity or one colour fills many fields. A string kind starts each place with what the field holds now; a `value` starts them with nothing, so they
 * follow the template. An entity a node reads through a source the template does not own yet is copied into the template (`entry.sources`).
 */
export function setPerPlace(document: CompositionDocument, entryId: string, nodeId: string, field: string, join?: string): CompositionDocument {
  const { entry } = entryAt(document, entryId);
  const node = findNode(entry.node, nodeId);
  const target = node ? rowTarget(document, entry, node, field) : undefined;
  if (!node || !target) throw new Error('That field cannot be set per place');
  if (target.kind === 'entity-id' && !ENTITY_ID.test(target.value as string)) throw new Error('Choose an entity first.');
  const joined = join === undefined ? undefined : shareable(document, entry, target).find(param => param.name === join);
  if (join !== undefined && !joined) throw new Error('That setting holds another kind of value.');
  const name = join ?? suggestName(entry, target);
  const adopt = target.adopt
    ? (current: ComponentEntry): ComponentEntry => {
      if ((current.sources?.length ?? 0) >= COMPONENT_LIMITS.sources) throw new Error(`A template holds ${COMPONENT_LIMITS.sources} sources of its own.`);
      return { ...current, sources: [...(current.sources ?? []), { id: target.adopt!.sourceId, kind: 'ha-entity', entityId: { type: 'literal', value: target.value as string } }] };
    } : undefined;
  const label = joined ? undefined : uniqueLabel(entry, target.label, nodeTitle(node));
  return bind(document, entryId, target.binding, target.kind, name, target.kind === 'value' ? undefined : target.value as string, label, adopt);
}

/** Takes the field back from its parameter: the field keeps what the template holds, and the parameter goes with its last field, and each place's own value with it. */
export function sameEverywhere(document: CompositionDocument, entryId: string, nodeId: string, field: string): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const node = findNode(entry.node, nodeId);
  const target = node ? rowTarget(document, entry, node, field) : undefined;
  const binding = target && entry.bindings?.find(item => sameTarget(item, target.binding));
  if (!binding) throw new Error('That field is not set per place');
  const rest = (entry.bindings ?? []).filter(item => item !== binding);
  if (rest.some(item => item.param === binding.param)) {
    const { bindings: oldBindings, ...others } = entry;
    void oldBindings;
    return editSubtrees(document, replaceAt(document, ['componentLibrary', index], { ...others, bindings: rest }),
      { deleted: [['componentLibrary', index, 'bindings', entry.bindings!.indexOf(binding)]] });
  }
  return removeParameter(document, entryId, binding.param);
}

/** Changes a parameter's label; an empty label takes it off, so the form falls back to the name in words. */
export function setParamLabel(document: CompositionDocument, entryId: string, name: string, label: string): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const text = label.trim();
  if (text && !labelValid(text)) throw new Error(`Name the setting in 1 to ${PARAM_LABEL_MAX} characters`);
  const params = (entry.params ?? []).map(param => {
    if (param.name !== name) return param;
    const { label: old, ...rest } = param;
    void old;
    return text ? { ...rest, label: text } : rest;
  });
  return replaceAt(document, ['componentLibrary', index], { ...entry, params });
}

/** Removes the parameter `name`: its bindings, and each place's own value for it (an argument or a value). The fields keep what the body holds. */
export function removeParameter(document: CompositionDocument, entryId: string, name: string): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const params = (entry.params ?? []).filter(param => param.name !== name);
  const bindings = (entry.bindings ?? []).filter(binding => binding.param !== name);
  const { params: oldParams, bindings: oldBindings, ...rest } = entry;
  void oldParams; void oldBindings;
  const next: ComponentEntry = { ...rest, ...(params.length ? { params } : {}), ...(bindings.length ? { bindings } : {}) };
  const written = replaceAt(document, ['componentLibrary', index], next);
  const without = (record: Record<string, unknown> | undefined) => { if (!record) return undefined; const { [name]: gone, ...others } = record; void gone; return others; };
  const deleted: EditorPath[] = [
    ...(entry.params ?? []).flatMap((param, at) => param.name === name ? [['componentLibrary', index, 'params', at]] : []),
    ...(entry.bindings ?? []).flatMap((binding, at) => binding.param === name ? [['componentLibrary', index, 'bindings', at]] : []),
  ];
  if (!params.length) deleted.push(['componentLibrary', index, 'params']);
  if (!bindings.length) deleted.push(['componentLibrary', index, 'bindings']);
  for (const use of componentUses(document, entryId)) for (const key of ['args', 'values'] as const) {
    const record = use.ref[key];
    if (record && Object.hasOwn(record, name)) deleted.push([...use.path, key, ...Object.keys(record).length === 1 ? [] : [name]]);
  }
  const nextDocument = rewritePlaces(written, entryId, ref => withRecord(withRecord(ref, 'args', without(ref.args) as Record<string, string> | undefined), 'values', without(ref.values)));
  return editSubtrees(document, nextDocument, { deleted });
}

/** Sets one place's value for a string parameter. */
export function setArgument(document: CompositionDocument, refPath: readonly (string | number)[], name: string, value: string): CompositionDocument {
  const ref = valueAt(document, [...refPath]) as { args?: Record<string, string> };
  return replaceAt(document, [...refPath], { ...ref, args: { ...(ref.args ?? {}), [name]: value } });
}

/** What the template holds for a `value` parameter: its first field's value in the body (undefined when the field is absent). */
export function templateValue(entry: ComponentEntry, name: string): unknown {
  const binding = entry.bindings?.find(item => item.param === name && item.nodeId !== undefined);
  const owner = binding?.nodeId !== undefined ? findNode(entry.node, binding.nodeId) : undefined;
  return owner && binding ? readField(owner, binding.field) : undefined;
}

/**
 * Sets one place's value for a `value` parameter. A value equal to the template's is no entry (the place follows the template), and a source key that
 * names this place's copy of one of the template's own sources (`<place>~<source>`) is written as the body's id, as the contract expects.
 */
export function setValue(document: CompositionDocument, refPath: readonly (string | number)[], name: string, value: unknown): CompositionDocument {
  const ref = valueAt(document, [...refPath]) as ComponentRefNode;
  const entry = document.componentLibrary?.find(item => item.id === ref.componentId);
  if (!entry) throw new Error('That template is gone');
  const own = entry && privateNames(ref.id, entry);
  const plain = own?.size ? renameSources(value, new Map([...own].map(([source, derived]) => [derived, source]))) : value;
  const same = templateValue(entry, name);
  if (stable(plain) === stable(same) || (same === undefined && plain === null)) return resetValue(document, refPath, name);
  return replaceAt(document, [...refPath], withRecord(ref, 'values', { ...(ref.values ?? {}), [name]: plain }));
}

/** Takes the place's own value for a `value` parameter away, so it follows the template again. */
export function resetValue(document: CompositionDocument, refPath: readonly (string | number)[], name: string): CompositionDocument {
  const ref = valueAt(document, [...refPath]) as ComponentRefNode;
  if (!ref.values || !Object.hasOwn(ref.values, name)) return document;
  const { [name]: gone, ...rest } = ref.values;
  void gone;
  return replaceAt(document, [...refPath], withRecord(ref, 'values', rest));
}

/** The node and the label of the field a binding fills: for a source's field, the first node that reads the source, labelled "Entity". */
function bindingPlace(entry: ComponentEntry, binding: NonNullable<ComponentEntry['bindings']>[number]): { label: string; place: string } | undefined {
  if (binding.nodeId !== undefined) {
    const node = findNode(entry.node, binding.nodeId);
    return node ? { label: fieldLabel(node.type, fieldSteps(binding.field)), place: nodeTitle(node) } : undefined;
  }
  const user = bodyNodes(entry.node).find(node => [...sourceFields].some(field => readField(node, field) === binding.sourceId));
  return { label: 'Entity', place: user ? nodeTitle(user) : binding.sourceId ?? '' };
}

/** Where a parameter's fields are, in words: "Title of Door Tile", with "and 2 more" for the rest. */
export function bindingWords(entry: ComponentEntry, name: string): string {
  const bound = (entry.bindings ?? []).filter(binding => binding.param === name);
  const first = bound[0] ? bindingPlace(entry, bound[0]) : undefined;
  if (!first) return '';
  return `${first.label} of ${first.place}${bound.length > 1 ? ` and ${bound.length - 1} more` : ''}`;
}

/** The fields a kind names in the body (for the places that show a parameter's default): the first bound field's current value. */
export function defaultOf(entry: ComponentEntry, name: string): string {
  const binding = entry.bindings?.find(item => item.param === name);
  const owner = binding?.nodeId !== undefined ? findNode(entry.node, binding.nodeId) : ownedSources(entry).find(source => source.id === binding?.sourceId);
  const value = owner && binding ? readField(owner, binding.field) : undefined;
  return typeof value === 'string' ? value : '';
}
