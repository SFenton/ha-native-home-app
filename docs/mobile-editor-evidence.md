# Mobile editor verification evidence

## Final integrated result

**Passed: all 73 Chromium cases**, including all 32 mobile cases, three configured
interaction cases, four native-preview cases, and the desktop/Chores regressions.
The final run includes the independent review corrections, not just the earlier
mobile implementation.

| Check | Evidence |
| --- | --- |
| `npm test` | 599 tests across 23 files passed; `test-results/final-units-r4.log` |
| `npm run build` | Typecheck and production bundle passed; `test-results/final-build-r4.log`. Existing Zod annotation and bundle-size warnings remain. |
| `npx playwright test --workers=1 --output=test-results/integrated-browser-final-r6` | 73 passed in 3.2 minutes; matching `.log` and per-case artifacts |
| Rebuilt `native-home-studio:fidelity-check` plus `node scripts/smoke-container.mjs native-home-studio:fidelity-check` | Production authentication, relative assets, save/publish, restart persistence, and mounted-path browser routing passed; `test-results/final-container-build-r2.log` and `test-results/final-container-smoke-r2.log` |

Final corrections include flow-layout notifications and View controls, reachable
short-height inspector controls, focused-field reveal after resizing, 44px layer
Actions targets, separate endpoint-search consent, inherited disabled/read-only
and failed-data gates, and inactive vacuum selector/scroll-state handling.
The desktop drag trace showed workbench auto-scroll from 100 to 88px, not a native
layout change. That test now scrolls the workbench to the top with wheel input
before measuring its pointer destinations; insertion, cancellation, and keyboard
assertions remain intact. Auto-scroll has not been disabled.

The mobile cases exercise ordinary touch scrolling, second-finger cancellation
before and after drag activation, drag recovery, keyboard/pointer alternatives,
mounted editing state, dialogs, actual Chromium 200%/400% tab zoom, text spacing,
reduced motion, save versus publish, and conflict preservation. Native acceptance
uses synthetic source-informed fixtures and simulated actions only.

Temporary test services and containers stopped, port 4801 is closed, and the
test-only lock was removed after its recorded PID was confirmed dead. The owned
browser tab was closed. No user `data/` was reset or migrated, and no user draft
was published. Existing documents are not silently reimported.

These are browser and production-container results, not physical-device,
Mobile Safari, software-keyboard, deployed HA Ingress, ActivityKit/APNs, or
unchanged iOS-client SDUI proof.

## Historical worker runs and isolation

The sections below retain earlier failure evidence and worker handoffs; their
blocked/pending statuses are historical and superseded by the final result above.

**Round three:** the 320px inspector fix passed, but that run remained blocked
by short-landscape notification overlap and a focused raw field clipped after
resizing back to compact width. Only owned test defects were corrected during
that worker run; source and existing tests remained unchanged.

**Historical first pass:** After the parent's
explicit stable-code/port handoff, the first mobile run executed 7 of 32 cases:
**4 passed, 3 failed, 25 did not run** (3.3 minutes, exit 1). The three failures
were dock hit-testing timeouts in coordinated layouts, with a Studio notification
intercepting pointer events. No source or existing test was edited. Per the
handoff's stop rule, remaining mobile cases and the existing desktop/Chores
regressions were not run after these failures.

No unit suite, application build, container, HA request, device command, user-data
reset, or real service call was run by this worker. API fixture writes targeted
only `http://127.0.0.1:4801/api/draft`. Network-safety fixture teardowns have not
reported unexpected API/external HTTP requests.

Owned additions: `tests/e2e/mobile-editor.spec.ts`,
`tests/fixtures/mobile-editor.ts`, and this file. Existing tests and global
Playwright configuration are unchanged. Port 4800, PID 1604348, `data/` (parent
reports revision 9), native
projects, and implementation paths are excluded.
Before an authorized run, inspect any
`test-results/studio-data/.studio.lock` and confirm its recorded PID is dead
before removing that exact test-only lock. Never inspect or delete `data/.studio.lock`.

## Round three: short-height fix and bounded failure grouping

The parent released stable CSS making the compact/short-height inspector header
static and extending the short-height layout threshold to 650px. All runs used
the unchanged isolated server configuration, one Chromium worker, and
`--max-failures=5`; no run was manually interrupted.

```sh
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=5 --output=test-results/mobile-acceptance-r3
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=5 --output=test-results/mobile-acceptance-r3/aligned
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=5 --output=test-results/mobile-acceptance-r3/verified
```

The initial run reported **14 passed, 5 failed, 13 did not run**, exit 1, 2.6m.
The aligned run reported **16 passed, 5 failed, 11 did not run**, exit 1, 2.3m.
These are separate runs, not additive case totals. Each hit the configured
failure limit and emitted an additional early-stop runner error; that message
is not an extra failed case.

Owned test corrections, with product assertions preserved:

- JSON-field accessible names include their label's validation hint. Exact
  literal names never matched. Textbox-name prefix expressions now match the
  stable label without depending on changing hint/error text.
- Short-height layouts intentionally allow outer scrolling. The matrix now
  scrolls the active pane into view before requiring all four measured edges
  within the viewport. The 390 x 320 case then passed all pane/control checks;
  no bounds, hit-testing, overflow or persistence assertion was removed.
- Native modal Tab traversal can enter browser chrome: retained focus evidence
  shows `document.hasFocus() === false` with `BODY` active twice in 16 steps.
  Background document controls remain forbidden; all other steps focus a
  dialog descendant. Escape restores the original invoker and the invalid
  source draft is not applied. Browser-chrome traversal is not a source defect.
- Runtime canvas touch handlers stop bubbling touchstart. Capture-phase
  observation now records both trusted starts and their actual gap. Touchmove
  remains observed after propagation for its final `defaultPrevented` value.
- The aligned run completed every assertion in three multitouch cases, then
  failed in test cleanup because it sent CDP `touchCancel` after `touchEnd`.
  The helper now tracks active CDP sequences and only cancels an active one.
  Those cleanup failures are test defects, not successful acceptance cases.

The final authoring TypeScript check passed before the verified run. No
application source, existing tests or global configuration was changed.

### Confirmed remaining source/UI failures

**Landscape notifications still intercept Project commands, 844 x 390.**
Load the synthetic fixture, select Project, and reach the footer commands
without dismissing the initial Studio notification. `Variables & conditions`
retries unforced trial hit-testing for 60s because the notification intercepts
it. The measured Project pane is **x0/y210/300 x 180**. The notice occupies
**x8/y307/828 x 74**; `Variables & conditions` occupies
**x13/y346.125/273 x 44**, and its center hits `.notice.notice-info`.
`Data sources` is also covered at the captured final geometry. Root
`clientWidth = scrollWidth = 844`, so this is overlay/hit-testing failure, not
horizontal overflow. Expected: ordinary scrolling exposes each unforced
Project command with notices left present.

Exact selector:
`getByRole('complementary', { name: 'Project navigation and component library', exact: true }).getByRole('button', { name: /^Variables & conditions/ })`.
Artifact directory:
`test-results/mobile-acceptance-r3/verified/mobile-editor-M2-viewport--84948-e-controls-remain-reachable-chromium/`.
It contains `test-failed-1.png`, `error-context.md`, `trace.zip`, and the
`failure-viewport-hit-metrics` JSON attachment in the trace.

**Focused raw props retain state but disappear outside the inspector scroller
on return to compact width, 390 x 844.**
Select iPad preview, select First item, open Inspect, edit Title, expand Advanced
properties, enter invalid `{"unfinished":`, then resize
390 -> 752 -> 1440 -> 390 while retaining the Inspect task. The final field
is still focused, its DOM node is connected, its selection remains `[3,8]`,
and its invalid draft and unsaved Title remain intact. Nevertheless its
rectangle is **x16/y1075.5625/359 x 52** (bottom **1127.5625**), entirely below
the 844px viewport and the visible Inspector pane ending at **683.21875**.
The final `inViewport(rawProps)` requires bottom <=845 and receives1127.5625.
No reveal command or manual field-scroll workaround was added to this focused
resize check. Root width stays390 with zero horizontal overflow.

Exact selector:
`getByRole('complementary', { name: 'Properties inspector', exact: true }).getByRole('textbox', { name: /^Component props JSON(?:\s|$)/ })`.
Artifact directory:
`test-results/mobile-acceptance-r3/verified/mobile-editor-M2-mounted-p-3ced7-metry-through-width-changes-chromium/`.
The screenshot, trace and failure geometry attachment show the hidden focused
field; do not describe draft/focus continuity alone as complete resize acceptance.

### Retained successful short-height and notice evidence

The 320 x 568 case now passes unchanged product reachability assertions.
Measured active Inspector pane: **320 x 180 CSS px**, at x0/y310;
header `position: static`; document/body widths320; one notice present.
The **180px minimum is our editor design choice**, not a native guideline.
Representative retained artifacts under `test-results/mobile-acceptance-r3/verified/`:

- `mobile-editor-M2-viewport--7b696-e-controls-remain-reachable-chromium/small-inspect-bottom.png`
- `mobile-editor-M2-viewport--7b696-e-controls-remain-reachable-chromium/small-preview.png`
- `mobile-editor-M2-viewport--31d73-e-controls-remain-reachable-chromium/ordinary-preview.png`
- `mobile-editor-M2-viewport--32caf-e-controls-remain-reachable-chromium/ipad-like-landscape-preview.png`

Successful traces retain `inspector-viewport-metrics` JSON. Ordinary390 x 844
has a390 x 388.21875 Inspector pane and one notice, root/body widths390.
All previous round-one/two outputs and parent artifacts remain untouched.

## Round two: notification fix confirmed; compact inspector still blocked

The parent changed only the editor notification CSS to place notices in root
flex flow rather than over the dock. Executed:

```sh
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --grep 'unfolded-like-small|unfolded-like-large|ipad-like-portrait' --max-failures=3 --output=test-results/mobile-acceptance-r2/focused
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=3 --output=test-results/mobile-acceptance-r2/full
```

Focused run: **3 passed / 3**, exit 0, 14.3s. The retained screenshot
`test-results/mobile-acceptance-r2/focused/mobile-editor-M2-viewport--a5333-e-controls-remain-reachable-chromium/unfolded-like-small-preview.png`
shows the busy-reload notification and dock coexisting without overlaying each
other. `trace.zip` in that directory retains the successful unforced dock
hit-testing. No notice was dismissed.

Full run: **9 passed, 1 failed, 1 interrupted, 21 did not run**, exit 130, 2.4m.
320 x 568 failed; 375 x 812, 390 x 844, 420 x 880, 752 x 768, 1024 x 768,
820 x 1180, 1180 x 820, 507 x 800, and 694 x 800 passed. The 844 x 390 case was
interrupted, not counted as failed or passed. After confirming the first failure
from its finalized trace, this worker sent SIGINT to the exact owned runner PID
2401981 to follow the source-defect stop rule. No further acceptance or desktop/
Chores run was started.

**Actual vs expected:** at 320 x 568, after Project -> Inspect, the inspector
fits within viewport bounds but its visible area is effectively consumed by its
sticky `.inspector-header`; the screenshot shows only that header above the
status and notification regions. `Add header action` must remain reachable by
ordinary scrolling/hit-testing. Instead its `click({ trial: true })` retries
until the 60s timeout because `.inspector-header` intercepts pointer events.
This is not a missing selector or a test-data validation failure.

Exact selector:
`getByRole('complementary', { name: 'Properties inspector', exact: true }).getByRole('button', { name: 'Add header action', exact: true })`.
First attempted target rectangle: **x16, y355.28125, width289, height44** CSS px;
pointer center **160.5 / 377.28**. Later retry rectangles shift under the same
sticky header (for example y347.28125). Document horizontal-overflow delta after
Project is 0; the Inspector/final Preview checkpoints were not reached in this
failed case.

Exact failed artifact paths:

- `test-results/mobile-acceptance-r2/full/mobile-editor-M2-viewport--7b696-e-controls-remain-reachable-chromium/test-failed-1.png`
- `test-results/mobile-acceptance-r2/full/mobile-editor-M2-viewport--7b696-e-controls-remain-reachable-chromium/error-context.md`
- `test-results/mobile-acceptance-r2/full/mobile-editor-M2-viewport--7b696-e-controls-remain-reachable-chromium/trace.zip`

Round-two command logs:
`/home/sfenton/.copilot/session-state/80fdb87a-92c2-4bf4-b1f3-edaea80361a8/files/mobile-acceptance-r2-focused.log`
and `mobile-acceptance-r2-full.log` in the same session directory.
All nine full-run successes retain traces; representative compact and
coordinated screenshots remain in their corresponding full-run output
directories. The dedicated workflow cases (including real browser zoom and
multitouch) still have **zero executions**, not passing acceptance.

Cleanup: focused server PID **2399635** was confirmed dead before removal of its
test-only lock and starting the full run. Full-run server PIDs **2402024,
2402025, 2402036, 2402037, 2402048**, and observed browser PID **2402117** were all
absent after graceful runner interruption. PID 2402048 owned the 4801 listener.
`process.kill(2402048, 0)` returned ESRCH before removing only
`test-results/studio-data/.studio.lock`. Final port-4801 `ss` output had no
listener. Live PID **1604348** remained present. No prior result directory,
parent artifact, user data or user lock was removed.

## Observed first-pass failures

Exact executed command:

```sh
npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=3 --output=test-results/mobile-acceptance
```

The command's full output is retained at
`/home/sfenton/.copilot/session-state/80fdb87a-92c2-4bf4-b1f3-edaea80361a8/files/mobile-acceptance-run.log`.
It reported an additional out-of-test early-stop error after hitting the
three-failure limit; it is not counted as a fourth failed case.

| Viewport | Result | Last blocked accessible selector | Retained output directory suffix |
| --- | --- | --- | --- |
| 320 x 568 | Pass | None at completion | `7b696` |
| 375 x 812 | Pass | None at completion | `4d956` |
| 390 x 844 | Pass | None at completion | `31d73` |
| 420 x 880 | Pass | None at completion | `deea7` |
| 752 x 768 | Fail, 60s timeout | button `Fit` | `a5333` |
| 1024 x 768 | Fail, 60s timeout | button `Zoom out` | `4bf58` |
| 820 x 1180 | Fail, 60s timeout | button `Reset preview zoom to 100 percent` | `9b827` |

All directories use this exact form:
`test-results/mobile-acceptance/mobile-editor-M2-viewport--SUFFIX-e-controls-remain-reachable-chromium/`.
Every executed case retains `trace.zip`. Each failed directory also contains
`test-failed-1.png` and `error-context.md`. The ordinary 390px success directory
retains `ordinary-project.png`, `ordinary-inspect-bottom.png`, and
`ordinary-preview.png`.

Reproduction for each failed viewport: load the synthetic fixture; switch
Project -> Inspect; expand App theme and reach Text scale; switch Preview;
select Duo; open View controls; click the `Flat` state button to expose 3D
yaw/pitch controls; reach the labeled controls and then the dock buttons in
the spec's order. No Save/Publish or real service operation is performed.
`reachable()` uses native scrolling, measured viewport bounds and an unforced
Playwright `click({ trial: true })`; it does not dispatch the dock action.
The first four viewport cases completed this same sequence.

For all three failures, the retained trace repeatedly reports
`Wait for the current server operation before reloading.` from
`[aria-label="Studio notifications"]` intercepting the target. The notification
is visible in the screenshot and accessibility snapshot. Its source is the
busy-reload notice at `src/useStudio.ts:36`; no implementation fix was attempted.
The notice has a Dismiss notification button; this failure establishes blocked
dock hit-testing while it remains open, not that dismissal is impossible.
No forced click, dismissal workaround, longer timeout, or relaxed reachability
assertion was introduced.

Measured target rectangles from the trace's first failed click attempt:

| Viewport | Target | x / y | Width / height | Pointer center |
| --- | --- | --- | --- | --- |
| 752 x 768 | Fit | 442 / 648.421875 | 44 / 44 | 464 / 670.42 |
| 1024 x 768 | Zoom out | 676.984375 / 648.046875 | 44 / 44 | 698.98 / 670.04 |
| 820 x 1180 | Reset preview zoom | 524 / 1060.171875 | 44 / 44 | 546 / 1082.17 |

These are editor CSS-pixel rectangles, not native touch-target measurements.
All four passing cases recorded document/body horizontal-overflow deltas **0px**
and `scrollX=0` at all three checkpoints. Each failing case recorded **0px / 0px /
0** after Project and Inspect; its final Preview overflow checkpoint was not
reached. Absolute root width and the dedicated tree-target matrix were not
attached/executed, respectively; do not infer them from these deltas.

Only 7 of 13 viewport cases and none of the 19 workflow cases ran. Focused raw
draft/resize, dialog focus, single/multitouch, scroll/drag, non-drag placement,
save/publish/conflicts, typography and actual browser-zoom acceptance therefore
remain **unverified**, not passed.

## Authored matrix

Every size below is an **illustrative CSS viewport**, not a sourced physical
device specification. The matrix uses Chromium with `hasTouch: true`, ordinary
HTTP on loopback 4801, reduced motion, synthetic static data, and the existing
single-worker configuration.

| Study | CSS viewport |
| --- | --- |
| Small | 320 x 568 |
| Mini-like | 375 x 812 |
| Ordinary | 390 x 844 |
| Folded-like | 420 x 880 |
| Unfolded-like | 752 x 768; 1024 x 768 |
| iPad-like portrait / landscape | 820 x 1180; 1180 x 820 |
| Split widths | 507 x 800; 694 x 800 |
| Landscape | 844 x 390 |
| Keyboard-like height | 390 x 320 |
| Wide | 1440 x 1000 |

Authored count: **32 cases** (13 viewport cases, 15 standalone workflow cases,
and 4 parameterized multitouch cases),
derived from the source declarations without invoking Playwright discovery.
Authored checks cover root horizontal overflow, pane bounds, project footers,
inspector bottom controls, dock controls including fold/3D controls, editor
chrome, host/device independence, pane DOM continuity and uncommitted editor
state, explicit Actions, non-drag placement before/after/inside/cross-surface,
touch insertion/selection, delayed direct drag, handle drag, placement cues,
touch cancellation and scroll intent, keyboard/external pointer, focus and
Escape restoration, hidden-pane accessibility, selected 44 CSS-pixel editor
alternatives and 16 CSS-pixel fields, inspector action/condition/binding/JSON,
sample data/session variables, project routes/modals/activity variants,
undo/redo, import validation/file input, save/reload/publish and conflict
preservation. Browser routes reject unexpected API and external HTTP requests;
service actions must produce only the local simulation notice/log.

Research alignment: [mobile-editor-research.md](mobile-editor-research.md),
especially R3-R6. Focused-pane resize assertions run **before** any reveal
command, retaining raw props text, DOM identity, focus and selection offsets.
A separate raw-source dialog retains an invalid uncommitted draft through
320px/intermediate/short-height resizing; Tab stays inside the dialog and Escape
must restore its invoker without applying or saving. Initial touch movement is
checked for absence of dragging before release and again after the hold delay.
Pane navigation uses the named outer regions and scoped Editor panes navigation.
Compact management views return through Back to project before accessing the
sidebar. The 844px landscape case expects Preview plus one sidepane. Insert
Escape restoration is exercised from its focusable tray, not an editing field.

Four additional CDP cases cover component-content/explicit-handle starts, each
with a second finger before the 220ms hold or after drag activation. The pending
case measures the observed gap and requires it to be less than 220ms; both cases
wait beyond the hold, assert no drag/cue, dispatch two-finger movement, and compare
the entire local document and saved synthetic draft. Passive window observers
record trusted touch events and their final `defaultPrevented` state. Each case
also records drag-state transitions to catch late hold activation or replacement
drags, then completes a single-finger reorder and checks the exact document change.
The 220ms hold and 8px tolerance are editor choices, not native guidelines.
Non-prevented touch events are evidence about editor interference, not proof of
native pinch zoom: the explicit handle intentionally uses `touch-action: none`.
Content-native gesture behavior and Safari/hardware remain separate limitations.

Text-size stress at **320 x 568** snapshots computed font sizes for initially
mounted editor text, buttons, fields, labels and summaries, then injects twice each size
(excluding the simulated native app). It asserts the inspected field's measured
size doubled. This is **not browser zoom**, OS Dynamic Type, Safari text-size
adjustment, or a real keyboard test. Reduced transparency uses the existing
Opaque chrome control, not an OS preference claim.

A separate authored real-tab-zoom case creates a disposable Manifest V3
extension/profile under its test output directory and uses `chrome.tabs.setZoom`
at 200% and 400% in isolated bundled Chromium. It checks `getZoom`, CSS viewport
width (1280 becomes 320 at 400%), device-pixel-ratio change, unchanged visual
pinch scale, focused raw draft/title persistence, command reachability and
horizontal reflow. This is **not** CDP `pageScaleFactor`, CSS zoom, or viewport
resize as a substitute for browser zoom. The extension only selects the
isolated 4801 tab; the extra context has the same network guard and closes in
`finally`. Its generated extension/profile are removed after closure; its own
trace and measurements are retained. Extension/headless support is unverified
until execution; an unsupported launch/worker/zoom operation is a concrete
infrastructure failure, not a skipped or passing zoom check.

An independent **320 x 568** text-spacing check applies line height 1.5, paragraph
spacing 2em, letter spacing 0.12em and word spacing 0.16em. It measures the applied
overrides and checks control reachability, wrapping project commands and root
reflow. These overrides and 200% text enlargement are separate cases, not a
claim that the criteria require one combined override. **44 x 44 CSS px is our
editor goal**, not an Apple native-point requirement; selection, reorder and
Actions targets in the unscaled layer tree are checked, not scaled canvas art.

The 390 x 320 case is **keyboard-like height stress only**, not a keyboard
simulation. In an iframe, VisualViewport describes that frame's layout viewport;
these top-level Chromium tests do not establish HA Ingress iframe keyboard
clearance or allow manipulation of the HA parent document.

## Commands and results

| Command or read-only tool | Result |
| --- | --- |
| `git --no-pager status --short && cat package.json` | Completed; source tree already uncommitted; scripts inspected only |
| `./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node tests/fixtures/mobile-editor.ts tests/e2e/mobile-editor.spec.ts` | Latest authoring pass initially exited 2 for two unsafe Window casts in touch-event evidence reads; replaced them with a typed Playwright JSHandle. Final rerun exit 0. No server or application build |
| `git --no-pager diff --check -- tests/e2e/mobile-editor.spec.ts tests/fixtures/mobile-editor.ts docs/mobile-editor-evidence.md` | Exit 0; new untracked files are not included by Git's diff check |
| `git --no-pager status --short -- tests/e2e/mobile-editor.spec.ts tests/fixtures/mobile-editor.ts docs/mobile-editor-evidence.md` | Exactly the three owned paths are new/untracked |
| `rg` tool (test declarations) on `tests/e2e/mobile-editor.spec.ts` | Latest count: 17 declarations, comprising 15 standalone cases, one declaration over 13 viewport entries, and one over 2 initiators x 2 phases, for 32 total. No Playwright discovery command run |
| `rg` tool, pattern `[ \t]+$` on the three owned paths | No trailing whitespace found in the authored files |
| `npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=3 --output=test-results/mobile-acceptance` | Exit 1; 4 passed, 3 failed, 25 not run; 3.3m; exact failures above |
| `npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --grep 'unfolded-like-small|unfolded-like-large|ipad-like-portrait' --max-failures=3 --output=test-results/mobile-acceptance-r2/focused` | Exit 0; all 3 previous failures passed; 14.3s |
| `npx playwright test tests/e2e/mobile-editor.spec.ts --project=chromium --workers=1 --max-failures=3 --output=test-results/mobile-acceptance-r2/full` | Exit 130 after deliberate source-defect stop; 9 passed, 1 failed, 1 interrupted, 21 not run; 2.4m |
| `npx playwright test tests/e2e/studio.spec.ts tests/e2e/chores.spec.ts --project=chromium --workers=1 --output=test-results/mobile-desktop-regression` | NOT RUN; full existing regressions authorized, but subsequent mobile source failures triggered the explicit stop rule |
| `npm test` | NOT RUN; final stable-source permission required |
| `npm run build` | NOT RUN; final stable-source permission required |

Historical first-pass counts: **7 executed, 4 passed, 3 failed, 25 not run**.
Round-two focused: **3 passed**; round-two full: **9 passed, 1 failed,
1 interrupted, 21 not run**. These are separate runs, not unique acceptance-case
totals. Unexecuted tests are
not passing acceptance evidence. The parent reports the stable integrated
source passed **382 unit tests / 19 files and build**, with **32 earlier
Chores/desktop browser cases passed**. Those baselines and known Zod/chunk
warnings are parent-reported, not results from this task.

## Artifacts and remaining acceptance

Observed runtime screenshots/traces are listed above. The spec requests traces
on success and failure with file-local `trace: 'on'`, screenshots through
`testInfo.outputPath`, and image attachments. Planned screenshot basenames:
`ordinary-project`, `ordinary-inspect-bottom`, `ordinary-preview`,
`unfolded-like-small-preview`, `ipad-like-landscape-preview`, `wide-project`,
`wide-inspect-bottom`, `wide-preview`, `keyboard-like-project`,
`keyboard-like-inspect-bottom`, `keyboard-like-preview`,
`retained-compact-selection`, `compact-tap-insertion`, `touch-nested-drop-cue`,
`touch-scroll-without-drag`, `compact-live-activity-layout-only`,
`editor-200-percent-text-scale-inspect`, and
`editor-200-percent-text-scale-reduced-effects`, `focused-source-dialog-short-height`,
`editor-320px-text-spacing-inspect`, and `editor-320px-text-spacing-project`.
Multitouch cases additionally request
`{component,handle}-{before-hold,active-drag}-single-finger-recovery.png`
and matching touch-event JSON attachments. Real zoom requests
`actual-browser-zoom-{200,400}-{inspect,preview}.png`,
`actual-browser-zoom-measurements` JSON, and `browser-zoom-trace.zip` in that
test's output directory, separate from the fixture's normal `trace.zip`.
Record actual output directories,
trace paths, assertion counts, failures and reproductions here only after a run.

Remaining: parent fix and repeat acceptance; remaining compact/coordinated/wide
layout evidence; actual browser zoom; complete capability-table acceptance
(authored combinations are not exhaustive); focused desktop regressions; stable
unit/build evidence from this worker (the stable parent results are not rerun).
No image was built, so container smoke is not claimed.

Playwright started server chain PIDs **2348464, 2348465, 2348492, 2348493,
2348507**; PID 2348507 owned the 4801 listener and test lock. The runner shut all
five down. `ps -p` confirmed all absent and `ss -ltnp 'sport = :4801'` showed no
listener. A final `process.kill(2348507, 0)` returned ESRCH before removing only
`test-results/studio-data/.studio.lock`. No force-kill or foreign-process
termination was needed. Excluded live PID **1604348** remained present. Parent
`chores-final-acceptance` and all other output directories were not removed.
The parent's fresh device listing reports no iOS host
("iOS Simulators need macOS with Xcode"); this worker did not run device tools.
Chromium
evidence cannot establish native iOS, Safari, hardware/hinge, ActivityKit, APNs,
HA installation, or delivery to the unchanged native app.
