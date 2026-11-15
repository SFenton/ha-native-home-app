import type { CSSProperties, ReactNode } from 'react';
import type { CompositionAction, CompositionNode } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { evaluateOperand, type ReadResult } from '../evaluate';
import type { Operand } from '../../shared/composition/expression';
import { ArrowUpRight, BatteryFull, Check, ChevronUp, CircleCheck, CircleDot, CloudSun, DoorClosed, DoorOpen, Droplet, Footprints, Keyboard, Layers, LockOpen, Menu, Minus, PanelTop, Pause, PersonStanding, Power, ShieldAlert, SkipBack, SkipForward, Thermometer, TriangleAlert, Tv, Volume2, VolumeX, Warehouse, Wind, type LucideIcon } from 'lucide-react';
import { Icon } from '../../ui';
import { useRender } from '../render-context';

/** The node of one type. */
export type NodeOf<T extends CompositionNode['type']> = Extract<CompositionNode, { type: T }>;
/** An SF symbol as the document spells it. */
export type SfSymbol = { name: string };
type Fill = { type: 'standard' } | { type: 'solid-rgb'; red: number; green: number; blue: number };

/** SF symbols the document uses that the Studio's own icon aliases lack, mapped to the nearest lucide glyph. */
const sfAliases: Record<string, LucideIcon> = {
  'thermometer.medium': Thermometer, 'line.3.horizontal': Menu, 'door.left.hand.closed': DoorClosed, 'aqi.medium': Wind, power: Power,
  'shield.lefthalf.filled': ShieldAlert, 'exclamationmark.shield': ShieldAlert, 'lock.trianglebadge.exclamationmark': ShieldAlert, 'figure.walk.motion': Footprints,
  'figure.stand': PersonStanding, 'window.vertical.open': PanelTop, 'window.vertical.closed': PanelTop, 'lock.open': LockOpen, 'door.garage.closed': Warehouse,
  'door.garage.open': DoorOpen, 'checkmark.circle': CircleCheck, 'exclamationmark.triangle.fill': TriangleAlert, 'speaker.slash.fill': VolumeX, 'speaker.slash': VolumeX,
  'speaker.wave.2.fill': Volume2, 'record.circle': CircleDot, 'square.stack': Layers, 'battery.100percent': BatteryFull, 'arrow.up.right': ArrowUpRight, drop: Droplet,
  checkmark: Check, 'cloud.sun': CloudSun, 'chevron.up': ChevronUp, keyboard: Keyboard, 'pause.fill': Pause, minus: Minus, 'play.tv': Tv, 'backward.fill': SkipBack, 'forward.fill': SkipForward,
};
/** A glyph by SF symbol name: the aliases above, then the Studio's icon set, then a generic glyph. */
export function GlyphByName({ name, size = 22 }: { name: string; size?: number }) {
  const Alias = sfAliases[name];
  return Alias ? <Alias size={size} strokeWidth={1.8} data-icon={name} aria-hidden="true"/> : <Icon name={name} size={size}/>;
}
/** A glyph from a document symbol. */
export function Glyph({ symbol, size = 22 }: { symbol?: SfSymbol; size?: number }) {
  return symbol ? <GlyphByName name={symbol.name} size={size}/> : null;
}
/** `rgb()` for a solid fill; undefined for the standard fill. */
export const rgb = (fill: Fill | undefined): string | undefined => fill?.type === 'solid-rgb' ? `rgb(${fill.red} ${fill.green} ${fill.blue})` : undefined;
const spaces: Record<string, number> = { zero: 0, xs: 4, s: 8, m: 12, l: 16, xl: 24, 'section-header': 20 };
/** Points for a spacing value. */
export const points = (space: { type: 'token'; name: string } | { type: 'points'; value: number } | undefined, fallback = 12): number =>
  !space ? fallback : space.type === 'points' ? space.value : spaces[space.name] ?? fallback;

/** What a read or operand gave, for drawing. */
export interface Shown { state: 'ready' | 'loading' | 'unavailable'; text: string }
const shown = (result: ReadResult, unavailable: string): Shown => result.status === 'value'
  ? { state: 'ready', text: typeof result.value === 'string' ? result.value : result.value === null || typeof result.value === 'object' ? unavailable : String(result.value) }
  : { state: result.status, text: result.status === 'loading' ? '' : unavailable };
/** Evaluates an operand against the house. Loading draws nothing yet; unavailable draws the node's own text. */
export function useOperand(operand: Operand | undefined, unavailable = ''): Shown {
  const { env } = useRender();
  return operand ? shown(evaluateOperand(operand, env), unavailable) : { state: 'ready', text: '' };
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
export function Pressable({ action, control, className, style, children, label }: {
  action?: CompositionAction; control?: Json; className: string; style?: CSSProperties; children: ReactNode; label?: string;
}) {
  const { mode, run } = useRender();
  if (!action) return <div className={className} style={style}>{children}</div>;
  return <button type="button" className={className} style={style} aria-label={label} onClick={() => { if (mode === 'use') run(action, control); }}>{children}</button>;
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
