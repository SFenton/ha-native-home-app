import type { SimulationClock, SimulationResult } from '../../shared/composition/graph/types';
import { formatObservedValue, type ObservedValue } from './observations';
import { resultText } from './words';
import { describeValue, formatValue, type ValueFormatOptions } from '../canvas/value-format';

export interface ValuePresentation {
  readonly name: string;
  readonly unit?: string;
  readonly format?: 'date';
  readonly changedAt?: string;
  readonly range?: { readonly min: number; readonly max: number; readonly step: number };
  readonly states?: Readonly<Record<string, string>>;
  readonly traceName?: string;
}
export interface SimulationPresentation {
  readonly blocks?: Readonly<Record<string, ValuePresentation>>;
  /** Keys are anchorKey(root.anchor), not the display name. */
  readonly outputs?: Readonly<Record<string, ValuePresentation>>;
  readonly entities?: Readonly<Record<string, string>>;
  readonly traceBlocks?: readonly string[];
  readonly scenarioInputs?: readonly string[];
  readonly scenarioOutputs?: readonly string[];
}
/** Pass observations for completed values to distinguish computed text from HA availability. */
export function displayValue(result: SimulationResult | undefined, presentation?: ValuePresentation, observation?: ObservedValue, options: ValueFormatOptions = {}): string {
  if (observation && (!observation.observed || observation.state !== 'known')) return formatObservedValue(observation);
  if (result?.kind === 'operand' && result.answer.status === 'value') {
    const value = result.answer.value;
    const valueOptions = { ...options, ...observation?.valueFormat,
      ...(presentation?.format === 'date' ? { shape: { kind: 'string', format: 'date' } as const } : {}) };
    if (!valueOptions.literal && typeof value === 'string' && presentation?.states?.[value]) return presentation.states[value];
    if (presentation?.unit && (typeof value === 'number' || typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
      return `${Number(value).toFixed(1)} ${presentation.unit}`;
    }
    if (!observation && !valueOptions.literal && value === 'unavailable') return 'Unavailable';
    if (!observation && !valueOptions.literal && value === 'unknown') return "Can't tell";
    return formatValue(value, valueOptions);
  }
  return resultText(result);
}
export function describeResult(result: SimulationResult | undefined, options: ValueFormatOptions = {}): string {
  return result?.kind === 'operand' && result.answer.status === 'value' ? describeValue(result.answer.value, options) : resultText(result);
}
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${iso.slice(0, 19)}Z`));
}
export function changedAgo(at: string | undefined, now: string): string {
  if (!at) return 'Change time not supplied';
  const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / 1000));
  if (!Number.isFinite(seconds)) return 'Change time not supplied';
  if (seconds < 60) return `changed ${seconds} seconds ago`;
  if (seconds < 3600) return `changed ${Math.floor(seconds / 60)} minutes ago`;
  return `changed ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))}`;
}
export function capturedTime(at: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
}
export function clockInstant(clock: SimulationClock): string {
  return new Date(Date.parse(`${clock.now}Z`) - clock.utcOffsetMinutes * 60_000).toISOString();
}
/** Resolve the authored wall time locally. Keep the captured offset for ambiguous times; reject nonexistent DST times. */
export function editClock(base: SimulationClock, date: string, time: string, timeZone?: string): SimulationClock | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const now = `${date}T${time}:00`;
  const parsed = new Date(`${now}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== now) return undefined;
  if (!timeZone) return { now, utcOffsetMinutes: base.utcOffsetMinutes };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
  const wanted = parsed.getTime();
  let instant = wanted - base.utcOffsetMinutes * 60_000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    if (shown === wanted) return { now, utcOffsetMinutes: (wanted - instant) / 60_000 };
    instant += wanted - shown;
  }
  return undefined;
}
