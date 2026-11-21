# Studio draft preparation

The canonical field AST, logic library and native data sources remain the source
of behavior. No graph, selector code, preview response, pin or scenario is
published.

## Shared seams

- `readStudioCanvas(document)` returns the original `raw` layout, usable
  `metadata` when available, and `warnings`. Missing layout means auto layout.
  Invalid versions/shapes, stale owners/origins and ambiguous associations warn
  `"Saved layout can't be used."` without invalidating the AST or deleting raw
  metadata. Only the canonical stored v2 encoding below is usable. Pass the
  returned `metadata` to graph `lift`: the reader adapts v2 into the graph core's
  unchanged in-memory v1 format, preserving explicit anchor-relative origins.
  It never infers a frame from prefixes or treats descendants as alternative
  roots. Reordering owners or moving the selected node through containers,
  tabs or blocks retains positions; removed/replaced owners cannot transfer
  positions or block annotations to another owner with identical fragment content. The graph's
  content-and-origin IDs still auto-layout unmatched nodes. Whole-document
  anchors exclude root layout from their fingerprint, as in `lift`. Layout
  reset must be an explicit authoring transaction.
- `encodeStudioCanvas(document, canvases, bundles?)` returns canonical
  `StoredStudioCanvasMetadata`. Each `CanvasLayoutInput` has `id`,
  `roots: [{anchor, nodes: [{id, origins, x, y, label?, note?}]}]`, optional `viewport`, and
  optional `groups`. Input node IDs are graph-local and origins must already
  be relative to the selected anchor. Groups reference the encoded canvas-wide
  IDs, never unqualified graph-local IDs. The writer resolves owners, qualifies
  IDs deterministically, validates the result and throws
  `CompositionValidationError` for unusable inputs. Apply its result through
  the host's normal immutable save/undo transaction; save is not publish.
- Block labels and notes are optional Studio-only presentation metadata, carried
  through the same node/origin associations as positions, including structural
  rebase and Apply. `normalizeAnnotation` trims edits, removes empty fields and
  returns `undefined` when both are empty. It refuses control/format characters
  and labels over 60 or notes over 280 characters with
  `CompositionValidationError`. Stored values must already be trimmed, nonempty
  and within those limits; readers never repair invalid annotations. Layouts
  without annotations remain usable. Preparation removes the entire root
  layout, so annotations never enter lowering, simulation or publication.
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
  fill does not remove a shared template or change other uses. `bindLogicUse`
  also captures the current reference's `logicId`. Persisted entries are
  `StoredLogicUseBinding` (the graph selector plus required `logicId`):

  ```json
  {
    "use": {"kind": "page", "id": "page-home", "nodeId": "tile-a", "field": "/props/subtitle/value"},
    "logicId": "tile-label",
    "argument": "source",
    "from": {"kind": "use-tile", "field": "/props/titleProviderId"}
  }
  ```

  Missing reference identity is refused, not inferred from a reopened draft.
  A changed reference is a semantic `invalid_reference` at the binding's
  `/logicId`, even when the new template declares the same argument. Choosing
  automatic fill again is an explicit authoring transaction.
- `expandLogic` / `publishedDocument` use `prepareStudioDocument` before template
  expansion. Every use is resolved afresh; missing/wrong/stale/duplicate
  bindings are semantic errors, never layout warnings. Component-local fills
  propagate through the existing string-binding and private-source machinery,
  after template expansion and before component instantiation. The authored
  component bindings are not mutated. Component field comparisons use the
  compiler's `fieldSteps`, including repeated and trailing separators. The
  unchanged logic schemas live in `library-schema.ts` so importing that helper
  does not create a schema/expander/component initialization cycle; the existing
  `logic-library` schema exports are preserved.
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

## Canonical stored layout

The only writer format is:

```text
{
  version: 2,
  canvases: [{
    id,
    roots: [{id, anchor, ownerId, originFrame: "anchor-relative"}],
    nodes: [{id, rootId, nodeId, origins, x, y, label?, note?}],
    viewport?, groups?
  }],
  bundles?
}
```

`ownerId` is the actual stable owner's ID, including the document ID for a
whole-document anchor. A root's `id` is the canonical JSON tuple
`[anchor.kind, anchor.id, anchor.nodeId ?? null, anchor.field, ownerId]`.
A node's canvas-wide `id` is the canonical JSON tuple `[rootId, nodeId]`;
`nodeId` retains its original graph ID. This is collision-free namespacing,
not a short hash or an array-index identity, and needs no secure-context API.
Identical graphs under different owners may share graph IDs but never stored
canvas-wide IDs. Each node explicitly names its root and uses only that root's
frame. Root/node key disagreement, missing owners/frames, duplicate keys and
unresolvable origins warn and auto-layout; they never trigger prefix guessing.
Viewport and group associations survive the adapter, with cross-owner groups
restricted to each selected root's nodes for `lift`.

No persisted layout writer shipped on `origin/main` through
`427eaba` (release 0.3.15). The merged graph-core code has an
in-memory v1 reader and unit fixtures, not a document layout writer; the merged
native document schema does not accept `studioCanvas`. Earlier heads of this
unmerged PR are not shipped formats. Consequently there is **no legacy reader
or migration inference**: v1 document-absolute/prefix-relative layouts and all
other noncanonical metadata remain intact in raw draft storage/export but warn
and use auto-layout. The proposed v1 example in `docs/flows-canvas.md` is not
this storage contract. Raw invalid metadata is never silently rewritten.

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
pure checks and mounted real HTTP routes. Server harnesses honour
`STUDIO_E2E_PORT` and `STUDIO_E2E_DATA_DIR`, defaulting to port 4821 and isolated
`test-results/studio-data/w2-d` subdirectories; only HA transport is faked.
Regression coverage publishes both component uses through the real routes and
checks their expanded source reads, refuses changed references without replacing
the saved publication, and saves/reopens/lifts canonical whole-document and
nested-fragment positions. The permanent 41-case round-3 adversarial matrix
covers both historical encodings falling back to auto-layout and their canonical
equivalents retaining positions, unchanged/moved whole components with parent
and child visibility, identical graph IDs under distinct owners, nested node
moves, owner replacement, atomic conflicts and write-failure restart cleanup.
An additional multi-owner single-canvas test covers canvas-wide IDs and groups.
Browser save/reopen, canvas-buffer conflict UX and mounted browser publication
evidence remain W2-I's integration work.

The compatibility test pins the before/after compiler result and publication
decode digest for all 1,797 existing corpus documents and publication fixtures
at `2fd1e9c`. That comparison includes success/refusal, exact diagnostics,
capability lists, authored output and expanded output bytes, not just acceptance.
