import { FlaskConical, Pin } from 'lucide-react';
import type { CanvasHost, GraphJSON } from '../../shared/composition/graph';
import { formatObservation, formatValue } from './value-format';

export type ObservationSource = 'live' | 'pinned' | 'scenario';
export type PortObservation = { readonly source: ObservationSource } & (
  | { readonly state: 'known'; readonly value: GraphJSON; readonly kept?: boolean }
  | { readonly state: 'unavailable' | 'cant-tell'; readonly value?: never; readonly kept?: false }
  | { readonly state: 'unavailable' | 'cant-tell'; readonly value: GraphJSON; readonly kept: true }
);
export interface BlockObservation {
  readonly scenarioPinned?: boolean;
  readonly inputs?: Readonly<Record<string, PortObservation>>;
  readonly outputs?: Readonly<Record<string, PortObservation>>;
}
export type CanvasObservations = Readonly<Record<string, BlockObservation>>;
export interface CanvasHostWithObservations extends CanvasHost {
  readonly observations?: CanvasObservations;
}

export function observationText(observation: PortObservation, rows = false, output = true): string {
  return formatObservation(observation, rows, false, output);
}
export function describeObservation(observation: PortObservation | undefined, output: boolean, rows = false): string {
  if (!observation) return '';
  const state = observation.state === 'cant-tell' ? "can't tell" : observation.state;
  const value = observation.state === 'known' || output && observation.kept ? `, value ${formatValue(observation.value, { rows })}` : '';
  return `, ${state}, ${observation.source}${value}${output && observation.kept ? ', kept' : ''}`;
}
export default function PortReading({ observation, output, rows = false }: { observation?: PortObservation; output: boolean; rows?: boolean }) {
  if (!observation) return null;
  const hasValue = observation.state === 'known' || output && observation.kept;
  return <>
    <strong className="w2-canvas-port-value" data-source={observation.source} data-has-value={hasValue || undefined}>
      {hasValue && observation.source === 'pinned' && <Pin size={10} aria-hidden/>}
      {hasValue && observation.source === 'scenario' && <FlaskConical size={10} aria-hidden/>}
      {observationText(observation, rows, output)}
    </strong>
    {output && observation.kept && <small className="w2-canvas-kept">kept</small>}
  </>;
}
