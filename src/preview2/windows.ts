/** A window in points. Layout is geometric: never branch on `name`. */
export interface PreviewWindow { name: string; width: number; height: number; safeTop: number; safeBottom: number }

/**
 * The windows the preview offers. iPhone comes first (402 by 874, the atlas device table); the others exist for later phases
 * and are the portrait sizes of the Duo folded, Duo unfolded and iPad windows.
 */
export const previewWindows: readonly PreviewWindow[] = [
  { name: 'iPhone', width: 402, height: 874, safeTop: 62, safeBottom: 34 },
  { name: 'iPhone Duo, folded', width: 466, height: 678, safeTop: 24, safeBottom: 0 },
  { name: 'iPhone Duo, unfolded', width: 669, height: 951, safeTop: 62, safeBottom: 34 },
  { name: 'iPad', width: 834, height: 1194, safeTop: 24, safeBottom: 20 },
];
