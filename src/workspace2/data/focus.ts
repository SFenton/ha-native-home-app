import { useSyncExternalStore } from 'react';
import type { FieldKind } from './flow';

/**
 * Two small pieces of state the Data panel and the flow editor share without owning each other: the step the outline follows, and the field slot that
 * has focus (pick mode, studio-pipes D3). Both live outside React state so the panel (in the library) and the editor (in the inspector) read one value.
 */
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => listeners.forEach(listener => listener());

// MARK: The step the outline follows

/** Which step of which flow the outline shows the data after; `step` null is the output. */
export interface FlowFocus { flowId?: string; step: number | null }
let focus: FlowFocus = { step: null };
/** Moves the outline to a step of a flow, or to its output (`null`). */
export function setFlowFocus(next: FlowFocus): void { if (next.flowId !== focus.flowId || next.step !== focus.step) { focus = next; emit(); } }
/** The step the outline follows. */
export const useFlowFocus = (): FlowFocus => useSyncExternalStore(subscribe, () => focus);

// MARK: Pick mode

/** A field slot that asked for a field of the data: a Title, a Sort field. A click on an outline field fills it instead of opening the field menu. */
export interface PickSlot {
  /** What is being chosen ("Title"), for "Choose a field for Title. Esc cancels." */
  label: string;
  /** The kinds the slot takes; the others are dimmed. */
  accepts: (kind: FieldKind) => boolean;
  onPick: (path: string[]) => void;
}
let slot: PickSlot | undefined;
/** Starts or ends pick mode. */
export function setPickSlot(next: PickSlot | undefined): void { if (next !== slot) { slot = next; emit(); } }
/** The slot that has focus, if any. */
export const usePickSlot = (): PickSlot | undefined => useSyncExternalStore(subscribe, () => slot);
/** Whether a slot has focus now, read without subscribing. */
export const pickActive = (): boolean => slot !== undefined;
