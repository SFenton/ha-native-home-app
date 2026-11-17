import type { CSSProperties, ReactNode } from 'react';
import type { CompositionActionSlot, CompositionNode } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { evaluateOperand, type ReadResult } from '../evaluate';
import type { EnabledWhen, Operand } from '../../shared/composition/expression';
import {
  isEnabled, resolveBadge, resolveFill, resolveSymbol, resolveText, type BoundColor, type BoundSymbol, type Conditional, type Fill as FillLook, type SymbolLook, type TextSlot,
} from '../../shared/composition/evaluator';
import type { ColorRole } from '../../shared/composition/color';
import { solidColor } from '../../shared/composition/fill-css';
import { Crosshair, MoonStar, Navigation, Play, Square, ArrowUpRight, BatteryFull, Check, ChevronUp, CircleCheck, CircleDot, CloudSun, DoorClosed, DoorOpen, Droplet, Footprints, Keyboard, Layers, LockOpen, Menu, Minus, PanelTop, Pause, PersonStanding, Power, ShieldAlert, SkipBack, SkipForward, Thermometer, TriangleAlert, Tv, Volume2, VolumeX, Warehouse, Wind, type LucideIcon } from 'lucide-react';
import { hasIcon, Icon } from '../../ui';
import { symbolAliases } from './symbolAliases';
import { useRender } from '../render-context';

/** The node of one type. */
export type NodeOf<T extends CompositionNode['type']> = Extract<CompositionNode, { type: T }>;
/** An SF symbol as the document spells it. */
export type SfSymbol = { name: string };
type Fill = FillLook;

/** SF symbols the document uses that the Studio's own icon aliases lack, mapped to the nearest lucide glyph. */
const sfAliases: Record<string, LucideIcon> = {
  'thermometer.medium': Thermometer, 'line.3.horizontal': Menu, 'door.left.hand.closed': DoorClosed, 'aqi.medium': Wind, power: Power,
  'shield.lefthalf.filled': ShieldAlert, 'exclamationmark.shield': ShieldAlert, 'lock.trianglebadge.exclamationmark': ShieldAlert, 'figure.walk.motion': Footprints,
  'figure.stand': PersonStanding, 'window.vertical.open': PanelTop, 'window.vertical.closed': PanelTop, 'lock.open': LockOpen, 'door.garage.closed': Warehouse,
  'door.garage.open': DoorOpen, 'checkmark.circle': CircleCheck, 'exclamationmark.triangle.fill': TriangleAlert, 'speaker.slash.fill': VolumeX, 'speaker.slash': VolumeX,
  'speaker.wave.2.fill': Volume2, 'record.circle': CircleDot, 'square.stack': Layers, 'battery.100percent': BatteryFull, 'arrow.up.right': ArrowUpRight, drop: Droplet,
  checkmark: Check, 'cloud.sun': CloudSun, 'chevron.up': ChevronUp, keyboard: Keyboard, 'pause.fill': Pause, minus: Minus, 'play.tv': Tv, 'backward.fill': SkipBack, 'forward.fill': SkipForward,
  // The map buttons: Locate's `scope` was the preview's crosshair, and the vacuum commands' own symbols.
  scope: Crosshair, 'play.fill': Play, 'stop.fill': Square,
  // The filled spellings the style-parts corpus (`sh.symbol-part@1`) and story use for weather.
  'cloud.sun.fill': CloudSun, 'drop.fill': Droplet, 'location.north.fill': Navigation, 'moon.stars.fill': MoonStar,
};
/** Whether {@link GlyphByName} draws a real glyph for `name` (an alias or an icon of the Studio's set), not the "?" fallback. */
export const hasGlyph = (name: string): boolean => Boolean(sfAliases[name] ?? symbolAliases[name]) || hasIcon(name);
/** A glyph by SF symbol name: the aliases above, then the Studio's icon set, then a generic glyph. */
export function GlyphByName({ name, size = 22 }: { name: string; size?: number }) {
  const Alias = sfAliases[name] ?? symbolAliases[name];
  return Alias ? <Alias size={size} strokeWidth={1.8} data-icon={name} aria-hidden="true"/> : <Icon name={name} size={size}/>;
}
/** A glyph from a document symbol. */
export function Glyph({ symbol, size = 22 }: { symbol?: SfSymbol; size?: number }) {
  return symbol ? <GlyphByName name={symbol.name} size={size}/> : null;
}
/**
 * The CSS colour of a solid fill; undefined for the standard fill. A light and dark pair is `light-dark()`, which the element's `color-scheme`
 * decides: the preview is dark, and a sheet is light unless it asks for dark or the browser is dark.
 */
export const rgb = (fill: Fill | undefined): string | undefined => solidColor(fill);
/** The canonical spacing tokens; `section-header` is 10, as native `SpaceToken.sectionHeader`, apple/Sources/HassCore/ServerUIComposition/ServerUICompositionDocument.swift:143 (native-home fcbb4876). */
const spaces: Record<string, number> = { zero: 0, xs: 4, s: 8, m: 12, l: 16, xl: 24, 'section-header': 10 };
/** Points for a spacing value. */
export const points = (space: { type: 'token'; name: string } | { type: 'points'; value: number } | undefined, fallback = 12): number =>
  !space ? fallback : space.type === 'points' ? space.value : spaces[space.name] ?? fallback;

/** What a read or operand gave, for drawing. */
export interface Shown { state: 'ready' | 'loading' | 'unavailable'; text: string }
const shown = (result: ReadResult, unavailable: string): Shown => result.status === 'value'
  ? { state: 'ready', text: typeof result.value === 'string' ? result.value : result.value === null || typeof result.value === 'object' ? unavailable : String(result.value) }
  : { state: result.status, text: result.status === 'loading' ? '' : unavailable };
/**
 * Evaluates a text slot or an operand against the house. Unavailable draws the slot's own `fallback` (`sh.rules@1`), else the node's own text.
 * Loading keeps what the slot showed last when `keep` names it (a node and slot), else draws nothing yet.
 */
export function useOperand(operand: Operand | TextSlot | undefined, unavailable = '', keep?: string): Shown {
  const { env, kept } = useRender();
  if (!operand) return { state: 'ready', text: '' };
  const out = shown(resolveText(operand as TextSlot, env), unavailable);
  if (keep && kept) {
    if (out.state === 'ready') kept.set(keep, out.text);
    else if (out.state === 'loading' && kept.has(keep)) return { state: 'ready', text: kept.get(keep) as string };
  }
  return out;
}
/** What a look slot gave last when it is loading now: the look kept under `key`, else `undefined`. */
function keepLook<T>(kept: Map<string, unknown> | undefined, key: string, result: { status: 'value'; look: T } | { status: 'loading' }): T | undefined {
  if (result.status === 'value') { kept?.set(key, result.look); return result.look; }
  return kept?.get(key) as T | undefined;
}
/** The fill a slot draws (`sh.rules@1`): a rule or an entity's color, kept while loading. `undefined` before the first answer. */
export function useFill(slot: FillLook | Conditional<FillLook> | BoundColor<FillLook> | undefined, role: ColorRole, key: string): FillLook | undefined {
  const { env, kept } = useRender();
  return slot ? keepLook(kept, key, resolveFill(slot, env, role)) : undefined;
}
/** The symbol a slot draws: exact, by rule, or named by an entity (with its fallback when that name cannot be drawn), kept while loading. */
export function useSymbol(slot: SymbolLook | Conditional<SymbolLook> | BoundSymbol, key: string): SymbolLook {
  const { env, kept } = useRender();
  return keepLook(kept, key, resolveSymbol(slot, { ...env, hasSymbol: hasGlyph })) ?? (slot.type === 'bound-symbol' ? slot.fallback : slot.type === 'conditional' ? slot.otherwise : slot);
}
/** The badge a chip, tile or tab draws: its text, or `null` for none (none, empty, 0 or unavailable); kept while loading. */
export function useBadge(badge: { type: 'none' } | { type: 'value'; value: Operand } | undefined, key: string): string | null {
  const { env, kept } = useRender();
  if (!badge || badge.type === 'none') return null;
  const found = resolveBadge(badge, env);
  if (found.status === 'value') { kept?.set(key, found.text); return found.text; }
  return (kept?.get(key) as string | null | undefined) ?? null;
}
/** Whether a control is enabled now (`sh.enabled-when@1`). `keep` repeats the last answer while the condition cannot be answered. */
export function useEnabled(rule: EnabledWhen | undefined, key: string): boolean {
  const { env, previous } = useRender();
  if (!rule) return true;
  const now = isEnabled(rule, env, previous.get(key));
  previous.set(key, now);
  return now;
}
/** The small count on a chip, a tile or a tab. Nothing is drawn for no badge. */
export function Badge({ text }: { text: string | null }) {
  return text ? <span className="sh-badge" data-testid="badge" aria-label={`${text} new`}>{text}</span> : null;
}
/** Reads a field of a source (`['stateText']`, `['isOn']`). */
export function useSourceRead(sourceId: string | undefined, path: string[]): ReadResult {
  const { env } = useRender();
  return sourceId ? env.read(sourceId, path) : { status: 'unavailable' };
}
/** The first of a source's text fields that has a value: `stateText`, then `state`. */
export function useSourceText(sourceId: string | undefined, unavailable = ''): Shown {
  const { env } = useRender();
  if (!sourceId) return { state: 'unavailable', text: unavailable };
  const first = env.read(sourceId, ['stateText']);
  return shown(first.status === 'value' ? first : env.read(sourceId, ['state']), unavailable);
}
/** Whether a source field is `true`. */
export const isTrue = (result: ReadResult) => result.status === 'value' && result.value === true;

/**
 * A control that runs an action in Use and is inert in Edit (the selection layer takes the click there). With no action it
 * is a plain block, which also keeps read-only tiles out of the tab order.
 */
export function Pressable({ action, control, className, style, children, label, describedBy, enabled = true }: {
  action?: CompositionActionSlot; control?: Json; className: string; style?: CSSProperties; children: ReactNode; label?: string;
  /** The id of an element that describes the control: a screen-reader hint, as the app's `accessibilityHint`. */
  describedBy?: string;
  /** False while the node's `enabledWhen` does not hold: dimmed, unannounced as pressable and inert (`sh.enabled-when@1`). */
  enabled?: boolean;
}) {
  const { mode, run } = useRender();
  if (!action) return <div className={className} style={style} aria-describedby={describedBy} data-disabled={enabled ? undefined : ''} aria-disabled={enabled ? undefined : true}>{children}</div>;
  return <button type="button" className={className} style={style} aria-label={label} aria-describedby={describedBy} disabled={!enabled} data-disabled={enabled ? undefined : ''}
    onClick={() => { if (mode === 'use' && enabled) run(action, control); }}>{children}</button>;
}

/** Colour families of the tile finish (`kit.css` `--fam-*`). */
const families: Record<string, string> = {
  neutral: 'neutral', lights: 'lights', occupancy: 'occupancy', groceries: 'groceries',
  'chore-resident-1': 'chore-resident1', 'chore-resident-2': 'chore-resident2', 'chore-unassigned': 'chore-unassigned', 'chore-home': 'chore-home',
};
/** CSS variables for a family: the glyph colour and, where the family has one, the fill. */
export const familyStyle = (family: string): CSSProperties => {
  const name = families[family] ?? 'neutral';
  return { '--glyph': `var(--fam-${name}-glyph)`, '--fill': name === 'neutral' ? undefined : `var(--fam-${name}-fill)` } as CSSProperties;
};
