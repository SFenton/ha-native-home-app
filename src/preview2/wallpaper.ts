import { apiUrl } from '../api';
import type { CompositionDocument } from '../shared/composition/schema';

/** The widest blur the preview draws, in px, at 100 percent. The app's own recipe is a close match, not an equal. */
export const MAX_WALLPAPER_BLUR_PX = 24;

/** The wallpaper image the preview draws under every page, with its blur in px; absent for the plain wallpaper or a missing asset. */
export function wallpaperImage(document: CompositionDocument): { url: string; blur: number } | undefined {
  const background = document.theme.background;
  if (background.type !== 'downloaded') return undefined;
  const asset = document.assets.find(item => item.id === background.assetId);
  if (!asset) return undefined;
  const percent = background.blur.type === 'fixed' ? background.blur.percent : background.blur.initialPercent;
  return { url: apiUrl(`/native${asset.source.path}`), blur: Math.round(percent * MAX_WALLPAPER_BLUR_PX) / 100 };
}
