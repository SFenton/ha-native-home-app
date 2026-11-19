# W2-S simulation acceptance

This is Studio browser/harness evidence, not HA installation or native-device
delivery. Fixtures reuse the existing first-slice composition and demo house;
HA credential environment variables were cleared. All browser work used port
4823 and `test-results/studio-data/w2-s`, never the user's development data.

## Acceptance evidence

| ID | Evidence |
| --- | --- |
| S-live | `live.test.tsx`: identical requests grouped onto one existing live-run owner; request/parameter races, failed refresh with retained stale answer, steps-only changes, cancelled simulation debounce, entity/version updates without a new connection. |
| S-pins | `engine.test.ts`: bedroom 25 -> Too Warm -> Live 21.9; immutable capture/AST; typed computed/step overrides; dependency-specific modes; explicit per-source Live restoration; stale target refusal. |
| S-scenarios | Unit and desktop/phone Playwright: explicit Passed/Failed/Incomplete; offline Run All; review/save/reload; reopen Live; midnight edge; actual saved keep seed; tolerance; denied/quota/oversized storage; stale pins/semantic changes/truncated capture refusal. |
| S-trace | Actual shared-evaluator observations: raw count tests/viewer exclusion, filter reasons, sort positions, map/group values, numeric reducer membership, original pointers and real step budgets. Eight input chores become six after Keep Where; the separate display flow cuts six to five. |
| Observer invariants | Permanent `observation.test.ts` compares all 925 files in `contract/corpus/pipelines` and `contract/corpus/evaluation`: origin/main and branch, both with/without observer, byte-identical serialized evaluation results, step traces, errors/budget results and spend counts. Throwing diagnostic callbacks cannot change answers. |
| Network boundary | Desktop and phone intercepted traffic: one initial grouped safe flow read; zero extra fetches for pins, clock, drawers, Run All, capture or save; no device-write endpoint. Reload/reopen/Return to Live are distinguished from simulation. JSON records contain method/URL only, no headers or credentials. |

Focused commands and the W2-I mounting/lifecycle contract are in the
[host README](../../../src/workspace2/logic-simulation/README.md).

## No-observer benchmark

[`benchmark.json`](benchmark.json) records the full measurements against
origin/main `427eaba6236804275de58d3759c467f4bfcf3798`, Node v26.3.0 on this
shared macOS host. The flow has 64 entities and seven filter/map/group/count
steps. After 3,000 warm-up runs per implementation, 15 samples alternate
before/after order; each sample evaluates 3,000 flows. Answers and visit counts
are checked before timing.

| Unobserved implementation | Median per 3,000 runs | Approx. per flow |
| --- | ---: | ---: |
| origin/main | 523.126 ms | 174.375 us |
| W2-S | 525.844 ms | 175.281 us |

The measured median difference is **+0.52% (+0.91 us per 64-entity flow)**,
not a claim of literally zero timing overhead or a statistically isolated
hardware result. No diagnostic event objects/copies or observer-only item
loops are allocated/executed without an observer. Timing is reported, not used
as a flaky CI assertion.

## Recorded checks and artifacts

`npm test -- --maxWorkers=2`: 269 files, 12,192 passed and one existing skip.
`npm run build`: passed. Focused Playwright: 16 passed across desktop
(1440 x 900; design scene 1440 x 1100) and phone (390 x 844, 2x capture).
The permanent corpus comparison and observer invariants remain in those tests.
`npm run scan:house`: zero findings. Temporary browser servers were stopped.

- [Desktop pin traffic](desktop-pins-network.json),
  [phone pin traffic](phone-pins-network.json),
  [desktop scenario traffic](desktop-scenarios-network.json),
  [phone scenario traffic](phone-scenarios-network.json),
  [desktop design-scene traffic](desktop-design-network.json),
  [phone design-scene traffic](phone-design-network.json).
- Import traffic: [desktop](desktop-import-network.json),
  [phone](phone-import-network.json). An unchanged import, active-row deletion,
  empty-list replacement and re-import all retain Simulated and make zero
  requests after advancing beyond the shared debounce.
- Failed imports: denied storage on [desktop](desktop-denied-import-network.json)
  and [phone](phone-denied-import-network.json); quota exceeded on
  [desktop](desktop-quota-import-network.json) and
  [phone](phone-quota-import-network.json). The persisted and visible lists stay
  equal, the unsaved JSON stays available, the warning remains visible and no
  request resumes.
- [Actual drawer observations](drawers.json), generated from one shared-evaluator
  run of Sensor offline against the same fake fixture. Eight chores become
  six after Keep Where; First Few separately cuts six to five. These are actual
  observations, not reconstructed drawer evidence.

## Independent-review corrections

The five P2 findings at `3669b21` are addressed without changing the native
hooks, shared live-run hook, canvas, document contract or network API.

| Finding | Regression evidence |
| --- | --- |
| Import resumed Live | Import/delete retain the active captured scenario, pins and mode, even when the saved row is removed. Desktop/phone intercepted traffic covers replacement and unchanged round trips. Only an explicit Live action resumes reads. |
| Disappearing bridges skipped cancellation | The host's headless two-phase retire list commits old identities disabled before dropping them or enabling a same-store successor. Unit tests cover pending removal, in-flight removal/late-answer rejection, restored refreshes, direct host unmount, inactive-to-active canvas transfers and Strict Mode handoffs with both unchanged and renamed store IDs. The shared hook is untouched. |
| Failed import hid storage errors | UI saved-list state commits only after persistence succeeds. Denied/quota browser tests compare the visible names with the unchanged stored bytes and retain the attempted import with its warning. |
| Bounded evidence falsely appeared complete | Real 60-item pipeline runs keep actual counts/results identical while bounded step/iteration copies set the report flag. Browser captures show the trace-wide warning and actual count 60: [desktop](desktop-truncated-trace.png), [phone](phone-truncated-trace.png). |
| Text contrast below AA | Scoped text corrections cover mixed Live backgrounds, selected purple rows and result badges. The rendered contrast audit below checks every visible text/input pair in each exercised surface and state, in both appearances. No global or canvas colours changed. |

### Rendered contrast

The permanent Playwright audit uses computed foregrounds and the full composed
background stack, including CSS `color-mix`, then applies the Studio's existing
WCAG luminance/contrast functions. It checks Live and pinned values, selected
and hovered scenario rows, all result badges, review/import/typed-pin fields,
menus, source radios (including readable disabled Replay), the clock and its
ticks, and Each Run/Items/Trace. It does not merely test tokens against white.

| Text/background pair | Light | Dark |
| --- | ---: | ---: |
| Live tag | 5.76:1 | 8.35:1 |
| Muted Live value on selected scenario row | 6.05:1 | 6.58:1 |
| Matches badge | 5.52:1 | 7.89:1 |
| Failed expectation badge | 5.76:1 | 8.76:1 |
| Minimum across all measured pairs | **5.16:1** | **6.26:1** |

Every measured pair exceeds **4.5:1**. Full machine-readable foregrounds,
backgrounds and ratios: [desktop](desktop-contrast.json) (6,848 text samples,
202 scene/appearance/colour pairs), [phone](phone-contrast.json) (5,216 samples,
180 pairs). All 14 design captures below were regenerated after these colour
corrections.

## Design comparison

Read and compared the actual approved
[`13-sim.png`](../../design/flows/13-sim.png) light/dark reference and
[`14-preview.png`](../../design/flows/14-preview.png) preview/lens reference,
linked from the binding [flows contract](../../flows-canvas.md).
The previous browser-default screenshots have been replaced, not retained as
current evidence. Each capture below is next to its reference. Click for full
resolution; the simulation reference contains both light and dark scenes.

| Scene | Approved reference | Revised capture |
| --- | --- | --- |
| Sensor offline, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved simulation reference"> | <img src="desktop-sensor-offline-light.png" width="420" alt="Desktop light Sensor offline"> |
| Sensor offline, desktop dark | <img src="../../design/flows/13-sim.png" width="330" alt="Approved simulation reference"> | <img src="desktop-sensor-offline-dark.png" width="420" alt="Desktop dark Sensor offline"> |
| Inspector and full trace, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector and trace"> | <img src="desktop-sensor-offline-inspector-light.png" width="420" alt="Light source inspector and actual trace"> |
| Inspector and full trace, desktop dark | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector and trace"> | <img src="desktop-sensor-offline-inspector-dark.png" width="420" alt="Dark source inspector and actual trace"> |
| Scenarios bottom sheet, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenarios reference"> | <img src="phone-sensor-offline-light.png" width="260" alt="Phone light scenarios bottom sheet"> |
| Scenarios bottom sheet, phone dark | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenarios reference"> | <img src="phone-sensor-offline-dark.png" width="260" alt="Phone dark scenarios bottom sheet"> |
| Source bottom sheet, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector reference"> | <img src="phone-sensor-offline-inspector-light.png" width="260" alt="Phone light source inspector"> |
| Source bottom sheet, phone dark | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector reference"> | <img src="phone-sensor-offline-inspector-dark.png" width="260" alt="Phone dark source inspector"> |
| Pin 25, Too Warm, desktop | <img src="../../design/flows/14-preview.png" width="330" alt="Approved compact values lens"> | <img src="desktop-pinned.png" width="420" alt="Desktop pin produces Too Warm"> |
| Pin 25, Too Warm, phone | <img src="../../design/flows/14-preview.png" width="330" alt="Approved compact values lens"> | <img src="phone-pinned.png" width="260" alt="Phone pin produces Too Warm"> |
| Live 21.9 restored, desktop | <img src="../../design/flows/14-preview.png" width="330" alt="Approved compact values lens"> | <img src="desktop-live.png" width="420" alt="Desktop Live restored"> |
| Live 21.9 restored, phone | <img src="../../design/flows/14-preview.png" width="330" alt="Approved compact values lens"> | <img src="phone-live.png" width="260" alt="Phone Live restored"> |
| Saved cases after reload, desktop | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenarios table"> | <img src="desktop-scenarios.png" width="420" alt="Desktop explicit scenario results"> |
| Saved cases after reload, phone | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenarios table"> | <img src="phone-scenarios.png" width="260" alt="Phone saved scenarios table"> |
| Bounded evidence warning and actual counts, desktop | <img src="../../design/flows/13-sim.png" width="330" alt="Approved trace concept"> | <img src="desktop-truncated-trace.png" width="420" alt="Desktop bounded trace warning and actual counts"> |
| Bounded evidence warning and actual counts, phone | <img src="../../design/flows/13-sim.png" width="330" alt="Approved trace concept"> | <img src="phone-truncated-trace.png" width="260" alt="Phone bounded trace warning and actual counts"> |

### Intentional deviations and reasons

- The main surface is **Just the Values**, not a counterfeit canvas. W2-C owns
  blocks, port values, hatching, wires and kept badges; no canvas file changed.
  The block/port observation API is documented in the
  [mounting/observation seam](../../../src/workspace2/logic-simulation/README.md).
- The harness is visibly labelled fake HA, not the integrated workspace.
  It loads the real Studio theme, segmented controls, fields, buttons, tags
  and sheet primitives. The reference's purple pin semantic has no existing
  Studio theme token, so a scoped light/dark purple token was added. Text
  contrast corrections are also scoped here; the global Studio palette is
  unchanged.
- The authored fixture uses the approved native Add/Divide average recipe,
  so the trace includes its real Add and If/Otherwise results instead of
  concealing them or inventing a native Aggregate block. Subtitle kept is
  proved by the real text-slot result and saved keep seed. Badge Hidden is
  an authored fixture expression, not a simulated native badge consumer.
- Numeric/state edits keep an explicit **Apply pin** action so incomplete or
  invalid field edits cannot silently become overlays. Typed computed/stream
  pins and explicit JSON import/export remain available in styled disclosures.
- The clock includes the requested normal date picker. The fake live clock is
  11:59 PM UTC for the midnight acceptance edge, rather than the illustration's
  9:41 PM; Sensor offline pins 11:30 PM. Its zone is stated. DST gaps are
  rejected locally and no offset input or clock lookup request is exposed.
- Scenario values are **live at capture**, not falsely labelled fresh HA
  readings during an offline replay. Their neutral Live tags and explanation
  distinguish them from purple overlays. While a saved case is selected,
  unobserved Live-row outputs say Not run: the table does not cause a hidden
  extra evaluation. Run All still compares every output, including outputs
  outside the focused Subtitle/Badge table lens.
- The cases include a deliberate wrong expectation and a missing-input case,
  retaining explicit red failure and neutral Incomplete evidence. On phones
  the table scrolls internally with a sticky name column; source/clock/trace
  content scrolls within the inspector sheet rather than being squeezed.

The final reservation check used origin/main
`427eaba6236804275de58d3759c467f4bfcf3798` and fetched all open heads:
#27 `1de7dd914293844db4c6d00f0695340cb9c9745d` (26 paths),
#28 `57705b34fbcb69dfd8f1eef0795bee2c2809f228` (8 paths), and
#29 `57919bd8ffea8c0db9d88d96db8b905cbf5123be` (75 paths).
The full diff-derived reservation sets had zero intersections with this lane.

The reviewed baseline `3669b21` subsequently completed all CI checks green,
including shard 6. The earlier browser-package installation failure is no
longer a current blocker. Fresh-head CI status is reported separately in the
PR handoff; the local results above are not substituted for remote CI.

## Scope and limitations

The host is not yet integrated into the production workspace; W2-I owns that
integration. Existing connection freshness must be supplied by its owner.
The host now owns disabled bridge retirement even on direct unmount; W2-I
does not need a special closing render. No changes were made to graph core, compiler forwarding,
schema, server, workspace shell, iOS or Core integration. Browser geometry and
the fake data are not evidence of physical hardware behavior.
