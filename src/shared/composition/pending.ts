/**
 * Capabilities the Studio compiler knows and the shipped app does not list yet (the pending set of the handshake). They are Studio-owned:
 * `contract/corpus/capabilities.pending.json` repeats this list and a test holds the two equal. `contract/corpus/capabilities.json` stays the
 * list the app declares. The set is empty while the app lists every id the Studio compiles (native-ingest c1a42b32). Each id here is exercised by a `pending-*` corpus case, which the Studio compiles and the shipped list refuses with
 * `unsupported_capability`. When the app ships an id, it moves from here to `capabilities.json` and to the explicit list in `compiler.ts`, and the generators
 * move its cases from `reject/` to `accept/` (`scripts/corpus-handshake.ts`).
 *
 * An id is mutable until a publication that uses it has been served: changes fold into `@1`. Afterwards a change of meaning is `@2`.
 */
export const pendingCompositionCapabilities: readonly string[] = [
  'sh.arc-track@1', 'sh.chart@1', 'sh.choice-icons@1', 'sh.countdown@1', 'sh.dial@1', 'sh.duration-format@1', 'sh.entity-time@1', 'sh.flow-extras@1', 'sh.grid-state-groups@1', 'sh.linear-gauge@1', 'sh.math-truncate@1', 'sh.repeat@1', 'sh.stack@1', 'sh.state-words@1', 'sh.surface-controls@1', 'sh.surface-orientation@1', 'sh.symbol-part@1', 'sh.text-style@1', 'sh.tile-ink-default@1', 'sh.tile-swipe@1',
];
