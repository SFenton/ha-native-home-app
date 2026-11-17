import type { NativeState } from '../shared/native-state';

/**
 * The words a room overview tile and a room card draw, as the app computes them (`HassCore/Rooms/RoomOverview.swift`, `RoomFormat.swift`,
 * `Climate/ClimateLogic.swift`, `Chips/ChipWebColor.swift`, `Chips/ContactChipState.swift`). Pure functions over entities; the
 * `home-status@1` projection and the `room-card` node call them.
 */

/** Reads one entity, or nothing for a missing or unavailable one (`RoomOverview.Read` over `safeRead`). */
export type Read = (entityId: string) => NativeState | undefined;
/** One entity of a room's group (`RoomGroupItem`): its title, how many sensors it stands for and its kind. */
export interface GroupItem { entityId: string; title: string; contactCount: number; contactKind?: 'door' | 'window' }
/** A room's group (`RoomGroup`): its own entity (a light group, or the climate range text) and its items. */
export interface Group { entityId?: string; items: readonly GroupItem[] }
/** The kinds of overview (`RoomOverviewKind`) a `home-status@1` projection can stand for. */
export type OverviewKind = 'lights' | 'occupancy' | 'contacts';

const dead = (state: string | undefined) => !state || ['unavailable', 'unknown'].includes(state.trim().toLowerCase());
/** `StateText.titleCase`: each word's first letter raised, underscores read as spaces. */
export const titleCase = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const domainOf = (entity: NativeState) => entity.entityId.split('.')[0];
/** `PluralCopy.count`: "1 sensor", "3 sensors". */
export const pluralCount = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`;

// MARK: Entity states

/** `RoomFormat.compact`: contact sensors read Open/Closed, other binary sensors Active/Clear, lights On/Off, the rest their text. */
export function compact(entity: NativeState | undefined): string {
  if (!entity) return 'Unavailable';
  if (entity.state === 'unavailable') return 'Unavailable';
  const binary = domainOf(entity) === 'binary_sensor';
  if (binary && entity.entityId.split('.')[1]?.startsWith('contact')) return entity.state === 'on' ? 'Open' : 'Closed';
  if (binary) return entity.state === 'on' ? 'Active' : 'Clear';
  if (domainOf(entity) === 'light') return entity.state === 'on' ? 'On' : 'Off';
  return titleCase(entity.state);
}
/** `RoomFormat.isOccupied`. */
export const isOccupied = (entity: NativeState | undefined) => ['on', 'active', 'occupied'].includes(entity?.state ?? '');
/** `RoomFormat.isOpen`. */
export const isOpen = (entity: NativeState | undefined) => ['on', 'open'].includes(entity?.state ?? '');
/** `RoomFormat.isActive`: alarm panels are active unless disarmed; others when on, open, playing, recording, home, heat or cool. */
export function isActive(entity: NativeState | undefined): boolean {
  if (!entity) return false;
  if (domainOf(entity) === 'alarm_control_panel') return entity.state !== 'disarmed';
  return ['on', 'open', 'playing', 'recording', 'home', 'heat', 'cool'].includes(entity.state);
}
/** `RoomFormat.occupancy`: Detected, Clear. */
export function occupancy(entity: NativeState | undefined): string {
  if (!entity || entity.state === 'unavailable') return 'Unavailable';
  if (entity.state === 'unknown') return 'Unknown';
  if (isOccupied(entity)) return 'Detected';
  return ['off', 'inactive', 'clear', 'not_occupied'].includes(entity.state) ? 'Clear' : titleCase(entity.state);
}
/** `RoomFormat.contact`: Open, Closed. */
export function contact(entity: NativeState | undefined): string {
  if (!entity || entity.state === 'unavailable') return 'Unavailable';
  if (entity.state === 'unknown') return 'Unknown';
  if (isOpen(entity)) return 'Open';
  return ['off', 'closed'].includes(entity.state) ? 'Closed' : titleCase(entity.state);
}
/** `RoomFormat.contactTileSubtitle`: nothing for Open and Closed, which the glyph and the fill already say; Unavailable and Unknown stay. */
export function contactTileSubtitle(entity: NativeState | undefined): string {
  const text = contact(entity);
  return text === 'Open' || text === 'Closed' ? '' : text;
}
/** `RoomFormat.withUnit`: the compact state plus its unit, "45%". */
export function withUnit(entity: NativeState | undefined): string {
  const value = compact(entity);
  const unit = entity?.unit;
  return !unit || value === 'Unavailable' || value === 'Unknown' || value.endsWith(unit) ? value : value + unit;
}
/** `ClimateLogic.isVentOpen`. */
export const isVentOpen = (entity: NativeState | undefined) => entity?.state === 'open' || entity?.state === 'opening';
/** `ClimateLogic.ventSubtitle`: "Open · 60%" while open with a reported position, else the compact state. */
export function ventSubtitle(entity: NativeState | undefined): string {
  const state = compact(entity);
  const position = entity?.currentPosition;
  return isVentOpen(entity) && typeof position === 'number' && Number.isFinite(position) ? `${state} · ${Math.round(position)}%` : state;
}
/** `RoomFormat.cardState`: a configured label for the state, else the compact state. */
export function cardState(stateLabels: readonly { state: string; label: string }[], entity: NativeState | undefined): string {
  if (!entity) return 'Unavailable';
  return stateLabels.find(item => item.state === entity.state)?.label ?? compact(entity);
}

// MARK: Air quality

/** `RoomFormat.airMetric`: value and unit ("12 µg/m³"), or a unitless value without a trailing `.0`. */
export function airMetric(entity: NativeState | undefined): string {
  if (!entity) return 'Unavailable';
  const raw = entity.state.trim();
  if (!raw || dead(raw)) return compact(entity);
  const unit = entity.unit ?? '';
  const value = !unit && raw.endsWith('.0') ? raw.slice(0, -2) : raw;
  return unit && !value.includes(unit) ? `${value} ${unit}` : value;
}
/** `RoomFormat.airSummary`: "AQI • PM2.5", one word when both sensors are dead. */
export function airSummary(aqi: NativeState | undefined, pm25: NativeState | undefined): string {
  if ((!aqi || dead(aqi.state)) && (!pm25 || dead(pm25.state))) return 'Unavailable';
  return `${airMetric(aqi)} • ${airMetric(pm25)}`;
}
/** `RoomOverview.airQualityChipSummary`: "AQI 12 · PM2.5 3.1". */
export const airQualityChipSummary = (aqi: NativeState | undefined, pm25: NativeState | undefined) => `AQI ${compact(aqi)} · PM2.5 ${compact(pm25)}`;

/** A colour as its channels, 0 to 255. */
export interface Rgb { red: number; green: number; blue: number }
/** `RoomOverview.colorFromRgba`: `rgb(r, g, b)` or `rgba(r, g, b, a)`; the alpha is ignored. */
export function colorFromRgba(text: string | undefined): Rgb | undefined {
  const match = text ? /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)/i.exec(text) : undefined;
  return match ? { red: Math.round(Number(match[1])), green: Math.round(Number(match[2])), blue: Math.round(Number(match[3])) } : undefined;
}
/** `RoomOverview.colorFromCss`: `rgb()`, `rgba()` or `#rrggbb`. */
export function colorFromCss(text: string | undefined): Rgb | undefined {
  const found = colorFromRgba(text);
  if (found) return found;
  const hex = text ? /^#([0-9a-f]{6})$/i.exec(text) : undefined;
  return hex ? { red: parseInt(hex[1].slice(0, 2), 16), green: parseInt(hex[1].slice(2, 4), 16), blue: parseInt(hex[1].slice(4, 6), 16) } : undefined;
}
/** `ChipWebColor.airTeal`. */
export const airTeal: Rgb = { red: 0, green: 150, blue: 136 };
/** `ChipWebColor.airQuality`: the helper's colour, else the web teal. */
export const airQualityColor = (colorText: string | undefined): Rgb => colorFromCss(colorText) ?? airTeal;
/** A colour as the CSS the tiles take. */
export const css = (color: Rgb) => `rgb(${color.red} ${color.green} ${color.blue})`;

// MARK: Lights, occupancy, contacts

/** `RoomOverview.lightActiveCount`. */
export const lightActiveCount = (group: Group, read: Read) => group.items.filter(item => isActive(read(item.entityId))).length;
/** `RoomOverview.lightSubtitle`: "On", "3 On", else the group light's state, or "Off" when it is missing. */
export function lightSubtitle(group: Group, read: Read): string {
  const active = lightActiveCount(group, read);
  if (active > 0) return group.items.length === 1 ? 'On' : `${active} On`;
  const entity = group.entityId ? read(group.entityId) : undefined;
  return entity ? compact(entity) : 'Off';
}
/** `RoomOverview.occupiedCount`. */
export const occupiedCount = (group: Group, read: Read) => group.items.filter(item => isOccupied(read(item.entityId))).length;
/** `RoomOverview.openCount`. */
export const openCount = (group: Group, read: Read) => group.items.filter(item => isOpen(read(item.entityId))).length;
const isWindow = (item: GroupItem) => item.contactKind ? item.contactKind === 'window' : `${item.title} ${item.entityId}`.toLowerCase().includes('window');
/** `RoomFormat.contactSummary`: "Door Open", "All Windows Closed", "2 Doors Open"; mixed rooms join the open kinds with ", " or read "All Closed". */
export function contactSummary(group: Group, read: Read): string {
  const open = { door: 0, window: 0 }, total = { door: 0, window: 0 };
  for (const item of group.items) {
    const kind = isWindow(item) ? 'window' : 'door';
    total[kind] += item.contactCount;
    if (isOpen(read(item.entityId))) open[kind] += 1;
  }
  const summary = (kind: 'door' | 'window') => {
    const noun = kind === 'window' ? 'Window' : 'Door', opened = open[kind], all = total[kind];
    if (all === 1) return opened === 1 ? `${noun} Open` : `${noun} Closed`;
    if (opened === 0) return `All ${noun}s Closed`;
    if (opened === all) return `All ${noun}s Open`;
    return `${opened} ${noun}${opened === 1 ? '' : 's'} Open`;
  };
  const kinds = (['window', 'door'] as const).filter(kind => total[kind] > 0);
  if (kinds.length === 1) return summary(kinds[0]);
  const parts = kinds.filter(kind => open[kind] > 0).map(summary);
  return parts.length ? parts.join(', ') : 'All Closed';
}
/** `RoomOverview.isActive`: a room card is lit while its group light is on or any of its items is active (lights), occupied or open. */
export function overviewActive(kind: OverviewKind, group: Group, read: Read): boolean {
  switch (kind) {
    case 'lights': return (group.entityId ? isActive(read(group.entityId)) : false) || lightActiveCount(group, read) > 0;
    case 'occupancy': return occupiedCount(group, read) > 0;
    case 'contacts': return openCount(group, read) > 0;
  }
}
/**
 * `RoomOverview.cardSubtitle`. The app asks "every sensor unavailable" of a read that already drops unavailable entities, so that
 * branch never answers there; this keeps the same reading.
 */
export function cardSubtitle(kind: OverviewKind, group: Group, read: Read): string {
  switch (kind) {
    case 'lights': return lightSubtitle(group, read);
    case 'occupancy': return occupiedCount(group, read) > 0 ? 'Occupied' : 'Not Occupied';
    case 'contacts': return contactSummary(group, read);
  }
}
/** `RoomOverview.detailSubtitle`: occupancy counts its sensors; the rest read as the card does. */
export function detailSubtitle(kind: OverviewKind, group: Group, read: Read): string {
  if (kind !== 'occupancy') return cardSubtitle(kind, group, read);
  const count = occupiedCount(group, read);
  return `${count} sensor${count === 1 ? '' : 's'} occupied`;
}
/** `ContactChipState.resolve` as the state id the projection gives: `idle`, `open-home`, `open-away` or `open-armed`. */
export function contactChipState(isOpenNow: boolean, alarmState: string | undefined, isAway: boolean): 'idle' | 'open-home' | 'open-away' | 'open-armed' {
  if (!isOpenNow) return 'idle';
  if (alarmState && (alarmState.startsWith('armed_') || alarmState === 'triggered')) return 'open-armed';
  return isAway ? 'open-away' : 'open-home';
}

// MARK: Climate

/** `Math.trunc(value * 10) / 10` with one decimal. */
export const truncatedOneDecimal = (value: number) => (Math.trunc(value * 10) / 10).toFixed(1);
/** `RoomOverview.normalizedRange`: the range text with each number cut to one decimal, or nothing for a missing or unavailable helper. */
export function normalizedRange(text: string | undefined): string | undefined {
  if (!text || dead(text)) return undefined;
  return text.replace(/-?\d+(?:\.\d+)?/g, match => truncatedOneDecimal(Number(match)));
}
/** A temperature sensor's reading: its number and unit. */
function reading(entity: NativeState | undefined): { value: number; unit: string } | undefined {
  if (!entity || domainOf(entity) !== 'sensor' || dead(entity.state)) return undefined;
  const value = Number(entity.state);
  return entity.state.trim() !== '' && Number.isFinite(value) ? { value, unit: entity.unit ?? '' } : undefined;
}
/** `RoomOverview.climateSubtitle`: the range helper's text, else the least and greatest of the room's sensors, else "N sensors". */
export function climateSubtitle(group: Group, read: Read): string {
  const range = normalizedRange(group.entityId ? read(group.entityId)?.state : undefined);
  if (range) return range;
  const readings = group.items.map(item => reading(read(item.entityId))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!readings.length) return pluralCount(group.items.length, 'sensor');
  const values = readings.map(item => item.value), low = Math.min(...values), high = Math.max(...values), unit = readings[0].unit;
  return Math.abs(low - high) < 0.05 ? truncatedOneDecimal(low) + unit : `${truncatedOneDecimal(low)}${unit} - ${truncatedOneDecimal(high)}${unit}`;
}
/** `RoomOverview.climateText`: a vent's state with its position, a sensor's reading with its unit, else the compact state. */
export function climateText(entity: NativeState | undefined): string {
  if (!entity) return 'Unavailable';
  if (domainOf(entity) === 'cover') return ventSubtitle(entity);
  const found = reading(entity);
  if (domainOf(entity) === 'sensor' && found) return truncatedOneDecimal(found.value) + found.unit;
  return compact(entity);
}
