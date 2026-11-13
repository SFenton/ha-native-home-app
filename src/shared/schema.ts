import { z } from 'zod/v4';
import type { Action, Component, Json, StudioDocument } from './types';
import { nativeHomeEndpoints } from './native-endpoints';
import { containerTypes, nonInteractiveTypes } from './catalog';
import { isSafeUrl } from './urls';
import { isBackgroundImage, MAX_BACKGROUND_LENGTH } from './background';
import { collectionKeys, interactionComponents, isTodoList, safeRecordPath } from './interactions';
import { readBindingPath } from './runtime';
export { isSafeUrl } from './urls';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, 'Use 1-80 letters, numbers, dots, underscores or hyphens')
  .refine((value) => !unsafeKeys.has(value), 'Reserved key');
export const entityIdSchema = z.string().max(160).regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/, 'Expected an entity ID such as light.living_room');
const label = z.string().max(240);
const primitive = z.union([z.string().max(16384), z.number().finite(), z.boolean(), z.null()]);
const safeKey = z.string().max(160).refine((value) => !unsafeKeys.has(value), 'Reserved key');
export const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  primitive,
  z.array(jsonSchema).max(1000),
  z.record(safeKey, jsonSchema).refine((value) => Object.keys(value).length <= 100, 'At most 100 object keys'),
]));

const safeUrl = z.string().max(2048).refine(isSafeUrl, 'Only HTTP(S) or root-relative URLs without credentials are allowed');
const serviceName = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
export const actionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('navigate'), pageId: identifierSchema }).strict(),
  z.object({ type: z.literal('modal'), modalId: identifierSchema }).strict(),
  z.object({ type: z.literal('dismiss') }).strict(),
  z.object({ type: z.literal('toggle'), variable: identifierSchema }).strict(),
  z.object({ type: z.literal('set'), variable: identifierSchema, value: primitive }).strict(),
  z.object({ type: z.literal('service'), domain: serviceName, service: serviceName, entityId: entityIdSchema, data: z.record(safeKey, jsonSchema).optional() }).strict(),
  z.object({ type: z.literal('url'), url: safeUrl }).strict(),
  z.object({ type: z.literal('report-issue') }).strict(),
  z.object({ type: z.literal('request-feature') }).strict(),
]);
const conditionSchema = z.object({
  source: z.enum(['variable', 'entity']),
  key: z.string().min(1).max(160),
  operator: z.enum(['equals', 'not-equals', 'truthy', 'greater-than', 'less-than']),
  value: primitive.optional(),
}).strict();
const controlLabel = z.string().max(80).refine(value => Boolean(value.trim()), 'Use a nonblank label');
const searchLabel = z.string().max(120).refine(value => Boolean(value.trim()), 'Use nonblank text');
const interactionColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use an opaque hex color');
const recordPath = z.string().refine(safeRecordPath, 'Use a safe dot-separated record path (at most 500 characters)');
const rowActionSchema = z.object({
  id: identifierSchema, label: controlLabel, icon: z.string().max(80), color: interactionColor.optional(),
  action: z.union([actionSchema, z.object({ type: z.literal('todo-row'), operation: z.enum(['toggle', 'edit', 'delete']) }).strict()]),
  completedLabel: controlLabel.optional(), fullSwipe: z.boolean().optional(),
  confirmation: z.object({ title: searchLabel, message: z.string().max(1000).optional(), confirmLabel: controlLabel, cancelLabel: controlLabel, destructive: z.boolean().optional() }).strict().optional(),
}).strict();
const rowActionsSchema = z.object({ keyPath: recordPath.optional(), leading: z.array(rowActionSchema).max(3), trailing: z.array(rowActionSchema).max(3) }).strict();
const searchSchema = z.discriminatedUnion('mode', [
  z.object({ id: identifierSchema, label: searchLabel, placeholder: searchLabel, mode: z.literal('filter'), queryVariable: identifierSchema, targetComponentIds: z.array(identifierSchema).min(1).max(8), paths: z.array(recordPath).min(1).max(4) }).strict(),
  z.object({ id: identifierSchema, label: searchLabel, placeholder: searchLabel, mode: z.literal('endpoint'), sourceId: identifierSchema }).strict(),
]);
const remoteSlots: Record<string, readonly string[]> = {
  'remote-pad': ['back', 'up', 'power', 'left', 'select', 'right', 'home', 'down', 'keyboard'],
  'remote-playback': ['pause', 'play'],
  'remote-volume': ['volumeMute', 'volumeDown', 'volumeUp'],
};
const finiteNativePresentations = new Set(['guest-group', 'guest-toggle', ...Object.keys(remoteSlots), 'remote-key', 'vacuum-sheet', 'climate-rooms', 'grouped-settings']);
const remoteStateFields = ['matchStates', 'excludedStates', 'alternateForStates'] as const;
const hasRemoteStates = (component: Component) => remoteStateFields.some(key => component.props[key] !== undefined);
const nativeStateList = z.array(z.string().min(1).max(160).refine(value => Boolean(value.trim()), 'Use a nonblank state')).max(1000);
const rawNativeKeys = new Set(['configuredCommand', 'configuredStateAction', 'command', 'commands', 'condition', 'conditions', 'expression', 'javascript', 'jinja', 'swift', 'executable']);
export const componentSchema: z.ZodType<Component> = z.lazy(() => z.object({
  id: identifierSchema,
  type: z.enum(['heading', 'text', 'action-tile', 'navigation-tile', 'status-chip', 'camera-feed', 'camera-button', 'tile-grid', 'list', 'carousel', 'section', 'settings-row', 'profile', 'toggle', 'spacer', 'report-issue', 'request-feature', 'progress', 'weather-summary']),
  title: label,
  subtitle: z.string().max(2000).optional(),
  icon: z.string().max(80).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Use a hex color').optional(),
  props: z.record(safeKey, jsonSchema),
  action: actionSchema.optional(),
  visibility: conditionSchema.optional(),
  binding: z.object({ sourceId: identifierSchema, path: z.string().max(500).regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/).refine((value) => !value.split('.').some((key) => unsafeKeys.has(key)), 'Reserved binding path').optional() }).strict().optional(),
  layout: z.object({ span: z.number().int().min(1).max(12).optional(), rows: z.number().int().min(1).max(12).optional() }).strict().optional(),
  children: z.array(componentSchema).max(100).optional(),
  rowActions: rowActionsSchema.optional(),
}).strict());
const chromeSchema = z.object({
  id: identifierSchema, label, icon: z.string().max(80), placement: z.enum(['leading', 'trailing']), action: actionSchema,
}).strict();
const pageShape = {
  id: identifierSchema,
  title: label,
  subtitle: z.string().max(2000).optional(),
  icon: z.string().max(80),
  layout: z.object({ columns: z.number().int().min(1).max(12), gap: z.number().int().min(0).max(64), foldAware: z.boolean().optional() }).strict(),
  components: z.array(componentSchema).max(100),
  toolbar: z.array(chromeSchema).max(12),
  floatingButtons: z.array(z.object({
    id: identifierSchema, label: controlLabel, icon: z.string().max(80), color: interactionColor.optional(),
    action: z.union([actionSchema, z.object({ type: z.literal('todo-add'), componentId: identifierSchema }).strict()]),
  }).strict()).max(4).optional(),
  search: searchSchema.optional(),
};
const documentShape = z.object({
  schemaVersion: z.literal('1.0'),
  id: identifierSchema,
  name: z.string().min(1).max(240),
  theme: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), appearance: z.enum(['light', 'dark', 'system']), fontScale: z.number().min(0.75).max(2),
    background: z.object({
      image: z.string().max(MAX_BACKGROUND_LENGTH).refine(isBackgroundImage, 'Use an HTTP(S) or root-relative image URL without credentials, or an uploaded JPEG'),
      dim: z.number().min(0).max(0.9),
      blur: z.number().min(0).max(40),
    }).strict().optional(),
  }).strict(),
  navigation: z.object({
    initialPageId: identifierSchema,
    tabs: z.array(z.object({ id: identifierSchema, label, icon: z.string().max(80), pageId: identifierSchema }).strict()).max(8),
  }).strict(),
  pages: z.array(z.object(pageShape).strict()).min(1).max(50),
  modals: z.array(z.object({ ...pageShape, presentation: z.enum(['sheet', 'fullscreen', 'alert']), detent: z.enum(['medium', 'large']) }).strict()).max(64),
  liveActivities: z.array(z.object({
    id: identifierSchema, name: label, enabled: z.boolean(), attributes: z.record(identifierSchema, primitive),
    variants: z.object({
      lockScreen: z.array(componentSchema).max(20), compactLeading: z.array(componentSchema).max(20),
      compactTrailing: z.array(componentSchema).max(20), minimal: z.array(componentSchema).max(20), expanded: z.array(componentSchema).max(20),
    }).strict(),
  }).strict()).max(20),
  dataSources: z.array(z.object({
    id: identifierSchema, name: label, kind: z.enum(['static', 'ha-state', 'native-home', 'endpoint']),
    endpoint: z.string().max(80).optional(), entityId: entityIdSchema.optional(), queryVariable: identifierSchema.optional(),
    refreshSeconds: z.number().int().min(5).max(86400), sample: jsonSchema,
  }).strict()).max(100),
  variables: z.record(identifierSchema, primitive).refine((value) => Object.keys(value).length <= 100, 'At most 100 variables'),
}).strict();

export const studioDocumentSchema = documentShape.superRefine((document, context) => {
  const error = (path: (string | number)[], message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  function checkUrls(value: Json, valuePath: (string | number)[]) {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && (/^(?:url|src|href|imageUrl|avatarUrl|poster)$/i.test(key) || /^(?:javascript|vbscript|file|data):/i.test(nested)) && !isSafeUrl(nested)) error([...valuePath, key], 'Unsafe URL');
      if (typeof nested === 'object' && nested !== null) checkUrls(nested, [...valuePath, key]);
    }
  }
  const unique = (items: { id: string }[], path: (string | number)[]) => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (ids.has(item.id)) error([...path, index, 'id'], `Duplicate ID "${item.id}"`);
      ids.add(item.id);
    });
    return ids;
  };
  const pages = unique(document.pages, ['pages']);
  const modals = unique(document.modals, ['modals']);
  const sources = unique(document.dataSources, ['dataSources']);
  const queryVariables = new Set(document.dataSources.flatMap(source => source.queryVariable ? [source.queryVariable] : []));
  const endpointVariables = new Set(queryVariables);
  for (const page of [...document.pages, ...document.modals]) if (page.search?.mode === 'filter') queryVariables.add(page.search.queryVariable);
  const searchIds = new Set<string>();
  unique(document.navigation.tabs, ['navigation', 'tabs']);
  unique(document.liveActivities, ['liveActivities']);
  for (const id of modals) if (pages.has(id)) error(['modals'], `Page and modal IDs must not overlap: "${id}"`);
  if (!pages.has(document.navigation.initialPageId)) error(['navigation', 'initialPageId'], `Unknown page "${document.navigation.initialPageId}"`);
  document.navigation.tabs.forEach((tab, index) => {
    if (!pages.has(tab.pageId)) error(['navigation', 'tabs', index, 'pageId'], `Unknown page "${tab.pageId}"`);
  });
  document.dataSources.forEach((source, index) => {
    checkUrls(source.sample, ['dataSources', index, 'sample']);
    if (source.kind === 'ha-state' && !source.entityId) error(['dataSources', index, 'entityId'], 'HA state sources require an entityId');
    if (source.kind === 'native-home' && (!source.endpoint || !Object.hasOwn(nativeHomeEndpoints, source.endpoint))) error(['dataSources', index, 'endpoint'], 'Use a verified native-home endpoint name');
    if (source.kind === 'endpoint' && !identifierSchema.safeParse(source.endpoint).success) error(['dataSources', index, 'endpoint'], 'Choose a registered server endpoint ID, not a URL');
    if (!['native-home', 'endpoint'].includes(source.kind) && source.endpoint) error(['dataSources', index, 'endpoint'], 'Only native-home and registered endpoint sources accept an endpoint name');
    if (source.kind !== 'ha-state' && source.entityId) error(['dataSources', index, 'entityId'], 'Only HA state sources accept entityId');
    if (source.queryVariable !== undefined) {
      if (source.kind !== 'endpoint') error(['dataSources', index, 'queryVariable'], 'Only registered endpoint sources accept a query variable');
      const value = document.variables[source.queryVariable];
      if (!Object.hasOwn(document.variables, source.queryVariable) || value !== '') error(['dataSources', index, 'queryVariable'], 'Choose an existing string query variable with an empty initial value');
    }
  });
  function checkAction(action: Action | undefined, path: (string | number)[]) {
    if (!action) return;
    if (action.type === 'navigate' && !pages.has(action.pageId)) error([...path, 'pageId'], `Unknown page "${action.pageId}"`);
    if (action.type === 'modal' && !modals.has(action.modalId)) error([...path, 'modalId'], `Unknown modal "${action.modalId}"`);
    if (action.type === 'toggle' || action.type === 'set') {
      if (!Object.hasOwn(document.variables, action.variable)) error([...path, 'variable'], `Unknown variable "${action.variable}"`);
      else if (action.type === 'toggle' && typeof document.variables[action.variable] !== 'boolean') error([...path, 'variable'], 'Toggle requires a boolean variable');
      if (queryVariables.has(action.variable) && (action.type !== 'set' || typeof action.value !== 'string' || action.value.length > 500)) error([...path, 'value'], 'Search variables require string values of at most 500 characters');
    }
    if (action.type === 'service' && action.entityId.split('.')[0] !== action.domain) error([...path, 'entityId'], 'Service domain must match the target entity domain');
    if (action.type === 'service' && action.data && ['entity_id', 'area_id', 'device_id', 'floor_id', 'label_id'].some((key) => Object.hasOwn(action.data!, key))) error([...path, 'data'], 'Targets must be supplied only through entityId');
  }
  function checkRemoteBranches(items: Component[], path: (string | number)[]) {
    const groups = new Map<string, { component: Component; index: number }[]>();
    items.forEach((component, index) => {
      if (component.type !== 'action-tile') return;
      const key = component.props.presentation === 'remote-key' ? `slot:${typeof component.props.remoteKey === 'string' ? component.props.remoteKey : ''}` : `title:${component.title}`;
      const group = groups.get(key) ?? [];
      group.push({ component, index }); groups.set(key, group);
    });
    for (const group of groups.values()) {
      if (!group.some(({ component }) => hasRemoteStates(component) || component.props.presentation === 'remote-key')) continue;
      const preceding = new Set<string>();
      const entity = group[0].component.props.stateEntityId;
      let otherwise = false;
      for (const { component, index } of group) {
        const props = component.props, current = [...path, index, 'props'];
        const conditional = hasRemoteStates(component);
        if (group.length > 1 && (!conditional || otherwise || props.stateEntityId !== entity)) error(current, 'Remote branches for one key require one state entity and mutually exclusive ordered cases');
        if (!conditional) continue;
        const alternate = props.alternateForStates !== undefined;
        const excluded = alternate ? props.alternateForStates : props.excludedStates ?? [];
        if (nativeStateList.safeParse(excluded).success && Array.isArray(excluded)) {
          const states = new Set(excluded);
          if (states.size !== preceding.size || [...preceding].some(state => !states.has(state))) error([...current, alternate ? 'alternateForStates' : 'excludedStates'], 'Exclusions must equal the preceding case-state union for this key');
        }
        if (Array.isArray(props.matchStates)) for (const state of props.matchStates) if (typeof state === 'string') preceding.add(state);
        otherwise = alternate;
      }
    }
  }
  function checkNative(component: Component, current: (string | number)[], ancestors: Component[], compiled: boolean) {
    const props = component.props, presentation = typeof props.presentation === 'string' ? props.presentation : '', parent = ancestors.at(-1);
    const propError = (key: string, message: string) => error([...current, 'props', key], message);
    const entity = (key: string, domain?: string, optional = false) => {
      if (optional && props[key] === undefined) return;
      if (!entityIdSchema.safeParse(props[key]).success || domain && !String(props[key]).startsWith(`${domain}.`)) propError(key, `Use a safe ${domain ? `${domain} ` : ''}entity ID`);
    };
    const stateBinding = () => {
      const source = document.dataSources.find(source => source.id === component.binding?.sourceId);
      if (source?.id !== 'native-states' || !(source.kind === 'native-home' && source.endpoint === 'house-states' || source.kind === 'static' && Array.isArray(source.sample)) || component.binding?.path !== undefined)
        error([...current, 'binding'], 'Use native-states without a binding path: house-states or an array-backed static simulation');
    };
    const section = () => { if (component.type !== 'section') error([...current, 'type'], 'This native presentation requires a section'); };
    const tile = () => { if (component.type !== 'action-tile') error([...current, 'type'], 'This native intent requires an action tile'); };
    const noDestination = () => {
      for (const key of ['destinationId', 'initialDestinationId', 'initialTabId']) if (props[key] !== undefined) propError(key, 'This native intent cannot override its action with a destination');
    };
    const noAction = () => { if (component.action !== undefined) error([...current, 'action'], 'This native intent does not accept a configured Action'); };
    const textProps = (keys: string[]) => {
      for (const key of keys) if (props[key] !== undefined && !label.safeParse(props[key]).success) propError(key, 'Use a plain string of at most 240 characters');
    };
    const stateMetadata = hasRemoteStates(component) || compiled && props.stateEntityId !== undefined;
    const finite = compiled || finiteNativePresentations.has(presentation) || props.nativeKind === 'remote-sheet' || props.nativeKind === 'vacuum-room'
      || stateMetadata || ['vacuumTab', 'vacuumPage', 'vacuumAction', 'choiceList', 'checkRow', 'childClose', 'remoteKey', 'remoteMediaEntityId'].some(key => props[key] !== undefined);
    if (props.presentation !== undefined && typeof props.presentation !== 'string') propError('presentation', 'Use a presentation string');
    if (finite) {
      if (props.nativeKind !== undefined && typeof props.nativeKind !== 'string') propError('nativeKind', 'Use a native kind string');
      const checkRaw = (value: Json, path: (string | number)[]) => {
        if (typeof value !== 'object' || value === null) return;
        for (const [key, nested] of Object.entries(value)) {
          if (rawNativeKeys.has(key)) error([...path, key], 'Compiled native presentations accept data and ordinary Actions, not raw commands or expressions');
          checkRaw(nested, [...path, key]);
        }
      };
      checkRaw(props, [...current, 'props']);
      for (const key of ['disabled', 'readOnly']) if (props[key] !== undefined && typeof props[key] !== 'boolean') propError(key, 'Use a boolean native setting');
    }
    if (finiteNativePresentations.has(presentation) || props.nativeKind === 'remote-sheet' || props.vacuumTab !== undefined || props.vacuumPage !== undefined) {
      for (const key of ['collectionKind', 'nativeTodoPage']) if (props[key] !== undefined) propError(key, 'Native presentations cannot be replaced by a collection renderer');
    }
    if (presentation === 'guest-group') {
      section(); stateBinding(); noAction();
      if (component.visibility || props.collectionKind !== undefined || component.children?.some(child => child.props.presentation !== 'guest-toggle')) error([...current, 'children'], 'Guest groups contain only guest-toggle tiles and use any-member visibility, not collections or conditions');
    }
    if (presentation === 'guest-toggle') {
      tile(); entity('entityId'); stateBinding(); noAction(); noDestination();
      if (parent?.props.presentation !== 'guest-group' || component.visibility) propError('presentation', 'Guest toggles belong directly to a guest group without per-tile visibility');
      for (const key of ['alternate', 'confirmation', 'confirmationTitle', 'confirmationAction', 'controlKind', 'collectionKind']) if (props[key] !== undefined) propError(key, 'Guest toggles use explicit native setters without alternate controls or confirmation');
      textProps(['activeText', 'inactiveText', 'unavailableText']);
    }
    if (props.nativeKind === 'remote-sheet') {
      section(); entity('entityId', 'media_player'); stateBinding();
      if (presentation !== 'tabs' || !component.title.trim() || !component.children?.length || component.children.some(child => child.type !== 'section')) propError('nativeKind', 'Remote sheets require titled tabs containing sections');
    }
    if (Object.hasOwn(remoteSlots, presentation)) {
      section();
      const remote = [...ancestors].reverse().find(item => item.props.nativeKind === 'remote-sheet');
      if (!remote) propError('presentation', 'Remote controls belong inside a remote sheet');
      if (component.children?.some(child => child.props.presentation !== 'remote-key' || typeof child.props.remoteKey !== 'string' || !remoteSlots[presentation].includes(child.props.remoteKey))) error([...current, 'children'], 'Use only the corresponding remote-key slots');
      if (presentation !== 'remote-volume' && (props.columns !== 3 || props.adaptive !== false)) propError('columns', 'Remote pads and playback require three nonadaptive columns');
      if (presentation === 'remote-volume') {
        entity('entityId', 'media_player'); entity('remoteMediaEntityId', 'media_player'); stateBinding();
        if (remote && props.remoteMediaEntityId !== remote.props.entityId) propError('remoteMediaEntityId', 'Use the containing remote sheet media entity');
        for (const key of ['state', 'volume', 'volumeLevel', 'volume_level', 'supportedFeatures', 'supported_features', 'isVolumeMuted']) if (props[key] !== undefined) propError(key, 'Volume state and capabilities must come from bound data');
      }
    }
    if (presentation === 'remote-key') {
      tile(); entity('remoteMediaEntityId', 'media_player'); stateBinding(); noDestination();
      const parentPresentation = typeof parent?.props.presentation === 'string' ? parent.props.presentation : '';
      const allowed = Object.hasOwn(remoteSlots, parentPresentation) ? remoteSlots[parentPresentation] : undefined;
      const remote = [...ancestors].reverse().find(item => item.props.nativeKind === 'remote-sheet');
      if (typeof props.remoteKey !== 'string' || !allowed?.includes(props.remoteKey)) propError('remoteKey', 'Choose a remote key in its corresponding pad, playback, or volume section');
      if (remote && props.remoteMediaEntityId !== remote.props.entityId) propError('remoteMediaEntityId', 'Use the containing remote sheet media entity');
      if (!component.action && props.disabled !== true || component.action?.type === 'none') error([...current, 'action'], 'Remote keys require an ordinary Action, or disabled: true with no Action');
    }
    if (props.remoteKey !== undefined && presentation !== 'remote-key') propError('remoteKey', 'remoteKey requires the remote-key presentation');
    if (props.remoteMediaEntityId !== undefined && !['remote-key', 'remote-volume'].includes(presentation)) propError('remoteMediaEntityId', 'Remote media gating requires a remote key or volume section');
    if (stateMetadata) {
      tile(); entity('stateEntityId'); stateBinding(); noDestination();
      if (!component.title.trim() || !component.action && props.disabled !== true || component.action?.type === 'none') error([...current, 'action'], 'Compiled remote branches require a title and an ordinary Action, or an explicitly disabled adapter');
      if (props.matchStates === undefined && props.alternateForStates === undefined || props.alternateForStates !== undefined && (props.matchStates !== undefined || props.excludedStates !== undefined)) propError('matchStates', 'Use either case match/exclusions or otherwise states');
      for (const key of remoteStateFields) if (props[key] !== undefined && (!nativeStateList.safeParse(props[key]).success || key === 'matchStates' && Array.isArray(props[key]) && !props[key].length)) propError(key, 'Use at most 1000 nonblank state strings of at most 160 characters; cases cannot be empty');
      if (props.presentation !== undefined && presentation !== 'remote-key') propError('presentation', 'State branches are compiled remote action tiles only');
    }
    if (presentation === 'vacuum-sheet') {
      section(); entity('entityId', 'vacuum'); entity('batteryEntityId', undefined, true); entity('dockStatusEntityId', undefined, true); stateBinding(); noAction();
      const tabs = new Set<Json>(), pages = new Set<Json>();
      for (const child of component.children ?? []) {
        const tab = child.props.vacuumTab, page = child.props.vacuumPage;
        if (child.type !== 'section' || (tab === undefined) === (page === undefined)) error([...current, 'children'], 'Vacuum sheets contain sections marked as exactly one tab or same-sheet page');
        if (tab !== undefined) { if (tabs.has(tab)) error([...current, 'children'], 'Vacuum tab values must be unique'); tabs.add(tab); }
        if (page !== undefined) { if (pages.has(page)) error([...current, 'children'], 'Vacuum page values must be unique'); pages.add(page); }
      }
      if (!tabs.has('controls')) error([...current, 'children'], 'Vacuum sheets require exactly one Controls tab');
    }
    for (const [key, values] of Object.entries({ vacuumTab: ['controls', 'zones', 'autoClean', 'more', 'info'], vacuumPage: ['area', 'report'] })) {
      if (props[key] === undefined) continue;
      section();
      if (parent?.props.presentation !== 'vacuum-sheet' || typeof props[key] !== 'string' || !values.includes(props[key]) || props.presentation !== undefined) propError(key, 'Use a known tab/page section directly inside a vacuum sheet');
    }
    if (props.vacuumTab === 'zones' && component.children?.some(child => child.props.nativeKind !== 'vacuum-room')) error([...current, 'children'], 'Vacuum Rooms contains only local vacuum-room selectors');
    if (props.nativeKind === 'vacuum-room') {
      tile(); entity('entityId'); stateBinding(); noAction(); noDestination(); textProps(['mapName']);
      if (parent?.props.vacuumTab !== 'zones' || props.presentation !== undefined) propError('nativeKind', 'Vacuum rooms are local selectors directly inside the Rooms tab');
    }
    if (props.vacuumAction !== undefined) {
      tile(); noDestination();
      const expectedTab = props.vacuumAction === 'clean' ? 'controls' : typeof props.vacuumAction === 'string' && ['dockClean', 'dockDry'].includes(props.vacuumAction) ? 'more' : undefined;
      if (!expectedTab || parent?.props.vacuumTab !== expectedTab || props.presentation !== undefined) propError('vacuumAction', 'Use clean in Controls or dockClean/dockDry in Dock');
      if (component.action?.type !== 'service' || component.action.domain !== 'script' || component.action.service !== 'turn_on' || !component.action.entityId.startsWith('script.')) error([...current, 'action'], 'Configured vacuum intents require an explicit script.turn_on Action with a script target');
    }
    for (const [key, kind] of [['choiceList', 'select'], ['checkRow', 'toggle']] as const) {
      if (props[key] === undefined) continue;
      if (typeof props[key] !== 'boolean' || presentation !== 'control' || props.controlKind !== kind) propError(key, `Use a boolean on a ${kind} control action tile`);
      stateBinding(); noAction(); noDestination();
      for (const field of ['options', 'state', 'value', 'checked']) if (props[field] !== undefined) propError(field, 'Control options and state must come from bound data');
    }
    if (props.checkedText !== undefined || props.uncheckedText !== undefined) {
      if (props.checkRow !== true) propError('checkRow', 'Checked and unchecked labels require a check row');
      textProps(['checkedText', 'uncheckedText']);
    }
    if (presentation === 'climate-rooms') {
      section();
      if (component.children?.some(child => child.type !== 'navigation-tile' || child.props.nativeKind !== 'climate-room')) error([...current, 'children'], 'Climate Rooms contains climate-room navigation tiles');
    }
    if (props.nativeKind === 'climate-room' && (compiled || parent?.props.presentation === 'climate-rooms')) {
      entity('entityId'); entity('occupancyEntityId'); stateBinding();
      const stack = [...ancestors].reverse().find(item => item.props.presentation === 'navigation-stack');
      if (component.type !== 'navigation-tile' || parent?.props.presentation !== 'climate-rooms' || !identifierSchema.safeParse(props.destinationId).success || !stack?.children?.some(child => child.id === props.destinationId && child.props.presentation === 'subpage')) propError('destinationId', 'Climate room tiles require a subpage in their containing navigation stack');
    }
    if (props.childClose !== undefined && (typeof props.childClose !== 'boolean' || component.type !== 'section' || presentation !== 'navigation-stack')) propError('childClose', 'childClose is a boolean on a navigation-stack section only');
    if (presentation === 'grouped-settings') section();
    return finite;
  }
  const componentIds = new Set<string>();
  const hasInitialDestination = (items: Component[], presentation: string, id: string): boolean =>
    items.some(item => item.props.presentation === presentation && item.children?.some(child => child.id === id)
      || hasInitialDestination(item.children ?? [], presentation, id));
  let count = 0;
  function components(items: Component[], path: (string | number)[], depth = 1, ancestors: Component[] = [], compiled = false) {
    checkRemoteBranches(items, path);
    items.forEach((component, index) => {
      const current = [...path, index];
      count += 1;
      if (componentIds.has(component.id)) error([...current, 'id'], `Duplicate component ID "${component.id}"`);
      componentIds.add(component.id);
      if (depth > 8) { error(current, 'Component nesting exceeds 8 levels'); return; }
      if (component.children !== undefined && !containerTypes.has(component.type)) error([...current, 'children'], 'Only section, tile-grid, list, and carousel components can contain children');
      if (component.action && component.action.type !== 'none' && nonInteractiveTypes.has(component.type)) error([...current, 'action'], 'This component does not support tap actions; use an action tile or camera button');
      if (component.binding && !sources.has(component.binding.sourceId)) error([...current, 'binding', 'sourceId'], `Unknown data source "${component.binding.sourceId}"`);
      const finite = checkNative(component, current, ancestors, compiled);
      if (component.rowActions) {
        const row = component.rowActions;
        if (component.type !== 'list' || !component.binding) error([...current, 'rowActions'], 'Row actions require a bound list');
        unique([...row.leading, ...row.trailing], [...current, 'rowActions']);
        for (const side of ['leading', 'trailing'] as const) {
          if (row[side].filter(action => action.fullSwipe).length > 1) error([...current, 'rowActions', side], 'Only one full-swipe target is allowed per side');
          row[side].forEach((descriptor, i) => {
            const actionPath = [...current, 'rowActions', side, i, 'action'];
            if (descriptor.action.type === 'todo-row') {
              if (!isTodoList(component)) error(actionPath, 'Todo row intents require a Chores list');
            } else checkAction(descriptor.action, actionPath);
            if (descriptor.completedLabel !== undefined && !(descriptor.action.type === 'todo-row' && descriptor.action.operation === 'toggle')) error([...current, 'rowActions', side, i, 'completedLabel'], 'Completed label is only available for todo-row toggle');
          });
        }
        if (isTodoList(component)) {
          if (row.keyPath !== undefined) error([...current, 'rowActions', 'keyPath'], 'Chores uses entity ID and task UID, not keyPath');
        } else if (!row.keyPath) error([...current, 'rowActions', 'keyPath'], 'Generic list row actions require a keyPath');
        else {
          const source = document.dataSources.find(source => source.id === component.binding?.sourceId);
          const sample = source ? readBindingPath(source.sample, component.binding?.path) : undefined;
          if (Array.isArray(sample)) {
            try { collectionKeys(sample, row.keyPath); }
            catch (reason) { error([...current, 'rowActions', 'keyPath'], reason instanceof Error ? reason.message : String(reason)); }
          } else error([...current, 'rowActions'], 'Generic row actions require an array sample at the binding path');
        }
      }
      for (const [field, presentation] of [['initialDestinationId', 'navigation-stack'], ['initialTabId', 'tabs']] as const) {
        const destination = component.props[field];
        if (destination === undefined) continue;
        const action = component.action;
        const modal = action?.type === 'modal' ? document.modals.find(item => item.id === action.modalId) : undefined;
        if (typeof destination !== 'string' || !modal || !hasInitialDestination(modal.components, presentation, destination)) error([...current, 'props', field], 'Choose a destination inside the action target sheet');
      }
      if (component.props.presentation === 'control') {
        if (component.type !== 'action-tile') error([...current, 'type'], 'Native controls use action-tile');
        if (!['light', 'climate', 'cover', 'fan', 'select', 'toggle', 'media', 'vacuum', 'humidifier', 'number', 'sensor'].includes(String(component.props.controlKind))) error([...current, 'props', 'controlKind'], 'Choose a supported native control kind');
        if (!entityIdSchema.safeParse(component.props.entityId).success) error([...current, 'props', 'entityId'], 'Native controls require a safe entity ID');
        if (!component.binding) error([...current, 'binding'], 'Native controls require a state binding');
      } else if (component.props.controlKind !== undefined) error([...current, 'props', 'controlKind'], 'controlKind requires the control presentation');
      if (component.props.presentation === 'alarm-panel') {
        if (component.type !== 'section') error([...current, 'type'], 'Alarm panels use an editable section');
        if (!entityIdSchema.safeParse(component.props.entityId).success || !String(component.props.entityId).startsWith('alarm_control_panel.')) error([...current, 'props', 'entityId'], 'Alarm panels require an alarm_control_panel entity');
        if (!component.binding) error([...current, 'binding'], 'Alarm panels require a state binding');
        if (component.children?.some(child => child.type !== 'action-tile' || typeof child.props.modeState !== 'string')) error([...current, 'children'], 'Alarm modes use action tiles with modeState');
      }
      if (component.props.presentation === 'detail' && component.type !== 'weather-summary') error([...current, 'props', 'presentation'], 'Weather detail uses weather-summary');
      if (component.props.presentation === 'summary' && component.type !== 'profile') error([...current, 'props', 'presentation'], 'Profile summary uses profile');
      if (['todo-items', 'resident-todo-items'].includes(String(component.props.collectionKind))) {
        if (component.type !== 'list' || !component.binding) error(current, 'Chores collections require a bound list');
        if (component.props.collectionKind === 'todo-items' && (!entityIdSchema.safeParse(component.props.entityId).success || !String(component.props.entityId).startsWith('todo.'))) error([...current, 'props', 'entityId'], 'Chores collections require a todo entity');
        if (component.props.currentUserIds !== undefined && (!Array.isArray(component.props.currentUserIds) || component.props.currentUserIds.length > 128 || component.props.currentUserIds.some(id => typeof id !== 'string' || !id || id.length > 128))) error([...current, 'props', 'currentUserIds'], 'Use configured Home Assistant user IDs');
        for (const key of ['hideCompleted', 'hideWhenNoOpenItems', 'hasTaskForm']) {
          if (component.props[key] !== undefined && typeof component.props[key] !== 'boolean') error([...current, 'props', key], 'Use a boolean Chores setting');
        }
        if (component.props.collectionKind === 'resident-todo-items' && (!Array.isArray(component.props.summaryListKeys) || !component.props.summaryListKeys.length || component.props.summaryListKeys.some(key => !['overdue', 'dueToday', 'noDueDate'].includes(String(key))))) error([...current, 'props', 'summaryListKeys'], 'Use configured resident summary list keys');
      }
      if (component.visibility) {
        const condition = component.visibility;
        if (condition.source === 'variable' && !Object.hasOwn(document.variables, condition.key)) error([...current, 'visibility', 'key'], `Unknown variable "${condition.key}"`);
        if (condition.source === 'entity' && !entityIdSchema.safeParse(condition.key).success) error([...current, 'visibility', 'key'], 'Expected a safe entity ID');
        if (condition.operator !== 'truthy' && condition.value === undefined) error([...current, 'visibility', 'value'], 'This condition requires a comparison value');
        if (['greater-than', 'less-than'].includes(condition.operator) && typeof condition.value !== 'number') error([...current, 'visibility', 'value'], 'Numeric comparisons require a number');
      }
      if (typeof component.props.variable === 'string' && !Object.hasOwn(document.variables, component.props.variable)) error([...current, 'props', 'variable'], `Unknown variable "${component.props.variable}"`);
      if (containerTypes.has(component.type)) {
        for (const [key, min, max] of [['columns', 1, 12], ['rows', 1, 8], ['gap', 0, 64]] as const) {
          const value = component.props[key];
          if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)) error([...current, 'props', key], `Use an integer from ${min} to ${max}`);
        }
        for (const key of ['filterVariable', 'sortDirectionVariable'] as const) {
          const variable = component.props[key];
          if (variable !== undefined && (typeof variable !== 'string' || !Object.hasOwn(document.variables, variable))) error([...current, 'props', key], 'Choose an existing variable');
        }
        for (const key of ['sortBy', 'filterPath'] as const) {
          const path = component.props[key];
          if (path !== undefined && (typeof path !== 'string' || (path !== '' && !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) || String(path).split('.').some(key => unsafeKeys.has(key)))) error([...current, 'props', key], 'Use a safe dot-separated record path');
        }
        if (component.props.sortDirection !== undefined && !['asc', 'desc'].includes(String(component.props.sortDirection))) error([...current, 'props', 'sortDirection'], 'Choose asc or desc');
      }
      checkAction(component.action, [...current, 'action']);
      checkUrls(component.props, [...current, 'props']);
      if (component.children) components(component.children, [...current, 'children'], depth + 1, [...ancestors, component], finite);
    });
  }
  for (const kind of ['pages', 'modals'] as const) {
    document[kind].forEach((page, index) => {
      unique(page.toolbar, [kind, index, 'toolbar']);
      page.toolbar.forEach((action, actionIndex) => checkAction(action.action, [kind, index, 'toolbar', actionIndex, 'action']));
      const current = [kind, index], all = interactionComponents(page.components);
      if ('presentation' in page && page.presentation === 'alert' && (page.search !== undefined || page.floatingButtons !== undefined)) error(current, 'Alerts cannot contain search or floating controls');
      if (page.floatingButtons) {
        unique(page.floatingButtons, [...current, 'floatingButtons']);
        page.floatingButtons.forEach((button, i) => {
          if (button.action.type === 'todo-add') {
            const id = button.action.componentId;
            if (!all.some(component => component.id === id && component.props.nativeTodoPage === true)) error([...current, 'floatingButtons', i, 'action'], 'Todo add requires a same-surface nativeTodoPage root');
          } else checkAction(button.action, [...current, 'floatingButtons', i, 'action']);
        });
      }
      const search = page.search;
      if (search) {
        if (searchIds.has(search.id)) error([...current, 'search', 'id'], 'Duplicate search ID');
        searchIds.add(search.id);
        if (search.mode === 'filter') {
          const value = document.variables[search.queryVariable];
          if (typeof value !== 'string' || value.length > 500) error([...current, 'search', 'queryVariable'], 'Choose an existing string variable of at most 500 characters');
          if (endpointVariables.has(search.queryVariable)) error([...current, 'search', 'queryVariable'], 'Local filter variables cannot drive endpoint queries');
          if (new Set(search.paths).size !== search.paths.length || new Set(search.targetComponentIds).size !== search.targetComponentIds.length) error([...current, 'search'], 'Filter targets and paths must be unique');
          const expanded = new Set<string>();
          for (const id of search.targetComponentIds) {
            const target = all.find(component => component.id === id);
            if (!target || !(target.props.nativeTodoPage === true || (target.type === 'list' && target.binding && (!target.props.requiredData || isTodoList(target))))) { error([...current, 'search', 'targetComponentIds'], 'Choose supported same-surface bound lists or Chores roots'); continue; }
            const ids = target.props.nativeTodoPage === true ? interactionComponents(target.children ?? []).filter(isTodoList).map(component => component.id) : [id];
            for (const child of ids) {
              if (expanded.has(child)) error([...current, 'search', 'targetComponentIds'], 'Filter group and child targets must not overlap');
              expanded.add(child);
            }
          }
        } else {
          const source = document.dataSources.find(source => source.id === search.sourceId);
          if (source?.kind !== 'endpoint' || !source.queryVariable) error([...current, 'search', 'sourceId'], 'Endpoint search requires an endpoint source with a query variable');
          if (!all.some(component => component.binding?.sourceId === search.sourceId)) error([...current, 'search', 'sourceId'], 'Bind a component on this surface to the endpoint source');
        }
      }
      components(page.components, [kind, index, 'components']);
    });
  }
  document.liveActivities.forEach((activity, index) => {
    for (const [variant, items] of Object.entries(activity.variants)) {
      if (interactionComponents(items).some(component => component.rowActions !== undefined)) error(['liveActivities', index, 'variants', variant], 'Live Activities do not support row swipes');
      components(items, ['liveActivities', index, 'variants', variant]);
    }
  });
  if (count > 2000) error([], 'Document exceeds 2000 components');
});

export class DocumentValidationError extends Error {
  constructor(public readonly errors: string[]) { super('Document validation failed'); }
}

export function assertJsonBounds(input: unknown): void {
  // Bound recursion before Zod follows lazy schemas, including direct SDK callers.
  const pending: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const { value, depth, exit } = pending.pop()!;
    if (exit && typeof value === 'object' && value !== null) { ancestors.delete(value); continue; }
    if (++nodes > 30000 || depth > 40) throw new DocumentValidationError(['document: exceeds the size or nesting limit']);
    if (typeof value === 'object' && value !== null) {
      if (ancestors.has(value)) throw new DocumentValidationError(['document: cyclic object references are not JSON']);
      ancestors.add(value);
      pending.push({ value, depth, exit: true });
      if (Object.keys(value).length > 1000) throw new DocumentValidationError(['document: too many object entries']);
      for (const [key, nested] of Object.entries(value)) {
        if (unsafeKeys.has(key)) throw new DocumentValidationError([`document: reserved object key "${key}"`]);
        pending.push({ value: nested, depth: depth + 1 });
      }
    }
  }
}

export function validateDocument(input: unknown): StudioDocument {
  assertJsonBounds(input);
  const result = studioDocumentSchema.safeParse(input);
  if (!result.success) throw new DocumentValidationError(result.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`));
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > 1024 * 1024) throw new DocumentValidationError(['document: exceeds the 1 MiB serialized size limit']);
  return result.data;
}
