import { useSyncExternalStore } from 'react';

/**
 * Which template's fields are being chosen (templates spec, "any field"), or none. One at a time, and it outlives the inspector's content: stepping to
 * another node of the same template keeps the mode, so a template is swept node by node. Selecting anything else, Use, Done or Escape ends it.
 */
let active: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The id of the template whose fields are being chosen. */
export const useChoosing = (): string | undefined => useSyncExternalStore(subscribe, () => active, () => undefined);
/** Starts choosing the fields of `id`, or ends it with `undefined`. */
export function setChoosing(id: string | undefined): void {
  if (active === id) return;
  active = id;
  for (const listener of listeners) listener();
}
