import { useSyncExternalStore } from 'react';

/**
 * The tab each tab container shows in the simulator now, by the container's id. The simulator writes it as its tab changes; the library's tree
 * reads it to mute the rows of areas the shown tab does not show and to say which tab a new Tab Area is for. Held outside React state so a
 * tab change re-renders only the readers. There is one simulator on a page, so one table is enough.
 */
const shown = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

export const shownTabs = {
  get: (nodeId: string) => shown.get(nodeId),
  set(nodeId: string, tabId: string) {
    if (shown.get(nodeId) === tabId) return;
    shown.set(nodeId, tabId);
    version += 1;
    listeners.forEach(listener => listener());
  },
  version: () => version,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

/** The tab a container shows now, or undefined before the simulator has drawn it. */
export function useShownTab(nodeId: string | undefined): string | undefined {
  return useSyncExternalStore(shownTabs.subscribe, () => nodeId ? shownTabs.get(nodeId) : undefined, () => undefined);
}

/** A number that changes whenever any container's shown tab does, for a reader that looks at several containers while it draws. */
export function useShownTabsVersion(): number {
  return useSyncExternalStore(shownTabs.subscribe, shownTabs.version, () => 0);
}
