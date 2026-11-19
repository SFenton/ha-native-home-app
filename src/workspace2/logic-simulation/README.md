# Studio simulation host (W2-S -> W2-I)

`SimulationHost` is deliberately not mounted in the existing workspace shell.
It is a client-only host for operand, condition, text-slot and flow roots. It
does not execute actions, open an HA connection, publish configuration, or add
an HTTP endpoint. Replay remains disabled.

## Mounting contract

Mount inside the **existing** `WorkspaceDataProvider`, passing its real
`LiveHouse`/house, not a second connection or an implicit demo house:

```tsx
const program = useMemo(() => createSimulationProgram(graphs, {
  library: document.logicLibrary,
  flows: checkedPipelineSources,
  sourceEntities: literalHaSourceEntityIds,
}), [canonicalRevision]);

<SimulationHost
  program={program}
  document={document}
  canvasId={stableCanvasId}
  blockNames={displayNamesByBlockId}
  freshness={{ stale: connectionIsStale, error: connectionError }}
  previousText={explicitKeepSeeds}
  active={canvasIsActive}
/>
```

`createSimulationProgram` calls graph `lower` once per canonical edit; an
invalid graph throws rather than being repaired. Supply canonical, checked
dependency flows and the source-ID -> literal HA entity-ID mapping. Graph IDs
must be canvas-wide unique, including separately lifted roots. Root anchors,
block IDs and source/port identities must survive layout-only changes. No
position-based remapping is performed.

The connection owner must supply transport freshness: `LiveHouse` retains
values during reconnect and cannot itself detect a transport error. Held-only
houses without `LiveHouse` are labelled Sample, not fresh Live. Snapshot
subscriptions use entity, viewer and ready versions, never map identity.

`sharedFlowRequests` groups identical request/parameter definitions onto the
first authored flow ID. Its bridge uses the existing `useLiveRun`, relative
request helper, 600 ms debounce and response sequence guard. Mount **one**
bridge owner per group; do not also mount independent live-run consumers for
the other grouped IDs. Steps-only edits evaluate the held response locally.
There is no canvas socket or polling timer.

**Closing:** render `active={false}` before unmounting. This supplies undefined
inputs to the existing shared hook, cancelling its pending debounce and
invalidating late responses. That hook does not currently have unmount cleanup;
this lane does not own `data/liveRun.ts`. The harness demonstrates the two-phase
close. Reopening or changing document/canvas identity starts Live with no pins.
If integration cannot provide this lifecycle, obtain an allocation to fix the
shared hook rather than assuming unmount cancels it.

## Evaluation and personal state

`runSimulation` evaluates one cloned capture and frozen local clock. Source
pins overlay captured reads (including state/raw-state aliases and entity
request rows). Computed pins replace only their temporary expression/stream;
their upstream values are not invented. Stream pins skip the overridden
prefix, retain original trace pointers, and do not edit canonical inputs.
Flow gaps remain null; flow output pins reject loading/unavailable/Unknown
instead of silently translating their status.

Per-block Live removes its output override and recomputes using its selected
dependencies. On a source block it explicitly restores that source from the
held Live snapshot, consistently across related reads. Saved scenario runs
never acquire Live data implicitly. Local pins win; Return to Live removes
active pins/scenario/clock without deleting saved cases.

`captureScenario` captures held Live fields with the selected overlays for
explicit review. Previous-text seeds are separate from readings. Save/import/
export are explicit Studio-only operations, separate from draft/publication.
Storage is versioned, bounded to 20 cases/256 KiB, and guarded against denial
and quota errors; failed saves retain the candidate/list in memory. Imports
reject duplicate keys, conflicting pins and credential/connection fields.

`runAll` clones its held argument once, then evaluates saved rows independently
from their captures, with no network capability. Results are Passed, Failed or
Incomplete, with exact typed comparisons, optional numeric absolute tolerance,
source and capture time. Missing inputs, unresolved pins, changed semantic
fingerprints and truncated flow samples cannot become passing expectations.

## Observation seam

The only native evaluator changes are optional read-only hooks in `evaluator.ts`,
`pipeline/evaluate.ts` and `pipeline/operands.ts`. `pipeline/compile.ts` is not
modified. W2-D owns forwarding observers through compiler-created evaluators.
The host runs the existing shared evaluators on graph-checked inputs directly.

`createObservation` consumes actual callbacks: operand/predicate answers,
count selection/raw reads, filter decisions, sort positions, map/group/reducer
item values, and step inputs/outputs with real meter usage. It never evaluates
anything. Each Run groups reducer rows with their actual result; Items keeps
filter counts and First Few cuts separate. Unobserved/skipped values are named
as such. Display cuts and the combined 2,000-record cap never change evaluation.
Documents have node-visit observations, not an invented runtime budget cap.

Every event/copy is gated by observation; the unobserved hot paths allocate no
new per-item or per-step diagnostic objects. The permanent corpus test runs all
925 pipeline/evaluation files against origin/main and this branch in separate
processes, with/without observation, comparing serialized results and costs.
Its baseline helper fetches only origin/main if a shallow CI checkout lacks it.

## Reproduction

```sh
npx vitest run tests/flows-canvas/simulation --maxWorkers=2
node --import tsx tests/flows-canvas/simulation/benchmark.ts
env -u HA_URL -u HA_TOKEN -u HOME_ASSISTANT_URL -u HOME_ASSISTANT_TOKEN \
  -u SUPERVISOR_TOKEN STUDIO_E2E_PORT=4823 \
  STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-s \
  npx playwright test tests/e2e/workspace2-flows-simulation.spec.ts
```

The browser spec supplies the owned HTML harness through Playwright routing,
then loads its modules through the existing Vite middleware. It intercepts the
existing flow endpoint with fake-HA data. No production entry/server edits are
needed. Curated acceptance and benchmark evidence is in
[`docs/evidence/flows-canvas-simulation`](../../../docs/evidence/flows-canvas-simulation).
