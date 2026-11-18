import type { CSSProperties } from 'react';
import { BAR_LENS, HELD, MORE_MENU, RAIL } from './rail-constants';

/**
 * The tab bar's numbers as CSS custom properties, so `preview2.css` holds no literal of them and a re-measure of one line in `rail-constants.ts`
 * changes the drawing (`studio-sim-rails`, review round 1).
 */
export function tabBarVars(): CSSProperties {
  return {
    '--tabs-pad': `${RAIL.tabsPad}px`, '--capsule-w': `${RAIL.capsule.width}px`, '--capsule-h': `${RAIL.capsule.height}px`, '--glyph-tab': `${RAIL.glyph.tab}px`,
    '--hold-label': `${HELD.label}px`, '--lens-w': `${HELD.lens.width}px`, '--lens-h': `${HELD.lens.height}px`, '--lens-r': `${HELD.lens.radius}px`, '--lens-scale': HELD.lens.scale,
    '--bar-lens-x': BAR_LENS.scaleX, '--bar-lens-h': `${BAR_LENS.height}px`,
  } as CSSProperties;
}

/** The More menu's numbers as custom properties. */
export function moreMenuVars(): CSSProperties {
  return { '--menu-radius': `${MORE_MENU.radius}px`, '--menu-glyph': `${MORE_MENU.glyphCentre}px`, '--menu-label': `${MORE_MENU.labelStart}px`, '--menu-row': `${MORE_MENU.row}px`, '--menu-base': `${MORE_MENU.base}px`, '--menu-font': `${MORE_MENU.label}px` } as CSSProperties;
}
