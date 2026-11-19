import { FlaskConical, Pin } from 'lucide-react';
import type { CanvasHost, GraphJSON } from '../../shared/composition/graph';

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

function valueText(value: GraphJSON): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value || 'Empty text';
  return JSON.stringify(value);
}
export function observationText(observation: PortObservation): string {
  if (observation.state === 'known' || observation.kept) return valueText(observation.value);
  return observation.state === 'unavailable' ? 'Unavailable' : "Can't tell";
}
export function describeObservation(observation: PortObservation | undefined, output: boolean): string {
  if (!observation) return '';
  const state = observation.state === 'cant-tell' ? "can't tell" : observation.state;
  const value = observation.state === 'known' || observation.kept ? `, value ${observationText(observation)}` : '';
  return `, ${state}, ${observation.source}${value}${output && observation.kept ? ', kept' : ''}`;
}
export default function PortReading({ observation, output }: { observation?: PortObservation; output: boolean }) {
  if (!observation) return null;
  const hasValue = observation.state === 'known' || observation.kept;
  return <>
    <strong className="w2-canvas-port-value" data-source={observation.source} data-has-value={hasValue || undefined}>
      {hasValue && observation.source === 'pinned' && <Pin size={10} aria-hidden/>}
      {hasValue && observation.source === 'scenario' && <FlaskConical size={10} aria-hidden/>}
      {observationText(observation)}
    </strong>
    {output && observation.kept && <small className="w2-canvas-kept">kept</small>}
  </>;
}
