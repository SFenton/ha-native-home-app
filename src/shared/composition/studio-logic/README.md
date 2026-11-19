# Studio draft preparation

The canonical field AST, logic library and native data sources remain the source
of behavior. No graph, selector code, preview response, pin or scenario is
published.

## Shared seams

- `readStudioCanvas(document)` returns the original `raw` layout, usable
  `metadata` when available, and `warnings`. Missing layout means auto layout.
  Invalid versions/shapes, stale owners/origins and ambiguous associations warn
  `"Saved layout can't be used."` without invalidating the AST or deleting raw
  metadata. Pass usable metadata to graph `lift`; its content-and-origin IDs
  check individual associations and auto-layout unmatched nodes. Layout reset
  must be an explicit authoring transaction.
- `resolveLogicAnchor` resolves stable owner/node IDs at access time and refuses
  ambiguity. Document-only anchors require the exact canonical subtree
  fingerprint, matching the graph API. Fields use RFC 6901 pointers.
- `tileSourceFields` lists the source-valued fields of existing tile definitions.
  Only those exact fields can supply `source-id` arguments. For example,
  navigation tiles can expose `/props/titleProviderId`, and room tiles expose
  their binding's `/binding/sourceId`. A state tile's `entityId` is **not** a
  source ID and is not offered. There is no ancestor search or ambient tile.
- `bindLogicUse` and `unbindLogicUse` return one immutable authoring edit,
  including the currently resolved explicit argument. The host applies that
  result through its normal validation/undo transaction. Removing automatic
  fill does not remove a shared template or change other uses.
- `expandLogic` / `publishedDocument` use `prepareStudioDocument` before template
  expansion. Every use is resolved afresh; missing/wrong/stale/duplicate
  bindings are semantic errors, never layout warnings. Component-local fills
  propagate through the existing string-binding and private-source machinery,
  after template expansion and before component instantiation. The authored
  component bindings are not mutated.
- `compileCompositionDocumentWithOrigins` additionally returns `sourceMap`,
  `useBindings` and `layout`. Source-map pointers are document-relative.
  Locations identify the authored template/argument, responsible use, and (for
  automatic fill) binding and source field. Repeated argument copies have
  separate landings. Post-expansion native failures retain the same map on
  `CompositionExpansionError`; public compiler diagnostics retain their existing
  `/document`-prefixed authored pointers.

The ordinary compiler's `document` remains authored, while `expanded` contains
the native publication input. Existing compiler acceptance, accounting,
capability derivation and limits are unchanged. The draft's outer JSON safety
and size limits also apply to raw layout. There are at most 128 use bindings;
existing per-component and template expansion limits still apply.

## HTTP seam for W2-I

Use the existing relative URL conventions, e.g. `./native/api/draft/prepare`.
All endpoints retain the existing authentication and same-origin protections.

`POST native/api/draft/prepare` accepts `{document}` and returns:

```text
{
  valid: true,
  document, expanded, capabilities,
  origins, sourceMap, useBindings, layout,
  publicationDocumentSha256
}
```

It is read-only: it neither saves nor publishes. Invalid AST/bindings return
the normal `422 {error, issues, errors}` response. Existing `POST
native/api/validate` keeps its previous response shape.

`publicationDocumentSha256` hashes canonical **prepared native document bytes**,
so changing only layout does not change it. It is not HA's `envelopeSha256`:
the latter also identifies revision/timestamp-bearing envelopes and is owned by
Home Assistant.

`PUT native/api/draft` still takes `{document, expectedRevision}`. It persists
authored AST, bindings and raw layout atomically and never publishes. A stale
revision returns `409 {error, currentRevision}`; the response never supplies a
replacement document or retries. The host must keep its local/canvas buffer,
fetch the remote draft for comparison, and only retry on an explicit decision.
Accepted snapshots are detached from caller mutations.

Draft export retains layout and semantic bindings. Store publication, published
download/export, live comparisons and the HA publication service use the shared
preparation path. Root `studioCanvas`/`logicUseBindings`, `logicLibrary`, logic
refs and holes never survive preparation; unprepared publication envelopes are
refused. Equally named properties in literal JSON are not deleted. Existing
**native** component libraries, component refs and component bindings remain
native data, unchanged.

## Evidence

`tests/flows-canvas/draft` covers D-layout, D-binding, D-strip and D-conflict with
pure checks and mounted real HTTP routes. Server harnesses exclusively use
port 4821 and isolated `test-results/studio-data/w2-d` subdirectories; only HA
transport is faked. Browser save/reopen, canvas-buffer conflict UX and mounted
browser publication evidence remain W2-I's integration work.

The compatibility test pins the before/after compiler result and publication
decode digest for all 1,797 existing corpus documents and publication fixtures
at `2fd1e9c`. That comparison includes success/refusal, exact diagnostics,
capability lists, authored output and expanded output bytes, not just acceptance.
