import { MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES, operandKind, type Operand, type Predicate } from '../../shared/composition/expression';
import type { Tri } from '../../shared/composition/evaluator';
import type { Json } from '../../shared/types';
import { isUse } from '../data/logic/logicModel';
import { logicOperandName, useSentence, type LogicNames } from '../data/logic/logicNames';
import { comparisonWords, groupCount, resultWords, words, type Comparison, type Place } from './words';

/**
 * The condition field's pure logic (spec "Files"): which conditions Simple can hold, how one is opened into the model the editor draws and
 * closed back into the stored form (D6), the sentence and summary words, the result words per place and the limits. Nothing here renders.
 */

// MARK: Naming

/** What the words need to name a source: the document's sources and Home Assistant's friendly names. */
export interface NameContext {
  document: { dataSources: readonly { id: string; kind: string; model?: string; entityId?: { type: string; value?: unknown }; inputs?: unknown }[] };
  /** The friendly name of an entity id, when known. */
  entityName?: (entityId: string) => string | undefined;
  /** Whether Home Assistant has the entity; absent when it is not connected, so nothing is called missing. */
  entityExists?: (entityId: string) => boolean;
  /** The library and the open template's settings, so a use and a setting have names. */
  logic?: LogicNames;
}

const fieldNames: Record<string, string> = {
  minuteOfDay: 'Time', weekday: 'Day of the week', today: "Today's date", hour: 'Hour', minute: 'Minute',
  width: 'Width', height: 'Height', widthClass: 'Width class', heightClass: 'Height class', orientation: 'Orientation',
  major: 'iOS version', reduceMotion: 'Reduce Motion', reduceTransparency: 'Reduce Transparency', supportsAlternateIcons: 'Can change the app icon', canSendMail: 'Can send mail',
  permission: 'Permission', timeSensitive: 'Time Sensitive', showCountOnIcon: 'Show count on icon', notificationBannerDismissed: 'Notification banner dismissed',
  count: 'Count', total: 'Total', unavailableCount: 'Unavailable', stateText: 'State', isOn: 'Is on', phase: 'Phase', isActive: 'Is active', state: 'State',
};
/** The weekday names a day number reads as. */
export const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const titleCase = (text: string) => text.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, letter => letter.toUpperCase());
/** "21:00" as minutes of the day is 1260; "9:00 PM" is what it reads as. */
export const timeWords = (minutes: number) => { const hour = Math.floor(minutes / 60) % 24, minute = minutes % 60; return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; };

/** The source an operand reads, when it is a read. */
export const readOf = (operand: Operand | undefined) => operand?.type === 'read' ? operand : undefined;
/** The source an operand reads an entity through: a `read`, a `raw-state` or a list read (`sh.raw-state@1`, `sh.list-read@1`). */
export function sourceOfOperand(operand: Operand | undefined): string | undefined {
  if (!operand) return undefined;
  if (operand.type === 'read') return operand.from.sourceId;
  if (operand.type === 'raw-state' || operand.type === 'last-changed') return operand.sourceId;
  return operand.type === 'list-count' || operand.type === 'list-includes' ? operand.from.sourceId : undefined;
}

// MARK: Reading an entity
/**
 * What the Read pop-up of an entity holds, one choice per way to read it: its state, its raw state (Unknown and Unavailable told apart), an attribute,
 * the count of items in a list attribute, or whether a list attribute includes an item.
 */
export type ReadChoice = 'state' | 'raw' | 'changed' | `a:${string}` | `c:${string}` | `i:${string}`;
/** The choice an operand is, or undefined when it is not a read of an entity (or reads a path the pop-up has no word for). */
export function readChoiceOf(operand: Operand | undefined): ReadChoice | undefined {
  if (!operand) return undefined;
  if (operand.type === 'raw-state') return 'raw';
  if (operand.type === 'last-changed') return 'changed';
  if (operand.type === 'list-count' || operand.type === 'list-includes') {
    const { path } = operand.from;
    return path[0] === 'attributes' && path.length === 2 ? `${operand.type === 'list-count' ? 'c' : 'i'}:${path[1]}` : undefined;
  }
  if (operand.type !== 'read') return undefined;
  const { path } = operand.from;
  return path.length === 1 && path[0] === 'state' ? 'state' : path[0] === 'attributes' && path.length === 2 ? `a:${path[1]}` : undefined;
}
/** The operand a choice reads from `sourceId`. `needle` is what an `i:` choice looks for; `as` is how a state or an attribute reads. */
export function operandForChoice(sourceId: string, choice: ReadChoice, as: 'string' | 'number' | 'boolean' = 'string', needle = ''): Operand {
  const from = (path: string[]) => ({ type: 'source' as const, sourceId, path });
  if (choice === 'raw') return { type: 'raw-state', sourceId };
  if (choice === 'changed') return { type: 'last-changed', sourceId };
  if (choice === 'state') return { type: 'read', from: from(['state']), as, missing: 'unavailable' };
  const name = choice.slice(2);
  if (choice.startsWith('c:')) return { type: 'list-count', from: from(['attributes', name]) };
  if (choice.startsWith('i:')) return { type: 'list-includes', from: from(['attributes', name]), value: { type: 'literal', value: needle } };
  return { type: 'read', from: from(['attributes', name]), as, missing: 'unavailable' };
}
/**
 * The leaf after its left side is replaced by another way to read the same entity. A comparison the new value does not offer is replaced by the
 * first one it does, with a starting value: Yes for an item in a list, 0 for a count, "unknown" for a raw state.
 */
export function withLeft(leaf: Leaf, left: Operand): Leaf {
  const kind = kindOf(left), allowed = comparisonsFor(kind, left);
  if (left.type === 'raw-state') return { left, comparison: 'is', right: [lit('unknown')] };
  if (left.type === 'list-includes') return { left, comparison: 'is', right: [lit(true)] };
  if (left.type === 'last-changed') return { left, comparison: 'is before', right: [] };
  if (left.type === 'list-count') return { left, comparison: 'is above', right: [lit(0)] };
  const comparison = allowed.includes(leaf.comparison) ? leaf.comparison : allowed[0];
  const numbers = comparison === 'is above' || comparison === 'is below';
  return { left, comparison, right: comparison === leaf.comparison && leaf.right.every(item => item.type === 'literal' && (typeof item.value === 'number') === numbers) ? leaf.right : numbers ? [lit(0)] : [] };
}
/** The entity id a source reads, when it is one `ha-entity`. */
export function entityOfSource(ctx: NameContext, sourceId: string): string | undefined {
  const source = ctx.document.dataSources.find(item => item.id === sourceId);
  return source?.kind === 'ha-entity' && source.entityId?.type === 'literal' && typeof source.entityId.value === 'string' ? source.entityId.value : undefined;
}

/** The short name of what an operand gives: "Garage Door", "Garage Door · temperature", "Time", or its fixed text. */
export function operandName(operand: Operand, ctx: NameContext): string {
  const special = logicOperandName(operand, ctx.logic);
  if (special !== undefined) return special;
  switch (operand.type) {
    case 'literal': return typeof operand.value === 'string' ? operand.value : String(JSON.stringify(operand.value));
    case 'read': {
      const { sourceId, path } = operand.from, source = ctx.document.dataSources.find(item => item.id === sourceId);
      const entity = entityOfSource(ctx, sourceId);
      if (entity) {
        const name = ctx.entityName?.(entity) ?? entity;
        return path[0] === 'attributes' && path[1] ? `${name} · ${path[1]}` : name;
      }
      const field = path.at(-1) ?? '';
      if (source?.model === 'app-state@1') return fieldNames[field] ?? titleCase(field);
      return `${titleCase(sourceId)}${field && field !== 'state' ? ` · ${fieldNames[field] ?? titleCase(field)}` : ''}`;
    }
    case 'raw-state': {
      const entity = entityOfSource(ctx, operand.sourceId);
      return `${entity ? ctx.entityName?.(entity) ?? entity : titleCase(operand.sourceId)} · raw state`;
    }
    case 'last-changed': {
      const entity = entityOfSource(ctx, operand.sourceId);
      return `${entity ? ctx.entityName?.(entity) ?? entity : titleCase(operand.sourceId)} · last changed`;
    }
    case 'list-count': case 'list-includes': {
      const { sourceId, path } = operand.from, entity = entityOfSource(ctx, sourceId), name = entity ? ctx.entityName?.(entity) ?? entity : titleCase(sourceId);
      const needle = operand.type === 'list-includes' ? operand.value.type === 'literal' ? ` ${String(operand.value.value)}` : ' a value' : '';
      return `${name} · ${path.at(-1) ?? ''} ${operand.type === 'list-count' ? 'count' : 'includes'}${needle}`;
    }
    case 'date': {
      // The seconds to a time (`sh.countdown@1`): until a moment from now, or since an entity's state changed.
      if (operand.op === 'seconds-between' && operand.from.type === 'clock' && operand.from.part === 'now-second') return `Seconds until ${operandName(operand.to, ctx)}`;
      if (operand.op === 'seconds-between' && operand.from.type === 'last-changed') return `Seconds since ${operandName(operand.from, ctx).replace(/ · last changed$/, '')} changed`;
      return 'a value';
    }
    case 'viewer': return 'The person using the app';
    case 'clock': return operand.part === 'today' ? 'Today' : operand.part === 'now-second' ? 'Now, to the second' : 'Now';
    case 'item': return operand.path.join('.') || 'This item';
    case 'index': return 'Position';
    case 'param': return operand.name;
    default: return 'a value';
  }
}

/** The kind of value an operand gives, in the words the comparisons follow. */
export type ValueKind = 'text' | 'number' | 'yesno' | 'date';
export function kindOf(operand: Operand, ctx?: NameContext): ValueKind {
  if (operand.type === 'clock' || operand.type === 'last-changed') return 'date';
  if (operand.type === 'read' && ctx && operand.from.path.at(-1) === 'today' && ctx.document.dataSources.find(item => item.id === operand.from.sourceId)?.model === 'app-state@1') return 'date';
  const kind = operandKind(operand);
  return kind === 'number' ? 'number' : kind === 'boolean' ? 'yesno' : 'text';
}
/** The comparisons a value of a kind offers (spec "The comparison's choices follow the value's kind"). */
export function comparisonsFor(kind: ValueKind, left?: Operand): Comparison[] {
  // The time of last change has a moment too precise to equal a date: only before and after mean something.
  if (left?.type === 'last-changed') return ['is before', 'is after'];
  switch (kind) {
    case 'number': return ['is', 'is not', 'is above', 'is below', 'has a value'];
    case 'yesno': return ['is'];
    case 'date': return ['is before', 'is after', 'is'];
    default: return ['is', 'is not', 'is one of', 'is not one of', 'has a value', 'has no value'];
  }
}

// MARK: Leaves

/** One comparison, the model of a condition row and of Simple: the value, the comparison and what it is compared with. */
export interface Leaf { left: Operand; comparison: Comparison; right: Operand[] }
const lit = (value: Json): Operand => ({ type: 'literal', value });
const compareOps: Record<string, Comparison> = { eq: 'is', ne: 'is not', above: 'is above', below: 'is below', before: 'is before', after: 'is after' };
const opOf: Partial<Record<Comparison, 'eq' | 'ne' | 'above' | 'below' | 'before' | 'after'>> = {
  is: 'eq', 'is not': 'ne', 'is above': 'above', 'is below': 'below', 'is before': 'before', 'is after': 'after',
};
const read = (sourceId: string, path: string[], as: 'string' | 'number' | 'boolean' = 'string'): Operand => ({ type: 'read', from: { type: 'source', sourceId, path }, as, missing: 'unavailable' });
/** A `read` of a source for a condition's left side. */
export const readOperand = read;

/** Opens a condition into one comparison, or undefined when it is not one (a group, a viewer test, a custom part). */
export function openLeaf(predicate: Predicate): Leaf | undefined {
  const negated = predicate.type === 'not', inner = negated ? predicate.of : predicate;
  switch (inner.type) {
    case 'state': return { left: read(inner.sourceId, inner.path), comparison: inner.in.length === 1 ? (negated ? 'is not' : 'is') : (negated ? 'is not one of' : 'is one of'), right: inner.in.map(lit) };
    case 'numeric': {
      if (negated) return undefined;
      const bound = inner.above && !inner.below ? inner.above : inner.below && !inner.above ? inner.below : undefined;
      if (!bound || bound.type !== 'literal' || typeof bound.value !== 'number') return undefined;
      return { left: read(inner.sourceId, inner.path, 'number'), comparison: inner.above ? 'is above' : 'is below', right: [bound] };
    }
    case 'compare': return negated ? undefined : { left: inner.left, comparison: compareOps[inner.op], right: [inner.right] };
    case 'in': return { left: inner.value, comparison: negated ? 'is not one of' : 'is one of', right: inner.in };
    case 'exists': return { left: inner.value, comparison: negated ? 'has no value' : 'has a value', right: [] };
    default: return undefined;
  }
}

/** Whether a read is of an entity's state or one of its attributes, which the shipped leaves can hold. */
const entityRead = (operand: Operand, isEntity: (sourceId: string) => boolean) =>
  operand.type === 'read' && isEntity(operand.from.sourceId) && (operand.from.path.length === 1 && operand.from.path[0] === 'state' || operand.from.path[0] === 'attributes' && operand.from.path.length === 2);

/**
 * Closes a comparison into the stored condition (D6): an entity's state or attribute against fixed values is the shipped `state`,
 * `not` + `state` or `numeric`; anything else is `compare`, `in` or `exists`.
 */
export function closeLeaf(leaf: Leaf, isEntity: (sourceId: string) => boolean = () => true): Predicate {
  const { left, comparison, right } = leaf;
  const literals = right.every(item => item.type === 'literal');
  if (left.type === 'read' && entityRead(left, isEntity) && literals) {
    const { sourceId, path } = left.from;
    const texts = right.map(item => (item as { value: Json }).value);
    if ((comparison === 'is' || comparison === 'is not' || comparison === 'is one of' || comparison === 'is not one of') && texts.length && texts.every(item => typeof item === 'string')) {
      const state: Predicate = { type: 'state', sourceId, path, in: texts as string[] };
      return comparison === 'is' || comparison === 'is one of' ? state : { type: 'not', of: state };
    }
    if ((comparison === 'is above' || comparison === 'is below') && typeof texts[0] === 'number')
      return { type: 'numeric', sourceId, path, [comparison === 'is above' ? 'above' : 'below']: right[0] } as Predicate;
  }
  switch (comparison) {
    case 'has a value': return { type: 'exists', value: left };
    case 'has no value': return { type: 'not', of: { type: 'exists', value: left } };
    case 'is one of': return { type: 'in', value: left, in: right.length ? right : [lit('')] };
    case 'is not one of': return { type: 'not', of: { type: 'in', value: left, in: right.length ? right : [lit('')] } };
    default: return { type: 'compare', op: opOf[comparison]!, left, right: right[0] ?? lit('') };
  }
}

// MARK: Groups

/** A group as the builder draws it: "All of these are true", "Any of …", "None of …" (`not` over `any`). */
export interface Group { mode: 'all' | 'any' | 'none'; items: Predicate[] }
/** The group a condition is, or undefined. */
export function groupOf(predicate: Predicate): Group | undefined {
  if (predicate.type === 'all' || predicate.type === 'any') return { mode: predicate.type, items: predicate.of };
  if (predicate.type === 'not' && predicate.of.type === 'any') return { mode: 'none', items: predicate.of.of };
  return undefined;
}
/** A group written back as a condition. */
export const groupPredicate = (group: Group): Predicate => group.mode === 'none' ? { type: 'not', of: { type: 'any', of: group.items } } : { type: group.mode, of: group.items };

/** The root of a Logic view: the condition's own group, or the one condition inside an "All" that is written back as the bare condition. */
export interface Root { group: Group; wrapped: boolean }
/** Opens a condition into its root group. No condition is an empty root, which reads "Always". */
export function openRoot(predicate: Predicate | undefined): Root {
  if (!predicate) return { group: { mode: 'all', items: [] }, wrapped: true };
  const group = groupOf(predicate);
  return group ? { group, wrapped: false } : { group: { mode: 'all', items: [predicate] }, wrapped: true };
}
/** Closes the root back into a condition. An unchanged condition comes back as it was; no rows is no condition. */
export function closeRoot(root: Root): Predicate | undefined {
  if (!root.group.items.length) return undefined;
  if (root.wrapped && root.group.items.length === 1 && root.group.mode === 'all') return root.group.items[0];
  return groupPredicate(root.group);
}

/** The leaves in a condition, as "All of 3 conditions" counts them. */
export function conditionCount(predicate: Predicate | undefined): number {
  if (!predicate) return 0;
  const group = groupOf(predicate);
  if (group) return group.items.reduce((sum, item) => sum + conditionCount(item), 0);
  if (predicate.type === 'not') return conditionCount(predicate.of);
  return 1;
}
/** How many levels of groups a condition nests. */
export function groupDepth(predicate: Predicate | undefined): number {
  if (!predicate) return 0;
  const group = groupOf(predicate);
  if (group) return 1 + Math.max(0, ...group.items.map(groupDepth));
  if (predicate.type === 'not') return groupDepth(predicate.of);
  return 0;
}
const nodeCount = (predicate: Predicate): number => 1 + (groupOf(predicate)?.items.reduce((sum, item) => sum + nodeCount(item), 0) ?? (predicate.type === 'not' ? nodeCount(predicate.of) : 0));

// MARK: Limits

/** Where a condition lives, which decides its limits: a document condition (depth 8, 64 nodes), or a rule or a flow (depth 6, 32 nodes). */
export type Scope = 'document' | 'rule' | 'flow';
export const limits = {
  depth: (scope: Scope) => scope === 'document' ? MAX_EXPRESSION_DEPTH : MAX_CONDITION_DEPTH,
  nodes: (scope: Scope) => scope === 'document' ? MAX_EXPRESSION_NODES : MAX_CONDITION_NODES,
  rows: 16,
} as const;
/** Why a condition may not grow: "Groups can go 6 deep." for a group, "This condition is too large…" for a row. Undefined when it may. */
export function growProblem(predicate: Predicate | undefined, scope: Scope, adding: 'condition' | 'group', rowsInGroup: number, groupLevel: number): string | undefined {
  const nodes = predicate ? nodeCount(predicate) : 0;
  if (adding === 'group' && groupLevel >= limits.depth(scope)) return `Groups can go ${limits.depth(scope)} deep.`;
  if (adding === 'condition' && rowsInGroup >= limits.rows || nodes + (adding === 'group' ? 2 : 1) > limits.nodes(scope)) return words.tooLarge;
  return undefined;
}

// MARK: Simple

/** Whether Simple can draw a condition: nothing, one entity compared with fixed values, or one such comparison inside a one-row group. */
export function fitsSimple(predicate: Predicate | undefined, ctx: NameContext): { fits: true } | { fits: false; reason: string } {
  if (!predicate) return { fits: true };
  const group = groupOf(predicate);
  if (group) {
    if (group.items.length === 1 && group.mode === 'all') return fitsSimple(group.items[0], ctx);
    return { fits: false, reason: `Simple holds one entity and one comparison. This has ${conditionCount(predicate)} conditions.` };
  }
  const leaf = openLeaf(predicate);
  if (!leaf) return { fits: false, reason: predicate.type === 'viewer' || predicate.type === 'viewer-person' ? "Simple holds one entity and one comparison. This compares The person using the app, which Simple can't show." : words.simpleCustom };
  const isEntity = (id: string) => entityOfSource(ctx, id) !== undefined;
  const fixed = leaf.right.every(item => item.type === 'literal');
  // An entity's Last Changed is the one date Simple draws: before or after a moment.
  const comparable = ['is', 'is not', 'is one of', 'is not one of', 'is above', 'is below'].includes(leaf.comparison) || (leaf.left.type === 'last-changed' && (leaf.comparison === 'is before' || leaf.comparison === 'is after'));
  const leftSource = sourceOfOperand(leaf.left);
  if (leftSource === undefined || !isEntity(leftSource))
    return { fits: false, reason: `Simple holds one entity and one comparison. This compares ${operandName(leaf.left, ctx)}, which Simple can't show.` };
  if (!fixed || !comparable) return { fits: false, reason: words.simpleCustom };
  return { fits: true };
}
/** Opens a condition for Simple: its one comparison, or undefined for "no condition". */
export function openSimple(predicate: Predicate | undefined): Leaf | undefined {
  if (!predicate) return undefined;
  const group = groupOf(predicate);
  return openLeaf(group && group.items.length === 1 ? group.items[0] : predicate);
}
/** Closes Simple's comparison into the stored condition (D6). */
export const closeSimple = closeLeaf;

// MARK: Words

const joined = (values: Operand[], ctx: NameContext) => values.map(item => operandName(item, ctx)).join(', ');
/** One condition drawn as a sentence: "Guest Mode is on", "Lights On is above 10". */
export function sentence(predicate: Predicate, ctx: NameContext): string {
  const asUse: unknown = predicate;
  if (isUse(asUse)) return useSentence(asUse, ctx.logic, value => value && typeof value === 'object' ? operandName(value as Operand, ctx) : String(value ?? ''), id => { const entity = entityOfSource(ctx, id); return entity ? ctx.entityName?.(entity) ?? entity : id; });
  const group = groupOf(predicate);
  if (group) return groupCount(group.mode, conditionCount(predicate));
  switch (predicate.type) {
    case 'viewer':
      if (predicate.isAdmin !== undefined) return `The person using the app ${predicate.isAdmin ? 'is an admin' : 'is not an admin'}`;
      return `The person using the app is one of ${(predicate.userIds ?? []).join(', ')}`;
    case 'viewer-person': return `The person is ${predicate.in.join(' or ')}`;
    default: break;
  }
  const leaf = openLeaf(predicate);
  if (!leaf) return predicate.type === 'not' ? `Not: ${sentence(predicate.of, ctx)}` : words.customCondition;
  const name = operandName(leaf.left, ctx);
  // "includes" already answers yes or no: "Fan · preset_modes includes auto", or "does not include" when the answer asked for is No.
  const answer = leaf.right[0];
  if (leaf.left.type === 'list-includes' && leaf.comparison === 'is' && answer?.type === 'literal' && typeof answer.value === 'boolean')
    return answer.value ? name : name.replace(' includes ', ' does not include ');
  const time = leaf.left.type === 'read' && leaf.left.from.path.at(-1) === 'minuteOfDay';
  const right = time && leaf.right[0]?.type === 'literal' && typeof leaf.right[0].value === 'number' ? timeWords(leaf.right[0].value) : joined(leaf.right, ctx);
  return `${name} ${comparisonWords[leaf.comparison]}${right ? ` ${right}` : ''}`;
}
/** Line 1 of the field at rest: the sentence, or "All of 3 conditions" for a group, or "Always". */
export function summary(predicate: Predicate | undefined, ctx: NameContext): string {
  if (!predicate) return words.always;
  const fit = openRoot(predicate);
  if (fit.wrapped && fit.group.items.length === 1) return sentence(fit.group.items[0], ctx);
  return sentence(predicate, ctx);
}
/** The result of a condition in a place's words: "Shown now", "Hidden now", or "Can't tell yet". */
export function resultText(place: Place, tri: Tri | undefined): string {
  return tri === undefined ? '' : tri === 'unknown' ? "Can't tell yet" : resultWords[place][tri];
}
/** The marker shape of a result: a check (true), a ring with a bar (not true), a diamond (can't tell), a triangle (problem). */
export type Marker = 'check' | 'ring' | 'unknown' | 'problem';
export const markerOf = (tri: Tri | undefined, problem = false): Marker => problem ? 'problem' : tri === 'yes' ? 'check' : tri === 'no' ? 'ring' : 'unknown';

/** The first entity a condition reads that Home Assistant does not have, when connected. */
export function missingEntity(predicate: Predicate | undefined, ctx: NameContext): string | undefined {
  if (!predicate || !ctx.entityExists) return undefined;
  const check = (item: Predicate): string | undefined => {
    const group = groupOf(item);
    if (group) return group.items.map(check).find(Boolean);
    if (item.type === 'not') return check(item.of);
    const leaf = openLeaf(item);
    const source = sourceOfOperand(leaf?.left), id = source === undefined ? undefined : entityOfSource(ctx, source);
    return id && !ctx.entityExists!(id) ? id : undefined;
  };
  return check(predicate);
}

/** The inputs a condition reads, for Try Values: each source and path, once. */
export function inputsOf(predicate: Predicate | undefined): { sourceId: string; path: string[] }[] {
  const found = new Map<string, { sourceId: string; path: string[] }>();
  const operand = (item: Operand): void => {
    if (item.type === 'read') found.set(`${item.from.sourceId}|${item.from.path.join('/')}`, { sourceId: item.from.sourceId, path: item.from.path });
    else if (item.type === 'raw-state' || item.type === 'last-changed') found.set(`${item.sourceId}|state`, { sourceId: item.sourceId, path: ['state'] });
    else if (item.type === 'list-count') found.set(`${item.from.sourceId}|${item.from.path.join('/')}`, { sourceId: item.from.sourceId, path: item.from.path });
    else if (item.type === 'list-includes') { found.set(`${item.from.sourceId}|${item.from.path.join('/')}`, { sourceId: item.from.sourceId, path: item.from.path }); operand(item.value); }
    else if (item.type === 'format') Object.values(item.args).forEach(operand);
    else if (item.type === 'choose') { item.cases.forEach(entry => { walk(entry.when); operand(entry.then); }); operand(item.otherwise); }
    else if (item.type === 'math') item.args.forEach(operand);
  };
  const walk = (item: Predicate | undefined): void => {
    if (!item) return;
    switch (item.type) {
      case 'state': found.set(`${item.sourceId}|${item.path.join('/')}`, { sourceId: item.sourceId, path: item.path }); break;
      case 'numeric': found.set(`${item.sourceId}|${item.path.join('/')}`, { sourceId: item.sourceId, path: item.path }); if (item.above) operand(item.above); if (item.below) operand(item.below); break;
      case 'all': case 'any': item.of.forEach(walk); break;
      case 'not': walk(item.of); break;
      case 'compare': operand(item.left); operand(item.right); break;
      case 'in': operand(item.value); item.in.forEach(operand); break;
      case 'exists': operand(item.value); break;
      default: break;
    }
  };
  walk(predicate);
  return [...found.values()];
}
/** The inputs an operand reads. */
export function operandInputs(item: Operand): { sourceId: string; path: string[] }[] {
  const holder: Predicate = { type: 'exists', value: item };
  return inputsOf(holder);
}

// MARK: Group paths

/** The group at `at` (indexes of nested groups from the root; empty is the root). */
export function groupAt(rule: Predicate | undefined, at: readonly number[]): Group | undefined {
  let group: Group | undefined = openRoot(rule).group;
  for (const index of at) {
    const item: Predicate | undefined = group?.items[index];
    group = item ? groupOf(item) : undefined;
  }
  return group;
}
/**
 * The condition with the group at `at` replaced (or removed, with `undefined`; a group left with no rows is removed too). The root keeps
 * its bare form while it is one "All" row, as {@link closeRoot} does.
 */
export function replaceGroupAt(rule: Predicate | undefined, at: readonly number[], next: Group | undefined): Predicate | undefined {
  const root = openRoot(rule);
  const setIn = (group: Group, path: readonly number[]): Group => {
    if (!path.length) return next ?? { ...group, items: [] };
    const [index, ...rest] = path, inner = groupOf(group.items[index]);
    if (!inner) return group;
    const updated = rest.length ? setIn(inner, rest) : next;
    const items = updated && updated.items.length ? group.items.map((item, i) => i === index ? groupPredicate(updated) : item) : group.items.filter((_, i) => i !== index);
    return { ...group, items };
  };
  const group = setIn(root.group, at);
  return closeRoot({ group, wrapped: root.wrapped && group.items.length <= 1 && group.mode === 'all' });
}
/** Moves a row within its group by `offset`. */
export function moveItem<T>(items: readonly T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items]; const [item] = next.splice(index, 1); next.splice(target, 0, item);
  return next;
}
