import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import type { DocumentIndex, SelectionKey } from '../preview2/model';
import type { TreeCategory } from './layout';
import type { NavSurface } from '../preview2/navigation';
import { openingLevel, survivingLevel, trailTo } from './levels';
import { surfaceWord } from './outline';
import { listedSurface } from './selection';

/**
 * Where the library's tree is, per rail item (studio-ux2 lib3 and the owner's G9 change). A trail is empty while the list shows its
 * top-level rows; otherwise it is `[surface, ...containers]`, and the level on show is the last key. `open` is the set of rows opened in
 * place. Pure data: the hook below keeps it, the functions here change it.
 */
export interface TrailState {
  trails: Partial<Record<TreeCategory, readonly SelectionKey[]>>;
  open: readonly SelectionKey[];
}
export const emptyTrail: TrailState = { trails: {}, open: [] };

/** The trail of a rail item. */
export const trailOf = (state: TrailState, category: TreeCategory): readonly SelectionKey[] => state.trails[category] ?? [];

/** Puts a rail item at `trail`. */
export const setTrail = (state: TrailState, category: TreeCategory, trail: readonly SelectionKey[]): TrailState => ({ ...state, trails: { ...state.trails, [category]: trail } });

/** Goes into a container: the trail becomes the path down to it. */
export const enterLevel = (state: TrailState, category: TreeCategory, index: DocumentIndex, key: SelectionKey): TrailState => setTrail(state, category, trailTo(index, key));

/** Whether a trail is inside a level of a sheet (`levels[]`): its first key is the level itself, where a page's or a sheet's trail starts at the surface and holds its first container as well. */
export const inLevelTrail = (trail: readonly SelectionKey[]): boolean => trail[0]?.startsWith('level:') === true;

/**
 * One level out: the level above, or the top-level list from a level directly on a surface. A trail inside a level of a sheet ends at the level (`[level]`): out of it is the top-level
 * list here, and the library goes on to the sheet or the level before it (the sheet's Back and path say which).
 */
export const leaveLevel = (state: TrailState, category: TreeCategory): TrailState => {
  const trail = trailOf(state, category);
  return setTrail(state, category, trail.length > (inLevelTrail(trail) ? 1 : 2) ? trail.slice(0, -1) : []);
};

/** Opens or closes a row in place; `all` also opens or closes every key in `family` (Option-click). */
export const toggleOpen = (state: TrailState, key: SelectionKey, open?: boolean, family: readonly SelectionKey[] = []): TrailState => {
  const now = state.open.includes(key), next = open ?? !now;
  const keys = [key, ...family];
  const rest = state.open.filter(item => !keys.includes(item));
  return { ...state, open: next ? [...rest, ...keys] : rest };
};

/**
 * A trail made valid again after the document changed: a level deleted or moved away sends it up to the nearest level that is left;
 * a trail whose surface is gone is empty.
 */
export function validTrail(index: DocumentIndex, trail: readonly SelectionKey[]): readonly SelectionKey[] {
  if (!trail.length) return trail;
  if (!index.get(trail[0])) return [];
  const level = survivingLevel(index, trail);
  // A level of a sheet is a surface of its own: a trail that has come back to it is `[level]`, not the top-level list.
  return level === trail[0] ? (inLevelTrail(trail) ? [level] : []) : trailTo(index, level);
}

/**
 * The rail item whose list owns a surface: a tab's page is under Tabs, a full-screen modal under Modals, a sheet under Sheets. A level of a sheet is listed with its sheet (`shown` names it
 * when the level is shown in one), else with the first sheet that reaches it, else under Sheets.
 */
export function categoryOfSurface(document: CompositionDocument, key: SelectionKey, shown?: NavSurface): TreeCategory {
  const [kind, ...rest] = key.split(':'), id = rest.join(':');
  if (kind === 'level') {
    const sheet = listedSurface(shown?.kind === 'level' && shown.id === id ? shown : { kind: 'level', id }, document);
    return sheet ? categoryOfSurface(document, `modal:${sheet.id}` as SelectionKey) : 'sheets';
  }
  if (kind === 'modal') { const modal = document.modals.find(item => item.id === id); return modal && surfaceWord(modal) === 'Modal' ? 'modals' : 'sheets'; }
  return document.navigation.tabs.some(tab => tab.pageId === id) ? 'tabs' : 'pages';
}

/**
 * Where the panel goes to show a selection made in the simulator: the rail item that owns the node's surface, the level that holds it,
 * and the row to open (the surface itself, when the node sits directly on it).
 */
export function followSelection(document: CompositionDocument, index: DocumentIndex, selection: SelectionKey | undefined, shown?: NavSurface): { category: TreeCategory; trail: readonly SelectionKey[]; surface: SelectionKey } | undefined {
  const entry = selection ? index.get(selection) : undefined;
  if (!entry || entry.kind !== 'node' || !entry.surface) return undefined;
  const level = openingLevel(index, entry.surface, selection);
  const category = categoryOfSurface(document, entry.surface, shown);
  if (index.get(entry.surface)?.kind === 'level') {
    // A node of a level: the panel is inside that level, and the row to open is the sheet it hangs from.
    const sheet = listedSurface(shown?.kind === 'level' && `level:${shown.id}` === entry.surface ? shown : { kind: 'level', id: entry.surface.slice('level:'.length) }, document);
    return { category, trail: trailTo(index, level), surface: sheet ? `modal:${sheet.id}` as SelectionKey : entry.surface };
  }
  return { category, trail: level === entry.surface ? [] : trailTo(index, level), surface: entry.surface };
}

/** The tab row key that stands for a page in the Tabs list, else the page's own key. */
export function rowKeyFor(document: CompositionDocument, category: TreeCategory, surface: SelectionKey): SelectionKey {
  if (category !== 'tabs') return surface;
  const tab = document.navigation.tabs.find(item => `page:${item.pageId}` === surface);
  return tab ? `tab:${tab.id}` as SelectionKey : surface;
}

/**
 * The trail state, kept in a small store rather than in React state of the workspace: the library moves the trail whenever the selection
 * moves (a drop selects the tile), and a state change in the workspace root would draw the whole stage again inside the drop's task.
 * One store per workspace, so it outlives the panel closing; only the panel subscribes (see {@link useTrailState}).
 */
export function useLibraryTrail() {
  const store = useRef<{ state: TrailState; listeners: Set<() => void> } | undefined>(undefined);
  if (!store.current) store.current = { state: emptyTrail, listeners: new Set() };
  const held = store.current;
  return useMemo(() => ({
    get: () => held.state,
    subscribe: (listener: () => void) => { held.listeners.add(listener); return () => { held.listeners.delete(listener); }; },
    update: (change: (old: TrailState) => TrailState) => {
      const next = change(held.state);
      if (next === held.state) return;
      held.state = next;
      held.listeners.forEach(listener => listener());
    },
  }), [held]);
}
/** What {@link useLibraryTrail} gives. */
export type LibraryTrail = ReturnType<typeof useLibraryTrail>;

/** The trail state, drawn again when it changes; the panel's own, so the workspace is not. */
export function useTrailState(trail: LibraryTrail): TrailState {
  return useSyncExternalStore(trail.subscribe, trail.get);
}
