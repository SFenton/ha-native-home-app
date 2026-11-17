import { useSyncExternalStore } from 'react';
import { request } from '../api';
import type { DocumentIndex, SelectionKey } from '../preview2/model';
import { toastManager } from './toasts';

/** The icons a person chose for rows of the library, by selection key. Studio only: the document and the app never see them. */
export type ListIcons = Readonly<Record<string, string>>;

const NOTES = '/native/api/studio-notes';
const SAVE_FAILED = 'The icon was not saved.';

/**
 * The store behind "Change List Icon…" (studio-ux2 lib3, L-icons). One map of selection key to icon name, kept in the
 * Studio's own `studio-notes.json` beside the draft. A choice applies at once and is saved in the background; it is not an
 * undo step and never touches the document, so the draft stays "Saved". A failed save raises a toast and keeps the choice for
 * the session.
 */
export interface ListIconStore {
  get(key: SelectionKey): string | undefined;
  set(key: SelectionKey, name: string): void;
  clear(key: SelectionKey): void;
  /** Drops the choices of rows that no longer exist. The file is rewritten at the next save. */
  prune(index: DocumentIndex): void;
  /** Reads the saved choices; choices made before it answered win. */
  load(): Promise<void>;
  /** Resolves once every save started so far has settled. */
  settled(): Promise<void>;
  snapshot(): ListIcons;
  subscribe(listener: () => void): () => void;
}

/** Makes a store; `save` writes the whole map (the server replaces its file). */
export function createListIcons(options: { read?: () => Promise<ListIcons>; write?: (icons: ListIcons) => Promise<void>; onFailure?: () => void } = {}): ListIconStore {
  const read = options.read ?? (async () => (await request<{ listIcons: ListIcons }>(NOTES)).listIcons ?? {});
  const write = options.write ?? (async icons => { await request(NOTES, { method: 'PUT', body: JSON.stringify({ listIcons: icons }) }); });
  const onFailure = options.onFailure ?? (() => { toastManager.add({ title: SAVE_FAILED }); });
  let icons: ListIcons = {};
  let loaded = false;
  let pending: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const save = () => {
    // Saves go one at a time, each with the newest map, so a slow answer never overwrites a newer choice.
    pending = pending.then(async () => { try { await write(icons); } catch { onFailure(); } });
  };
  const change = (next: ListIcons) => { icons = next; emit(); save(); };
  return {
    get: key => icons[key],
    set(key, name) { if (icons[key] !== name) change({ ...icons, [key]: name }); },
    clear(key) { if (key in icons) { const { [key]: _gone, ...rest } = icons; change(rest); } },
    prune(index) {
      const kept = Object.fromEntries(Object.entries(icons).filter(([key]) => index.get(key as SelectionKey)));
      if (Object.keys(kept).length !== Object.keys(icons).length) { icons = kept; emit(); }
    },
    async load() {
      if (loaded) return;
      loaded = true;
      try { icons = { ...(await read()), ...icons }; emit(); } catch { loaded = false; }
    },
    settled: () => pending,
    snapshot: () => icons,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** The one store the workspace uses. */
export const listIcons = createListIcons();

/** The icons chosen so far; re-renders when one is set or cleared. */
export function useListIcons(store: ListIconStore = listIcons): ListIcons {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
