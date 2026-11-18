import type { RailSide, Turn } from './duo-pose';
import { COMPRESS_MARGIN, HELD, MORE_MENU, RAIL, STATUS } from './rail-constants';

/** How an authored rail item ranks when the rail runs out of room: `required` never folds into More. */
export type RailPriority = 'required' | 'normal' | 'low';

/** One item of the header group the rail may fold into More. */
export interface RailEntry {
  /** A stable key, the one the menu and the circle share. */
  key: string;
  priority: RailPriority;
}

/** A glass group in the rail's header: one pill of stacked circles (`shared`), or one circle each. */
export interface RailGroupInput {
  id: string;
  shared: boolean;
  items: RailEntry[];
}

/** What the rail's layout depends on. */
export interface RailInput {
  /** The window's width, and its length along the rail (its height). */
  width: number;
  length: number;
  /** The camera-side edge the rail sits on. */
  side: RailSide;
  /** The camera, when the window has one: the end of the rail it is at, and the length it keeps clear along the rail. */
  camera?: { end: 'top' | 'bottom'; reach: number };
  /** How many tabs the tab pill holds. */
  tabs: number;
  /** The header groups, top to bottom (leading before trailing). */
  groups: RailGroupInput[];
}

/** A box along the rail's axis, in window points. */
export interface RailSpan { top: number; height: number; bottom: number }

/** Where everything in the rail sits, in window points. */
export interface RailLayout {
  /** The column's centre line, from the window's left edge. */
  centre: number;
  /** Whether anything folded into More. */
  compressed: boolean;
  /** The keys that folded, in the order they folded (lowest priority first, the bottom one first among equals). */
  folded: string[];
  /** What each group still shows, in order; a group with nothing left is dropped. */
  groups: { id: string; shared: boolean; keys: string[] }[];
  /** The header group's span, when anything is left in it. */
  header?: RailSpan;
  /** The More circle's top, when anything folded. */
  more?: { top: number };
  /** The tab pill at rest and while held: the held pill is wider, its tabs are further apart, and its bottom is 8 pt nearer the edge. */
  tabs: RailSpan & { pitch: number; width: number };
  held: RailSpan & { pitch: number; width: number };
}

const rank: Record<RailPriority, number> = { low: 0, normal: 1, required: 2 };
/** The height of a header group of `count` circles. */
const groupHeight = (shared: boolean, count: number) => count * RAIL.circle + (shared ? 0 : Math.max(0, count - 1) * RAIL.gap);
/** The height of the header: its groups with a gap between each. */
const headerHeight = (groups: { shared: boolean; keys: string[] }[]) => {
  const shown = groups.filter(group => group.keys.length);
  return shown.reduce((sum, group) => sum + groupHeight(group.shared, group.keys.length), 0) + Math.max(0, shown.length - 1) * RAIL.gap;
};
/** The height of the tab pill at a pitch: the pill's padding twice, and one pitch per tab. */
export const tabsHeight = (tabs: number, pitch: number) => RAIL.tabsPad * 2 + pitch * tabs;

/**
 * The rail's layout in the closed Duo (and the unfolded Duo sideways): a pure function of the window and what the rail holds.
 *
 * The header group hangs under the camera's keep-clear region (or from 24 pt at the other end) and the tab pill sits at the other end.
 * When `header + gap + tabs` is taller than `length - keepClear - 24` items fold into a More circle one at a time, the lowest priority
 * first and among equals the bottom item first (HIG, Designing for iPhone Duo: "Items overflow bottom-to-top by default"); a `required`
 * item never folds, and the tabs never do. Once anything folds, More and its 12 pt gap count in the height. A compressed stack is anchored
 * to the end away from the camera, and never nearer the camera than the keep-clear region (A3, A9). The order never flips.
 */
export function railLayout(input: RailInput): RailLayout {
  const { length, camera } = input;
  const end = camera?.end ?? 'top', reach = camera?.reach ?? 0;
  // A rail with no camera starts under the status bar, so what it keeps clear is that.
  const clear = camera ? reach : RAIL.openTop;
  const avail = length - clear - COMPRESS_MARGIN;
  const tabsAt = tabsHeight(input.tabs, RAIL.pitch);

  const order = input.groups.flatMap(group => group.items.map(item => ({ key: item.key, priority: item.priority })));
  // Fold order: lowest priority first; the same priority folds the one lower in the rail first.
  const queue = order.map((item, at) => ({ ...item, at })).filter(item => item.priority !== 'required').sort((a, b) => rank[a.priority] - rank[b.priority] || b.at - a.at);
  const folded: string[] = [];
  const left = () => input.groups.map(group => ({ id: group.id, shared: group.shared, keys: group.items.map(item => item.key).filter(key => !folded.includes(key)) }));
  const need = () => {
    const header = headerHeight(left());
    return header + (header > 0 ? RAIL.gap : 0) + (folded.length ? RAIL.circle + RAIL.gap : 0) + tabsAt;
  };
  while (need() > avail && queue.length) folded.push(queue.shift()!.key);

  const groups = left().filter(group => group.keys.length);
  const compressed = folded.length > 0;
  const endReach = end === 'bottom' ? reach : 0;
  const bottomAtRest = compressed ? length - Math.max(RAIL.compressedEdge, endReach)
    : end === 'top' ? length - RAIL.tabsFromEdge : length - reach - RAIL.tabsBelowCamera;
  const tabsTop = bottomAtRest - tabsAt;
  const heldBottom = Math.min(bottomAtRest + HELD.bottomShift, length - endReach), heldHeight = tabsHeight(input.tabs, HELD.pitch);
  const headerTop = end === 'top' ? (camera ? reach + RAIL.headerBelowCamera : RAIL.openTop) : RAIL.headerFromEdge;
  const height = headerHeight(groups);
  return {
    centre: input.side === 'leading' ? RAIL.centre : input.width - RAIL.centre,
    compressed, folded, groups,
    header: height > 0 ? { top: headerTop, height, bottom: headerTop + height } : undefined,
    more: compressed ? { top: tabsTop - RAIL.gap - RAIL.circle } : undefined,
    tabs: { top: tabsTop, height: tabsAt, bottom: bottomAtRest, pitch: RAIL.pitch, width: RAIL.pill },
    held: { top: heldBottom - heldHeight, height: heldHeight, bottom: heldBottom, pitch: HELD.pitch, width: HELD.pill },
  };
}

/** The More menu's box in the window: it takes the More circle's top corner on the rail's side and grows inward and down. */
export function moreMenuBox(layout: RailLayout, side: RailSide, rows: number): { left: number; top: number; width: number; height: number } | undefined {
  if (!layout.more) return undefined;
  const edge = side === 'leading' ? layout.centre - RAIL.circle / 2 : layout.centre + RAIL.circle / 2;
  return { left: side === 'leading' ? edge : edge - MORE_MENU.width, top: layout.more.top, width: MORE_MENU.width, height: MORE_MENU.base + MORE_MENU.row * rows };
}

/**
 * The status stack on the closed Duo's rail: the centre y of the time and of the wifi mark. Only the portrait turns have one (0 and 180);
 * at 90 and 270 the native rail shows neither. Turn 180's numbers are `interim`.
 */
export function statusStack(turn: Turn, length: number): { time: number; wifi: number } | undefined {
  if (turn % 180 !== 0) return undefined;
  return turn === 0 ? { ...STATUS.top } : { time: length - STATUS.bottom.time, wifi: length - STATUS.bottom.wifi };
}
