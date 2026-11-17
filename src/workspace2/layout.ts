/**
 * The Studio's layout, decided from the Studio's own viewport and never from the simulated device (studio-ux2, L-wide).
 * Everything here is pure: the hooks and components read it, the tests pin it.
 */

/** `phone` has no rail (sheets and bars); `flyout` slides the library over the rail; `docked` keeps it beside the rail. */
export type Tier = 'phone' | 'flyout' | 'docked';
/** The category buttons of the library rail, top to bottom. */
export type Category = 'tabs' | 'pages' | 'sheets' | 'modals' | 'components' | 'controls' | 'data';
/** The seven categories in rail order: lib3's six, then Data (studio-ux2, L-tax and L-data). */
export const categories: readonly Category[] = ['tabs', 'pages', 'sheets', 'modals', 'components', 'controls', 'data'];
/** The categories that list the app's surfaces as a tree; the others are palettes. */
export type TreeCategory = 'tabs' | 'pages' | 'sheets' | 'modals';
/** Whether a category lists surfaces. */
export const isTreeCategory = (category: Category): category is TreeCategory => category === 'tabs' || category === 'pages' || category === 'sheets' || category === 'modals';

/** The rail's width. */
export const RAIL = 64;
/** The docked panel's width, beside the rail. */
export const PANEL_DOCKED = 272;
/** The flyout's width, over the rail. */
export const PANEL_FLYOUT = 300;
/** The widest viewport that is not docked. */
export const DOCKED_FROM = 871;
/** The narrowest viewport that is not a phone. */
export const FLYOUT_FROM = 600;
/** From this width the docked library is open until a person closes it. */
export const OPEN_BY_DEFAULT_FROM = 1200;
/** From this width a docked panel and the inspector may both show. */
export const BOTH_FROM = 1100;
/** Below this canvas width the simulator rail turns horizontal and sits under the device. */
export const RAIL_UNDER_BELOW = 420;
/** Below this canvas width the Checks pill hides. */
export const CHECKS_PILL_FROM = 560;
/** The height the stage keeps for a horizontal simulator rail, in px. */
export const RAIL_UNDER_ROOM = 66;

/** The tier for a viewport. A phone is under 600 wide, or 500 tall or less. */
export function layoutTier(width: number, height: number): Tier {
  if (width < FLYOUT_FROM || height <= 500) return 'phone';
  return width < DOCKED_FROM ? 'flyout' : 'docked';
}

/** The inspector's width while something is selected; 0 on a phone, where it is a sheet. */
export function inspectorWidth(tier: Tier, width: number): number {
  if (tier === 'phone') return 0;
  if (tier === 'flyout') return width < 744 ? 288 : 320;
  return width >= 1280 ? 344 : 320;
}

/** Whether the panel and the inspector cannot show together, so the canvas never drops under 248 px. */
export const exclusive = (tier: Tier, width: number) => tier === 'flyout' || (tier === 'docked' && width < BOTH_FROM);

/** Whether the library is open before anyone chose. */
export const defaultOpen = (tier: Tier, width: number) => tier === 'docked' && width >= OPEN_BY_DEFAULT_FROM;

/** What a viewport shows given what was asked for. */
export interface Layout {
  tier: Tier;
  /** Whether the panel shows. */
  panel: boolean;
  /** Whether the inspector column shows. */
  inspector: boolean;
  /** The inspector column's width, 0 when it is not shown. */
  inspectorWidth: number;
  /** Where the canvas starts: the rail, plus the docked panel, or the flyout's own width. */
  left: number;
  /** The canvas's width. */
  canvas: number;
}

/** Resolves the layout. `panel` is whether the library is wanted open; `selected` whether something is selected (or a panel such as Tabs is on). */
export function resolveLayout(width: number, height: number, panel: boolean, selected: boolean): Layout {
  const tier = layoutTier(width, height);
  if (tier === 'phone') return { tier, panel: false, inspector: false, inspectorWidth: 0, left: 0, canvas: width };
  const both = !exclusive(tier, width);
  // Where the two cannot both show, the panel wins: choosing a selection closes the panel first (useLibrary), so they meet only transiently.
  const inspector = selected && (both || !panel);
  const panelShows = panel;
  const left = tier === 'flyout' ? (panelShows ? PANEL_FLYOUT : RAIL) : RAIL + (panelShows ? PANEL_DOCKED : 0);
  const right = inspector ? inspectorWidth(tier, width) : 0;
  return { tier, panel: panelShows, inspector, inspectorWidth: right, left, canvas: width - left - right };
}

/** Whether the simulator rail goes under the device. */
export const railUnder = (canvasWidth: number) => canvasWidth < RAIL_UNDER_BELOW;
/** Whether the Checks pill shows on a canvas this wide. */
export const checksPillShown = (canvasWidth: number) => canvasWidth >= CHECKS_PILL_FROM;
