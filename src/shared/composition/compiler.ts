import { z } from 'zod/v4';
import { boundControlActions, boundControlProps, kindDependentActions, kindDependentProps } from './bound-control';
import { settingsDomain, settingsDestination, settingsItem, settingsFixedItems, type SettingsKind } from './settings';
import { climateCapabilities, climateCapability, validateClimateControl, validateClimateInputs, type ClimateProps } from './climate';
import { compositionChildren, compositionDocumentSchema, type CompositionAction, type CompositionDocument, type CompositionGroups,
  type CompositionNode, type CompositionRead, type CompositionValue } from './schema';
import { assertCompositionBounds, canonicalCompositionJSON, CompositionValidationError, MAX_COMPOSITION_BYTES,
  pointer, reject, type CompositionIssue } from './json';
import { acceptsLocalValue, initialLocalValue } from './shell';
import { deviceControlModel, isRoomDeviceSource, validateDeviceControl, validateDeviceSource, type RoomDeviceControl } from './room-devices';
import { bedroomCapabilities, bedroomProviders, bedroomWeekdays } from './bedroom';
import { remoteCapabilities, remoteControlIssues } from './remote';
import { deviceProviderCapabilities, isDeviceProvider, deviceProviderIssues, remoteUsesSpeakerTargets } from './device-providers';
import { checkCallService, checkOperand, checkPredicate, type CallService, type ExpressionFacts, type Predicate, type WhenUnknown } from './expression';
import { vacuumCapabilities, vacuumPrimitiveCapabilities, validateVacuumControl, validateVacuumDescriptor, type VacuumControl } from './vacuum';

export const firstSliceCapabilities = [
  'sh.actions.navigation@1', 'sh.assets.publisher@1', 'sh.backdrop@1', 'sh.bindings@1', 'sh.chrome@1',
  'sh.composition@1', 'sh.grid@1', 'sh.page@1', 'sh.power-toggle@1', 'sh.sheet@1', 'sh.shell@1',
  'sh.symbols@1', 'sh.text@1', 'sh.tiles@1',
] as const;
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
  'sh.todo-collection@1',
];
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
/** A route's `visibleWhen` may use `viewer` and the combinators only: the route catalog is built without entity state. */
function asksOnlyAboutViewer(predicate: Predicate): boolean {
  switch (predicate.type) {
    case 'viewer': return true;
    case 'not': return asksOnlyAboutViewer(predicate.of);
    case 'all': case 'any': return predicate.of.every(asksOnlyAboutViewer);
    default: return false;
  }
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
      if (record(owner) && typeof owner.type === 'string' && unsupported[owner.type]) {
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

/** Pure first-slice compiler. No requests, actions, asset-byte checks, or native fidelity claims. */
export function compileCompositionDocument(input: unknown): { document: CompositionDocument; capabilities: string[] } {
  assertCompositionBounds(input);
  if (record(input) && input.schemaVersion !== undefined && input.schemaVersion !== '2.0') reject('unsupported_schema', '/document/schemaVersion');
  if (new TextEncoder().encode(canonicalCompositionJSON(input)).byteLength > MAX_COMPOSITION_BYTES) reject('limit_exceeded', '/document');
  let document: CompositionDocument;
  try { document = parseCompositionShape(compositionDocumentSchema, input); }
  catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    throw new CompositionValidationError(error.issues.map(issue => ({ ...issue, pointer: `/document${issue.pointer}` })));
  }
  const issues: CompositionIssue[] = [];
  const capabilities = new Set<string>(['sh.composition@1', 'sh.shell@1', 'sh.backdrop@1', 'sh.chrome@1', 'sh.page@1', 'sh.symbols@1']);
  const add = (code: CompositionIssue['code'], path: string, capability?: string) => {
    issues.push({ code, pointer: path, ...(capability ? { capability } : {}) });
  };
  const require = (name: string) => capabilities.add(`sh.${name}@1`);
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
  const refs: { kind: string; id: string; path: string }[] = [];
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
  const powerRefs: { id: string; path: string; code: CompositionIssue['code'] }[] = [];
  const alarmRefs: { id: string; path: string }[] = [];
  const homeRefs: { id: string; model: string; path: string }[] = [];
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
  const expressionRefs: ExpressionFacts['references'] = [];
  const optimisticRefs: ExpressionFacts['optimisticReferences'] = [];
  type Visibility = { visibleWhen?: Predicate; whenUnknown?: WhenUnknown };
  /** Folds an expression walk's issues, source references and capability needs into this compile. */
  function absorb(facts: ExpressionFacts) {
    issues.push(...facts.issues);
    expressionRefs.push(...facts.references);
    optimisticRefs.push(...facts.optimisticReferences);
    if (facts.usedOperands) require('operands');
    if (facts.references.length || facts.optimisticReferences.length) require('bindings');
  }
  function useCall(call: CallService, path: string, control: boolean) { require('call-service'); absorb(checkCallService(call, path, control)); }
  function usePredicate(predicate: Predicate, path: string) { absorb(checkPredicate(predicate, path)); }
  /** A node's or tab's `visibleWhen`; its policy means nothing without one. */
  function visibility(item: Visibility, path: string) {
    if (item.visibleWhen === undefined) { if (item.whenUnknown !== undefined) add('invalid_combination', `${path}/whenUnknown`); return; }
    require('visible-when'); usePredicate(item.visibleWhen, `${path}/visibleWhen`);
  }
  /** Containers that lay their children out themselves cannot let one of them go (a gap, a separator or an empty page). */
  function forbidRules(children: CompositionNode[], path: string) {
    children.forEach((child, index) => { if ((child as Visibility).visibleWhen !== undefined) add('invalid_combination', `${path}/${index}/visibleWhen`); });
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
  function action(value: CompositionAction, path: string) {
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
      return;
    }
    require('actions.navigation');
    switch (value.type) {
      case 'push': refs.push({ kind: 'page', id: value.pageId, path: `${path}/pageId` }); break;
      case 'present':
        if (value.ifPresented === 'replace') require('modal-handoff');
        refs.push({ kind: 'modal', id: value.modalId, path: `${path}/modalId` });
        break;
      case 'select-tab': refs.push({ kind: 'tab', id: value.tabId, path: `${path}/tabId` }); break;
      case 'dismiss-then-push': action(value.destination, `${path}/destination`); break;
    }
  }
  function chrome(groups: CompositionGroups, path: string) {
    groups.forEach((group, i) => {
      register('group', group.id, `${path}/${i}/id`);
      if (group.items.some(item => item.type === 'shell-header') &&
        (group.placement !== 'trailing' || group.items.length !== 1 || groups.filter(group => group.placement === 'trailing').length !== 1))
        add('invalid_combination', `${path}/${i}`);
      group.items.forEach((item, j) => {
        register('item', item.id, `${path}/${i}/items/${j}/id`);
        if (item.type === 'button') action(item.action, `${path}/${i}/items/${j}/action`);
        if (item.type === 'shell-header') {
          require('shell-header');
          if (item.quickLinksAction.type !== 'present') add('invalid_combination', `${path}/${i}/items/${j}/quickLinksAction`);
          if (item.profileAction.type !== 'present') add('invalid_combination', `${path}/${i}/items/${j}/profileAction`);
          action(item.quickLinksAction, `${path}/${i}/items/${j}/quickLinksAction`);
          action(item.profileAction, `${path}/${i}/items/${j}/profileAction`);
        }
      });
    });
  }
  let nodes = 0;
  function components(items: CompositionNode[], path: string, depth = 1, grid = false) {
    if (depth === 1) {
      if (items.filter(item => item.type === 'local-tabs' && item.props.scopeProviderId).length > 1) add('invalid_combination', path);
      const pinnedTabs = items.filter(item => item.type === 'local-tabs' && item.props.pinned).length;
      if (pinnedTabs > 1 || (pinnedTabs > 0 && items.some(item => item.type === 'pinned-actions' || item.type === 'form'))) add('invalid_combination', path);
      for (const kind of ['form', 'pinned-actions']) {
        if (items.filter(item => item.type === kind).length > 1) add('invalid_combination', path);
      }
    }
    items.forEach((item, index) => {
      const p = `${path}/${index}`;
      if (++nodes > 4096 || depth > 12) add('limit_exceeded', p);
      register('node', item.id, `${p}/id`);
      visibility(item as Visibility, p);
      if (!grid && item.layout.span !== 1) add('invalid_combination', `${p}/layout/span`);
      if (depth > 1 && ['form', 'pinned-actions'].includes(item.type)) add('invalid_combination', `${p}/type`);
      switch (item.type) {
        case 'info-box':
          require('info-box'); binding(item.props.message, 'string', `${p}/props/message`); break;
        case 'status-pill':
          require('status-pill'); binding(item.props.value, 'string', `${p}/props/value`);
          binding(item.props.detail, 'string', `${p}/props/detail`); break;
        case 'paged-row':
          require('paged-row'); components(item.children, `${p}/children`, depth + 1); forbidRules(item.children, `${p}/children`); break;
        case 'section':
          require('section');
          if (item.props.presentationProviderId) require('presentation-providers');
          if (item.props.style === 'module-list') item.children.forEach((child, index) => {
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
              add('invalid_combination', `${p}/children/${index}/type`);
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
            if (item.action.type === 'domain') add('invalid_combination', `${p}/action/type`);
            action(item.action, `${p}/action`);
          }
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
            if (item.tabs.some(tab => !tab.icon)) add('invalid_combination', `${p}/tabs`);
          }
          const field = localFields.get(item.props.stateId);
          if (!field) add('invalid_reference', `${p}/props/stateId`);
          else if (field.type !== 'choice') add('binding_type', `${p}/props/stateId`);
          else if (field.options.map(option => option.id).join('\0') !== item.tabs.map(tab => tab.id).join('\0') ||
                   field.options.map(option => option.label).join('\0') !== item.tabs.map(tab => tab.label).join('\0'))
            add('invalid_combination', `${p}/props/stateId`);
          if (new Set(item.tabs.map(tab => tab.id)).size !== item.tabs.length) add('duplicate_id', `${p}/tabs`);
          if (item.props.automatic) {
            require('selected-when');
            item.props.automatic.forEach((rule, index) => {
              if (!item.tabs.some(tab => tab.id === rule.tabId)) add('invalid_reference', `${p}/props/automatic/${index}/tabId`);
              usePredicate(rule.selectedWhen, `${p}/props/automatic/${index}/selectedWhen`);
            });
            if (item.props.scopeProviderId) add('invalid_combination', `${p}/props/automatic`);
          }
          item.tabs.forEach((tab, index) => components(tab.children, `${p}/tabs/${index}/children`, depth + 1));
          break;
        }
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
          if (props.isOn) usePredicate(props.isOn, `${p}/props/isOn`);
          if (props.value) absorb(checkOperand(props.value, `${p}/props/value`, false));
          if (props.range && (props.range.min >= props.range.max || (props.range.max - props.range.min) % props.range.step !== 0))
            add('invalid_value', `${p}/props/range`);
          if (props.format !== undefined && !props.format.includes('{value}')) add('invalid_value', `${p}/props/format`);
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
          if (item.action.type === 'domain') add('invalid_combination', `${p}/action/type`);
          action(item.action, `${p}/action`); break;
        case 'row-collection': require('row-collection'); break;
        case 'collection':
          require('collection');
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
          (item.children ?? []).forEach((child, index) => {
            const settingsPrimary = child.type === 'settings-control' && [
              'vacation-confirm', 'solo-confirm', 'feedback-submit', 'feedback-stop', 'performance-action', 'location-action', 'ha-settings',
            ].includes(child.props.kind);
            if (child.type !== 'primary-button' && !settingsPrimary) add('invalid_combination', `${p}/children/${index}/type`);
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
          item.children.forEach((child, i) => {
            if (child.type !== 'status-chip' && child.type !== 'room-chip') add('invalid_combination', `${p}/children/${i}/type`);
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
              if (item.type === 'room-overview-tile' && state.appearance.glyph) add('invalid_combination', `${p}/props/states/${index}/appearance/glyph`);
            });
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
          break;
        case 'light-group-tile':
          require('light-group-tile'); require('home-light'); require('bindings');
          homeRefs.push({ id: item.props.sourceId, model: 'home-light@1', path: `${p}/props/sourceId` }); break;
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
        case 'text':
          require('text');
          if (['subheadline', 'footnote'].includes(item.props.style)) require('supporting-text-styles');
          if (item.props.style === 'section-title') require('section-title');
          binding(item.props.value, 'string', `${p}/props/value`);
          break;
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
          components(item.children, `${p}/children`, depth + 1, true); break;
        case 'navigation-tile':
          require('tiles');
          if (item.props.titleProviderId || !['neutral', 'lights'].includes(item.props.family)) require('collection-navigation');
          roomVisibility(item.props.roomVisibility, `${p}/props/roomVisibility`);
          if (item.props.presentation || item.props.selected === 'none') require('tile-presentation');
          if (item.props.presentation?.fill.type === 'solid-rgb' && item.props.family !== 'neutral')
            add('invalid_combination', `${p}/props/family`);
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
          binding(item.props.subtitle, 'string', `${p}/props/subtitle`); action(item.action, `${p}/action`); break;
        case 'action-tile':
          require('tiles'); require('bindings'); require('power-toggle');
          if (item.props.powerLabels || item.props.family === 'occupancy') require('power-labels');
          powerRefs.push({ id: item.binding.sourceId, path: `${p}/binding/sourceId`, code: 'binding_type' });
          if (item.binding.sourceId !== item.action.sourceId) add('invalid_combination', `${p}/action/sourceId`);
          action(item.action, `${p}/action`); break;
      }
    });
  }
  for (const [kind, surfaces] of [['page', document.pages], ['modal', document.modals]] as const) {
    surfaces.forEach((surface, index) => {
      const p = `/document/${kind}s/${index}`;
      register('surface', surface.id, `${p}/id`); register(kind, surface.id, `${p}/id`);
      if (surface.titleSourceId !== undefined) {
        require('surface-title-source');
        titleSourceRefs.push({ id: surface.titleSourceId, path: `${p}/titleSourceId` });
        const containsSource = (nodes: CompositionNode[]): boolean => nodes.some(node =>
          node.type === 'bedroom-control' && node.props.sourceId === surface.titleSourceId
          || containsSource(compositionChildren(node)));
        if (!containsSource(surface.components)) add('invalid_combination', `${p}/titleSourceId`);
      }
      if (surface.toolbar.type === 'replace') chrome(surface.toolbar.groups, `${p}/toolbar/groups`);
      else if (kind === 'modal') add('invalid_combination', `${p}/toolbar`);
      components(surface.components, `${p}/components`);
    });
  }
  if (document.pages.length + document.modals.length > 512) add('limit_exceeded', '/document/pages');
  if (document.modals.length) require('sheet');
  if (document.modals.some(modal => modal.presentation.height.type === 'fitted')) require('sheet-fit');
  chrome(document.navigation.chrome.groups, '/document/navigation/chrome/groups');
  const navigation = document.navigation;
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
    refs.push({ kind: 'page', id: tab.pageId, path: `/document/navigation/tabs/${i}/pageId` });
  });
  refs.push({ kind: 'page', id: navigation.initialPageId, path: '/document/navigation/initialPageId' });
  if (navigation.initialTabId !== null) {
    refs.push({ kind: 'tab', id: navigation.initialTabId, path: '/document/navigation/initialTabId' });
    const tab = navigation.tabs.find(tab => tab.id === navigation.initialTabId);
    if (tab && tab.pageId !== navigation.initialPageId) add('invalid_combination', '/document/navigation/initialTabId');
  }
  const cameraEntities = new Set<string>();
  document.dataSources.forEach((source, i) => {
    require('bindings');
    const p = `/document/dataSources/${i}`;
    register('source', source.id, `${p}/id`);
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
      require('vacuum'); validateVacuumDescriptor(source.inputs, `${p}/inputs`, add); return;
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
  for (const ref of refs) if (!catalogs.get(ref.kind)?.has(ref.id)) add('invalid_reference', ref.path);
  const sources = new Map(document.dataSources.map(source => [source.id, source]));
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
    if (!videoSources(modal.components).length) return;
    const path = `/document/modals/${index}/presentation`;
    if (modal.presentation.height.type !== 'full') add('invalid_combination', `${path}/height`);
    if (modal.presentation.width !== 'page') add('invalid_combination', `${path}/width`);
    if (modal.presentation.appearance !== 'dark') add('invalid_combination', `${path}/appearance`);
  });
  for (const ref of cameraPresentations) {
    const modal = document.modals.find(modal => modal.id === ref.modal);
    if (modal && !videoSources(modal.components).includes(ref.source)) add('invalid_combination', ref.path);
  }
  for (const ref of homeRefs) {
    const source = sources.get(ref.id);
    if (!source) add('invalid_reference', ref.path);
    else if (source.kind !== 'model' || source.model !== ref.model) add('binding_type', ref.path);
  }
  for (const ref of expressionRefs) {
    const at = ref.pointer + (ref.kind === undefined ? '/sourceId' : '/from/sourceId');
    const source = sources.get(ref.sourceId);
    if (!source) { add('invalid_reference', at); continue; }
    if (source.kind !== 'ha-entity') { add('binding_type', at); continue; }
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
    } else if (source.model === 'media-remote@1' || isDeviceProvider(source)) {
      add('invalid_reference', `${path}/from/path`);
    } else if (source.model === 'profile-account@1' || source.model === 'settings-provider@1' || source.model === 'todo-collection@1') {
      add('invalid_reference', `${path}/from/path`);
    } else {
      if (source.model === 'room-navigation@1') { add('invalid_reference', `${path}/from/path`); continue; }
      const fields: Record<string, string> = source.model === 'power-toggle@1'
        ? { stateText: 'string', isOn: 'boolean', phase: 'string', isError: 'boolean' }
        : source.model === 'inventory-summary@1' || source.model === 'todo-counts@1'
          ? { stateText: 'string', phase: 'string' }
        : source.model === 'home-status@1' ? { stateText: 'string', phase: 'string', state: 'string', isActive: 'boolean' }
        : source.model === 'climate@1' && source.inputs.tracking ? {
          phase: 'string', selectedCount: 'number', criticalCount: 'number', occupiedOnlyCount: 'number',
          totalRooms: 'number', selectedEnabled: 'boolean', criticalEnabled: 'boolean',
        }
        : source.model === 'sprinkler-state@1' ? {
          status: 'string', mode: 'string', phase: 'string', batteryPercent: 'number', batteryLow: 'boolean',
          fault: 'boolean', hubConnected: 'boolean', watering: 'boolean', available: 'boolean',
          rainDelay: 'boolean', smartWatering: 'boolean',
        }
        : source.model === 'vacuum@1' ? { stateText: 'string', batteryText: 'string', phase: 'string' }
        : source.model === 'household-away-status@1' ? { mode: 'string', state: 'string', phase: 'string' }
        : source.model === 'camera-stream@1' ? { stateText: 'string', phase: 'string' }
        : source.model === 'alarm-mode@1' || source.model === 'security-door@1' || source.model === 'climate@1'
          ? { phase: 'string' } : {};
      if (segments.length !== 1 || !Object.hasOwn(fields, segments[0])) add('invalid_reference', `${path}/from/path`);
      else if (fields[segments[0]] !== read.as) add('binding_type', `${path}/as`);
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
  validateChromeContexts(document, add);
  if (issues.length) throw new CompositionValidationError(issues);
  return { document, capabilities: [...capabilities].sort() };
}

function validateChromeContexts(document: CompositionDocument, add: (code: CompositionIssue['code'], path: string) => void) {
  const pages = new Map(document.pages.map((page, index) => [page.id, { page, index }]));
  const effective = (toolbar: CompositionDocument['pages'][number]['toolbar'], inherited: CompositionGroups) =>
    toolbar.type === 'replace' ? toolbar.groups : inherited;
  const visible = (groups: CompositionGroups, root: boolean, shell: boolean) => groups.flatMap(group => group.items)
    .filter(item => item.type === 'shell-menu' ? root && shell : root || item.visibility === 'always');
  const chromeActions = (groups: CompositionGroups, root: boolean): CompositionAction[] => groups.flatMap(group => group.items)
    .flatMap(item => item.type === 'shell-header' && (root || item.visibility === 'always')
      ? [item.quickLinksAction, item.profileAction] : item.type === 'button' && (root || item.visibility === 'always') ? [item.action] : []);
  function actions(nodes: CompositionNode[]): CompositionAction[] {
    return nodes.flatMap(node => {
      const own: CompositionAction[] = 'action' in node && node.action ? [node.action] : [];
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
      const entry = pages.get(intent.pageId);
      if (!entry) continue;
      const childGroups = effective(entry.page.toolbar, groups);
      const hostItems = modal.presentation.close.visibility === 'all-depths' ? 2 : 1;
      if (visible(childGroups, false, false).length + hostItems > 12) add('limit_exceeded', `/document/pages/${entry.index}/toolbar`);
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
