import { childLists, fieldKind, readField, type NodePath } from './components';
import type { ComponentStringKind, CompositionDocument, CompositionNode } from './schema';

/**
 * Repeated pieces (templates spec 5, "Find repeated pieces"): the pure walk that finds shapes the document draws more than once, and the
 * comparison that says which fields differ between the places of one shape.
 *
 * A node's skeleton is `type:kind:control:family`, as the research note measured it. A piece is a node and everything under it; two pieces
 * are the same shape when their skeletons match all the way down. A repeated piece has 3 or more nodes and a shape that appears at least
 * twice, outermost only: a piece inside another repeated piece is not listed on its own. A subtree that holds a `component-ref` is never a
 * repeat, since a template's body holds no reference.
 *
 * The walk is a generator that yields after each surface, so a caller can run it a surface at a time between tasks and never hold
 * the main thread for the whole document ({@link repeatSteps}); {@link findRepeats} runs it to the end.
 */

/** The fewest nodes a repeated piece has, itself included. */
export const REPEAT_MIN_NODES = 3;
/** The fewest places a shape must appear in. */
export const REPEAT_MIN_PLACES = 2;
/** The longest string an argument may hold (the contract's `args` limit). */
const ARG_MAX = 240;

/** The tab (local tab or area) a place sits in, when it sits in one. */
export interface RepeatTab { id: string; label: string }
/** The surface a place sits on. */
export interface RepeatSurface { kind: 'page' | 'modal'; id: string; title: string; index: number }

/** One place a shape appears. */
export interface RepeatPlace {
  nodeId: string;
  /** Where the node sits: `['pages', 0, 'components', 2, ...]`. */
  path: NodePath;
  surface: RepeatSurface;
  tab?: RepeatTab;
}

/** One repeated shape. */
export interface RepeatClass {
  /** The id of the first place's root; it stays while that node does. */
  id: string;
  /** The root's node type. */
  type: string;
  /** How many nodes a place holds, the root included. */
  size: number;
  places: RepeatPlace[];
}

/** What the walk finds. */
export interface RepeatResult {
  classes: RepeatClass[];
  /** How many places the classes have in all. */
  placeCount: number;
  /** How many nodes the walk read. */
  nodeCount: number;
}

interface Visit {
  node: CompositionNode;
  path: NodePath;
  surface: RepeatSurface;
  tab?: RepeatTab;
  /** The interned shape of this node and everything under it. */
  shape: number;
  size: number;
  lists: Visit[][];
}

const text = (node: CompositionNode, field: string): string => { const value = readField(node, field); return typeof value === 'string' ? value : ''; };
/** `type:kind:control:family` of one node. A vacuum control keeps its kind under `props/primitive`. */
const skeleton = (node: CompositionNode): string => `${node.type}:${text(node, 'props/kind') || text(node, 'props/primitive/kind')}:${text(node, 'props/control')}:${text(node, 'props/family')}`;

/** The tab label a local tab container gives one of its areas: the tab's own, else the one named by the area. */
function areaTab(node: CompositionNode, list: number): RepeatTab | undefined {
  if (node.type !== 'local-tabs') return undefined;
  const tabs = node.tabs;
  if (list < tabs.length) return { id: tabs[list].id, label: tabs[list].label };
  const block = node.blocks?.[list - tabs.length];
  if (!block || block.tabs === 'all') return undefined;
  return { id: block.tabs[0], label: tabs.find(tab => tab.id === block.tabs[0])?.label ?? block.tabs[0] };
}

/**
 * Walks the document and finds the repeated pieces, yielding after each surface. Run it a step at a time (`next()` between tasks) or use {@link findRepeats}.
 * Classes are ordered by places times size, largest first.
 */
export function* repeatSteps(document: Pick<CompositionDocument, 'pages' | 'modals'>): Generator<void, RepeatResult> {
  const shapes = new Map<string, number>();
  let unique = 0, nodeCount = 0;
  const intern = (key: string): number => { const known = shapes.get(key); if (known !== undefined) return known; const next = shapes.size; shapes.set(key, next); return next; };
  const visit = (node: CompositionNode, path: NodePath, surface: RepeatSurface, tab: RepeatTab | undefined): Visit => {
    nodeCount += 1;
    // A reference is its own shape every time: a piece that holds one is never a repeat.
    if (node.type === 'component-ref') return { node, path, surface, tab, shape: intern(`ref#${unique++}`), size: 1, lists: [] };
    const lists = childLists(node).map((list, at) => list.nodes.map((child, index) => visit(child, [...path, ...list.path, index], surface, areaTab(node, at) ?? tab)));
    const key = `${skeleton(node)}${lists.map(list => `[${list.map(child => child.shape).join(',')}]`).join('')}`;
    return { node, path, surface, tab, shape: intern(key), size: 1 + lists.reduce((total, list) => total + list.reduce((sum, child) => sum + child.size, 0), 0), lists };
  };
  const roots: Visit[] = [];
  for (const kind of ['pages', 'modals'] as const) {
    const entries = document[kind];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const surface: RepeatSurface = { kind: kind === 'pages' ? 'page' : 'modal', id: entry.id, title: entry.title, index };
      entry.components.forEach((node, at) => roots.push(visit(node, [kind, index, 'components', at], surface, undefined)));
      yield;
    }
  }
  const counts = new Map<number, number>();
  const count = (item: Visit) => { if (item.size >= REPEAT_MIN_NODES) counts.set(item.shape, (counts.get(item.shape) ?? 0) + 1); for (const list of item.lists) list.forEach(count); };
  roots.forEach(count);
  // Outermost only: a piece whose shape repeats takes its places and its inside is not read again.
  const found = new Map<number, Visit[]>();
  const collect = (item: Visit) => {
    if (item.size >= REPEAT_MIN_NODES && (counts.get(item.shape) ?? 0) >= REPEAT_MIN_PLACES) { found.set(item.shape, [...found.get(item.shape) ?? [], item]); return; }
    for (const list of item.lists) list.forEach(collect);
  };
  roots.forEach(collect);
  const classes: RepeatClass[] = [];
  for (const places of found.values()) {
    if (places.length < REPEAT_MIN_PLACES) continue;
    classes.push({
      id: places[0].node.id, type: places[0].node.type, size: places[0].size,
      places: places.map(place => ({ nodeId: place.node.id, path: place.path, surface: place.surface, ...(place.tab ? { tab: place.tab } : {}) })),
    });
  }
  classes.sort((a, b) => b.places.length * b.size - a.places.length * a.size);
  return { classes, placeCount: classes.reduce((total, item) => total + item.places.length, 0), nodeCount };
}

/** The repeated pieces of a document, found in one go. */
export function findRepeats(document: Pick<CompositionDocument, 'pages' | 'modals'>): RepeatResult {
  const run = repeatSteps(document);
  for (;;) { const step = run.next(); if (step.done) return step.value; }
}

// MARK: - Differences

/** One field of one node of a piece: `index` is the node's place in the piece's preorder (the root is 0). */
export interface RepeatField { index: number; field: string; nodeType: string }

/** Fields that change together across the places, and can be one parameter. */
export interface RepeatGroup {
  id: string;
  kind: ComponentStringKind;
  fields: RepeatField[];
  /** The value in each place, in the order of the class's places. */
  values: string[];
  /** How many different values there are. */
  distinct: number;
}

/** A field that differs and that a template cannot set: a number, a switch, a list, a field with no parameter kind. */
export interface RepeatUnsettable extends RepeatField {
  /** What each place holds, as text, in the order of the class's places. */
  values: string[];
}

/** What differs between the places of one class. */
export interface RepeatAnalysis {
  cls: RepeatClass;
  groups: RepeatGroup[];
  unsettable: RepeatUnsettable[];
}

/** A value that is not there in a place. */
const MISSING = Symbol('missing');
type Leaf = string | number | boolean | null | typeof MISSING;

/** Every scalar of a node outside its children, by slash path. Arrays go by index; an empty object or array is a leaf of its own, as its length. */
function leaves(node: CompositionNode, root: boolean): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  const add = (value: unknown, steps: string[]) => {
    if (value !== null && typeof value === 'object') {
      const entries = Array.isArray(value) ? value.map((item, at) => [String(at), item] as const) : Object.entries(value);
      // The shape of a list or an object is a field too: places with another number of items differ there.
      if (Array.isArray(value)) out.set(`${steps.join('/')}#length`, value.length);
      for (const [key, inner] of entries) { if (key === 'children') continue; add(inner, [...steps, key]); }
      return;
    }
    out.set(steps.join('/'), value === undefined ? MISSING : value as Leaf);
  };
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'children') continue;
    // The root's width is the reference's own.
    if (root && key === 'layout' && value !== null && typeof value === 'object') { add(Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'span')), [key]); continue; }
    add(value, [key]);
  }
  return out;
}

/** The nodes of a piece in preorder, the order `bodyNodes` gives. */
const preorder = (node: CompositionNode): CompositionNode[] => [node, ...childLists(node).flatMap(list => list.nodes.flatMap(preorder))];

/** Whether `a` and `b` are the same leaf. */
const same = (a: Leaf, b: Leaf) => a === b;
const shown = (value: Leaf): string => value === MISSING ? '' : String(value);

/**
 * Compares the places of a class, node by node and field by field. A field whose value is the same everywhere is not listed. A field a parameter can
 * fill (`fieldKind`, in every place, a string of 1 to 240 characters) is listed in a group with the fields that always change together; any other field
 * that differs is `unsettable`. Node ids are never listed.
 */
export function analyseRepeat(document: Pick<CompositionDocument, 'pages' | 'modals'>, cls: RepeatClass): RepeatAnalysis {
  const roots = cls.places.map(place => {
    let value: unknown = document;
    for (const step of place.path) value = (value as Record<string | number, unknown>)[step];
    return value as CompositionNode;
  });
  const bodies = roots.map(preorder);
  const groups = new Map<string, RepeatGroup>();
  const unsettable: RepeatUnsettable[] = [];
  for (let index = 0; index < bodies[0].length; index++) {
    const nodes = bodies.map(body => body[index]);
    const tables = nodes.map(node => leaves(node, index === 0));
    const fields = new Set<string>();
    for (const table of tables) for (const key of table.keys()) fields.add(key);
    for (const field of fields) {
      const values = tables.map(table => table.get(field) ?? MISSING);
      if (values.every(value => same(value, values[0]))) continue;
      const kinds = nodes.map(node => fieldKind(node, field));
      const kind = kinds[0];
      const fillable = kind !== undefined && kinds.every(item => item === kind)
        && values.every(value => typeof value === 'string' && value.length >= 1 && value.length <= ARG_MAX);
      const at = { index, field, nodeType: nodes[0].type };
      if (!fillable) { unsettable.push({ ...at, values: values.map(shown) }); continue; }
      const strings = values as string[];
      const key = `${kind}|${JSON.stringify(strings)}`;
      const group = groups.get(key);
      if (group) group.fields.push(at);
      else groups.set(key, { id: `g${groups.size}`, kind, fields: [at], values: strings, distinct: new Set(strings).size });
    }
  }
  return { cls, groups: [...groups.values()], unsettable };
}

// MARK: - The plan

/** The parameters a template holds and the fields they fill, at the most. */
export const REPEAT_LIMITS = { params: 16, bindings: 128 } as const;

/** What a person's choices leave of a class. */
export interface RepeatPlan {
  /** The indexes of the places the template would replace, in order. */
  kept: number[];
  /** The groups that become parameters, in the order they are listed. */
  checked: RepeatGroup[];
  /** Why places are left out, in the order the reasons were applied: the count that stay as they are, and what they differ in. */
  reasons: { places: number; group?: RepeatGroup; field?: RepeatUnsettable }[];
}

/** The value most places hold, the first seen among equals. */
function modeOf(values: readonly string[], among: readonly number[]): string {
  const seen = new Map<string, number>();
  for (const at of among) seen.set(values[at], (seen.get(values[at]) ?? 0) + 1);
  let best = values[among[0]], most = 0;
  for (const [value, count] of seen) if (count > most) { best = value; most = count; }
  return best;
}

/**
 * The groups that start checked: the ones with the most different values, up to the template's limit of parameters and of bound fields. The rest start
 * unchecked, and the proposal says a template holds 16 parameters.
 */
export function defaultUnchecked(analysis: RepeatAnalysis): Set<string> {
  const unchecked = new Set<string>();
  let params = 0, bindings = 0;
  const ranked = [...analysis.groups].sort((a, b) => b.distinct - a.distinct);
  for (const group of ranked) {
    if (params < REPEAT_LIMITS.params && bindings + group.fields.length <= REPEAT_LIMITS.bindings) { params += 1; bindings += group.fields.length; }
    else unchecked.add(group.id);
  }
  return unchecked;
}

/**
 * What saving would do given the groups left unchecked. An unchecked group stays what most places hold, and a place with another value is left out; a
 * field no parameter can fill does the same. The result never changes what any place draws, because a place that would draw differently stays as it is.
 */
export function planRepeat(analysis: RepeatAnalysis, unchecked: ReadonlySet<string>): RepeatPlan {
  let kept = analysis.cls.places.map((_, at) => at);
  const reasons: RepeatPlan['reasons'] = [];
  const settle = (values: readonly string[], reason: { group?: RepeatGroup; field?: RepeatUnsettable }) => {
    const fixed = modeOf(values, kept);
    const next = kept.filter(at => values[at] === fixed);
    if (next.length < kept.length) reasons.push({ places: kept.length - next.length, ...reason });
    kept = next;
  };
  for (const field of analysis.unsettable) settle(field.values, { field });
  const checked: RepeatGroup[] = [];
  for (const group of analysis.groups) {
    if (unchecked.has(group.id)) settle(group.values, { group });
    else checked.push(group);
  }
  return { kept, checked, reasons };
}

/** The places of one group among the kept ones that hold more than one value, for "N different". */
export const differentAmong = (group: RepeatGroup, kept: readonly number[]): number => new Set(kept.map(at => group.values[at])).size;
