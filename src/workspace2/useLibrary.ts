import { useCallback, useState } from 'react';
import { categories, defaultOpen, type Category, type Tier } from './layout';

/** The `localStorage` key that remembers the open category and whether the library is open, per tier. */
export const LIBRARY_KEY = 'sh-studio.library';

interface Stored { category?: Category; docked?: boolean; flyout?: boolean; /** Group id to open (true) or closed (false), the person's choice. */ groups?: Record<string, boolean> }

function read(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '{}') as Stored;
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function write(value: Stored) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(value)); } catch { /* storage may be unavailable; the choice then lasts the session */ }
}

/** The library's state. */
export interface Library {
  category: Category;
  /** Whether the library is open in the current tier. */
  open: boolean;
  /** A press on a rail button: the active one closes the panel, another switches category and opens it. */
  press(category: Category): void;
  /** Changes the category without opening or closing the panel: the tree following the simulator must not reopen a panel that is closing. */
  show(category: Category): void;
  /** Opens or closes the panel without changing the category. */
  setOpen(open: boolean): void;
  /** Whether a group of a list is open: the person's choice, else `fallback`. */
  groupOpen(id: string, fallback: boolean): boolean;
  /** Opens or closes a group and remembers it. */
  setGroup(id: string, open: boolean): void;
}

/**
 * The open category and the open or closed choice. Open or closed is remembered for the docked and the flyout tier on their own;
 * until a person chooses, the docked library is open from 1200 px wide and the flyout is closed.
 */
export function useLibrary(tier: Tier, width: number): Library {
  const [stored, setStored] = useState<Stored>(read);
  const category = stored.category && categories.includes(stored.category) ? stored.category : 'tabs';
  const slot = tier === 'flyout' ? 'flyout' : 'docked';
  const open = tier === 'phone' ? false : stored[slot] ?? defaultOpen(tier, width);
  const update = useCallback((patch: Stored) => setStored(old => { const next = { ...old, ...patch }; write(next); return next; }), []);
  const setOpen = useCallback((next: boolean) => update({ [slot]: next }), [update, slot]);
  const press = useCallback((next: Category) => {
    if (open && next === category) update({ [slot]: false });
    else update({ category: next, [slot]: true });
  }, [open, category, update, slot]);
  const groupOpen = useCallback((id: string, fallback: boolean) => typeof stored.groups?.[id] === 'boolean' ? stored.groups[id] : fallback, [stored.groups]);
  const setGroup = useCallback((id: string, next: boolean) => setStored(old => {
    if (old.groups?.[id] === next) return old;
    const value = { ...old, groups: { ...old.groups, [id]: next } }; write(value); return value;
  }), []);
  const show = useCallback((next: Category) => update({ category: next }), [update]);
  return { category, open, press, show, setOpen, groupOpen, setGroup };
}
