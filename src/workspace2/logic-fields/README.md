# Workspace logic fields

`LogicFieldsProvider` is the integration owner between addressed Studio fields,
the graph canvas, draft storage and simulation. It belongs inside the existing
`WorkspaceDataProvider`; it opens no HA connection and executes no device actions.

## Field routing

`registry.ts` is exhaustive over `GraphDestination['kind']`. Schema-directed and
dedicated inspectors route predicates, operands, slots, calls and flows through
that registry. The graph contract supplies the actual typed ports and the
compiler validates the real consuming document. Literal controls and
non-workspace expression editors retain their original paths.

All value expressions keep their value fields, tokens, formatting and Done
transaction, including values containing nested checks. A template's value-body
mini-map is a preview alongside its ordinary editor, not a replacement.
A condition disclosure opens its compact one-check editor;
only more than one authored check replaces that field with a summary.
And/Or open an already connected canvas containing
the authored check and a second copy to edit; closing without Apply changes
nothing. Compound checks show a sentence, a graph mini-map and Edit in Canvas,
not an in-panel condition-card editor. A field inside a pipeline opens its whole
flow so item and parameter scopes remain valid.

Template bodies use canonical library anchors. The value editor's temporary
slot view, including nested rule requests, is translated back to the operand
body before addressing or lifting; its wrapper never enters layout anchors.
New uses require explicit
arguments, including explicitly selected compatible enclosing holes. Samples
are preview inputs, never implicit use arguments. Tile bindings resolve per
addressed use; unlink materializes its bindings before expanding nested holes.

## Host lifecycle and persistence

The optional canvas seams expose the exact sealed working graph, controlled
selection and Apply-time positions keyed by canvas-wide node ID. `layout.ts`
reanchors the lowered AST into canonical v2 metadata while preserving unrelated
layouts and bindings. Slots retain their consuming document and pointer when
re-lifted for both layout and preview. Unusable metadata requires explicit reset.

Apply validates and prepares the local edit; Save persists the draft; Publish
remains the workspace's separate confirmation. Revision conflicts retain local
edits. The workspace conflict dialog waits until the canvas closes so it cannot
hide or make the retained canvas inert.

Legacy live readers are disabled before the simulation host acquires grouped
request ownership. Close commits `active={false}` before unmounting and keeps
legacy readers suspended for retirement. `observations.ts` maps supported
provenance and preserves false, zero, kept and loading values; it never labels
Mixed as Live. Values, stand-in and use lenses project temporary graphs without
writing their resolved values or overrides into the document.

Preview can collapse with or without a selected block: its 310px pane becomes
a labelled 44px rail, or a 44px horizontal bar below the existing 700px
stacking breakpoint. The hidden pane stays mounted but leaves the accessibility
tree and tab order, preserving its lens, Try with values, pins/scenarios,
selection and observation producer. The toggle transfers focus to its visible
counterpart. Conflict notices, invalid-layout warnings and Reset saved layout
remain in a persistent session-level status area.

The browser preference uses `sh-studio.canvas.preview-collapsed`; all storage
reads and writes are guarded. If storage is unavailable, the choice lasts in
memory until the page closes and a visible status explains the limitation.

## Verification

Unit coverage is in `tests/flows-canvas/integration/`. The mounted production
journeys, real 409 conflict and existing-formula regression are in
`tests/e2e/workspace2-flows-integration.spec.ts`.

```sh
npm test -- --maxWorkers=1
npm run build
npm run scan:house
env -u HA_URL -u HA_TOKEN -u HOME_ASSISTANT_URL \
  -u HOME_ASSISTANT_TOKEN -u SUPERVISOR_TOKEN \
  STUDIO_E2E_PORT=4824 \
  STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-i \
  STUDIO_E2E_PROD=1 STUDIO_EVIDENCE_DIR=docs/evidence/w2-i \
  npx playwright test tests/e2e/workspace2-flows-integration.spec.ts
```

The production browser fixture models the Ingress mount by stripping only the
mount prefix before forwarding to the real server. Publish is confirmed through
the actual UI: a fake HA transport delegates to the real native publication
compiler/store, whose response is checked against the expanded document. This
proves Studio routing, persistence and stripping, not HA installation or native
runtime compatibility. The fixture's pending native-feature warning is retained.

The six screenshot subjects under `docs/evidence/w2-i/` each have desktop/phone
and light/dark variants. All entities and example content come from the isolated
configuration fixture. No development data or physical devices are used.

The presentation-only canvas CSS grant scopes interaction rules to the actual
canvas root's existing `data-panel` attribute, retaining the canvas focus outline. The SimulationHost
grant changes visible retained/demo provenance wording only, not its engine,
observations, timers or retirement lifecycle.
