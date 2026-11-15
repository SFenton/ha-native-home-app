import { z } from 'zod/v4';
import { identifierSchema } from '../schema';
import type { CompositionIssue } from './json';

/**
 * The `sh.state-style@1` contract: a document-level style library and the per-tile binding that applies one.
 *
 * A style is a named state map (ordered rules, a fallback and request settings) the app resolves into the four layers of the
 * state-styled tile: icon, text, indicator and colour. The app owns the class defaults (`.agents/design/state-styled-tile.md`);
 * this file owns the data: the Zod schemas, the eight built-in styles as data (the app's `StateStyle+BuiltIn.swift` and
 * `contract/corpus/state-styles/built-in.json` must agree with them), the default class per domain state, and the indicator
 * rules the Studio offers. Nothing here executes: a style is values only.
 */
const object = z.strictObject;
const text = (maximum: number) => z.string().max(maximum).refine(value => Boolean(value.trim()));

// MARK: Closed lists

/** The five classes of a state (`resting`, `in-progress`, `warning`, `error`, `unknown`). */
export const stateClasses = ['resting', 'in-progress', 'warning', 'error', 'unknown'] as const;
/** The indicator layer's closed list. Nothing else is authorable. */
export const stateIndicators = ['none', 'arc-spinner', 'pulse', 'breathe', 'bounce', 'wiggle'] as const;
/**
 * The colour layer's tokens: the face of a resting or in-progress state, lit or unlit. A token never changes the class, so it never
 * changes the words, the effects or what a request shows; absent means the face the class and `active` pick.
 */
export const stateColours = ['unlit', 'lit'] as const;
/** The classes whose face the colour layer may set; a warning, an error and an unknown state keep the face of their class. */
export const colourClasses: readonly StateClass[] = ['resting', 'in-progress'];
/** Whether a state of `stateClass` may carry a colour token. */
export const colourAllowed = (stateClass: StateClass): boolean => colourClasses.includes(stateClass);
/** The built-in style ids, in the library's order. */
export const builtInStyleIds = ['garage-door', 'lock', 'blind', 'alarm', 'robot', 'detector', 'notice', 'switch'] as const;
export type StateClass = typeof stateClasses[number];
export type StateIndicator = typeof stateIndicators[number];
export type StateColour = typeof stateColours[number];
export type BuiltInStyleId = typeof builtInStyleIds[number];

/** A service name on the style's domain. */
const serviceName = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);
/** An entity id `domain.object`. */
export const entityIdSchema = z.string().max(160).regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/);

// MARK: Schemas

const alternative = object({ verb: text(80), icon: text(80), service: serviceName.optional() });
/** What the disc does in one state: a service on the style's domain, with an optional confirmation and a feature gate. */
const actionSchema = object({
  verb: text(80), icon: text(80), service: serviceName.optional(), tappable: z.boolean().optional(),
  confirmation: object({ title: text(240), message: text(2000), confirmVerb: text(240) }).optional(),
  requiresFeature: z.number().int().min(1).max(65_535).optional(), otherwise: alternative.optional(),
});
const lookFields = {
  class: z.enum(stateClasses), active: z.boolean(),
  icon: text(80).optional(), text: text(80).optional(),
  indicator: z.enum(stateIndicators).optional(), colour: z.enum(stateColours).optional(),
  action: actionSchema.optional(),
};
const ruleSchema = object({ states: z.array(text(80)).min(1).max(16), ...lookFields });
const fallbackSchema = object(lookFields);
const seconds = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);
const requestSchema = object({
  lockoutSeconds: seconds(0, 60), ackTimeoutSeconds: seconds(1, 120), settleTimeoutSeconds: seconds(0, 600), errorHoldSeconds: seconds(0, 60),
  onTimeout: z.enum(['error', 'revert']),
  pendingWords: z.array(object({ service: serviceName, text: text(80) })).max(8).optional(),
  errorWords: text(80).optional(),
  /** The Home Assistant script and error timer the lifecycle reads; both or neither. The Studio installs neither. */
  script: entityIdSchema.optional(), errorTimer: entityIdSchema.optional(),
});
export const stateStyleSchema = object({
  id: identifierSchema, name: text(80), base: z.enum(builtInStyleIds).optional(),
  domain: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64), actionId: identifierSchema.optional(),
  togglesDisc: z.boolean().optional(), drawsErrorDisc: z.boolean().optional(),
  rules: z.array(ruleSchema).min(1).max(32), fallback: fallbackSchema, request: requestSchema.optional(),
});
/** The document's style library. */
export const stateStyleLibrarySchema = object({ type: z.literal('state-styles@1'), styles: z.array(stateStyleSchema).max(32) });
/** One layer-by-layer override of one state on one tile. At least one layer must be set (checked by the compiler). */
export const stateOverrideSchema = object({
  state: text(80), icon: text(80).optional(), text: text(80).optional(),
  indicator: z.enum(stateIndicators).optional(), colour: z.enum(stateColours).optional(),
});
/** What a tile binds: the entity, a library style by id, the tile's own built-in style, and its overrides. */
export const stateTileBindingSchema = object({
  entityId: entityIdSchema, styleId: identifierSchema.optional(), builtIn: z.enum(builtInStyleIds).optional(),
  overrides: z.array(stateOverrideSchema).max(32).optional(),
});

export type StateStyleAction = z.infer<typeof actionSchema>;
export type StateRule = z.infer<typeof ruleSchema>;
export type StateFallback = z.infer<typeof fallbackSchema>;
export type StateRequest = z.infer<typeof requestSchema>;
export type StateStyleDefinition = z.infer<typeof stateStyleSchema>;
export type StateStyleLibrary = z.infer<typeof stateStyleLibrarySchema>;
export type StateOverride = z.infer<typeof stateOverrideSchema>;
export type StateTileBinding = z.infer<typeof stateTileBindingSchema>;
/** The layers an override may set. */
export const overrideLayers = ['icon', 'text', 'indicator', 'colour'] as const;
export type OverrideLayer = typeof overrideLayers[number];

// MARK: Built-in styles as data

const pending = (...pairs: [string, string][]) => pairs.map(([service, words]) => ({ service, text: words }));
const unknownStates = ['unavailable', 'unknown'];
const act = (verb: string, icon: string, service: string | undefined, rest: Partial<StateStyleAction> = {}): StateStyleAction =>
  ({ verb, icon, ...(service ? { service } : {}), ...rest });
const stopOr = (alt: StateStyleAction['otherwise']): Partial<StateStyleAction> => ({ requiresFeature: 8, ...(alt ? { otherwise: alt } : {}) });
const disarmConfirmation = { title: 'Disarm the Security System?', message: 'Doors and motion stop triggering the alarm.', confirmVerb: 'Disarm' };
const armHome = act('Arm Home', 'shield.lefthalf.filled', 'alarm_arm_home');
const disarm = act('Disarm', 'shield.slash', 'alarm_disarm', { confirmation: disarmConfirmation });
/** A map ends with a fallback: a copy of its own unknown rule that names no state, as the app's `StateStyle` appends one. */
const withFallback = (rules: StateRule[]): { rules: StateRule[]; fallback: StateFallback } => {
  const unknown = rules.find(rule => rule.class === 'unknown')!;
  const { states: _states, ...fallback } = unknown;
  return { rules, fallback };
};

const garageDoor: StateStyleDefinition = {
  id: 'garage-door', name: 'Garage door', domain: 'cover', actionId: 'door', togglesDisc: true,
  ...withFallback([
    { states: ['closed'], class: 'resting', active: false, action: act('Open', 'door.garage.closed', 'open_cover') },
    { states: ['open'], class: 'resting', active: true, action: act('Close', 'door.garage.open', 'close_cover') },
    { states: ['opening'], class: 'in-progress', active: true, action: act('Stop', 'stop.fill', 'stop_cover', stopOr({ verb: 'Reverse', icon: 'arrow.uturn.down', service: 'close_cover' })) },
    { states: ['closing'], class: 'in-progress', active: true, action: act('Stop', 'stop.fill', 'stop_cover', stopOr({ verb: 'Reverse', icon: 'arrow.uturn.up', service: 'open_cover' })) },
    { states: unknownStates, class: 'unknown', active: false, icon: 'door.garage.closed', action: act('Open', 'door.garage.closed', undefined, { tappable: false }) },
  ]),
  request: {
    lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 8, onTimeout: 'error',
    pendingWords: pending(['close_cover', 'Sending Close…'], ['open_cover', 'Sending Open…'], ['stop_cover', 'Stopping…']), errorWords: 'Error',
  },
};
const lock: StateStyleDefinition = {
  id: 'lock', name: 'Lock', domain: 'lock', actionId: 'lock', togglesDisc: true, drawsErrorDisc: true,
  ...withFallback([
    { states: ['locked'], class: 'resting', active: false, action: act('Unlock', 'lock.fill', 'unlock') },
    { states: ['unlocked'], class: 'resting', active: true, action: act('Lock', 'lock.open', 'lock') },
    { states: ['open'], class: 'warning', active: true, action: act('Lock', 'lock.open', 'lock') },
    { states: ['locking'], class: 'in-progress', active: false, action: act('Unlock', 'lock.fill', 'unlock', { tappable: false }) },
    { states: ['unlocking', 'opening'], class: 'in-progress', active: true, action: act('Lock', 'lock.open', 'lock', { tappable: false }) },
    { states: ['jammed'], class: 'error', active: true, action: act('Lock', 'lock.trianglebadge.exclamationmark', 'lock') },
    { states: unknownStates, class: 'unknown', active: false, icon: 'lock.fill', action: act('Unlock', 'lock.fill', 'unlock', { tappable: false }) },
  ]),
  request: { lockoutSeconds: 0, ackTimeoutSeconds: 10, settleTimeoutSeconds: 2, errorHoldSeconds: 4, onTimeout: 'revert', errorWords: "Didn't Respond" },
};
const blind: StateStyleDefinition = {
  id: 'blind', name: 'Blind', domain: 'cover', actionId: 'blind', togglesDisc: true,
  ...withFallback([
    { states: ['closed'], class: 'resting', active: false, icon: 'blinds.horizontal.closed', action: act('Open', 'blinds.horizontal.closed', 'open_cover') },
    { states: ['open'], class: 'resting', active: true, icon: 'blinds.horizontal.open', action: act('Close', 'blinds.horizontal.open', 'close_cover') },
    { states: ['opening', 'closing'], class: 'in-progress', active: true, icon: 'blinds.horizontal.open', action: act('Stop', 'stop.fill', 'stop_cover', stopOr(undefined)) },
    { states: unknownStates, class: 'unknown', active: false, icon: 'blinds.horizontal.closed' },
  ]),
  request: { lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 4, onTimeout: 'error', errorWords: "Didn't Respond" },
};
const alarm: StateStyleDefinition = {
  id: 'alarm', name: 'Alarm', domain: 'alarm_control_panel', actionId: 'alarm',
  ...withFallback([
    { states: ['disarmed'], class: 'resting', active: false, action: armHome },
    { states: ['armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass'], class: 'resting', active: true, action: disarm },
    { states: ['arming'], class: 'in-progress', active: true, action: disarm },
    { states: ['pending'], class: 'warning', active: true, action: disarm },
    { states: ['disarming'], class: 'in-progress', active: false, action: act('Arm Home', 'shield.lefthalf.filled', 'alarm_arm_home', { tappable: false }) },
    { states: ['triggered'], class: 'error', active: true, action: disarm },
    { states: unknownStates, class: 'unknown', active: false, icon: 'shield.lefthalf.filled', action: act('Arm Home', 'shield.lefthalf.filled', 'alarm_arm_home', { tappable: false }) },
  ]),
};
const robot: StateStyleDefinition = {
  id: 'robot', name: 'Robot', domain: 'vacuum', actionId: 'robot',
  ...withFallback([
    { states: ['docked', 'idle'], class: 'resting', active: false },
    { states: ['cleaning', 'mowing'], class: 'resting', active: true, indicator: 'breathe' },
    { states: ['paused'], class: 'warning', active: false },
    { states: ['returning'], class: 'in-progress', active: false },
    { states: ['error'], class: 'error', active: false },
    { states: unknownStates, class: 'unknown', active: false },
  ]),
};
const detector: StateStyleDefinition = {
  id: 'detector', name: 'Detector', domain: 'binary_sensor', actionId: 'detector',
  ...withFallback([
    { states: ['off'], class: 'resting', active: false }, { states: ['on'], class: 'error', active: false },
    { states: unknownStates, class: 'unknown', active: false },
  ]),
};
const notice: StateStyleDefinition = {
  id: 'notice', name: 'Notice', domain: 'binary_sensor', actionId: 'notice',
  ...withFallback([
    { states: ['off'], class: 'resting', active: false }, { states: ['on'], class: 'warning', active: false },
    { states: unknownStates, class: 'unknown', active: false },
  ]),
};
const switchStyle: StateStyleDefinition = {
  id: 'switch', name: 'Switch', domain: 'switch', actionId: 'switch',
  ...withFallback([
    { states: ['off'], class: 'resting', active: false }, { states: ['on'], class: 'resting', active: true },
    { states: unknownStates, class: 'unknown', active: false },
  ]),
};

/** The eight built-in styles, in the library's order. Read-only: the Studio duplicates one to edit it. */
export const builtInStyles: readonly StateStyleDefinition[] = [garageDoor, lock, blind, alarm, robot, detector, notice, switchStyle];
const builtInById = new Map<string, StateStyleDefinition>(builtInStyles.map(style => [style.id, style]));
/** The built-in style with `id`, if any. */
export const builtInStyle = (id: string | undefined): StateStyleDefinition | undefined => (id === undefined ? undefined : builtInById.get(id));
/** The service domain each built-in style acts on. */
export const builtInDomain = (id: BuiltInStyleId): string => builtInById.get(id)!.domain;

/** The Studio's suggestion of a built-in style for an entity, by domain and device class (`state-styles.md`). */
export function suggestBuiltInStyle(entityId: string, deviceClass?: string): BuiltInStyleId | undefined {
  const domain = entityId.split('.')[0];
  if (domain === 'cover') return deviceClass && ['garage', 'gate', 'door'].includes(deviceClass) ? 'garage-door' : 'blind';
  if (domain === 'lock') return 'lock';
  if (domain === 'alarm_control_panel') return 'alarm';
  if (domain === 'vacuum' || domain === 'lawn_mower') return 'robot';
  if (domain === 'switch' || domain === 'input_boolean') return 'switch';
  if (domain === 'binary_sensor') {
    if (deviceClass && ['smoke', 'gas', 'carbon_monoxide', 'moisture', 'problem', 'tamper', 'safety'].includes(deviceClass)) return 'detector';
    if (deviceClass && ['battery', 'heat', 'cold', 'update', 'connectivity'].includes(deviceClass)) return 'notice';
  }
  return undefined;
}

// MARK: Default classes

/** What the Studio assumes about one Home Assistant state until the author changes it. */
export interface StateDefault { class: StateClass; active: boolean; classified: boolean }
const rest = (active = false): StateDefault => ({ class: 'resting', active, classified: true });
const progress = (active = false): StateDefault => ({ class: 'in-progress', active, classified: true });
const warn = (active = true): StateDefault => ({ class: 'warning', active, classified: true });
const fail = (active = true): StateDefault => ({ class: 'error', active, classified: true });
const unknownDefault: StateDefault = { class: 'unknown', active: false, classified: true };
/**
 * The class and `active` Home Assistant's own states get by default, by domain. Alarm `pending`, lock `open` and vacuum `paused` are
 * warnings. A state no table knows is resting and unlit with `classified: false`, so the editor lists it as unclassified.
 */
const domainDefaults: Record<string, Record<string, StateDefault>> = {
  cover: { closed: rest(), open: rest(true), opening: progress(true), closing: progress(true) },
  lock: { locked: rest(), unlocked: rest(true), open: warn(), locking: progress(), unlocking: progress(true), opening: progress(true), jammed: fail() },
  alarm_control_panel: {
    disarmed: rest(), armed_home: rest(true), armed_away: rest(true), armed_night: rest(true), armed_vacation: rest(true),
    armed_custom_bypass: rest(true), arming: progress(true), pending: warn(), disarming: progress(), triggered: fail(),
  },
  vacuum: { docked: rest(), idle: rest(), cleaning: rest(true), mowing: rest(true), paused: warn(false), returning: progress(), error: fail(false) },
  lawn_mower: { docked: rest(), paused: warn(false), mowing: rest(true), returning: progress(), error: fail(false) },
  binary_sensor: { off: rest(), on: rest(true) },
  switch: { off: rest(), on: rest(true) }, input_boolean: { off: rest(), on: rest(true) },
  light: { off: rest(), on: rest(true) }, fan: { off: rest(), on: rest(true) },
  media_player: { off: rest(), standby: rest(), idle: rest(), on: rest(true), playing: rest(true), paused: rest(), buffering: progress(true) },
  climate: { off: rest(), heat: rest(true), cool: rest(true), heat_cool: rest(true), auto: rest(true), dry: rest(true), fan_only: rest(true) },
  timer: { idle: rest(), active: progress(true), paused: warn(false) },
  person: { home: rest(true), not_home: rest() },
  device_tracker: { home: rest(true), not_home: rest() },
  sun: { above_horizon: rest(true), below_horizon: rest() },
  water_heater: { off: rest(), eco: rest(true), electric: rest(true), performance: rest(true), heat_pump: rest(true), gas: rest(true) },
  siren: { off: rest(), on: fail() },
};
/** The default look of `state` on `domain`: `unavailable` and `unknown` are the unknown class everywhere. */
export function defaultStateLook(domain: string, state: string, deviceClass?: string): StateDefault {
  if (state === 'unavailable' || state === 'unknown') return unknownDefault;
  const suggested = domain === 'binary_sensor' ? suggestBuiltInStyle(`${domain}.x`, deviceClass) : undefined;
  if (suggested === 'detector' && state === 'on') return fail(false);
  // Connectivity is reversed: it is the lost connection that warns (`state-styles.md`, Notice).
  if (suggested === 'notice' && deviceClass === 'connectivity') {
    if (state === 'off') return warn(false);
    if (state === 'on') return rest();
  }
  if (suggested === 'notice' && state === 'on') return warn(false);
  return domainDefaults[domain]?.[state] ?? { class: 'resting', active: false, classified: false };
}

// MARK: Indicators

/** What the indicator menu offers for a state, and why a choice is missing. */
export interface IndicatorOption { value: StateIndicator; label: string; available: boolean; note?: string }
const indicatorLabels: Record<StateIndicator, string> = {
  none: 'None', 'arc-spinner': 'Arc spinner', pulse: 'Pulse', breathe: 'Breathe', bounce: 'Bounce', wiggle: 'Wiggle',
};
/** The reason the menu gives beside a state that has an action. */
export const NO_ARC_WITH_ACTION = 'No arc while this state has an action';
/** Whether an arc may stand in for the disc in a state: it has no action, and it is not the unknown class. */
export const arcAllowed = (rule: { class: StateClass; action?: unknown }): boolean => !rule.action && rule.class !== 'unknown';
/**
 * The closed indicator list as a menu. Arc spinner is offered only for a state with no action, and Breathe and Wiggle name their
 * iOS 17 fallbacks (`state-styled-tile.md`, Indicators).
 */
export function indicatorOptions(rule: { class: StateClass; action?: unknown }): IndicatorOption[] {
  return stateIndicators.map(value => ({
    value, label: indicatorLabels[value],
    available: value !== 'arc-spinner' || arcAllowed(rule),
    ...(value === 'arc-spinner' && !arcAllowed(rule) ? { note: rule.action ? NO_ARC_WITH_ACTION : 'Not for an unavailable state' } : {}),
    ...(value === 'breathe' ? { note: 'iOS 17 plays Pulse' } : {}),
    ...(value === 'wiggle' ? { note: 'iOS 17 plays Bounce' } : {}),
  }));
}

// MARK: Rule lookup

/** The first rule that names `state`, else the fallback: the same order the app resolves in, with the unknown rule below. */
export function ruleFor(style: Pick<StateStyleDefinition, 'rules' | 'fallback'>, state: string): StateRule | StateFallback {
  if (state === 'unavailable' || state === 'unknown') return unknownRuleFor(style);
  return style.rules.find(rule => rule.states.includes(state)) ?? style.fallback;
}

/**
 * The rule an unavailable or unknown entity takes. The app's `StateStyle` resolves them to the first rule of the unknown class, and a
 * map with none gets one made for it: no icon of its own (the node's icon is drawn), the words "Unavailable", unlit, and an untappable
 * copy of the map's first action, so an unavailable entity never reads as resting or offers a tap. The authored fallback is not used.
 */
export function unknownRuleFor(style: Pick<StateStyleDefinition, 'rules' | 'fallback'>): StateRule {
  const authored = style.rules.find(rule => rule.class === 'unknown');
  if (authored) return authored;
  const first = style.rules.find(rule => rule.action)?.action;
  return {
    states: ['unavailable', 'unknown'], class: 'unknown', active: false,
    ...(first ? { action: { verb: first.verb, icon: first.icon, tappable: false } } : {}),
  };
}

// MARK: Validation

const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));
const isEntityOn = (value: string, domain: string) => /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value) && domainOf(value) === domain;

/**
 * The semantic checks of a style library, with the pointers the app's compiler reports (`ServerUIStateStyles`).
 * Shape (closed fields, ranges, patterns) is the Zod schema's job; this is what the shape cannot say.
 *
 * - `unavailable` and `unknown` are the unknown class in every style.
 * - A colour token is for a resting or in-progress state; a warning, an error or an unknown state refuses it (rule and override).
 * - The arc spinner stands in for the disc, so a rule with an action, or of the unknown class, refuses it.
 * - `otherwise` is the same action without the feature, so it needs `requiresFeature`.
 * - The script and the error timer are named together or not at all, and are a `script.` and a `timer.` entity.
 * - A style id is unique in the library (reported by the caller's id register).
 */
export function checkStateStyleLibrary(library: StateStyleLibrary, base: string): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const add = (code: CompositionIssue['code'], pointer: string) => { issues.push({ code, pointer }); };
  const look = (value: StateFallback | StateRule, path: string) => {
    if (value.indicator === 'arc-spinner' && !arcAllowed(value)) add('invalid_combination', `${path}/indicator`);
    if (value.colour !== undefined && !colourAllowed(value.class)) add('invalid_combination', `${path}/colour`);
    if (value.action?.otherwise && value.action.requiresFeature === undefined) add('invalid_combination', `${path}/action/otherwise`);
  };
  library.styles.forEach((style, index) => {
    const p = `${base}/styles/${index}`;
    style.rules.forEach((rule, ruleIndex) => {
      const rp = `${p}/rules/${ruleIndex}`;
      if (rule.states.some(state => state === 'unavailable' || state === 'unknown') && rule.class !== 'unknown') add('invalid_combination', `${rp}/class`);
      look(rule, rp);
    });
    look(style.fallback, `${p}/fallback`);
    const request = style.request;
    if (request) {
      const rp = `${p}/request`;
      if ((request.script === undefined) !== (request.errorTimer === undefined)) add('invalid_combination', `${rp}/${request.script === undefined ? 'script' : 'errorTimer'}`);
      if (request.script !== undefined && !isEntityOn(request.script, 'script')) add('invalid_combination', `${rp}/script`);
      if (request.errorTimer !== undefined && !isEntityOn(request.errorTimer, 'timer')) add('invalid_combination', `${rp}/errorTimer`);
    }
  });
  return issues;
}

/** The style a tile's binding resolves to: the library's by id, else the tile's own built-in style, else none. */
export function resolveTileStyle(binding: StateTileBinding, library: StateStyleLibrary | undefined): StateStyleDefinition | undefined {
  return library?.styles.find(style => style.id === binding.styleId) ?? builtInStyle(binding.builtIn);
}

/**
 * The semantic checks of a `state-tile` binding. An unknown style id is not an error (the app falls back to the tile's built-in
 * style); the Studio blocks deleting a style in use. The entity is in the domain the style it ends up with acts on.
 */
export function checkStateTileBinding(binding: StateTileBinding, library: StateStyleLibrary | undefined, base: string): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const add = (code: CompositionIssue['code'], pointer: string) => { issues.push({ code, pointer }); };
  if (binding.styleId === undefined && binding.builtIn === undefined) add('invalid_combination', base);
  const authored = binding.styleId === undefined ? undefined : library?.styles.find(style => style.id === binding.styleId);
  const entityDomain = domainOf(binding.entityId);
  if (authored && authored.domain !== entityDomain) add('invalid_combination', `${base}/entityId`);
  if (binding.builtIn !== undefined && builtInDomain(binding.builtIn) !== entityDomain) add('invalid_combination', `${base}/builtIn`);
  const effective = authored ?? builtInStyle(binding.builtIn);
  const seen = new Set<string>();
  binding.overrides?.forEach((override, index) => {
    const op = `${base}/overrides/${index}`;
    if (seen.has(override.state)) add('invalid_combination', `${op}/state`);
    seen.add(override.state);
    if (!overrideLayers.some(layer => override[layer] !== undefined)) add('invalid_combination', op);
    if (override.indicator === 'arc-spinner' && effective && !arcAllowed(ruleFor(effective, override.state))) add('invalid_combination', `${op}/indicator`);
    if (override.colour !== undefined && effective && !colourAllowed(ruleFor(effective, override.state).class)) add('invalid_combination', `${op}/colour`);
  });
  return issues;
}
