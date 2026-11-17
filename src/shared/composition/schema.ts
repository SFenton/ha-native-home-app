import { appStateSourceSchema } from './app-state';
import { MAX_RULE_CASES, operandBase, predicateBase } from './expression';
import { pipelineSourceSchema } from './pipeline/schema';
import { z } from 'zod/v4';
import { settingsKinds } from './settings';
import { identifierSchema } from '../validation';
import { localFieldSchema, localValueSchema } from './shell';
import { climatePropsSchema, climateSourceSchema } from './climate';
import { roomDeviceControlSchema, roomDeviceSourceSchema } from './room-devices';
import { bedroomPropsSchema, bedroomSourceSchema, bedroomTileSchemas } from './bedroom';
import { remoteControlSchema, remoteSourceSchema } from './remote';
import { vacuumControlSchema, vacuumDescriptorSchema, type VacuumControl } from './vacuum';
import { cameraInputs, cameraLabels } from './camera';
import { deviceProviderSchemas, deviceControlSchemas } from './device-providers';
import { stateStyleLibrarySchema, stateTileBindingSchema } from './state-styles';
import { callServiceSchema, enabledWhenSchema, predicateSchema, operandSchema, visibilityFields, type EnabledWhen, type WhenUnknown, type Predicate } from './expression';
import { conditional, label, navigationAction, push, read, symbol, symbolSlot, text, textValue } from './slots';
import { swipeSchema } from './tile-swipe';
import { stateWordsSchema } from './state-words';
import { gridGroupsSchema } from './grid-groups';

const object = z.strictObject;
const id = identifierSchema;
const title = text(240);
const integer = (minimum: number, maximum: number) => z.number().int().min(minimum).max(maximum);
const empty = object({});
const space = z.discriminatedUnion('type', [
  object({ type: z.literal('token'), name: z.enum(['zero', 'xs', 's', 'm', 'l', 'xl', 'section-header']) }),
  object({ type: z.literal('points'), value: z.number().min(0).max(64) }),
]);
const insets = object({ top: space, leading: space, bottom: space, trailing: space });
const width = z.discriminatedUnion('type', [
  object({ type: z.literal('unbounded') }),
  object({ type: z.literal('points'), value: z.number().min(320).max(1600) }),
]);
const value = (maximum: number, blank: boolean) => z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), value: text(maximum, blank) }), read,
]);
/** A color named by an entity's text, clamped to read; the fallback is required, never an implicit look (`sh.rules@1`). */
const boundColor = <T extends z.ZodType>(fallback: T) => object({ type: z.literal('bound-color'), value: operandBase, fallback });
/** A badge on a chip, a tile or a tab (`sh.badges@1`): none, or a value that is a number or text. A value of 0 draws no badge. */
export const badgeSchema = z.discriminatedUnion('type', [object({ type: z.literal('none') }), object({ type: z.literal('value'), value: operandBase })]);
const badgeField = { badge: badgeSchema.optional() };
const domainAction = object({
  type: z.literal('domain'), sourceId: id, intent: z.literal('power.toggle'), feedback: z.literal('policy'),
  confirmation: z.discriminatedUnion('type', [
    object({ type: z.literal('policy') }),
    object({
      type: z.literal('additional'), style: z.enum(['alert', 'dialog']), title,
      message: text(2000, true).optional(), confirmLabel: title,
      cancelLabel: z.literal('Cancel'), destructive: z.boolean(),
      /** Ask only when this holds (`sh.confirm-when@1`); a condition that cannot be answered asks. */
      when: predicateBase.optional(),
    }),
  ]),
});
/**
 * The navigation the app accepts on Home, weather and climate nodes: the same four actions, except that a presented modal
 * can only be rejected when already shown (`ServerUIHomeShape.homeNavigationAction`), never replaced.
 */
const homeNavigationAction = z.discriminatedUnion('type', [
  push,
  object({ type: z.literal('select-tab'), tabId: id }),
  object({ type: z.literal('present'), modalId: id, arguments: empty, ifPresented: z.literal('reject') }),
  object({ type: z.literal('dismiss-then-push'), destination: push }),
]);
export const compositionActionSchema = z.union([
  navigationAction, domainAction, callServiceSchema,
  object({ type: z.literal('back') }),
  object({ type: z.literal('dismiss'), scope: z.literal('current-modal') }),
  object({ type: z.literal('set-local'), stateId: id, value: localValueSchema }),
]);
export type CompositionAction = z.infer<typeof compositionActionSchema>;
/**
 * An action chosen by rule (`sh.action-rules@1`): the first case whose condition holds runs its action, else `otherwise` (an action or `none`).
 * One level: a case holds a plain action, never another rule.
 */
const conditionalAction = <T extends z.ZodType>(base: T) => object({
  type: z.literal('conditional'),
  cases: z.array(object({ when: predicateBase, then: base })).min(1).max(MAX_RULE_CASES),
  otherwise: z.union([base, object({ type: z.literal('none') })]),
});
/** A slot that takes an action takes the same action chosen by rule. */
const ruled = <T extends z.ZodType>(base: T) => z.union([base, conditionalAction(base)]);
const ruledAction = ruled(compositionActionSchema);
const ruledNavigation = ruled(navigationAction);
const ruledHomeNavigation = ruled(homeNavigationAction);
/** What a slot that takes an action holds: one action, or an action chosen by rule (`sh.action-rules@1`). */
export type CompositionActionSlot = z.infer<typeof ruledAction>;
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
      rail: z.enum(['eligible', 'horizontal-only']), badge: badgeSchema,
      action: ruledAction,
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
const node = { id, title, layout: object({ span: integer(1, 4).optional() }), ...visibilityFields };
const infoBox = object({ ...node, type: z.literal('info-box'),
  props: object({ message: textValue(2000, true), tone: z.enum(['neutral', 'success']), unavailableText: label }) });
/** The six tones of a readout (`status-pill`): the stored words; the Studio says Neutral, Good, Active, Warning, Problem and Unavailable. */
export const readoutTones = ['neutral', 'ok', 'active', 'warning', 'danger', 'unavailable'] as const;
const readoutTone = z.enum(readoutTones);
const statusPill = object({ ...node, type: z.literal('status-pill'), icon: symbol,
  props: object({ value: textValue(2000, true), detail: textValue(2000, true),
    /** One tone, or one chosen by rule (`sh.rules@1`): the first case that holds, each case a literal tone, else `otherwise`. */
    tone: z.union([readoutTone, conditional(readoutTone)]), unavailableText: label }) });
const pagedRowProps = object({ perPage: integer(1, 8), pageLabel: label, showsIndicator: z.boolean() });
const climateNode = object({ ...node, type: z.literal('climate-control'), props: climatePropsSchema, action: homeNavigationAction.optional() });
const bedroomControl = object({ ...node, type: z.literal('bedroom-control'),
  props: z.discriminatedUnion('control', [...bedroomPropsSchema.options, ...bedroomTileSchemas(navigationAction)]) });
const [customLightControl, sprinklerControl] = deviceControlSchemas(compositionActionSchema);
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
const standardFill = object({ type: z.literal('standard') });
/**
 * One colour for each appearance (`sh.solid-appearance@1`): `light` when the device is in light mode, `dark` in dark mode. Both are exact colours, so
 * the Studio stays the author of the colour: there is no named family and no adaptive token. Allowed wherever a slot takes an exact colour.
 */
const solidAppearance = object({ type: z.literal('solid-appearance'), light: solidFill, dark: solidFill });
const standardOrSolid = z.discriminatedUnion('type', [standardFill, solidFill, solidAppearance]);
const solidLook = z.discriminatedUnion('type', [solidFill, solidAppearance]);
/** A fill that may follow a rule or an entity's color: standard or exact (one colour or a light and dark pair), a `conditional` of those, or a `bound-color` (`sh.rules@1`). */
const fillSlot = z.discriminatedUnion('type', [standardFill, solidFill, solidAppearance, conditional(standardOrSolid), boundColor(standardOrSolid)]);
/** The same for a slot with no standard look: an exact color or pair, a `conditional` of exact colors, or a `bound-color` whose fallback is exact. */
const solidSlot = z.discriminatedUnion('type', [solidFill, solidAppearance, conditional(solidLook), boundColor(solidLook)]);
/**
 * The text styles a node can name, the system's eleven (`sh.text-style@1`). The older six keep their spellings (`body`, `headline`, `caption1`,
 * `subheadline`, `footnote`); `section-title` is the module header look and stays beside them.
 */
export const textSizeStyles = ['large-title', 'title1', 'title2', 'title3', 'headline', 'body', 'callout', 'subheadline', 'footnote', 'caption1', 'caption2'] as const;
/** The text styles `text` accepted before `sh.text-style@1`; any other style needs the id. */
export const baseTextStyles: readonly string[] = ['body', 'headline', 'caption1', 'subheadline', 'footnote', 'section-title'];
/** An exact colour with an opacity (`sh.text-style@1`): the channels as in `solid-rgb`, and `alpha` from 0 (clear) to 1 (opaque). */
const rgbaFill = object({ type: z.literal('rgba'), red: integer(0, 255), green: integer(0, 255), blue: integer(0, 255), alpha: z.number().min(0).max(1) });
/** One colour for each appearance in a slot `sh.text-style@1` adds: each side is a `solid-rgb` or an `rgba`. */
const inkAppearance = object({
  type: z.literal('solid-appearance'),
  light: z.discriminatedUnion('type', [solidFill, rgbaFill]), dark: z.discriminatedUnion('type', [solidFill, rgbaFill]),
});
/**
 * The colour of a slot `sh.text-style@1` adds (a text's ink, a stack's fill, line and border, a shape's fill, a symbol's tint): an exact colour with or
 * without opacity, or one for each appearance. Slots that exist without it keep taking `solid-rgb` and `solid-appearance` of `solid-rgb` only.
 */
export const inkSchema = z.discriminatedUnion('type', [solidFill, rgbaFill, inkAppearance]);
/** How a text is sized and set (`sh.text-style@1`): its weight, whether digits are monospaced, and a point size that scales with Dynamic Type. */
const fontSchema = object({
  weight: z.enum(['ultra-light', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black']).optional(),
  digits: z.enum(['proportional', 'monospaced']).optional(),
  /** A fixed point size that scales as `relativeTo` does, up to `maxPoints` (a numeral that is 76 points at the default size and never more than 96). */
  scale: object({ points: z.number().min(8).max(160), relativeTo: z.enum(textSizeStyles), maxPoints: z.number().min(8).max(240).optional() }).optional(),
});
const textNode = object({
  ...node, type: z.literal('text'),
  props: object({
    value: textValue(16384, true), style: z.enum([...textSizeStyles, 'section-title']), unavailableText: text(16384),
    /** Weight, digits and scaled size over the style (`sh.text-style@1`). */
    font: fontSchema.optional(),
    /** The colour of the words (`sh.text-style@1`). Absent: the style's own ink. */
    ink: inkSchema.optional(),
    /** The most lines, 0 for as many as it needs (`sh.text-style@1`). Absent: as many as it needs. */
    lines: integer(0, 12).optional(),
    align: z.enum(['start', 'center', 'end']).optional(),
    /** What happens to a line that does not fit (`sh.text-style@1`): wrap (the default), cut with an ellipsis, or slide as a ticker (one line only). */
    overflow: z.enum(['wrap', 'truncate', 'ticker']).optional(),
  }),
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
  stateColors: z.array(object({ state: text(160), fill: solidSlot })).max(32).optional(),
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
    selected: z.enum(['navigation-path', 'none']), titleProviderId: id.optional(), subtitle: textValue(2000, true),
    alarm: alarmNavigation.optional(),
    roomVisibility: roomVisibility.optional(),
    presentation: object({
      layout: z.enum(['standard', 'anchored-bottom']), titleLines: integer(0, 2),
      fill: fillSlot,
      bodyHint: text(240).optional(),
    }).optional(),
  }),
  action: ruledNavigation,
  ...badgeField,
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
/** One round button on a state tile (`sh.tile-parts@1`): its label is what VoiceOver reads and is never drawn. A `domain` action is refused by the compiler. */
const tileDisc = object({
  id,
  /** A symbol, or one chosen by a rule or an entity's text (`sh.tile-disc-rules@1`): pause while cleaning, play otherwise. */
  icon: symbolSlot,
  /** Plain words, or a text slot (`sh.tile-disc-rules@1`) that follows a rule or an expression. */
  label: z.union([label, textValue(80, false)]),
  /** The label is followed by the tile's own title for VoiceOver, so "Start" reads "Start Main Floor" (`sh.tile-disc-rules@1`). */
  namesTile: z.boolean().optional(),
  action: ruledAction, ...visibilityFields,
  enabledWhen: enabledWhenSchema.optional(),
});
/**
 * A tile whose look comes from a state style (`sh.state-style@1`): the entity, the library style it applies by id, its own
 * built-in style (used when the style id is unknown or the device lacks the capability) and per-layer overrides.
 */
const stateTile = object({
  ...node, type: z.literal('state-tile'), icon: symbol, binding: stateTileBindingSchema, ...badgeField,
  /** The tile's own parts (`sh.tile-parts@1`), each optional and required only when present: a line under the title, a progress fill and up to two buttons. */
  props: object({
    subtitle: textValue(2000, true).optional(),
    /** A number from 0 to 1 (clamped); the fill from the leading edge. Anything that is not a number draws no progress. */
    progress: operandSchema.optional(),
    discs: z.array(tileDisc).max(2).optional(),
    /** Swipe to adjust (`sh.tile-swipe@1`): off unless present. */
    swipe: swipeSchema.optional(),
  }),
  /** Where a tap on the tile goes (`sh.tile-parts@1`). */
  action: navigationAction.optional(),
  /**
   * The exact colour of the tile's icon on a face that is neither filled, an error nor unavailable (`sh.tile-ink@1`): one colour or one for each appearance
   * (`sh.solid-appearance@1`). Absent: the icon stays grey. An unavailable tile ignores it: the icon draws the default grey at 50% opacity.
   */
  glyphTint: solidLook.optional(),
  /** The same slot for the symbols of the tile's buttons on a dark face (`sh.tile-ink@1`). Absent: white. A filled face keeps its black 18% button with a white symbol. */
  discGlyphTint: solidLook.optional(),
  /**
   * How the tile sits in a taller grid cell (`sh.tile-ink@1`): `fill` (the default, and what a tile does today) stretches it to the cell; `natural` keeps its own height,
   * top-aligned, while the row stays as tall as its tallest cell (a grid with `equalRowHeights`).
   */
  cellFit: z.enum(['fill', 'natural']).optional(),
  /** Enabled while this holds (`sh.enabled-when@1`): a disabled tile is dimmed and takes no tap. */
  enabledWhen: enabledWhenSchema.optional(),
  /** Each of these, when it holds, overrides the style's class for that face (`sh.tile-look@1`); one that cannot be answered leaves the face to the style. */
  activeWhen: predicateSchema.optional(), filledWhen: predicateSchema.optional(), errorWhen: predicateSchema.optional(),
});
const gridProps = object({
  minimum: z.enum(['tile@1', 'tile-dynamic-type@1', 'section-wide@1']), maxColumns: integer(1, 4), spacing: space,
  /** The grid keeps at least this many columns, and no tile's own minimum width takes more than its share of them (`sh.grid-min-columns@1`). */
  minimumColumns: integer(2, 4).optional(),
  equalRowHeights: z.boolean(), shortRow: z.enum(['share', 'leading']), fold: z.enum(['page', 'container']),
  /** Tiles sit under a heading for the state they draw (`sh.grid-state-groups@1`). Absent: today's grid. */
  groups: gridGroupsSchema.optional(),
});
const sectionProps = object({ header: text(240, true), footer: text(2000, true), style: z.enum(['plain', 'module-list']),
  density: z.enum(['thin', 'dense']), hasGlyphs: z.boolean(), spacing: space, presentationProviderId: id.optional() });
const row = object({
  ...node, type: z.literal('row'),
  props: object({ primary: textValue(2000, false), secondary: textValue(2000, true), value: textValue(2000, true),
    icon: symbol.optional(), accessory: z.enum(['none', 'disclosure']), loadingText: title, unavailableText: title }),
  action: ruledAction.optional(),
  enabledWhen: enabledWhenSchema.optional(),
});
const localControl = object({
  ...node, type: z.literal('local-control'),
  props: object({ stateId: id, kind: z.enum(['toggle', 'stepper', 'choice', 'text-field', 'segmented-choice']), placeholder: text(240, true) }),
});
const button = object({ ...node, type: z.literal('primary-button'), props: empty, icon: symbol.optional(), action: ruledAction, enabledWhen: enabledWhenSchema.optional() });
const boundControl = object({
  ...node, type: z.literal('bound-control'), icon: symbol.optional(),
  props: object({
    kind: z.enum(['toggle', 'stepper', 'slider', 'choice', 'button']), surface: z.enum(['row', 'tile']).optional(),
    isOn: predicateSchema.optional(), value: operandSchema.optional(),
    range: object({ min: integer(-1_000_000, 1_000_000), max: integer(-1_000_000, 1_000_000), step: integer(1, 1_000_000) }).optional(),
    format: text(240).optional(),
    options: z.array(object({ id, label, selectedWhen: predicateSchema, action: callServiceSchema })).max(12).optional(),
    /**
     * A choice whose options are the items of an entity's list attribute (`sh.bound-options-read@1`); `options` stays as the fallback while the
     * list is missing, loading or holds fewer than two usable items.
     */
    optionsFrom: object({
      from: object({ type: z.literal('source'), sourceId: id, path: z.array(z.string().max(160)).min(1).max(8) }),
      /** The value the entity holds now: the option equal to it is the chosen one. */
      current: operandSchema, labels: z.enum(['as-is', 'title-case']),
      /** What choosing an option does; `control` stands for the chosen item. */
      action: callServiceSchema,
    }).optional(),
    unavailableText: title,
    // The row's own parts (`sh.bound-row-parts@1`) and its check face (`sh.check-face@1`), each optional and needed only when present.
    subtitle: textValue(2000, true).optional(), hint: text(240).optional(), metrics: z.enum(['form', 'module']).optional(), failureText: title.optional(),
    glyph: solidSlot.optional(), face: z.enum(['switch', 'check']).optional(), checkTint: z.enum(['action', 'success']).optional(),
  }),
  onAction: callServiceSchema.optional(), offAction: callServiceSchema.optional(), action: callServiceSchema.optional(),
  enabledWhen: enabledWhenSchema.optional(),
});
/** The five places an overlay child can sit (`sh.overlay@1`); `leading` and `trailing` mirror in right-to-left languages. */
export const overlayAnchors = ['top-leading', 'top-trailing', 'bottom-leading', 'bottom-trailing', 'center'] as const;
export type OverlayAnchor = typeof overlayAnchors[number];
const rowCollection = object({
  ...node, type: z.literal('row-collection'),
  props: object({
    providerId: id, loadingText: title, emptyText: title, unavailableText: title, errorText: title, staleText: title,
    // The list's own parts (`sh.list-parts@1`), each optional and required only when present: a tap on a row, pull to refresh, and a line under the empty title.
    rowAction: ruledAction.optional(), refreshable: z.boolean().optional(), emptyMessage: textValue(2000, true).optional(),
  }),
});
const collection = object({
  ...node, type: z.literal('collection'),
  props: object({ providerId: id, template: z.enum(['rows', 'todo', 'inventory', 'recipes', 'carousel']),
    loadingText: title, emptyText: title,
    /** Offers pull-to-refresh on the page. Off unless the document opts in; adds no capability beyond `sh.collection@1`. */
    pullToRefresh: z.boolean().optional(),
    bedroomLinks: z.array(object({ side: z.enum(['left', 'right']), label: title, action: navigationAction })).min(1).max(2).optional() }),
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
const statusAppearance = object({ icon: symbolSlot, glyph: solidSlot.optional(), fill: fillSlot });
const statusProps = {
  sourceId: id, states: z.array(object({ state: text(80), appearance: statusAppearance, text: title.optional() })).max(32),
  fallback: statusAppearance, announcement: z.enum(['none', 'value-change']),
};
const statusChip = object({ ...node, type: z.literal('status-chip'), props: object(statusProps), action: ruledHomeNavigation.optional(), ...badgeField });
const roomOverviewTile = object({
  ...node, type: z.literal('room-overview-tile'),
  props: object({ ...statusProps, hidesContactSubtitle: z.boolean(), powerSourceId: id.optional(), /** The words for its states (`sh.state-words@1`). */ words: stateWordsSchema.optional() }), action: ruledHomeNavigation.optional(), ...badgeField,
});
const lightGroupTile = object({ ...node, type: z.literal('light-group-tile'), props: object({ sourceId: id,
  /** Swipe to adjust brightness (`sh.tile-swipe@1`): off unless present. The light source owns the call. */
  swipe: swipeSchema.optional(),
  /** The words for its states (`sh.state-words@1`): on, off, unavailable and the level. */
  words: stateWordsSchema.optional() }) });
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
  }), action: homeNavigationAction.optional(),
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
// MARK: Stack, shape and symbol parts
/** The radius of a stack's fill: the tile's own, or points. */
const surfaceRadius = z.discriminatedUnion('type', [
  object({ type: z.literal('token'), name: z.literal('tile') }),
  object({ type: z.literal('points'), value: z.number().min(0).max(64) }),
]);
/** A line: its colour and width in points (`sh.stack@1`). */
const lineSchema = object({ ink: inkSchema, width: z.number().min(0.5).max(4) });
/**
 * What a stack sits on (`sh.stack@1`): the module surface the app draws under a card (`thin` or `dense`), or its own fill with an optional border and radius.
 */
const stackSurface = z.discriminatedUnion('type', [
  object({ type: z.literal('module'), density: z.enum(['thin', 'dense']) }),
  object({ type: z.literal('fill'), fill: inkSchema, border: lineSchema.optional(), radius: surfaceRadius.optional() }),
]);
/**
 * One group of a stack's children (`sh.stack@1`): the children it holds, by id, laid out along the stack's other axis. `grow` makes the group take the
 * room the others leave. `spacing` defaults to the stack's; `align` (across the group's own axis) to `start`; `distribution` to `natural`.
 */
const stackGroup = object({
  children: z.array(id).min(1).max(16), spacing: space.optional(),
  distribution: z.enum(['natural', 'spread']).optional(), align: z.enum(['start', 'center', 'end']).optional(), grow: z.boolean().optional(),
});
/**
 * When a horizontal stack lays itself out vertically instead (`sh.stack@1`): at an accessibility text size, and/or when the children that must fit do not
 * (`overflow`, measured over `fits`; see `stack-layout.ts`). A collapsed stack may use other `spacing` and other `groups`.
 */
const stackCollapse = object({
  to: z.literal('vertical'), when: z.array(z.enum(['accessibility-size', 'overflow'])).min(1).max(2),
  fits: z.array(id).max(16).optional(), spacing: space.optional(), groups: z.array(stackGroup).max(16).optional(),
});
const stackProps = object({
  axis: z.enum(['horizontal', 'vertical']), spacing: space, padding: insets.optional(),
  /** Where children sit across the axis (`start` is the leading or top edge). Absent: `start`. */
  align: z.enum(['start', 'center', 'end']).optional(),
  distribution: z.enum(['natural', 'spread']).optional(),
  groups: z.array(stackGroup).max(16).optional(), collapse: stackCollapse.optional(),
  /** A line between neighbours, with the stack's spacing on each side of it. */
  dividers: lineSchema.optional(), surface: stackSurface.optional(),
});
/**
 * What an assistive technology makes of a stack (`sh.stack@1`): `group` is one element named by `label` (and `value`, `hint`), `children` leaves the
 * children as they are, `hidden` removes the stack and its children. `role` is `button` for a stack with an action.
 */
const stackA11y = object({
  element: z.enum(['group', 'children', 'hidden']), role: z.enum(['button', 'header', 'text']).optional(),
  label: textValue(240, false).optional(), value: textValue(240, true).optional(), hint: text(240).optional(),
});
/** A container that lays its children in a row or a column, with optional spacing, padding, lines between, a surface, a tap and one accessibility element (`sh.stack@1`). */
export type StackProps = z.infer<typeof stackProps>;
export type StackGroup = z.infer<typeof stackGroup>;
export type StackA11y = z.infer<typeof stackA11y>;
export type InkValue = z.infer<typeof inkSchema>;
export type FontProps = z.infer<typeof fontSchema>;
/** A plain shape: a capsule, a rectangle or a circle of one colour (`sh.stack@1`). It is decoration: assistive technologies skip it. */
const shapeNode = object({
  ...node, type: z.literal('shape'),
  props: object({ form: z.enum(['capsule', 'rect', 'circle']), width: z.number().min(1).max(1024), height: z.number().min(1).max(1024), fill: inkSchema }),
});
/**
 * One symbol drawn on its own (`sh.symbol-part@1`): a symbol, or one chosen by a rule or an entity's text, with a size that scales with Dynamic Type, a
 * rendering, a tint for a monochrome one, the trim of its leading ink and a turn in degrees. `a11y` says whether it is an image with a label or hidden.
 */
const symbolPart = object({
  ...node, type: z.literal('symbol'),
  props: object({
    name: symbolSlot,
    size: object({ points: z.number().min(8).max(160), relativeTo: z.enum(textSizeStyles).optional(), maxScale: z.number().min(1).max(4).optional() }),
    rendering: z.enum(['multicolor', 'monochrome']), tint: inkSchema.optional(), trim: z.enum(['none', 'leading']).optional(),
    /** A number of degrees (clockwise) the symbol is turned by; anything else draws it upright. */
    rotate: operandSchema.optional(),
  }),
  a11y: z.discriminatedUnion('element', [object({ element: z.literal('hidden') }), object({ element: z.literal('image'), label: textValue(240, false) })]),
});
export type SymbolPartNode = z.infer<typeof symbolPart>;
export type ShapeNode = z.infer<typeof shapeNode>;

// MARK: Repeat (`sh.repeat@1`)

/**
 * How a horizontal repeat is cut into pages (`sh.repeat@1`): how many items a page holds in a compact and in a regular-width window (at most 12), the factor
 * the count is scaled by at each of four text sizes (default, large, extra large and the accessibility sizes, each no larger than the one before) down to
 * `minimum` items, whether a page indicator and previous and next buttons show (buttons only in a regular-width window), and the name VoiceOver gives the pager.
 */
const repeatPaging = object({
  compact: integer(1, 12), regular: integer(1, 12),
  scaleByTextSize: z.array(z.number().gt(0).max(1)).length(4).optional(),
  minimum: integer(1, 12).optional(), indicator: z.boolean().optional(), buttons: z.enum(['never', 'regular-width']).optional(), label: title.optional(),
});
/**
 * A list drawn from a flow (`sh.repeat@1`): one copy of its first child for every record the `records` flow `providerId` gives, up to `limit`. Inside that child
 * `item` reads a field of the record and `index` its position, checked against the flow's `schema`. The optional second child is drawn `placeholder.count`
 * times while the flow has not answered; it has no record, so only `index` is allowed in it. The five words say what shows with no list: loading, nothing in
 * it, no data, a failed first load, and a kept list that is out of date.
 */
const repeatProps = object({
  providerId: id, axis: z.enum(['horizontal', 'vertical']), spacing: space, limit: integer(1, 100).optional(),
  paging: repeatPaging.optional(), placeholder: object({ count: integer(1, 24) }).optional(),
  loadingText: title, emptyText: title, unavailableText: title, errorText: title, staleText: title,
});
export type RepeatProps = z.infer<typeof repeatProps>;
export type RepeatNode = {
  id: string; title: string; type: 'repeat'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown; props: RepeatProps; children: CompositionNode[];
};
export type RepeatPaging = z.infer<typeof repeatPaging>;

// MARK: Chart and linear gauge (`sh.chart@1`, `sh.linear-gauge@1`)
/** One point of an inline series: the label under it and its value, which is `null` where it is not known. */
const chartPoint = object({ label: text(40, true), value: z.number().min(-1e9).max(1e9).nullable() });
/**
 * The one series a chart draws. `literal`: the points written in the document, for a corpus or a preview. `source`: the records of a Data Flow (or, with no
 * `providerId`, of the list the chart sits in), `limit` of them from the first, each with the label operand `x.label` and the number operand `y` read from the
 * item. A `source` series compiles only once records flows exist (see `chart-source.ts`).
 */
const chartSeries = z.discriminatedUnion('type', [
  object({ type: z.literal('literal'), points: z.array(chartPoint).min(1).max(100) }),
  object({ type: z.literal('source'), providerId: id.optional(), limit: integer(1, 100), x: object({ label: operandBase }), y: operandBase }),
]);
/**
 * The scale of a chart's value axis. `ceiling`: the highest value rounded up to the next `step`, at least `min` and at most `max`, from 0. `fixed`: from `min`
 * to `max`. `two-step`: two equal "nice" steps (a factor times a power of ten, from `factors`) up to a top at least the highest value, no step below
 * `minimumStep`, no label with more than `maximumFractionDigits` places (default 3).
 */
const chartDomain = z.discriminatedUnion('type', [
  object({ type: z.literal('ceiling'), step: z.number().min(0.000001).max(1e9), min: z.number().min(0).max(1e9), max: z.number().min(0).max(1e9) }),
  object({ type: z.literal('fixed'), min: z.number().min(-1e9).max(1e9), max: z.number().min(-1e9).max(1e9) }),
  object({ type: z.literal('two-step'), minimumStep: operandBase, maximumFractionDigits: integer(0, 6).optional(), factors: z.array(z.number().min(0.000001).max(10)).min(2).max(16).optional() }),
]);
/** The labels beside the plot and the lines across it: `levels` of each, evenly from the top of the axis to its base. */
const chartAxis = object({
  levels: integer(2, 6), label: object({ pattern: text(40), digits: integer(0, 6).optional() }).optional(),
  gridInk: inkSchema.optional(), labelInk: inkSchema.optional(),
});
/** What a bar looks like: the space between bars, the corner radius, the least height of a bar above zero and of an unknown one, and the ink of an unknown one. */
const chartBar = object({
  gap: z.number().min(0).max(16).optional(), radius: z.number().min(0).max(16).optional(), minimum: z.number().min(0).max(8).optional(), unknownInk: inkSchema.optional(),
});
/** What a line, or the edge of an area, looks like: its width in points and whether each known value gets a dot. */
const chartLine = object({ width: z.number().min(0.5).max(8).optional(), dots: z.boolean().optional() });
/**
 * A chart of one series (`sh.chart@1`): bars, a line, or a line over a filled area, in one `tint`, on an axis with thinned labels. It is one accessibility
 * element named by `a11y.label` whose value is the series read out ("Now 94%, 7 PM 40%"); the axis, the marks and the labels are not read separately.
 */
const chartNode = object({
  ...node, type: z.literal('chart'),
  props: object({
    mark: z.enum(['bar', 'line', 'area']), series: chartSeries, domain: chartDomain, tint: inkSchema,
    axis: chartAxis.optional(), bar: chartBar.optional(), line: chartLine.optional(),
    /** The plot's height in points. Absent: 76. */
    height: integer(40, 320).optional(),
    /** Which labels under the plot show: `fit` thins them to the width, `all` shows every one, `none` shows none. Absent: `fit`. */
    labels: z.enum(['fit', 'all', 'none']).optional(),
    /** What is drawn where there is no series or no value is known. */
    emptyText: text(240),
  }),
  a11y: object({ label: textValue(240, false), value: z.literal('series').optional() }),
});
const gaugeStop = object({ at: z.number().min(0).max(1), ink: inkSchema });
/**
 * A rail (`sh.linear-gauge@1`): a track, an optional span and an optional marker. The `value` and the span's `start` and `size` are operands from 0 to 1
 * (`scale` `unit`, the default) or 0 to 100 (`percent`); no value hides the marker. `fill` says whether the `stops` gradient colours the whole track
 * (`scale`) or only the span (`span`).
 */
const gaugeNode = object({
  ...node, type: z.literal('linear-gauge'),
  props: object({
    value: operandBase.optional(), scale: z.enum(['unit', 'percent']).optional(),
    span: object({ start: operandBase, size: operandBase }).optional(),
    fill: z.enum(['scale', 'span']), stops: z.array(gaugeStop).max(8), track: inkSchema,
    marker: object({ size: z.number().min(6).max(32), ink: inkSchema, border: object({ ink: inkSchema, width: z.number().min(0.5).max(4) }).optional() }).optional(),
    /** The rail's height in points. Absent: 12. */
    height: z.number().min(4).max(32).optional(),
    /** Whether a change glides (unless Reduce Motion is on). Absent: it does. */
    animates: z.boolean().optional(),
  }),
  a11y: z.discriminatedUnion('element', [
    object({ element: z.literal('hidden') }),
    object({ element: z.literal('value'), label: textValue(240, false), value: textValue(240, true).optional() }),
  ]),
});
export type ChartNode = z.infer<typeof chartNode>;
export type ChartSeries = z.infer<typeof chartSeries>;
export type ChartDomain = z.infer<typeof chartDomain>;
export type LinearGaugeNode = z.infer<typeof gaugeNode>;

/**
 * A use of a saved component (`sh.component-ref@1`): the library entry `componentId` stands where this node sits. Its only own fields are its id, the
 * entry it names, its width and the argument of each parameter the entry declares. It has no title, rule, props or children: the entry's body is all of them.
 */
const componentRef = object({
  id, type: z.literal('component-ref'), componentId: id, layout: object({ span: integer(1, 4).optional() }),
  /** One argument per declared parameter, by parameter name (up to 16): the value each bound field takes in this use. */
  args: z.record(z.string().max(80), text(240)).optional(),
});
export type ComponentRefNode = z.infer<typeof componentRef>;

// MARK: Dial and arc track (`sh.dial@1`, `sh.arc-track@1`)
const dialShare = z.number().min(0).max(1);
/**
 * How a pointer's value is read: a share of the sweep from 0 to 1 (`unit`, the default), from 0 to 100 (`percent`), or degrees of a full turn (`degrees`, which
 * needs a sweep of 360). A share outside the sweep is held at its end; on a full turn it wraps round. No value hides the pointer.
 */
const dialScale = z.enum(['unit', 'percent', 'degrees']);
/** One ring of tick marks: how many, where the ring starts and ends as a share of the radius, how thick, and every second tick's own inner end. */
const dialTicks = object({
  count: integer(2, 120), inner: dialShare, outer: dialShare, width: z.number().min(0.5).max(6), ink: inkSchema,
  /** The inner end of the odd ticks (0 is the first), for a ring of long and short ticks. */
  alternate: object({ inner: dialShare }).optional(),
  /** Tick indexes that are not drawn, because something else stands there (a flag). */
  skip: z.array(integer(0, 119)).max(8).optional(),
});
/**
 * What points at the value: `tick` lights one tick across the ring, between `inner` and `outer` (shares of the radius); `needle` is the one closed needle style,
 * a head, a tail and a dot, in three inks, that turns to the value and, on a full turn, the short way round (unless Reduce Motion is on, or `animates` is false).
 */
const dialPointer = z.discriminatedUnion('kind', [
  object({ kind: z.literal('tick'), value: operandBase, inner: dialShare, outer: dialShare, width: z.number().min(0.5).max(8), ink: inkSchema }),
  object({ kind: z.literal('needle'), value: operandBase, ink: inkSchema, tailInk: inkSchema, dotInk: inkSchema, animates: z.boolean().optional() }),
]);
/**
 * A circular gauge (`sh.dial@1`): ticks along a sweep, letters round the rim, a flag, a pointer at a value, and up to three lines of text in the middle. The
 * dial is as wide as `size` (scaled with the text size) or the room it has, up to `maxWidth`, and `aspect` wide to 1 tall; the centre sits `centerY` down.
 * It is read as one meter when its `a11y` names it, else hidden; the text in the middle and the letters are not read on their own.
 */
const dialNode = object({
  ...node, type: z.literal('dial'),
  props: object({
    sweep: object({ start: z.number().min(-360).max(360), length: z.number().min(1).max(360) }),
    scale: dialScale.optional(),
    aspect: z.number().min(0.5).max(2).optional(), centerY: z.number().min(0).max(1).optional(),
    size: object({ points: z.number().min(16).max(512), relativeTo: z.enum(textSizeStyles).optional(), maxPoints: z.number().min(16).max(1024).optional() }).optional(),
    maxWidth: z.number().min(16).max(1024).optional(),
    ticks: dialTicks.optional(), pointer: dialPointer.optional(),
    labels: object({ ink: inkSchema, items: z.array(object({ at: z.number().min(0).max(1), text: text(8), needsValue: z.boolean().optional() })).min(1).max(12) }).optional(),
    flag: object({ at: z.number().min(0).max(1), ink: inkSchema }).optional(),
    /** Text drawn in the middle, a line each, from the top: the same props as a `text`. */
    center: z.array(textNode.shape.props).min(1).max(3).optional(),
    /** Whether a right-to-left layout flips the sweep. Absent: it does not (a dial is an instrument in space). */
    mirrors: z.boolean().optional(),
  }),
  a11y: z.discriminatedUnion('element', [
    object({ element: z.literal('hidden') }),
    object({ element: z.literal('value'), label: textValue(240, false), value: textValue(240, true).optional() }),
  ]),
});
const arcPoint = z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]);
/**
 * An arc with a marker (`sh.arc-track@1`): a curve (a quadratic Bezier from `from` to `to`, bent toward `control`) in a `box` whose shape sets the height, an
 * optional horizon line, and a marker at `progress` along the curve. It is as wide as the room allows up to `maxWidth`. Line widths, dashes and the marker are
 * points and do not scale. No progress hides the marker. Read as one meter when its `a11y` names it, else hidden.
 */
const arcTrackNode = object({
  ...node, type: z.literal('arc-track'),
  props: object({
    curve: object({ from: arcPoint, control: arcPoint, to: arcPoint }),
    box: z.tuple([z.number().min(1).max(1000), z.number().min(1).max(1000)]),
    maxWidth: z.number().min(16).max(1024).optional(),
    ink: inkSchema, width: z.number().min(0.5).max(8), dash: z.tuple([z.number().min(0.5).max(32), z.number().min(0.5).max(32)]).optional(),
    horizon: object({ from: arcPoint, to: arcPoint, ink: inkSchema, width: z.number().min(0.5).max(8) }).optional(),
    progress: operandBase.optional(), scale: z.enum(['unit', 'percent']).optional(),
    marker: object({ size: z.number().min(6).max(32), ink: inkSchema }).optional(),
    /** Whether a right-to-left layout mirrors the arc, so progress still runs from the reading start. Absent: it does. */
    mirrors: z.boolean().optional(),
  }),
  a11y: z.discriminatedUnion('element', [
    object({ element: z.literal('hidden') }),
    object({ element: z.literal('value'), label: textValue(240, false), value: textValue(240, true).optional() }),
  ]),
});
export type DialNode = z.infer<typeof dialNode>;
export type ArcTrackNode = z.infer<typeof arcTrackNode>;
/** Where a tab container's bar sits and how it labels its tabs (`sh.tab-bar@1`). `pinned: true` keeps meaning bottom with automatic labels. */
export type TabBar = { placement: 'bottom' | 'top'; labels: 'by-size' | 'icons' | 'titles' | 'icons-and-titles' };
/** One area of a tab container (`sh.tab-blocks@1`): children drawn once for `tabs` (every tab, or the listed ones), in order with the other areas. */
export type TabBlock = { id: string; tabs: 'all' | string[]; visibleWhen?: Predicate; whenUnknown?: WhenUnknown; children: CompositionNode[] };
export type CompositionNode = ComponentRefNode | z.infer<typeof settingsControl> | z.infer<typeof customLightControl> | z.infer<typeof sprinklerControl>
 | z.infer<typeof infoBox> | z.infer<typeof statusPill> | z.infer<typeof textNode> | z.infer<typeof collection> | z.infer<typeof recordForm>
 | z.infer<typeof recipePart> | (z.infer<typeof pinnedActions> & { children?: CompositionNode[] }) | z.infer<typeof navigationTile> | z.infer<typeof actionTile> | z.infer<typeof stateTile> | z.infer<typeof row> | z.infer<typeof localControl> | z.infer<typeof boundControl> | z.infer<typeof button> | z.infer<typeof rowCollection> | z.infer<typeof statusChip> | z.infer<typeof roomOverviewTile> | z.infer<typeof lightGroupTile> | z.infer<typeof weatherPanel> | z.infer<typeof alarmPanel> | z.infer<typeof doorTile> | z.infer<typeof climateNode> | z.infer<typeof settingsLink> | z.infer<typeof roomCard> | z.infer<typeof roomChip> | z.infer<typeof roomNavigationGrid> | z.infer<typeof roomDeviceControlSchema> | z.infer<typeof bedroomControl> | z.infer<typeof remoteNode> | VacuumControl | z.infer<typeof accountHeader> | z.infer<typeof cameraTile> | z.infer<typeof cameraVideo> | z.infer<typeof cameraControls> | z.infer<typeof cameraViewer> | z.infer<typeof bootstrapMessage> | z.infer<typeof notificationBanner> | {
  id: string; title: string; type: 'tile-grid'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: z.infer<typeof gridProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'section'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: z.infer<typeof sectionProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'paged-row'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: z.infer<typeof pagedRowProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'local-tabs'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: { stateId: string; transition: 'canonical-swap@1'; resetOnPresentation?: boolean; pinned?: boolean;
    scopeProviderId?: string; showsSelector?: boolean; retainsAutomaticSelection?: boolean;
    automatic?: { tabId: string; selectedWhen: Predicate }[]; fallbackTabId?: string; tabBar?: TabBar };
  tabs: { id: string; label: string; children: CompositionNode[]; icon?: z.infer<typeof symbol>; centerWhenFits?: boolean; visibleWhen?: Predicate; whenUnknown?: WhenUnknown }[];
  /** The areas, in draw order (`sh.tab-blocks@1`); when present every tab's own `children` is empty. */
  blocks?: TabBlock[];
} | {
  id: string; title: string; type: 'overlay'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: { anchors: { childId: string; anchor: OverlayAnchor; inset: z.infer<typeof space> }[] }; children: CompositionNode[];
} | {
  id: string; title: string; type: 'status-rail'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown; props: Record<string, never>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'room-section'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: z.infer<typeof roomSectionProps>; children: CompositionNode[];
} | {
  id: string; title: string; type: 'stack'; layout: { span?: number }; visibleWhen?: Predicate; whenUnknown?: WhenUnknown;
  props: StackProps; action?: CompositionActionSlot; a11y?: StackA11y; children: CompositionNode[];
} | z.infer<typeof shapeNode> | z.infer<typeof symbolPart> | RepeatNode
 | z.infer<typeof chartNode> | z.infer<typeof gaugeNode>
 | z.infer<typeof dialNode> | z.infer<typeof arcTrackNode>;
export const compositionNodeSchema: z.ZodType<CompositionNode> = z.lazy(() => z.discriminatedUnion('type', [
  customLightControl, sprinklerControl,
  textNode, navigationTile, actionTile, stateTile, statusChip, roomOverviewTile, lightGroupTile, weatherPanel, alarmPanel, doorTile, settingsLink, roomCard, roomChip, roomNavigationGrid, roomDeviceControlSchema, bedroomControl, remoteNode, vacuumControlSchema, cameraTile, cameraVideo, cameraControls, cameraViewer,
  object({ ...node, type: z.literal('tile-grid'), props: gridProps, children: z.array(compositionNodeSchema).max(100) }),
  row, localControl, boundControl, button, rowCollection, collection, recordForm, recipePart,
  pinnedActions.extend({ children: z.array(compositionNodeSchema).max(1).optional() }),
  infoBox, statusPill,
  object({ ...node, type: z.literal('paged-row'), props: pagedRowProps, children: z.array(compositionNodeSchema).max(100) }),
  object({ ...node, type: z.literal('section'), props: sectionProps, children: z.array(compositionNodeSchema).max(100) }),
  object({ ...node, type: z.literal('local-tabs'), props: object({ stateId: id, transition: z.literal('canonical-swap@1'), resetOnPresentation: z.boolean().optional(), pinned: z.boolean().optional(),
    scopeProviderId: id.optional(), showsSelector: z.boolean().optional(), retainsAutomaticSelection: z.boolean().optional(),
    automatic: z.array(object({ tabId: id, selectedWhen: predicateSchema })).max(5).optional(),
    /** The tab to open when the one the container would choose cannot be shown (`sh.tab-fallback@1`); absent means the first tab. */
    fallbackTabId: id.optional(),
    /** Where the bar sits and how it labels its tabs (`sh.tab-bar@1`). */
    tabBar: object({ placement: z.enum(['bottom', 'top']), labels: z.enum(['by-size', 'icons', 'titles', 'icons-and-titles']) }).optional() }),
    tabs: z.array(object({ id, label, children: z.array(compositionNodeSchema).max(100), icon: symbol.optional(), centerWhenFits: z.boolean().optional(), ...visibilityFields })).min(2).max(5),
    blocks: z.array(object({ id, tabs: z.union([z.literal('all'), z.array(id).min(1).max(5)]), ...visibilityFields, children: z.array(compositionNodeSchema).max(100) })).max(40).optional() }),
  object({ ...node, type: z.literal('overlay'), props: object({ anchors: z.array(object({ childId: id, anchor: z.enum(overlayAnchors), inset: space })).max(4) }),
    children: z.array(compositionNodeSchema).max(5) }),
  object({ ...node, type: z.literal('status-rail'), props: empty, children: z.array(compositionNodeSchema).max(20) }),
  climateNode,
  object({ ...node, type: z.literal('room-section'), props: roomSectionProps, children: z.array(compositionNodeSchema).max(100) }),
  accountHeader, settingsControl,
  bootstrapMessage, notificationBanner,
  componentRef,
  object({ ...node, type: z.literal('stack'), props: stackProps, action: ruledAction.optional(), a11y: stackA11y.optional(), children: z.array(compositionNodeSchema).max(100) }),
  shapeNode, symbolPart,
  object({ ...node, type: z.literal('repeat'), props: repeatProps, children: z.array(compositionNodeSchema).min(1).max(2) }),
  chartNode, gaugeNode,
  dialNode, arcTrackNode,
]));
export function compositionChildren(node: CompositionNode): CompositionNode[] {
  return node.type === 'tile-grid' || node.type === 'overlay' || node.type === 'stack' || node.type === 'repeat' || node.type === 'section' || node.type === 'status-rail' || node.type === 'room-section' || node.type === 'paged-row' ? node.children
    : node.type === 'local-tabs' ? [...node.tabs.flatMap(tab => tab.children), ...(node.blocks ?? []).flatMap(block => block.children)]
      : node.type === 'pinned-actions' ? node.children ?? [] : [];
}
/**
 * What a parameter of a saved component takes: an identifier of a data source, a page, a sheet or a local state field, a Home Assistant entity id
 * (`domain.object`), a plain string, or an SF Symbol name.
 */
export const componentParamKinds = ['source-id', 'page-id', 'modal-id', 'entity-id', 'state-id', 'text', 'symbol'] as const;
export type ComponentParamKind = typeof componentParamKinds[number];
/** The most parameters, bindings and private sources one saved component declares. */
export const COMPONENT_ENTRY_LIMITS = { params: 16, bindings: 128, sources: 8, flows: 8 } as const;
/**
 * One saved component of the document's library (`sh.component-ref@1`). `node` is one node and everything inside it, written once and used by
 * reference. `params` name the per-use settings (each with an optional `label` the Studio shows instead of the name), and `bindings` say which field
 * each one fills: of an inner node, by the node's id and a slash path under it (`props/sourceId`), or of one of the entry's own `sources`, by the
 * source's id and a path under it (`entityId/value`). The field's value in the body or source is the parameter's default.
 *
 * `sources` are data sources the component owns: every use gets its own copy with the id `<reference id>~<source id>`, and a `sourceId` in the
 * body that names one is rewritten to it. `flows` (`sh.repeat@1`) are Data Flows it owns, copied and renamed the same way, which a `repeat` in the body reads. `origin` records which kit the entry was copied from; the app ignores it.
 */
export const componentEntrySchema = object({
  id,
  name: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  origin: object({ id, version: integer(1, 9999) }).optional(),
  params: z.array(object({ name: id, kind: z.enum(componentParamKinds), label: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).optional() }))
    .max(COMPONENT_ENTRY_LIMITS.params).optional(),
  sources: z.array(object({ id, kind: z.literal('ha-entity'), entityId: object({ type: z.literal('literal'), value: text(160) }) }))
    .max(COMPONENT_ENTRY_LIMITS.sources).optional(),
  /** Data Flows the component owns (`sh.repeat@1`): each use gets its own copy, named like an owned source, and a `providerId` or `sourceId` in the body that names one is rewritten to it. */
  flows: z.array(pipelineSourceSchema).max(COMPONENT_ENTRY_LIMITS.flows).optional(),
  bindings: z.array(object({ param: id, nodeId: id.optional(), sourceId: id.optional(), field: text(160) }))
    .max(COMPONENT_ENTRY_LIMITS.bindings).optional(),
  node: compositionNodeSchema,
});
export type ComponentEntry = z.infer<typeof componentEntrySchema>;
const surface = {
  id, title, icon: symbol, parameters: empty, toolbar, titleSourceId: id.optional(),
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
/**
 * One record page of todo lists: the definition the app used to read from house configuration's `chores.pages`. A `collection`
 * node with the `todo` template names this source's id as its provider; its forms are `<id>-add` and `<id>-edit`.
 * A list's `visibleWhen` accepts only a viewer rule naming user ids, hidden until the user is known (a list is read where
 * only the user id is known).
 */
const todoEntity = object({ type: z.literal('literal'), value: text(160) });
export const todoCollectionSource = object({
  id, kind: z.literal('model'), model: z.literal('todo-collection@1'),
  inputs: object({
    title,
    lists: z.array(object({
      title: label, entityId: todoEntity, completionScript: todoEntity.optional(),
      hideCompleted: z.boolean(), hideWhenNoOpenItems: z.boolean(), ...visibilityFields,
    })).min(1).max(32),
    addAction: z.discriminatedUnion('type', [
      object({ type: z.literal('task'), defaultAssignee: text(160, true) }),
      object({ type: z.literal('grocery'), entityId: todoEntity }),
      object({ type: z.literal('admin'), entityId: todoEntity }),
    ]),
    hideListHeaders: z.boolean(), hiddenByVacation: z.boolean(),
    empty: object({ title, description: text(2000, true) }),
    personalization: object({ residentId: id, ownTitle: title, otherTitle: title, ownEmptyDescription: text(2000, true).optional() }).optional(),
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
    todoCollectionSource,
    pipelineSourceSchema,
    appStateSourceSchema,
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
/** A plain route path: lower-case, hyphenated. Aliases and link prefixes follow the same rule as `path`. */
const routePath = text(80).regex(/^[a-z][a-z0-9-]{0,79}$/);
export const extensionPresentationSchema = object({
  type: z.literal('native-extensions@1'), watch: z.literal('stub@1'),
  routes: z.array(object({
    id, path: text(80).regex(/^[a-z][a-z0-9-]{0,79}$/), pageId: id,
    title: label.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    summary: title.refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
    icon: text(80).regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
    tabId: id.optional(), anchors: z.array(object({ fragment: id, modalId: id })).max(32).optional(),
    /** Other paths that open the route (older links); unique across every route path and alias. */
    aliases: z.array(routePath).max(8).optional(),
    /** Words that find the route in Spotlight and Siri besides its title. */
    keywords: z.array(text(40).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value))).max(12).optional(),
    /** Whether Siri and Shortcuts suggest the route by name. Every route can still be named in a phrase. */
    siri: z.boolean().optional(),
    /** Viewer predicates only: the catalog is built without entity state. The compiler rejects anything else. */
    visibleWhen: predicateSchema.optional(),
  })).max(64),
  /** The first path segments that mark a link as the dashboard's. The app reads three legacy slugs while this is absent. */
  linkPrefixes: z.array(routePath).min(1).max(8).optional(),
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
    tabs: z.array(object({ id, label, icon: symbol, pageId: id, arguments: empty, ...visibilityFields, ...badgeField })).max(8),
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
  /** The style library `state-tile` nodes apply by id (`sh.state-style@1`). */
  stateStyles: stateStyleLibrarySchema.optional(),
  /** The saved components `component-ref` nodes use by id (`sh.component-ref@1`). Absent means none. */
  componentLibrary: z.array(componentEntrySchema).max(100).optional(),
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
export { type Operand, type Predicate, type CallService } from './expression';
export type CompositionGroups = z.infer<typeof groups>;
export type CompositionRead = z.infer<typeof read>;
export type CompositionValue = z.infer<ReturnType<typeof value>> | z.infer<ReturnType<typeof textValue>>;
