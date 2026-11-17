import { replaceAt, valueAt } from '../composition-editor';
import {
  bodyNodes, COMPONENT_LIMITS, componentUses, fieldKind, fieldSteps, findNode, nodeTitle, ownedSources, readField, type ComponentUse,
} from '../shared/composition/components';
import type { ComponentEntry, ComponentParamKind, CompositionDocument, CompositionNode } from '../shared/composition/schema';
import { identifierSchema } from '../shared/validation';
import { labelText, mechanicalLabel } from './labels';

/**
 * Parameters of a template as pure operations (studio-linked spec, "Specified fields"). The author marks a field of a node inside the
 * component as a parameter with a name; the field's value in the body is the default, and each place may give its own in `args`. A parameter's kind
 * is the kind of the field it fills (`fieldKind`), so choosing the field chooses the kind. Each function returns a new document.
 */

/** A field of one node that a parameter may fill, with its kind and what it holds now. */
export interface BindableField { field: string; kind: ComponentParamKind; label: string; value: string }

/** The keys that hold child nodes, which are other nodes' fields to mark, not this one's. */
const childKeys = new Set(['children', 'tabs']);

/** The words for a kind, as the inspector says them. */
export const kindWords: Record<ComponentParamKind, string> = { 'source-id': 'Data source', 'page-id': 'Page', 'modal-id': 'Sheet', 'entity-id': 'Entity', 'state-id': 'State', text: 'Text', symbol: 'Symbol' };

/** Every field of `node` (not of its children) a parameter may fill and that no parameter fills yet, in document order. */
export function bindableFields(node: CompositionNode, entry: ComponentEntry): BindableField[] {
  const taken = new Set((entry.bindings ?? []).filter(binding => binding.nodeId === node.id).map(binding => binding.field));
  const found: BindableField[] = [];
  const visit = (value: unknown, steps: string[]) => {
    if (found.length >= 64 || steps.length > 8) return;
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (steps.length === 0 && childKeys.has(key)) continue;
      const here = [...steps, key], field = here.join('/');
      if (typeof child === 'string') {
        const kind = fieldKind(node, field);
        if (kind && !taken.has(field)) found.push({ field, kind, label: fieldLabel(node.type, here), value: child });
      } else visit(child, here);
    }
  };
  visit(node, []);
  return found;
}

/** What a field is called: its authored label, else its key in words, with a literal's `value` taking its wrapper's name. */
export function fieldLabel(owner: string, steps: readonly string[]): string {
  const parts = steps.map(step => /^\d+$/.test(step) ? Number(step) : step);
  const wrapped = parts.length > 1 && parts.at(-1) === 'value' ? parts.slice(0, -1) : parts;
  return labelText(owner, wrapped);
}

/** A name for a new parameter: the field's label as an identifier, made free by a number. */
export function suggestName(entry: ComponentEntry, field: BindableField): string {
  const base = field.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'parameter';
  const names = new Set((entry.params ?? []).map(param => param.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Why a name cannot be used, in words, or undefined when it can. A name an existing parameter of the same kind has adds a field to that parameter. */
export function nameProblem(entry: ComponentEntry, name: string, kind: ComponentParamKind): string | undefined {
  if (!identifierSchema.safeParse(name).success) return 'Use letters, numbers, dots, underscores or hyphens, up to 80.';
  const same = entry.params?.find(param => param.name === name);
  if (same && same.kind !== kind) return `${name} already holds a ${kindWords[same.kind].toLowerCase()}. Choose another name.`;
  if (!same && (entry.params?.length ?? 0) >= COMPONENT_LIMITS.params) return `A template holds ${COMPONENT_LIMITS.params} parameters.`;
  return undefined;
}

const entryAt = (document: CompositionDocument, entryId: string) => {
  const index = document.componentLibrary?.findIndex(item => item.id === entryId) ?? -1;
  if (index < 0) throw new Error('That template is gone');
  return { index, entry: document.componentLibrary![index] };
};

/** The places of an entry with their `args` rewritten by `change`, one write for each. */
function rewriteArgs(document: CompositionDocument, entryId: string, change: (args: Record<string, string>) => Record<string, string>): CompositionDocument {
  return componentUses(document, entryId).reduce((current: CompositionDocument, use: ComponentUse) => {
    const args = change({ ...(use.ref.args ?? {}) });
    const { args: old, ...rest } = use.ref;
    void old;
    return replaceAt(current, use.path, Object.keys(args).length ? { ...rest, args } : rest);
  }, document);
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
 * Adds one binding: a new `name` adds the parameter (with `label`) and gives every place the field's current value as its own; a name that exists (of
 * the same kind) fills one more field, and the places keep what they have. `value` is what the field holds now. `adopt` changes the entry first
 * (a template taking a copy of a source).
 */
function bind(document: CompositionDocument, entryId: string, target: BindingTarget, kind: ComponentParamKind, name: string, value: string, label?: string, adopt?: (entry: ComponentEntry) => ComponentEntry): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const problem = nameProblem(entry, name, kind);
  if (problem) throw new Error(problem);
  if ((entry.bindings ?? []).some(binding => sameTarget(binding, target))) throw new Error('That field is already a parameter');
  if ((entry.bindings?.length ?? 0) >= COMPONENT_LIMITS.bindings) throw new Error(`A template holds ${COMPONENT_LIMITS.bindings} fields as parameters.`);
  const exists = entry.params?.some(param => param.name === name) ?? false;
  const base = adopt ? adopt(entry) : entry;
  const next: ComponentEntry = {
    ...base,
    params: exists ? entry.params : [...(entry.params ?? []), { name, kind, ...(label ? { label } : {}) }],
    bindings: [...(entry.bindings ?? []), { param: name, ...(target.nodeId !== undefined ? { nodeId: target.nodeId } : { sourceId: target.sourceId }), field: target.field }],
  };
  const written = replaceAt(document, ['componentLibrary', index], next);
  return exists ? written : rewriteArgs(written, entryId, args => ({ ...args, [name]: value }));
}

/**
 * Marks `field` of the node `nodeId` of the template as the parameter `name`. A new name adds the parameter and gives every place the field's current
 * value as its own; a name that exists (of the same kind) fills one more field, and the places keep what they have.
 */
export function addParameter(document: CompositionDocument, entryId: string, nodeId: string, field: string, name: string): CompositionDocument {
  const { entry } = entryAt(document, entryId);
  const target = findNode(entry.node, nodeId);
  const kind = target ? fieldKind(target, field) : undefined;
  if (!target || !kind) throw new Error('That field cannot be a parameter');
  return bind(document, entryId, { nodeId, field }, kind, name, readField(target, field) as string);
}

// MARK: - Set per place

/** What Set Per Place can do with one field of a body node, and how. */
export interface PerPlaceTarget {
  kind: 'entity-id' | 'state-id';
  /** The field's label, which becomes the setting's label. */
  label: string;
  /** Where the binding is written. */
  binding: BindingTarget;
  /** What the field holds now: the entity id or the state's id. */
  value: string;
  /** For an entity the node reads through a source the template does not own yet: the template takes a copy under the same id. */
  adopt?: { sourceId: string };
}

const sourceFields = new Set(['binding/sourceId', 'props/sourceId']);

/**
 * What a field of a body node can be set per place as, or undefined. A field of kind `entity-id` or `state-id` can. So can the Entity row of a node that
 * reads one entity through a source (`binding/sourceId`, `props/sourceId`): the entity is the source's, which the template owns a copy of.
 */
export function perPlaceTarget(document: Pick<CompositionDocument, 'dataSources'>, entry: ComponentEntry, node: CompositionNode, field: string): PerPlaceTarget | undefined {
  const kind = fieldKind(node, field);
  if (kind === 'entity-id' || kind === 'state-id') {
    return { kind, label: fieldLabel(node.type, fieldSteps(field)), binding: { nodeId: node.id, field }, value: readField(node, field) as string };
  }
  if (kind !== 'source-id' || !sourceFields.has(field)) return undefined;
  const id = readField(node, field) as string;
  const owned = entry.sources?.find(source => source.id === id);
  if (owned) return { kind: 'entity-id', label: 'Entity', binding: { sourceId: owned.id, field: 'entityId/value' }, value: owned.entityId.value };
  const shared = document.dataSources.find(source => source.id === id);
  if (shared?.kind !== 'ha-entity' || shared.entityId.type !== 'literal') return undefined;
  return { kind: 'entity-id', label: 'Entity', binding: { sourceId: id, field: 'entityId/value' }, value: shared.entityId.value, adopt: { sourceId: id } };
}

/** The parameter a field is set per place as, or undefined. */
export function perPlaceParam(document: Pick<CompositionDocument, 'dataSources'>, entry: ComponentEntry, node: CompositionNode, field: string): Param | undefined {
  const target = perPlaceTarget(document, entry, node, field);
  const binding = target && entry.bindings?.find(item => sameTarget(item, target.binding));
  return binding ? entry.params?.find(param => param.name === binding.param) : undefined;
}

/**
 * Sets `field` of the node `nodeId` per place: every place can then have its own value. With no `join` it adds a parameter named by `suggestName`
 * and labelled with the field's label; with `join`, the name of a parameter of the same kind, it fills this field from that parameter too, so one
 * entity fills many fields. Each place starts with what the field holds now. An entity a node reads through a source the template does not own is
 * copied into the template (`entry.sources`) and the copy is what the parameter fills.
 */
export function setPerPlace(document: CompositionDocument, entryId: string, nodeId: string, field: string, join?: string): CompositionDocument {
  const { entry } = entryAt(document, entryId);
  const node = findNode(entry.node, nodeId);
  const target = node ? perPlaceTarget(document, entry, node, field) : undefined;
  if (!node || !target) throw new Error('That field cannot be set per place');
  if (target.kind === 'entity-id' && !ENTITY_ID.test(target.value)) throw new Error('Choose an entity first.');
  const joined = join === undefined ? undefined : entry.params?.find(param => param.name === join);
  if (join !== undefined && (!joined || joined.kind !== target.kind)) throw new Error('That setting holds another kind of value.');
  const name = join ?? suggestName(entry, { field, kind: target.kind, label: target.label, value: target.value });
  const adopt = target.adopt
    ? (current: ComponentEntry): ComponentEntry => {
      if ((current.sources?.length ?? 0) >= COMPONENT_LIMITS.sources) throw new Error(`A template holds ${COMPONENT_LIMITS.sources} sources of its own.`);
      return { ...current, sources: [...(current.sources ?? []), { id: target.adopt!.sourceId, kind: 'ha-entity', entityId: { type: 'literal', value: target.value } }] };
    } : undefined;
  return bind(document, entryId, target.binding, target.kind, name, target.value, joined ? undefined : target.label, adopt);
}

/** Takes the field back from its parameter: the field keeps what the template holds, and the parameter goes with its last field, and each place's own value with it. */
export function sameEverywhere(document: CompositionDocument, entryId: string, nodeId: string, field: string): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const node = findNode(entry.node, nodeId);
  const target = node ? perPlaceTarget(document, entry, node, field) : undefined;
  const binding = target && entry.bindings?.find(item => sameTarget(item, target.binding));
  if (!binding) throw new Error('That field is not set per place');
  const rest = (entry.bindings ?? []).filter(item => item !== binding);
  if (rest.some(item => item.param === binding.param)) {
    const { bindings: oldBindings, ...others } = entry;
    void oldBindings;
    return replaceAt(document, ['componentLibrary', index], { ...others, bindings: rest });
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

/** Removes the parameter `name`: its bindings, and each place's own value for it. The fields keep what the body holds. */
export function removeParameter(document: CompositionDocument, entryId: string, name: string): CompositionDocument {
  const { index, entry } = entryAt(document, entryId);
  const params = (entry.params ?? []).filter(param => param.name !== name);
  const bindings = (entry.bindings ?? []).filter(binding => binding.param !== name);
  const { params: oldParams, bindings: oldBindings, ...rest } = entry;
  void oldParams; void oldBindings;
  const next: ComponentEntry = { ...rest, ...(params.length ? { params } : {}), ...(bindings.length ? { bindings } : {}) };
  const written = replaceAt(document, ['componentLibrary', index], next);
  return rewriteArgs(written, entryId, args => { delete args[name]; return args; });
}

/** Sets one place's value for a parameter. */
export function setArgument(document: CompositionDocument, refPath: readonly (string | number)[], name: string, value: string): CompositionDocument {
  const ref = valueAt(document, [...refPath]) as { args?: Record<string, string> };
  return replaceAt(document, [...refPath], { ...ref, args: { ...(ref.args ?? {}), [name]: value } });
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
