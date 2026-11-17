import type { CompositionDocument } from '../../shared/composition/schema';
import { appStateFields, appStateTopics, appStateValues, type AppStateTopic } from '../../shared/composition/app-state';

/** One thing the app knows that no entity holds, as the picker lists it (spec "The value picker"). */
export interface AppItem { topic: AppStateTopic; field: string; label: string; group: 'time' | 'window' | 'phone' | 'notifications' | 'settings' }

/** The `app-state@1` fields offered by name (the topic's `phase` is not offered). There is no device kind (owner's D2). */
export const appItems: readonly AppItem[] = [
  { topic: 'clock', field: 'minuteOfDay', label: 'Time of day', group: 'time' },
  { topic: 'clock', field: 'weekday', label: 'Day of the week', group: 'time' },
  { topic: 'clock', field: 'today', label: "Today's date", group: 'time' },
  { topic: 'window', field: 'width', label: 'Width', group: 'window' },
  { topic: 'window', field: 'height', label: 'Height', group: 'window' },
  { topic: 'window', field: 'widthClass', label: 'Width class', group: 'window' },
  { topic: 'window', field: 'heightClass', label: 'Height class', group: 'window' },
  { topic: 'window', field: 'orientation', label: 'Orientation', group: 'window' },
  { topic: 'os', field: 'major', label: 'iOS version', group: 'phone' },
  { topic: 'os', field: 'reduceMotion', label: 'Reduce Motion', group: 'phone' },
  { topic: 'os', field: 'reduceTransparency', label: 'Reduce Transparency', group: 'phone' },
  { topic: 'os', field: 'supportsAlternateIcons', label: 'Can change the app icon', group: 'phone' },
  { topic: 'os', field: 'canSendMail', label: 'Can send mail', group: 'phone' },
  { topic: 'notifications', field: 'permission', label: 'Permission', group: 'notifications' },
  { topic: 'notifications', field: 'timeSensitive', label: 'Time Sensitive', group: 'notifications' },
  { topic: 'preferences', field: 'showCountOnIcon', label: 'Show count on icon', group: 'settings' },
  { topic: 'preferences', field: 'notificationBannerDismissed', label: 'Notification banner dismissed', group: 'settings' },
];
/** What a field reads as. */
export const appFieldKind = (item: AppItem) => appStateFields[item.topic][item.field];
/** The closed words of a field, when it has them (Orientation, Permission). */
export const closedWords = (item: Pick<AppItem, 'field'>): readonly string[] | undefined => appStateValues[item.field];
/** The group titles, in order (spec "Picker groups"). */
export const groupTitles = { item: "This Item's Fields", inputs: 'Inputs', entities: 'Entities', counts: 'Counts', flows: 'Data Flows', time: 'Time', window: 'Window', phone: 'This Phone', notifications: 'Notifications', settings: 'App Settings', person: 'Person Using the App', models: 'Models' } as const;
export type PickerGroup = keyof typeof groupTitles;

/** The `app-state@1` source of a topic, made on first use and part of the same document change. */
export function ensureAppState(document: CompositionDocument, topic: AppStateTopic): { document: CompositionDocument; sourceId: string } {
  if (!appStateTopics.includes(topic)) throw new Error(`Unknown app topic ${topic}`);
  const found = document.dataSources.find(source => source.kind === 'model' && source.model === 'app-state@1' && source.inputs.topic === topic);
  if (found) return { document, sourceId: found.id };
  const taken = new Set(document.dataSources.map(item => item.id));
  let id = `app-${topic}`, count = 1;
  while (taken.has(id)) id = `app-${topic}-${++count}`;
  return { document: { ...document, dataSources: [...document.dataSources, { id, kind: 'model', model: 'app-state@1', inputs: { topic } }] }, sourceId: id };
}

/** The attributes Home Assistant reports for an entity, by their snake-case names, for the "Read" pop-up. */
export function knownAttributes(state: Record<string, unknown> | undefined): { name: string; value: string }[] {
  if (!state) return [];
  const skip = new Set(['entityId', 'state', 'name', 'unit', 'icon', 'deviceClass']);
  const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  return Object.entries(state).filter(([key, value]) => !skip.has(key) && value !== undefined && value !== null && typeof value !== 'function')
    .map(([key, value]) => ({ name: snake(key), value: Array.isArray(value) ? value.join(', ') : String(value) }));
}
