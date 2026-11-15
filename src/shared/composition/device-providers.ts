import { z } from 'zod/v4';
import { identifierSchema as id } from '../schema';
import { remoteSlotCalls, serviceCallAllowed } from './service-vocabulary';
import { visibilityFields } from './expression';

const object = z.strictObject;
const text = (max: number, blank = false) => z.string().max(max).refine(v => blank || Boolean(v.trim()));
const title = text(240), label = text(80);
const entity = z.string().max(160).regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/);
const states = z.array(text(160)).max(64);
const dictionary = <K extends z.ZodString, V extends z.ZodType>(key: K, value: V, max: number) =>
  z.record(key, value).refine(v => Object.keys(v).length <= max);
const semantics = z.discriminatedUnion('type', [
  object({ type: z.literal('state') }),
  object({ type: z.literal('toggleOnUnless'), states }),
  object({ type: z.literal('toggleOnWhen'), states }),
  object({ type: z.literal('selectedWhen'), states }),
]);
const command = z.discriminatedUnion('type', [
  object({ type: z.literal('textPrompt'), targetEntityId: entity }),
  object({ type: z.literal('service'), call: object({
    domain: z.enum(['script', 'remote', 'media_player', 'input_button', 'switch', 'select', 'input_select']),
    service: z.string().max(160).regex(/^[a-z][a-z0-9_]*$/), target: entity.optional(),
    data: object({
      command: text(512).optional(), app_id: text(240).optional(), app_name: title.optional(),
      entity: entity.optional(), remote_entity: entity.optional(), entity_id: entity.optional(),
      sonosdevice: z.array(entity).max(16).optional(), speakerdevice: z.array(entity).max(16).optional(),
      turn_on_projector: z.boolean().optional(),
      is_volume_muted: z.boolean().optional(), source: title.optional(), option: title.optional(),
      volume_level: z.number().min(0).max(1).optional(),
    }),
  }), optimistic: z.array(object({ entityId: entity, value: text(160),
    revertAfterSeconds: z.number().min(0.1).max(300), failsOnTimeout: z.boolean() })).max(32) }),
]);
const action = z.discriminatedUnion('type', [
  object({ type: z.literal('command'), command }),
  object({ type: z.literal('state'), entityId: entity.optional(),
    cases: z.array(object({ states, command })).max(32), otherwise: command }),
]);
const remoteButton = object({ label: title, icon: text(80, true),
  iconRotationDegrees: z.number().min(-360).max(360), action, semantics: semantics.optional(),
  iconColorRule: object({ entityIds: z.array(entity).min(1).max(32), inactiveStates: states,
    inactiveStatesByEntity: dictionary(entity, states, 32) }).optional(),
});
const remoteDevice = object({ title, entityId: entity, icon: text(80), action: action.optional(),
  activeHoldSeconds: z.number().min(0).max(300).optional(), activeHoldResetEntityIds: z.array(entity).max(32),
  activeStates: states, semantics: semantics.optional(), stateEntityIds: z.array(entity).min(1).max(32).optional(),
  stateLabels: dictionary(text(160), title, 64),
  stateResolver: object({ configuredConsole: object({
    cloudEntityId: entity, hdmiEntityId: entity, tvEntityId: entity, powerEntityId: entity, inputEntityId: entity,
    activeStates: states, inputSuffix: label, linkedState: label,
  }) }).optional(),
});
export const remoteConfigurationSchema = object({
  id, title, roomTitle: title, remoteTitle: title, mediaEntityId: entity, controlEntityId: entity,
  volumeTitle: title, volumeEntityId: entity, showVolumeWhenOff: z.boolean(), hideKeyboardWhenOff: z.boolean(),
  appSectionTitle: title, optimisticEntityIds: z.array(entity).max(64), liveChangeEntityIds: z.array(entity).max(64),
  power: remoteButton, up: remoteButton, left: remoteButton, select: remoteButton, right: remoteButton,
  down: remoteButton, back: remoteButton, home: remoteButton, pause: remoteButton, play: remoteButton,
  volumeDown: remoteButton, volumeMute: remoteButton, volumeUp: remoteButton, keyboard: remoteButton.optional(),
  apps: z.array(object({ title, action,
    imagePath: z.string().max(512).regex(/^\/local\/[A-Za-z0-9_./ -]+$/).optional(), icon: text(80).optional(),
    whiteBackground: z.boolean(), stateEntityId: entity.optional(), activeStates: states, semantics: semantics.optional(),
  })).max(64),
  devices: z.array(remoteDevice).max(64),
  cards: z.array(object({ key: id, configuration: remoteDevice })).max(64),
  lightSync: object({ powerEntityId: entity, lightSyncEntityId: entity, syncModeEntityId: entity,
    intensityEntityId: entity, brightnessEntityId: entity, hdmiInputEntityId: entity,
    hdmiStatusEntityIds: z.array(entity).max(4) }).optional(),
});
const bedConfiguration = object({
  id, title, side: z.enum(['left', 'right']), owner: id, climateEntityId: entity, targetLevelEntityId: entity,
  schedulePhaseEntityId: entity, stageLevelEntityIds: object({ bedtime: entity, asleep: entity, dawn: entity }),
  alarmStateEntityId: entity,
  alarmSnoozeButtonEntityId: entity, alarmStopButtonEntityId: entity, hotFlashActiveEntityId: entity,
  hotFlashButtonEntityId: entity, hotFlashCancelButtonEntityId: entity, hotFlashRestoreAtEntityId: entity,
  hotFlashTimerEntityId: entity, heartRateEntityId: entity, breathingRateEntityId: entity, hrvEntityId: entity,
  pumpClogEntityId: entity, pumpStallEntityId: entity, pumpLoopTemperatureEntityId: entity, pumpRpmEntityId: entity,
});
export const bedroomConfigurationSchema = object({
  wakeProviderId: id, beds: z.array(object({ providerId: id, configuration: bedConfiguration })).min(1).max(2),
  environment: object({
    scheduleEntityId: entity, householdAwayEntityId: entity,
    wakeLight: object({ id, title, roomTitle: title, statusEntityId: entity, sources: z.array(object({
      id: text(160), side: z.enum(['left', 'right']), alarmLabel: title, alarmsLabel: title, bedId: id,
    })).max(2) }),
  }),
});
export const customLightsConfigurationSchema = object({
  sectionTitle: title, manualTitle: title, modeTitle: title, manualEntityId: entity, modeEntityId: entity,
  groupEntityId: entity, customMode: title, fallbackModes: z.array(title).min(1).max(64),
  palettes: z.array(object({ mode: title, colors: z.array(object({
    red: z.number().int().min(0).max(255), green: z.number().int().min(0).max(255), blue: z.number().int().min(0).max(255),
  })).max(64) })).max(64), lights: z.array(object({ title, entityId: entity })).min(1).max(100),
  resetKelvin: z.number().int().min(1000).max(10000), resetBrightness: z.number().int().min(1).max(255),
  resetTransition: z.number().int().min(0).max(3600),
});
export const sprinklerConfigurationSchema = object({
  controller: object({
    id, title, batteryEntityId: entity, faultEntityId: entity, hubConnectedEntityId: entity, modeEntityId: entity,
    nextWateringEntityId: entity, rainDelayEntityId: entity, smartWateringEntityId: entity, stateEntityId: entity,
    zones: z.array(object({ historyEntityId: entity, programEntityId: entity, valveEntityId: entity })).min(1).max(32),
  }),
  lowBatteryPercent: z.number().min(0).max(100),
  defaultStartTime: z.string().max(5).regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
});
export const deviceProviderSchemas = [
  object({ id, kind: z.literal('model'), model: z.literal('media-remote-config@1'), inputs: remoteConfigurationSchema }),
  object({ id, kind: z.literal('model'), model: z.literal('bedroom-config@1'), inputs: bedroomConfigurationSchema }),
  object({ id, kind: z.literal('model'), model: z.literal('custom-lights@1'), inputs: customLightsConfigurationSchema }),
  object({ id, kind: z.literal('model'), model: z.literal('sprinkler-controller@1'), inputs: sprinklerConfigurationSchema }),
] as const;
export const deviceProviderSourceSchema = z.discriminatedUnion('model', deviceProviderSchemas);
export type DeviceProviderSource = z.infer<typeof deviceProviderSourceSchema>;
export const deviceProviderCapabilities = deviceProviderSchemas.map(s => `sh.${s.shape.model.value}`);
export function remoteUsesSpeakerTargets(value: unknown): boolean {
  return value !== null && typeof value === 'object'
    && (Object.hasOwn(value, 'speakerdevice') || Object.values(value).some(remoteUsesSpeakerTargets));
}
export function isDeviceProvider(source: { kind: string; model?: string }): source is DeviceProviderSource {
  return source.kind === 'model' && deviceProviderSchemas.some(s => s.shape.model.value === source.model);
}

/** Semantic parity with ServerUIDeviceProviderValidation; paths are relative to inputs. */
export function deviceProviderIssues(source: DeviceProviderSource): string[] {
  const issues: string[] = [];
  const invalid = (field: string) => { issues.push(`/${field}`); };
  const unique = (values: string[], field: string) => { if (new Set(values).size !== values.length) invalid(field); };
  const domain = (value: string, allowed: string[], field: string) => {
    if (!allowed.includes(value.split('.')[0])) invalid(field);
  };
  switch (source.model) {
    case 'media-remote-config@1': {
      const c = source.inputs;
      unique([...c.cards.map(v => v.key), ...c.devices.map(v => v.title)], 'cards');
      unique(c.apps.map(v => v.title), 'apps'); unique(c.devices.map(v => v.title), 'devices');
      unique(c.optimisticEntityIds, 'optimisticEntityIds'); unique(c.liveChangeEntityIds, 'liveChangeEntityIds');
      domain(c.mediaEntityId, ['media_player'], 'mediaEntityId'); domain(c.volumeEntityId, ['media_player'], 'volumeEntityId');
      if (c.liveChangeEntityIds.some(v => !c.optimisticEntityIds.includes(v))) invalid('liveChangeEntityIds');
      for (const group of remoteSlotCalls(c)) {
        if (!group.calls.every(serviceCallAllowed)) invalid(group.field);
      }
      c.apps.forEach((v, i) => { if (v.imagePath?.split('/').includes('..')) invalid(`apps/${i}/imagePath`); });
      const validateDevice = (v: (typeof c.devices)[number], path: string) => {
        const r = v.stateResolver?.configuredConsole;
        if (r && [r.cloudEntityId, r.hdmiEntityId, r.tvEntityId, r.powerEntityId, r.inputEntityId]
          .some(id => !(v.stateEntityIds ?? [v.entityId]).includes(id))) invalid(`${path}/stateEntityIds`);
      };
      c.devices.forEach((v, i) => validateDevice(v, `devices/${i}`));
      c.cards.forEach((v, i) => validateDevice(v.configuration, `cards/${i}/configuration`));
      break;
    }
    case 'bedroom-config@1': {
      const c = source.inputs;
      unique([...c.beds.map(v => v.providerId), c.wakeProviderId], 'beds');
      unique(c.beds.map(v => v.configuration.id), 'beds'); unique(c.beds.map(v => v.configuration.side), 'beds');
      unique(c.environment.wakeLight.sources.map(v => v.id), 'environment/wakeLight/sources');
      unique(c.environment.wakeLight.sources.map(v => v.side), 'environment/wakeLight/sources');
      c.environment.wakeLight.sources.forEach((v, i) => {
        if (!c.beds.some(b => b.configuration.id === v.bedId && b.configuration.side === v.side))
          invalid(`environment/wakeLight/sources/${i}/bedId`);
      });
      c.beds.forEach(({ configuration: b }, i) => {
        domain(b.climateEntityId, ['climate'], `beds/${i}/configuration/climateEntityId`);
        Object.entries(b.stageLevelEntityIds).forEach(([key, value]) => domain(value, ['input_number'], `beds/${i}/configuration/stageLevelEntityIds/${key}`));
      });
      domain(c.environment.scheduleEntityId, ['sensor'], 'environment/scheduleEntityId');
      domain(c.environment.wakeLight.statusEntityId, ['sensor'], 'environment/wakeLight/statusEntityId');
      break;
    }
    case 'custom-lights@1': {
      const c = source.inputs;
      const invalidDomain = (value: string, allowed: string[]) => !allowed.includes(value.split('.')[0]);
      if (new Set(c.fallbackModes).size !== c.fallbackModes.length || !c.fallbackModes.includes(c.customMode)
        || new Set(c.palettes.map(v => v.mode)).size !== c.palettes.length
        || c.palettes.some(v => !c.fallbackModes.includes(v.mode) || v.mode === c.customMode)
        || invalidDomain(c.manualEntityId, ['input_boolean', 'switch']) || invalidDomain(c.modeEntityId, ['input_select', 'select'])
        || invalidDomain(c.groupEntityId, ['light']) || new Set(c.lights.map(v => v.entityId)).size !== c.lights.length
        || c.lights.some(v => invalidDomain(v.entityId, ['light']))) invalid('lights');
      break;
    }
    case 'sprinkler-controller@1': {
      const c = source.inputs.controller;
      unique(c.zones.map(v => v.valveEntityId), 'controller/zones'); unique(c.zones.map(v => v.programEntityId), 'controller/zones');
      const domains = { batteryEntityId: 'sensor', faultEntityId: 'binary_sensor', hubConnectedEntityId: 'binary_sensor',
        modeEntityId: 'select', nextWateringEntityId: 'sensor', stateEntityId: 'sensor', rainDelayEntityId: 'switch', smartWateringEntityId: 'switch' } as const;
      for (const key of Object.keys(domains) as (keyof typeof domains)[]) domain(c[key], [domains[key]], `controller/${key}`);
      c.zones.forEach((v, i) => {
        domain(v.valveEntityId, ['valve'], `controller/zones/${i}/valveEntityId`);
        domain(v.programEntityId, ['switch'], `controller/zones/${i}/programEntityId`);
        domain(v.historyEntityId, ['sensor'], `controller/zones/${i}/historyEntityId`);
      });
    }
  }
  return issues;
}

export function deviceControlSchemas<A extends z.ZodType>(action: A) {
  const node = { id, title, layout: object({ span: z.number().int().min(1).max(4) }), ...visibilityFields };
  const base = { sourceId: id };
  const zone = z.number().int().min(0).max(31);
  const confirmation = object({ title, message: text(2000), confirmLabel: label, cancelLabel: z.literal('Cancel') });
  return [
    object({ ...node, type: z.literal('custom-light-control'), props: z.discriminatedUnion('kind', [
      object({ ...base, kind: z.literal('manual') }), object({ ...base, kind: z.literal('mode') }),
      object({ ...base, kind: z.literal('brightness'), entityId: entity, action: action.optional() }),
      object({ ...base, kind: z.literal('color'), entityId: entity }),
      object({ ...base, kind: z.literal('reset'), entityId: entity }),
      object({ ...base, kind: z.literal('reset-all'), confirmation }),
      object({ ...base, kind: z.literal('apply-all'), entityId: entity, confirmation }),
      object({ ...base, kind: z.literal('copy-color'), entityId: entity, copySourceId: entity }),
    ]) }),
    object({ ...node, type: z.literal('sprinkler-control'), props: z.discriminatedUnion('kind', [
      object({ ...base, kind: z.literal('card'), action }), object({ ...base, kind: z.literal('status') }),
      object({ ...base, kind: z.literal('zone'), zone, action }), object({ ...base, kind: z.literal('program'), zone, action }),
      object({ ...base, kind: z.literal('rain-delay') }), object({ ...base, kind: z.literal('smart-watering') }),
      object({ ...base, kind: z.literal('stop') }), object({ ...base, kind: z.literal('duration'), zone }),
      object({ ...base, kind: z.literal('presets'), zone }), object({ ...base, kind: z.literal('start'), zone }),
      object({ ...base, kind: z.literal('days'), zone }), object({ ...base, kind: z.literal('times'), zone }),
      object({ ...base, kind: z.literal('budget'), zone }), object({ ...base, kind: z.literal('apply'), zone }),
      object({ ...base, kind: z.literal('reload'), zone }),
      object({ ...base, kind: z.literal('program-enabled'), zone }),
      object({ ...base, kind: z.literal('start-program'), zone }),
      object({ ...base, kind: z.literal('water-blocker') }),
    ]) }),
  ] as const;
}
