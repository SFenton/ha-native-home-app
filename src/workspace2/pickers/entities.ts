import type { CompositionDocument } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import { demoFriendlyName } from '../../preview2/demo-house';

/** One entity as the picker lists it: a friendly name first, the id second, then where it is and how it is now. */
export interface EntityRow {
  entityId: string;
  name: string;
  domain: string;
  /** The room, when Home Assistant says. */
  area?: string;
  /** The state now, with its unit. */
  state?: string;
  /** Home Assistant's device class, which picks the style a state tile starts with. */
  deviceClass?: string;
}

const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';
/** Rows from a Home Assistant snapshot, sorted by name. */
export function rowsFromStates(states: Iterable<NativeState>): EntityRow[] {
  const rows: EntityRow[] = [];
  for (const state of states) rows.push({ entityId: state.entityId, name: state.name || state.entityId, domain: domainOf(state.entityId), ...(state.deviceClass ? { deviceClass: state.deviceClass } : {}), state: state.unit ? `${state.state} ${state.unit}` : state.state });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));
}

/** The entities a document already names (data sources, call targets), for when Home Assistant is not connected: demo ids get their demo friendly names, others the raw id. */
export function rowsFromDocument(document: CompositionDocument): EntityRow[] {
  const ids = new Set<string>();
  for (const id of idsIn(document.dataSources)) ids.add(id);
  for (const page of document.pages) for (const id of idsIn(page.components)) ids.add(id);
  for (const modal of document.modals) for (const id of idsIn(modal.components)) ids.add(id);
  return [...ids].sort().map(entityId => ({ entityId, name: demoFriendlyName(entityId), domain: domainOf(entityId) }));
}

const entityPattern = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
/** The ids found under a value, by value and the key it sits under. An edit rebuilds only the branch it touches, so the rest answers from here. */
const found = new WeakMap<object, Map<string, readonly string[]>>();
function idsIn(value: unknown, key = ''): readonly string[] {
  if (typeof value === 'string') return entityPattern.test(value) && /entity|value/i.test(key) ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  const remembered = found.get(value)?.get(key);
  if (remembered) return remembered;
  const ids = Array.isArray(value)
    ? value.flatMap(item => idsIn(item, key))
    : Object.entries(value).flatMap(([name, child]) => idsIn(child, name));
  const byKey = found.get(value) ?? new Map<string, readonly string[]>();
  byKey.set(key, ids); found.set(value, byKey);
  return ids;
}

/** The words of a domain for its filter chip ("light" to "Light", "input_boolean" to "Input boolean"). */
export const domainName = (domain: string) => { const text = domain.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };

/** Rows whose name, id, area or domain contain every word typed; the domains filter applies first. Keeps the order given. */
export function filterEntities(rows: readonly EntityRow[], query: string, domains?: ReadonlySet<string>): EntityRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (domains && domains.size && !domains.has(row.domain)) return false;
    if (!words.length) return true;
    const haystack = `${row.name} ${row.entityId} ${row.area ?? ''} ${row.domain}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

/** The domains present in the rows, most populated first. */
export function domainsOf(rows: readonly EntityRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.domain, (counts.get(row.domain) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([domain]) => domain);
}

/** Whether text is a well-formed entity id (what "Use “<text>”" accepts). */
export const isEntityId = (text: string) => /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(text);

/** The most recent picks, newest first, kept on this device. */
export function recents(kind: string, limit = 5): string[] {
  try { const stored = JSON.parse(localStorage.getItem(`studio.recent.${kind}`) ?? '[]') as unknown; return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, limit) : []; }
  catch { return []; }
}
/** Remembers a pick. */
export function remember(kind: string, value: string, limit = 12): void {
  try { localStorage.setItem(`studio.recent.${kind}`, JSON.stringify([value, ...recents(kind, limit).filter(item => item !== value)].slice(0, limit))); } catch { /* private mode */ }
}
