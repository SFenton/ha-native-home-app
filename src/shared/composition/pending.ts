/**
 * Capabilities the Studio compiler knows and the shipped app does not list yet (the pending set of the handshake). They are Studio-owned:
 * `contract/corpus/capabilities.pending.json` repeats this list and a test holds the two equal. `contract/corpus/capabilities.json` stays the
 * list the app declares. Each id here is exercised by a `pending-*` corpus case, which the Studio compiles and the shipped list refuses with
 * `unsupported_capability`. When the app ships an id, it moves from here to `capabilities.json` and to the explicit list in `compiler.ts`, and the generators
 * move its cases from `reject/` to `accept/` (`scripts/corpus-handshake.ts`).
 *
 * The four global-chrome ids (`global-chrome.ts`) are pending on the app's side too: native-home's compiler (PR #142) understands them only in a test scope, and its own
 * shipped list does not carry them until a runtime draws them.
 *
 * An id is mutable until a publication that uses it has been served: changes fold into `@1`. Afterwards a change of meaning is `@2`.
 */
export const pendingCompositionCapabilities: readonly string[] = [
  'sh.avatar@1', 'sh.badge-nodes@1', 'sh.badge-spoken@1', 'sh.component-values@1', 'sh.dial-control@1', 'sh.dial-text-place@1', 'sh.flow-average@1', 'sh.fold-sides@1', 'sh.page-chrome-hide@1', 'sh.page-wide-open@1', 'sh.sheet-levels@1', 'sh.shell-profile@1', 'sh.tabs-visibility@1', 'sh.text-keep@1',
];
