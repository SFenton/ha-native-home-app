# Flows canvas graph core

Pure projection APIs for `docs/flows-canvas.md`, merged in PR #21 at
`40d4041`, with the orchestrator's round-2
compiler-only accounting addendum. There are no stores, network calls, device
actions, or UI dependencies.

- `lift(json, {kind, anchor, metadata, scope, context, sourceId})` retains all original fragments.
  `liftJSON(bytes)` also runs the existing bounded, duplicate-key-aware parser.
  Grammar descriptors are projection/catalog hints, not native validation.
  Each ordered input binding replaces its payload child. Template references remain references. Opaque blocks retain
  exact JSON and cannot be edited.
  Wiring hints come from grammar positions and destination lexical scopes,
  not the previous child's enum/refinements. Item hints stay in their step;
  flow parameters remain available in descendant scopes of their own flow.
  Grammar descriptors and edge lookups are reused within a check or projection,
  never cached across edits.
  Edited flow step/output item shapes are retyped from the currently assembled
  prefix, not retained from the lifted snapshot.
- `lower(graph, {library, targetCapabilities, itemScope})` runs native validation before
  returning atomic replacements. Failures retain `original`; they never return
  a partially modified document. Complete documents use the existing compiler.
  Root `studioCanvas` is excluded only from semantic validation/capabilities and
  retained losslessly in authored replacements; this API is not publication.
  Document destinations always run the document compiler, including documents
  missing required fields. Synthetic multi-field examples must explicitly use
  `kind: "fragment"`; fragment checks are not whole-document validation.
  Standalone slots require `context: {document, pointer}`: the host's document
  snapshot and the consuming field's RFC 6901 pointer, not an inferred slot kind
  or text-length envelope. Lowering projects the fragment into that document and
  calls `compileCompositionDocument`, including for untouched imports. Multiple
  roots sharing a snapshot are compiled with all their replacements assembled.
  Projection runs once. Each fragment or assembled consuming document compiles
  once; acceptance, manifest, budget and expansion maps reuse that result.
  Slot capabilities are the whole consuming document's exact native manifest.
  Contextual diagnostics retain the absolute `documentPointer`; a multi-root
  refusal is mapped to the root owning that field, not the first compiled root.
  Whole-document roots need no extra context. Missing context is an explicit
  error; unknown local representations alone never veto compiler-valid JSON.
  New optional fields and appended array entries can be native destinations.
  Standalone operands, predicates, calls and flows use the existing native
  fragment checkers, including the compiler's complete source binding envelope;
  capability absorption, source limits and dependency-cycle checks are
  shared with the document compiler. `capabilities` on successful lowering and
  every budget come from those native results, never a caller-provided seed.
  Standalone flow inputs take their owning `sourceId` explicitly or from a flow
  anchor. Without an owner, native input/parameter checks still run, but source
  dependency closure remains unresolved; no legal source ID is invented.
  Use the consuming document context for complete reference/cycle validation.
  Input diagnostics and dependencies omit the source envelope's `/inputs`
  prefix before source-map and budget handling. Synthetic fragment recursion
  shares the compiler's pipeline ordinal, so its own 129th pipeline is refused
  without recompiling sources or counting non-pipeline IDs.
  Call fragments reuse the native call shape without its attached lenient
  semantic pre-pass, then run the native checker once with actual permissions.
  Source maps retain authored entries and add `stage: "expanded"` entries for
  native template landings. Whole-document landings come from the compiler's
  own expansion pass, not a second expansion. `authoredPointer` and `usePointer` keep each copied
  argument tied to its block and use, including failing expanded budget paths.
  Contextual maps use document-library expansion landings too. Failure diagnostics
  retain the compiler's authored pointer while locating the responsible argument
  block through its unremapped expansion landing.
- `projectGraph(graph)` only projects a working buffer, including opaque JSON.
  It is **not** validation or permission to apply/save/publish an invalid import.
- `validateGraph` checks projection safety and returns local typing/scope/catalog
  hints marked `severity: "warning", hint: true`. Successful lowering retains
  them in `diagnostics`; the UI must label them as hints, not native refusals.
  Only structural ambiguity (missing/occupied bindings, connection cycles,
  modified opaque buffers) can prevent projection. Compiler diagnostics decide
  semantic acceptance and are mapped back through the source map.
  `portsCompatible`, `autoLayout`, `measureBudget`, and
  `budgetMeter` are usable independently. Meters appear strictly above 75%.
  Runtime budget is a separate bound, not an estimate from step count.
  An uncapped scope limit is `null`; its meter ratio is also `null`, with no
  threshold visibility or exceeded state.
  `GraphBudget.accepted`, `compilerIssues`, and `firstExceedingPointer` come
  from running the compiler/checker on the lowered fragment. In particular,
  CHK-nested-choose-budget is neither fixed nor simulated with a parallel counter.
  Budget construction never repeats native operand/predicate typing to
  recover counters. No graph code increments AST counters, walks depths,
  or predicts resets.
  Counts not yet consumed from the checker are **null**, never zero or an
  estimate: expression/flow/call counts, depths, totals, cases/steps, duplication
  costs, generated-flow accounting and reset events. Scope entry points may be
  listed with null usage, but no percentage meter is fabricated. Whole-document
  and consuming-field scopes remain unavailable until the native observer is
  consumed, rather than inventing fresh entry points for arbitrary subtrees.
  Accounting is currently `unavailable`; the contract also permits `partial`
  when native accounting is integrated.
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
  Generated count flows declare scalar/number output regardless of the prefix
  declaration. Recipe requirements include every generated source's native needs.
- `averageFixed` is strict arithmetic. `lowerListAverage` creates an explicit
  average-step or sum/filter-count edit; it never migrates an authored average
  during publish. `lowerFlowBranches` materializes each terminal flow separately.
  The sum/filter-count fallback is equivalent only while all running totals stay
  finite. Overflow gives unavailable (Can't tell), even if the supported average
  step can answer, including cancellation after an overflow. Fallback recipes
  expose an `average_fallback_overflow` warning for older-app UI.
  Recipe fragments check their whole generated dependency bundle, not sources in
  isolation. For global references and document limits, pass
  `context: {document, pointer}` to a value recipe (`averageFixed` takes it in
  its second argument); the pointer names its actual operand or condition field.
  The root replacement and all new sources compile together in that document.
  `lowerFlowBranches(branches, existingSourceIds, document)` accepts the consuming
  snapshot as its third argument. Without a snapshot these are fragment checks,
  not proof that external reads resolve or that the consuming document fits.
  `existingSourceIds` only prevents collisions; non-pipeline IDs never consume
  pipeline capacity. Legacy `existingFlowCount` hints do not authorize or reject
  edits: only the consuming compiler decides available document capacity.
- Call `allocateGraphId` once in the authoring transaction and retain the result.
  It uses the repository LAN-HTTP-compatible helper and checks collisions.
  Lifting uses content-and-origin IDs so reordered array positions cannot reuse
  another fragment's saved position.

After rebasing onto merged PR #20, `GraphPipeline*` and graph schemas are aliases
of the real shared pipeline exports. There is no temporary average/min bridge.
There is no graph slot schema, capability walker or native-rule copy.
The consuming document's shared schema enforces each field's constraints,
including native 16,384-character text and shorter subtitle limits.
An explicit `targetCapabilities` is checked against the native manifest; without
one, lowering reports native requirements rather than guessing app support.
Catalog and recipe availability still gate average and text keep on the target.
Tests use the real
shared average evaluator for finite-total parity and explicit overflow
divergence. A-number-state remains
disabled with its specific prerequisite and compiler pointer; no cast or
fabricated shape exists.
The deterministic compiler comparison includes seeds `0xa43d91e7` and
`0x5e19b6c3`, including the 256-case adversarial semantic flow-input family.
It covers native
acceptance/refusal, exact manifests, first diagnostics, field limits, edited graphs,
standalone source/flow inputs, recipe bundles and cycles, mixed-source native limits,
success/failure expansion provenance and lift round trips. The 32-step, 2,341-node
edited-flow fixture also checks that lowering invokes its native checker once.
Structural roots do not assemble their descendants merely to return an existing
port type. Regression checks also forbid checker replays during budget
construction and the lenient call-schema pass during scoped call compilation.

Hosts still own stable-anchor resolution, use-bound arguments, whole-document
expansion, draft layout extraction, persistence/conflicts, and publication.
Never install a recipe's generated sources separately from its root replacement.

## Owner follow-up: compiler accounting

PR #25 supplies read-only expression/flow accounting observers. This lane accepts
their nullable limit shapes but does not subscribe to the observer yet.
Integration is follow-up work: consume the actual counter scopes and reset
events, preserving traversal, short-circuiting, diagnostics and
CHK-nested-choose-budget exactly. Do not introduce an independent formula,
reconcile the checker with native behavior, or change any limit.
