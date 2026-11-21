import type { GraphJSON } from '../../shared/composition/graph';
import type { PortObservation } from './observations';
import { record } from '../../shared/composition/graph/json';
import { noItemsText } from '../logic-simulation/per-item';

export function primaryText(value: GraphJSON): string {
  return primaryTextAt(value, 0);
}

export function formatValue(value: GraphJSON, options: { rows?: boolean; full?: boolean; depth?: number } = {}): string {
  const { rows = false, full = false, depth = 0 } = options;
  if (value === null) return 'Null';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value || 'Empty text';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const unit = rows ? 'row' : 'item', count = `${value.length} ${unit}${value.length === 1 ? '' : 's'}`;
    if (!full && depth >= 2 || !value.length) return count;
    const shown = full ? value : value.slice(0, 3);
    return `${count}; ${shown.map(item => full ? formatValue(item, { full, depth: depth + 1 }) : primaryTextAt(item, depth + 1)).join('; ')}${shown.length < value.length ? `; +${value.length - shown.length} more ${unit}s` : ''}`;
  }
  const entries = Object.entries(value);
  if (!full && depth >= 2) return `${entries.length} ${entries.length === 1 ? 'field' : 'fields'}`;
  if (!entries.length) return '0 fields';
  const shown = full ? entries : entries.slice(0, 4);
  return `${shown.map(([key, item]) => `${key}: ${formatValue(item, { depth: depth + 1, full })}`).join('; ')}${shown.length < entries.length ? `; +${entries.length - shown.length} more fields` : ''}`;
}

function primaryTextAt(value: GraphJSON, depth: number): string {
  if (record(value)) {
    for (const key of ['title', 'summary', 'name']) if (typeof value[key] === 'string') return formatValue(value[key]);
  }
  return formatValue(value, { depth });
}

export function formatObservation(observation?: PortObservation, rows = false, full = false, output = true): string {
  if (!observation) return 'Not observed';
  if (observation.state === 'no-items') return noItemsText(observation.item);
  const state = observation.state === 'unavailable' ? 'Unavailable' : "Can't tell";
  if (observation.state === 'known') return formatValue(observation.value, { rows, full });
  return output && observation.kept ? `${state}; Kept: ${formatValue(observation.value, { rows, full })}` : state;
}

export const sourceText = (observation: PortObservation) => observation.source && ({ live: 'Live', pinned: 'Pinned', scenario: 'Scenario' })[observation.source];
