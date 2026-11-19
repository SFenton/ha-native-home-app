import { z } from 'zod/v4';
import { boundControlActions, boundControlProps, kindDependentActions, kindDependentProps } from './bound-control';
import { settingsDomain, settingsDestination, settingsItem, settingsFixedItems, type SettingsKind } from './settings';
import { climateCapabilities, climateCapability, validateClimateControl, validateClimateInputs, type ClimateProps } from './climate';
import { bodyCount, bodyHeight, checkedBody, COMPONENT_LIMITS, COMPONENT_REF_CAPABILITY, COMPONENT_VALUES_CAPABILITY, derivedId, fieldsOverlap, expandDocument, fieldKind, findNode, findNodePath, ownedSources, readField,
  type DocumentSource } from './components';
import { baseTextStyles, compositionChildren, compositionDocumentSchema, type CompositionAction, type CompositionDocument, type CompositionGroups,
  type CompositionActionSlot, type CompositionNode, type ComponentEntry, type ComponentRefNode, type CompositionRead, type CompositionValue, type RepeatNode } from './schema';
import type { Shape } from './pipeline/shape';
import { assertCompositionBounds, canonicalOfBounded, CompositionValidationError, MAX_COMPOSITION_BYTES,
  pointer, reject, type CompositionIssue } from './json';
import { acceptsLocalValue, initialLocalValue } from './shell';
import { deviceControlModel, isRoomDeviceSource, validateDeviceControl, validateDeviceSource, type RoomDeviceControl } from './room-devices';
import { bedroomCapabilities, bedroomProviders, bedroomWeekdays } from './bedroom';
import { remoteCapabilities, remoteControlIssues } from './remote';
import { deviceProviderCapabilities, isDeviceProvider, deviceProviderIssues, remoteUsesSpeakerTargets } from './device-providers';
import { checkCallService, checkOperand, checkPredicate, operandKind, type CallService, type EnabledWhen, type ExpressionFacts, type ItemScope, type Operand, type Predicate, type WhenUnknown } from './expression';
import { checkStateStyleLibrary, checkStateTileBinding, usesFillInk, usesStateFills } from './state-styles';
import { identifierSchema } from '../validation';
import { APP_STATE_CAPABILITY } from './app-state';
import { checkModelRead, modelReadFields } from './model-reads';
import { pendingCompositionCapabilities } from './pending';
import { checkPipelineProvider, checkPipelineRead, checkPipelineSource, checkRepeatProvider } from './pipeline/compile';
import { checkRepeat } from './repeat';
import { checkChartOperandKind, checkChartSource } from './chart-source';
import { tileInkDefault } from './tile-ink-gate';
import { expandBounded, remapLogicIssues } from './logic-library';
import { badgeNodeKinds, expandBadgeSettings, initialsReadable, MAX_BADGE_TEXT, remapBadgeIssues } from './profile-badges';
import { swipeProblems, type SwipeTile, type TileSwipe } from './tile-swipe';
import { overviewWordKeys, wordKeysFor, wordProblems, type StateWords } from './state-words';
import { groupProblems } from './grid-groups';
import { lateSpans, type FoldSide } from './fold-sides';
import { PIPELINE_LIMITS } from './pipeline/schema';
import { dialControlProblems } from './dial-control';
import { vacuumCapabilities, vacuumPrimitiveCapabilities, validateVacuumControl, validateVacuumDescriptor, type VacuumControl } from './vacuum';

export const firstSliceCapabilities = [
  'sh.actions.navigation@1', 'sh.assets.publisher@1', 'sh.backdrop@1', 'sh.bindings@1', 'sh.chrome@1',
  'sh.composition@1', 'sh.grid@1', 'sh.page@1', 'sh.power-toggle@1', 'sh.sheet@1', 'sh.shell@1',
  'sh.symbols@1', 'sh.text@1', 'sh.tiles@1',
] as const;
/**
 * `sh.tile-ink-default@1`: a capability with no field. While the gate {@link tileInkDefault} is on, every document the Studio compiles declares it, because the Studio's tiles draw the primary ink
 * (white on a page and in a dark sheet) for an icon with no colour of its own and for the state line; an app that predates it draws the muted grey.
 * The gate is off until the native app ships the id: a document then declares nothing (`src/shared/composition/tile-ink-gate.ts`).
 * A publication made before it lists no such id: {@link legacyManifest} is what that manifest looked like (`build/design/sim-fidelity-contract.md`, section 1).
 */
export const INK_DEFAULT_CAPABILITY = 'sh.tile-ink-default@1';
/** A compiled manifest as it was before {@link INK_DEFAULT_CAPABILITY}: the same list without that id. */
export const legacyManifest = (capabilities: readonly string[]): string[] => capabilities.filter(name => name !== INK_DEFAULT_CAPABILITY);
export const supportedCompositionCapabilities: readonly string[] = [
  ...firstSliceCapabilities, 'sh.grid-dynamic-type@1', 'sh.sheet-fit@1', 'sh.tile-presentation@1',
  'sh.alarm-mode@1', 'sh.inventory-summary@1', 'sh.alarm-panel@1',
  'sh.security-door@1', ...climateCapabilities, 'sh.todo-counts@1',
  'sh.settings-link@1', 'sh.settings-controls@1', 'sh.room-navigation@1', 'sh.room-card@1',
  'sh.room-chip@1', 'sh.room-section@1', 'sh.room-visibility@1',
  ...bedroomCapabilities, 'sh.sprinkler-state@1', ...vacuumCapabilities,
  'sh.inventory-list@1', 'sh.household-away-status@1', 'sh.profile-account@1',
  'sh.bootstrap-policy@1', 'sh.bootstrap-message@1', 'sh.bootstrap-notifications@1',
  'sh.section@1', 'sh.rows@1', 'sh.local-tabs@1', 'sh.local-state@1',
  'sh.local-controls@1', 'sh.primary-button@1', 'sh.row-collection@1',
  'sh.collection@1', 'sh.form@1', 'sh.recipe-part@1', 'sh.pinned-actions@1',
  'sh.modal-handoff@1', 'sh.bedroom-collection-links@1',
  'sh.navigation-columns@1',
  'sh.adaptive-presentation@1',
  'sh.pinned-tabs@1', 'sh.supporting-text-styles@1', 'sh.section-title@1', 'sh.surface-title-source@1',
  'sh.shell-header@1',
  'sh.collection-navigation@1',
  'sh.info-box@1', 'sh.status-pill@1', 'sh.paged-row@1',
  'sh.schedule-date-fields@1',
  'sh.presentation-providers@1', 'sh.pinned-form-actions@1', 'sh.section-grid@1', 'sh.full-screen-modal@1', 'sh.module-settings-rows@1',
  'sh.home-status@1', 'sh.status-chip@1', 'sh.status-rail@1', 'sh.room-overview-tile@1',
  'sh.home-light@1', 'sh.light-group-tile@1', 'sh.room-light-power@1', 'sh.power-labels@1', 'sh.home-weather@1', 'sh.weather-panel@1',
  'sh.air-purifier@1', 'sh.bathroom-fan@1', 'sh.grill@1', 'sh.humidifier@1', 'sh.humidifier-scheduling@1',
  ...remoteCapabilities,
  ...deviceProviderCapabilities,
  'sh.remote-speaker-targets@1',
  'sh.camera-stream@1', 'sh.camera-tile@1', 'sh.camera-video@1', 'sh.camera-controls@1', 'sh.camera-viewer@1',
  'sh.activity-presentation@1', 'sh.native-extensions@1', 'sh.route-links@1',
  'sh.call-service@1', 'sh.bound-control@1', 'sh.visible-when@1', 'sh.selected-when@1', 'sh.operands@1',
  'sh.todo-collection@1', 'sh.state-style@1',
  // Shipped by the app (native-ingest L0 to L3, NT1 and L1b); they stay listed here so the Studio compiles them.
  'sh.action-rules@1', 'sh.app-state@1', 'sh.badges@1', 'sh.component-ref@1', 'sh.conditions@1', 'sh.confirm-when@1', 'sh.enabled-when@1',
  'sh.home-status-counts@1', 'sh.overlay@1', 'sh.rules@1', 'sh.tab-bar@1', 'sh.tab-blocks@1', 'sh.tab-fallback@1', 'sh.tile-look@1', 'sh.tile-parts@1',
  'sh.list-read@1', 'sh.raw-state@1', 'sh.state-style-fills@1',
  'sh.bound-options-read@1', 'sh.tile-disc-rules@1', 'sh.grid-min-columns@1', 'sh.bound-row-parts@1', 'sh.check-face@1',
  'sh.pipeline@1', 'sh.pipeline-operands@1', 'sh.list-parts@1', 'sh.text-case-words@1', 'sh.solid-appearance@1', 'sh.tile-ink@1',
  // Shipped at native-home ios/v2611.18.09.
  'sh.arc-track@1', 'sh.chart@1', 'sh.choice-icons@1', 'sh.count@1', 'sh.countdown@1', 'sh.dial@1',
  'sh.duration-format@1', 'sh.entity-time@1', 'sh.flow-extras@1', 'sh.grid-state-groups@1', 'sh.linear-gauge@1',
  'sh.math-truncate@1', 'sh.repeat@1', 'sh.stack@1', 'sh.state-words@1', 'sh.surface-controls@1',
  'sh.surface-orientation@1', 'sh.symbol-part@1', 'sh.text-style@1', 'sh.tile-swipe@1',
  ...pendingCompositionCapabilities,
];
/** A Home Assistant entity id: `domain.object`. */
const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const unsupported: Record<string, string> = {
  'room-app-launch': 'room-app-launch', 'section-sides': 'section-sides', 'content-panes': 'content-panes',
  'navigation-columns': 'navigation-columns', fullscreen: 'fullscreen', draft: 'forms',
  'form-actions': 'forms', 'public-https': 'public-assets', count: 'profile-count',
  variable: 'local-state', parameter: 'route-arguments',
  'info-box': 'info-box', 'content-unavailable': 'content-unavailable', 'arc-spinner': 'arc-spinner',
  'pending-value-bar': 'pending-value-bar', 'modal-tab-bar': 'modal-tab-bar', 'sheet-edit-toolbar': 'forms',
  'floating-action-bar': 'floating-action-bar', 'schedule-date-fields': 'schedule-date-fields',
  'paged-row': 'paged-row', 'content-image': 'content-image',
  'humidifier-schedule-field': 'humidifier-schedule-editor', 'humidifier-schedule-activities': 'collections',
};
/** The texts an operand is certain to be able to draw: a literal text, or any such text a rule can give. A text read from an entity cannot be told ahead. */
function literalTexts(value: Operand): string[] {
  if (value.type === 'literal') return typeof value.value === 'string' ? [value.value] : [];
  if (value.type === 'choose') return [...value.cases.flatMap(entry => literalTexts(entry.then)), ...literalTexts(value.otherwise)];
  return [];
}
type ActionSlot = CompositionActionSlot;
/** The plain actions a slot can run, each with its pointer: itself, or the action of each case and of `otherwise` (not `none`). */
function plainActions(value: ActionSlot, path: string): { action: CompositionAction; path: string }[] {
  if (value.type !== 'conditional') return [{ action: value, path }];
  return [...value.cases.map((entry, index) => ({ action: entry.then, path: `${path}/cases/${index}/then` })),
    ...(value.otherwise.type === 'none' ? [] : [{ action: value.otherwise as CompositionAction, path: `${path}/otherwise` }])];
}

/** A route's `visibleWhen` may use `viewer` and the combinators only: the route catalog is built without entity state. */
function asksOnlyAboutViewer(predicate: Predicate): boolean {
  switch (predicate.type) {
    case 'viewer': return true;
    case 'not': return asksOnlyAboutViewer(predicate.of);
    case 'all': case 'any': return predicate.of.every(asksOnlyAboutViewer);
    default: return false;
  }
}
/**
 * Whether the document writes a light and dark colour pair (`sh.solid-appearance@1`) anywhere: a look slot, a rule's or entity's fallback, a
 * state style's fill. Literal values are skipped, since a record a `literal` holds is data, never a look.
 */
function usesSolidAppearance(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesSolidAppearance);
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'solid-appearance') return true;
  if (node.type === 'literal') return false;
  return Object.values(node).some(usesSolidAppearance);
}
/** Whether the document writes an `rgba` colour anywhere (`sh.text-style@1`): in a slot, or in either side of an appearance pair. Literal values are skipped, since a record a `literal` holds is data. */
function usesRgba(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesRgba);
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'rgba') return true;
  if (node.type === 'literal') return false;
  return Object.values(node).some(usesRgba);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function at(input: unknown, path: PropertyKey[]): unknown {
  for (const key of path) {
    if (input === null || typeof input !== 'object' || !Object.hasOwn(input, key)) return undefined;
    input = Reflect.get(input, key);
  }
  return input;
}

/** Converts Zod failures to value-free diagnostics, preserving explicit unsupported capabilities. */
export function parseCompositionShape<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues: CompositionIssue[] = [];
  /**
   * A plain union reports one failure at its own path. The app names the exact field of the branch the value's `type` selects,
   * so descend into the branch that matched the discriminator, whose first failure is not about `type` itself.
   */
  const expand = (list: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] => list.flatMap(issue => {
    if (issue.code !== 'invalid_union' || !('errors' in issue) || !Array.isArray(issue.errors)) return [issue];
    const branches = (issue.errors as z.core.$ZodIssue[][]).filter(branch => branch.length && !branch.some(inner => inner.path.at(-1) === 'type' && inner.path.length === 1));
    if (branches.length !== 1) return [issue];
    return expand(branches[0].map(inner => ({ ...inner, path: [...issue.path, ...inner.path] }) as z.core.$ZodIssue));
  });
  for (const issue of expand(parsed.error.issues)) {
    const path = issue.path;
    let capability: string | undefined;
    let unsupportedPath: PropertyKey[] = path;
    for (let depth = path.length; depth >= 0; depth--) {
      const ownerPath = path.slice(0, depth), owner = at(input, ownerPath);
      // `count` is also an operand (`sh.count@1`): a record with `of` is the operand; only a node, which has an id and no `of`, is the unsupported profile count.
      if (record(owner) && typeof owner.type === 'string' && unsupported[owner.type] && !(owner.type === 'count' && (Object.hasOwn(owner, 'of') || !Object.hasOwn(owner, 'id')))) {
        capability = `sh.${unsupported[owner.type]}@1`; unsupportedPath = ownerPath; break;
      }
      const key = ownerPath.at(-1);
      if (record(owner) && Object.keys(owner).length && (key === 'parameters' || key === 'arguments' || key === 'initialArguments' || key === 'variables')) {
        capability = key === 'variables' ? 'sh.local-state@1' : 'sh.route-arguments@1';
        unsupportedPath = ownerPath; break;
      }
    }
    const toPointer = (parts: PropertyKey[]) => parts.reduce<string>((base, key) => pointer(base, String(key)), '');
    if (capability) {
      issues.push({ code: 'unsupported_capability', pointer: toPointer(unsupportedPath), capability });
    } else if (issue.code === 'custom' && typeof issue.params?.shCode === 'string') {
      issues.push({ code: issue.params.shCode as CompositionIssue['code'], pointer: toPointer(path) });
    } else if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) issues.push({ code: 'unknown_field', pointer: pointer(toPointer(path), key) });
    } else {
      const missing = at(input, path) === undefined;
      issues.push({
        code: missing ? 'missing_required' : issue.code === 'too_big' || issue.code === 'too_small' ? 'limit_exceeded'
          : issue.code === 'invalid_union' || issue.code === 'invalid_value' ? 'unknown_variant' : 'invalid_value',
        pointer: toPointer(path),
      });
    }
  }
  throw new CompositionValidationError(issues);
}

/** A derived id: `<reference id>~<inner id>`, which the identifier alphabet excludes on purpose, so no authored id equals one. */
const DERIVED_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:~[A-Za-z0-9][A-Za-z0-9_.-]*)+$/;

/**
 * `value` with every derived id replaced by a plain identifier (`derived-1`, `derived-2`, ...), the same one wherever the same id appears, so the expanded
 * document passes the shape check the compiler runs first and every other check reads it as it would an authored document. Pointers hold indexes, never ids,
 * so an issue found in the result points where it would in the original.
 */
function plainDerivedIds<T>(value: T, names = new Map<string, string>()): T {
  if (typeof value === 'string') {
    if (!DERIVED_ID.test(value)) return value;
    if (!names.has(value)) names.set(value, `derived-${names.size + 1}`);
    return names.get(value) as T;
  }
  if (Array.isArray(value)) return value.map(item => plainDerivedIds(item, names)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plainDerivedIds(inner, names)])) as T;
  return value;
}

/** Pure first-slice compiler. No requests, actions, asset-byte checks, or native fidelity claims. */
/** What a compile may be asked: `tileInkDefault` overrides the Studio's gate ({@link tileInkDefault}); a test or a publication check passes it. */
export interface CompileOptions { tileInkDefault?: boolean }
export function compileCompositionDocument(input: unknown, options: CompileOptions = {}): CompiledComposition {
  assertCompositionBounds(input);
  let expansion: ReturnType<typeof expandBounded>;
  try { expansion = expandBounded(input); }
  catch (error) {
    // Like every other compile issue, a logic issue reads from the document's root.
    if (error instanceof CompositionValidationError) throw new CompositionValidationError(error.issues.map(issue => ({ ...issue, pointer: `/document${issue.pointer}` })));
    throw error;
  }
  if (expansion.document === input) {
    const compiled = compilePlain(input, options, true);
    // A draft with Show at Most or Spoken As is handed back as authored; `expanded` is what a publication holds.
    return { document: compiled.badged ? input as CompositionDocument : compiled.document, capabilities: compiled.capabilities, expanded: compiled.document };
  }
  // The draft holds named logic: every use is worked out first, so capabilities, budgets and every other check read plain operands and conditions.
  // An issue inside a worked-out use is reported where the use stands in the draft.
  try {
    const compiled = compilePlain(expansion.document, options);
    return { document: input as CompositionDocument, capabilities: compiled.capabilities, expanded: compiled.document };
  } catch (error) {
    if (error instanceof CompositionValidationError) throw new CompositionValidationError(remapLogicIssues(error.issues, expansion.origins, '/document', expansion.bindings));
    throw error;
  }
}
/** What compiling a document gives: `document` as it was authored, the `capabilities` its published form needs, and `expanded`, the published form. */
export interface CompiledComposition {
  /** The document as authored (a draft keeps its `logicLibrary` and uses); the same object as `expanded` when it holds no logic. */
  document: CompositionDocument;
  capabilities: string[];
  /** The document with every logic use worked out and no `logicLibrary`: what a publication carries. */
  expanded: CompositionDocument;
}
function compilePlain(input: unknown, options: CompileOptions, bounded = false): { document: CompositionDocument; capabilities: string[]; badged?: true } {
  if (!bounded) assertCompositionBounds(input);
  // Show at Most and Spoken As are the draft's: they are worked out into plain operands first, so capabilities and every other check read what a publication holds.
  // An issue inside a worked-out badge is reported at the setting that asked for it. `badged` tells the caller the document to hand back is the one authored.
  const settings = expandBadgeSettings(input);
  if (settings.document !== input) {
    try { return { ...compilePlain(settings.document, options, true), badged: true }; }
    catch (error) {
      if (error instanceof CompositionValidationError) throw new CompositionValidationError(remapBadgeIssues(error.issues, settings.badges, input));
      throw error;
    }
  }
  if (record(input) && input.schemaVersion !== undefined && input.schemaVersion !== '2.0') reject('unsupported_schema', '/document/schemaVersion');
  if (new TextEncoder().encode(canonicalOfBounded(input)).byteLength > MAX_COMPOSITION_BYTES) reject('limit_exceeded', '/document');
  let document: CompositionDocument;
  try { document = parseCompositionShape(compositionDocumentSchema, input); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    throw new CompositionValidationError(error.issues.map(issue => ({ ...issue, pointer: `/document${issue.pointer}` })));
  }
  const issues: CompositionIssue[] = [];
  const capabilities = new Set<string>(['sh.composition@1', 'sh.shell@1', 'sh.backdrop@1', 'sh.chrome@1', 'sh.page@1', 'sh.symbols@1', ...((options.tileInkDefault ?? tileInkDefault) ? [INK_DEFAULT_CAPABILITY] : [])]);
  const add = (code: CompositionIssue['code'], path: string, capability?: string) => {
    issues.push({ code, pointer: path, ...(capability ? { capability } : {}) });
  };
  const require = (name: string) => capabilities.add(`sh.${name}@1`);
  /** Whether the components being walked are the top level of a page (`sh.fold-sides@1` is meaningful nowhere else). */
  let onPage = false;
  if (usesSolidAppearance(document)) require('solid-appearance');
  if (usesRgba(document)) require('text-style');
  if (document.pages.some(page => page.navigation.type === 'navigation-columns')) require('navigation-columns');
  if (document.modals.some(modal => modal.presentation.adaptive)) require('adaptive-presentation');
  document.modals.forEach((modal, index) => {
    if (modal.presentation.fullScreen) {
      require('full-screen-modal');
      if (modal.presentation.adaptive || modal.presentation.height.type !== 'full') add('invalid_combination', `/document/modals/${index}/presentation/fullScreen`);
    }
  });
  const catalogs = new Map<string, Map<string, string>>();
  function register(kind: string, id: string, path: string) {
    const catalog = catalogs.get(kind) ?? new Map<string, string>();
    const previous = catalog.get(id);
    if (previous !== undefined) add('duplicate_id', previous < path ? previous : path);
    else catalog.set(id, path);
    catalogs.set(kind, catalog);
  }
  /**
   * What kind of surface the walk is inside, for the one rule that depends on it (`sh.sheet-levels@1`): a `push` to a level of a sheet is valid only from a sheet or a level.
   * `leaving` is the destination of a `dismiss-then-push`, which has left the sheet; `library` is a saved component's body, whose uses carry the check.
   */
  type SurfaceKind = 'page' | 'modal' | 'level' | 'leaving' | 'library';
  let surfaceKind: SurfaceKind = 'page';
  /** `from` is set on a `push` (the kind of surface it sits in) and on a `page-id` argument (`'argument'`): only those may name a level, a page reference of any other kind may not. */
  const refs: { kind: string; id: string; path: string; from?: SurfaceKind | 'argument' }[] = [];
  document.liveActivities.forEach((activity, index) => {
    require('activity-presentation');
    register('activity', activity.id, `/document/liveActivities/${index}/id`);
    register('activity-job', activity.jobId, `/document/liveActivities/${index}/jobId`);
  });
  if (document.extensions) {
    require('native-extensions');
    if (document.extensions.linkPrefixes) {
      require('route-links');
      const prefixes = new Set<string>();
      document.extensions.linkPrefixes.forEach((prefix, index) => {
        if (prefixes.has(prefix)) add('duplicate_id', `/document/extensions/linkPrefixes/${index}`);
        prefixes.add(prefix);
      });
    }
    document.extensions.routes.forEach((route, index) => {
      register('extension-route', route.id, `/document/extensions/routes/${index}/id`);
      register('extension-path', route.path, `/document/extensions/routes/${index}/path`);
      // A path or alias names one route only, so a link can never be ambiguous.
      route.aliases?.forEach((alias, offset) => register('extension-path', alias, `/document/extensions/routes/${index}/aliases/${offset}`));
      if (route.aliases?.length || route.keywords?.length || route.siri) require('route-links');
      if (route.visibleWhen) {
        require('visible-when');
        // The catalog is built without entity state, so only a viewer-only rule is checked; it holds no source references.
        if (asksOnlyAboutViewer(route.visibleWhen)) issues.push(...checkPredicate(route.visibleWhen, `/document/extensions/routes/${index}/visibleWhen`).issues);
        else add('invalid_combination', `/document/extensions/routes/${index}/visibleWhen`);
      }
      refs.push({ kind: 'page', id: route.pageId, path: `/document/extensions/routes/${index}/pageId` });
      if (route.tabId) refs.push({ kind: 'tab', id: route.tabId, path: `/document/extensions/routes/${index}/tabId` });
      const fragments = new Set<string>();
      route.anchors?.forEach((anchor, offset) => {
        if (fragments.has(anchor.fragment)) add('duplicate_id', `/document/extensions/routes/${index}/anchors/${offset}/fragment`);
        fragments.add(anchor.fragment);
        refs.push({ kind: 'modal', id: anchor.modalId, path: `/document/extensions/routes/${index}/anchors/${offset}/modalId` });
      });
    });
    document.extensions.cameras.forEach((camera, index) => {
      register('extension-camera', camera.entityId, `/document/extensions/cameras/${index}/entityId`);
    });
  }
  if (document.stateStyles) {
    require('state-style');
    document.stateStyles.styles.forEach((style, index) => {
      register('state-style', style.id, `/document/stateStyles/styles/${index}/id`);
      if (usesStateFills(style)) require('state-style-fills');
      if (usesFillInk(style)) require('tile-ink');
    });
    issues.push(...checkStateStyleLibrary(document.stateStyles, '/document/stateStyles'));
  }
  // Saved components (`sh.component-ref@1`): the key's presence is enough to need the capability, since an older app refuses the unknown key either way.
  const library = new Map<string, ComponentEntry>();
  if (document.componentLibrary !== undefined) require('component-ref');
  // A `value` parameter needs `sh.component-values@1`, a new id: an app that shipped `sh.component-ref@1` refuses a `values` key it does not know.
  if (document.componentLibrary?.some(entry => entry.params?.some(param => param.kind === 'value'))) capabilities.add(COMPONENT_VALUES_CAPABILITY);
  document.componentLibrary?.forEach((entry, index) => {
    register('component', entry.id, `/document/componentLibrary/${index}/id`);
    // A component that owns a Data Flow (`sh.repeat@1`): an entry with only entity sources decodes without the id.
    if (entry.flows?.length) require('repeat');
    if (!library.has(entry.id)) library.set(entry.id, entry);
  });
  /**
   * The sources the entries own, as the library check sees them: each under the name `<entry id>~<source id>` that `checkedBody` gives it in the body,
   * with the pointer of the source in its entry, so a fault in one is reported where it was authored.
   */
  const privateSources = (document.componentLibrary ?? []).flatMap((entry, index) => [
    ...(entry.sources ?? []).map((source, offset) => ({ source: { ...source, id: derivedId(entry.id, source.id) } as DocumentSource, path: `/document/componentLibrary/${index}/sources/${offset}` })),
    ...(entry.flows ?? []).map((source, offset) => ({ source: { ...source, id: derivedId(entry.id, source.id) } as DocumentSource, path: `/document/componentLibrary/${index}/flows/${offset}` })),
  ]);
  /** The node a reference stands for where its body's root decides something (a placement rule, a sibling count); the reference itself when the entry is missing. */
  const view = (item: CompositionNode): CompositionNode => item.type === 'component-ref' ? library.get(item.componentId)?.node ?? item : item;
  /** True while a library entry's body is walked: a body holds no `component-ref`. */
  let inBody = false;
  /** The references that give arguments to bound fields, checked once the whole document is walked (see `checkArgUses`). */
  const argUses: { ref: ComponentRefNode; entry: ComponentEntry; path: string }[] = [];
  const powerRefs: { id: string; path: string; code: CompositionIssue['code'] }[] = [];
  const alarmRefs: { id: string; path: string }[] = [];
  const homeRefs: { id: string; model: string; path: string }[] = [];
  const overviewWords: { sourceId: string; words: StateWords; path: string }[] = [];
  const homePowerRefs: { status: string; power: string; path: string }[] = [];
  const doorRefs: { id: string; kind: 'lock' | 'garage'; path: string }[] = [];
  const climateRefs: { props: ClimateProps; path: string }[] = [];
  const roomRefs: { id: string; path: string; navigation: boolean }[] = [];
  const visibilityRefs: { id: string; path: string }[] = [];
  const deviceRefs: { control: RoomDeviceControl; path: string }[] = [];
  const bedroomRefs: { id: string; providers: readonly string[]; path: string }[] = [];
  const titleSourceRefs: { id: string; path: string }[] = [];
  const remoteRefs: { id: string; path: string }[] = [];
  const providerControls: { control: Extract<CompositionNode, { type: 'custom-light-control' | 'sprinkler-control' }>; path: string }[] = [];
  const vacuumRefs: { control: VacuumControl; path: string }[] = [];
  const profileRefs: { id: string; path: string }[] = [];
  const settingsRefs: { id: string; kind: SettingsKind; path: string }[] = [];
  const cameraRefs: { id: string; path: string; records: boolean }[] = [];
  const cameraPresentations: { source: string; modal: string; path: string }[] = [];
  const reads: { read: CompositionRead; path: string }[] = [];
  /** Nodes that name a source as their provider; a Data Flow (`pipeline@1`) must be a rows flow. */
  const providerRefs: { id: string; node: { type: 'row-collection' | 'collection'; template?: string; refreshable?: boolean }; path: string }[] = [];
  let pipelines = 0;
  const expressionRefs: ExpressionFacts['references'] = [];
  const optimisticRefs: ExpressionFacts['optimisticReferences'] = [];
  type Visibility = { visibleWhen?: Predicate; whenUnknown?: WhenUnknown };
  /** Folds an expression walk's issues, source references and capability needs into this compile. */
  function absorb(facts: ExpressionFacts) {
    issues.push(...facts.issues);
    expressionRefs.push(...facts.references);
    optimisticRefs.push(...facts.optimisticReferences);
    if (facts.usedOperands) require('operands');
    for (const need of facts.needs) require(need);
    if (facts.references.length || facts.optimisticReferences.length) require('bindings');
  }
  /** The records the walk is inside while it draws the template of a `repeat` (`sh.repeat@1`); `item` and `index` mean something only there. */
  let repeatScope: ItemScope | undefined;
  function useCall(call: CallService, path: string, control: boolean) { require('call-service'); absorb(checkCallService(call, path, control, repeatScope)); }
  /**
   * A slot that follows a rule or an entity (`sh.rules@1`): a `conditional` look walks its conditions, a `bound-color` and a `bound-symbol` walk their
   * value, which must give text. A plain look needs nothing.
   */
  function ruleSlot(value: { type: string } | undefined, path: string) {
    if (!value) return;
    if (value.type === 'conditional') {
      require('rules');
      (value as unknown as { cases: { when: Predicate }[] }).cases.forEach((entry, index) => usePredicate(entry.when, `${path}/cases/${index}/when`));
    } else if (value.type === 'bound-color' || value.type === 'bound-symbol') {
      require('rules');
      const operand = (value as unknown as { value: Operand }).value;
      useOperand(operand, `${path}/value`);
      // The text an entity gives: a number, a boolean or a structure is not a color or a symbol name.
      const kind = operandKind(operand);
      if (kind !== undefined && kind !== 'string') add('binding_type', `${path}/value`);
    }
  }
  function look(appearance: { icon: { type: string }; glyph?: { type: string }; fill: { type: string } }, path: string) {
    for (const slot of ['icon', 'glyph', 'fill'] as const) ruleSlot(appearance[slot], `${path}/${slot}`);
  }
  /**
   * A badge on a chip, a tile, a tab, a header button or the Profile Icon (`sh.badges@1`): a value that gives a number or text. A `spoken` operand gives
   * the words VoiceOver says and must be text (`sh.badge-spoken@1`). On a surface that needs `sh.badge-nodes@1` (`added`), a text the badge can be told to
   * draw in full is at most four characters.
   */
  function badge(value: { type: string; value?: Operand; spoken?: Operand } | undefined, path: string, added = false) {
    if (!value) return;
    require('badges');
    if (added) require('badge-nodes');
    if (value.type !== 'value' || !value.value) return;
    useOperand(value.value, `${path}/value`);
    const kind = operandKind(value.value);
    if (kind !== undefined && kind !== 'string' && kind !== 'number') add('binding_type', `${path}/value`);
    if (added) for (const text of literalTexts(value.value)) if ([...text].length > MAX_BADGE_TEXT) add('limit_exceeded', `${path}/value`);
    if (value.spoken) {
      require('badge-spoken');
      useOperand(value.spoken, `${path}/spoken`);
      const spokenKind = operandKind(value.spoken);
      if (spokenKind !== undefined && spokenKind !== 'string') add('binding_type', `${path}/spoken`);
    }
  }
  /** `enabledWhen` (`sh.enabled-when@1`). */
  function enabled(rule: EnabledWhen | undefined, path: string) {
    if (!rule) return;
    require('enabled-when'); usePredicate(rule.condition, `${path}/enabledWhen/condition`);
  }
  function useOperand(operand: Operand, path: string) { absorb(checkOperand(operand, path, false, false, repeatScope)); }
  function usePredicate(predicate: Predicate, path: string) { absorb(checkPredicate(predicate, path, false, repeatScope)); }
  /** A node's or tab's `visibleWhen`; its policy means nothing without one. */
  function visibility(item: Visibility, path: string) {
    if (item.visibleWhen === undefined) { if (item.whenUnknown !== undefined) add('invalid_combination', `${path}/whenUnknown`); return; }
    require('visible-when'); usePredicate(item.visibleWhen, `${path}/visibleWhen`);
  }
  /** Containers that lay their children out themselves cannot let one of them go (a gap, a separator or an empty page). */
  function forbidRules(children: CompositionNode[], path: string) {
    children.forEach((child, index) => { if ((view(child) as Visibility).visibleWhen !== undefined) add('invalid_combination', `${path}/${index}/visibleWhen`); });
  }
  const dependencies: { from: string; to: string; path: string }[] = [];
  const localFields = new Map(document.localState?.map(field => [field.id, field]));
  if (document.localState) {
    require('local-state');
    document.localState.forEach((field, index) => {
      const p = `/document/localState/${index}`;
      register('local-state', field.id, `${p}/id`);
      if (field.type === 'number' && field.minimum > field.maximum) add('invalid_combination', `${p}/maximum`);
      if (!acceptsLocalValue(field, initialLocalValue(field))) add('invalid_value', `${p}/initial`);
      if (field.type === 'choice' && new Set(field.options.map(option => option.id)).size !== field.options.length)
        add('duplicate_id', `${p}/options`);
      if (field.type === 'choice') {
        // A symbol or a hint on an option (`sh.choice-icons@1`); a segment is either all symbols or all words, so one without a symbol among symbols is refused.
        if (field.options.some(option => option.symbol !== undefined || option.hint !== undefined)) require('choice-icons');
        if (field.options.some(option => option.symbol !== undefined)) {
          const bare = field.options.findIndex(option => option.symbol === undefined);
          if (bare >= 0) add('invalid_combination', `${p}/options/${bare}`);
        }
      }
    });
  }
  function binding(value: CompositionValue, expected: CompositionRead['as'], path: string, power = false) {
    if (value.type === 'literal') {
      if (expected === 'entity-id') {
        if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value.value)) add('invalid_value', `${path}/value`);
        else if (power && !['switch', 'input_boolean'].includes(value.value.split('.')[0])) add('invalid_combination', `${path}/value`);
      }
      return;
    }
    if ('fallback' in value && value.fallback !== undefined) require('rules');
    if ('whenUnavailable' in value && value.whenUnavailable !== undefined) require('text-keep');
    if (value.type === 'expr') {
      // A string made by an operand: text, a number or a boolean, never a structure. The operand's own reads are checked with the other expression refs.
      if (expected !== 'string') add('binding_type', `${path}/type`);
      require('rules'); useOperand(value.value, `${path}/value`);
      if (operandKind(value.value) === 'structure') add('binding_type', `${path}/value`);
      return;
    }
    require('bindings');
    if (value.as !== expected) add('binding_type', `${path}/as`);
    value.from.path.forEach((segment, i) => {
      if (!/^[A-Za-z0-9_-]+$/.test(segment) || /^\d+$/.test(segment) || ['__proto__', 'prototype', 'constructor'].includes(segment))
        add('invalid_reference', `${path}/from/path/${i}`);
    });
    reads.push({ read: value, path });
  }
  function roomVisibility(value: { sourceId: string; states: string[] } | undefined, path: string) {
    if (!value) return;
    require('room-visibility'); require('bindings');
    visibilityRefs.push({ id: value.sourceId, path: `${path}/sourceId` });
  }
  function action(value: ActionSlot, path: string) {
    if (value.type === 'conditional') {
      require('action-rules');
      value.cases.forEach((entry, index) => {
        usePredicate(entry.when, `${path}/cases/${index}/when`);
        action(entry.then, `${path}/cases/${index}/then`);
      });
      if (value.otherwise.type !== 'none') action(value.otherwise as CompositionAction, `${path}/otherwise`);
      return;
    }
    if (value.type === 'set-local') {
      require('local-state');
      const field = localFields.get(value.stateId);
      if (!field) add('invalid_reference', `${path}/stateId`);
      else if (!acceptsLocalValue(field, value.value)) add('binding_type', `${path}/value`);
      return;
    }
    if (value.type === 'call-service') { useCall(value, path, false); return; }
    if (value.type === 'domain') {
      require('power-toggle'); require('bindings');
      powerRefs.push({ id: value.sourceId, path: `${path}/sourceId`, code: 'invalid_combination' });
      if (value.confirmation.type === 'additional' && value.confirmation.when) {
        require('confirm-when'); usePredicate(value.confirmation.when, `${path}/confirmation/when`);
      }
      return;
    }
    require('actions.navigation');
    switch (value.type) {
      case 'push': refs.push({ kind: 'page', id: value.pageId, path: `${path}/pageId`, from: surfaceKind }); break;
      case 'present':
        if (value.ifPresented === 'replace') require('modal-handoff');
        refs.push({ kind: 'modal', id: value.modalId, path: `${path}/modalId` });
        break;
      case 'select-tab': refs.push({ kind: 'tab', id: value.tabId, path: `${path}/tabId` }); break;
      case 'dismiss-then-push': {
        // The destination has left the sheet: it may name a page, never a level.
        const was = surfaceKind;
        surfaceKind = 'leaving';
        action(value.destination, `${path}/destination`);
        surfaceKind = was;
        break;
      }
    }
  }
  /**
   * A page's own chrome settings: `hides` (`sh.page-chrome-hide@1`) names `button` and `shell-header` items of the app's chrome, each once; the shell menu cannot be hidden,
   * and a page that replaces the toolbar has no inherited items to drop (it may still hide the tab bar). `wideOpen` (`sh.page-wide-open@1`) needs nothing more than its capability.
   */
  function pageChrome(page: CompositionDocument['pages'][number], index: number) {
    const at = `/document/pages/${index}`;
    if (page.wideOpen !== undefined) require('page-wide-open');
    if (page.hides === undefined) return;
    require('page-chrome-hide');
    const items = page.hides.items ?? [];
    const hideable = new Set<string>(), menus = new Set<string>();
    for (const item of document.navigation.chrome.groups.flatMap(group => group.items)) (item.type === 'shell-menu' ? menus : hideable).add(item.id);
    const seen = new Set<string>();
    items.forEach((item, offset) => {
      if (seen.has(item)) add('duplicate_id', `${at}/hides/items/${offset}`);
      seen.add(item);
      if (!hideable.has(item)) add(menus.has(item) ? 'invalid_combination' : 'invalid_reference', `${at}/hides/items/${offset}`);
    });
    if (page.toolbar.type === 'replace' && items.length) add('invalid_combination', `${at}/hides/items`);
  }
  function chrome(groups: CompositionGroups, path: string) {
    groups.forEach((group, i) => {
      register('group', group.id, `${path}/${i}/id`);
      if (group.items.some(item => item.type === 'shell-header') &&
        (group.placement !== 'trailing' || group.items.length !== 1 || groups.filter(group => group.placement === 'trailing').length !== 1))
        add('invalid_combination', `${path}/${i}`);
      group.items.forEach((item, j) => {
        register('item', item.id, `${path}/${i}/items/${j}/id`);
        if (item.type === 'button') {
          action(item.action, `${path}/${i}/items/${j}/action`);
          // A drawn badge on a header button needs `sh.badge-nodes@1`; `none` is the shipped default.
          if (item.badge.type !== 'none') badge(item.badge, `${path}/${i}/items/${j}/badge`, true);
        }
        if (item.type === 'shell-header') {
          require('shell-header');
          if (item.quickLinksAction.type !== 'present') add('invalid_combination', `${path}/${i}/items/${j}/quickLinksAction`);
          if (item.profileAction.type !== 'present') add('invalid_combination', `${path}/${i}/items/${j}/profileAction`);
          action(item.quickLinksAction, `${path}/${i}/items/${j}/quickLinksAction`);
          action(item.profileAction, `${path}/${i}/items/${j}/profileAction`);
          // The look and badge of the Profile button (`sh.shell-profile@1`); the badge is the one every bar item has, authored here.
          if (item.profile) { require('shell-profile'); badge(item.profile.badge, `${path}/${i}/items/${j}/profile/badge`, true); }
        }
      });
    });
  }
  let nodes = 0;
  /** Whether the body root `type` may not sit at `depth`, in a grid or not: the rules a plain node of that type meets where it stands. */
  function placementRefused(root: CompositionNode, depth: number, grid: boolean): boolean {
    if (grid && (root.type === 'settings-link' || root.type === 'account-header')) return true;
    if (depth > 1 && (root.type === 'form' || root.type === 'pinned-actions')) return true;
    return root.type === 'local-tabs' && depth !== 1 && Boolean(root.props.scopeProviderId || root.props.pinned);
  }
  /** The pointer of what makes a child the wrong kind for its container: the reference's `componentId` when the body decides, else the node's `type`. */
  const typeAt = (child: CompositionNode, path: string) => child.type === 'component-ref' ? `${path}/componentId` : `${path}/type`;
  /** How many data sources the uses walked so far add to the document (private sources, one copy per use): they count toward the 1,000-source limit. */
  let expandedSources = 0;
  /** What a reference's arguments must be: one for each parameter, none for anything else, and a value that fits the parameter's kind. */
  function checkArgs(ref: ComponentRefNode, entry: ComponentEntry, path: string) {
    const params = new Map((entry.params ?? []).map(param => [param.name, param]));
    const given = ref.args ?? {};
    const keys = Object.keys(given);
    if (keys.length > COMPONENT_LIMITS.params) add('limit_exceeded', `${path}/args`);
    for (const key of keys) if (!params.has(key)) add('unknown_field', pointer(`${path}/args`, key));
    // `values` (`sh.component-values@1`): one JSON value for each `value` parameter, none for another kind, at most 16 and 8,192 bytes each.
    const valueKeys = Object.keys(ref.values ?? {});
    if (ref.values !== undefined) require('component-values');
    if (valueKeys.length > COMPONENT_LIMITS.values) add('limit_exceeded', `${path}/values`);
    for (const key of valueKeys) {
      const at = pointer(`${path}/values`, key);
      if (!params.has(key)) add('unknown_field', at);
      else if (params.get(key)!.kind !== 'value') add('invalid_combination', at);
      else if (new TextEncoder().encode(canonicalOfBounded(ref.values![key])).byteLength > COMPONENT_LIMITS.valueBytes) add('limit_exceeded', at);
    }
    for (const param of params.values()) {
      const at = pointer(`${path}/args`, param.name), value = given[param.name];
      // A `value` parameter has no argument: its value, when this use sets one, is in `values`.
      if (param.kind === 'value') { if (value !== undefined) add('invalid_combination', at); continue; }
      if (value === undefined) { add('missing_required', at); continue; }
      if (param.kind === 'text') continue;
      if (param.kind === 'symbol') { if (value.length > 80) add('invalid_value', at); continue; }
      if (param.kind === 'entity-id') { if (!ENTITY_ID.test(value)) add('invalid_value', at); continue; }
      if (!identifierSchema.safeParse(value).success) { add('invalid_value', at); continue; }
      refs.push({ kind: { 'source-id': 'source', 'page-id': 'page', 'modal-id': 'modal', 'state-id': 'local-state' }[param.kind], id: value, path: at, ...(param.kind === 'page-id' ? { from: 'argument' as const } : {}) });
    }
    const owned = ownedSources(entry);
    if (owned.length > 0) {
      if (document.dataSources.length + expandedSources + owned.length > 1000) add('limit_exceeded', `${path}/componentId`);
      expandedSources += owned.length;
    }
    if ((keys.length || valueKeys.length) && entry.bindings?.length || owned.length) argUses.push({ ref, entry, path });
  }
  /**
   * A library entry's parameters, private sources and bindings: names are unique, a binding names a parameter and either a node of the body or a source
   * of the entry (not both), and a field that exists and fits the kind. A source's entity id is a valid entity id of its own.
   */
  function checkParams(entry: ComponentEntry, path: string) {
    const names = new Set<string>();
    entry.params?.forEach((param, index) => { if (names.has(param.name)) add('duplicate_id', `${path}/params/${index}/name`); names.add(param.name); });
    const bound = new Set<string>();
    entry.bindings?.forEach((binding, index) => {
      const at = `${path}/bindings/${index}`;
      const param = entry.params?.find(item => item.name === binding.param);
      if (!param) add('invalid_reference', `${at}/param`);
      if (binding.nodeId === undefined && binding.sourceId === undefined) { add('missing_required', `${at}/nodeId`); return; }
      if (binding.nodeId !== undefined && binding.sourceId !== undefined) { add('invalid_combination', `${at}/sourceId`); return; }
      const target = binding.nodeId !== undefined ? findNode(entry.node, binding.nodeId) : ownedSources(entry).find(source => source.id === binding.sourceId);
      const targetAt = binding.nodeId !== undefined ? `${at}/nodeId` : `${at}/sourceId`;
      if (!target) { add('invalid_reference', targetAt); return; }
      if (param?.kind === 'value') {
        // A `value` fills any field of a body node, present or not, as long as the object that holds it is there. Not a node's id, type or child lists,
        // which the expansion owns, and not a field of a source, which only an entity id may fill.
        const steps = binding.field.split('/').filter(Boolean);
        if (binding.nodeId === undefined || !steps.length || ['id', 'type', 'children', 'tabs', 'blocks'].includes(steps[0])) { add('binding_type', `${at}/field`); return; }
        const holder = readField(target, steps.slice(0, -1).join('/'));
        if (holder === null || typeof holder !== 'object') { add('invalid_reference', `${at}/field`); return; }
        // A list holds its items by position, which a place cannot create or remove: a value never fills an item of a list.
        if (Array.isArray(holder)) { add('binding_type', `${at}/field`); return; }
        // One field path, or one under another, is bound twice when either binding is a `value`: the second is refused.
        // The same field twice is `invalid_combination`, as for any binding, below.
        if (entry.bindings!.slice(0, index).some(other => other.nodeId === binding.nodeId && other.field !== binding.field && fieldsOverlap(other.field, binding.field))) add('invalid_value', `${at}/field`);
      } else {
        if (readField(target, binding.field) === undefined) { add('invalid_reference', `${at}/field`); return; }
        if (param && fieldKind(target, binding.field) !== param.kind) add('binding_type', `${at}/field`);
        if (entry.bindings!.slice(0, index).some(other => other.nodeId !== undefined && other.nodeId === binding.nodeId && other.field !== binding.field && fieldsOverlap(other.field, binding.field)
          && entry.params?.find(item => item.name === other.param)?.kind === 'value')) add('invalid_value', `${at}/field`);
      }
      const key = `${binding.nodeId !== undefined ? 'node' : 'source'}\0${binding.nodeId ?? binding.sourceId}\0${binding.field}`;
      if (bound.has(key)) add('invalid_combination', `${at}/field`);
      bound.add(key);
    });
  }
  /**
   * The parts of a tab container beyond its tabs: a tab's own rule and the areas (`sh.tab-blocks@1`), the bar's settings (`sh.tab-bar@1`), and the children
   * of each tab or area. Each capability is needed only when its part is present.
   */
  function tabParts(item: Extract<CompositionNode, { type: 'local-tabs' }>, p: string, depth: number) {
    const tabIds = item.tabs.map(tab => tab.id);
    item.tabs.forEach((tab, index) => {
      if (tab.visibleWhen !== undefined || tab.whenUnknown !== undefined) { require('tab-blocks'); visibility(tab, `${p}/tabs/${index}`); }
    });
    const bar = item.props.tabBar;
    if (bar) {
      require('tab-bar');
      const needsIcons = bar.placement === 'bottom' || bar.labels === 'icons' || bar.labels === 'icons-and-titles';
      if (needsIcons) item.tabs.forEach((tab, index) => { if (!tab.icon) add('missing_required', `${p}/tabs/${index}/icon`); });
      if (bar.placement === 'bottom' && item.props.pinned !== true) add('invalid_combination', `${p}/props/tabBar/placement`);
      if (bar.placement === 'top' && item.props.pinned === true) add('invalid_combination', `${p}/props/tabBar/placement`);
    }
    if (!item.blocks) { item.tabs.forEach((tab, index) => components(tab.children, `${p}/tabs/${index}/children`, depth + 1)); return; }
    require('tab-blocks');
    item.tabs.forEach((tab, index) => { if (tab.children.length) add('invalid_combination', `${p}/tabs/${index}/children`); });
    const covered = new Set<string>(), ids = new Set<string>();
    item.blocks.forEach((block, index) => {
      const at = `${p}/blocks/${index}`;
      if (ids.has(block.id)) add('duplicate_id', `${at}/id`);
      ids.add(block.id);
      const named = block.tabs === 'all' ? tabIds : block.tabs;
      if (block.tabs !== 'all') {
        const seen = new Set<string>();
        block.tabs.forEach((id, at2) => {
          if (!tabIds.includes(id) || seen.has(id)) add('invalid_reference', `${at}/tabs/${at2}`);
          seen.add(id);
        });
      }
      named.forEach(id => covered.add(id));
      visibility(block, at);
      block.children.forEach((child, childIndex) => {
        if (named.length !== 1 && ['form', 'pinned-actions'].includes(view(child).type)) add('invalid_combination', `${at}/children/${childIndex}/type`);
      });
      components(block.children, `${at}/children`, depth + 1);
    });
    item.tabs.forEach((tab, index) => { if (!covered.has(tab.id)) add('invalid_combination', `${p}/tabs/${index}`); });
  }
  /**
   * `stack` (`sh.stack@1`): children in a row or a column. Its `groups` (and the collapsed arrangement's) must hold every direct child exactly once, by id; a
   * collapse is for a horizontal stack, and `fits` names direct children and means something only with the `overflow` trigger. A stack with an action is one
   * accessibility element (a button), so it names it and holds nothing that takes a tap of its own.
   */
  function stack(item: Extract<CompositionNode, { type: 'stack' }>, p: string, depth: number) {
    require('stack'); require('text-style');
    const ids = new Set(item.children.map(child => child.id));
    const partition = (groups: { children: string[] }[], path: string) => {
      const seen = new Set<string>();
      groups.forEach((group, gi) => group.children.forEach((childId, ci) => {
        if (!ids.has(childId)) add('invalid_reference', `${path}/${gi}/children/${ci}`);
        else if (seen.has(childId)) add('duplicate_id', `${path}/${gi}/children/${ci}`);
        seen.add(childId);
      }));
      if (item.children.some(child => !seen.has(child.id))) add('missing_required', path);
    };
    const props = item.props, collapse = props.collapse;
    if (props.groups) partition(props.groups, `${p}/props/groups`);
    if (collapse) {
      if (props.axis !== 'horizontal') add('invalid_combination', `${p}/props/collapse`);
      if (new Set(collapse.when).size !== collapse.when.length) add('invalid_value', `${p}/props/collapse/when`);
      collapse.fits?.forEach((childId, index) => { if (!ids.has(childId)) add('invalid_reference', `${p}/props/collapse/fits/${index}`); });
      if (collapse.fits?.length && !collapse.when.includes('overflow')) add('invalid_combination', `${p}/props/collapse/fits`);
      if (collapse.groups) partition(collapse.groups, `${p}/props/collapse/groups`);
    }
    const a11y = item.a11y;
    if (a11y) {
      for (const key of ['role', 'label', 'value', 'hint'] as const) {
        if (a11y.element !== 'group' && a11y[key] !== undefined) add('invalid_combination', `${p}/a11y/${key}`);
      }
      if (a11y.label) binding(a11y.label, 'string', `${p}/a11y/label`);
      if (a11y.value) binding(a11y.value, 'string', `${p}/a11y/value`);
      if (a11y.role === 'button' && !item.action) add('invalid_combination', `${p}/a11y/role`);
      if (item.action && a11y.role !== undefined && a11y.role !== 'button') add('invalid_combination', `${p}/a11y/role`);
    }
    if (item.action) {
      if (!a11y) add('missing_required', `${p}/a11y`);
      else if (a11y.element !== 'group') add('invalid_combination', `${p}/a11y/element`);
      const taps = (nodes: CompositionNode[], path: string) => nodes.forEach((child, index) => {
        const shown = view(child);
        if (['primary-button', 'bound-control', 'local-control', 'navigation-tile', 'action-tile', 'state-tile', 'status-chip', 'row', 'settings-link'].includes(shown.type)
          || (shown.type === 'stack' && shown.action !== undefined)) add('invalid_combination', `${path}/${index}/type`);
        else taps(compositionChildren(shown), `${path}/${index}/children`);
      });
      taps(item.children, `${p}/children`);
      action(item.action, `${p}/action`);
    }
    components(item.children, `${p}/children`, depth + 1);
  }
  /**
   * `repeat` (`sh.repeat@1`): one copy of its first child for every record of a `records` flow. The flow must exist and give records (`binding_type`); a repeat
   * does not hold a repeat or a saved component, whose body could (`invalid_combination`); the paging fits the repeat's axis and its counts; the second
   * child is the placeholder and exists exactly when `placeholder` is set. The first child is walked with the flow's record shape in scope, so an `item`
   * path the flow does not give is `invalid_reference`; the placeholder has no record, so `item` is refused there.
   */
  function repeat(item: RepeatNode, p: string, depth: number) {
    require('repeat');
    if (repeatScope) add('invalid_combination', `${p}/type`);
    const found = checkRepeat(item, p);
    issues.push(...found.issues);
    const source = [...document.dataSources, ...privateSources.map(entry => entry.source)].find(entry => entry.id === item.props.providerId);
    let shape: Shape | undefined;
    if (!source) add('invalid_reference', `${p}/props/providerId`);
    else if (source.kind !== 'model' || source.model !== 'pipeline@1') add('binding_type', `${p}/props/providerId`);
    else {
      const provided = checkRepeatProvider(source.inputs, `${p}/props`);
      issues.push(...provided.issues);
      shape = provided.item;
    }
    const outer = repeatScope;
    item.children.forEach((child, index) => {
      // With no usable flow the paths cannot be checked, but `item` and `index` still stand: any shape fits.
      repeatScope = { shape: shape ?? { kind: 'any' }, ...(index === 1 ? { placeholder: true } : {}) };
      if (child.type === 'component-ref') { add('invalid_combination', `${p}/children/${index}/type`); return; }
      components([child], `${p}/children/${index}`, depth + 1, false, true);
    });
    repeatScope = outer;
  }
  // MARK: Chart and linear gauge (`sh.chart@1`, `sh.linear-gauge@1`)
  /** A number operand slot: walked like any operand, and refused (`binding_type`) when it can only give text, a yes or no, or a structure. */
  function numberOperand(operand: Operand, path: string) {
    useOperand(operand, path);
    const kind = operandKind(operand);
    if (kind !== undefined && kind !== 'number') add('binding_type', path);
  }
  /**
   * A chart's `source` series (`sh.chart@1` reading a records flow, `chart-source.ts`): the flow it names (or the repeat it sits in) must give records, and
   * `x.label` and `y` are walked with one record's shape in scope, so an `item` path the flow does not give is `invalid_reference` and one of the wrong kind
   * `binding_type`. `limit` and the operands are checked even when the flow is refused, so every slot is still walked.
   */
  function chartSource(series: Extract<Extract<CompositionNode, { type: 'chart' }>['props']['series'], { type: 'source' }>, path: string) {
    const lookup = new Map([...document.dataSources, ...privateSources.map(entry => entry.source)].map(source => [source.id, source]));
    const found = checkChartSource({ series, path }, lookup, repeatScope);
    issues.push(...found.issues);
    const outer = repeatScope;
    repeatScope = { shape: found.shape };
    useOperand(series.x.label, `${path}/x/label`);
    numberOperand(series.y, `${path}/y`);
    repeatScope = outer;
    const label = operandKind(series.x.label);
    if (label !== undefined && label !== 'string') add('binding_type', `${path}/x/label`);
    issues.push(...checkChartOperandKind(series.x.label, found.shape, 'string', `${path}/x/label`), ...checkChartOperandKind(series.y, found.shape, 'number', `${path}/y`));
  }
  /**
   * `chart` (`sh.chart@1`): one series as bars, a line or an area. A `bar` block is for bars and a `line` block for the other two; a `ceiling` domain is
   * `min` to `max` in steps; a `fixed` one has a range; a `two-step` one reads its smallest step from an operand and its factors rise in (0, 10]. An axis
   * label pattern holds `{value}` once and no other brace. A `source` series is judged by `chartSource` below (`chart-source.ts`).
   */
  function chart(item: Extract<CompositionNode, { type: 'chart' }>, p: string) {
    require('chart');
    const { mark, series, domain, axis, bar, line } = item.props;
    if (bar !== undefined && mark !== 'bar') add('invalid_combination', `${p}/props/bar`);
    if (line !== undefined && mark === 'bar') add('invalid_combination', `${p}/props/line`);
    if (domain.type === 'ceiling') {
      if (domain.min > domain.max) add('invalid_value', `${p}/props/domain/max`);
    } else if (domain.type === 'fixed') {
      if (domain.min >= domain.max) add('invalid_value', `${p}/props/domain/max`);
    } else {
      numberOperand(domain.minimumStep, `${p}/props/domain/minimumStep`);
      if (domain.minimumStep.type === 'literal' && typeof domain.minimumStep.value === 'number' && domain.minimumStep.value <= 0) add('invalid_value', `${p}/props/domain/minimumStep`);
      const factors = domain.factors;
      if (factors && factors.some((factor, index) => index > 0 && factor <= factors[index - 1])) add('invalid_value', `${p}/props/domain/factors`);
    }
    const pattern = axis?.label?.pattern;
    if (pattern !== undefined) {
      const rest = pattern.replace('{value}', '');
      if (rest.length === pattern.length || rest.includes('{') || rest.includes('}')) add('invalid_value', `${p}/props/axis/label/pattern`);
    }
    if (series.type === 'source') chartSource(series, `${p}/props/series`);
    binding(item.a11y.label, 'string', `${p}/a11y/label`);
  }
  /**
   * `linear-gauge` (`sh.linear-gauge@1`): a `span` gauge needs its span, a `scale` gauge has none; the marker and the value come together; the gradient has
   * two to eight stops that never fall back; the value and the span are number operands.
   */
  function linearGauge(item: Extract<CompositionNode, { type: 'linear-gauge' }>, p: string) {
    require('linear-gauge');
    const { value, span, fill, stops, marker } = item.props;
    if (fill === 'span' && !span) add('missing_required', `${p}/props/span`);
    if (fill === 'scale' && span) add('invalid_combination', `${p}/props/span`);
    if (marker && !value) add('missing_required', `${p}/props/value`);
    if (value && !marker) add('invalid_combination', `${p}/props/value`);
    if (value) numberOperand(value, `${p}/props/value`);
    if (span) { numberOperand(span.start, `${p}/props/span/start`); numberOperand(span.size, `${p}/props/span/size`); }
    if (stops.length < 2) add('invalid_value', `${p}/props/stops`);
    stops.forEach((stop, index) => { if (index > 0 && stop.at < stops[index - 1].at) add('invalid_value', `${p}/props/stops/${index}/at`); });
    if (item.a11y.element === 'value') {
      binding(item.a11y.label, 'string', `${p}/a11y/label`);
      if (item.a11y.value) binding(item.a11y.value, 'string', `${p}/a11y/value`);
    }
  }
  /** `overlay` (`sh.overlay@1`): a base and up to four small controls on top, each at one of five anchors. */
  function overlay(item: Extract<CompositionNode, { type: 'overlay' }>, p: string, depth: number) {
    require('overlay');
    if (item.children.length === 0) { add('missing_required', `${p}/children`); return; }
    const onTop = item.children.slice(1);
    const anchored = new Set<string>();
    item.props.anchors.forEach((entry, index) => {
      if (!onTop.some(child => child.id === entry.childId)) add('invalid_reference', `${p}/props/anchors/${index}/childId`);
      else if (anchored.has(entry.childId)) add('duplicate_id', `${p}/props/anchors/${index}/childId`);
      anchored.add(entry.childId);
    });
    item.children.forEach((child, index) => {
      const shown = view(child);
      if (shown.type === 'overlay') add('invalid_combination', `${p}/children/${index}/type`);
      if (index === 0) return;
      if (!anchored.has(child.id)) add('missing_required', `${p}/props/anchors`);
      const allowed = shown.type === 'primary-button' || shown.type === 'status-pill' || shown.type === 'text' || (shown.type === 'bound-control' && shown.props.kind === 'button');
      if (!allowed) add('invalid_combination', `${p}/children/${index}/type`);
    });
    components(item.children, `${p}/children`, depth + 1);
  }
  // MARK: Dial and arc track (`sh.dial@1`, `sh.arc-track@1`)
  /** A number operand slot of a dial or an arc: walked like any operand, and refused (`binding_type`) when it can only give text, a yes or no, or a structure. */
  function dialNumber(operand: Operand, path: string) {
    useOperand(operand, path);
    const kind = operandKind(operand);
    if (kind !== undefined && kind !== 'number') add('binding_type', path);
  }
  /**
   * `dial` (`sh.dial@1`): ticks on a sweep, letters, a flag, a pointer and text in the middle. `degrees` reads a full turn, so the sweep must be 360; a ring's outer
   * end lies beyond its inner end; a skipped tick is one the ring has; a letter that needs a value needs a pointer; the middle's lines follow the rules of a `text`.
   */
  function dial(item: Extract<CompositionNode, { type: 'dial' }>, p: string) {
    require('dial');
    const { sweep, scale, ticks, pointer, labels, size, center } = item.props;
    if (scale === 'degrees' && sweep.length !== 360) add('invalid_combination', `${p}/props/scale`);
    if (size?.maxPoints !== undefined && size.maxPoints < size.points) add('invalid_value', `${p}/props/size/maxPoints`);
    if (ticks) {
      if (ticks.outer <= ticks.inner) add('invalid_value', `${p}/props/ticks/outer`);
      if (ticks.alternate && ticks.alternate.inner >= ticks.outer) add('invalid_value', `${p}/props/ticks/alternate/inner`);
      ticks.skip?.forEach((index, at) => { if (index >= ticks.count) add('invalid_value', `${p}/props/ticks/skip/${at}`); });
    }
    if (pointer) {
      dialNumber(pointer.value, `${p}/props/pointer/value`);
      if (pointer.kind === 'tick' && pointer.outer <= pointer.inner) add('invalid_value', `${p}/props/pointer/outer`);
    }
    if (item.props.textAt) {
      // The place of the middle's block (`sh.dial-text-place@1`): it states a share or an offset, and there is a block to place.
      require('dial-text-place');
      if (item.props.textAt.share === undefined && item.props.textAt.offset === undefined) add('invalid_value', `${p}/props/textAt`);
      if (!center) add('invalid_combination', `${p}/props/textAt`);
    }
    labels?.items.forEach((label, index) => { if (label.needsValue && !pointer) add('invalid_combination', `${p}/props/labels/items/${index}/needsValue`); });
    center?.forEach((line, index) => {
      const at = `${p}/props/center/${index}`;
      require('text');
      if (['subheadline', 'footnote'].includes(line.style)) require('supporting-text-styles');
      if (line.style === 'section-title') require('section-title');
      if (!baseTextStyles.includes(line.style) || line.font || line.ink || line.lines !== undefined || line.align || line.overflow) require('text-style');
      if (line.font?.scale?.maxPoints !== undefined && line.font.scale.maxPoints < line.font.scale.points) add('invalid_value', `${at}/font/scale/maxPoints`);
      if (line.overflow === 'ticker' && line.lines !== 1) add('invalid_combination', `${at}/overflow`);
      binding(line.value, 'string', `${at}/value`);
    });
    if (item.a11y.element === 'value') {
      binding(item.a11y.label, 'string', `${p}/a11y/label`);
      if (item.a11y.value) binding(item.a11y.value, 'string', `${p}/a11y/value`);
    }
  }
  /**
   * `dial-control` (`sh.dial-control@1`): see `dial-control.ts` for the structural rules. Here the operands are walked: a stopper's value, a gap, a limit and the
   * reading are numbers; every look and text follows its own rule; the dial's one call reads each stopper as `control` with a `stopper`, and a stopper's own call
   * reads a bare `control`. A call that never reads the value would change nothing.
   */
  function dialControl(item: Extract<CompositionNode, { type: 'dial-control' }>, p: string) {
    require('dial-control');
    const { props } = item;
    const spoken = [{ at: `/props/failureText`, text: props.failureText }];
    props.stoppers.forEach((stopper, index) => { if (stopper.spokenValue !== undefined) spoken.push({ at: `/props/stoppers/${index}/spokenValue`, text: stopper.spokenValue }); });
    for (const problem of dialControlProblems(item, spoken)) add(problem.code, `${p}${problem.at}`);
    const ids = props.stoppers.map(stopper => stopper.id);
    props.stoppers.forEach((stopper, index) => {
      const at = `${p}/props/stoppers/${index}`;
      dialNumber(stopper.value, `${at}/value`);
      binding(stopper.label, 'string', `${at}/label`);
      ruleSlot(stopper.ink, `${at}/ink`);
      if (stopper.trailInk) ruleSlot(stopper.trailInk, `${at}/trailInk`);
      if (stopper.trailInk && (stopper.trail === undefined || stopper.trail === 'none')) add('invalid_combination', `${at}/trailInk`);
      if (stopper.limit?.min) dialNumber(stopper.limit.min, `${at}/limit/min`);
      if (stopper.limit?.max) dialNumber(stopper.limit.max, `${at}/limit/max`);
      if (stopper.action) {
        const facts = checkCallService(stopper.action, `${at}/action`, true, repeatScope);
        require('call-service'); absorb(facts);
        if (!facts.usesControl) add('invalid_combination', `${at}/action`);
      }
    });
    if (item.action) {
      const facts = checkCallService(item.action, `${p}/action`, true, repeatScope, ids);
      require('call-service'); absorb(facts);
      if (!facts.usesControl) add('invalid_combination', `${p}/action`);
    }
    if (props.between?.gap) dialNumber(props.between.gap, `${p}/props/between/gap`);
    if (props.reading) { dialNumber(props.reading.value, `${p}/props/reading/value`); ruleSlot(props.reading.ink, `${p}/props/reading/ink`); }
    const { top, caption } = props.center;
    if (top) binding(top, 'string', `${p}/props/center/top`);
    if (caption && caption !== 'stoppers') binding(caption, 'string', `${p}/props/center/caption`);
    if (props.dimmedWhen) usePredicate(props.dimmedWhen, `${p}/props/dimmedWhen`);
    enabled(item.enabledWhen, p);
    binding(item.a11y.label, 'string', `${p}/a11y/label`);
    if (item.a11y.value) binding(item.a11y.value, 'string', `${p}/a11y/value`);
  }
  /**
   * `arc-track` (`sh.arc-track@1`): the curve's three points and the horizon's two lie in the box; the marker and the progress come together; the progress is a
   * number operand.
   */
  function arcTrack(item: Extract<CompositionNode, { type: 'arc-track' }>, p: string) {
    require('arc-track');
    const { curve, box, horizon, progress, marker } = item.props;
    const inside = ([x, y]: number[]) => x <= box[0] && y <= box[1];
    (['from', 'control', 'to'] as const).forEach(key => { if (!inside(curve[key])) add('invalid_value', `${p}/props/curve/${key}`); });
    if (horizon) (['from', 'to'] as const).forEach(key => { if (!inside(horizon[key])) add('invalid_value', `${p}/props/horizon/${key}`); });
    if (marker && !progress) add('missing_required', `${p}/props/progress`);
    if (progress && !marker) add('invalid_combination', `${p}/props/progress`);
    if (progress) dialNumber(progress, `${p}/props/progress`);
    if (item.a11y.element === 'value') {
      binding(item.a11y.label, 'string', `${p}/a11y/label`);
      if (item.a11y.value) binding(item.a11y.value, 'string', `${p}/a11y/value`);
    }
  }
  /**
   * A bound control's generated options (`sh.bound-options-read@1`), the parts of its row (`sh.bound-row-parts@1`) and its check face (`sh.check-face@1`).
   * Options are for a choice. The row parts are for a toggle drawn as a row; a check face keeps only the title, the hint, the failure caption and its tint.
   */
  function boundRow(item: Extract<CompositionNode, { type: 'bound-control' }>, p: string) {
    const props = item.props, kind = props.kind, from = props.optionsFrom;
    if (from) {
      require('bound-options-read'); require('list-read'); require('bindings');
      if (kind !== 'choice') add('invalid_combination', `${p}/props/optionsFrom`);
      expressionRefs.push({ sourceId: from.from.sourceId, path: from.from.path, pointer: `${p}/props/optionsFrom`, kind: 'string', entityOnly: 'list' });
      useOperand(from.current, `${p}/props/optionsFrom/current`);
      const shown = operandKind(from.current);
      if (shown !== undefined && shown !== 'string') add('binding_type', `${p}/props/optionsFrom/current`);
      useCall(from.action, `${p}/props/optionsFrom/action`, true);
    }
    const asRow = kind === 'toggle' && (props.surface ?? 'row') === 'row';
    const check = props.face === 'check';
    const parts: [string, unknown][] = [['subtitle', props.subtitle], ['hint', props.hint], ['metrics', props.metrics], ['failureText', props.failureText], ['glyph', props.glyph]];
    for (const [key, value] of parts) {
      if (value === undefined) continue;
      require('bound-row-parts');
      if (!asRow || (check && key !== 'hint' && key !== 'failureText')) add('invalid_combination', `${p}/props/${key}`);
    }
    if (props.subtitle) binding(props.subtitle, 'string', `${p}/props/subtitle`);
    if (props.glyph) {
      ruleSlot(props.glyph, `${p}/props/glyph`);
      if (!item.icon) add('invalid_combination', `${p}/props/glyph`);
    }
    if (props.face !== undefined) {
      require('check-face');
      if (!asRow) add('invalid_combination', `${p}/props/face`);
      if (check && item.icon) add('invalid_combination', `${p}/icon`);
    }
    if (props.checkTint !== undefined) {
      require('check-face');
      if (!check) add('invalid_combination', `${p}/props/checkTint`);
    }
  }
  /** A state tile's own parts (`sh.tile-parts@1`): a subtitle, a progress fill, up to two buttons and a destination, each needed only when present. */
  function tileParts(item: Extract<CompositionNode, { type: 'state-tile' }>, p: string) {
    const parts = item.props;
    if (parts.subtitle !== undefined || parts.progress !== undefined || parts.discs !== undefined || item.action !== undefined) require('tile-parts');
    if (parts.subtitle) binding(parts.subtitle, 'string', `${p}/props/subtitle`);
    if (parts.progress) {
      useOperand(parts.progress, `${p}/props/progress`);
      const kind = operandKind(parts.progress);
      if (kind !== undefined && kind !== 'number') add('binding_type', `${p}/props/progress`);
    }
    const ids = new Set<string>();
    parts.discs?.forEach((disc, index) => {
      const at = `${p}/props/discs/${index}`;
      if (ids.has(disc.id)) add('duplicate_id', `${at}/id`);
      ids.add(disc.id);
      // A symbol by rule or entity, a label by rule or expression, and a label that names the tile (`sh.tile-disc-rules@1`).
      ruleSlot(disc.icon, `${at}/icon`);
      if (disc.icon.type !== 'sf-symbol' || typeof disc.label !== 'string' || disc.namesTile !== undefined) require('tile-disc-rules');
      if (typeof disc.label !== 'string') binding(disc.label, 'string', `${at}/label`);
      for (const plain of plainActions(disc.action, `${at}/action`)) if (plain.action.type === 'domain') add('invalid_combination', `${plain.path}/type`);
      action(disc.action, `${at}/action`);
      visibility(disc, at);
      enabled(disc.enabledWhen, at);
    });
    if (item.action) action(item.action, `${p}/action`);
    swipe(item.props.swipe, 'state-tile', `${p}/props/swipe`, item.props.swipe?.value);
  }
  /**
   * Swipe to adjust (`sh.tile-swipe@1`). The range, the detent and what belongs to one tile type only are `swipeProblems`; here the value must be a number,
   * and the call must use `control` (a swipe whose call never uses the value would change nothing) and must not ask first (a drag that ends in a
   * question is not feedback that predicts the result).
   */
  function swipe(found: TileSwipe | undefined, tile: SwipeTile, at: string, valueOperand: Operand | undefined) {
    if (!found) return;
    require('tile-swipe');
    for (const problem of swipeProblems(found, tile)) add(problem.code, `${at}${problem.at}`);
    if (valueOperand) {
      useOperand(valueOperand, `${at}/value`);
      const kind = operandKind(valueOperand);
      if (kind !== undefined && kind !== 'number') add('binding_type', `${at}/value`);
    }
    if (found.action) {
      const facts = checkCallService(found.action, `${at}/action`, true);
      require('call-service'); absorb(facts);
      if (!facts.usesControl) add('invalid_combination', `${at}/action`);
      if (found.action.confirmation?.type === 'additional') add('invalid_combination', `${at}/action/confirmation`);
    }
  }
  /** State words (`sh.state-words@1`): the capability is needed exactly when a `words` object is present; each key must be one the tile draws and hold its token. */
  function words(found: StateWords | undefined, allowed: readonly (keyof StateWords)[], at: string) {
    if (!found) return;
    require('state-words');
    for (const problem of wordProblems(found, allowed)) add(problem.code, `${at}${problem.at}`);
  }
  /** `single` makes `items` hold the one node whose own pointer is `path` (a library entry's `node`), not a list at `path`. */
  function components(items: CompositionNode[], path: string, depth = 1, grid = false, single = false) {
    if (depth === 1) {
      const roots = items.map(view);
      if (roots.filter(item => item.type === 'local-tabs' && item.props.scopeProviderId).length > 1) add('invalid_combination', path);
      const pinnedTabs = roots.filter(item => item.type === 'local-tabs' && item.props.pinned).length;
      if (pinnedTabs > 1 || (pinnedTabs > 0 && roots.some(item => item.type === 'pinned-actions' || item.type === 'form'))) add('invalid_combination', path);
      for (const kind of ['form', 'pinned-actions']) {
        if (roots.filter(item => item.type === kind).length > 1) add('invalid_combination', path);
      }
    }
    items.forEach((item, index) => {
      const p = single ? path : `${path}/${index}`;
      if (++nodes > 4096 || depth > 12) add('limit_exceeded', p);
      register('node', item.id, `${p}/id`);
      visibility(item as Visibility, p);
      if (!grid && item.layout.span !== undefined && item.layout.span !== 1) add('invalid_combination', `${p}/layout/span`);
      // Which side of the hinge a section sits on while the Duo is partly folded (`sh.fold-sides@1`): a page's top-level components say it, nothing nested does, and a saved component's body does not (the place says it).
      if ((item.layout as { foldSide?: FoldSide }).foldSide !== undefined) {
        require('fold-sides');
        if (depth !== 1 || !onPage || inBody) add('invalid_combination', `${p}/layout/foldSide`);
      }
      if (depth > 1 && ['form', 'pinned-actions'].includes(item.type)) add('invalid_combination', `${p}/type`);
      // A badge on a kind that could not carry one (`sh.badge-nodes@1`): the capability is needed whenever the field is present.
      if (badgeNodeKinds.includes(item.type) && 'badge' in item && item.badge) badge(item.badge, `${p}/badge`, true);
      switch (item.type) {
        case 'avatar': {
          require('avatar');
          if (item.props.person.type === 'person' && !/^person\.[a-z0-9_]+$/.test(item.props.person.entityId)) add('invalid_value', `${p}/props/person/entityId`);
          if (item.props.fill?.type === 'solid-rgb' && !initialsReadable(item.props.fill)) add('invalid_value', `${p}/props/fill`);
          if (item.action) {
            if (!item.title.trim()) add('missing_required', `${p}/title`);
            action(item.action, `${p}/action`);
          }
          break;
        }
        case 'component-ref': {
          require('component-ref');
          if (inBody) { add('invalid_combination', `${p}/type`); break; }
          const entry = library.get(item.componentId);
          if (!entry) { add('invalid_reference', `${p}/componentId`); break; }
          if (placementRefused(entry.node, depth, grid)) add('invalid_combination', `${p}/componentId`);
          // Each use adds the whole body to the total and its height to the depth, as if the body's nodes sat here.
          const before = nodes;
          nodes += bodyCount(entry.node) - 1;
          if ((before <= 4096 && nodes > 4096) || (depth <= 12 && depth + bodyHeight(entry.node) - 1 > 12)) add('limit_exceeded', p);
          checkArgs(item, entry, p);
          break;
        }
        case 'info-box':
          require('info-box'); binding(item.props.message, 'string', `${p}/props/message`); break;
        case 'status-pill':
          require('status-pill'); binding(item.props.value, 'string', `${p}/props/value`);
          binding(item.props.detail, 'string', `${p}/props/detail`);
          if (typeof item.props.tone === 'object') ruleSlot(item.props.tone, `${p}/props/tone`);
          break;
        case 'paged-row':
          require('paged-row'); components(item.children, `${p}/children`, depth + 1); forbidRules(item.children, `${p}/children`); break;
        case 'section':
          require('section');
          if (item.props.presentationProviderId) require('presentation-providers');
          if (item.props.style === 'module-list') item.children.map(view).forEach((child, index) => {
            if (child.type === 'settings-link') require('module-settings-rows');
            const settingsRow = child.type === 'settings-control' && [
              'household-recovery', 'presence-choice', 'vacation-check', 'vacation-confirm', 'solo-confirm', 'away-restore',
              'background-blur', 'reset-background-blur', 'app-badge', 'app-icon-choice', 'app-version', 'profile-person',
              'sign-out', 'ha-value', 'ha-web', 'performance-recording',
            ].includes(child.props.kind);
            if (settingsRow) require('module-settings-rows');
            if (!settingsRow && child.type !== 'row' && child.type !== 'local-control' && child.type !== 'settings-link'
                && !(child.type === 'climate-control' && ['toggle', 'explicit-switch', 'status', 'link'].includes(child.props.kind))
                && !(child.type === 'bound-control' && child.props.kind !== 'button' && (child.props.surface ?? 'row') === 'row'))
              add('invalid_combination', typeAt(item.children[index], `${p}/children/${index}`));
          });
          if (item.props.style === 'module-list') forbidRules(item.children, `${p}/children`);
          components(item.children, `${p}/children`, depth + 1); break;
        case 'row':
          require('rows');
          binding(item.props.primary, 'string', `${p}/props/primary`);
          binding(item.props.secondary, 'string', `${p}/props/secondary`);
          binding(item.props.value, 'string', `${p}/props/value`);
          if (item.props.accessory === 'disclosure' && !item.action) add('invalid_combination', `${p}/props/accessory`);
          if (item.action) {
            // A domain action stays off a row, whether it stands alone or in a rule.
            for (const plain of plainActions(item.action, `${p}/action`)) if (plain.action.type === 'domain') add('invalid_combination', `${plain.path}/type`);
            action(item.action, `${p}/action`);
          }
          if (item.enabledWhen && !item.action) add('invalid_combination', `${p}/enabledWhen`);
          enabled(item.enabledWhen, p);
          break;
        case 'local-tabs': {
          require('local-tabs'); require('local-state');
          if (item.props.scopeProviderId) {
            require('presentation-providers');
            if (depth !== 1) add('invalid_combination', `${p}/props/scopeProviderId`);
          }
          if (((item.props.showsSelector === false || item.props.retainsAutomaticSelection) && !item.props.scopeProviderId) ||
              (item.props.pinned && item.props.showsSelector === false)) add('invalid_combination', `${p}/props`);
          if (item.props.pinned) {
            require('pinned-tabs');
            if (depth !== 1) add('invalid_combination', `${p}/props/pinned`);
            if (item.tabs.some(tab => !tab.icon) && !item.props.tabBar) add('invalid_combination', `${p}/tabs`);
          }
          const field = localFields.get(item.props.stateId);
          if (!field) add('invalid_reference', `${p}/props/stateId`);
          else if (field.type !== 'choice') add('binding_type', `${p}/props/stateId`);
          else if (field.options.map(option => option.id).join('\0') !== item.tabs.map(tab => tab.id).join('\0') ||
                   field.options.map(option => option.label).join('\0') !== item.tabs.map(tab => tab.label).join('\0'))
            add('invalid_combination', `${p}/props/stateId`);
          if (new Set(item.tabs.map(tab => tab.id)).size !== item.tabs.length) add('duplicate_id', `${p}/tabs`);
          if (item.props.fallbackTabId !== undefined) {
            require('tab-fallback');
            if (!item.tabs.some(tab => tab.id === item.props.fallbackTabId)) add('invalid_reference', `${p}/props/fallbackTabId`);
          }
          if (item.props.automatic) {
            require('selected-when');
            item.props.automatic.forEach((rule, index) => {
              if (!item.tabs.some(tab => tab.id === rule.tabId)) add('invalid_reference', `${p}/props/automatic/${index}/tabId`);
              usePredicate(rule.selectedWhen, `${p}/props/automatic/${index}/selectedWhen`);
            });
            if (item.props.scopeProviderId) add('invalid_combination', `${p}/props/automatic`);
          }
          tabParts(item, p, depth);
          break;
        }
        case 'overlay': overlay(item, p, depth); break;
        case 'local-control': {
          require('local-controls'); require('local-state');
          const field = localFields.get(item.props.stateId);
          const expected = { toggle: 'boolean', stepper: 'number', choice: 'choice', 'text-field': 'string', 'segmented-choice': 'choice' }[item.props.kind];
          if (!field) add('invalid_reference', `${p}/props/stateId`);
          else if (field.type !== expected) add('binding_type', `${p}/props/stateId`);
          else if (field.type === 'number' && [field.minimum, field.maximum, field.step].some(value => !Number.isInteger(value)))
            add('invalid_combination', `${p}/props/stateId`);
          else if (field.type === 'choice' && item.props.kind === 'segmented-choice' && field.options.length > 4)
            add('invalid_combination', `${p}/props/stateId`);
          else if (field.type === 'choice' && item.props.kind !== 'segmented-choice' && field.options.some(option => option.symbol !== undefined || option.hint !== undefined))
            add('invalid_combination', `${p}/props/stateId`);
          break;
        }
        case 'bound-control': {
          require('bound-control');
          const props = item.props, kind = props.kind;
          if (props.surface !== undefined && kind !== 'toggle') add('invalid_combination', `${p}/props/surface`);
          const allowed = boundControlProps[kind];
          const actionKeys = boundControlActions[kind];
          for (const key of kindDependentProps)
            if (props[key] !== undefined && !allowed.includes(key)) add('invalid_combination', `${p}/props/${key}`);
          for (const key of kindDependentActions)
            if (item[key] !== undefined && !actionKeys.includes(key)) add('invalid_combination', `${p}/${key}`);
          for (const key of actionKeys) if (item[key as 'action'] === undefined) add('missing_required', `${p}/${key}`);
          for (const key of allowed) if (key !== 'format' && props[key as 'isOn'] === undefined) add('missing_required', `${p}/props/${key}`);
          for (const key of ['onAction', 'offAction', 'action'] as const) {
            const call = item[key];
            if (call) useCall(call, `${p}/${key}`, kind !== 'button');
          }
          enabled(item.enabledWhen, p);
          if (props.isOn) usePredicate(props.isOn, `${p}/props/isOn`);
          if (props.value) useOperand(props.value, `${p}/props/value`);
          if (props.range && (props.range.min >= props.range.max || (props.range.max - props.range.min) % props.range.step !== 0))
            add('invalid_value', `${p}/props/range`);
          if (props.format !== undefined && !props.format.includes('{value}')) add('invalid_value', `${p}/props/format`);
          boundRow(item, p);
          if (props.options) {
            if (props.options.length < 2) add('limit_exceeded', `${p}/props/options`);
            props.options.forEach((option, index) => {
              require('selected-when');
              usePredicate(option.selectedWhen, `${p}/props/options/${index}/selectedWhen`);
              useCall(option.action, `${p}/props/options/${index}/action`, kind !== 'button');
            });
            if (new Set(props.options.map(option => option.id)).size !== props.options.length) add('duplicate_id', `${p}/props/options`);
          }
          break;
        }
        case 'primary-button':
          require('primary-button');
          for (const plain of plainActions(item.action, `${p}/action`)) if (plain.action.type === 'domain') add('invalid_combination', `${plain.path}/type`);
          action(item.action, `${p}/action`);
          enabled(item.enabledWhen, p); break;
        case 'row-collection': {
          require('row-collection');
          const parts = item.props;
          providerRefs.push({ id: parts.providerId, node: { type: 'row-collection', refreshable: parts.refreshable }, path: `${p}/props` });
          // The list's own parts, each needed only when present (`sh.list-parts@1`).
          if (parts.rowAction !== undefined || parts.refreshable !== undefined || parts.emptyMessage !== undefined) require('list-parts');
          if (parts.rowAction) {
            for (const plain of plainActions(parts.rowAction, `${p}/props/rowAction`)) if (plain.action.type === 'domain') add('invalid_combination', `${plain.path}/type`);
            action(parts.rowAction, `${p}/props/rowAction`);
          }
          if (parts.emptyMessage) binding(parts.emptyMessage, 'string', `${p}/props/emptyMessage`);
          break;
        }
        case 'collection':
          require('collection');
          providerRefs.push({ id: item.props.providerId, node: { type: 'collection', template: item.props.template }, path: `${p}/props` });
          if (item.selection) action(item.selection, `${p}/selection`);
          if (item.props.bedroomLinks) {
            require('bedroom-collection-links');
            if (item.props.template !== 'rows' || new Set(item.props.bedroomLinks.map(link => link.side)).size !== item.props.bedroomLinks.length)
              add('invalid_combination', `${p}/props/bedroomLinks`);
            item.props.bedroomLinks.forEach((link, index) => action(link.action, `${p}/props/bedroomLinks/${index}/action`));
          }
          break;
        case 'form':
          if (item.props.fields.some(field => field.control === 'schedule-date-time')) require('schedule-date-fields');
          require('form');
          if (new Set(item.props.fields.map(field => field.key)).size !== item.props.fields.length)
            add('duplicate_id', `${p}/props/fields`);
          if (item.success) {
            if (!['back', 'dismiss', 'dismiss-then-push'].includes(item.success.type)) add('invalid_combination', `${p}/success`);
            action(item.success, `${p}/success`);
          }
          break;
        case 'recipe-part': require('recipe-part'); break;
        case 'pinned-actions':
          require('pinned-actions');
          (item.children ?? []).map(view).forEach((child, index) => {
            const settingsPrimary = child.type === 'settings-control' && [
              'vacation-confirm', 'solo-confirm', 'feedback-submit', 'feedback-stop', 'performance-action', 'location-action', 'ha-settings',
            ].includes(child.props.kind);
            if (child.type !== 'primary-button' && !settingsPrimary) add('invalid_combination', typeAt(item.children![index], `${p}/children/${index}`));
          });
          components(item.children ?? [], `${p}/children`, depth + 1);
          if (item.props.style === 'form') {
            require('pinned-form-actions');
            if (item.props.items.length + (item.children?.length ?? 0) > 2 ||
                item.props.items.filter(value => value.prominent).length + (item.children?.length ?? 0) !== 1 ||
                item.props.searchProviderId || item.props.items.some(value => value.role)) add('invalid_combination', `${p}/props`);
          } else {
            if (item.children?.length || item.props.items.some(value => value.stateProviderId)) add('invalid_combination', `${p}/props`);
            item.props.items.forEach((value, index) => {
              if (value.action.type === 'domain' || value.action.type === 'set-local' || value.action.type === 'call-service') add('invalid_combination', `${p}/props/items/${index}/action/type`);
            });
          }
          if (new Set(item.props.items.map(value => value.id)).size !== item.props.items.length)
            add('duplicate_id', `${p}/props/items`);
          if (!item.props.items.length && !item.children?.length && !item.props.searchProviderId) add('invalid_combination', `${p}/props`);
          if (item.props.items.some(value => value.role) && !item.props.searchProviderId) add('invalid_combination', `${p}/props`);
          item.props.items.forEach((value, index) => action(value.action, `${p}/props/items/${index}/action`));
          break;
        case 'status-rail':
          require('status-rail');
          item.children.forEach((original, i) => {
            const child = view(original);
            if (child.type !== 'status-chip' && child.type !== 'room-chip') add('invalid_combination', typeAt(original, `${p}/children/${i}`));
          });
          components(item.children, `${p}/children`, depth + 1, false); forbidRules(item.children, `${p}/children`); break;
        case 'status-chip': case 'room-overview-tile':
          require(item.type); require('home-status'); require('bindings');
          homeRefs.push({ id: item.props.sourceId, model: 'home-status@1', path: `${p}/props/sourceId` });
          {
            const states = new Set<string>();
            item.props.states.forEach((state, index) => {
              if (states.has(state.state)) add('invalid_combination', `${p}/props/states/${index}/state`);
              states.add(state.state);
              look(state.appearance, `${p}/props/states/${index}/appearance`);
              if (item.type === 'room-overview-tile' && state.appearance.glyph) add('invalid_combination', `${p}/props/states/${index}/appearance/glyph`);
            });
            look(item.props.fallback, `${p}/props/fallback`);
            if (item.type === 'room-overview-tile' && item.props.fallback.glyph) add('invalid_combination', `${p}/props/fallback/glyph`);
            if (item.type === 'room-overview-tile' && item.props.powerSourceId) {
              require('home-light');
              require('room-light-power');
              homeRefs.push({ id: item.props.powerSourceId, model: 'home-light@1', path: `${p}/props/powerSourceId` });
              homePowerRefs.push({ status: item.props.sourceId, power: item.props.powerSourceId, path: `${p}/props/powerSourceId` });
              if (!item.action) add('invalid_combination', `${p}/props/powerSourceId`);
            }
          }
          if (item.action) action(item.action, `${p}/action`);
          badge(item.badge, `${p}/badge`);
          // The words the overview says (`sh.state-words@1`): the keys follow the source's projection, which is checked once the sources are known.
          if (item.type === 'room-overview-tile' && item.props.words) { require('state-words'); overviewWords.push({ sourceId: item.props.sourceId, words: item.props.words, path: `${p}/props/words` }); }
          break;
        case 'light-group-tile':
          require('light-group-tile'); require('home-light'); require('bindings');
          homeRefs.push({ id: item.props.sourceId, model: 'home-light@1', path: `${p}/props/sourceId` });
          swipe(item.props.swipe, 'light-group-tile', `${p}/props/swipe`, undefined);
          words(item.props.words, wordKeysFor['light-group-tile'], `${p}/props/words`); break;
        case 'weather-panel':
          require('weather-panel'); require('home-weather'); require('bindings');
          homeRefs.push({ id: item.props.sourceId, model: 'home-weather@1', path: `${p}/props/sourceId` });
          if (new Set(item.props.modes).size !== item.props.modes.length) add('invalid_combination', `${p}/props/modes`);
          if (!item.props.modes.includes(item.props.initialMode)) add('invalid_combination', `${p}/props/initialMode`);
          if (new Set(item.props.highlights).size !== item.props.highlights.length) add('invalid_combination', `${p}/props/highlights`);
          if (item.action && item.props.panel !== 'summary') add('invalid_combination', `${p}/action`);
          if (item.action) action(item.action, `${p}/action`);
          break;
        case 'alarm-panel': {
          require('alarm-panel'); require('alarm-mode'); require('bindings');
          alarmRefs.push({ id: item.props.sourceId, path: `${p}/props/sourceId` });
          for (const key of ['modes', 'states'] as const) {
            const states = new Set<string>();
            item.props[key].forEach((value, i) => {
              if (states.has(value.state)) add('invalid_combination', `${p}/props/${key}/${i}/state`);
              states.add(value.state);
            });
          }
          break;
        }
        case 'door-tile': {
          require('security-door'); require('bindings'); require('tiles');
          doorRefs.push({ id: item.props.sourceId, kind: item.props.kind, path: `${p}/props/sourceId` });
          const seen = new Set<string>(), allowed = item.props.kind === 'lock'
            ? ['locked', 'unlocked', 'locking', 'unlocking', 'open', 'jammed'] : ['closed', 'open', 'opening', 'closing'];
          item.props.states.forEach((value, i) => {
            if (seen.has(value.state) || !allowed.includes(value.state)) add('invalid_combination', `${p}/props/states/${i}/state`);
            seen.add(value.state);
          });
          break;
        }
        case 'climate-control':
          require('bindings'); require('climate-source'); capabilities.add(climateCapability(item.props.kind));
          if (['link', 'room-tile'].includes(item.props.kind) !== Boolean(item.action)) add('invalid_combination', `${p}/action`);
          if (item.props.kind === 'room-tile') require('tiles');
          if (item.action) action(item.action, `${p}/action`);
          climateRefs.push({ props: item.props, path: `${p}/props` }); break;
        case 'room-section':
          require('room-section'); require('grid');
          roomVisibility(item.props.visibility, `${p}/props/visibility`);
          components(item.children, `${p}/children`, depth + 1, true); forbidRules(item.children, `${p}/children`); break;
        case 'room-card':
        case 'room-chip': {
          require(item.type); require('bindings');
          if (item.type === 'room-card') require('tiles');
          roomRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId`, navigation: false });
          item.props.subtitleSourceIds.forEach((id, index) => roomRefs.push({ id, path: `${p}/props/subtitleSourceIds/${index}`, navigation: false }));
          const alternate = item.props.alternate;
          if (alternate) {
            roomVisibility(alternate.when, `${p}/props/alternate/when`);
            roomRefs.push({ id: alternate.sourceId, path: `${p}/props/alternate/sourceId`, navigation: false });
            alternate.subtitleSourceIds.forEach((id, i) => roomRefs.push({ id, path: `${p}/props/alternate/subtitleSourceIds/${i}`, navigation: false }));
          }
          const chip = item.props.chipSources;
          if (chip) {
            for (const key of ['aqiSourceId', 'colorSourceId', 'alarmSourceId', 'homeAwaySourceId'] as const) {
              const id = chip[key]; if (id) roomRefs.push({ id, path: `${p}/props/chipSources/${key}`, navigation: false });
            }
            chip.awaySourceIds.forEach((id, i) => roomRefs.push({ id, path: `${p}/props/chipSources/awaySourceIds/${i}`, navigation: false }));
          }
          const colors = new Set<string>();
          item.props.stateColors?.forEach((value, i) => {
            if (colors.has(value.state)) add('invalid_combination', `${p}/props/stateColors/${i}/state`); colors.add(value.state);
            ruleSlot(value.fill, `${p}/props/stateColors/${i}/fill`);
          });
          const states = new Set<string>();
          item.props.stateLabels.forEach((state, index) => {
            if (states.has(state.state)) add('invalid_combination', `${p}/props/stateLabels/${index}/state`);
            states.add(state.state);
          });
          roomVisibility(item.props.visibility, `${p}/props/visibility`);
          if (item.props.action) action(item.props.action, `${p}/props/action`);
          if (item.props.power) {
            if (item.type === 'room-chip') add('invalid_combination', `${p}/props/power`);
            action(item.props.power, `${p}/props/power`);
          }
          break;
        }
        case 'room-navigation-grid':
          require('room-navigation'); require('bindings'); require('tiles'); require('grid');
          roomRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId`, navigation: true }); break;
        case 'room-device-control':
          require(deviceControlModel(item.props.control).slice(0, -2)); require('bindings');
          if (item.props.control === 'humidifier-scheduling') require('humidifier-scheduling');
          if (item.props.modalId) {
            require('actions.navigation'); refs.push({ kind: 'modal', id: item.props.modalId, path: `${p}/props/modalId` });
          }
          validateDeviceControl(item, p, add); deviceRefs.push({ control: item, path: p }); break;
        case 'bedroom-control': {
          const props = item.props;
          if ('action' in props) action(props.action, `${p}/props/action`);
          if (props.control === 'bed-reading' && props.parameter === 'pump-status' && (!props.activeLabel || !props.inactiveLabel))
            add('invalid_combination', `${p}/props`);
          require(props.control); require('bindings');
          if ('showsExplanation' in props) require('wake-hold-explanation');
          if ('episode' in props) require('wake-episode');
          if ('showsHeading' in props) require('bedroom-field-headings');
          if (props.control === 'alarm-weekdays' && props.options.some(option => option.accessibilityLabel !== undefined))
            require('weekday-accessibility-labels');
          const wakeMessage = props.control === 'alarm-delete' && props.confirmation.messageFormat === 'wake-alarm';
          if (wakeMessage) {
            require('wake-alarm-confirmation');
            if (/[{}]/.test(props.confirmation.message.replaceAll('{time}', '').replaceAll('{schedule}', '')))
              add('invalid_combination', `${p}/props/confirmation/message`);
          }
          bedroomRefs.push({ id: props.sourceId, providers: wakeMessage ? ['wake-alarm-draft'] : bedroomProviders(props.control),
            path: `${p}/props/sourceId` });
          if ('options' in props) {
            const values = props.options.map(option => option.value);
            if (new Set(values).size !== values.length) add('invalid_combination', `${p}/props/options`);
            const all = props.control === 'alarm-weekdays' ? bedroomWeekdays : props.control === 'alarm-kind' ? ['weekly', 'once'] : undefined;
            if (all && all.some(value => !values.some(selected => selected === value))) add('invalid_combination', `${p}/props/options`);
          }
          if ('confirmation' in props && props.confirmation.confirmLabel === props.confirmation.cancelLabel)
            add('invalid_combination', `${p}/props/confirmation`);
          if ('scope' in props && new Set([props.scope.tonightLabel, props.scope.allNightsLabel, props.scope.cancelLabel]).size !== 3)
            add('invalid_combination', `${p}/props/scope`);
          break;
        }
        case 'custom-light-control':
        case 'sprinkler-control': {
          require(item.type === 'custom-light-control' ? 'custom-lights' : 'sprinkler-controller'); require('bindings');
          providerControls.push({ control: item, path: `${p}/props` });
          if (item.type === 'custom-light-control' && item.props.kind === 'brightness') words(item.props.words, wordKeysFor['custom-light-control'], `${p}/props/words`);
          if ('action' in item.props && item.props.action) {
            action(item.props.action, `${p}/props/action`);
            if (!['push', 'present', 'select-tab', 'dismiss-then-push'].includes(item.props.action.type))
              add('invalid_combination', `${p}/props/action`);
          }
          break;
        }
        case 'remote-control':
          require('bindings'); require('media-remote'); require(`remote-${item.props.kind}`);
          remoteRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId` });
          remoteControlIssues(item.props).forEach(path => add('invalid_combination', `${p}/props${path}`));
          if (item.props.kind === 'card') action(item.props.action, `${p}/props/action`);
          break;
        case 'vacuum-control': {
          require('vacuum'); require('bindings');
          const primitive = item.props.primitive;
          vacuumPrimitiveCapabilities(primitive).forEach(require);
          if (primitive.kind === 'target' || primitive.kind === 'report' || primitive.kind === 'card') action(primitive.destination, `${p}/props/primitive/destination`);
          if (primitive.kind === 'area-editor') {
            action(primitive.onUse, `${p}/props/primitive/onUse`); action(primitive.onDiscard, `${p}/props/primitive/onDiscard`);
          }
          if (primitive.kind === 'map') primitive.controls?.forEach((group, gi) => group.buttons.forEach((button, bi) => {
            const at = `${p}/props/primitive/controls/${gi}/buttons/${bi}`;
            // A symbol by rule or entity and a label by rule or expression follow the tile buttons' rules (`sh.tile-disc-rules@1`).
            ruleSlot(button.icon, `${at}/icon`);
            if (button.icon.type !== 'sf-symbol' || typeof button.label !== 'string') require('tile-disc-rules');
            if (typeof button.label !== 'string') binding(button.label, 'string', `${at}/label`);
            if (button.action.type !== 'map' && button.action.type !== 'source-command') action(button.action, `${at}/action`);
            visibility(button, at);
            enabled(button.enabledWhen, at);
          }));
          if (primitive.kind === 'card' && new Set(primitive.commands).size !== primitive.commands.length)
            add('invalid_combination', `${p}/props/primitive/commands`);
          if (primitive.kind === 'settings' && new Set(primitive.rows.map(row => row.role)).size !== primitive.rows.length)
            add('invalid_combination', `${p}/props/primitive/rows`);
          vacuumRefs.push({ control: item, path: `${p}/props` });
          break;
        }
        case 'camera-tile':
          require('camera-tile'); require('bindings');
          cameraRefs.push({ id: item.props.sourceId, path: `${p}/props/sourceId`, records: false });
          cameraPresentations.push({ source: item.props.sourceId, modal: item.action.modalId, path: `${p}/action/modalId` });
          action(item.action, `${p}/action`); break;
        case 'camera-video':
          require('camera-video'); require('bindings');
          cameraRefs.push({ id: item.props.sourceId, path: `${p}/props/sourceId`, records: false }); break;
        case 'camera-controls':
        case 'camera-viewer': {
          require('camera-controls'); require('bindings');
          if (item.type === 'camera-viewer') { require('camera-viewer'); require('camera-video'); }
          const seen = new Set<string>();
          item.props.controls.forEach((control, index) => {
            if (seen.has(control.intent)) add('invalid_combination', `${p}/props/controls/${index}/intent`);
            seen.add(control.intent);
          });
          cameraRefs.push({ id: item.props.sourceId, path: `${p}/props/sourceId`, records: seen.has('record') });
          break;
        }
        case 'notification-permission-banner': require('bootstrap-notifications'); break;
        case 'bootstrap-message': require('bootstrap-message'); break;
        case 'text': {
          require('text');
          const look = item.props;
          if (['subheadline', 'footnote'].includes(look.style)) require('supporting-text-styles');
          if (look.style === 'section-title') require('section-title');
          if (!baseTextStyles.includes(look.style) || look.font || look.ink || look.lines !== undefined || look.align || look.overflow) require('text-style');
          if (look.font?.scale?.maxPoints !== undefined && look.font.scale.maxPoints < look.font.scale.points) add('invalid_value', `${p}/props/font/scale/maxPoints`);
          // A ticker slides one line.
          if (look.overflow === 'ticker' && look.lines !== 1) add('invalid_combination', `${p}/props/overflow`);
          binding(item.props.value, 'string', `${p}/props/value`);
          break;
        }
        case 'dial': dial(item, p); break;
        case 'arc-track': arcTrack(item, p); break;
        case 'dial-control': dialControl(item, p); break;
        case 'stack': stack(item, p, depth); break;
        case 'repeat': repeat(item, p, depth); break;
        case 'shape': require('stack'); require('text-style'); break;
        case 'symbol': {
          require('symbol-part'); require('text-style');
          ruleSlot(item.props.name, `${p}/props/name`);
          const { size, rotate, tint, rendering } = item.props;
          if (size.maxScale !== undefined && size.relativeTo === undefined) add('invalid_combination', `${p}/props/size/maxScale`);
          // A multicolor symbol draws its own colors: a tint is for a monochrome one.
          if (tint !== undefined && rendering === 'multicolor') add('invalid_combination', `${p}/props/tint`);
          if (rotate) {
            useOperand(rotate, `${p}/props/rotate`);
            const kind = operandKind(rotate);
            if (kind !== undefined && kind !== 'number') add('binding_type', `${p}/props/rotate`);
          }
          if (item.a11y.element === 'image') binding(item.a11y.label, 'string', `${p}/a11y/label`);
          break;
        }
        case 'chart': chart(item, p); break;
        case 'linear-gauge': linearGauge(item, p); break;
        case 'settings-control':
          require('settings-controls'); require('bindings');
          settingsRefs.push({ id: item.props.sourceId, kind: item.props.kind, path: `${p}/props/sourceId` });
          if (settingsDestination(item.props.kind) !== Boolean(item.props.destination)) add('invalid_combination', `${p}/props/destination`);
          if (settingsItem(item.props.kind) === (item.props.item.length === 0)) add('invalid_combination', `${p}/props/item`);
          if (settingsFixedItems[item.props.kind] && !settingsFixedItems[item.props.kind]!.includes(item.props.item)) add('invalid_combination', `${p}/props/item`);
          if (item.props.destination) action(item.props.destination, `${p}/props/destination`);
          break;
        case 'settings-link':
          require('settings-link');
          if (grid) add('invalid_combination', p);
          if (item.props.showsChevron !== (item.action.type === 'push')) add('invalid_combination', `${p}/props/showsChevron`);
          action(item.action, `${p}/action`); break;
        case 'account-header':
          require('profile-account'); require('bindings');
          if (grid) add('invalid_combination', `${p}/type`);
          profileRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId` });
          break;
        case 'tile-grid':
          require('grid');
          if (item.props.minimum === 'section-wide@1') {
            require('section-grid');
            if (item.props.maxColumns > 2) add('invalid_combination', `${p}/props/maxColumns`);
          }
          if (item.props.minimum === 'tile-dynamic-type@1') require('grid-dynamic-type');
          if (item.props.minimumColumns !== undefined) {
            require('grid-min-columns');
            if (item.props.minimumColumns > item.props.maxColumns) add('invalid_value', `${p}/props/minimumColumns`);
          }
          if (item.props.groups) {
            // Group by state (`sh.grid-state-groups@1`): the shape holds one to three groups; here a state is in exactly one group and an id is not reused.
            require('grid-state-groups');
            for (const problem of groupProblems(item.props.groups)) add(problem.code, `${p}/props/groups${problem.at}`);
          }
          components(item.children, `${p}/children`, depth + 1, true); break;
        case 'navigation-tile':
          require('tiles');
          if (item.props.titleProviderId || !['neutral', 'lights'].includes(item.props.family)) require('collection-navigation');
          roomVisibility(item.props.roomVisibility, `${p}/props/roomVisibility`);
          if (item.props.presentation || item.props.selected === 'none') require('tile-presentation');
          if (item.props.presentation && item.props.presentation.fill.type !== 'standard' && item.props.family !== 'neutral')
            add('invalid_combination', `${p}/props/family`);
          if (item.props.presentation) ruleSlot(item.props.presentation.fill, `${p}/props/presentation/fill`);
          if (item.props.alarm) {
            require('alarm-mode'); require('bindings');
            alarmRefs.push({ id: item.props.alarm.sourceId, path: `${p}/props/alarm/sourceId` });
            if (item.props.family !== 'neutral') add('invalid_combination', `${p}/props/family`);
            if (item.props.selected !== 'none') add('invalid_combination', `${p}/props/selected`);
            if (item.props.presentation && item.props.presentation.fill.type !== 'standard')
              add('invalid_combination', `${p}/props/presentation/fill`);
            if (item.props.subtitle.type !== 'literal' || item.props.subtitle.value !== '')
              add('invalid_combination', `${p}/props/subtitle`);
            const states = new Set<string>();
            item.props.alarm.states.forEach((state, index) => {
              if (states.has(state.state)) add('invalid_combination', `${p}/props/alarm/states/${index}/state`);
              states.add(state.state);
            });
          }
          binding(item.props.subtitle, 'string', `${p}/props/subtitle`); action(item.action, `${p}/action`);
          badge(item.badge, `${p}/badge`); break;
        case 'state-tile':
          require('tiles'); require('state-style');
          issues.push(...checkStateTileBinding(item.binding, document.stateStyles, `${p}/binding`));
          enabled(item.enabledWhen, p); badge(item.badge, `${p}/badge`);
          tileParts(item, p);
          if (item.glyphTint !== undefined || item.discGlyphTint !== undefined || item.cellFit !== undefined) require('tile-ink');
          for (const face of ['activeWhen', 'filledWhen', 'errorWhen'] as const) {
            const rule = item[face];
            if (rule) { require('tile-look'); usePredicate(rule, `${p}/${face}`); }
          }
          break;
        case 'action-tile':
          require('tiles'); require('bindings'); require('power-toggle');
          if (item.props.powerLabels || item.props.family === 'occupancy') require('power-labels');
          powerRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId`, code: 'binding_type' });
          if (item.binding.sourceId !== item.action.sourceId) add('invalid_combination', `${p}/action/sourceId`);
          action(item.action, `${p}/action`); break;
      }
    });
  }
  // Each entry's body is walked once, at its library pointer, whether or not anything uses it: its ids, bindings, actions and rules are checked here, not per use.
  document.componentLibrary?.forEach((entry, index) => {
    const at = `/document/componentLibrary/${index}`, before = nodes;
    nodes = 0; inBody = true; surfaceKind = 'library';
    components([checkedBody(entry)], `${at}/node`, 1, false, true);
    inBody = false; surfaceKind = 'page'; nodes = before;
    checkParams(entry, at);
  });
  const expanded = expandDocument(document);
  if (document.levels !== undefined) require('sheet-levels');
  for (const [kind, surfaces] of [['page', document.pages], ['modal', document.modals], ['level', document.levels ?? []]] as const) {
    surfaces.forEach((surface, index) => {
      const p = `/document/${kind}s/${index}`;
      surfaceKind = kind;
      register('surface', surface.id, `${p}/id`); register(kind, surface.id, `${p}/id`);
      if (surface.titleSourceId !== undefined) {
        require('surface-title-source');
        titleSourceRefs.push({ id: surface.titleSourceId, path: `${p}/titleSourceId` });
        const containsSource = (nodes: CompositionNode[]): boolean => nodes.some(node =>
          node.type === 'bedroom-control' && node.props.sourceId === surface.titleSourceId
          || containsSource(compositionChildren(node)));
        if (!containsSource((kind === 'page' ? expanded.pages : kind === 'modal' ? expanded.modals : expanded.levels!)[index].components)) add('invalid_combination', `${p}/titleSourceId`);
      }
      if (surface.toolbar.type === 'replace') chrome(surface.toolbar.groups, `${p}/toolbar/groups`);
      else if (kind !== 'page') add('invalid_combination', `${p}/toolbar`);
      if (kind === 'page') {
        const { foldSides } = (surface as CompositionDocument['pages'][number]).layout;
        if (foldSides !== undefined) require('fold-sides');
        // `span` is Across the Top: it has to come before the first section that takes a side. The expanded page holds each place's own words, so a saved component counts as what it is.
        for (const late of lateSpans(expanded.pages[index].components)) add('invalid_combination', `${p}/components/${late}/layout/foldSide`);
      }
      if (kind === 'page') pageChrome(surface as CompositionDocument['pages'][number], index);
      onPage = kind === 'page';
      components(surface.components, `${p}/components`);
      onPage = false;
    });
  }
  surfaceKind = 'page';
  if (document.pages.length + document.modals.length + (document.levels?.length ?? 0) > 512) add('limit_exceeded', '/document/pages');
  if (document.modals.length) require('sheet');
  if (document.modals.some(modal => modal.presentation.height.type === 'fitted')) require('sheet-fit');
  chrome(document.navigation.chrome.groups, '/document/navigation/chrome/groups');
  const navigation = document.navigation;
  if (navigation.tabsVisibility !== undefined) require('tabs-visibility');
  if (document.bootstrap) {
    require('bootstrap-policy');
    const permissions = document.bootstrap.setup.map(step => step.permission);
    if (new Set(permissions).size !== 3 || permissions.indexOf('notifications') > permissions.indexOf('time-sensitive'))
      add('invalid_combination', '/document/bootstrap/setup');
  }
  if (navigation.tabs.length > 5) add('unsupported_capability', '/document/navigation/tabs', 'sh.extended-tabs@1');
  navigation.tabs.forEach((tab, i) => {
    register('tab', tab.id, `/document/navigation/tabs/${i}/id`);
    visibility(tab, `/document/navigation/tabs/${i}`);
    badge(tab.badge, `/document/navigation/tabs/${i}/badge`);
    refs.push({ kind: 'page', id: tab.pageId, path: `/document/navigation/tabs/${i}/pageId` });
  });
  refs.push({ kind: 'page', id: navigation.initialPageId, path: '/document/navigation/initialPageId' });
  if (navigation.initialTabId !== null) {
    refs.push({ kind: 'tab', id: navigation.initialTabId, path: '/document/navigation/initialTabId' });
    const tab = navigation.tabs.find(tab => tab.id === navigation.initialTabId);
    if (tab && tab.pageId !== navigation.initialPageId) add('invalid_combination', '/document/navigation/initialTabId');
  }
  const cameraEntities = new Set<string>();
  [...document.dataSources.map((source, i) => ({ source, path: `/document/dataSources/${i}` })), ...privateSources].forEach(({ source, path: p }) => {
    require('bindings');
    register('source', source.id, `${p}/id`);
    if (source.kind === 'model' && source.model === 'pipeline@1') {
      const found = checkPipelineSource(source, p);
      issues.push(...found.issues);
      for (const name of found.capabilities) capabilities.add(name);
      reads.push(...found.reads);
      dependencies.push(...found.dependencies);
      if (++pipelines > PIPELINE_LIMITS.pipelines) add('limit_exceeded', p);
      return;
    }
    if (source.kind === 'model' && ['home-status@1', 'home-weather@1', 'home-light@1'].includes(source.model)) {
      require(source.model.slice(0, -2));
      const entity = (value: string, path: string, domains: string[] = []) => {
        if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${path}/value`);
        else if (domains.length && !domains.includes(value.split('.')[0])) add('invalid_combination', `${path}/value`);
      };
      if (source.model === 'home-status@1') {
        const inputs = source.inputs, ids = inputs.entityIds.map(value => value.value);
        inputs.entityIds.forEach((value, i) => entity(value.value, `${p}/inputs/entityIds/${i}`));
        if (new Set(ids).size !== ids.length) add('invalid_combination', `${p}/inputs/entityIds`);
        if ((['entity', 'air-quality'].includes(inputs.projection) || inputs.format === 'item') && ids.length !== 1) add('invalid_combination', `${p}/inputs/entityIds`);
        if (inputs.rangeEntityId) entity(inputs.rangeEntityId.value, `${p}/inputs/rangeEntityId`);
        if (inputs.secondaryEntityId) entity(inputs.secondaryEntityId.value, `${p}/inputs/secondaryEntityId`, ['sensor', 'input_text']);
        if (inputs.alarmEntityId) entity(inputs.alarmEntityId.value, `${p}/inputs/alarmEntityId`, ['alarm_control_panel']);
        inputs.awayEntityIds.forEach((value, i) => entity(value.value, `${p}/inputs/awayEntityIds/${i}`, ['input_boolean', 'binary_sensor']));
        if (inputs.colorEntityId) entity(inputs.colorEntityId.value, `${p}/inputs/colorEntityId`, ['sensor', 'input_text']);
        const members = inputs.members ?? [];
        members.forEach((member, index) => entity(member.entityId.value, `${p}/inputs/members/${index}/entityId`, ['binary_sensor']));
        if (members.length && (inputs.projection !== 'contacts' || members.length !== ids.length
          || new Set(members.map(member => member.entityId.value)).size !== ids.length
          || members.some(member => !ids.includes(member.entityId.value)))) add('invalid_combination', `${p}/inputs/members`);
      } else if (source.model === 'home-weather@1') {
        entity(source.inputs.weatherEntityId.value, `${p}/inputs/weatherEntityId`, ['weather']);
        if (source.inputs.sunEntityId) entity(source.inputs.sunEntityId.value, `${p}/inputs/sunEntityId`, ['sun']);
        if (source.inputs.airQualityEntityId) entity(source.inputs.airQualityEntityId.value, `${p}/inputs/airQualityEntityId`, ['sensor']);
      } else if (source.model === 'home-light@1') {
        entity(source.inputs.entityId.value, `${p}/inputs/entityId`, ['light', 'switch', 'input_boolean']);
        const members = source.inputs.memberEntityIds ?? [];
        members.forEach((value, index) => entity(value.value, `${p}/inputs/memberEntityIds/${index}`, ['light', 'switch', 'input_boolean']));
        if (new Set(members.map(value => value.value)).size !== members.length) add('invalid_combination', `${p}/inputs/memberEntityIds`);
      }
      return;
    }
    if (source.kind === 'model' && source.model === 'app-state@1') { capabilities.add(APP_STATE_CAPABILITY); return; }
    if (source.kind === 'model' && source.model === 'climate@1') {
      require('climate-source'); validateClimateInputs(source.inputs, `${p}/inputs`, add); return;
    }
    if (source.kind === 'model' && source.model === 'room-navigation@1') {
      require('room-navigation');
      const literalEntity = (value: string, path: string, domain: string) => {
        if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${path}/value`);
        else if (!value.startsWith(`${domain}.`)) add('invalid_combination', `${path}/value`);
      };
      if (source.visitScriptEntityId) literalEntity(source.visitScriptEntityId.value, `${p}/visitScriptEntityId`, 'script');
      const ids = new Set<string>();
      source.items.forEach((item, index) => {
        const path = `${p}/items/${index}`;
        if (ids.has(item.id)) add('duplicate_id', `${path}/id`);
        ids.add(item.id);
        if (item.counterEntityId) literalEntity(item.counterEntityId.value, `${path}/counterEntityId`, 'counter');
        else if (source.ranking !== 'configured') add('invalid_combination', `${path}/counterEntityId`);
        if (Boolean(source.visitScriptEntityId) !== Boolean(item.visitKey)) add('invalid_combination', `${path}/visitKey`);
        roomVisibility(item.visibility, `${path}/visibility`);
        action(item.action, `${path}/action`);
      });
      return;
    }
    if (isRoomDeviceSource(source)) {
      require(source.model.slice(0, -2)); validateDeviceSource(source, p, add); return;
    }
    if (source.kind === 'model' && source.model === 'bedroom-provider@1') {
      require('bedroom-sources'); return;
    }
    if (isDeviceProvider(source)) {
      require(source.model.slice(0, -2));
      if (source.model === 'media-remote-config@1' && remoteUsesSpeakerTargets(source.inputs)) require('remote-speaker-targets');
      deviceProviderIssues(source).forEach(path => add('invalid_combination', `${p}/inputs${path}`));
      return;
    }
    if (source.kind === 'model' && source.model === 'media-remote@1') {
      require('media-remote'); return;
    }
    if (source.kind === 'model' && source.model === 'vacuum@1') {
      require('vacuum'); validateVacuumDescriptor(source.inputs, `${p}/inputs`, add);
      if (source.inputs.orientation) require('surface-orientation');
      return;
    }
    if (source.kind === 'model' && source.model === 'settings-provider@1') {
      require('settings-controls'); return;
    }
    if (source.kind === 'model' && source.model === 'profile-account@1') {
      require('profile-account');
      return;
    }
    if (source.kind === 'model' && source.model !== 'power-toggle@1') {
      if (source.model === 'inventory-list@1') { require('inventory-list'); return; }
      require(source.model.split('@')[0]);
      const literalEntity = (value: string, path: string, domain: string) => {
        if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${path}/value`);
        else if (!value.startsWith(`${domain}.`)) add('invalid_combination', `${path}/value`);
      };
      if (source.model === 'camera-stream@1') {
        literalEntity(source.inputs.entityId.value, `${p}/inputs/entityId`, 'camera');
        literalEntity(source.inputs.snapshotEntityId.value, `${p}/inputs/snapshotEntityId`, 'camera');
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(source.inputs.rtcStreamId)) add('invalid_value', `${p}/inputs/rtcStreamId`);
        if (cameraEntities.has(source.inputs.entityId.value)) add('invalid_combination', `${p}/inputs/entityId`);
        cameraEntities.add(source.inputs.entityId.value);
        if (source.inputs.recording.type === 'script') {
          literalEntity(source.inputs.recording.stateEntityId.value, `${p}/inputs/recording/stateEntityId`, 'input_boolean');
          literalEntity(source.inputs.recording.scriptEntityId.value, `${p}/inputs/recording/scriptEntityId`, 'script');
        }
      } else if (source.model === 'alarm-mode@1') literalEntity(source.inputs.entityId.value, `${p}/inputs/entityId`, 'alarm_control_panel');
      else if (source.model === 'security-door@1') literalEntity(source.inputs.entityId.value, `${p}/inputs/entityId`, source.inputs.kind === 'lock' ? 'lock' : 'cover');
      else if (source.model === 'household-away-status@1') literalEntity(source.inputs.entityId.value, `${p}/inputs/entityId`, 'sensor');
      else if (source.model === 'sprinkler-state@1') {
        const inputs = source.inputs;
        const fields = {
          stateEntityId: 'sensor', modeEntityId: 'select', batteryEntityId: 'sensor',
          faultEntityId: 'binary_sensor', nextWateringEntityId: 'sensor', hubConnectedEntityId: 'binary_sensor',
          rainDelayEntityId: 'switch', smartWateringEntityId: 'switch',
        } as const;
        for (const [field, domain] of Object.entries(fields))
          literalEntity(inputs[field as keyof typeof fields].value, `${p}/inputs/${field}`, domain);
        inputs.zones.forEach((zone, index) => {
          literalEntity(zone.valveEntityId.value, `${p}/inputs/zones/${index}/valveEntityId`, 'valve');
          literalEntity(zone.programEntityId.value, `${p}/inputs/zones/${index}/programEntityId`, 'switch');
          literalEntity(zone.historyEntityId.value, `${p}/inputs/zones/${index}/historyEntityId`, 'sensor');
        });
      } else if (source.model === 'inventory-summary@1') {
        if (source.inputs.expiringLocation && !source.inputs.expiringEntityId) add('invalid_combination', `${p}/inputs/expiringLocation`);
        literalEntity(source.inputs.totalEntityId.value, `${p}/inputs/totalEntityId`, 'sensor');
        if (source.inputs.expiringEntityId) literalEntity(source.inputs.expiringEntityId.value, `${p}/inputs/expiringEntityId`, 'sensor');
        source.inputs.spaceEntityIds.forEach((value, index) => literalEntity(value.value, `${p}/inputs/spaceEntityIds/${index}`, 'sensor'));
      } else if (source.model === 'todo-counts@1') {
        const seen = new Set<string>();
        source.inputs.lists.forEach((entry, index) => {
          const path = `${p}/inputs/lists/${index}/entityId`;
          literalEntity(entry.entityId.value, path, 'todo');
          if (seen.has(entry.entityId.value)) add('invalid_combination', `${path}/value`);
          seen.add(entry.entityId.value);
        });
      } else if (source.model === 'todo-collection@1') {
        const seen = new Set<string>();
        source.inputs.lists.forEach((entry, index) => {
          const base = `${p}/inputs/lists/${index}`;
          literalEntity(entry.entityId.value, `${base}/entityId`, 'todo');
          if (seen.has(entry.entityId.value)) add('invalid_combination', `${base}/entityId/value`);
          seen.add(entry.entityId.value);
          if (entry.completionScript) literalEntity(entry.completionScript.value, `${base}/completionScript`, 'script');
          visibility(entry, base);
          if (entry.visibleWhen !== undefined) {
            const rule = entry.visibleWhen;
            if (rule.type !== 'viewer' || rule.isAdmin !== undefined || !rule.userIds?.length) add('invalid_combination', `${base}/visibleWhen`);
            if (entry.whenUnknown !== 'hide') add('invalid_combination', `${base}/whenUnknown`);
          }
        });
        const action = source.inputs.addAction;
        if (action.type !== 'task') {
          literalEntity(action.entityId.value, `${p}/inputs/addAction/entityId`, 'todo');
          if (!seen.has(action.entityId.value)) add('invalid_reference', `${p}/inputs/addAction/entityId/value`);
        }
      }
      return;
    }
    if (source.kind !== 'ha-entity' && source.model !== 'power-toggle@1') {
      add('invalid_combination', p); return;
    }
    const power = source.kind === 'model';
    const value = source.kind === 'model' ? source.inputs.entityId : source.entityId;
    const path = `${p}/${power ? 'inputs/entityId' : 'entityId'}`;
    if (power) require('power-toggle');
    binding(value, 'entity-id', path, power);
    if (value.type === 'read') dependencies.push({ from: source.id, to: value.from.sourceId, path: `${path}/from/sourceId` });
  });
  for (const ref of refs) {
    if (catalogs.get(ref.kind)?.has(ref.id)) continue;
    // A `push` or a `page-id` argument may name a level (`sh.sheet-levels@1`); from a page, a chrome item or a `dismiss-then-push` it may not.
    if (ref.kind === 'page' && ref.from !== undefined && catalogs.get('level')?.has(ref.id)) {
      if (ref.from === 'page' || ref.from === 'leaving') add('invalid_combination', ref.path);
      continue;
    }
    add('invalid_reference', ref.path);
  }
  /**
   * An argument is checked as the field it fills: the expanded document is compiled and each issue at a bound field is reported at the reference's
   * `args/<name>`, with the code the field's own rule gave (a source of the wrong model is `binding_type`, a missing one `invalid_reference`).
   */
  function checkArgUses() {
    if (!argUses.length) return;
    let found: CompositionIssue[] = [];
    try { for (const name of compileCompositionDocument(plainDerivedIds(expanded)).capabilities) capabilities.add(name); }
    catch (error) { if (error instanceof CompositionValidationError) found = error.issues; else throw error; }
    const known = new Set(issues.map(issue => `${issue.code}\0${issue.pointer}`));
    for (const { ref, entry, path } of argUses) {
      const valued = new Set((entry.params ?? []).filter(param => param.kind === 'value').map(param => param.name));
      for (const binding of entry.bindings ?? []) {
        const inside = binding.nodeId === undefined ? undefined : findNodePath(entry.node, binding.nodeId);
        if (!inside || (valued.has(binding.param) ? ref.values?.[binding.param] : ref.args?.[binding.param]) === undefined) continue;
        const field = path + [...inside, ...binding.field.split('/').filter(Boolean)].map(step => `/${step}`).join('');
        for (const issue of found) {
          if (issue.pointer !== field && !issue.pointer.startsWith(`${field}/`)) continue;
          const at = pointer(`${path}/${valued.has(binding.param) ? 'values' : 'args'}`, binding.param);
          if (known.has(`${issue.code}\0${at}`)) continue;
          known.add(`${issue.code}\0${at}`);
          add(issue.code, at, issue.capability);
        }
      }
    }
  }
  const sources = new Map([...document.dataSources, ...privateSources.map(item => item.source)].map(source => [source.id, source]));
  for (const { props, path } of climateRefs) {
    const source = sources.get(props.sourceId);
    if (!source) add('invalid_reference', `${path}/sourceId`);
    else if (source.kind !== 'model' || source.model !== 'climate@1') add('binding_type', `${path}/sourceId`);
    else validateClimateControl(props, source.inputs, path, add);
  }
  for (const ref of powerRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'power-toggle@1') add(ref.code, ref.path);
  }
  for (const ref of alarmRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'alarm-mode@1') add('binding_type', ref.path);
  }
  for (const ref of doorRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'security-door@1' || source.inputs.kind !== ref.kind) add('binding_type', ref.path);
  }
  for (const ref of cameraRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'camera-stream@1') add('binding_type', ref.path);
    else if (ref.records && source.inputs.recording.type === 'disabled') add('invalid_combination', ref.path);
  }
  function videoSources(nodes: CompositionNode[]): string[] {
    return nodes.flatMap(node => node.type === 'camera-video' || node.type === 'camera-viewer'
      ? [node.props.sourceId] : videoSources(compositionChildren(node)));
  }
  document.modals.forEach((modal, index) => {
    if (!videoSources(expanded.modals[index].components).length) return;
    const path = `/document/modals/${index}/presentation`;
    if (modal.presentation.height.type !== 'full') add('invalid_combination', `${path}/height`);
    if (modal.presentation.width !== 'page') add('invalid_combination', `${path}/width`);
    if (modal.presentation.appearance !== 'dark') add('invalid_combination', `${path}/appearance`);
  });
  for (const ref of cameraPresentations) {
    const modal = expanded.modals.find(modal => modal.id === ref.modal);
    if (modal && !videoSources(modal.components).includes(ref.source)) add('invalid_combination', ref.path);
  }
  for (const ref of homeRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== ref.model) add('binding_type', ref.path);
  }
  for (const ref of overviewWords) {
    const source = sources.get(ref.sourceId);
    if (source?.kind !== 'model' || source.model !== 'home-status@1') continue;
    for (const problem of wordProblems(ref.words, overviewWordKeys(source.inputs.projection))) add(problem.code, `${ref.path}${problem.at}`);
  }
  for (const ref of expressionRefs) {
    const at = ref.pointer + (ref.kind === undefined ? '/sourceId' : '/from/sourceId');
    const source = sources.get(ref.sourceId);
    if (!source) { add('invalid_reference', at); continue; }
    // `raw-state` and the list reads stand on an entity only; a list read also needs one of its attributes.
    if (ref.entityOnly && source.kind !== 'ha-entity') { add('binding_type', at); continue; }
    if (ref.entityOnly === 'list' && (ref.path.length < 2 || ref.path[0] !== 'attributes')) { add('invalid_reference', `${ref.pointer}/from/path`); continue; }
    if (source.kind !== 'ha-entity') {
      // Any model that has read fields can be read by an operand or a condition, through the same vocabulary as a slot read.
      if (source.kind !== 'model' || !modelReadFields(source) && source.model !== 'pipeline@1') { add('binding_type', at); continue; }
      const found = checkModelRead(source, ref.path, ref.kind);
      if (found && 'capability' in found) capabilities.add(found.capability);
      else if (found) add(found.code, `${ref.pointer}${found.suffix}`);
      continue;
    }
    if (ref.path.length === 1 && ref.path[0] === 'state') { if (ref.kind === 'boolean') add('binding_type', `${ref.pointer}/as`); }
    else if (ref.path.length < 2 || ref.path[0] !== 'attributes') add('invalid_reference', ref.pointer + (ref.kind === undefined ? '/path' : '/from/path'));
  }
  for (const ref of optimisticRefs) {
    const source = sources.get(ref.sourceId);
    if (!source) add('invalid_reference', ref.pointer);
    else if (source.kind !== 'ha-entity') add('binding_type', ref.pointer);
  }
  for (const ref of visibilityRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'ha-entity' && !(source.kind === 'model' && source.model === 'home-status@1')) add('binding_type', ref.path);
  }
  for (const ref of homePowerRefs) {
    const status = sources.get(ref.status), power = sources.get(ref.power);
    if (status?.kind !== 'model' || status.model !== 'home-status@1' || power?.kind !== 'model' || power.model !== 'home-light@1') continue;
    const members = power.inputs.memberEntityIds?.length ? power.inputs.memberEntityIds : [power.inputs.entityId];
    if (status.inputs.projection !== 'lights' || status.inputs.format !== 'room'
        || status.inputs.entityIds.length !== members.length
        || !status.inputs.entityIds.every(id => members.some(member => member.value === id.value))
        || (status.inputs.rangeEntityId?.value ?? status.inputs.entityIds[0]?.value) !== power.inputs.entityId.value)
      add('invalid_combination', ref.path);
  }
  for (const ref of roomRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (ref.navigation ? source.kind !== 'model' || source.model !== 'room-navigation@1' : source.kind !== 'ha-entity')
      add('binding_type', ref.path);
  }
  for (const { control, path } of deviceRefs) {
    const source = sources.get(control.binding.sourceId);
    if (!source) add('invalid_reference', `${path}/binding/sourceId`);
    else if (!isRoomDeviceSource(source) || source.model !== deviceControlModel(control.props.control)) add('binding_type', `${path}/binding/sourceId`);
    else if (source.model === 'grill@1' && !source.inputs.details.some(detail => detail.entityId === control.props.detailEntityId))
      add('invalid_reference', `${path}/props/detailEntityId`);
  }
  for (const ref of titleSourceRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'bedroom-provider@1'
      || !['bed-alarm-draft', 'wake-alarm-draft'].includes(source.inputs.kind)) add('binding_type', ref.path);
  }
  for (const ref of bedroomRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'bedroom-provider@1' || !ref.providers.includes(source.inputs.kind))
      add('binding_type', ref.path);
  }
  for (const ref of remoteRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'media-remote@1') add('binding_type', ref.path);
  }
  for (const { control, path } of providerControls) {
    const source = sources.get(control.props.sourceId);
    if (!source) { add('invalid_reference', `${path}/sourceId`); continue; }
    if (!isDeviceProvider(source)) { add('binding_type', `${path}/sourceId`); continue; }
    if (control.type === 'custom-light-control' && source.model === 'custom-lights@1') {
      for (const field of ['entityId', 'copySourceId'] as const) {
        const id = field in control.props ? (control.props as Partial<Record<typeof field, string>>)[field] : undefined;
        if (id && !source.inputs.lights.some(light => light.entityId === id)) add('invalid_reference', `${path}/${field}`);
      }
      if (control.props.kind === 'copy-color' && control.props.entityId === control.props.copySourceId)
        add('invalid_combination', `${path}/copySourceId`);
    } else if (control.type === 'sprinkler-control' && source.model === 'sprinkler-controller@1') {
      if ('zone' in control.props && control.props.zone >= source.inputs.controller.zones.length)
        add('invalid_reference', `${path}/zone`);
    } else add('binding_type', `${path}/sourceId`);
  }
  for (const { control, path } of vacuumRefs) {
    const source = sources.get(control.props.sourceId);
    if (!source) add('invalid_reference', `${path}/sourceId`);
    else if (source.kind !== 'model' || source.model !== 'vacuum@1') add('binding_type', `${path}/sourceId`);
    else validateVacuumControl(control, source.inputs, path, add);
  }
  for (const ref of profileRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'profile-account@1') add('binding_type', ref.path);
  }
  for (const ref of settingsRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== 'settings-provider@1' || source.inputs.domain !== settingsDomain(ref.kind))
      add('binding_type', ref.path);
  }
  for (const ref of providerRefs) {
    const source = sources.get(ref.id);
    if (source?.kind === 'model' && source.model === 'pipeline@1') issues.push(...checkPipelineProvider(source.inputs, ref.node, ref.path));
  }
  for (const { read, path } of reads) {
    const source = sources.get(read.from.sourceId), segments = read.from.path;
    if (!source) { add('invalid_reference', `${path}/from/sourceId`); continue; }
    if (source.kind === 'model' && source.model === 'bedroom-provider@1') {
      if (!['bed-side', 'wake-light'].includes(source.inputs.kind) || segments.length !== 1 || !['stateText', 'phase'].includes(segments[0]))
        add('invalid_reference', `${path}/from/path`);
      else if (read.as !== 'string') add('binding_type', `${path}/as`);
      continue;
    }
    if (source.kind === 'ha-entity') {
      if (segments.length === 1 && segments[0] === 'state') {
        if (read.as !== 'string') add('binding_type', `${path}/as`);
      } else if (segments.length < 2 || segments[0] !== 'attributes') add('invalid_reference', `${path}/from/path`);
    } else if (isRoomDeviceSource(source)) {
      if (segments.length !== 1 || !['stateText', 'phase'].includes(segments[0])) add('invalid_reference', `${path}/from/path`);
      else if (read.as !== 'string') add('binding_type', `${path}/as`);
    } else if (source.model === 'pipeline@1') {
      const found = checkPipelineRead(source.inputs, segments, read.as);
      if (found) add(found.code, `${path}${found.suffix}`);
    } else if (source.model === 'media-remote@1' || isDeviceProvider(source)) {
      add('invalid_reference', `${path}/from/path`);
    } else if (source.model === 'profile-account@1' || source.model === 'settings-provider@1' || source.model === 'todo-collection@1') {
      add('invalid_reference', `${path}/from/path`);
    } else {
      if (source.model === 'room-navigation@1') { add('invalid_reference', `${path}/from/path`); continue; }
      const found = checkModelRead(source, segments, read.as);
      if (found && 'capability' in found) capabilities.add(found.capability);
      else if (found) add(found.code, `${path}${found.suffix}`);
    }
  }
  for (const edge of dependencies) {
    const pending = [edge.to], seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === edge.from) { add('invalid_combination', edge.path); break; }
      if (!seen.has(id)) { seen.add(id); pending.push(...dependencies.filter(item => item.from === id).map(item => item.to)); }
    }
  }
  const background = document.theme.background;
  if (background.type === 'downloaded') {
    require('assets.publisher');
    const asset = document.assets.find(asset => asset.id === background.assetId);
    if (!asset) add('invalid_reference', '/document/theme/background/assetId');
    else if (asset.role !== 'backdrop') add('invalid_combination', '/document/theme/background/assetId');
    const scrim = background.scrim;
    if (scrim.type === 'gradient') scrim.stops.forEach((stop, i, stops) => {
      if (i > 0 && stop.location <= stops[i - 1].location) add('invalid_value', `/document/theme/background/scrim/stops/${i}/location`);
      if (stop.opacity + scrim.increasedContrastBoost > 1) add('invalid_value', `/document/theme/background/scrim/stops/${i}/opacity`);
    });
  }
  document.assets.forEach((asset, i) => {
    require('assets.publisher'); register('asset', asset.id, `/document/assets/${i}/id`);
    const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
    if (asset.source.path !== `/api/assets/${asset.sha256}.${extension}`) add('invalid_value', `/document/assets/${i}/source/path`);
    if (asset.pixelWidth * asset.pixelHeight > 16000000) add('limit_exceeded', `/document/assets/${i}/pixelWidth`);
    if (background.type !== 'downloaded' || asset.id !== background.assetId) add('invalid_reference', `/document/assets/${i}`);
  });
  if (document.assets.map(asset => asset.id).join('\0') !== document.assets.map(asset => asset.id).sort().join('\0')) add('invalid_value', '/document/assets');
  checkArgUses();
  validateChromeContexts(expanded, add);
  if (issues.length) throw new CompositionValidationError(issues);
  return { document, capabilities: [...capabilities].sort() };
}

function validateChromeContexts(document: CompositionDocument, add: (code: CompositionIssue['code'], path: string) => void) {
  const pages = new Map(document.pages.map((page, index) => [page.id, { page, index }]));
  const levels = new Map((document.levels ?? []).map((level, index) => [level.id, { page: level, index, kind: 'levels' as const }]));
  const effective = (toolbar: CompositionDocument['pages'][number]['toolbar'], inherited: CompositionGroups) =>
    toolbar.type === 'replace' ? toolbar.groups : inherited;
  const visible = (groups: CompositionGroups, root: boolean, shell: boolean) => groups.flatMap(group => group.items)
    .filter(item => item.type === 'shell-menu' ? root && shell : root || item.visibility === 'always');
  const chromeActions = (groups: CompositionGroups, root: boolean): CompositionAction[] => groups.flatMap(group => group.items)
    .flatMap(item => item.type === 'shell-header' && (root || item.visibility === 'always')
      ? [item.quickLinksAction, item.profileAction] : item.type === 'button' && (root || item.visibility === 'always') ? plainActions(item.action, '').map(entry => entry.action) : []);
  function actions(nodes: CompositionNode[]): CompositionAction[] {
    return nodes.flatMap(node => {
      const own: CompositionAction[] = 'action' in node && node.action ? plainActions(node.action as ActionSlot, '').map(entry => entry.action) : [];
      if (node.type === 'row-collection' && node.props.rowAction) own.push(...plainActions(node.props.rowAction, '').map(entry => entry.action));
      if (node.type === 'settings-control' && node.props.destination) own.push(node.props.destination);
      if ((node.type === 'room-card' || node.type === 'room-chip') && node.props.action) own.push(node.props.action);
      if ((node.type === 'bedroom-control' || node.type === 'custom-light-control' || node.type === 'sprinkler-control')
        && 'action' in node.props && node.props.action) own.push(node.props.action);
      if (node.type === 'room-navigation-grid') {
        const source = document.dataSources.find(source => source.id === node.binding.sourceId);
        if (source?.kind === 'model' && source.model === 'room-navigation@1') own.push(...source.items.map(item => item.action));
      }
      if (node.type === 'room-device-control' && node.props.modalId)
        own.push({ type: 'present', modalId: node.props.modalId, arguments: {}, ifPresented: 'reject' });
      if (node.type === 'remote-control' && node.props.kind === 'card') own.push(node.props.action);
      if (node.type === 'vacuum-control') {
        const primitive = node.props.primitive;
        if (primitive.kind === 'target' || primitive.kind === 'report' || primitive.kind === 'card') own.push(primitive.destination);
        if (primitive.kind === 'area-editor') own.push(primitive.onUse, primitive.onDiscard);
        if (primitive.kind === 'map') for (const group of primitive.controls ?? []) for (const button of group.buttons)
          if (button.action.type !== 'map' && button.action.type !== 'source-command') own.push(button.action);
      }
      return [...own, ...actions(compositionChildren(node))];
    });
  }
  document.pages.forEach((page, i) => {
    if (page.toolbar.type === 'replace' && visible(page.toolbar.groups, true, true).length > 12) add('limit_exceeded', `/document/pages/${i}/toolbar`);
  });
  const roots = new Set([document.navigation.initialPageId, ...document.navigation.tabs.map(tab => tab.pageId)]);
  for (const id of roots) {
    const entry = pages.get(id);
    if (!entry) continue;
    const items = effective(entry.page.toolbar, document.navigation.chrome.groups).flatMap(group => group.items);
    if (items.length > 12) add('limit_exceeded', `/document/pages/${entry.index}/toolbar`);
    if (items.filter(item => item.type === 'shell-menu').length !== 1) add('invalid_combination', `/document/pages/${entry.index}/toolbar`);
  }
  const exits = new Map<string, Set<string>>();
  document.modals.forEach((modal, index) => {
    const groups = effective(modal.toolbar, []);
    if (visible(groups, true, false).length + 1 > 12) add('limit_exceeded', `/document/modals/${index}/toolbar`);
    const pending = [...actions(modal.components), ...chromeActions(groups, true)], seen = new Set<string>();
    while (pending.length) {
      const intent = pending.pop()!;
      if (intent.type === 'dismiss-then-push') {
        const destinations = exits.get(modal.id) ?? new Set<string>();
        destinations.add(intent.destination.pageId); exits.set(modal.id, destinations);
      }
      if (intent.type !== 'push' || seen.has(intent.pageId)) continue;
      seen.add(intent.pageId);
      const page = pages.get(intent.pageId), level = levels.get(intent.pageId);
      const entry = page ? { ...page, kind: 'pages' as const } : level;
      if (!entry) continue;
      const childGroups = effective(entry.page.toolbar, groups);
      const hostItems = modal.presentation.close.visibility === 'all-depths' ? 2 : 1;
      if (visible(childGroups, false, false).length + hostItems > 12) add('limit_exceeded', `/document/${entry.kind}/${entry.index}/toolbar`);
      pending.push(...actions(entry.page.components), ...chromeActions(childGroups, false));
    }
  });
  for (const root of roots) {
    const pending = [root], seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = pages.get(id);
      if (!entry) continue;
      const atRoot = id === root, groups = effective(entry.page.toolbar, document.navigation.chrome.groups);
      if (visible(groups, atRoot, true).length + (atRoot ? 0 : 1) > 12) add('limit_exceeded', `/document/pages/${entry.index}/toolbar`);
      for (const intent of [...actions(entry.page.components), ...chromeActions(groups, atRoot)]) {
        if (intent.type === 'push') pending.push(intent.pageId);
        else if (intent.type === 'present') pending.push(...(exits.get(intent.modalId) ?? []));
      }
    }
  }
}
