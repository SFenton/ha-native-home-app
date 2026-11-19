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

`npm test -- --maxWorkers=2`: 270 files, 12,194 passed and one existing skip.
`npm run build`: passed. Focused Playwright: 54 passed across desktop
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
- Captured active-case regressions: modified active ID on
  [desktop](desktop-active-import-network.json) and
  [phone](phone-active-import-network.json), unchanged import on
  [desktop](desktop-unchanged-import-network.json) and
  [phone](phone-unchanged-import-network.json), modified inactive ID on
  [desktop](desktop-inactive-import-network.json) and
  [phone](phone-inactive-import-network.json). Each compares persisted imported
  data with the running 25.0 C capture, then proves only explicit selection
  applies the stored version. All have zero simulation requests.
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

### Failed-import timing regression after merge

The [phone quota failure on #28](https://github.com/SFenton/ha-native-home-app/actions/runs/44514049130/job/135525330885)
was a test setup race, not a failed import resuming Live. Its retained trace
shows the second read at monotonic **412155.324 ms**, before the scenario click
was dispatched (**412537.265 ms**) and before the failed import click began
(**412683.396 ms**). "Load fixture scenarios" deliberately remounts the host in
Live. On this run its 600 ms debounced refresh fired while Playwright waited
for the phone drawer to stop moving. The old whole-test one-request assertion
incorrectly counted that legitimate setup read as import traffic.

Both failed-import cases now await the remount's completed response and assert
exactly two setup reads before selecting a scenario. They record a fresh
request-count baseline immediately before import, drain import-scheduled timers
with a finite bound and require **zero requests of any kind** in that window.
The mode, active output, unchanged persisted/visible list, retained
unsaved JSON and visible warning assertions are unchanged. No production code,
retry, fixed sleep or allowed simulation request was added.

From main `2855842`, the original setup-wait fix passed 30 desktop + 30 phone
repetitions. The final request-accounting correction and its negative controls
were then repeated at both normal and 4x CPU, as detailed below. All browser
execution used port 4823 and isolated `test-results/studio-data/w2-s`.

#### Late route-delivery guard and permanent negative controls

Review of `f3603e9` found that a copied Node-side route array could still miss
an import-triggered request delivered during asynchronous attachment work.
The test now also records every fetch/XHR **synchronously at its start in the
page**. After the clock advances and pending requests complete, it attaches
diagnostics, then re-reads the page ledger and the final live route-count delta.
Both must be zero. No endpoint, including safe flow-run reads, is exempt.

Review of `58bed38` then showed that advancing only 1,000 ms missed timers
scheduled for 1,500 or 3,000 ms. Zero in-flight requests did not establish that
the import had finished scheduling work.

The test now pauses the fake clock and tracks import-scheduled timeouts,
intervals, animation frames and idle callbacks, including cancellation.
It advances to the next scheduled callback and waits for in-flight requests,
repeating until no timer remains. `IMPORT_TIMER_BOUND_MS` is **5,000 ms**;
pending timers at that boundary fail with their kinds and due times. A separate
100-callback/100-drain-step cap bounds self-rescheduling work, and network
completion has an explicit 8-second timeout. The final zero-request guard
drains again after asynchronous attachment work before reading fresh counters.
This is a quiescence check, not a larger fixed observation window: a timer
beyond the bound fails rather than being ignored.

Both storage-failure cases have parameterized permanent negative controls. The
test-only storage wrapper schedules a POST flow-run request **0, 300, 600,
1,500, 3,000 or 4,999 ms** into the actual failed-import handler. The last delay
is defined as `IMPORT_TIMER_BOUND_MS - 1`. The same zero-request guard must
reject each variant; the control also requires exactly that one injected
request in both browser and route counters.
No application handler, bridge or request implementation is modified.
`STUDIO_E2E_CPU_RATE=4` enables Chromium CPU throttling for these cases, so the
delayed-request regression can be stressed without scratch source mutations.

| CPU rate | Form | Normal imports, zero requests | Six delayed mutations rejected |
| --- | --- | ---: | ---: |
| 1x | Desktop | 30/30 | 180/180 |
| 1x | Phone | 30/30 | 180/180 |
| 4x | Desktop | 30/30 | 180/180 |
| 4x | Phone | 30/30 | 180/180 |

These are **840 passing quota cases**, run with `--repeat-each=30 --workers=2`.
All 840 attachments were checked: two settled setup reads, matching browser/
route deltas, drained timers, and zero import requests in all 120 normal runs.
All 720 negative controls observed exactly one delayed flow-run and required
the guard to reject it, 30 times for every delay/form/CPU combination.
[Full measured repetition summary](quota-flake-repeats.json);
example injected traffic on [desktop](desktop-delayed-import-network.json)
and [phone](phone-delayed-import-network.json) shows the 4,999 ms control.
These two negative-control records deliberately contain a request; they are
detection evidence, not claims of network-free simulation.

The four denied/quota records above are refreshed normal runs and continue to
show zero import requests. The final full suite passed **54/54 browser cases**,
including all six delays for both storage failures and finite-failure controls
for a timer beyond the bound, a recurring interval and a self-rescheduling
timeout on both form factors;
12,194 unit tests (one existing skip), build and house scan also pass.
No production code changed. These results are local evidence, not a claim that
CI is green. CI was not awaited for this revision.

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

### Round-2 corrections and additive grant

The captured active case is now independent of the saved list. Same-ID imports
can save a different version, but cannot change the active pins, clock, base or
expectations. A visible "Saved version differs. Reselect to apply." note
distinguishes the versions in the canvas and open drawer. The changed saved row
does not present the old running output as evidence for its new inputs.
Desktop/phone tests cover modified active, unchanged and modified inactive IDs,
persisted bytes, explicit reselection and intercepted traffic.

The owner separately granted **`src/workspace2/SelectMenu.tsx` only for an
additive optional `popupClassName` prop**. Only the two simulation call sites
pass it, so their portalled options receive the simulation focus class.
`select-menu.test.tsx` records the real field/popup DOM from before this grant
was applied, then requires it to remain identical when the prop is omitted.
A second test proves opting in changes only the popup class and is reversible.
The approximately 70 other call sites and their shared cyan focus style are
unchanged; the wider Studio focus issue remains a separate follow-up.

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

### Keyboard-focus contrast, every control type

The permanent focus audit establishes keyboard modality, focuses each control,
and requires an actual `:focus-visible` solid outline at least 2 CSS px wide.
It samples the computed outline colour against the composed ancestor surface
it is painted on; a zero-offset outline is also checked against the control's
own filled background. It checks full opacity and uses the existing Studio
WCAG helpers. The simulation-scoped ring uses `--w2-ink-card`, not the shared
cyan. Desktop and phone measured the same ratios below.

| Focused control/state | Light | Dark |
| --- | ---: | ---: |
| Selected mode segment | 14.00:1 | 10.98:1 |
| Unselected mode segment | 14.00:1 | 10.98:1 |
| Tonal toolbar button | 16.10:1 | 13.03:1 |
| Values-ground link button | 15.43:1 | 14.44:1 |
| Values disclosure | 15.43:1 | 14.44:1 |
| Selected scenario row | 13.90:1 | 10.91:1 |
| Unselected scenario row | 16.10:1 | 13.03:1 |
| Primary action | 16.10:1 | 13.03:1 |
| Default action | 16.10:1 | 13.03:1 |
| Icon action on selected row | 13.90:1 | 10.91:1 |
| Scrollable comparison region | 16.10:1 | 13.03:1 |
| Text field | 16.10:1 | 13.03:1 |
| JSON textarea | 16.10:1 | 13.03:1 |
| Source radio | 16.10:1 | 13.03:1 |
| Selected source radio | 16.10:1 | 13.03:1 |
| Number field | 16.10:1 | 13.03:1 |
| Number slider | 16.10:1 | 13.03:1 |
| Selected clock source segment | 14.00:1 | 10.98:1 |
| Unselected clock source segment | 14.00:1 | 10.98:1 |
| Time field | 16.10:1 | 13.03:1 |
| Clock slider | 16.10:1 | 13.03:1 |
| Date field | 16.10:1 | 13.03:1 |
| Trace chip | 16.10:1 | 13.03:1 |
| Combobox trigger (minimum of both adjacent grounds) | 14.00:1 | 10.98:1 |
| Portalled menu option | 16.10:1 | 13.03:1 |
| Scrollable iterations | 16.10:1 | 13.03:1 |
| Iteration button | 16.10:1 | 13.03:1 |
| **Minimum** | **13.90:1** | **10.91:1** |

All exceed **3:1**. Full precision colours and grounds are recorded in
[desktop-focus-contrast.json](desktop-focus-contrast.json) and
[phone-focus-contrast.json](phone-focus-contrast.json): 56 measurements per
form across 27 control/state types and both appearances. The eight light-mode
focus captures below include toolbar segments, selected scenario rows, source
sliders and portalled menu options.

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
| Keyboard focus, toolbar, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved simulation toolbar"> | <img src="desktop-focus-mode-light.png" width="420" alt="Desktop accessible mode focus"> |
| Keyboard focus, selected row, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenario table"> | <img src="desktop-focus-scenario-light.png" width="420" alt="Desktop accessible selected-row focus"> |
| Keyboard focus, inspector, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector"> | <img src="desktop-focus-inspector-light.png" width="420" alt="Desktop accessible slider focus"> |
| Keyboard focus, portalled menu, desktop light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector"> | <img src="desktop-focus-menu-light.png" width="420" alt="Desktop simulation-only menu focus"> |
| Keyboard focus, toolbar, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved simulation toolbar"> | <img src="phone-focus-mode-light.png" width="260" alt="Phone accessible mode focus"> |
| Keyboard focus, selected row, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved scenario table"> | <img src="phone-focus-scenario-light.png" width="260" alt="Phone accessible selected-row focus"> |
| Keyboard focus, inspector, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector"> | <img src="phone-focus-inspector-light.png" width="260" alt="Phone accessible slider focus"> |
| Keyboard focus, portalled menu, phone light | <img src="../../design/flows/13-sim.png" width="330" alt="Approved source inspector"> | <img src="phone-focus-menu-light.png" width="260" alt="Phone simulation-only menu focus"> |

### Intentional deviations and reasons

- The main surface is **Just the Values**, not a counterfeit canvas. W2-C owns
  blocks, port values, hatching, wires and kept badges; no canvas file changed.
  The block/port observation API is documented in the
  [mounting/observation seam](../../../src/workspace2/logic-simulation/README.md).
- The harness is visibly labelled fake HA, not the integrated workspace.
  It loads the real Studio theme, segmented controls, fields, buttons, tags
  and sheet primitives. The reference's purple pin semantic has no existing
  Studio theme token, so a scoped light/dark purple token was added. Text
  contrast corrections are also scoped here; the global Studio palette and
  non-simulation focus indicators are unchanged.
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
#27 `e626cf11002661e7b92577b3f6260d8ac519d7bf` (26 paths),
#28 `57705b34fbcb69dfd8f1eef0795bee2c2809f228` (8 paths), and
#29 `613f8245e3a2270b934e92e0db32bcc32a6cbe2b` (75 paths).
The full diff-derived reservation sets had zero intersections with this lane.

The round-2 reviewed baseline `2ef61f6` completed all 12 CI checks green,
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
