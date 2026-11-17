import { z } from 'zod/v4';
import { identifierSchema } from '../validation';
import type { CompositionIssue } from './json';
import { symbolUnavailable } from './symbol-unavailable';

const object = z.strictObject;
const text = (max: number, blank = false) => z.string().max(max).refine(value => blank || Boolean(value.trim()));
const entity = text(160), title = text(240), id = identifierSchema;
const symbol = object({ type: z.literal('sf-symbol'), name: text(80), rendering: z.literal('canonical'), unavailable: symbolUnavailable });
export const deviceModels = ['air-purifier@1', 'bathroom-fan@1', 'grill@1', 'humidifier@1'] as const;
export const deviceDomains: Record<typeof deviceModels[number], Record<string, string>> = {
  'air-purifier@1': { pm25EntityId: 'sensor', aqiEntityId: 'sensor', autoModeEntityId: 'select', fanEntityId: 'fan', modeEntityId: 'select' },
  'bathroom-fan@1': {
    autoUnlockEntityId: 'input_boolean', deadlineEntityId: 'input_datetime', lockEntityId: 'input_boolean',
    pendingEntityId: 'input_boolean', powerEntityId: 'switch', timerEntityId: 'timer',
  },
  'grill@1': { stateEntityId: 'sensor' },
  'humidifier@1': {
    currentHumidityEntityId: 'sensor', currentTemperatureEntityId: 'sensor', displayEntityId: 'switch',
    humidifyingEntityId: 'binary_sensor', mistLevelEntityId: 'number', modeEntityId: 'select', powerEntityId: 'switch',
    scheduleEnabledEntityId: 'input_boolean', scheduleEntityId: 'schedule', tankRemovedEntityId: 'binary_sensor',
    targetHumidityEntityId: 'number', timerMinutesEntityId: 'number', timerRemainingEntityId: 'sensor',
    vacationModeEntityId: 'input_boolean', warmLevelEntityId: 'number', waterLowEntityId: 'binary_sensor',
  },
};
export const roomDeviceSourceSchema = z.discriminatedUnion('model', [
  object({ id, kind: z.literal('model'), model: z.literal('air-purifier@1'), inputs: object({
    roomTitle: title, pm25EntityId: entity, aqiEntityId: entity, autoModeEntityId: entity, fanEntityId: entity, modeEntityId: entity,
  }) }),
  object({ id, kind: z.literal('model'), model: z.literal('bathroom-fan@1'), inputs: object({
    id, roomTitle: title, autoUnlockEntityId: entity, deadlineEntityId: entity, lockEntityId: entity,
    pendingEntityId: entity, powerEntityId: entity, scriptService: entity, timerEntityId: entity,
  }) }),
  object({ id, kind: z.literal('model'), model: z.literal('grill@1'), inputs: object({
    title, roomTitle: title, stateEntityId: entity,
    details: z.array(object({ title, entityId: entity, icon: text(80) })).min(1).max(32),
  }) }),
  object({ id, kind: z.literal('model'), model: z.literal('humidifier@1'), inputs: object({
    id, title, applyProfileScriptService: entity, currentHumidityEntityId: entity, currentTemperatureEntityId: entity,
    displayEntityId: entity, humidifyingEntityId: entity, mistLevelEntityId: entity, modeEntityId: entity,
    powerEntityId: entity, scheduleEnabledEntityId: entity, scheduleEntityId: entity, scheduleId: entity,
    setLevelScriptService: entity, tankRemovedEntityId: entity, targetHumidityEntityId: entity,
    timerMinutesEntityId: entity, timerRemainingEntityId: entity, vacationModeEntityId: entity,
    warmLevelEntityId: entity, waterLowEntityId: entity,
  }) }),
]);
export type RoomDeviceSource = z.infer<typeof roomDeviceSourceSchema>;
export function isRoomDeviceSource(source: { kind: string; model?: string }): source is RoomDeviceSource {
  return source.kind === 'model' && deviceModels.some(model => model === source.model);
}
export const deviceControlKinds = [
  'purifier-mode', 'purifier-auto', 'purifier-speed', 'fan-power', 'fan-lock', 'fan-timer', 'fan-room', 'grill-detail',
  'humidifier-mode', 'humidifier-presets', 'humidifier-warm', 'humidifier-mist', 'humidifier-target',
  'humidifier-power', 'humidifier-display', 'humidifier-timer', 'humidifier-info', 'humidifier-scheduling',
] as const;
export type DeviceControlKind = typeof deviceControlKinds[number];
export function deviceControlModel(kind: DeviceControlKind): RoomDeviceSource['model'] {
  return kind.startsWith('purifier-') ? 'air-purifier@1' : kind.startsWith('fan-') ? 'bathroom-fan@1'
    : kind === 'grill-detail' ? 'grill@1' : 'humidifier@1';
}
export const roomDeviceControlSchema = object({
  id, title, type: z.literal('room-device-control'), layout: object({ span: z.number().int().min(1).max(4).optional() }),
  icon: symbol,
  binding: object({ sourceId: id }),
  props: object({
    control: z.enum(deviceControlKinds),
    family: z.enum(['neutral', 'air', 'security', 'cooking', 'water']),
    options: z.array(object({ value: text(80), label: text(80), actionLabel: title.optional() })).max(12),
    labels: object({
      loading: title, unavailable: title, failed: title, on: title, off: title, action: title, cancel: title, footnote: text(2000, true),
      sleep: title, tankFault: title, waterFault: title, invalidTarget: title, highTarget: title,
    }),
    detailEntityId: entity.optional(),
    info: z.enum(['output', 'water', 'tank', 'mode', 'display', 'warm', 'humidity', 'temperature', 'mist', 'timer']).optional(),
    initialMinutes: z.number().int().min(5).max(60).optional(),
    modalId: id.optional(),
    fanRail: object({
      order: z.array(z.enum(['lock', 'power'])).min(2).max(2),
      powerIcon: symbol, lockedIcon: symbol, unlockedIcon: symbol,
      powerOn: title, powerOff: title, lock: title, unlock: title, locked: title,
    }).optional(),
  }),
});
export type RoomDeviceControl = z.infer<typeof roomDeviceControlSchema>;
type Add = (code: CompositionIssue['code'], path: string) => void;
export function validateDeviceSource(source: RoomDeviceSource, path: string, add: Add) {
  for (const [field, domain] of Object.entries(deviceDomains[source.model])) {
    const value = Reflect.get(source.inputs, field);
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(value)) add('invalid_value', `${path}/inputs/${field}`);
    else if (!value.startsWith(`${domain}.`)) add('invalid_combination', `${path}/inputs/${field}`);
  }
  for (const field of ['scriptService', 'applyProfileScriptService', 'setLevelScriptService', 'scheduleId']) {
    const value = Reflect.get(source.inputs, field);
    if (value !== undefined && (typeof value !== 'string' || !/^[a-z0-9_]+$/.test(value))) add('invalid_value', `${path}/inputs/${field}`);
  }
  if (source.model === 'grill@1') {
    const seen = new Set<string>();
    source.inputs.details.forEach((detail, i) => {
      if (!/^(sensor|switch)\.[a-z0-9_]+$/.test(detail.entityId) || seen.has(detail.entityId)) add('invalid_combination', `${path}/inputs/details/${i}/entityId`);
      seen.add(detail.entityId);
    });
  }
}
export function validateDeviceControl(control: RoomDeviceControl, path: string, add: Add) {
  const { control: kind, options } = control.props;
  const allowed: Partial<Record<DeviceControlKind, string[]>> = {
    'purifier-mode': ['Manual', 'Sleep', 'Auto'], 'purifier-auto': ['Default', 'Quiet', 'Efficient'],
    'purifier-speed': ['0', '33', '66', '100'], 'fan-timer': ['5', '10', '15', '20', '30', '60'],
    'humidifier-mode': ['Manual', 'Target Humidity', 'Sleep'], 'humidifier-presets': Array.from({ length: 9 }, (_, i) => String(i + 1)),
    'humidifier-warm': ['0', '1', '2', '3'],
  };
  if (Boolean(allowed[kind]) === (options.length === 0)) add('invalid_combination', `${path}/props/options`);
  const seen = new Set<string>();
  options.forEach((option, i) => {
    if (!allowed[kind]?.includes(option.value) || seen.has(option.value)) add('invalid_combination', `${path}/props/options/${i}/value`);
    seen.add(option.value);
    if ((kind === 'fan-timer') !== (option.actionLabel !== undefined)) add('invalid_combination', `${path}/props/options/${i}/actionLabel`);
  });
  for (const [field, present] of [['detailEntityId', kind === 'grill-detail'], ['info', kind === 'humidifier-info'],
    ['initialMinutes', kind === 'fan-timer'], ['modalId', kind === 'fan-room'], ['fanRail', kind === 'fan-room']] as const)
    if ((control.props[field] !== undefined) !== present) add('invalid_combination', `${path}/props/${field}`);
  if (control.props.initialMinutes !== undefined && !options.some(option => option.value === String(control.props.initialMinutes)))
    add('invalid_combination', `${path}/props/initialMinutes`);
  if (control.props.fanRail && new Set(control.props.fanRail.order).size !== 2)
    add('invalid_combination', `${path}/props/fanRail/order`);
}
