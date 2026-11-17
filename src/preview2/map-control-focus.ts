import { useSyncExternalStore } from 'react';

/**
 * The map button the inspector has open, so the preview rings it, and the request to open one (a click on a button in the preview while editing).
 * One small store outside React state: the inspector and the simulator are separate trees that share only this.
 */
export interface MapControlFocus { nodeId: string; buttonId: string }
let focus: MapControlFocus | undefined;
let request: (MapControlFocus & { at: number }) | undefined;
let sent = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sets (or clears) the button whose page is open. */
export function focusMapControl(next: MapControlFocus | undefined) {
  if (focus?.nodeId === next?.nodeId && focus?.buttonId === next?.buttonId) return;
  focus = next; notify();
}
/** Asks the inspector to open a button's page. */
export function requestMapControl(next: MapControlFocus) { request = { ...next, at: ++sent }; notify(); }
/** The button whose page is open, or `undefined`. */
export const useMapControlFocus = (): MapControlFocus | undefined => useSyncExternalStore(subscribe, () => focus, () => undefined);
/** The last request to open a button's page; `at` counts requests, so a later one is a different value. */
export const useMapControlRequest = (): (MapControlFocus & { at: number }) | undefined => useSyncExternalStore(subscribe, () => request, () => undefined);
