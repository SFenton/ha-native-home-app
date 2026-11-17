import { effectiveControls, type SurfaceAxis, type SurfaceControls, type SurfaceCorner } from './surface-controls';

/**
 * The fit rule for corner button groups, as a pure function (`build/design/vacuum-map-ctl.md`, "Fit"). The app has the same rule in `MapControlFit`;
 * the two are tested with the same inputs and must give the same counts. Everything is in points, and it never reads a device.
 */
export const CONTROL_SIZE = 44;
/** The inset from the two card edges of a corner. */
export const CONTROL_INSET = 8;
/** The least space between two groups on one edge. */
export const CONTROL_GAP = 12;

export interface FitGroup { corner: SurfaceCorner; axis: SurfaceAxis; count: number }
export interface FitResult {
  corner: SurfaceCorner;
  /** The buttons drawn before More (all of them when there is no More). */
  shown: number;
  /** Whether the last slot is the More button. */
  more: boolean;
  /** The buttons that moved into More. */
  hidden: number;
}
type Edge = 'top' | 'bottom' | 'leading' | 'trailing';

/** A group of one has no axis to draw: it counts as a column. */
const axisOf = (group: FitGroup): SurfaceAxis => group.count === 1 ? 'column' : group.axis;
const edgeOf = (group: FitGroup): Edge => axisOf(group) === 'row' ? (group.corner.startsWith('top') ? 'top' : 'bottom') : (group.corner.endsWith('leading') ? 'leading' : 'trailing');
/** The corner at the other end of the edge a group runs along. */
function across(group: FitGroup): SurfaceCorner {
  const [vertical, horizontal] = group.corner.split('-') as ['top' | 'bottom', 'leading' | 'trailing'];
  return axisOf(group) === 'row' ? `${vertical}-${horizontal === 'leading' ? 'trailing' : 'leading'}` : `${vertical === 'top' ? 'bottom' : 'top'}-${horizontal}`;
}

/**
 * How many buttons of each group show on a card of `width` by `height`, and whether More shows. A group's length is the card edge its axis runs
 * along; its neighbour is the group at the other end of that edge, which needs its full length when it runs along the same edge and one button
 * when it crosses it. When both do not fit, a crossing neighbour takes its one button, two groups on one edge each get at least half, and a
 * group that needs less than half gives the remainder to the other.
 */
export function fitMapControls(size: { width: number; height: number }, groups: readonly FitGroup[]): FitResult[] {
  return groups.map(group => {
    const edge = edgeOf(group), length = axisOf(group) === 'row' ? size.width : size.height;
    const neighbour = groups.find(other => other.corner === across(group));
    const along = neighbour !== undefined && edgeOf(neighbour) === edge;
    const own = CONTROL_SIZE * group.count, theirs = neighbour === undefined ? 0 : along ? CONTROL_SIZE * neighbour.count : CONTROL_SIZE;
    const total = length - 2 * CONTROL_INSET - (neighbour ? CONTROL_GAP : 0);
    let available = total;
    if (own + theirs > total) {
      if (!along) available = total - theirs;
      else {
        const half = total / 2;
        available = own <= half ? own : theirs < half ? total - theirs : half;
      }
    }
    const room = Math.max(1, Math.floor(available / CONTROL_SIZE));
    return group.count > room ? { corner: group.corner, shown: room - 1, more: true, hidden: group.count - (room - 1) }
      : { corner: group.corner, shown: group.count, more: false, hidden: 0 };
  });
}

/** The groups of a map as the fit rule takes them. */
export const fitGroups = (controls: SurfaceControls): FitGroup[] => controls.map(group => ({ corner: group.corner, axis: group.axis, count: group.buttons.length }));

// MARK: Families

/**
 * The window families an author is warned about, by width in points: the smallest iPhone through the largest, the Duo folded and open, the iPad.
 * The map card is the window less a 16 pt margin on each side (an assumption until the native lane measures it); its height is the map's authored
 * height, the smallest the card is drawn.
 */
export const controlFamilies: readonly { id: string; name: string; width: number }[] = [
  { id: 'iphone-small', name: 'the smallest iPhone', width: 375 },
  { id: 'iphone', name: 'the iPhone', width: 402 },
  { id: 'iphone-largest', name: 'the largest iPhone', width: 440 },
  { id: 'duo-folded', name: 'the folded Duo', width: 466 },
  { id: 'duo-open', name: 'the open Duo', width: 669 },
  { id: 'ipad', name: 'the iPad', width: 834 },
];
const MARGIN = 16;
export const cornerWords: Record<SurfaceCorner, string> = { 'top-leading': 'Top Leading', 'top-trailing': 'Top Trailing', 'bottom-leading': 'Bottom Leading', 'bottom-trailing': 'Bottom Trailing' };

/** The fit of a map's groups on each family: only the families where something moves into More. */
export function overflowByFamily(map: { locate: boolean; controls?: SurfaceControls; height: number }): { family: string; name: string; groups: FitResult[]; hidden: number }[] {
  const groups = fitGroups(effectiveControls(map));
  return controlFamilies.flatMap(family => {
    const fit = fitMapControls({ width: family.width - 2 * MARGIN, height: map.height }, groups).filter(result => result.more);
    const hidden = fit.reduce((sum, result) => sum + result.hidden, 0);
    return hidden > 0 ? [{ family: family.id, name: family.name, groups: fit, hidden }] : [];
  });
}

/** The notices for a map: "On the smallest iPhone, 2 buttons move into More (Top Trailing)." Never an error. */
export function overflowNotices(map: { locate: boolean; controls?: SurfaceControls; height: number }): string[] {
  return overflowByFamily(map).map(item => {
    const where = item.groups.map(result => cornerWords[result.corner]).join(', ');
    return `On ${item.name}, ${item.hidden} ${item.hidden === 1 ? 'button moves' : 'buttons move'} into More (${where}).`;
  });
}
