# Flows canvas graph core

Pure projection APIs for `docs/flows-canvas.md`, merged in PR #21 at
`40d4041`, with the orchestrator's round-2
compiler-only accounting addendum. There are no stores, network calls, device
actions, or UI dependencies.

- `lift(json, {kind, anchor, metadata, scope})` retains all original fragments.
  `liftJSON(bytes)` also runs the existing bounded, duplicate-key-aware parser.
  Payloads contain grammar-checked skeletons; each ordered input binding replaces
  its skeleton child. Template references remain references. Opaque blocks retain
  exact JSON and cannot be edited.
  Input constraints come from grammar positions and destination lexical scopes,
  not the previous child's enum/refinements. Item values stay in their step;
  flow parameters remain available in descendant scopes of their own flow.
  Grammar descriptors and edge lookups are reused within a check or projection,
  never cached across edits.
- `lower(graph, {library, targetCapabilities, itemScope})` validates before
  returning atomic replacements. Failures retain `original`; they never return
  a partially modified document. Complete documents use the existing compiler.
  Root `studioCanvas` is excluded only from semantic validation/capabilities and
  retained losslessly in authored replacements; this API is not publication.
  Document destinations always run the document compiler, including documents
  missing required fields. Synthetic multi-field examples must explicitly use
  `kind: "fragment"`; fragment checks are not whole-document validation.
  Source maps retain authored entries and add `stage: "expanded"` entries for
  native template landings. `authoredPointer` and `usePointer` keep each copied
  argument tied to its block and use, including failing expanded budget paths.
- `projectGraph(graph)` only projects a working buffer, including opaque JSON.
  It is **not** validation or permission to apply/save/publish an invalid import.
- `validateGraph`, `portsCompatible`, `autoLayout`, `measureBudget`, and
  `budgetMeter` are usable independently. Meters appear strictly above 75%.
  Runtime budget is a separate bound, not an estimate from step count.
  `GraphBudget.accepted`, `compilerIssues`, and `firstExceedingPointer` come
  from running the compiler/checker on the lowered fragment. In particular,
  CHK-nested-choose-budget is neither fixed nor simulated with a parallel counter.
  Flow node meters consume the public `typeOperand`/`typeWhere` counters.
  No graph code increments AST counters, walks depths, or predicts resets.
  Counts that are not exported by the checker are **null**, never zero or an
  estimate: document/call counts, depths, totals, cases/steps, duplication costs,
  generated-flow accounting and reset events. Document scopes explicitly report
  `nodeAccounting: "unavailable"`; overall accounting is `partial` or `unavailable`.
  Consumers must surface `accountingUnavailableReason`, not invent missing
  percentages. Missing meters do not mean zero usage or unlimited capacity.
  A native counter stops at its limit: consumers must use the compiler outcome
  and first exceeding pointer, not infer acceptance from the remaining count.
  `semanticFingerprint` excludes positions and root layout metadata, retaining
  behavior-bearing bindings and equally named properties inside literal data.
- `lowerForEach` takes an explicit fixed-count or entity-flow mode. Fixed tests
  use an existing source-id template hole; no item or frame opcode is emitted.
  Entity mode requires resolved literal IDs, never a dynamic area selector.
  Generic lists accept a typed existing flow prefix; empty Any is No and All Yes.
- `averageFixed` is strict arithmetic. `lowerListAverage` creates an explicit
  average-step or sum/filter-count edit; it never migrates an authored average
  during publish. `lowerFlowBranches` materializes each terminal flow separately.
  The sum/filter-count fallback is equivalent only while all running totals stay
  finite. Overflow gives unavailable (Can't tell), even if the supported average
  step can answer, including cancellation after an overflow. Fallback recipes
  expose an `average_fallback_overflow` warning for older-app UI.
- Call `allocateGraphId` once in the authoring transaction and retain the result.
  It uses the repository LAN-HTTP-compatible helper and checks collisions.
  Lifting uses content-and-origin IDs so reordered array positions cannot reuse
  another fragment's saved position.

After rebasing onto merged PR #20, `GraphPipeline*` and graph schemas are aliases
of the real shared pipeline exports. There is no temporary average/min bridge.
Text slots use the shared `textValue` export, including its unavailable policy
and generic 2000-character envelope; whole-document compilation enforces the
specific consuming field's limits. There is no local text-keep schema.
Average and text keep remain gated on target capabilities. Tests use the real
shared average evaluator for finite-total parity and explicit overflow
divergence. A-number-state remains
disabled with its specific prerequisite and compiler pointer; no cast or
fabricated shape exists.
Fragments absorb the native checker's `usedOperands`, references and needs
consistently for operands, predicates and calls, including budget capabilities.

Hosts still own stable-anchor resolution, use-bound arguments, whole-document
expansion, draft layout extraction, persistence/conflicts, and publication.
Never install a recipe's generated sources separately from its root replacement.

## Owner follow-up: compiler accounting

Lane A reserves `expression.ts`; this lane does not edit it. Request an additive,
read-only accounting export on the actual Checker (`enter`, predicate checks,
condition resets/restores and shared call budgets), preserving traversal,
short-circuiting, diagnostics and CHK-nested-choose-budget exactly. Also expose
depth/scope accounting from `pipeline/typing.ts`, propagate it through pipeline
and document compilation, and include structural limits and expansion
provenance. Once supplied, the graph can consume complete figures without an
independent formula. This is observation only, not authorization to reconcile
the checker with native behavior or change any limit.
