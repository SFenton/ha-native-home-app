/** How a sheet declares its appearance (`presentation.appearance`). */
export type DeclaredAppearance = 'system' | 'dark';
/** The Studio's own Appearance setting as the preview reads it: `light` or `dark` when the author chose one, absent when it follows the system. */
export type StudioScheme = 'light' | 'dark';

/**
 * The appearance a sheet is drawn in. A sheet that declares `dark` stays dark, as the app draws it; a sheet that declares `system` follows the device, which the
 * preview stands in for with the Studio's Appearance setting: `light` or `dark` when the author chose one, the browser's scheme (`system`) when the Studio follows
 * the system. The publication keeps `system`; only the preview's draw changes.
 */
export function sheetAppearance(declared: DeclaredAppearance, studio: StudioScheme | undefined): DeclaredAppearance | 'light' {
  if (declared === 'dark') return 'dark';
  return studio ?? 'system';
}
