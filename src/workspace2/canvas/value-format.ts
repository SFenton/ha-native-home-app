import type { GraphJSON, GraphNode, PortType, SimulationClock } from '../../shared/composition/graph';
import type { PortObservation } from './observations';
import { record } from '../../shared/composition/graph/json';
import { isDateText, isDateTimeText, wallTime } from '../../shared/composition/pipeline/dates';
import { noItemsText } from '../logic-simulation/per-item';

export interface ValueFormatOptions {
  readonly rows?: boolean;
  readonly full?: boolean;
  readonly depth?: number;
  readonly clock?: SimulationClock;
  readonly timeZone?: string;
  readonly shape?: PortType['shape'];
  readonly valueType?: PortType['valueType'];
  readonly literal?: boolean;
}

export function nodeValueOptions(node: GraphNode, type = node.outputs[0]?.type): ValueFormatOptions {
  return { shape: type?.shape, valueType: type?.valueType,
    literal: node.payload.kind === 'operand'
      ? node.payload.value.type === 'literal' && typeof node.payload.value.value === 'string'
      : node.payload.kind === 'slot' && record(node.payload.value) && node.payload.value.type === 'literal' && typeof node.payload.value.value === 'string' };
}

function shapeMember(shape: ValueFormatOptions['shape'], kind: 'string' | 'array' | 'object') {
  return shape?.kind === 'union' ? shape.of.find(member => member.kind === kind) : shape;
}

export function childValueOptions(options: ValueFormatOptions, key?: string): ValueFormatOptions {
  const shape = shapeMember(options.shape, key === undefined ? 'array' : 'object');
  return { ...options, valueType: undefined,
    shape: shape?.kind === 'array' ? shape.of : shape?.kind === 'object' && key !== undefined ? shape.fields[key]?.shape : undefined };
}

const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/;

function zonedWallTime(value: string, timeZone: string) {
  const instant = wallTime(value, 0)!;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts((instant.days * 86400 + instant.seconds) * 1000).map(part => [part.type, part.value]));
  return wallTime(`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`, 0)!;
}

function dateText(value: string, options: ValueFormatOptions): string | undefined {
  const shape = shapeMember(options.shape, 'string'), format = shape?.kind === 'string' ? shape.format : undefined;
  const typed = options.valueType === 'time' || format === 'date' || format === 'date-time';
  const dateOnly = isDateText(value);
  if (!dateOnly && (!isDateTimeText(value) || !typed && !isoDateTime.test(value))) return undefined;
  if (format && !typed) return undefined;
  const offset = options.clock?.utcOffsetMinutes ?? 0;
  // Zoned instants use the house's historical offset; offset-free typed values already name its wall time.
  const time = !dateOnly && hasOffset.test(value) && options.timeZone ? zonedWallTime(value, options.timeZone) : wallTime(value, offset)!;
  const date = new Date((time.days * 86400 + time.seconds) * 1000);
  const now = options.clock ? wallTime(options.clock.now, offset)
    : options.timeZone ? zonedWallTime(new Date().toISOString(), options.timeZone) : wallTime(new Date().toISOString(), offset);
  const currentYear = now && new Date(now.days * 86400_000).getUTCFullYear();
  const day = time.days === now?.days ? 'Today' : !dateOnly && time.days === (now?.days ?? NaN) - 1 ? 'Yesterday'
    : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric',
      ...(date.getUTCFullYear() !== currentYear ? { year: 'numeric' } : {}) }).format(date);
  return dateOnly ? day : `${day}, ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(date)}`;
}

export function primaryText(value: GraphJSON, options: ValueFormatOptions = {}): string {
  return primaryTextAt(value, options);
}

export function formatValue(value: GraphJSON, options: ValueFormatOptions = {}): string {
  const { rows = false, full = false, depth = 0 } = options;
  if (value === null) return 'Null';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (options.literal) return value || 'Empty text';
    return dateText(value, options) ?? (/^[a-z]+(_[a-z]+)+$/.test(value)
      ? value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ') : value || 'Empty text');
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const unit = rows ? 'row' : 'item', count = `${value.length} ${unit}${value.length === 1 ? '' : 's'}`;
    if (!full && depth >= 2 || !value.length) return count;
    const shown = full ? value : value.slice(0, 3);
    const child = { ...childValueOptions(options), rows: false, depth: depth + 1 };
    return `${count}; ${shown.map(item => full ? formatValue(item, child) : primaryTextAt(item, child)).join('; ')}${shown.length < value.length ? `; +${value.length - shown.length} more ${unit}s` : ''}`;
  }
  const entries = Object.entries(value);
  if (!full && depth >= 2) return `${entries.length} ${entries.length === 1 ? 'field' : 'fields'}`;
  if (!entries.length) return '0 fields';
  const shown = full ? entries : entries.slice(0, 4);
  return `${shown.map(([key, item]) => `${key}: ${formatValue(item, { ...childValueOptions(options, key), depth: depth + 1 })}`).join('; ')}${shown.length < entries.length ? `; +${entries.length - shown.length} more fields` : ''}`;
}

function primaryTextAt(value: GraphJSON, options: ValueFormatOptions): string {
  if (record(value)) {
    for (const key of ['title', 'summary', 'name']) if (typeof value[key] === 'string') return formatValue(value[key], childValueOptions(options, key));
  }
  return formatValue(value, options);
}

export function describeValue(value: GraphJSON, options: ValueFormatOptions = {}): string {
  const text = formatValue(value, options), exact = formatValue(value, { ...options, full: true, literal: true });
  return text === exact ? text : `${text} (${exact})`;
}

export function formatObservation(observation?: PortObservation, rows = false, full = false, output = true, options: ValueFormatOptions = {}, exact = false): string {
  if (!observation) return 'Not observed';
  if (observation.state === 'no-items') return noItemsText(observation.item);
  const state = observation.state === 'unavailable' ? 'Unavailable' : "Can't tell";
  const format = exact ? describeValue : formatValue, valueOptions = { ...options, ...observation.valueFormat, rows, full };
  if (observation.state === 'known') return format(observation.value, valueOptions);
  return output && observation.kept ? `${state}; Kept: ${format(observation.value, valueOptions)}` : state;
}

export const sourceText = (observation: PortObservation) => observation.source && ({ live: 'Live', pinned: 'Pinned', scenario: 'Scenario' })[observation.source];
