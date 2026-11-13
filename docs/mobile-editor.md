# Mobile configuration editor

This is the Studio **web editor**, not a second app or a native iOS renderer.
The host viewport controls the editor workspace; the device chosen inside the
preview remains independent. Browser viewport evidence is not physical-device,
hinge, ActivityKit, APNs, or Home Assistant installation evidence.

## Capability contract

The responsive workspace must expose the same document, commands, validation,
undo history, persistence, and publishing operations as the desktop editor.
Pane switches must not import, save, publish, reset, or reconstruct a document.

| Existing capability | Compact access | Larger workspace access |
| --- | --- | --- |
| Project, tabs, pages, linked child/shared/unassigned pages | Project pane; visible item Actions buttons | Project side pane |
| Create, rename, delete, link, unlink, change initial page, reorder tabs | Project item Actions and existing confirmation/placement dialogs | Same commands and dialogs |
| Modals and Live Activity variants | Project pane; select a surface/variant, then Preview or Inspect | Project pane beside preview |
| Component library, search, tap insertion | Project > Components; quick Insert tray over the preview | Full library plus preview |
| Canvas selection and nested placement | Preview; deliberate drag or tap insertion followed by Move to | Canvas and layer tree |
| Duplicate, delete, move up/down, move between surfaces/groups | Inspect selection tools or Project layer Actions > Move to | Same selection tools and Actions |
| Content, layout, style, actions, conditions, binding, advanced JSON | Full Inspect pane, scrollable sections without field omissions | Inspector beside preview |
| Page/header/modal/activity settings | Select Page & header or the activity; Inspect | Same inspector |
| Navigation, app identity/theme/background image | Project > Navigation & theme | Full management panel |
| Data sources, editable samples, fetch opt-in, native import | Project > Data sources | Full management panel |
| Variables, initial values, session overrides, simulated entities | Project > Variables & conditions | Full management panel |
| Edit versus Interact; simulated actions and activity log | Preview mode control and status/activity controls | Same controls |
| Preview device, theme, rotation, fold study, 3D, zoom, fit, data states, opaque chrome | Preview workbench controls; deliberately scrollable/wrapping controls | Same workbench controls |
| Undo, redo, save, publish | Persistent header, separate Save and Publish controls | Persistent header |
| Stale-draft conflicts and local-edit preservation | Visible conflict banner with explicit keep/reload choices | Same banner and persistence commands |
| JSON/YAML source, validation, import/file input, export, example reset | Editor tools, accessible dialogs | Same editor tools |
| Validation errors, notices, connection retry | Inline errors/notices and startup retry | Same error surfaces |
| Feedback/support components and their action configuration | Existing preview feedback dialogs and full action inspector | Same capabilities |
| Keyboard, screen reader, external pointer and touch | Named controls, pane focus, Escape/back, visible Actions, non-drag placement | Same controls; no touch-only dependency |

## Workspace decision

The [source research](mobile-editor-research.md) records the primary references,
native-versus-web distinctions, installed OSS API checks, and limitations.
Apple's layout guidance says, "Keep functionality the same as size classes
change, and keep layout changes recognizable and familiar to the platform."
For this web editor, that informs capability-preserving pane changes, not a
claim that CSS breakpoints implement native size classes. WCAG
[Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
also motivates the existing exact-placement command path: keyboard dragging
alone is not a single-pointer, non-drag alternative.

Use available CSS width rather than user-agent or hardware detection. Small
phones, folded-host studies, and narrow split views use one focused pane:
Project, Preview, or Inspect. A separate quick Insert tray keeps a palette
handle and the canvas visible together; tap insertion and exact Move to remain
equivalent alternatives to drag.

Intermediate widths use a preview with one coordinated side pane, switching
between Project and Inspect. Wide workspaces retain all three panes. The
implementation breakpoints are content-fit decisions, not device specifications.
Short-height landscape and keyboard scenarios must keep chrome compact and the
active pane scrollable rather than squeezing three desktop columns.
The short-height workspace reserves the pane's actual minimum height in the
outer scroll flow so notifications cannot overlap project commands. Resizing
reveals a still-focused Project or Inspect field without replacing its DOM,
changing its selection, or scrolling the native device's content.

Keep the actual editor panes mounted when responsive presentation changes.
Hidden panes must not retain keyboard focus or expose interactive descendants.
Switching panes does not change Edit/Interact, selection, the target surface,
preview device, local document, or save/publish state. Canvas selection does not
automatically cover the canvas with an inspector.

Touch handles must be visible, deliberate, and separate from normal scrolling.
Touch drag activation must tolerate ordinary scrolling; mouse and keyboard drag
retain their existing behavior and source-sized overlays. Native-preview
interactions, including Chores swipes, remain distinct from editor dragging.
There is no live-service execution path in browser preview actions.

Choose 44 CSS px effective editor touch targets as a Studio design goal, not a
conversion of native points or an overall WCAG conformance claim. Keep the
unscaled layer tree and placement dialogs available when preview fit reduces
simulated target sizes. Use one pointer/touch sensor strategy plus the existing
keyboard sensor; never register overlapping pointer and touch activators.

Dynamic viewport height is an enhancement, not proof of keyboard clearance.
The baseline is scrollable panes and dialogs. Optional VisualViewport handling
must preserve pinch zoom, be cleaned up on unmount, and fall back when
unavailable. In HA Ingress, iframe viewport metrics cannot establish the
top-level keyboard clearance, and an editor modal only makes its own document
inert. No parent-page DOM manipulation or secure-context-only keyboard/fold
API is required.

Use system fonts already present in the project; do not copy Apple font or
symbol assets. Reuse React, dnd-kit, the existing controls and native HTML
`dialog`; no mobile UI framework or duplicate document model is needed.

One deliberate OSS adaptation is the editor's `MobileTouchSensor`. Installed
dnd-kit 6.3.1 does not cancel its pending touch hold when another finger joins
and exposes no public abort method. The small sensor uses dnd-kit's public
sensor callbacks and retains its touch activators/Safari setup, but owns its
pending timer and listener cleanup. Additional touches cancel pending or active
drags without preventing pinch moves; pre-activation scrolling also cancels
without being prevented. The 220ms hold and 8px tolerance are editor choices,
not Apple timing guidance. Browser verification remains required.

## Platform and safety boundaries

The local device inventory on 2026-11-12 reported:
`iOS Simulators need macOS with Xcode.` No iOS simulator or physical Apple
device was available. The listed Android foldable emulator is not evidence for
iPhone Duo hardware or Mobile Safari. Widths used in browser acceptance are
illustrative CSS-pixel sizes, not claims about a device's exact display.

The editor does not infer a real hinge, fold angle, or posture from its host.
Preview fold controls continue to configure only the existing browser study.
Keyboard-like reduced-height tests exercise available space; they do not prove
the behavior of an iOS software keyboard or dynamic Safari chrome.

Acceptance writes use synthetic documents on port 4801 with
`test-results/studio-data`. They must not touch the user's Studio on port 4800,
saved drafts, publication history, or actual Home Assistant devices. Live reads
remain opt-in and service actions remain simulations.

The mobile presentation reuses the already-noticed dependencies in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md): React and dnd-kit (MIT),
Lucide (ISC), and Playwright for browser verification (Apache-2.0). Native HTML
dialog and CSS media/viewport features require no additional package. Existing
Motion preview behavior is retained, not replaced by a copied Apple animation
or proprietary asset.

## Acceptance evidence

**Integrated and verified.** Mobile-owned presentation code is implemented in
`MobileWorkspace.tsx`, `mobile-editor.css`, and `mobile-drag.ts`, with related
Sidebar, shared control, action-editor, and stylesheet-import changes.
The Chores owner released the scoped App/RuntimeNode integration and isolated
browser-test port on 2026-11-12 after its acceptance. App now wires the mounted
panes, quick insertion, existing commands, and editor sensors. RuntimeNode
forwards guarded mouse/touch activation; the outer workbench ignores zero-sized
hidden-canvas fit measurements. Chores, native geometry, and nonediting
gestures remain unchanged by the mobile integration.

The final expanded implementation passes **599 unit tests across 23 files**,
typecheck/production build, and **all 73 Chromium cases**, including all 32 mobile
cases. A freshly rebuilt production image also passes authentication,
persistence, save/publish separation, and mounted-path browser routing.
Existing Zod annotation and bundle-size warnings remain.

The [verification record](mobile-editor-evidence.md) records exact commands,
artifacts, historical failures and corrections, the viewport/input matrix, and
explicit runtime gaps. Browser coverage includes actual 200%/400% tab zoom,
touch scrolling and multitouch cancellation, mounted drafts/focus through
resizing, dialog continuity, placement alternatives, and stale-save conflicts.
Independent read-only reviews informed focused fixes; review itself is not
runtime evidence.

Notifications and View controls occupy bounded flow space instead of covering
commands. Compact/short-height inspectors have nonsticky headers and reveal
focused fields after layout changes. StrictMode dialog cleanup and second-finger
drag cancellation have regression coverage. Test servers/containers stopped;
the user's development data and publication history remain untouched.

A fresh independent static review of the integrated mobile changes, Dialog
lifecycle correction, multitouch cancellation, and notification layout found
no actionable defects. That review preceded the compact-inspector correction;
it is not runtime or physical-device evidence.

The rebuilt `native-home-studio:mobile-final` image, including the compact
inspector correction, passed
`node scripts/smoke-container.mjs native-home-studio:mobile-final`: production
authentication, relative assets, save/publish, restart persistence, and
mounted-path browser routing. Output is retained in
`test-results/mobile-production-smoke-final.log`. Its temporary container was stopped;
no user data directory was mounted and no live Studio process was stopped or
restarted. This image predates the subsequent modal Edit-continuity and Chores
short-title fixes and the expanded interaction work; it is not their acceptance.
This is local container evidence, not an installation on Home Assistant.
