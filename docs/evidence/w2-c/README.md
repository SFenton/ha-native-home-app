# W2-C: revised canvas design evidence

The reference images in [the binding contract](../../flows-canvas.md) were read
at their original aspect ratios. The revision replaces the initial draft's
expanded, generic-glyph palette, technical port rows, instruction banner and
always-visible accounting panel. Optional observation rendering follows 13-sim;
the ordinary harness now deliberately shows no port values at all.
Interaction and keyboard coverage remain intact.
This is the isolated CanvasHost harness, not shell integration or an iOS client.

## Reproduce and results

```sh
npm test
npm run build
STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c \
  npx playwright test tests/e2e/workspace2-flows-canvas.spec.ts \
  --config tests/flows-canvas/canvas/playwright.config.ts
# The standard CI config must run these too, without skips:
STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c \
  npx playwright test tests/e2e/workspace2-flows-canvas.spec.ts
npx vitest run tests/flows-canvas/graph/canvas-performance.test.ts \
  --maxWorkers=2 --reporter=verbose --silent=false
```

Final local results for this revision:

- Full suite: **273 files, 14,127 passing tests**, one pre-existing skip.
- Production build and TypeScript: **passed**.
- Canvas-focused units: **176 passed**.
- Isolated Playwright: **24 passed**, twelve desktop and twelve phone.
- Standard CI Playwright config: **24 passed, none skipped**, using the same
  4822/data overrides. The harness HTML swap is test-owned; no shell/server or
  workflow change is needed.
- **2,341 nodes / 32 steps:** validate plus already-validated lower median
  **19.12 ms**, minimum 17.87, maximum 34.19; 31 samples after 30 instrumented warmups.
  Stage medians: **validate 11.87 ms; lower 7.13 ms; adapter 3.48 ms**.
  Lower includes the adapter; medians are independent and are not additive.
  Exactly one native source compile is asserted per sample, with the original
  **<=50 ms** gate unchanged.
  An isolated rerun measured **15.47 ms** (14.70-29.18), with stages
  **9.18 / 6.30 / 3.17 ms**. Index construction is included, not moved outside
  the timed validation/total. The identical immutable fixture is used every run;
  warmups include the adapter/native-checker spies, and their records are cleared
  before collecting the 31 measured samples.

The review baseline was **11,570 ms lookup**, **42,810 ms Chromium mount** and a
focus timeout. The new standard-config browser measurements are:

| 2,341-node fixture | Desktop | Phone | Asserted budget |
| --- | ---: | ---: | ---: |
| Mount, navigation through two painted frames | 2,323.59 ms | 2,253.05 ms | <5,000 ms |
| Build index and resolve every incoming port | 3.20 ms | 4.30 ms | <50 ms |
| Select a Number and focus its output | 444.61 ms | 452.92 ms | <1,000 ms |
| Submit a valid literal edit through two painted frames | 595.30 ms | 567.48 ms | <1,500 ms |

Raw browser measurements are in [desktop](desktop-large-performance.json) and
[phone](phone-large-performance.json), and attached to the browser test report.
These are real browser interactions on the complete fixture, not a smaller
proxy or a disconnected edit that avoids compilation.
The literal-edit regression additionally asserts **zero port/board geometry
reads**. Stable block presentation models, actions and memoized wires avoid
graph-wide React rendering; only affected models change. Actual topology,
position or displayed-label changes still invalidate wire geometry.

The round-two hosted baseline at `57919bd` was 1,574.51 ms desktop edit and
1,620.72 ms phone edit, failing the unchanged 1,500 ms gate. Its accepted mount
times were 3,103.63 / 3,296.00 ms and focus was 691.03 / 775.40 ms.
Current-head hosted timings and complete CI status are recorded in the PR body.
The completed `613f824` hosted browser shards passed all 24 canvas cases:
desktop mount/focus/edit **3,038.33 / 682.70 / 885.28 ms**, phone
**2,878.46 / 648.64 / 814.83 ms**, with zero edit geometry reads.
Its compiler gate failed at **50.314 ms**; it is not presented as green CI.

The validator body did not change between `57919bd` and `613f824`; only the
opaque handoff wrapper changed. Local profiling found the trusted read to be
nanoseconds, not the hosted validation increase of 8.37 ms. No historical hosted
CPU profile exists to attribute that increase more precisely. Warmed CPU profiles
identified JSON bounds walks, grammar descriptors, original/binding lookup,
projection allocation and garbage collection as the real compiler work.
The headroom revision shares indexes through validation and lowering, avoids
eager diagnostic-origin maps and single-port sets, uses authoritative expression
descriptors directly for math/item nodes, reuses binding maps for unbound equality,
and replaces projection entry/map/fromEntries chains with ordered loops.

Local validate-plus-lower was 31.76 ms in the independent review and 29.18 ms
in the preceding observation revision. The hosted pre-fix baseline at
`79e14a7` was **97.72 ms** (60.69 minimum, 151.42 maximum). Current hosted stage
figures and actual run-not-skipped log evidence belong to
[PR #29's verification record](https://github.com/SFenton/ha-native-home-app/pull/29):
local figures do not prove the hosted runner meets the unchanged gate.

Every corpus case and both the original and edited large fixture match
pre-optimization golden ordered-tree hashes captured at `196cac8`.
The hashes cover ordered diagnostic codes/paths/messages and every lowering
output field; repeated whole-document anchor strings are hashed without
materializing a >512 MB serialization. The permanent seeded #24 differential
test remains unchanged and passes. Direct unvalidated `lower` still rejects
invalid graphs; the explicit handoff is separately compared with it.
The token now uses frozen instances with runtime-checked private fields, not
copyable public trusted data. Spread copies, re-wrapped graphs, swapped
diagnostics, prototype impostors and proxies are rejected. The exact graph keys a
private per-token WeakMap; trusted reads do not compare or hash graph contents.
Core indexes are per call or immutable editor revision and shared with projection,
with no cross-call caches or mutable module state.

The dedicated configuration defaults to 4822 and honors the port/data overrides.
It has no HA/persistence backend or credentials. The standard configuration uses
its isolated test backend, never development data. Playwright stops both temporary
servers. Browser screenshots use desktop
1440 x 900 and touch-enabled phone 390 x 844; the complete desktop Too Warm
scene and desktop observation scenes use 1920 x 1120. Phone PNGs retain their
2x pixel density.

## Side-by-side reference comparison

Each curated screenshot is paired with its unmodified approved reference.
Open the images for full-size comparison; aspect ratios are not changed.
The compound summary follows panel 3 of 15-editor, **not superseded panel 2**.

| Curated screenshot | Approved design reference |
| --- | --- |
| **Desktop, light palette** ![Light palette](desktop-light-palette.png) | ![Canvas palette reference](../../design/flows/12-canvas.png) |
| **Desktop, dark palette** ![Dark palette](desktop-dark-palette.png) | ![Canvas palette reference](../../design/flows/12-canvas.png) |
| **Desktop, custom HA palette** ![Custom palette](desktop-custom-palette.png) | ![Canvas palette reference](../../design/flows/12-canvas.png) |
| **Phone, light palette sheet** ![Light palette sheet](phone-light-palette.png) | ![Palette structure reference](../../design/flows/12-canvas.png) |
| **Phone, dark palette sheet** ![Dark palette sheet](phone-dark-palette.png) | ![Palette structure reference](../../design/flows/12-canvas.png) |
| **Phone, custom HA palette sheet** ![Custom palette sheet](phone-custom-palette.png) | ![Palette structure reference](../../design/flows/12-canvas.png) |
| **Desktop, light canvas** ![Light canvas](desktop-light-canvas.png) | ![Canvas reference](../../design/flows/12-canvas.png) |
| **Desktop, dark canvas** ![Dark canvas](desktop-dark-canvas.png) | ![Canvas reference](../../design/flows/12-canvas.png) |
| **Desktop, custom HA canvas** ![Custom canvas](desktop-custom-canvas.png) | ![Canvas reference](../../design/flows/12-canvas.png) |
| **Phone, light canvas** ![Light phone canvas](phone-light-canvas.png) | ![Canvas controls reference](../../design/flows/12-canvas.png) |
| **Phone, dark canvas** ![Dark phone canvas](phone-dark-canvas.png) | ![Canvas controls reference](../../design/flows/12-canvas.png) |
| **Phone, custom HA canvas** ![Custom phone canvas](phone-custom-canvas.png) | ![Canvas controls reference](../../design/flows/12-canvas.png) |
| **Desktop, light summary** ![Light summary](desktop-light-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Desktop, dark summary** ![Dark summary](desktop-dark-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Desktop, custom HA summary** ![Custom summary](desktop-custom-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Phone, light inspector sheet** ![Light summary sheet](phone-light-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Phone, dark inspector sheet** ![Dark summary sheet](phone-dark-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Phone, custom HA inspector sheet** ![Custom summary sheet](phone-custom-summary.png) | ![Summary reference, panel 3](../../design/flows/15-editor.png) |
| **Desktop, above-threshold inspector meter** ![Inspector meter](desktop-meter.png) | ![Inspector meter reference](../../design/flows/12-canvas.png) |
| **Phone, above-threshold inspector meter** ![Inspector sheet meter](phone-meter.png) | ![Inspector meter reference](../../design/flows/12-canvas.png) |
| **Too Warm Warning: Average, Is Above, All Of, If / Otherwise** ![Too Warm scene](desktop-too-warm-warning.png) | ![Too Warm Warning reference](../../design/flows/12-canvas.png) |
| **Too Warm Warning: phone selection lens** ![Too Warm phone scene](phone-too-warm-warning.png) | ![Too Warm Warning reference](../../design/flows/12-canvas.png) |
| **Desktop, light observations** ![Light observations](desktop-light-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Desktop, dark observations** ![Dark observations](desktop-dark-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Desktop, custom HA observations** ![Custom observations](desktop-custom-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, light unknown/kept output** ![Light observation output](phone-light-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, dark unknown/kept output** ![Dark observation output](phone-dark-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, custom HA unknown/kept output** ![Custom observation output](phone-custom-observations.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, light scenario-unavailable source** ![Light unavailable source](phone-light-observation-unavailable.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, dark scenario-unavailable source** ![Dark unavailable source](phone-dark-observation-unavailable.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, custom HA scenario-unavailable source** ![Custom unavailable source](phone-custom-observation-unavailable.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, light pinned source** ![Light pinned source](phone-light-observation-pinned.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, dark pinned source** ![Dark pinned source](phone-dark-observation-pinned.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |
| **Phone, custom HA pinned source** ![Custom pinned source](phone-custom-observation-pinned.png) | ![Simulation observation reference](../../design/flows/13-sim.png) |

## Fidelity and intentional deviations

| Area | Result / intentional deviation and reason |
| --- | --- |
| Palette | Components-like two-column chips with distinct block icons, result dots and a footer legend. All eleven categories start collapsed, with counts and name previews; screenshots deliberately expand From Home and Compare and leave keyboard focus on Search. Its ring is checked against the actual field and panel surfaces, as well as derived hover/selected/canvas surfaces, in every theme. Unavailable entries appear only in one closed disclosure. |
| Native variants | Is / Is Not, Above / Below and Before / After share default chips, with every operation retained in the inspector and searchable individually. Native entity-state and numeric checks remain available in From Home, so counts differ from the illustration. Many Entities is inside Not available here for this document-field scope, rather than pretending a flow request is a scalar block. |
| Ports and wires | Human labels and blue/green/orange type colors replace raw operation/type subtitles. Hash/circle, T/square, check/diamond and distinct time/entity/record glyphs add non-color type encodings; lists use doubled lines with their declared item glyph (unknown for mixed/unresolved items). Ordinary screenshots have no port values, including literals. Only the optional, explicitly supplied observation fixture adds values, purple pins, unknown hatching/dashed wires, kept outputs and scenario outlines. Shape/compatibility still come from the graph core, not observations. |
| Too Warm fixture | Same warning scene and four requested operator families, with authored literals 23.6, 25, threshold 24 and closed-state text. Without observations these settings are visible only when edited, not as invented live port readings. The approved fixed Average recipe remains expanded as Add / Divide / count, with an Average label only for that exact recipe; explicit literal cards remain editable. This accounts for more cards than the illustration, without introducing the rejected aggregate opcode. |
| Observation fixture | Separate scripted per-port readings reproduce the offline/unknown/pinned/kept states from 13-sim without evaluating anything. The host explicitly marks the retained warning output; the canvas does not infer retention. Direct scenario pins have a purple dashed outline, and unknown outputs have grey dashed wires. Scenario controls, clock, drawers and live provenance editing remain W2-S's; output-destination adapters remain W2-I's. No claim is made that authored literals are home entities or that fixture readings came from HA. |
| Inspector | And / Or use the actual connected branch count, configured entity/check labels, connected mini-map and friendly output destination, with Edit in Canvas. The refreshed fixture has three distinct branches: administrator, person at home, and Not → Hallway Light is off. Not remains an explicit, non-reversing group and no longer duplicates the administrator branch. The fixture declares the native compiler's supported capabilities and asserts No Problems. Other descriptions use the selected field's configuration and connections. No condition-card editor is added. Simulation controls, real previews and additional output lenses belong to other lanes and are intentionally absent. |
| Chrome | Quiet compact zoom / Tidy Up / problems bar; fit, pan, undo/redo and keyboard help moved into overflow. Connections live in Outline. The harness keeps its own title, Close, Save and Apply controls instead of copying the workspace's Publish chrome: shell integration belongs to W2-I, and Apply must not imply Publish. |
| Phone | Single-row toolbars and modal bottom sheets reuse Base UI. Full-size selected cards can be panned rather than shrinking an entire graph to illegible text. Touch targets retain 44 CSS pixels. This is a browser adaptation of the desktop reference, not native hardware validation. |
| Meter | One field row with a thin bar, steps/deep wording and one sentence; every technical detail is behind closed Details. The illustration's 23/64 example is below its own 75% rule, so evidence instead uses the checker's real **52/64, depth 4/8** fixture. The fixture labels its origin and renders the real Inspector; it does not inject production counters. |
| Custom theme | Lavender HA tokens intentionally replace the reference's neutral grounds. Contrast-adjusted socket/focus colors retain their type meaning in light, dark and custom themes. |

## Accounting correctness and remaining dependency

The observation seam is documented in the [host handoff](../../../src/workspace2/canvas/README.md#optional-observation-input).
PR #30 merged as `1ae7d5f`; main is merged into this branch. Its
`canvasObservations` function and `CanvasObservations` type are exported from
`workspace2/logic-simulation`, not `shared/composition/graph-observation`.
The shared module exports the run-observation collector, `createObservation`.
The simulation display DTO has `{ blocks, order, truncated }`, per-block `ports`
arrays and additional mixed/loading/not-observed states, so it is not assignable
to the canvas DTO. Per the owner's fallback instruction, wiring remains with
W2-I rather than introducing a canvas-to-simulation dependency or editing W2-S
files. No new adapter test is claimed for a deferred adapter.
The local readonly contract remains
`host.observations[nodeId].{scenarioPinned, inputs, outputs}` with port fields
`state`, `source`, `value` and `kept`. Missing observations show nothing; no
connected-source or configured-literal fallback exists. Focus restoration and
the single-compile path are preserved when only observations change.

**Still pending: #28 is open.** No excluded compiler/pipeline files were edited.
Production expression, predicate and flow accounting remain unavailable inside
the meter's collapsed Details until the observer-forwarding PR merges and
`graph/compile.ts` captures its exact observer option from the single compile.
Expansion duplication/generated-flow totals also remain unavailable.
The typed reducer and UI never estimate counters or replay the checker.
`AccountingCompilation` locally extends main's unchanged compilation interface
with optional snapshots; `graph/compile.ts` is byte-identical to current main.
The missing-property runtime regression asserts unavailable counters and exactly
one native checker invocation.

Focused tests retain exact thresholds: expression 48/49, shared call 96/97,
predicate 24/25, expression-depth 6/7, predicate-depth 4/5, choices 12/13 and
flow steps 24/25. Initial uncapped scopes stay null, not zero or a guessed cap.
The meter deduplicates output fields, and all its figures come from checker
accounting snapshots.

G-limits: 16 comparisons in All Of yield 49 combined entries and 17 predicates.
The checker accepts Choose (52 expression entries), Count (50), and flow filtering
(17 predicates with 32 independent single-entry operand scopes); filtering never
becomes a fictitious pooled 49/32 or 49/64 counter.

CHK-nested-choose-budget is unchanged: early refusal at `/of/1/of/15`, initial
uncapped predicate scope, refusal of the unmodified base inside Choose, and later
outer-Choose acceptance at 43 expression entries/depth 6. Context tests retain
visibleWhen, look-case when, activeWhen, filledWhen and errorWhen pointers.
The meter agrees with the compiler, including its counter resets.

Keyboard-only graph/outline cases still add, connect, replace, move, delete,
undo and redo using real Tab/arrows/Enter/Delete. Focus and selection return to
the affected port/header. Cycle/type refusals are named and announced inside
dialogs; occupied-input replacement remains explicit and undoable. Conflict
tests preserve edits and keep Save distinct from Apply.

Base UI, Lucide, existing theme primitives and graph helpers are reused; no
dependency, licence, native app, evaluator or workspace entry changes.
