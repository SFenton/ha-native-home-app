/**
 * The Studio's one gate for `sh.tile-ink-default@1` (task `sim-fidelity`, check `integ11`).
 *
 * The id has no field. A document that declares it asks the app to draw an idle tile's icon (one with no colour of its own) and its state line in the
 * primary ink. The native app does not list the id yet, so a publication that declares it is refused by every phone. While this constant is `false`:
 * the compiler adds no `sh.tile-ink-default@1` to a document's capabilities (no document opts in), and the simulator draws today's grey ink. The
 * server's publication check still accepts a manifest with or without the id, so a case that records it stays valid.
 *
 * Turn it on once the native app ships the id: set the constant to `true`. Nothing else changes (the compiler, the simulator and the
 * publication check all read it), and `tests/tile-ink.test.ts` holds both states by passing the option.
 */
export const tileInkDefault = false;
