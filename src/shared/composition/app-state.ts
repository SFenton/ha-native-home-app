import { z } from 'zod/v4';
import { identifierSchema } from '../validation';

/**
 * The `app-state@1` source (`sh.app-state@1`): facts about the app and its window that no Home Assistant entity holds, readable by a slot
 * `read`, an operand or a condition like any model field. One source per topic; the topic is a closed list and the source takes no other input.
 *
 * Window geometry is offered, the kind of device is not: layout follows geometry, and device-specific chrome stays in the renderers (owner decision
 * D2 of the Studio UX plan). Every topic also has `phase` (`ready` or `loading`).
 *
 * The app updates a topic on a transition, never per frame: the window on a size or trait change, the clock once a minute and only while read,
 * the notification state at activation and after a request, the preferences on change.
 */
export const APP_STATE_CAPABILITY = 'sh.app-state@1';
export const appStateTopics = ['window', 'clock', 'os', 'notifications', 'preferences'] as const;
export type AppStateTopic = typeof appStateTopics[number];

/** The read fields of each topic and the kind each reads as. Each entry is `since: 1`; a later field would be `since: 2` and need `sh.app-state@2`. */
export const appStateFields: Record<AppStateTopic, Record<string, 'string' | 'number' | 'boolean'>> = {
  window: { widthClass: 'string', heightClass: 'string', width: 'number', height: 'number', orientation: 'string', phase: 'string' },
  clock: { hour: 'number', minute: 'number', weekday: 'number', minuteOfDay: 'number', today: 'string', phase: 'string' },
  os: { major: 'number', supportsAlternateIcons: 'boolean', reduceMotion: 'boolean', reduceTransparency: 'boolean', canSendMail: 'boolean', phase: 'string' },
  notifications: { permission: 'string', timeSensitive: 'string', phase: 'string' },
  preferences: { showCountOnIcon: 'boolean', notificationBannerDismissed: 'boolean', phase: 'string' },
};
/** The closed values of the string fields that have them (a `compare` against another word can never hold). */
export const appStateValues: Record<string, readonly string[]> = {
  widthClass: ['compact', 'regular'], heightClass: ['compact', 'regular'], orientation: ['portrait', 'landscape'],
  permission: ['not-determined', 'denied', 'authorized', 'provisional', 'ephemeral'], timeSensitive: ['not-supported', 'disabled', 'enabled'],
  phase: ['ready', 'loading'],
};

export const appStateSourceSchema = z.strictObject({
  id: identifierSchema, kind: z.literal('model'), model: z.literal('app-state@1'),
  inputs: z.strictObject({ topic: z.enum(appStateTopics) }),
});
