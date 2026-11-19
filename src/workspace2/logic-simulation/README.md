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
  presentation={valuePresentation}
  selectedBlockId={selectedBlock}
  onSelectBlock={selectBlock}
  onObservation={setCanvasObservations}
  clockTimeZone={authoredClockIanaZone}
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

The host inherits `workspace2.css`, `useStudioTheme` and its `--w2-*` variables
from the workspace; the isolated harness mounts those same styles/theme.
It reuses `SegmentRow`, `TextField`/`Field`, `SelectMenu`, `Tag`, Base UI Drawer
and the Studio Overlay/sheet. Local `.sec`, `.kv2`, `.tag.live` and `.tag.pinned`
classes adapt the reference's compact sections, value rows and provenance
without changing global chrome. Purple pin tokens and the AA text corrections
are scoped to simulation surfaces (including portalled sheets), not the
workspace or canvas. The rendered contrast regression measures mixed grounds,
selected rows, badges, fields, menus, hover, clock labels and evidence in both
appearances, rather than testing tokens against white alone.

`presentation.blocks` is keyed by block ID; `presentation.outputs` by
`anchorKey(root.anchor)`. Supply authored display names, units, optional
numeric ranges, state labels, change times, and the date format hint.
`entities` names the identities shown in Each Run. Missing names use "Value"
or "Output N", never machine IDs. Optional `traceBlocks`, `scenarioInputs`
(block IDs) and `scenarioOutputs` (anchor keys) focus a particular preview
lens without changing evaluation or Run All's full comparison.

`selectedBlockId`/`onSelectBlock` connect canvas selection to the inspector.
On phones the inspector is the existing modal bottom sheet; Scenarios is a
separate bottom drawer, never stacked with the inspector. Its comparison
table scrolls inside the drawer and keeps scenario names sticky.

For clock editing, supply an IANA `clockTimeZone` matching `liveClock` (for
example the home's configured zone). Device clocks default to the browser's
zone; home-clock editing is disabled if the host hasn't supplied its zone.
Date/time controls and the 24-hour slider resolve offsets locally using Intl,
reject DST gaps and retain the captured offset at an ambiguous time.
No clock lookup fetches data. Clock Live explicitly restores the held Live
clock even when the selected scenario has its own pinned clock.

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

**Retirement:** the host owns a two-phase bridge retire list. Removed or changed
request identities stay mounted with undefined inputs until the shared hook's
disable effect has cancelled its debounce and invalidated late responses; only
then are they removed. A same-ID replacement waits for that disabled commit.
A headless React root, supplied with the existing house/store, lets retirement
finish even after a direct host unmount. It opens no connection, cancels before
releasing listeners and disposes itself once drained. This is necessary because
the unchanged `data/liveRun.ts` hook has no unmount cleanup. `active={false}`
can still pause a retained host, but callers no longer need a special closing
render. Tests cover pending/in-flight removal, identity changes, refreshed
restoration, direct unmount and Strict Mode handoffs. The browser harness now
closes directly. Reopening or changing document/canvas identity starts Live
with no pins.

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
and quota errors. The visible saved list changes only after storage succeeds;
failed saves leave that list unchanged and retain the unsaved review/import
JSON with an explicit warning. Import/delete never switch mode or resume the
bridge. Removing the active saved row retains its in-session captured scenario
until an explicit Live action or another scenario selection. Imports
reject duplicate keys, conflicting pins and credential/connection fields.

`runAll` clones its held argument once, then evaluates saved rows independently
from their captures, with no network capability. Results are Passed, Failed or
Incomplete, with exact typed comparisons, optional numeric absolute tolerance,
source and capture time. Missing inputs, unresolved pins, changed semantic
fingerprints and truncated flow samples cannot become passing expectations.

## Observation seam

### W2-C / W2-I block and port API

`onObservation(CanvasObservations)` publishes the completed run projection;
the same pure projection is exported as `canvasObservations(program, run,
options)` for non-host integrations. It never evaluates, reads an environment,
replays a scenario, requests data or spends budget.

```ts
interface CanvasObservations {
  blocks: Readonly<Record<string, BlockObservation>>;
  order: readonly string[];
  truncated: boolean;
}
interface ObservedValue {
  observed: boolean;
  value?: Json;
  result?: SimulationResult;
  source: 'live' | 'pinned' | 'scenario' | 'mixed';
  mode: 'Live' | 'Simulated' | 'Mixed';
  state: 'known' | 'unavailable' | 'cant-tell' | 'loading' | 'not-observed';
  freshness: 'live' | 'captured' | 'held' | 'sample';
  pinned: boolean;
  kept?: boolean;
}
interface PortObservation extends ObservedValue {
  portId: string;
  direction: 'input' | 'output';
}
interface BlockObservation extends ObservedValue {
  blockId: string;
  ports: readonly PortObservation[];
}
```

`source` describes the value's dependencies, not whether a diagnostic happened.
Scenario overrides report `scenario`; unpinned HA readings retain `live`
origin with `freshness: 'captured'`. They are frozen historical captures, not
fresh network readings. `pinned` identifies a direct source/output/clock
overlay; do not colour every captured dependency purple. Mixed calculations
remain Mixed. Source gaps are unavailable; an unanswered calculation/condition
is `cant-tell`. Values and typed results remain exactly what was returned.

Output ports use their actual observed callback (a single-output block is
unambiguous). Input ports match recorded child-port identities; unsupported
or unrecorded ports say `not-observed`, never borrow an unrelated value.
Each input's provenance comes from its own upstream connection, not the
block's combined provenance; live and pinned inputs remain distinct.
Repeated evaluations use the last actual callback and its matching inputs.
`order` follows actual completions, including each native text-slot result.
`kept` is defined only when the exact slot expression was observed and its
actual native resolved result and separate seed prove the keep decision.
An unobserved/truncated decision has no keep flag. The API does not invent a
badge consumer's hide/show policy.

W2-C owns port badges, hatching, dashed unknown wires and kept badges. This
lane does not render or edit any canvas block. The test harness's "Badge" is an
authored native expression yielding Shown/Hidden, not a claim that the
unintegrated host or unchanged iOS app renders a real badge.

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
Every bounded step, iteration value and count read propagates truncation to
the report-wide warning; actual counts and results are still unchanged.
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
