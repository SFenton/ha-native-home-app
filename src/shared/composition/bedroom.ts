import { z } from 'zod/v4';
import { identifierSchema } from '../schema';

const object = z.strictObject;
const title = z.string().max(240).refine(value => Boolean(value.trim()));
const message = z.string().max(2000);
export const bedroomProviderKinds = ['bed-side', 'wake-light', 'bed-alarm-draft', 'wake-alarm-draft'] as const;
export const bedroomKinds = [
  'bed-target', 'bed-power', 'bed-stage', 'bed-mode', 'bed-reading', 'bed-snooze', 'bed-stop',
  'wake-ramp', 'wake-hold', 'wake-stop', 'wake-summary', 'alarm-weekdays', 'alarm-time', 'alarm-enabled',
  'alarm-wake-link', 'alarm-name', 'alarm-kind', 'alarm-date', 'alarm-ramp', 'alarm-save',
  'alarm-delete', 'alarm-reload', 'bed-tile', 'wake-tile', 'alarm-bed-target', 'alarm-add', 'alarm-feedback',
] as const;
export type BedroomKind = typeof bedroomKinds[number];
export const bedroomCapabilities = ['sh.bedroom-sources@1', 'sh.wake-hold-explanation@1', 'sh.wake-episode@1',
  'sh.bedroom-field-headings@1', 'sh.weekday-accessibility-labels@1', 'sh.wake-alarm-confirmation@1',
  ...bedroomKinds.map(kind => `sh.${kind}@1`)];
export const bedroomWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export const bedroomRamps = ['0', '5', '10', '15', '30'] as const;
export const bedroomHolds = ['5', '10', '15', '30'] as const;
export const bedroomSourceSchema = object({
  id: identifierSchema, kind: z.literal('model'), model: z.literal('bedroom-provider@1'),
  inputs: object({ providerId: identifierSchema, kind: z.enum(bedroomProviderKinds) }),
});
const base = { sourceId: identifierSchema, label: title, unavailableText: title };
const question = object({ title, message, confirmLabel: title, cancelLabel: title });
const scope = object({ title, message, tonightLabel: title, allNightsLabel: title, cancelLabel: title });
const symbol = object({ type: z.literal('sf-symbol'), name: z.string().max(80).refine(value => Boolean(value.trim())),
  rendering: z.literal('canonical'), unavailable: z.literal('reject') });
const options = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(object({ value: z.enum(values), label: title })).min(1).max(16);
export const bedroomPropsSchema = z.discriminatedUnion('control', [
  object({ ...base, control: z.literal('bed-target'), scope }),
  object({ ...base, control: z.literal('bed-power'), activeLabel: title, confirmation: question }),
  object({ ...base, control: z.literal('bed-stage'), parameter: z.enum(['bedtime', 'asleep', 'dawn']), scope }),
  object({ ...base, control: z.literal('bed-mode'), activeLabel: title, inactiveLabel: title, countdownSuffix: title, icon: symbol,
    family: z.enum(['neutral', 'lights', 'cooling', 'heating']) }),
  object({ ...base, control: z.literal('bed-reading'),
    parameter: z.enum(['current-temperature', 'pump-status', 'loop-temperature', 'pump-rpm', 'heart-rate', 'breathing', 'hrv']),
    activeLabel: title.optional(), inactiveLabel: title.optional() }),
  object({ ...base, control: z.literal('bed-snooze') }),
  object({ ...base, control: z.literal('bed-stop') }),
  object({ ...base, control: z.literal('wake-ramp'), options: options(bedroomRamps) }),
  object({ ...base, control: z.literal('wake-hold'), options: options(bedroomHolds), showsExplanation: z.boolean().optional() }),
  object({ ...base, control: z.literal('wake-stop'),
    episode: object({ heading: title, detail: message, pendingLabel: title }).optional() }),
  object({ ...base, control: z.literal('wake-summary') }),
  object({ ...base, control: z.literal('alarm-weekdays'),
    options: z.array(object({ value: z.enum(bedroomWeekdays), label: title, accessibilityLabel: title.optional() })).min(1).max(16) }),
  object({ ...base, control: z.literal('alarm-time') }),
  object({ ...base, control: z.literal('alarm-enabled') }),
  object({ ...base, control: z.literal('alarm-wake-link') }),
  object({ ...base, control: z.literal('alarm-name'), showsHeading: z.boolean().optional() }),
  object({ ...base, control: z.literal('alarm-kind'), options: options(['weekly', 'once'] as const), showsHeading: z.boolean().optional() }),
  object({ ...base, control: z.literal('alarm-date') }),
  object({ ...base, control: z.literal('alarm-ramp'), options: options(bedroomRamps) }),
  object({ ...base, control: z.literal('alarm-save') }),
  object({ ...base, control: z.literal('alarm-delete'),
    confirmation: question.extend({ messageFormat: z.literal('wake-alarm').optional() }) }),
  object({ ...base, control: z.literal('alarm-reload') }),
  object({ ...base, control: z.literal('alarm-feedback'), parameter: z.enum(['error', 'problems']) }),
  object({ ...base, control: z.literal('alarm-bed-target'), parameter: z.enum(['left', 'right']) }),
]);
export function bedroomTileSchemas<A extends z.ZodType>(action: A) {
  return [
    object({ ...base, control: z.literal('bed-tile'), action }),
    object({ ...base, control: z.literal('wake-tile'), action }),
    object({ ...base, control: z.literal('alarm-add'), action }),
  ] as const;
}
export function bedroomProviders(control: BedroomKind): readonly string[] {
  if (control === 'alarm-add') return ['bed-side', 'wake-light'];
  if (control.startsWith('bed-')) return ['bed-side'];
  if (control.startsWith('wake-')) return ['wake-light'];
  if (control === 'alarm-wake-link') return ['bed-alarm-draft'];
  if (['alarm-name', 'alarm-kind', 'alarm-date', 'alarm-ramp', 'alarm-reload', 'alarm-bed-target'].includes(control)) return ['wake-alarm-draft'];
  return ['bed-alarm-draft', 'wake-alarm-draft'];
}
