# Flows canvas graph core

Pure projection APIs for `docs/flows-canvas.md` in PR #21, reviewed at
`fce634db4aaf8deb3c680b97ab67802312c87804`, with the orchestrator's subsequent
correction permitting contextual accounting where compiler exports are absent.
There are no stores,
network calls, device actions, or UI dependencies.

- `lift(json, {kind, anchor, metadata, scope})` retains all original fragments.
  `liftJSON(bytes)` also runs the existing bounded, duplicate-key-aware parser.
  Payloads contain grammar-checked skeletons; each ordered input binding replaces
  its skeleton child. Template references remain references. Opaque blocks retain
  exact JSON and cannot be edited.
- `lower(graph, {library, targetCapabilities, itemScope})` validates before
  returning atomic replacements. Failures retain `original`; they never return
  a partially modified document. Complete documents use the existing compiler.
  Root `studioCanvas` is excluded only from semantic validation/capabilities and
  retained losslessly in authored replacements; this API is not publication.
- `projectGraph(graph)` only projects a working buffer, including opaque JSON.
  It is **not** validation or permission to apply/save/publish an invalid import.
- `validateGraph`, `portsCompatible`, `autoLayout`, `measureBudget`, and
  `budgetMeter` are usable independently. Meters appear strictly above 75%.
  Runtime budget is a separate bound, not an estimate from step count.
  `GraphBudget.nodes/depth` are informational combined AST totals.
  `scopes` distinguishes shared document expression counters (64/8), shared
  service-call counters (128/8), predicate-only counters (32/6), and fresh flow
  operand counters (64/8). `conditions.nodes/depth` are predicate-only, with
  separate `astNodes/astDepth`. A flow filter never gets a synthetic aggregate
  32- or 64-AST-node limit. Structural all/any arity is detail-only, not a
  compact predicate-budget warning.
  Flow node meters consume the public `typeOperand`/`typeWhere` counters.
  The document checker does not expose accounting; its meter uses a contextual
  traversal, explicitly marked `nodeAccounting: "contextual-walk"`. Depth and
  informational AST totals also need traversal until an accounting export exists.
  Acceptance always comes from the existing checkers/compiler, not those walks.
  `counterResets` preserves the baseline nested-Choose counter leak and count's
  save/restore; a live predicate counter can continue outside its initial `when`.
  This reproduces the known checker behavior, not a native-parser fix.
  `semanticFingerprint` excludes positions and root layout metadata, retaining
  behavior-bearing bindings and equally named properties inside literal data.
- `lowerForEach` takes an explicit fixed-count or entity-flow mode. Fixed tests
  use an existing source-id template hole; no item or frame opcode is emitted.
  Entity mode requires resolved literal IDs, never a dynamic area selector.
  Generic lists accept a typed existing flow prefix; empty Any is No and All Yes.
- `averageFixed` is strict arithmetic. `lowerListAverage` creates an explicit
  average-step or sum/filter-count edit; it never migrates an authored average
  during publish. `lowerFlowBranches` materializes each terminal flow separately.
- Call `allocateGraphId` once in the authoring transaction and retain the result.
  It uses the repository LAN-HTTP-compatible helper and checks collisions.
  Lifting uses content-and-origin IDs so reordered array positions cannot reuse
  another fragment's saved position.

PR #20 was unmerged when this lane was implemented. `GraphPipeline*` extends
stable pipeline shapes with the approved average step only. The temporary
`checkGraphPipeline` bridge uses the existing nullable reduction typing rule;
it is not a second runtime and does not enable the baseline publication schema.
Actual evaluation/publication of average and text keep still needs that lane.
Both are gated by target capabilities. A-number-state remains disabled with its
specific prerequisite and compiler pointer; no cast or fabricated shape exists.

Hosts still own stable-anchor resolution, use-bound arguments, whole-document
expansion, draft layout extraction, persistence/conflicts, and publication.
Never install a recipe's generated sources separately from its root replacement.
