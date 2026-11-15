import { z } from 'zod/v4';
import { identifierSchema } from '../schema';
import { symbolUnavailable } from './symbol-unavailable';

const object = z.strictObject;
const text = (maximum: number) => z.string().max(maximum).refine(value => Boolean(value.trim()));
const label = text(80), title = text(240);
const symbol = object({
  type: z.literal('sf-symbol'), name: text(80),
  rendering: z.literal('canonical'), unavailable: symbolUnavailable,
});
export const remoteSourceSchema = object({
  id: identifierSchema, kind: z.literal('model'), model: z.literal('media-remote@1'),
  inputs: object({ providerId: identifierSchema }),
});
export const remoteKeySchema = object({
  position: z.number().int().min(0).max(8),
  slot: z.enum(['power', 'up', 'left', 'select', 'right', 'down', 'back', 'home', 'keyboard',
    'pause', 'play', 'volume-down', 'volume-mute', 'volume-up']),
  label, icon: z.discriminatedUnion('type', [symbol, object({ type: z.literal('none') })]),
  rotation: z.number().min(-360).max(360),
  activeText: label, inactiveText: label,
});
const options = z.array(object({ value: label, label })).max(64);
const states = { key: label, icon: symbol, states: options, fallbackText: title, unavailableText: title };
const navigation = z.discriminatedUnion('type', [
  object({ type: z.literal('push'), pageId: identifierSchema, arguments: object({}),
    origin: z.literal('sender'), duplicate: z.literal('reuse-nearest') }),
  object({ type: z.literal('present'), modalId: identifierSchema, arguments: object({}), ifPresented: z.literal('reject') }),
  object({ type: z.literal('select-tab'), tabId: identifierSchema }),
  object({ type: z.literal('dismiss-then-push'), destination: object({
    type: z.literal('push'), pageId: identifierSchema, arguments: object({}),
    origin: z.literal('sender'), duplicate: z.literal('reuse-nearest'),
  }) }),
]);

/** Atomic domain presentations. Only the injected provider can resolve a slot into a command. */
export const remoteControlSchema = z.discriminatedUnion('kind', [
  object({ kind: z.literal('keys'), layout: z.enum(['pad', 'transport']), label: title, keys: z.array(remoteKeySchema).min(1).max(9) }),
  object({ kind: z.literal('volume'), keys: z.array(remoteKeySchema).length(3), unavailableText: title, errorText: title }),
  object({ kind: z.literal('keyboard'), label, placeholder: label, sendLabel: label, cancelLabel: label, errorText: title }),
  object({ kind: z.literal('app'), key: label, icon: symbol, artwork: z.enum(['none', 'provider']),
    whiteBackground: z.boolean(), activeText: title }),
  object({ kind: z.literal('device'), ...states, presentation: z.enum(['row', 'tile']).optional(),
    family: z.enum(['media', 'power']).optional(),
    personalization: object({ residentId: identifierSchema, ownTitle: title, otherTitle: title }).optional() }),
  object({ kind: z.literal('hue-toggle'), target: z.enum(['power', 'light-sync']), icon: symbol,
    onText: title, offText: title, unavailableText: title }),
  object({ kind: z.literal('hue-choice'), target: z.enum(['mode', 'intensity']), options, unavailableText: title }),
  object({ kind: z.literal('hue-brightness'), unavailableText: title }),
  object({ kind: z.literal('hue-input'), option: label, icon: symbol, selectedText: title, connectedText: title,
    disconnectedText: title, unavailableText: title }),
  object({ kind: z.literal('card'), ...states, errorText: title, action: navigation,
    actions: z.array(object({ slot: z.enum(['power', 'previous', 'play', 'pause', 'next']), label, icon: symbol })).max(5),
    showsVolume: z.boolean(), volumeLabel: label }),
]);
export type RemoteControl = z.infer<typeof remoteControlSchema>;
export const remoteCapabilities = [
  'sh.media-remote@1', 'sh.remote-keys@1', 'sh.remote-volume@1', 'sh.remote-keyboard@1',
  'sh.remote-app@1', 'sh.remote-device@1', 'sh.remote-hue-toggle@1', 'sh.remote-hue-choice@1',
  'sh.remote-hue-brightness@1', 'sh.remote-hue-input@1', 'sh.remote-card@1',
] as const;

/** Semantic constraints shared with the native compiler, returned as relative JSON pointers. */
export function remoteControlIssues(control: RemoteControl): string[] {
  const issues: string[] = [];
  if (control.kind === 'device' && control.presentation !== 'tile') {
    if (control.personalization) issues.push('/personalization');
    if (control.family) issues.push('/family');
  }
  if (control.kind === 'keys' || control.kind === 'volume') {
    const positions = new Set<number>(), slots = new Set<string>();
    const volume = control.kind === 'volume';
    const volumePositions: Record<string, number | undefined> = { 'volume-mute': 0, 'volume-down': 1, 'volume-up': 2 };
    const transport = control.kind === 'keys' && control.layout === 'transport';
    const allowed = volume ? ['volume-down', 'volume-mute', 'volume-up'] : transport ? ['pause', 'play']
      : ['power', 'up', 'left', 'select', 'right', 'down', 'back', 'home', 'keyboard'];
    control.keys.forEach((key, index) => {
      if (positions.has(key.position) || ((volume || transport) && key.position > 2)) issues.push(`/keys/${index}/position`);
      if (volume && volumePositions[key.slot] !== key.position) {
        issues.push(`/keys/${index}/position`);
      }
      if (slots.has(key.slot) || !allowed.includes(key.slot)) issues.push(`/keys/${index}/slot`);
      positions.add(key.position); slots.add(key.slot);
    });
  }
  const choices = control.kind === 'hue-choice' ? control.options : control.kind === 'device' || control.kind === 'card' ? control.states : [];
  const seen = new Set<string>();
  choices.forEach((option, index) => {
    if (seen.has(option.value)) issues.push(`/${control.kind === 'hue-choice' ? 'options' : 'states'}/${index}/value`);
    seen.add(option.value);
  });
  if (control.kind === 'hue-choice' && !choices.length) issues.push('/options');
  if (control.kind === 'card') {
    const slots = new Set<string>();
    control.actions.forEach((action, index) => {
      if (slots.has(action.slot)) issues.push(`/actions/${index}/slot`);
      slots.add(action.slot);
    });
  }
  return issues;
}
