import { useSyncExternalStore } from 'react';
import type { SelectionKey } from './model';

/**
 * The selection the preview draws, held outside React state so a change re-renders only the two nodes whose ring changes
 * (the one losing it and the one gaining it) instead of the whole page.
 */
export interface SelectionStore {
  /** The selected key. */
  get(): SelectionKey | undefined;
  /** Sets the value without notifying; call during render so nodes mounting now read it, then `notify()` in a layout effect. */
  put(next: SelectionKey | undefined, tabs: Readonly<Record<string, string>>): void;
  notify(): void;
  subscribe(listener: () => void): () => void;
  /** The local tab to show for a `local-tabs` node because the selection or reveal target is inside it. */
  tabFor(nodeId: string): string | undefined;
}

/** Makes an empty store. */
export function createSelectionStore(): SelectionStore {
  let selection: SelectionKey | undefined;
  let tabs: Readonly<Record<string, string>> = {};
  const listeners = new Set<() => void>();
  return {
    get: () => selection,
    put(next, hints) { selection = next; tabs = hints; },
    notify: () => listeners.forEach(listener => listener()),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    tabFor: nodeId => tabs[nodeId],
  };
}

/** Whether `key` is the selected key; re-renders its caller only when that answer changes. */
export function useIsSelected(store: SelectionStore, key: SelectionKey): boolean {
  return useSyncExternalStore(store.subscribe, () => store.get() === key, () => false);
}
/** The local tab the selection forces for `nodeId`, if any. */
export function useTabHint(store: SelectionStore, nodeId: string): string | undefined {
  return useSyncExternalStore(store.subscribe, () => store.tabFor(nodeId), () => undefined);
}
