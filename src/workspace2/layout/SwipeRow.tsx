import { ChevronRight } from 'lucide-react';
import { valueAt, type EditorPath } from '../../composition-editor';
import type { SwipeTile, TileSwipe } from '../../shared/composition/tile-swipe';
import { usePush } from '../kit';
import { useRows } from '../rows';
import SwipePage from './SwipePage';
import { swipeSummary } from './swipe-presets';

/** The tile that holds `path` takes a swipe only when it is a light group tile or a state tile. */
export const swipeTileOf = (type: string | undefined): SwipeTile | undefined => type === 'light-group-tile' || type === 'state-tile' ? type : undefined;

/**
 * The Swipe to Adjust row of a tile's Behavior group, after Tap: its summary at the trailing edge ("Off", "Brightness", "Cover Position") and a chevron.
 * One row, one setting: it makes the whole of `props.swipe` one field, which a template can set per place (`build/design/tile-swipe.md`, sections 6 and 8).
 */
export function SwipeRow({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const push = usePush();
  const node = valueAt(document, path) as { type?: string; title?: string; props?: { swipe?: TileSwipe } } | undefined;
  const tile = swipeTileOf(node?.type);
  if (!node || !tile) return null;
  const summary = swipeSummary(node.props?.swipe, tile);
  return <div className="w2-row" data-field-path={[...path, 'props', 'swipe'].join('/')}>
    <button type="button" className="w2-add-row w2-swipe-row" data-testid="swipe-row" aria-label={`Swipe to Adjust, ${summary}`}
      onClick={() => push?.push({ title: 'Swipe to Adjust', body: <SwipePage path={path}/> })}>
      <span className="w2-row-label">Swipe to Adjust</span><span className="w2-summary">{summary}</span><ChevronRight size={16} aria-hidden/>
    </button>
  </div>;
}
