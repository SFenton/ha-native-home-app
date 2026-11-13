import { z } from 'zod/v4';
import type { NativeTodoItem, NativeTodoRead } from './native-state';
import type { Component, Json, StudioDocument } from './types';
import { readBindingPath } from './runtime';

export const nativeTodoItemSchema = z.object({
  uid: z.string().min(1).max(512),
  summary: z.string().max(2000),
  status: z.enum(['needs_action', 'completed']),
  description: z.string().max(16384).optional(),
  due: z.string().max(80).refine(value =>
    /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(value)
    && z.iso.date().safeParse(value.slice(0, 10)).success && Number.isFinite(Date.parse(value)), 'Invalid todo due date').optional(),
}).strict();
export const nativeTodoReadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), items: z.array(nativeTodoItemSchema).max(1000) }).strict(),
  z.object({ status: z.enum(['error', 'unavailable']), message: z.string().max(240) }).strict(),
]);

export const choreRecord = (value: Json | undefined): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const choreRecords = (value: Json | undefined) => Array.isArray(value) ? value.map(choreRecord) : [];
export function choreUserId(component: Component, document: StudioDocument): string | undefined {
  const source = document.dataSources.find(source => source.id === (component.props.profileSourceId ?? 'native-profile'));
  const id = readBindingPath(source?.sample ?? null, 'id');
  return typeof id === 'string' && id.trim() ? id : undefined;
}
export function choreResident(component: Component, document: StudioDocument) {
  const id = choreUserId(component, document)?.trim().toLowerCase();
  return id ? choreRecords(component.props.people).find(person =>
    typeof person.haUserId === 'string' && person.haUserId.toLowerCase() === id) : undefined;
}
export function choreListIds(component: Component, document: StudioDocument): { entityId: string; title: string }[] {
  if (component.props.collectionKind === 'resident-todo-items') {
    const lists = choreRecord(choreResident(component, document)?.summaryLists);
    return (Array.isArray(component.props.summaryListKeys) ? component.props.summaryListKeys : [])
      .filter((key): key is string => typeof key === 'string' && typeof lists[key] === 'string')
      .map(key => ({ entityId: String(lists[key]), title: key === 'noDueDate' ? 'No Due Date' : component.title }));
  }
  const allowed = component.props.currentUserIds;
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(choreUserId(component, document) ?? '')) return [];
  return typeof component.props.entityId === 'string' ? [{ entityId: component.props.entityId, title: component.title }] : [];
}
export function readChoreList(value: Json | undefined, entityId: string): NativeTodoRead {
  const entity = choreRecords(value).find(state => state.entityId === entityId);
  const parsed = nativeTodoReadSchema.safeParse(entity?.todoList);
  return parsed.success ? parsed.data : { status: 'unavailable', message: 'Chores unavailable. Refresh live preview data.' };
}
export function sortChoreItems(items: NativeTodoItem[]): NativeTodoItem[] {
  return [...items].sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity) || 0);
}
export function choreTitle(item: NativeTodoItem): string {
  const title = item.summary.trim() || 'Untitled task';
  if (!/\bMaintenance reference:\s*BATT-[A-Z0-9]+\b/i.test(item.description ?? '')) return title;
  const level = /\bbattery is at\s+(\d+(?:\.\d+)?)%/i.exec(item.description ?? '')?.[1];
  if (level === undefined) return title;
  const normalized = title.replace(/\bbatter(?:y|ies)\b/gi, word => word[0].toUpperCase() + word.slice(1).toLowerCase());
  return normalized.endsWith(`(${level}%)`) || normalized.endsWith(` \u00b7 ${level}%`) ? normalized : `${normalized} \u00b7 ${level}%`;
}
export function choreDue(due: string | undefined, now = Date.now()): { text: string; tone: string } | undefined {
  if (!due || !Number.isFinite(Date.parse(due))) return;
  const delta = Date.parse(due) - now, days = Math.abs(delta) / 86400000;
  const [amount, unit] = days < 1 ? [days * 24, 'hour'] : days < 21 ? [days, 'day'] : days < 60 ? [days / 7, 'week'] : [days / 30, 'month'];
  const count = Math.max(1, Math.round(Number(amount))), units = `${unit}${count === 1 ? '' : 's'}`;
  return { text: delta >= 0 ? `Due in ${count} ${units}` : `${count} ${units} overdue`, tone: delta >= 0 ? 'normal' : days < 1 ? 'warning' : 'error' };
}

export function choreLinkPresentation(component: Component, document: StudioDocument, states: Json | undefined) {
  const page = choreRecord(component.props.choreLink), resident = choreRecords(component.props.people).find(person => person.key === page.resident);
  const viewer = choreResident(component, document);
  const title = resident ? viewer?.key === resident.key ? 'Your Chores' : `${resident.name}'s Chores` : component.title;
  let total = 0, overdue = 0, available = true;
  for (const list of choreRecords(page.lists)) {
    const state = choreRecords(states).find(item => item.entityId === list.entityId);
    if (!state || ['unavailable', 'unknown'].includes(String(state.state))) available = false;
    const count = Number(state?.state);
    const open = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
    total += open;
    if (Object.hasOwn(choreRecord(list.countBucket), 'overdue') || list.countBucket === 'overdue') overdue += open;
  }
  return { title, subtitle: !available ? 'Unavailable' : !total ? 'Nothing open' : `${total} open${overdue ? ` \u00b7 ${overdue} overdue` : ''}` };
}
