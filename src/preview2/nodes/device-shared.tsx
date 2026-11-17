import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { CompositionAction } from '../../shared/composition/schema';
import type { NativeState } from '../../shared/native-state';
import type { Json } from '../../shared/types';
import { finiteNumber } from '../evaluate';
import { shownEntity } from '../projections';
import { useRender } from '../render-context';
import './devices.css';

/** What a device model gave: its phase and a reader for its flat fields. */
export interface Device {
  phase: 'loading' | 'ready' | 'unavailable';
  /** A field of the source, undefined when the model did not give it. */
  get<T extends Json = Json>(name: string): T | undefined;
  text(name: string): string | undefined;
  number(name: string): number | undefined;
  flag(name: string): boolean;
}
/** The fields `device-state.ts` projected for a source. A source with no model here reads as unavailable. */
export function useDevice(sourceId: string | undefined): Device {
  const { env } = useRender();
  const get = <T extends Json = Json>(name: string): T | undefined => {
    const result = sourceId ? env.read(sourceId, [name]) : undefined;
    return result?.status === 'value' && result.value !== null ? result.value as T : undefined;
  };
  const phase = get<string>('phase');
  return {
    phase: phase === 'ready' || phase === 'loading' ? phase : sourceId && env.read(sourceId, ['phase']).status === 'loading' ? 'loading' : 'unavailable', get,
    text: name => { const value = get(name); return typeof value === 'string' ? value : undefined; },
    number: name => finiteNumber(get(name)),
    flag: name => get(name) === true,
  };
}
/** One entity as the preview shows it: the house with the simulated changes on top. */
export function useEntity(entityId: string | undefined): NativeState | undefined {
  const { house, overlay } = useRender();
  return entityId ? shownEntity(house, overlay, entityId) : undefined;
}
/** The state of an entity as readable text, or undefined when it has none. */
export const stateText = (entity: NativeState | undefined) =>
  !entity || ['unavailable', 'unknown'].includes(entity.state) ? undefined : entity.state.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

/** A `call-service` action over literals, for the simulated overlay. Never reaches a service. */
export function simulatedCall(domain: string, service: string, entityId: string, data: Record<string, string | number | boolean> = {}): CompositionAction {
  return { type: 'call-service', domain, service, target: { entity_id: { type: 'literal', value: entityId } },
    data: { type: 'object', fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { type: 'literal' as const, value }])) } } as CompositionAction;
}
/** Sends a simulated call in Use; a no-op in Edit. */
export function useSimulate() {
  const { run } = useRender();
  return (entityId: string | undefined, service: string, data?: Record<string, string | number | boolean>) => {
    if (entityId) run(simulatedCall(entityId.split('.')[0], service, entityId, data));
  };
}
/**
 * A value the person can change in Use that the overlay does not simulate (a chosen fan speed, a draft text). It starts from
 * the live value, is replaced by what they pick, and clears when the mode goes back to Edit. Preview only.
 */
export function usePreviewValue<T>(live: T): [T, (next: T) => void] {
  const { mode } = useRender();
  const [picked, setPicked] = useState<{ value: T } | undefined>();
  useEffect(() => { if (mode === 'edit') setPicked(undefined); }, [mode]);
  return [picked ? picked.value : live, next => { if (mode === 'use') setPicked({ value: next }); }];
}

type Shared = { values: Map<string, unknown>; listeners: Set<() => void>; version: number };
const sharedByPreview = new WeakMap<object, Shared>();
/**
 * Like `usePreviewValue`, but the pick is shared by every node that uses the same `key` in this preview: the app icon rows
 * share one choice, the sprinkler's duration and its presets share the minutes. Cleared when the mode goes back to Edit.
 */
export function useSharedPreview<T>(key: string, live: T): [T, (next: T) => void] {
  const { mode, store } = useRender();
  let shared = sharedByPreview.get(store);
  if (!shared) { shared = { values: new Map(), listeners: new Set(), version: 0 }; sharedByPreview.set(store, shared); }
  const hub = shared;
  useSyncExternalStore(listener => { hub.listeners.add(listener); return () => { hub.listeners.delete(listener); }; }, () => hub.version);
  const change = (edit: () => void) => { edit(); hub.version += 1; hub.listeners.forEach(listener => listener()); };
  useEffect(() => { if (mode === 'edit' && hub.values.size) change(() => hub.values.clear()); }, [mode]);
  return [hub.values.has(key) ? hub.values.get(key) as T : live, next => { if (mode === 'use') change(() => hub.values.set(key, next)); }];
}

/** The system switch. Inert in Edit, where the selection layer takes the click. */
export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange?: (next: boolean) => void; disabled?: boolean }) {
  const { mode } = useRender();
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="sh-switch" disabled={disabled}
    onClick={() => { if (mode === 'use') onChange?.(!on); }}><span/></button>;
}
/** A button that does something only in Use. */
export function UseButton({ onPress, className, label, children, style, disabled }: { onPress?: () => void; className: string; label?: string; children: ReactNode; style?: CSSProperties; disabled?: boolean }) {
  const { mode } = useRender();
  return <button type="button" className={className} style={style} aria-label={label} disabled={disabled} onClick={event => { if (mode === 'use') { event.stopPropagation(); onPress?.(); } }}>{children}</button>;
}
/** The unavailable or loading line a node draws before it has data. */
export const unavailableText = 'Unavailable';
/** A percentage of a 0 to 255 brightness. */
export const brightnessPercent = (brightness: number | undefined) => brightness === undefined ? undefined : Math.round(brightness / 255 * 100);
/** `rgb()` for a light's colour, or undefined when it has none. */
export function lightColor(entity: NativeState | undefined): string | undefined {
  const rgb = entity?.rgbColor;
  return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : undefined;
}
