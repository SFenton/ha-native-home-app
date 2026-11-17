import type { CompositionNode } from '../../shared/composition/schema';
import { TILE_CHEVRON, TILE_GLYPH_COLUMN, TILE_TEXT_FLOOR, tileMinimumWidth, tileStrip } from '../grid';

/** The widest state line a robot shows ("Returning • 100%"), by points at the tile's 13 point state text, standing in for the app's text measure. */
const WIDEST_STATE = 106;
/** A title's width at the tile's 17 point semibold text, estimated from its length (the app measures it; a browser cannot before it draws). */
export const titleWidth = (title: string): number => Math.ceil(title.length * 9.2);

/** The two widths a tile with discs draws by: the least that shows its text on one line (`gridMinimumWidth`), and the least that keeps the discs trailing (`floorWidth`). */
export interface TileWidths { minimum: number; floor: number }

/** `UKGlassTileView.gridMinimumWidth` and `floorWidth` for a navigation tile with `discs` controls and a chevron. */
export function discTileWidths(title: string, discs: number): TileWidths {
  const strip = tileStrip(discs);
  return {
    minimum: tileMinimumWidth(Math.max(titleWidth(title), WIDEST_STATE), TILE_GLYPH_COLUMN, TILE_CHEVRON, strip),
    floor: tileMinimumWidth(TILE_TEXT_FLOOR, TILE_GLYPH_COLUMN, TILE_CHEVRON, strip),
  };
}

/** The widest state line a light tile shows, by points at the tile's 13 point state text ("Didn't Respond", `UKBrightnessTileView.stateCandidates`). */
const WIDEST_LIGHT_STATE = 96;
/**
 * `UKGlassTileView.gridMinimumWidth` and `floorWidth` for a light tile: the glyph column, the title or the widest state, the power disc,
 * and the chevron when the tile opens details (`UKBrightnessTileView` with `onOpen`).
 */
export function lightTileWidths(title: string, chevron: boolean): TileWidths {
  const strip = tileStrip(1), end = chevron ? TILE_CHEVRON : 0;
  return {
    minimum: tileMinimumWidth(Math.max(titleWidth(title), WIDEST_LIGHT_STATE), TILE_GLYPH_COLUMN, end, strip),
    floor: tileMinimumWidth(TILE_TEXT_FLOOR, TILE_GLYPH_COLUMN, end, strip),
  };
}

/**
 * The minimum width a grid child declares, or 0 for none (`UKGridMeasuring.gridMinimumWidth`). Only a tile with controls of its own
 * declares one: the vacuum tile (`UKServerUIVacuumView`'s two discs and chevron), a state tile with buttons, and the light tiles (their power
 * disc, and the chevron of a Custom Lights tile that opens details); every other node keeps its span.
 */
export function nodeMinimumWidth(node: CompositionNode): number {
  // A state tile with buttons reports the width its buttons need (`sh.tile-parts@1`); the grid then widens it when its automatic width is unset.
  if (node.type === 'state-tile') return node.props.discs?.length ? discTileWidths(node.title, node.props.discs.length).minimum : 0;
  if (node.type === 'light-group-tile') return lightTileWidths(node.title, false).minimum;
  if (node.type === 'custom-light-control') return node.props.kind === 'brightness' ? lightTileWidths(node.title, Boolean(node.props.action)).minimum : 0;
  if (node.type !== 'vacuum-control' || node.props.primitive.kind !== 'card') return 0;
  return discTileWidths(node.title, node.props.primitive.commands.length).minimum;
}
