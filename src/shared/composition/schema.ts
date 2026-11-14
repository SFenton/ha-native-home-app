import { z } from 'zod/v4';
import { settingsKinds } from './settings';
import { identifierSchema } from '../schema';
import { localFieldSchema, localValueSchema } from './shell';
import { climatePropsSchema, climateSourceSchema } from './climate';
import { roomDeviceControlSchema, roomDeviceSourceSchema } from './room-devices';
import { bedroomPropsSchema, bedroomSourceSchema, bedroomTileSchemas } from './bedroom';
import { remoteControlSchema, remoteSourceSchema } from './remote';
import { vacuumControlSchema, vacuumDescriptorSchema, type VacuumControl } from './vacuum';
import { cameraInputs, cameraLabels } from './camera';
import { deviceProviderSchemas, deviceControlSchemas } from './device-providers';

const object = z.strictObject;
const id = identifierSchema;
const text = (maximum: number, blank = false) => z.string().max(maximum)
  .refine(value => blank || Boolean(value.trim()));
const title = text(240);
const label = text(80);
const integer = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);
const empty = object({});
const symbol = object({
  type: z.literal('sf-symbol'), name: text(80),
  rendering: z.literal('canonical'), unavailable: z.literal('reject'),
});
const space = z.discriminatedUnion('type', [
  object({ type: z.literal('token'), name: z.enum(['zero', 'xs', 's', 'm', 'l', 'xl', 'section-header']) }),
  object({ type: z.literal('points'), value: z.number().min(0).max(64) }),
]);
const insets = object({ top: space, leading: space, bottom: space, trailing: space });
const width = z.discriminatedUnion('type', [
  object({ type: z.literal('unbounded') }),
  object({ type: z.literal('points'), value: z.number().min(320).max(1600) }),
]);
const read = object({
  type: z.literal('read'),
  from: object({ type: z.literal('source'), sourceId: id, path: z.array(text(160)).min(1).max(8) }),
  as: z.enum(['string', 'number', 'boolean', 'entity-id']),
  missing: z.literal('unavailable'),
});
const value = (maximum: number, blank: boolean) => z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), value: text(maximum, blank) }), read,
]);
const push = object({
  type: z.literal('push'), pageId: id, arguments: empty,
  origin: z.literal('sender'), duplicate: z.literal('reuse-nearest'),
});
const domainAction = object({
  type: z.literal('domain'), sourceId: id, intent: z.literal('power.toggle'), feedback: z.literal('policy'),
  confirmation: z.discriminatedUnion('type', [
    object({ type: z.literal('policy') }),
    object({
      type: z.literal('additional'), style: z.enum(['alert', 'dialog']), title,
      message: text(2000, true).optional(), confirmLabel: title,
      cancelLabel: z.literal('Cancel'), destructive: z.boolean(),
    }),
  ]),
});
const navigationAction = z.discriminatedUnion('type', [
  push,
  object({ type: z.literal('select-tab'), tabId: id }),
  object({ type: z.literal('present'), modalId: id, arguments: empty, ifPresented: z.literal('reject') }),
  object({ type: z.literal('dismiss-then-push'), destination: push }),
]);
export const compositionActionSchema = z.union([
  navigationAction, domainAction,
  object({ type: z.literal('back') }),
  object({ type: z.literal('dismiss'), scope: z.literal('current-modal') }),
  object({ type: z.literal('set-local'), stateId: id, value: localValueSchema }),
]);
export type CompositionAction = z.infer<typeof compositionActionSchema>;
const groups = z.array(object({
  id, placement: z.enum(['leading', 'trailing']),
  horizontal: z.enum(['separate-circles@1', 'shared@1']), vertical: z.enum(['shared@1', 'separate@1']),
  items: z.array(z.discriminatedUnion('type', [
    object({
      id, type: z.literal('shell-menu'), label, icon: symbol,
      visibility: z.literal('root-when-menu-available'),
    }),
    object({
      id, type: z.literal('button'), label, menuLabel: label, icon: symbol,
      visibility: z.enum(['always', 'root-only']), priority: z.enum(['required', 'normal', 'low']),
      rail: z.enum(['eligible', 'horizontal-only']), badge: object({ type: z.literal('none') }),
      action: compositionActionSchema,
    }),
    object({
      id, type: z.literal('shell-header'), visibility: z.enum(['always', 'root-only']),
      quickLinksAction: compositionActionSchema, profileAction: compositionActionSchema,
    }),
  ])).max(12),
})).max(3);
const toolbar = z.discriminatedUnion('type', [
  object({ type: z.literal('inherit') }),
  object({ type: z.literal('replace'), groups }),
]);
const node = { id, title, layout: object({ span: integer(1, 4) }) };
const infoBox = object({ ...node, type: z.literal('info-box'),
  props: object({ message: value(2000, true), tone: z.enum(['neutral', 'success']), unavailableText: label }) });
const statusPill = object({ ...node, type: z.literal('status-pill'), icon: symbol,
  props: object({ value: value(2000, true), detail: value(2000, true),
    tone: z.enum(['neutral', 'ok', 'active', 'warning', 'danger', 'unavailable']), unavailableText: label }) });
const pagedRowProps = object({ perPage: integer(1, 8), pageLabel: label, showsIndicator: z.boolean() });
const climateNode = object({ ...node, type: z.literal('climate-control'), props: climatePropsSchema, action: navigationAction.optional() });
const bedroomControl = object({ ...node, type: z.literal('bedroom-control'),
  props: z.discriminatedUnion('control', [...bedroomPropsSchema.options, ...bedroomTileSchemas(navigationAction)]) });
const [customLightControl, sprinklerControl] = deviceControlSchemas(compositionActionSchema);
const textNode = object({
  ...node, type: z.literal('text'),
  props: object({ value: value(16384, true), style: z.enum(['body', 'headline', 'caption1']), unavailableText: text(16384) }),
});
const settingsLink = object({
  ...node, type: z.literal('settings-link'), icon: symbol,
  props: object({ subtitle: text(2000, true), hint: text(240).optional(), showsChevron: z.boolean() }),
  action: navigationAction,
});
const accountHeader = object({
  ...node, type: z.literal('account-header'),
  binding: object({ sourceId: id, projection: z.literal('profile-account@1') }),
  props: object({ fallbackName: title, loadingText: title, unavailableText: title }),
});
const bootstrapMessage = object({
  ...node, type: z.literal('bootstrap-message'), icon: symbol,
  props: object({ message: text(2000, true) }),
});
const notificationBanner = object({
  ...node, type: z.literal('notification-permission-banner'),
  props: object({ message: text(2000), enableLabel: label, dismissLabel: label }),
});
const solidFill = object({
  type: z.literal('solid-rgb'), red: integer(0, 255), green: integer(0, 255), blue: integer(0, 255),
});
const alarmAppearance = object({ icon: symbol, fill: solidFill, text: title });
const alarmState = z.enum(['disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
  'armed_custom_bypass', 'triggered', 'arming', 'pending', 'disarming']);
const alarmPanel = object({
  ...node, type: z.literal('alarm-panel'),
  props: object({
    sourceId: id,
    modes: z.array(object({
      state: z.enum(['disarmed', 'armed_home', 'armed_away', 'armed_night']),
      label, hint: title, icon: symbol, fill: solidFill,
    })).min(1).max(4),
    states: z.array(object({ state: alarmState, appearance: alarmAppearance })).max(10),
    fallback: alarmAppearance, subtitle: title, sincePrefix: text(80, true), separator: text(80, true),
    loadingText: title, unavailableText: title, hiddenText: title, errorText: title, pendingText: title,
    confirmation: object({ title, message: text(2000), confirmLabel: title, cancelLabel: z.literal('Cancel') }),
    triggeredWash: solidFill,
  }),
});
const doorTile = object({
  ...node, type: z.literal('door-tile'),
  props: object({
    sourceId: id, kind: z.enum(['lock', 'garage']),
    states: z.array(object({
      state: z.enum(['locked', 'unlocked', 'locking', 'unlocking', 'open', 'jammed', 'closed', 'opening', 'closing']),
      appearance: alarmAppearance, active: z.boolean(), error: z.boolean(),
    })).max(9),
    fallback: alarmAppearance, loadingText: title, unavailableText: title, hiddenText: title, errorText: title,
    sendingOpenText: title, sendingCloseText: title, openLabel: label, closeLabel: label, reverseLabel: label,
  }),
});
const alarmNavigation = object({
  sourceId: id, projection: z.literal('alarm-navigation@1'),
  states: z.array(object({
    state: z.enum(['disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
      'armed_custom_bypass', 'triggered', 'arming', 'pending', 'disarming']),
    appearance: alarmAppearance,
  })).max(10),
  fallback: alarmAppearance, loadingText: title, unavailableText: title, errorText: title, hiddenText: title,
});
const roomVisibility = object({ sourceId: id, states: z.array(text(160)).min(1).max(32) });
const roomCardProps = object({
  kind: z.enum(['air', 'appliance', 'climate', 'contact', 'fan', 'grill', 'humidifier', 'laundry',
    'light', 'media', 'occupancy', 'power', 'vacuum', 'vent', 'wake-light']),
  showState: z.boolean(), subtitleSourceIds: z.array(id).max(16),
  activeStates: z.array(text(160)).max(32), disabledStates: z.array(text(160)).max(32),
  stateLabels: z.array(object({ state: text(160), label: title })).max(64),
  visibility: roomVisibility.optional(), action: navigationAction.optional(), power: domainAction.optional(),
  alternate: object({ when: roomVisibility, sourceId: id, showState: z.boolean(), subtitleSourceIds: z.array(id).max(16) }).optional(),
  chipSources: object({ aqiSourceId: id.optional(), colorSourceId: id.optional(), alarmSourceId: id.optional(), homeAwaySourceId: id.optional(),
    awaySourceIds: z.array(id).max(16), pluralContacts: z.boolean() }).optional(),
  personalization: object({ residentId: id, ownTitle: title, otherTitle: title }).optional(),
  stateColors: z.array(object({ state: text(160), fill: solidFill })).max(32).optional(),
  climateActionTone: z.boolean().optional(),
});
const roomCard = object({
  ...node, type: z.literal('room-card'), icon: symbol,
  binding: object({ sourceId: id, projection: z.literal('room-state@1') }), props: roomCardProps,
});
const roomChip = object({
  ...node, type: z.literal('room-chip'), icon: symbol,
  binding: object({ sourceId: id, projection: z.literal('room-state@1') }), props: roomCardProps,
});
const roomNavigationGrid = object({
  ...node, type: z.literal('room-navigation-grid'),
  binding: object({ sourceId: id, projection: z.literal('room-navigation@1') }), props: empty,
});
const roomSectionProps = object({
  arrangement: z.enum(['grid', 'lead-row', 'two-column-fill']), leadJoinsAtRegularWidth: z.boolean(),
  visibility: roomVisibility.optional(),
});
const navigationTile = object({
  ...node, type: z.literal('navigation-tile'), icon: symbol,
  props: object({
    family: z.enum(['neutral', 'lights', 'groceries', 'chore-resident-1', 'chore-resident-2', 'chore-unassigned', 'chore-home']),
    selected: z.enum(['navigation-path', 'none']), titleProviderId: id.optional(), subtitle: value(2000, true),
    alarm: alarmNavigation.optional(),
    roomVisibility: roomVisibility.optional(),
    presentation: object({
      layout: z.enum(['standard', 'anchored-bottom']), titleLines: integer(0, 2),
      fill: z.discriminatedUnion('type', [
        object({ type: z.literal('standard') }),
        solidFill,
      ]),
      bodyHint: text(240).optional(),
    }).optional(),
  }),
  action: navigationAction,
});
const actionTile = object({
  ...node, type: z.literal('action-tile'), icon: symbol,
  binding: object({ sourceId: id, projection: z.literal('power-tile@1') }),
  props: object({
    family: z.enum(['neutral', 'lights', 'occupancy']), bodyActionId: z.literal('power'),
    actionOrder: z.tuple([z.literal('power')]), stateText: z.literal('provider'), feedback: z.literal('policy'),
    powerLabels: object({ on: title, off: title }).optional(),
  }),
  action: domainAction,
});
const gridProps = object({
  minimum: z.enum(['tile@1', 'tile-dynamic-type@1', 'section-wide@1']), maxColumns: integer(1, 4), spacing: space,
  equalRowHeights: z.boolean(), shortRow: z.enum(['share', 'leading']), fold: z.enum(['page', 'container']),
});
const sectionProps = object({ header: text(240, true), footer: text(2000, true), style: z.enum(['plain', 'module-list']),
  density: z.enum(['thin', 'dense']), hasGlyphs: z.boolean(), spacing: space, presentationProviderId: id.optional() });
const row = object({
  ...node, type: z.literal('row'),
  props: object({ primary: value(2000, false), secondary: value(2000, true), value: value(2000, true),
    icon: symbol.optional(), accessory: z.enum(['none', 'disclosure']), loadingText: title, unavailableText: title }),
  action: compositionActionSchema.optional(),
});
const localControl = object({
  ...node, type: z.literal('local-control'),
  props: object({ stateId: id, kind: z.enum(['toggle', 'stepper', 'choice', 'text-field', 'segmented-choice']), placeholder: text(240, true) }),
});
const button = object({ ...node, type: z.literal('primary-button'), props: empty, icon: symbol.optional(), action: compositionActionSchema });
const rowCollection = object({
  ...node, type: z.literal('row-collection'),
  props: object({ providerId: id, loadingText: title, emptyText: title, unavailableText: title, errorText: title, staleText: title }),
});
const collection = object({
  ...node, type: z.literal('collection'),
  props: object({ providerId: id, template: z.enum(['rows', 'todo', 'inventory', 'recipes', 'carousel']),
    loadingText: title, emptyText: title }),
  selection: navigationAction.optional(),
});
const recordForm = object({
  ...node, type: z.literal('form'),
  props: object({ providerId: id, saveLabel: label, selectionOnly: z.boolean(),
    fields: z.array(object({ key: id, label, control: z.enum([
      'text', 'multiline', 'number', 'toggle', 'choice', 'date', 'time', 'weekdays', 'attachment', 'options', 'percent', 'segmented', 'scan-camera', 'schedule-date-time',
    ]) })).min(1).max(32) }),
  success: compositionActionSchema.optional(),
});
const recipePart = object({
  ...node, type: z.literal('recipe-part'),
  props: object({ providerId: id, part: z.enum(['hero', 'general', 'ingredients', 'instructions']) }),
});
const pinnedActions = object({
  ...node, type: z.literal('pinned-actions'),
  props: object({ searchProviderId: id.optional(), searchPrompt: label, style: z.enum(['floating', 'form']).optional(),
    items: z.array(object({ id, title: label, icon: symbol, prominent: z.boolean(), showsTitle: z.boolean(),
      action: compositionActionSchema, role: z.enum(['sort', 'filter', 'create']).optional(), stateProviderId: id.optional() })).max(4) }),
});
const statusAppearance = object({ icon: symbol, glyph: solidFill.optional(), fill: z.discriminatedUnion('type', [
  object({ type: z.literal('standard') }), solidFill,
]) });
const statusProps = {
  sourceId: id, states: z.array(object({ state: text(80), appearance: statusAppearance, text: title.optional() })).max(32),
  fallback: statusAppearance, announcement: z.enum(['none', 'value-change']),
};
const statusChip = object({ ...node, type: z.literal('status-chip'), props: object(statusProps), action: navigationAction.optional() });
const roomOverviewTile = object({
  ...node, type: z.literal('room-overview-tile'),
  props: object({ ...statusProps, hidesContactSubtitle: z.boolean(), powerSourceId: id.optional() }), action: navigationAction.optional(),
});
const lightGroupTile = object({ ...node, type: z.literal('light-group-tile'), props: object({ sourceId: id }) });
const weatherMode = z.enum(['condition', 'precipitation', 'wind']);
const weatherPanel = object({
  ...node, type: z.literal('weather-panel'),
  props: object({
    sourceId: id, panel: z.enum(['summary', 'hero', 'briefing', 'hourly', 'daily', 'highlights']),
    modes: z.array(weatherMode).min(1).max(3), initialMode: weatherMode,
    highlights: z.array(z.enum(['aqi', 'precipitation', 'accumulation', 'humidity', 'cloud',
      'feels', 'uv', 'wind', 'sun', 'visibility', 'pressure'])).max(11),
    compactHours: integer(1, 12), regularHours: integer(1, 12),
    labels: object({ loading: title, empty: title, stale: title, error: title, open: title }),
  }), action: navigationAction.optional(),
});
const remoteNode = object({
  ...node, type: z.literal('remote-control'), binding: object({ sourceId: id }), props: remoteControlSchema,
  feedback: object({ loadingText: title, errorText: title }),
});
const cameraTile = object({
  ...node, type: z.literal('camera-tile'),
  props: object({ sourceId: id, openHint: title }),
  action: object({ type: z.literal('present'), modalId: id, arguments: empty, ifPresented: z.literal('reject') }),
});
const cameraVideo = object({ ...node, type: z.literal('camera-video'), props: object({ sourceId: id }) });
const cameraControls = object({
  ...node, type: z.literal('camera-controls'),
  props: object({ sourceId: id, controls: z.array(object({
    intent: z.enum(['snapshot', 'sound', 'record']), title, activeTitle: title, busyTitle: title, failureTitle: title,
    icon: symbol, activeIcon: symbol, failureIcon: symbol, tint: z.enum(['action', 'danger']),
  })).min(1).max(3) }),
});
const cameraViewer = object({ ...node, type: z.literal('camera-viewer'), props: cameraControls.shape.props });
const settingsControl = object({
  ...node, type: z.literal('settings-control'), icon: symbol,
  props: object({ sourceId: id, kind: z.enum(settingsKinds), item: text(160, true),
    subtitle: text(2000, true), destination: navigationAction.optional() }),
});
export type CompositionNode = z.infer<typeof settingsControl> | z.infer<typeof customLightControl> | z.infer<typeof sprinklerControl>
 | z.infer<typeof infoBox> | z.infer<typeof statusPill> | z.infer<typeof textNode> | z.infer<typeof collection> | z.infer<typeof recordForm>
 | z.infer<typeof recipePart> | (z.infer<typeof pinnedActions> & { children?: CompositionNode[] }) | z.infer<typeof navigationTile> | z.infer<typeof actionTile> | z.infer<typeof row> | z.infer<typeof localControl> | z.infer<typeof button> | z.infer<typeof rowCollection> | z.infer<typeof statusChip> | z.infer<typeof roomOverviewTile> | z.infer<typeof lightGroupTile> | z.infer<typeof weatherPanel> | z.infer<typeof alarmPanel> | z.infer<typeof doorTile> | z.infer<typeof climateNode> | z.infer<typeof settingsLink> | z.infer<typeof roomCard> | z.infer<typeof roomChip> | z.infer<typeof roomNavigationGrid> | z.infer<typeof roomDeviceControlSchema> | z.infer<typeof bedroomControl> | z.infer<typeof remoteNode> | VacuumControl | z.infer<typeof accountHeader> | z.infer<typeof cameraTile> | z.infer<typeof cameraVideo> | z.infer<typeof cameraControls> | z.infer<typeof cameraViewer> | z.infer<typeof bootstrapMessage> | z.infer<typeof notificationBanner> | {
  id: string; title: string; type: 'tile-grid'; layout: { span: number };
  props: z.infer<typeof gridProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'section'; layout: { span: number };
  props: z.infer<typeof sectionProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'paged-row'; layout: { span: number };
  props: z.infer<typeof pagedRowProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'local-tabs'; layout: { span: number };
  props: { stateId: string; transition: 'canonical-swap@1'; resetOnPresentation?: boolean; pinned?: boolean;
    scopeProviderId?: string; showsSelector?: boolean; retainsAutomaticSelection?: boolean };
  tabs: { id: string; label: string; children: CompositionNode[]; icon?: z.infer<typeof symbol>; centerWhenFits?: boolean }[];
} | {
  id: string; title: string; type: 'status-rail'; layout: { span: number }; props: Record<string, never>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'room-section'; layout: { span: number };
  props: z.infer<typeof roomSectionProps>; children: CompositionNode[];
};
export const compositionNodeSchema: z.ZodType<CompositionNode> = z.lazy(() => z.discriminatedUnion('type', [
  customLightControl, sprinklerControl,
  textNode, navigationTile, actionTile, statusChip, roomOverviewTile, lightGroupTile, weatherPanel, alarmPanel, doorTile, settingsLink, roomCard, roomChip, roomNavigationGrid, roomDeviceControlSchema, bedroomControl, remoteNode, vacuumControlSchema, cameraTile, cameraVideo, cameraControls, cameraViewer,
  object({ ...node, type: z.literal('tile-grid'), props: gridProps, children: z.array(compositionNodeSchema).max(100) }),
  row, localControl, button, rowCollection, collection, recordForm, recipePart,
  pinnedActions.extend({ children: z.array(compositionNodeSchema).max(1).optional() }),
  infoBox, statusPill,
  object({ ...node, type: z.literal('paged-row'), props: pagedRowProps, children: z.array(compositionNodeSchema).max(100) }),
  object({ ...node, type: z.literal('section'), props: sectionProps, children: z.array(compositionNodeSchema).max(100) }),
  object({ ...node, type: z.literal('local-tabs'), props: object({ stateId: id, transition: z.literal('canonical-swap@1'), resetOnPresentation: z.boolean().optional(), pinned: z.boolean().optional(),
    scopeProviderId: id.optional(), showsSelector: z.boolean().optional(), retainsAutomaticSelection: z.boolean().optional() }),
    tabs: z.array(object({ id, label, children: z.array(compositionNodeSchema).max(100), icon: symbol.optional(), centerWhenFits: z.boolean().optional() })).min(2).max(5) }),
  object({ ...node, type: z.literal('status-rail'), props: empty, children: z.array(compositionNodeSchema).max(20) }),
  climateNode,
  object({ ...node, type: z.literal('room-section'), props: roomSectionProps, children: z.array(compositionNodeSchema).max(100) }),
  accountHeader, settingsControl,
  bootstrapMessage, notificationBanner,
]));
export function compositionChildren(node: CompositionNode): CompositionNode[] {
  return node.type === 'tile-grid' || node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section' || node.type === 'paged-row' ? node.children
    : node.type === 'local-tabs' ? node.tabs.flatMap(tab => tab.children)
      : node.type === 'pinned-actions' ? node.children ?? [] : [];
}
const surface = {
  id, title, icon: symbol, parameters: empty, toolbar,
  layout: object({
    type: z.literal('column'), padding: insets, spacing: space, maxWidth: width,
    scroll: z.literal('content-fit@1'), chrome: z.literal('canonical-page@1'), ground: z.literal('host'),
  }),
  components: z.array(compositionNodeSchema).max(100),
};
const page = object({ ...surface, navigation: z.discriminatedUnion('type', [
  object({ type: z.literal('stack') }),
  object({ type: z.literal('navigation-columns'), placeholder: title, standalone: z.boolean(), onDemand: z.boolean().optional() }),
]) });
const modal = object({
  ...surface,
  presentation: object({
    type: z.literal('sheet'), width: z.enum(['form', 'page']),
    adaptive: z.boolean().optional(),
    fullScreen: z.boolean().optional(),
    height: z.discriminatedUnion('type', [
      object({ type: z.literal('full') }),
      object({ type: z.literal('fitted'), follows: z.enum(['root', 'top-page']), firstOpen: z.literal('canonical@1') }),
    ]),
    appearance: z.enum(['system', 'dark']), placement: z.literal('canonical-sheet@1'),
    grabber: z.literal('canonical'), navigation: z.literal('local-stack@1'),
    close: object({
      type: z.literal('close'), visibility: z.enum(['root-only', 'all-depths']),
      placement: z.literal('trailing'), rail: z.enum(['automatic', 'keep-horizontal-when-allowed']),
      guard: object({ type: z.literal('none') }),
    }),
  }),
});
const source = z.discriminatedUnion('kind', [
  object({ id, kind: z.literal('ha-entity'), entityId: value(160, false) }),
  z.discriminatedUnion('model', [
    object({ id, kind: z.literal('model'), model: z.literal('settings-provider@1'),
      inputs: object({ providerId: id, domain: z.enum(['household', 'away', 'preferences', 'feedback', 'profile', 'performance']) }) }),
    object({
      id, kind: z.literal('model'), model: z.literal('home-status@1'),
      inputs: object({
        projection: z.enum(['lights', 'climate', 'occupancy', 'contacts', 'air-quality', 'entity']),
        format: z.enum(['summary', 'room', 'item', 'detail']),
        entityIds: z.array(object({ type: z.literal('literal'), value: text(160) })).max(128),
        rangeEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        secondaryEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        alarmEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        awayEntityIds: z.array(object({ type: z.literal('literal'), value: text(160) })).max(16),
        colorEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        members: z.array(object({
          entityId: object({ type: z.literal('literal'), value: text(160) }), title,
          contactCount: integer(1, 128), contactKind: z.enum(['door', 'window']),
        })).max(128).optional(),
      }),
      labels: object({
        idle: title, active: title, countSuffix: text(80, true),
        loading: title, unavailable: title, empty: title, hidden: title,
      }),
    }),
    object({
      id, kind: z.literal('model'), model: z.literal('home-weather@1'),
      inputs: object({
        weatherEntityId: object({ type: z.literal('literal'), value: text(160) }),
        sunEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        airQualityEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        units: z.literal('source@1'),
      }),
    }),
    object({ id, kind: z.literal('model'), model: z.literal('home-light@1'),
      inputs: object({ entityId: object({ type: z.literal('literal'), value: text(160) }),
        memberEntityIds: z.array(object({ type: z.literal('literal'), value: text(160) })).max(64).optional() }) }),
    ...roomDeviceSourceSchema.options,
    ...deviceProviderSchemas,
    bedroomSourceSchema,
    remoteSourceSchema,
    object({ id, kind: z.literal('model'), model: z.literal('vacuum@1'), inputs: vacuumDescriptorSchema }),
    object({ id, kind: z.literal('model'), model: z.literal('profile-account@1') }),
    object({ id, kind: z.literal('model'), model: z.literal('camera-stream@1'), inputs: cameraInputs, labels: cameraLabels }),
    object({ id, kind: z.literal('model'), model: z.literal('power-toggle@1'), inputs: object({ entityId: value(160, false) }) }),
    object({ id, kind: z.literal('model'), model: z.literal('alarm-mode@1'),
      inputs: object({ entityId: object({ type: z.literal('literal'), value: text(160) }) }) }),
    object({ id, kind: z.literal('model'), model: z.literal('security-door@1'),
      inputs: object({ entityId: object({ type: z.literal('literal'), value: text(160) }), kind: z.enum(['lock', 'garage']) }) }),
    object({ id, kind: z.literal('model'), model: z.literal('sprinkler-state@1'),
      inputs: object({
        title, lowBatteryPercent: z.number().min(0).max(100),
        stateEntityId: object({ type: z.literal('literal'), value: text(160) }),
        modeEntityId: object({ type: z.literal('literal'), value: text(160) }),
        batteryEntityId: object({ type: z.literal('literal'), value: text(160) }),
        faultEntityId: object({ type: z.literal('literal'), value: text(160) }),
        nextWateringEntityId: object({ type: z.literal('literal'), value: text(160) }),
        hubConnectedEntityId: object({ type: z.literal('literal'), value: text(160) }),
        rainDelayEntityId: object({ type: z.literal('literal'), value: text(160) }),
        smartWateringEntityId: object({ type: z.literal('literal'), value: text(160) }),
        zones: z.array(object({
          valveEntityId: object({ type: z.literal('literal'), value: text(160) }),
          programEntityId: object({ type: z.literal('literal'), value: text(160) }),
          historyEntityId: object({ type: z.literal('literal'), value: text(160) }),
        })).min(1).max(32),
      }) }),
    object({ id, kind: z.literal('model'), model: z.literal('household-away-status@1'),
      inputs: object({ entityId: object({ type: z.literal('literal'), value: text(160) }) }) }),
    object({
      id, kind: z.literal('model'), model: z.literal('inventory-summary@1'),
      inputs: object({
        totalEntityId: object({ type: z.literal('literal'), value: text(160) }),
        expiringEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        expiringLocation: text(80).optional(),
        spaceEntityIds: z.array(object({ type: z.literal('literal'), value: text(160) })).min(1).max(64),
      }),
      labels: object({
        singular: label, plural: label, expiringSuffix: label, separator: text(80, true),
        loadingText: title, unavailableText: title,
      }),
    }),
    object({
      id, kind: z.literal('model'), model: z.literal('room-navigation@1'),
      ranking: z.enum(['configured', 'visits-descending-configured-ties@1']),
      visitScriptEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
      items: z.array(object({
        id, title, icon: symbol, fill: solidFill,
        counterEntityId: object({ type: z.literal('literal'), value: text(160) }).optional(),
        visibility: roomVisibility.optional(), visitKey: label.optional(), action: navigationAction, bodyHint: title,
      })).max(64),
    }),
    climateSourceSchema,
    object({
      id, kind: z.literal('model'), model: z.literal('todo-counts@1'),
      inputs: object({
        lists: z.array(object({ entityId: object({ type: z.literal('literal'), value: text(160) }), overdue: z.boolean() })).min(1).max(64),
      }),
      labels: object({
        openSuffix: label, overdueSuffix: label, separator: text(80, true),
        zeroText: title, loadingText: title, unavailableText: title,
      }),
    }),
    object({ id, kind: z.literal('model'), model: z.literal('inventory-list@1'),
      inputs: object({ space: z.enum(['all-food', 'pantry', 'fridge', 'freezer', 'spice-rack', 'cabinet']) }) }),
  ]),
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const asset = object({
  id, role: z.enum(['backdrop', 'content-image']),
  source: object({ type: z.literal('publisher'), path: text(100) }),
  sha256: hash, mimeType: z.enum(['image/png', 'image/jpeg']), byteLength: integer(1, 8388608),
  pixelWidth: integer(1, 8192), pixelHeight: integer(1, 8192),
});
const background = z.discriminatedUnion('type', [
  object({ type: z.literal('solid'), token: z.literal('shell-base@1') }),
  object({
    type: z.literal('downloaded'), assetId: id, recipe: z.literal('house-r3@1'),
    blur: z.discriminatedUnion('type', [
      object({ type: z.literal('fixed'), percent: integer(0, 100) }),
      object({ type: z.literal('preference'), key: z.literal('backdrop-blur'), initialPercent: integer(0, 100) }),
    ]),
    scrim: z.discriminatedUnion('type', [
      object({ type: z.literal('canonical@1') }),
      object({
        type: z.literal('gradient'), increasedContrastBoost: z.number().min(0).max(0.1),
        stops: z.array(object({ location: z.number().min(0).max(1), opacity: z.number().min(0).max(0.9) })).min(2).max(8),
      }),
    ]),
    motion: z.literal('stationary@1'), reducedTransparency: z.literal('canonical-base@1'),
  }),
]);

/** Delivery changes appearance only. The engine retains every state, control and update decision. */
export const activityPresentationSchema = object({
  id, jobId: id, type: z.literal('activity-presentation@1'),
  title: text(32).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  glyph: z.enum(['fan', 'dishwasher', 'dryer', 'washer', 'vacuum', 'hot_flash', 'generic']),
  tint: z.enum(['engine', 'neutral', 'air', 'cleaning', 'water', 'cooling']),
  source: z.literal('activity-engine@1'), privacy: z.literal('system-sensitive@1'),
  updates: z.literal('engine@1'), intents: z.literal('engine-safe@1'),
});
export const extensionPresentationSchema = object({
  type: z.literal('native-extensions@1'), watch: z.literal('stub@1'),
  routes: z.array(object({
    id, path: text(80).regex(/^[a-z][a-z0-9-]{0,79}$/), pageId: id,
    title: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    summary: title.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    icon: text(80).regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
    tabId: id.optional(), anchors: z.array(object({ fragment: id, modalId: id })).max(32).optional(),
  })).max(64),
  cameras: z.array(object({
    entityId: text(160).regex(/^camera\.[a-z0-9_]+$/),
    title: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    liveLabel: text(40).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    unavailableLabel: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  })).max(32),
}).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32_768);

/** Closed first-slice grammar. Semantic compilation and native preparation remain separate gates. */
export const compositionDocumentSchema = object({
  schemaVersion: z.literal('2.0'), id, name: title,
  theme: object({ appearance: z.literal('dark'), tokens: z.literal('canonical@1'), typography: z.literal('dynamic-type@1'), background }),
  navigation: object({
    initialPageId: id, initialTabId: id.nullable(), initialArguments: empty,
    tabs: z.array(object({ id, label, icon: symbol, pageId: id, arguments: empty })).max(8),
    policy: object({
      type: z.literal('canonical-shell@1'), tabSwitch: z.literal('preserve-cut@1'), reselect: z.literal('pop-root-then-scroll@1'),
      stackMotion: z.literal('canonical-stack@1'), restoration: z.literal('scene@1'), selectionWhileModal: z.literal('reject'),
    }),
    chrome: object({ groups }),
  }),
  pages: z.array(page).min(1).max(256), modals: z.array(modal).max(256),
  dataSources: z.array(source).max(1000), variables: empty, assets: z.array(asset).max(100),
  localState: z.array(localFieldSchema).max(100).optional(),
  liveActivities: z.array(activityPresentationSchema).max(16),
  extensions: extensionPresentationSchema.optional(),
  bootstrap: object({
    type: z.literal('native-bootstrap@1'), arrivalAnnouncement: title,
    recovery: object({ loadingTitle: title, unavailableTitle: title, unavailableMessage: text(2000), retryLabel: label }),
    setup: z.array(object({
      permission: z.enum(['notifications', 'time-sensitive', 'location']), explanation: text(2000).optional(),
    })).length(3),
  }).optional(),
});
export const compositionPublicationSchema = object({
  envelopeVersion: z.literal('2.0'), publisherId: id, revision: integer(1, Number.MAX_SAFE_INTEGER),
  updatedAt: text(40), publishedAt: text(40), capabilities: z.array(text(160)).max(1000),
  assetManifestSha256: hash, document: compositionDocumentSchema,
});
export type CompositionDocument = z.infer<typeof compositionDocumentSchema>;
export type CompositionPublication = z.infer<typeof compositionPublicationSchema>;
export type CompositionGroups = z.infer<typeof groups>;
export type CompositionRead = z.infer<typeof read>;
export type CompositionValue = z.infer<ReturnType<typeof value>>;
