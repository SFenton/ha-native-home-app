import { createId } from '../ids';
import { compositionChildren, type CompositionDocument, type CompositionNode } from './schema';
import {
  arcAllowed, builtInStyle, colourAllowed, builtInStyles, defaultStateLook, overrideLayers, resolveTileStyle, suggestBuiltInStyle,
  type OverrideLayer, type StateFallback, type StateOverride, type StateRule, type StateStyleDefinition, type StateStyleLibrary,
  type StateTileBinding,
} from './state-styles';

/**
 * The operations the Studio's style library panel offers, as pure functions over the document (`.agents/design/state-styles.md`,
 * The Studio's style library). Built-in styles are read-only: Duplicate makes a saved one. Rename and Delete are for saved styles,
 * and Delete needs zero uses.
 */

/** The style library of a document, read-only built-ins first and then the saved styles. */
export interface LibraryEntry { style: StateStyleDefinition; builtIn: boolean; usedBy: number }

/** A `state-tile` node of the document. */
export type StateTileNode = Extract<CompositionNode, { type: 'state-tile' }>;

/** Every `state-tile` node of every page and modal. */
export function stateTiles(document: Pick<CompositionDocument, 'pages' | 'modals'>): StateTileNode[] {
  const found: StateTileNode[] = [];
  const visit = (nodes: CompositionNode[]) => {
    for (const node of nodes) {
      if (node.type === 'state-tile') found.push(node);
      visit(compositionChildren(node));
    }
  };
  for (const surface of [...document.pages, ...document.modals]) visit(surface.components);
  return found;
}

/** How many tiles apply the library style `id`. */
export const usedBy = (document: Pick<CompositionDocument, 'pages' | 'modals'>, id: string): number =>
  stateTiles(document).filter(tile => tile.binding.styleId === id).length;

/** The library as the panel lists it: the built-ins, then the document's saved styles, each with "Used by N tiles". */
export function libraryEntries(document: Pick<CompositionDocument, 'pages' | 'modals' | 'stateStyles'>): LibraryEntry[] {
  return [
    ...builtInStyles.map(style => ({ style, builtIn: true, usedBy: 0 })),
    ...(document.stateStyles?.styles ?? []).map(style => ({ style, builtIn: false, usedBy: usedBy(document, style.id) })),
  ];
}

/** The words under a style's name: "Used by 2 tiles". */
export const usedByText = (count: number): string => `Used by ${count} ${count === 1 ? 'tile' : 'tiles'}`;

/** The warning shown before an edit to a saved style is kept: how many tiles change. */
export function editWarning(count: number): string | undefined {
  return count > 0 ? `This changes ${count} ${count === 1 ? 'tile' : 'tiles'}.` : undefined;
}

/** Whether the saved style `id` may be deleted: only with zero uses. */
export function deleteBlock(document: Pick<CompositionDocument, 'pages' | 'modals'>, id: string): string | undefined {
  if (builtInStyle(id)) return 'Built-in styles are read-only.';
  const count = usedBy(document, id);
  return count > 0 ? `${usedByText(count)}. Point them at another style first.` : undefined;
}

/** A library with `style` appended; an id already in use gets a numeric suffix. */
function appended(library: StateStyleLibrary | undefined, style: StateStyleDefinition): StateStyleLibrary {
  const styles = library?.styles ?? [];
  let id = style.id, n = 2;
  while (styles.some(existing => existing.id === id) || builtInStyle(id)) id = `${style.id}-${n++}`;
  return { type: 'state-styles@1', styles: [...styles, { ...style, id }] };
}

/** Duplicate: a saved copy of any style, built-in or saved. A copy of a built-in remembers it as its `base`. */
export function duplicateStyle(library: StateStyleLibrary | undefined, source: StateStyleDefinition, name = `${source.name} copy`): { library: StateStyleLibrary; id: string } {
  const copy: StateStyleDefinition = { ...structuredClone(source), id: createId('style'), name, base: builtInStyle(source.id) ? source.id as StateStyleDefinition['base'] : source.base };
  const next = appended(library, copy);
  return { library: next, id: next.styles.at(-1)!.id };
}

/** Rename a saved style. */
export function renameStyle(library: StateStyleLibrary, id: string, name: string): StateStyleLibrary {
  return { ...library, styles: library.styles.map(style => (style.id === id ? { ...style, name } : style)) };
}

/** Delete a saved style. Throws while a tile uses it, and for a built-in. */
export function deleteStyle(document: Pick<CompositionDocument, 'pages' | 'modals' | 'stateStyles'>, id: string): StateStyleLibrary {
  const blocked = deleteBlock(document, id);
  if (blocked) throw new Error(blocked);
  return { type: 'state-styles@1', styles: (document.stateStyles?.styles ?? []).filter(style => style.id !== id) };
}

// MARK: Overrides

/** Where the state `state` of a binding is overridden, layer by layer. */
export const overrideFor = (binding: StateTileBinding, state: string): StateOverride | undefined => binding.overrides?.find(item => item.state === state);

/** Sets one layer of one state's override; an empty value clears the layer. */
export function setOverride(binding: StateTileBinding, state: string, layer: OverrideLayer, value: string | undefined): StateTileBinding {
  const overrides = (binding.overrides ?? []).filter(item => item.state !== state);
  const current = overrideFor(binding, state) ?? { state };
  const next = { ...current, [layer]: value === '' ? undefined : value } as StateOverride;
  if (next[layer] === undefined) delete next[layer];
  if (overrideLayers.some(name => next[name] !== undefined)) overrides.push(next);
  const { overrides: _old, ...rest } = binding;
  return overrides.length ? { ...rest, overrides } : rest;
}

/** Resets one layer of one override, or the whole state's override when no layer is given. The tile keeps its link to the style. */
export function resetOverride(binding: StateTileBinding, state: string, layer?: OverrideLayer): StateTileBinding {
  if (!layer) {
    const overrides = (binding.overrides ?? []).filter(item => item.state !== state);
    const { overrides: _old, ...rest } = binding;
    return overrides.length ? { ...rest, overrides } : rest;
  }
  return setOverride(binding, state, layer, undefined);
}

/** The layers a tile overrides in a state, for the mark on the tile. */
export const overriddenLayers = (binding: StateTileBinding, state: string): OverrideLayer[] => {
  const item = overrideFor(binding, state);
  return item ? overrideLayers.filter(layer => item[layer] !== undefined) : [];
};

/**
 * Save as New Style: a saved style made from the tile's style plus its overrides, and the binding pointing at it with no overrides.
 * A state that shares a rule with others is split off so the override applies to it alone.
 */
export function saveAsNewStyle(document: Pick<CompositionDocument, 'stateStyles'>, binding: StateTileBinding, name: string):
  { library: StateStyleLibrary; binding: StateTileBinding } | undefined {
  const source = resolveTileStyle(binding, document.stateStyles);
  if (!source) return undefined;
  const copy: StateStyleDefinition = { ...structuredClone(source), id: createId('style'), name, base: builtInStyle(source.id) ? source.id as StateStyleDefinition['base'] : source.base };
  const layers = (target: StateRule | StateFallback, item: StateOverride) => {
    if (item.icon !== undefined) target.icon = item.icon;
    if (item.text !== undefined) target.text = item.text;
    if (item.indicator !== undefined) target.indicator = item.indicator;
    if (item.colour !== undefined) target.colour = item.colour;
  };
  for (const item of binding.overrides ?? []) {
    const index = copy.rules.findIndex(rule => rule.states.includes(item.state));
    if (index < 0) {
      const rule: StateRule = { ...structuredClone(copy.fallback), states: [item.state] };
      layers(rule, item);
      copy.rules.splice(copy.rules.length, 0, rule);
      continue;
    }
    const rule = copy.rules[index];
    if (rule.states.length === 1) { layers(rule, item); continue; }
    const own: StateRule = { ...structuredClone(rule), states: [item.state] };
    layers(own, item);
    rule.states = rule.states.filter(state => state !== item.state);
    copy.rules.splice(index + 1, 0, own);
  }
  const library = appended(document.stateStyles, copy);
  const { overrides: _overrides, ...rest } = binding;
  return { library, binding: { ...rest, styleId: library.styles.at(-1)!.id } };
}

// MARK: Entity picker

/** A state Home Assistant offers for an entity: its name and its translated words. */
export interface HaState { state: string; name?: string }

/** The result of filling a state map from an entity. */
export interface StateMapDraft { rules: StateRule[]; fallback: StateFallback; unclassified: string[] }

/**
 * Fills a state map from Home Assistant's own states and names. Each state gets its default class and `active` (alarm `pending`,
 * lock `open` and vacuum `paused` are warnings). States seen only in history are listed after them as unclassified. The map always
 * ends with a fallback: `unknown`, or resting for an open-ended state (a sensor value, a select, a zone).
 */
export function buildStateMap(entityId: string, states: HaState[], history: string[] = [], deviceClass?: string, openEnded = false): StateMapDraft {
  const domain = entityId.split('.')[0];
  const unclassified: string[] = [];
  const seen = new Set<string>();
  const rules: StateRule[] = [];
  const add = (state: string, name: string | undefined, fromHistory: boolean) => {
    if (seen.has(state)) return;
    seen.add(state);
    const look = defaultStateLook(domain, state, deviceClass);
    if (!look.classified || fromHistory) unclassified.push(state);
    rules.push({ states: [state], class: look.class, active: look.active, ...(name && name !== state ? { text: name } : {}) });
  };
  for (const item of states) add(item.state, item.name, false);
  for (const state of history) add(state, undefined, true);
  if (!seen.has('unavailable') && !seen.has('unknown')) rules.push({ states: ['unavailable', 'unknown'], class: 'unknown', active: false });
  const fallback: StateFallback = openEnded ? { class: 'resting', active: false } : { class: 'unknown', active: false };
  return { rules, fallback, unclassified };
}

// MARK: Editing a saved style

const unknownStates = new Set(['unavailable', 'unknown']);
/** Whether a rule names `unavailable` or `unknown`: its class is fixed at unknown. */
export const classFixed = (rule: { states?: string[] }): boolean => Boolean(rule.states?.some(state => unknownStates.has(state)));

/**
 * Applies `patch` to a rule or the fallback and keeps the rule valid: an unavailable state stays the unknown class, and an arc
 * spinner the rule can no longer show (an action, or the unknown class) is dropped, and so is an ink with no fill and an icon colour on a
 * state that cannot carry one (a warning, error or unknown class, or a fill).
 */
export function patchRule<T extends StateRule | StateFallback>(rule: T, patch: Partial<StateRule>): T {
  const next = { ...rule, ...patch } as T;
  for (const key of Object.keys(next) as (keyof T)[]) if (next[key] === undefined || (next[key] as unknown) === '') delete next[key];
  if ('states' in next && classFixed(next as StateRule)) next.class = 'unknown';
  if (next.indicator === 'arc-spinner' && !arcAllowed(next)) delete next.indicator;
  // The ink belongs to the fill (`sh.tile-ink@1`): without a fill it has nothing to be the ink of.
  if (next.fill === undefined) delete next.fillInk;
  // The icon colour (`sh.state-style-glyph-tint@1`) sits on a resting or in-progress state with no fill: a rule that stops being one drops it.
  if (next.glyphTint !== undefined && (!colourAllowed(next.class) || next.fill !== undefined)) delete next.glyphTint;
  return next;
}

/** A style with `patch` merged into the rule at `index` (the fallback when `index` is -1). */
export function patchStyleRule(style: StateStyleDefinition, index: number, patch: Partial<StateRule>): StateStyleDefinition {
  if (index < 0) return { ...style, fallback: patchRule(style.fallback, patch) };
  return { ...style, rules: style.rules.map((rule, at) => (at === index ? patchRule(rule, patch) : rule)) };
}

/** A style with a new resting rule for `state` before the unavailable rule. */
export function addStyleRule(style: StateStyleDefinition, state: string): StateStyleDefinition {
  if (style.rules.length >= 32 || style.rules.some(rule => rule.states.includes(state))) return style;
  const rule: StateRule = { states: [state], class: 'resting', active: false };
  const at = style.rules.findIndex(existing => classFixed(existing));
  const rules = [...style.rules];
  rules.splice(at < 0 ? rules.length : at, 0, rule);
  return { ...style, rules };
}

/** A style without the rule at `index`; the last rule stays so the map is never empty. */
export const removeStyleRule = (style: StateStyleDefinition, index: number): StateStyleDefinition =>
  style.rules.length > 1 ? { ...style, rules: style.rules.filter((_, at) => at !== index) } : style;

/** A style with the rule at `index` moved by `offset` places. The first matching rule wins, so the order matters. */
export function moveStyleRule(style: StateStyleDefinition, index: number, offset: number): StateStyleDefinition {
  const to = index + offset;
  if (to < 0 || to >= style.rules.length) return style;
  const rules = [...style.rules];
  [rules[index], rules[to]] = [rules[to], rules[index]];
  return { ...style, rules };
}

/** The library with the saved style `id` replaced by `next`. */
export const replaceStyle = (library: StateStyleLibrary, id: string, next: StateStyleDefinition): StateStyleLibrary =>
  ({ ...library, styles: library.styles.map(style => (style.id === id ? next : style)) });

/** The document with the `state-tile` node `id` replaced by `change(node)`, wherever it sits. */
export function updateStateTile<T extends Pick<CompositionDocument, 'pages' | 'modals'>>(document: T, id: string, change: (tile: StateTileNode) => StateTileNode): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.type === 'state-tile' && record.id === id) return change(record as unknown as StateTileNode);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, walk(child)]));
  };
  return { ...document, pages: walk(document.pages) as T['pages'], modals: walk(document.modals) as T['modals'] };
}

/** A new saved style from an entity's states: a name, the domain of the entity and the filled map. */
export function styleFromEntity(entityId: string, name: string, draft: StateMapDraft, request?: StateStyleDefinition['request']): StateStyleDefinition {
  return { id: createId('style'), name, domain: entityId.split('.')[0], rules: draft.rules, fallback: draft.fallback, ...(request ? { request } : {}) };
}

// MARK: Adding a tile

/**
 * A new `state-tile` node for `entityId`: the style the Studio suggests by domain and device class (`state-styles.md`), else the
 * first saved style of the entity's domain, else none. A tile with no style would be rejected, so no node is made for it.
 */
export function newStateTile(entityId: string, name: string, deviceClass: string | undefined, library: StateStyleLibrary | undefined): StateTileNode | undefined {
  const builtIn = suggestBuiltInStyle(entityId, deviceClass);
  const saved = builtIn ? undefined : library?.styles.find(style => style.domain === entityId.split('.')[0]);
  if (!builtIn && !saved) return undefined;
  return {
    id: createId('state-tile'), title: name.trim() || entityId, type: 'state-tile', layout: {},
    icon: { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'fallback' }, props: {},
    binding: { entityId, ...(builtIn ? { builtIn } : { styleId: saved!.id }) },
  } as StateTileNode;
}

/** The document with `tile` added at the end of page `pageId`. An unknown page leaves the document as it was. */
export function addStateTile<T extends Pick<CompositionDocument, 'pages'>>(document: T, pageId: string, tile: StateTileNode): T {
  return { ...document, pages: document.pages.map(page => (page.id === pageId ? { ...page, components: [...page.components, tile] } : page)) };
}
