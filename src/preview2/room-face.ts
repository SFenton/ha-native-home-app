import type { NativeState } from '../shared/native-state';
import { solidColor } from '../shared/composition/fill-css';

/** A room tile's colour family: the glyph colour on a dark tile and the fill an active tile takes (`ColorFamily.spec`). */
export interface Family { glyph: string; fill?: string }
/** The families a room card can belong to (`HassDesign/ColorFamily.swift`). */
export const families = {
  lights: { glyph: '#FF9630', fill: '#7A4A00' }, heating: { glyph: '#FF7A2F', fill: '#A8440A' }, cooling: { glyph: '#3FC6D2', fill: '#1B6F78' },
  vents: { glyph: '#8FA8FF', fill: '#3B58B8' }, air: { glyph: '#2FD3C1', fill: '#006E62' }, water: { glyph: '#4CC9F0', fill: '#076C91' },
  occupancy: { glyph: '#5BD16A', fill: '#2A732E' }, contact: { glyph: '#7ED787', fill: '#3B523E' }, media: { glyph: '#FF7AA8', fill: '#A03A61' },
  cleaning: { glyph: '#C88CFA', fill: '#7A3FB0' }, power: { glyph: '#FFD60A', fill: '#FFD60A' }, cooking: { glyph: '#FF8A4C', fill: '#A8420E' },
  climate: { glyph: '#FFCC00', fill: '#195482' }, neutral: { glyph: '#8E8E93' },
} as const satisfies Record<string, Family>;
/** A family by name. */
export type FamilyName = keyof typeof families;

/** The kinds of room card (`roomCardProps.kind`). */
export type RoomKind = 'air' | 'appliance' | 'climate' | 'contact' | 'fan' | 'grill' | 'humidifier' | 'laundry' | 'light' | 'media' | 'occupancy' | 'power' | 'vacuum' | 'vent' | 'wake-light';

/** The icon a light card uses for a heater, which belongs to the power family (`RoomTileFace.powerIcons`). */
const powerIcons = new Set(['mdi:heat-wave']);
/** `RoomTileFace.family(_:icon:)`: the family a kind of card belongs to. A climate card changes family with its action, see {@link roomFace}. */
export function roomFamily(kind: RoomKind, icon: string): FamilyName {
  switch (kind) {
    case 'light': case 'wake-light': return powerIcons.has(icon) ? 'power' : 'lights';
    case 'air': case 'fan': return 'air';
    case 'vent': return 'vents';
    case 'humidifier': return 'water';
    case 'climate': return 'neutral';
    case 'occupancy': return 'occupancy';
    case 'contact': return 'contact';
    case 'vacuum': case 'appliance': case 'laundry': return 'cleaning';
    case 'media': return 'media';
    case 'power': return 'power';
    case 'grill': return 'cooking';
  }
}

/**
 * How a family draws a tile (`TileFaceStyle.resolve`): while active, the lights family is the warm lit tile with dark ink, power its yellow with dark ink,
 * every other family with a fill the white-ink filled tile; inactive is the dark tile with the family's glyph. `fill` is the colour the CSS fills with.
 */
export interface FamilyLook { glyph: string; fill?: string; className: string }
export function familyLook(name: FamilyName, active: boolean): FamilyLook {
  const family: Family = families[name];
  if (!active || !family.fill) return { glyph: family.glyph, className: '' };
  if (name === 'lights') return { glyph: family.glyph, className: 'sh-lit-warm' };
  return { glyph: family.glyph, fill: family.fill, className: name === 'power' ? 'sh-dark-ink' : 'sh-lit-filled' };
}

const dead = (state: string | undefined) => !state || ['unavailable', 'unknown'].includes(state);
/** `RoomFormat.isActive`: on, open, playing, recording, home, heat or cool; an alarm panel while it is not disarmed. */
export function isActiveState(entity: Pick<NativeState, 'entityId' | 'state'> | undefined): boolean {
  if (!entity) return false;
  if (entity.entityId.startsWith('alarm_control_panel.')) return entity.state !== 'disarmed';
  return ['on', 'open', 'playing', 'recording', 'home', 'heat', 'cool'].includes(entity.state);
}

/** What a card draws: its family and whether it is filled with the family's colour. */
export interface RoomFace { family: FamilyName; active: boolean }

/** `RoomTileFace.resolve`: the card's family, and whether the tile is active (filled) for the entity's state. */
export function roomFace(kind: RoomKind, icon: string, entity: NativeState | undefined, activeStates: readonly string[]): RoomFace {
  const family = roomFamily(kind, icon);
  if (!entity || dead(entity.state)) return { family, active: false };
  const on = isActiveState(entity) || activeStates.includes(entity.state);
  switch (kind) {
    case 'light': case 'fan': case 'media': case 'power': case 'grill': return { family, active: entity.state !== 'off' };
    case 'air': return { family, active: !entity.entityId.startsWith('sensor.') && entity.state !== 'off' };
    case 'climate': {
      const action = entity.hvacAction ?? entity.state;
      if (action === 'heating') return { family: 'heating', active: true };
      if (action === 'cooling') return { family: 'cooling', active: true };
      return { family: entity.state === 'heat' ? 'heating' : 'cooling', active: false };
    }
    case 'occupancy': return { family, active: ['on', 'active', 'occupied'].includes(entity.state) };
    case 'vacuum': return { family, active: on || entity.state === 'cleaning' };
    case 'wake-light': return { family, active: ['ramping', 'holding', 'snoozed'].includes(entity.state) };
    default: return { family, active: on };
  }
}

/** A solid colour of a `stateColors` entry, as CSS; undefined when the slot is not an exact colour. */
export function solidCss(slot: unknown): string | undefined {
  return solidColor(slot);
}

/** `RoomFormat.background`: the colour a state paints the tile (`stateColors`), else the climate action's tone when the card asks for it. */
export function roomBackground(props: { stateColors?: readonly { state: string; fill: unknown }[]; climateActionTone?: boolean }, entity: NativeState | undefined): string | undefined {
  if (!entity) return undefined;
  const own = solidCss(props.stateColors?.find(item => item.state === entity.state)?.fill);
  if (own) return own;
  if (!props.climateActionTone) return undefined;
  switch (entity.hvacAction ?? entity.state) {
    case 'heating': return 'rgb(136 64 26 / .6)';
    case 'cooling': return 'rgb(25 84 130 / .6)';
    case 'idle': return 'rgb(229 57 53 / .6)';
    default: return undefined;
  }
}
