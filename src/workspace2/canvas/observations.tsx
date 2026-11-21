import { FlaskConical, Pin } from 'lucide-react';
import type { CanvasHost, GraphJSON } from '../../shared/composition/graph';
import { describeValue, formatObservation, type ValueFormatOptions } from './value-format';
import { itemContextText, noItemsText, type ItemContext } from '../logic-simulation/per-item';

export type ObservationSource = 'live' | 'pinned' | 'scenario';
export type PortObservation = { readonly item?: ItemContext; readonly valueFormat?: ValueFormatOptions } & ({
  readonly state: 'no-items'; readonly item: ItemContext; readonly source?: never; readonly value?: never; readonly kept?: false;
} | { readonly source: ObservationSource } & (
  | { readonly state: 'known'; readonly value: GraphJSON; readonly kept?: boolean }
  | { readonly state: 'unavailable' | 'cant-tell'; readonly value?: never; readonly kept?: false }
  | { readonly state: 'unavailable' | 'cant-tell'; readonly value: GraphJSON; readonly kept: true }
));
export interface BlockObservation {
  readonly scenarioPinned?: boolean;
  readonly inputs?: Readonly<Record<string, PortObservation>>;
  readonly outputs?: Readonly<Record<string, PortObservation>>;
}
export type CanvasObservations = Readonly<Record<string, BlockObservation>>;
export interface CanvasHostWithObservations extends CanvasHost {
  readonly observations?: CanvasObservations;
}

export function observationText(observation: PortObservation, rows = false, output = true, options: ValueFormatOptions = {}): string {
  return formatObservation(observation, rows, false, output, options);
}
export function describeObservation(observation: PortObservation | undefined, output: boolean, rows = false, options: ValueFormatOptions = {}): string {
  if (!observation) return '';
  if (observation.state === 'no-items') return `, ${noItemsText(observation.item)}`;
  const state = observation.state === 'cant-tell' ? "can't tell" : observation.state;
  const value = observation.state === 'known' || output && observation.kept ? `, value ${describeValue(observation.value, { ...options, ...observation.valueFormat, rows })}` : '';
  return `, ${state}, ${observation.source}${value}${output && observation.kept ? ', kept' : ''}${itemContextText(observation.item) ? `, ${itemContextText(observation.item)}` : ''}`;
}
export default function PortReading({ observation, output, rows = false, options = {} }: { observation?: PortObservation; output: boolean; rows?: boolean; options?: ValueFormatOptions }) {
  if (!observation) return null;
  const hasValue = observation.state === 'known' || output && observation.kept;
  return <span className="w2-canvas-port-reading">
    <strong className="w2-canvas-port-value" data-source={observation.source} data-has-value={hasValue || undefined}
      aria-description={formatObservation(observation, rows, false, output, options, true)}>
      {hasValue && observation.source === 'pinned' && <Pin size={10} aria-hidden/>}
      {hasValue && observation.source === 'scenario' && <FlaskConical size={10} aria-hidden/>}
      {observation.state === 'no-items' ? 'No items' : observationText(observation, rows, output, options)}
    </strong>
    {itemContextText(observation.item) && <small className="w2-canvas-item-context">{itemContextText(observation.item)}</small>}
    {output && observation.kept && <small className="w2-canvas-kept">kept</small>}
  </span>;
}
