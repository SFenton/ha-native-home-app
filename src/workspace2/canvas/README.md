# Flows canvas interaction host

`FlowCanvas` is an isolated interaction surface. W2-I mounts it; this lane does
not modify workspace entry files. Pass a `CanvasHostWithObservations` (a local,
backward-compatible extension of `CanvasHost`), an initial `LogicGraph`,
the existing `DerivedTheme`, a title, an `onClose` callback, and optionally the
element to restore focus to on close and friendly output names for the meter.
Remount for a different anchor/snapshot.
`arrangeCanvas` supplies an initial readable layout without reordering node IDs.

The host provides sources, target capabilities, an immutable revision snapshot,
atomic Apply and separate Save. Apply uses the graph core's single lowering
result. Conflicts preserve canvas state and call `compareConflict`; the host
owns comparison/reconciliation and persistence. Neither Apply nor Save publishes.
Detached blocks and disconnected required inputs prevent Apply rather than
silently dropping or repairing user content.

## Editing

- Categories start collapsed, with counts and preview names. Expand a category
  or search the two-column palette, then use arrows and Enter to add. Unavailable
  blocks and their reasons live in one **Not available here** disclosure.
  Paired comparison chips use their first variant; the inspector's Check select
  exposes every operation, and searching also finds individual variants.
- Graph and Outline expose the same blocks, ports, actions and transactions.
  Headers use roving focus: arrows/Home/End select, Enter enters controls,
  arrows traverse ports/actions, Escape returns to the header, Tab exits the
  composite. Editable fields retain their normal text/number keyboard behavior.
- Activate either end of a wire to find the opposite port. Type/representation,
  scope and cycle checks use the graph core's port compatibility data. Occupied
  inputs require explicit Replace; replacement is one undoable transaction.
  Refusals are named and announced inside the dialog.
- Move uses 8 px arrow steps, Shift uses 32 px, Enter commits and Escape cancels.
  Inspector numeric coordinates and **Tidy Up** are alternatives. Fit, pan,
  Undo/Redo and Keyboard help live under **More canvas controls**.
- Delete confirms affected wires. Undo/redo restore the graph, selection and
  originating port/header. Inspector rule moves preserve If/Then wiring and
  Otherwise; new rule inputs remain visibly disconnected until authored.
- And/Or always edit on canvas. The inspector supplies a noninteractive summary
  and **Edit in Canvas**, not nested condition cards. Its branches, settings,
  entity names and output label come from the selected graph's real connections.
- **Average Fixed Values** inserts the native Add / Divide / count recipe with
  two editable numbers and all its wires in one undoable transaction.

Styling uses existing workspace/HA tokens. Distinct Lucide block icons, named
ports, type-specific socket glyphs/shapes, accessible type descriptions and the
Outline connection list supplement colored sockets/wires. Numbers use a hash in
a circle, text a T in a square and conditions a check in a diamond; time, entity,
list and record sockets also have distinct glyphs. Lists use doubled lines with
the declared item-type glyph; unknown or mixed items retain a question mark.
The socket of an unresolved input uses its connected
source's static port type for color, never a sampled value; compatibility still
uses the original graph descriptor. Port values come only from optional host
observations; there is no literal, connected-source or calculated-value fallback.
Socket contrast retains 4.5:1 and focus retains 3:1 on canvas, panel, field,
hover and selection surfaces in light, dark and custom themes.

The compact bottom bar contains zoom, Tidy Up and a problems disclosure.
Keyboard instructions remain associated with the graph for assistive technology,
but their visible version opens on demand. Below 600 CSS pixels, palette and
inspector use Base UI modal bottom sheets with dismissal/focus restoration.
Toolbars do not wrap; the outline avoids spatial navigation. Reduced-motion and
forced-colors modes are supported.

Existing Base UI Dialog owns modal focus trapping and dismissal; Lucide supplies
icons; the existing theme and graph helpers supply tokens, shapes and LAN-safe
`getRandomValues` IDs. No graph-layout/editor dependency was added and no OSS
license/notices changed. SVG wires are decorative; native HTML controls and the
outline provide the full editing interface.

Graphs above 200 blocks window their visual cards, port readings and wires to
the viewport plus 240 CSS pixels of overscan. Each off-screen block keeps a
lightweight header in the same list order, with its position and total size
exposed to assistive technology. Focusing/activating that header or navigating
with arrows/Home/End renders the full block and scrolls it into view. Selected
and entered blocks remain mounted. Outline retains every full block and wire.
Only newly visible port geometry is read; scrolling, viewport resize and
payload-only edits reuse existing board-space coordinates. Off-screen wire
endpoints use layout estimates until their actual ports are mounted.

Node, edge, incoming-port, binding and wide-port indexes are built once per
immutable graph revision with `prepareGraphRevision(graph)`. Canvas lookup,
validation and projection share that opaque revision index; only read-only
map views and frozen edge arrays are exposed. A mismatched revision, spread,
prototype impostor or proxy is rejected by an O(1) private-brand/exact-graph
WeakSet check, without comparing or hashing graph contents.
Stable per-block presentation models and actions let literal-only
edits render only the affected blocks/ports; unchanged geometry does not remeasure
wires. Topology, position and displayed-label changes invalidate geometry.
Memoized wires also skip payload-only renders. Focusing a port updates the
focus saved in undo history; disconnecting an Outline wire records its destination
input before the snapshot, rather than the previously selected block.
Palette type hints and accessible names use the graph-core output descriptor,
including numeric date differences/progress, rather than a second type map.

The performance-only core handoff is `validateForLowering(graph, index?)` followed
by `lowerValidated(validation)`. The frozen, nominal token holds the exact
immutable revision, shared index and ordered diagnostics in a private WeakMap
keyed on that graph object. Lowering checks its runtime class/private brand and
per-token WeakMap in O(1); spread copies, wrappers, proxies and replaced diagnostics
cannot bypass validation. There is no module-level registry.
Preparation deeply freezes the graph and its nested data before indexing or
issuing a trusted token. Post-validation edge, node and literal mutations fail
rather than leaving stale trusted state. Shallow-frozen input is still traversed;
there is no "outer object is frozen" shortcut. The traversal's visited set is
local to the call, with no immutable-object cache or module-level state.
Standalone `validateGraph(graph)` remains a non-freezing diagnostic query;
`prepareGraphRevision`, `validateForLowering` and direct `lower` freeze revisions.
Calling `lower(graph)` directly still
validates and takes the same refusal path; `lower(graph, { index })` also validates,
but reuses the already prepared exact-revision indexes. Indexes are call-local or
owned by one immutable editor revision, with no cross-call cache or mutable module
state. The performance guard retains its 50 ms median. It uses the unchanged
2,341-node edited fixture for 30 instrumented warmups and 31 measured runs, includes
fresh deep-freezing/index preparation in every validation/total sample, and asserts one native
compile per measured run. Stage medians, index cost and a separate million-read
trusted-handoff profile are printed in local and hosted logs.
Before/after corpus hashes were captured at the pre-optimization head and cover
ordered diagnostics and every output field, including source maps and budgets.

## Optional observation input

The owned `observations.tsx` exports the minimal display contract. W2-I supplies
`host.observations`; the canvas never evaluates a graph, contacts HA, creates
pins/scenarios, or persists observations. A normal `CanvasHost` without this
optional property still works and shows **no port values**, even on literals.
Authoring fields in the inspector remain editable configuration, not observations.

```ts
const observations: CanvasObservations = {
  [nodeId]: {
    scenarioPinned: true,
    inputs: {
      '/args/0': { state: 'known', source: 'live', value: 23.6 },
    },
    outputs: {
      value: { state: 'cant-tell', source: 'scenario' },
    },
  },
};
const canvasHost: CanvasHostWithObservations = { ...host, observations };
```

Outer keys are graph node IDs. `inputs` and `outputs` use exact graph port IDs,
including native paths such as `/args/0` and the output ID `value`. All maps and
fields are readonly.
`source` is `live | pinned | scenario`; `state` is
`known | unavailable | cant-tell`. Known observations require a JSON `value`.
Unknown observations omit `value`, unless `kept: true` explicitly supplies the
retained value. `kept` badges appear only on outputs. `scenarioPinned` marks a
direct scenario pin on the block; downstream provenance does not imply that flag.

Known values use the port's type color; manual/scenario pins use purple.
Unavailable and can't-tell rows are hatched, with dashed grey outgoing wires.
State/source/value/kept information is in each port's accessible name; a scenario
pin also has a dashed purple block outline and an accessible description.
Observation-only updates preserve focus and do not compile or write the graph.
Missing input observations remain empty even when their connected output has a
known value. The host owns snapshot freshness and sanitization and must update or
withdraw stale observations when the graph/simulation changes.

PR #30 merged to main as `1ae7d5f` and is included in this branch.
At that revision, `canvasObservations` and its `CanvasObservations` type are
exported by `workspace2/logic-simulation`, not the shared `graph-observation`
module (which exports `createObservation`). The simulation DTO contains
`{ blocks, order, truncated }`, with a `ports` array per block and additional
mixed/loading/not-observed states; it is not assignable to this local DTO.

The canvas does not import the simulation layer or evaluate a run. Under the
owner's conditional integration instruction, W2-I retains the adapter/wiring
until a compatible shared display contract is available. No simulation files
were edited and no adapter test is claimed. The `observations` harness fixture
remains scripted display data, not simulation/runtime evidence.

## Accounting dependency (pending)

`AccountingCompilation` extends main's unchanged `FragmentCompilation` with an
optional `accounting` array of `BudgetAccountingEvent`.
`budgetFromCompilation` accepts either shape and reduces those snapshots when
present; it never replays the checker or derives parallel AST counters.
`LimitsMeter` consumes only the resulting `GraphBudget`. Compact figures appear
strictly **above** 75%, in the inspector's **Fits in the phone app** section.
Each field has one thin bar with plain-word steps/deep text, using its most
constrained compiler counter rather than adding different scopes together.
All scopes, pointers, resets, runtime limits, capabilities and unavailability
explanations are behind one initially collapsed **Details** disclosure.
Null limits stay uncapped. Counts/depths include the first refused entry, not unvisited descendants.
Compiler acceptance and ordered diagnostics remain authoritative, including
both CHK-nested-choose-budget outcomes.

**Production observer forwarding is not connected yet.** W2-D owns the native
compiler entry points. Until that dependency merges and `graph/compile.ts`
captures/forwards its exact observer option in the single compile, production
expression, predicate and flow counts remain explicitly **unavailable**.
Expansion duplication/generated-flow totals also remain unavailable.

The test-only meter fixture calls the existing real checker observer and passes
its snapshots through the same budget adapter. Its threshold screenshot is
explicitly labelled as a fixture, not evidence that production counters work.

## Isolated acceptance harness

```sh
npm test
npm run build
STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c \
  npx playwright test tests/e2e/workspace2-flows-canvas.spec.ts \
  --config tests/flows-canvas/canvas/playwright.config.ts
```

The dedicated config serves `tests/flows-canvas/canvas/harness.html` with Vite
only. It defaults to 4822 and honors `STUDIO_E2E_PORT`,
`STUDIO_E2E_DATA_DIR` and the older `STUDIO_E2E_DATA`. It starts no HA/persistence
backend and uses no development data. Playwright stops its temporary server.

The same spec runs under the standard CI config without a port-specific skip:
omit `--config` from the command above. Its test-owned HTML interception preserves
Vite's refresh preamble and swaps the workspace entry for the isolated harness;
the real shell/server is unchanged. The standard runner's test backend remains
isolated in the overridden test data directory. `fixture=large` mounts all 2,341
blocks and asserts lookup, mount, focus and valid-edit budgets, retaining its
actual measurements as a test attachment.
Curated screenshots and measured results live in `docs/evidence/w2-c/`.
Browser geometry is an interaction preview, not unchanged iOS SDUI or physical
device/runtime evidence.
