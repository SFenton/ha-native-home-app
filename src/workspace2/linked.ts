import { replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { componentReferences, componentUses, expandRef, libraryById, mapChildren, ownedSources, readField, type ComponentUse } from '../shared/composition/components';
import { createId as uid } from '../shared/ids';
import { compositionChildren, type ComponentEntry, type ComponentRefNode, type CompositionDocument, type CompositionNode } from '../shared/composition/schema';
import { sameJson } from '../sameJson';
import { buildDocumentIndex, type SelectionKey } from '../preview2/model';
import { canHold, type Destination } from './add/insert';
import { typeName } from './util';

/**
 * Templates as pure operations over the document (`.agents`' studio-linked spec, L-studio, and the templates spec). A template is an entry of
 * `componentLibrary`; a place that uses it is a `component-ref` node. Each function returns a new document (or the documents to apply, in order);
 * none touches the old one, so the Studio can apply the result as one undo step.
 */

/** The most entries the library may hold (the contract's limit). */
export const MAX_COMPONENTS = 100;

// MARK: - Ids

/** `node` and everything under it, each node given a fresh id. `keepRoot` leaves the root's id as it is. Returns the copy and the old-to-new map. */
function freshIds(node: CompositionNode, keepRoot: boolean): { node: CompositionNode; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const visit = (current: CompositionNode, root: boolean): CompositionNode => {
    const id = root && keepRoot ? current.id : uid('native');
    ids.set(current.id, id);
    return { ...mapChildren(current, child => visit(child, false)), id } as CompositionNode;
  };
  return { node: visit(node, true), ids };
}

/** Every `component-ref` under `node` replaced by a plain copy of its body (fresh inner ids, the reference's own id and width on the root). */
function unlinkInside(node: CompositionNode, entries: ReadonlyMap<string, ComponentEntry>): CompositionNode {
  return mapChildren(node, child => child.type === 'component-ref' ? plainCopy(child, entries) ?? child : unlinkInside(child, entries));
}

/** What a reference stands for as a plain node: its expansion with fresh inner ids; undefined when its component is missing. */
function plainCopy(ref: ComponentRefNode, entries: ReadonlyMap<string, ComponentEntry>): CompositionNode | undefined {
  const entry = entries.get(ref.componentId);
  return entry ? freshIds(expandRef(ref, entry), true).node : undefined;
}

// MARK: - Words

/** The words "tiles" or "things" for what a body holds: tiles when every node inside is a tile type. */
export const tileTypes = new Set(['action-tile', 'navigation-tile', 'state-tile', 'door-tile', 'room-card', 'light-group-tile', 'camera-tile', 'room-overview-tile']);

/** How many nodes sit under `node` (not counting it). */
export function nodesInside(node: CompositionNode): number {
  const kids = compositionChildren(node);
  return kids.reduce((total, child) => total + 1 + nodesInside(child), 0);
}
const everyInside = (node: CompositionNode): CompositionNode[] => {
  const kids = compositionChildren(node);
  return kids.flatMap(child => [child, ...everyInside(child)]);
};
/** How many linked components sit inside `node`. */
export const linkedInside = (node: CompositionNode): number => everyInside(node).filter(item => item.type === 'component-ref').length;

/** The line under the name in the Save as Template dialog: what is captured. */
export function captureText(node: CompositionNode, linked = 0): string {
  const inside = everyInside(node), count = inside.length;
  const kind = typeName(node.type).toLowerCase();
  const things = inside.every(item => tileTypes.has(item.type));
  const noun = things ? (count === 1 ? 'tile' : 'tiles') : (count === 1 ? 'thing' : 'things');
  const first = count === 0 ? `Saves this ${kind}. It stays here, linked to the template.`
    : `Saves this ${kind} and the ${count} ${noun} inside it. It stays here, linked to the template.`;
  if (!linked) return first;
  return `${first} ${linked === 1 ? 'The template inside it is unlinked in the new template.' : `The ${linked} templates inside it are unlinked in the new template.`}`;
}

/** Whether `name` is used by another component (compared without case, trimmed). `except` is the entry being renamed. */
export function nameTaken(document: Pick<CompositionDocument, 'componentLibrary'>, name: string, except?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return (document.componentLibrary ?? []).some(entry => entry.id !== except && entry.name.trim().toLowerCase() === wanted);
}

/** The first free name built on `base`: "Guests Staying Over 2", then 3. */
export function freeName(document: Pick<CompositionDocument, 'componentLibrary'>, base: string): string {
  for (let number = 2; ; number++) { const candidate = `${base} ${number}`.slice(-80); if (!nameTaken(document, candidate)) return candidate; }
}

/** What a name must be: 1 to 80 characters once trimmed, no control or format characters. */
export const nameValid = (name: string): boolean => name.trim().length > 0 && name.trim().length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(name);

/** "Used in 3 places" for the saved row's second line. */
export const usesText = (count: number): string => count === 0 ? 'Not used yet' : count === 1 ? 'Used in 1 place' : `Used in ${count} places`;

/** A place's name in a sentence: its tab's label, else its page or sheet's title, cut at 24 characters. */
export function placeName(use: ComponentUse): string {
  const title = use.tab?.label ?? use.surface.title;
  return title.length > 24 ? `${title.slice(0, 23)}…` : title;
}

/** The question's text: the other places that use the component. */
export function placesText(others: readonly string[]): string {
  const count = others.length;
  const head = `It is also used in ${count} other ${count === 1 ? 'place' : 'places'}: `;
  if (count === 1) return `${head}${others[0]}.`;
  if (count <= 3) return `${head}${others.slice(0, -1).join(', ')} and ${others[count - 1]}.`;
  return `${head}${others[0]}, ${others[1]} and ${count - 2} more.`;
}

/** The other places that use a component, in document order, leaving out the place with the reference id `refId`. */
export const otherPlaces = (document: CompositionDocument, entryId: string, refId?: string): ComponentUse[] =>
  componentUses(document, entryId).filter(use => use.ref.id !== refId);

// MARK: - Save, unlink, rename, delete

/** The result of saving a node as a component. */
export interface Saved { document: CompositionDocument; entryId: string; /** The key of the place that now stands where the node was. */ key: SelectionKey }

/**
 * Moves the node at `path` into a new library entry and puts a reference with **the node's old id** and width in its place, so the selection, the
 * tree position and the row's icon carry over. The body's root gets a fresh id and width 1; inner ids stay. A linked component inside is written as a
 * plain copy: a body holds no reference. One document, so one undo step.
 */
export function saveAsComponent(document: CompositionDocument, path: EditorPath, name: string): Saved {
  const node = valueAt(document, path) as CompositionNode | undefined;
  if (!node || node.type === 'component-ref') throw new Error('Select a component to save');
  if ((document.componentLibrary?.length ?? 0) >= MAX_COMPONENTS) throw new Error(`A document holds at most ${MAX_COMPONENTS} templates`);
  const label = name.trim();
  if (!nameValid(label)) throw new Error('Name the template in 1 to 80 characters');
  if (nameTaken(document, label)) throw new Error(`A template named ${label} already exists.`);
  const body = unlinkInside(node, libraryById(document));
  const entry: ComponentEntry = { id: uid('component'), name: label, node: { ...body, id: uid('native'), layout: { ...body.layout, span: 1 } } as CompositionNode };
  const ref: ComponentRefNode = { id: node.id, type: 'component-ref', componentId: entry.id, layout: { span: node.layout.span } };
  const next = replaceAt(document, path, ref);
  // A records flow only this body reads goes with it (`sh.repeat@1`, D2): each place then runs a copy of its own. One a page still reads stays in the document.
  const adopted = adoptFlows(next, body);
  if (adopted.length) entry.flows = adopted;
  const dataSources = adopted.length ? next.dataSources.filter(source => !adopted.some(flow => flow.id === source.id)) : next.dataSources;
  return { document: { ...next, dataSources, componentLibrary: [...(document.componentLibrary ?? []), entry] }, entryId: entry.id, key: `node:${ref.id}` };
}

/** The records flows the nodes of `body` read through a `repeat` and nothing else in `document` reads: what a saved component takes along (at most 8). */
function adoptFlows(document: CompositionDocument, body: CompositionNode): NonNullable<ComponentEntry['flows']> {
  const wanted = new Set<string>();
  const walk = (node: CompositionNode) => { if (node.type === 'repeat') wanted.add(node.props.providerId); for (const child of compositionChildren(node)) walk(child); };
  walk(body);
  const rest = JSON.stringify({ ...document, dataSources: [] });
  const bodyText = JSON.stringify(body);
  return document.dataSources.filter((source): source is NonNullable<ComponentEntry['flows']>[number] => source.kind === 'model' && source.model === 'pipeline@1' && wanted.has(source.id)
    && (source.inputs as { output?: { kind?: string } }).output?.kind === 'records' && !rest.includes(`"${source.id}"`) && bodyText.includes(`"${source.id}"`)).slice(0, 8);
}

/** The arguments a new place starts with: each parameter's default, the value its first bound field holds in the body (or in the template's own source). */
export function defaultArgs(entry: ComponentEntry): Record<string, string> | undefined {
  const strings = entry.params?.filter(param => param.kind !== 'value');
  if (!strings?.length) return undefined;
  const args: Record<string, string> = {};
  for (const param of strings) {
    const binding = entry.bindings?.find(item => item.param === param.name);
    const owner: unknown = binding?.nodeId !== undefined ? valueAtNode(entry.node, binding.nodeId) : ownedSources(entry).find(source => source.id === binding?.sourceId);
    const value = owner && binding ? readField(owner, binding.field) : undefined;
    args[param.name] = typeof value === 'string' ? value : '';
  }
  return args;
}

/**
 * A copy of the local state field `id` under a new id (`<id>_2`, then 3): the field a new place of a template owns when the template's tabs are a
 * setting. The copy keeps the field's kind, options and initial value, which the tab container checks.
 */
export function ownStateField(document: Pick<CompositionDocument, 'localState'>, id: string): { id: string; field: NonNullable<CompositionDocument['localState']>[number] } | undefined {
  const field = document.localState?.find(item => item.id === id);
  if (!field) return undefined;
  const taken = new Set(document.localState?.map(item => item.id));
  for (let number = 2; ; number++) {
    const next = `${id.replace(/_\d+$/, '')}_${number}`;
    if (!taken.has(next)) return { id: next, field: { ...field, id: next } };
  }
}
function valueAtNode(root: CompositionNode, id: string): CompositionNode | undefined {
  if (root.id === id) return root;
  for (const child of compositionChildren(root)) { const found = valueAtNode(child, id); if (found) return found; }
  return undefined;
}

/**
 * The document with the place at `path` made a plain copy of its component: the root keeps the reference's id and width, inner nodes get fresh ids.
 * Only this place changes. One undo step.
 */
export function unlinkPlace(document: CompositionDocument, path: EditorPath): CompositionDocument {
  const ref = valueAt(document, path) as CompositionNode | undefined;
  if (!ref || ref.type !== 'component-ref') throw new Error('This is not a linked template');
  const copy = plainCopy(ref, libraryById(document));
  if (!copy) throw new Error('That template is gone');
  return replaceAt(document, path, copy);
}

/** The document with every place that uses `id` made a plain copy. */
function unlinkAll(document: CompositionDocument, id: string): CompositionDocument {
  const entries = libraryById(document);
  const visit = (node: CompositionNode): CompositionNode => node.type === 'component-ref' ? node.componentId === id ? plainCopy(node, entries) ?? node : node : unlinkInsideOnly(node);
  const unlinkInsideOnly = (node: CompositionNode): CompositionNode => mapChildren(node, visit);
  const surfaces = <T extends { components: CompositionNode[] }>(list: T[]): T[] => list.map(surface => ({ ...surface, components: surface.components.map(visit) }));
  return { ...document, pages: surfaces(document.pages), modals: surfaces(document.modals) };
}

/** Deletes a component: every place that uses it stays where it is, unlinked, and the entry goes. One undo step. */
export function deleteComponent(document: CompositionDocument, id: string): CompositionDocument {
  const unlinked = unlinkAll(document, id);
  const rest = (unlinked.componentLibrary ?? []).filter(entry => entry.id !== id);
  const { componentLibrary: _library, ...without } = unlinked;
  return (rest.length ? { ...without, componentLibrary: rest } : without) as CompositionDocument;
}

/** Renames a component. Every place shows the new name at once. */
export function renameComponent(document: CompositionDocument, id: string, name: string): CompositionDocument {
  const label = name.trim();
  if (!nameValid(label)) throw new Error('Name the template in 1 to 80 characters');
  if (nameTaken(document, label, id)) throw new Error(`A template named ${label} already exists.`);
  return { ...document, componentLibrary: (document.componentLibrary ?? []).map(entry => entry.id === id ? { ...entry, name: label } : entry) };
}

// MARK: - Insert

/** A new place of the component `entryId` at `destination`: a fresh id, width 1 and each parameter's default. */
export function insertPlace(document: CompositionDocument, entryId: string, destination: Destination): { document: CompositionDocument; key: SelectionKey } {
  const entry = libraryById(document).get(entryId);
  if (!entry) throw new Error('That template is gone');
  const items = valueAt(document, destination.list);
  if (!Array.isArray(items)) throw new Error('That place no longer exists');
  // A body holds no reference, so nothing inside a linked component takes one.
  if (buildDocumentIndex(document).get(destination.owner)?.component !== undefined) throw new Error(`${entry.name} cannot go inside a linked template`);
  if (!canHold(document, destination.owner, entry.node.type)) throw new Error(`${entry.name} cannot go there`);
  const args = defaultArgs(entry);
  // A state setting starts as this place's own: the place gets a copy of the template's field, so two places never switch each other's tabs.
  let localState = document.localState;
  for (const param of entry.params ?? []) {
    if (param.kind !== 'state-id' || !args) continue;
    const made = ownStateField({ localState }, args[param.name]);
    if (made) { localState = [...(localState ?? []), made.field]; args[param.name] = made.id; }
  }
  const ref: ComponentRefNode = { id: uid('native'), type: 'component-ref', componentId: entry.id, layout: { span: 1 }, ...(args ? { args } : {}) };
  const next = [...items.slice(0, destination.index), ref, ...items.slice(destination.index)];
  const placed = replaceAt(document, destination.list, next);
  return { document: localState === document.localState ? placed : { ...placed, localState }, key: `node:${ref.id}` };
}

// MARK: - The edit question

/** The ids of the library entries whose content changed between two documents: found by identity first and by value only where identity differs. */
export function touchedEntries(current: CompositionDocument, next: CompositionDocument): string[] {
  const before = current.componentLibrary, after = next.componentLibrary;
  if (before === after || !before || !after) return [];
  const old = new Map(before.map(entry => [entry.id, entry]));
  const touched: string[] = [];
  for (const entry of after) {
    const was = old.get(entry.id);
    if (!was || was === entry) continue;
    if (was.node !== entry.node && !sameJson(was.node, entry.node)) touched.push(entry.id);
    else if (was.params !== entry.params && !sameJson(was.params ?? null, entry.params ?? null)) touched.push(entry.id);
    else if (was.bindings !== entry.bindings && !sameJson(was.bindings ?? null, entry.bindings ?? null)) touched.push(entry.id);
  }
  return touched;
}

/** The first entry a change touches (the one the question is about), or undefined. */
export const touchedEntry = (current: CompositionDocument, next: CompositionDocument): string | undefined => touchedEntries(current, next)[0];

/**
 * A forked place: the document with a new entry that holds a copy of the component's body with fresh ids, and the reference `refId` pointed at it.
 * `ids` maps each old inner id to its copy, which the held change and the selection follow.
 */
export function forkPlace(document: CompositionDocument, refId: string, name: string): { document: CompositionDocument; entryId: string; ids: Map<string, string> } {
  const use = componentReferences(document).find(item => item.ref.id === refId);
  const entry = use ? libraryById(document).get(use.ref.componentId) : undefined;
  if (!use || !entry) throw new Error('That template is gone');
  const label = name.trim();
  if (!nameValid(label)) throw new Error('Name the template in 1 to 80 characters');
  if (nameTaken(document, label)) throw new Error(`A template named ${label} already exists.`);
  const { node, ids } = freshIds(entry.node, false);
  const copy: ComponentEntry = {
    id: uid('component'), name: label, node,
    ...(entry.params ? { params: entry.params } : {}),
    ...(entry.bindings ? { bindings: entry.bindings.map(binding => binding.nodeId === undefined ? binding : { ...binding, nodeId: ids.get(binding.nodeId) ?? binding.nodeId }) } : {}),
  };
  const repointed = replaceAt(document, use.path, { ...use.ref, componentId: copy.id });
  return { document: { ...repointed, componentLibrary: [...(document.componentLibrary ?? []), copy] }, entryId: copy.id, ids };
}

/** `node` with its ids renamed through `ids`; an id not in the map (a node the change added) stays. */
function renameIds(node: CompositionNode, ids: ReadonlyMap<string, string>, root: boolean): CompositionNode {
  const id = ids.get(node.id) ?? node.id;
  void root;
  return { ...mapChildren(node, child => renameIds(child, ids, false)), id } as CompositionNode;
}

/** What the person answered to the question. */
export type Answer = { kind: 'update' } | { kind: 'new'; name: string };

/**
 * The documents to apply, in order, for a held change `next` made to a place of a component that other places use.
 *
 * - Update: `[next]`: the change applies everywhere.
 * - New component: `[forked, withChange]`. `forked` is `current` with a copy of the body as it was and the place `refId` pointed at it. `withChange`
 *   is `next` with the original entry restored to `current`'s, the edited body moved onto the copy (its ids renamed to the copy's), and the place
 *   pointed at the copy. Every other difference in `next` stays: a node dragged in from the page stays gone from the page.
 */
export function settleHeld(current: CompositionDocument, next: CompositionDocument, refId: string, answer: Answer): CompositionDocument[] {
  if (answer.kind === 'update') return [next];
  const use = componentReferences(current).find(item => item.ref.id === refId);
  if (!use) return [next];
  const original = use.ref.componentId;
  const { document: forked, entryId, ids } = forkPlace(current, refId, answer.name);
  const edited = next.componentLibrary?.find(entry => entry.id === original);
  const fork = forked.componentLibrary!.find(entry => entry.id === entryId)!;
  if (!edited) return [forked];
  const moved: ComponentEntry = { ...fork, node: renameIds(edited.node, ids, true), ...(edited.params ? { params: edited.params } : {}),
    ...(edited.bindings ? { bindings: edited.bindings.map(binding => binding.nodeId === undefined ? binding : { ...binding, nodeId: ids.get(binding.nodeId) ?? binding.nodeId }) } : {}) };
  const restored = (next.componentLibrary ?? []).map(entry => entry.id === original ? current.componentLibrary!.find(item => item.id === original)! : entry);
  const placed = componentReferences(next).find(item => item.ref.id === refId);
  let result: CompositionDocument = { ...next, componentLibrary: [...restored, moved] };
  if (placed) result = replaceAt(result, placed.path, { ...placed.ref, componentId: entryId });
  // The places that keep the original keep the arguments they had: a parameter the change added or removed belongs to the copy only.
  const before = new Map(componentReferences(current).map(item => [item.ref.id, item.ref]));
  for (const other of componentReferences(result)) {
    const was = before.get(other.ref.id);
    if (other.ref.componentId !== original || other.ref.id === refId || !was) continue;
    const { args: changed, values: changedValues, ...rest } = other.ref;
    void changed; void changedValues;
    result = replaceAt(result, other.path, { ...rest, ...(was.args ? { args: was.args } : {}), ...(was.values ? { values: was.values } : {}) });
  }
  return [forked, result];
}

/** Whether a selection key is the place `refId` or something inside it (`<id>` or `<id>~…`). */
export const insidePlace = (key: SelectionKey | undefined, refId: string): boolean => key !== undefined && (key === `node:${refId}` || key.startsWith(`node:${refId}~`));

/** The id of the place a selection key belongs to: the key's instance, from the index. */
export function placeOf(document: CompositionDocument, key: SelectionKey | undefined): string | undefined {
  const entry = key ? buildDocumentIndex(document).get(key) : undefined;
  return entry?.instance ? entry.instance.slice('node:'.length) : undefined;
}
