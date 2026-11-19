/**
 * The Studio's shared default for the shipped `sh.tile-ink-default@1`.
 *
 * The id has no field. A document that declares it asks the app to draw an idle tile's icon (one with no colour of its own) and its state line in the
 * primary ink. The native app lists the id in `ServerUIIngestedCapabilities.tileContract`, so the compiler declares it by default and the
 * simulator draws the primary ink for unsaved edits and new compilations. A clean workspace draft previews its saved manifest's ink, so an
 * untouched legacy draft still previews and publishes muted ink. The server still accepts older manifests without the id.
 *
 * Compiler and preview overrides retain the legacy muted ink for compatibility checks.
 */
export const tileInkDefault = true;
