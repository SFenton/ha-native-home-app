# Mobile web configuration editor: research and recommendations

## Decision and evidence boundary

**Follow the existing web architecture; adapt its presentation, not its document
contract.** Use one task pane at a time when space is constrained, coordinated
panes when they remain usable, explicit touch-accessible commands, and the
installed React, dnd-kit, Motion, and native HTML dialog primitives. No new
package or native iOS migration is warranted by this research.

This is source research for the configuration **editor**, not a capability audit
or implementation. Repository context came from `AGENTS.md`,
`.agents/README.md`, `.agents/workflow/models.json`, `package.json`,
[existing research](research.md), [third-party notices](../THIRD_PARTY_NOTICES.md),
and installed OSS metadata, licenses, and declarations. Studio implementation,
server, tests, data, and user drafts were not inspected. The parent owns the
capability inventory and final design.

The original request names iPhone, iPhone Mini, folded and unfolded iPhone Duo,
and iPad. These are experience targets, not reliable browser-detection inputs.
No browser, physical device, native client, Ingress deployment, ActivityKit, or
APNs behavior was validated. References below distinguish native guidance, web
requirements, library contracts, and Studio recommendations.

## Apple guidance: exact rules and bounded web application

The `apple-hig` routing helper received the exact original design request.
All 34 routed files were read, including the 16 foundations, relevant iOS/iPadOS/
Duo guidance, and the fixed one-hop related set. The literal match for
"exercise" also loaded workout guidance; it is irrelevant to exercising editor
control and does not inform these recommendations. This was ordinary guidance,
not the native-only `/duo` workflow or enforce mode. The skill identifies its
release as 2026-09-27 and source snapshot as 2026-09-12. The operative quotations
below were additionally checked against Apple's primary Markdown pages.

| Scope and source | Exact operative quotation | Application to this web editor, not an Apple web mandate |
| --- | --- | --- |
| iOS/iPadOS layout [A1] | "Determine layout based on size classes, not device type or orientation." | Use actual available editor width and height through CSS layout/media or container queries. Native size classes are an analogy, not a browser API. |
| Layout [A1] | "Keep functionality the same as size classes change, and keep layout changes recognizable and familiar to the platform." | Change how many tools are visible together, never which editing capabilities are available. |
| iOS split views [A2] | "Prefer using a split view in a regular — not a compact — environment." | Prefer one active task pane on constrained phones rather than squeezing three desktop columns. |
| iPadOS split views [A2] | "Account for narrow, compact, and intermediate window widths." | An iPad browser or embedded editor can need the compact arrangement too. |
| iPhone Duo [A3] | "Keep functionality and the state of elements the same between displays." | Preserve draft, selection, editing context, and preview choice across host resizing. |
| Gestures [A4] | "Use shortcut gestures to supplement standard gestures, not replace them." | Keep visible ways to navigate, move, reorder, and close without dragging or swiping. |

Apple's accessibility table lists **44x44 pt default** and **28x28 pt minimum**
control sizes for iOS/iPadOS [A5]. These are native points, not a requirement for
44 CSS pixels. Studio's proposed 44 CSS pixel targets below are an explicit web
design choice. Similarly, Apple's Duo reserved-region APIs and automatic
vertical native toolbars [A3] do not establish browser API support or require a
web page to imitate system bar placement. Do not port SwiftUI/UIKit APIs or
infer browser posture from these native descriptions.

## R1. Responsive workspaces without capability loss

**Recommendation:** make available space, content legibility, and reachable
controls determine pane count [A1], [A2], [W1], [B1].

| Available space | Recommended presentation | Invariants |
| --- | --- | --- |
| Constrained width, including Mini-sized use, ordinary phones, or a closed Duo outer-display browser | One primary task pane. Use clearly labeled workspace navigation and an explicit Back/Close path. Reveal the outline, selected-item inspector, and preview on demand. | Every existing command and property remains reachable. Selection and draft survive pane changes. |
| Intermediate width or short landscape window | One or two panes according to measured content needs, not a device label. Collapse secondary tools before shrinking controls or labels. | No mandatory horizontal page scrolling to reach ordinary form controls; no hover-only actions. |
| Ample width, including an unfolded Duo or iPad browser when space permits | Coordinated outline/editor panes; add an inspector or preview pane only if each pane remains readable. Keep pane selection and headings visibly connected. | Pane controls stay near the content they affect. Hidden panes have explicit reveal controls. |

Treat breakpoint values as implementation choices established by minimum usable
pane content, 44px targets, text enlargement, and the actual host container.
Container size queries can adapt a workspace inside a narrower parent; viewport
media queries describe its browsing-context viewport [B1]. Neither identifies a
physical device. Use ordinary responsive layout as the baseline.

Do not merely stack all desktop columns into one enormous phone page, shrink the
whole editor with a transform, or create a reduced-function "mobile lite" mode.
Long-running property editing belongs in a task pane; it need not become a
modal just because the host is narrow. Short pickers or confirmations may use
dialogs. Preserve clear Save versus Publish actions, dirty/conflict status, and
access to validation errors. The parent's inventory must include any existing
advanced/raw editors, import/export, document settings, navigation, profile, and
support content rather than leaving those controls desktop-only.

React ties local state to render-tree position and component identity [O1].
Changing to a different mobile component tree can destroy local input state.
Prefer rearranging a stable editor structure, or keep draft/selection state in
the existing stable owner above any responsive branch. Do not change keys on
resize. Keeping the same key does not preserve state across arbitrary reparenting.
Hidden panes must not leave interactive invisible controls in the tab order;
avoid duplicate desktop/mobile forms and duplicate IDs.

Preserve the active task through resize rather than automatically returning to
the first pane. If its focused control must disappear, move focus deliberately
to the equivalent visible control or pane heading; do not steal focus on every
resize. Restore meaningful pane scroll positions where practical. These are
Studio behavior recommendations, not claims about existing code.

## R2. Host and simulated preview are independent

**Recommendation:** maintain two distinct concepts:

- **Host/editor space:** the actual CSS viewport or workspace container, browser
  zoom, keyboard constraints, and real safe-area information.
- **Preview target:** the user-selected simulated device, viewport, orientation,
  and any illustrative pose. This remains an explicit preview control.

A phone must be able to edit an iPad preview, and an iPad must be able to edit a
phone preview. Resizing the host must not select a different preview device,
change document data, save, publish, or reset the draft. Changing the preview
target must not force a different editor workspace. Keep target controls
reachable even when Preview is not the active pane.

A fit-to-space scale may apply to the **simulation only**, with its scale made
clear; do not scale editor controls with it. If the simulated controls become
too small for reliable selection, provide an unscaled outline/inspector path.
Keep real `env(safe-area-inset-*)` values on the host shell; simulated safe areas
belong to preview geometry, not the host device [B2].

Label frames and poses as browser simulations. An emulated viewport, drawn fold,
or device name is not proof of actual posture, safe areas, browser UI, native
rendering, or unchanged iOS-client support. Preview actions remain simulation;
this mobile adaptation must not introduce real device service calls.

## R3. Touch targets, readable forms, and zoom

**Choose at least 44x44 CSS px effective hit areas for authored editor controls**:
navigation, icon actions, disclosure controls, drag handles, row menus, and
dialog dismissal. Visible artwork can be smaller if its actual target is large,
nonoverlapping, and unambiguously associated. Let controls grow for wrapping
labels; do not enforce a fixed 44px height that clips enlarged text.

This exceeds the WCAG 2.2 **2.5.8 Level AA 24x24 CSS px** baseline, whose exceptions
include sufficient spacing, equivalent controls, inline targets, unmodified
user-agent controls, and essential presentation [W2]. **2.5.5 Level AAA** specifies
44x44 CSS px with its own exceptions [W3]. Meeting this one target-size objective
does not establish overall AAA or AA conformance. Do not use the AA spacing
exception as the default phone design.

Use semantic buttons and labeled form controls. A selectable row and its nested
actions need separate, valid controls, not buttons nested inside buttons.
Keep essential actions visible or available through a labeled menu, not only
on hover, long press, or swipe. Prefer normal click activation over destructive
work on pointer-down, consistent with cancellation guidance [W4].
`any-pointer: coarse` can enhance spacing, but a device can simultaneously have
fine and coarse pointers [B3]; it must not remove keyboard or touch affordances.

Use relative text sizes, user-scalable typography, wrapping labels, and flexible
field heights. A roughly 1rem body/input size is a reasonable starting design
choice, not a WCAG minimum or a guarantee about Safari input zoom. Do not trade
legibility for column count. Use text labels and errors, not color alone.

| Web requirement | Consequence for the editor |
| --- | --- |
| SC 1.4.4 AA: text can resize to 200% without lost content/functionality, except captions and images of text [W5] | Test controls and labels at enlargement, including intermediate sizes. |
| SC 1.4.10 AA: vertical-reading content reflows at width equivalent to 320 CSS px, without two-dimensional scrolling, except content genuinely requiring two-dimensional layout [W1] | A 1280px-wide desktop viewport at 400% zoom is the cited equivalent. A simulation canvas may justify a scoped exception; ordinary inspectors and navigation do not automatically inherit it. |
| SC 1.4.12 AA: no loss when users override line height to 1.5x, paragraph spacing to 2x, letter spacing to 0.12x, and word spacing to 0.16x font size; script/language exception applies [W6] | These are override-resilience checks, not mandatory default typography. |
| SC 1.4.3 AA and 1.4.11 AA [W7], [W8] | Normal text needs 4.5:1 contrast, qualifying large text 3:1, and required authored component/state cues 3:1 against adjacent colors, with the criteria's stated exceptions. Preserve visible focus and readable error/status text. |

Use a responsive viewport declaration with `width=device-width`; an initial
scale may be set where appropriate. Do not set `user-scalable=no` or restrictive
maximum scaling [B4]. Native Dynamic Type support is not established by using
`rem`; web text enlargement and actual browser settings need their own checks.

## R4. Scroll intent versus drag intent

**Default interaction is scrolling or selecting; dragging is an accelerator.**
Use a dedicated labeled drag handle instead of making every text field, row,
or scroll surface initiate drag. Keep native panning and pinch zoom on ordinary
content [A4], [B5], [O3], [O4].

For the installed dnd-kit API family, two supported approaches are:

1. **PointerSensor plus a dedicated handle:** apply `touch-action: none` only
   to that handle, never the whole list/editor. Ordinary row content remains
   scrollable. This deliberately reserves gestures beginning on the handle for
   dragging, so give it a clear affordance and an adequate target [O3].
2. **MouseSensor plus TouchSensor plus KeyboardSensor:** if scrolling should
   remain possible before a touch hold activates, dnd-kit documents a delayed
   TouchSensor with movement tolerance and `touch-action: manipulation` [O4], [O5].
   Movement beyond tolerance during the delay aborts activation. Its example
   uses 250ms/5px and a 10px mouse distance; these are library examples, not
   accessibility thresholds or validated Studio settings.

Choose one pointer/touch strategy, not overlapping Pointer and Touch activators
for the same gesture. Keep `KeyboardSensor` when providing a custom sensor list.
Verify the actual scroll/activation tradeoff on touch hardware; a synthetic
drag passing is not evidence that native scrolling feels right.

Do not attempt to enable `touch-action: none` only after a long press: browsers
resolve touch behavior at gesture start and ignore changes for that active
gesture [B5], [O3]. A delay alone therefore cannot repair an incompatible Pointer
Events scrolling policy. Also, `pan-y` alone is not equivalent to allowing pinch
zoom. Avoid whole-editor `preventDefault`, `touch-action: none`, or custom
replacement of browser scrolling.

**Provide non-drag commands for every supported drag outcome.** WCAG 2.5.7 AA
requires a single-pointer, non-drag alternative unless dragging is essential or
unmodified user-agent behavior; keyboard access alone does not meet it [W9].
For example, provide Move up/down for reordering, and a destination/position
picker if cross-parent moves or arbitrary placement are supported. Add via
an explicit button rather than requiring palette drag. A swipe-only alternative
does not solve the requirement. Drag and command paths must use the same
existing mutation/validation rules, not parallel document semantics.

Use `sortableKeyboardCoordinates` through the KeyboardSensor `coordinateGetter`
for sortable navigation [O5]. Associate `listeners`, accessible attributes,
and `setActivatorNodeRef` with the handle; attach `setNodeRef` to the sortable
item [O6]. Announce meaningful item names, position/destination, drop, and
cancellation; raw internal IDs alone are poor feedback. Preserve focus on the
moved item or a logical successor and keep it visible.

Handle cancellation, no drop target, and invalid destinations without changing
the document. If an implementation mutates during hover, cancel must restore
the pre-drag state. During a major pane change or resize, cancel safely rather
than commit using stale geometry. Use a DragOverlay where scroll-container
clipping warrants it [O5], but do not assume portaling it outside a modal works:
top-layer and inertness boundaries require deliberate placement and testing.

## R5. Safe areas, viewport height, keyboard, and focus

Use ordinary document/pane scrolling as the reliable fallback. Give flex/grid
scroll children a shrinkable minimum size and avoid multiple competing vertical
scroll surfaces on phones. A dialog can have a bounded scrolling body, but its
heading, errors, close action, and final field must remain reachable.

`dvh` tracks changes in browser UI; `svh` is a stable small-viewport alternative;
current `vh` behaves like the large viewport and can extend behind browser chrome
[B6]. Use a supported dynamic-height enhancement with a usable fallback, not an
unconditional clipped full-screen shell. Reserve room for sticky controls and
allow them to become nonsticky or less prominent in very short windows.

**Do not equate `100dvh` with "keyboard-safe."** A virtual keyboard or pinch zoom
can shrink the visual viewport without resizing the layout viewport [B7].
The `interactive-widget` viewport setting expresses a requested resizing policy
where supported, not a cross-browser promise [B4]. Start with the browser's own
focused-input scrolling. Where needed, reveal focused fields/errors within the
correct scroller, use appropriate scroll padding/margins for sticky controls,
and avoid repeated automatic scrolling that fights the user.

Use `env(safe-area-inset-top, 0px)` and the corresponding right, bottom, and left
insets when the shell needs edge-to-edge padding [B2].
`viewport-fit=cover` opts into edge-to-edge layout;
it requires inset-aware placement and should not be added without that design
[B4]. Apply inset handling once at the relevant shell edge, not cumulatively to
every nested pane. Do not substitute guessed notch, home-indicator, hinge, or
keyboard dimensions.

**Ingress/iframe caveats are material:**

- Only a top-level window has a visual viewport distinct from its layout
  viewport; an iframe's VisualViewport metrics describe its layout viewport
  [B7]. A child-frame height calculation is not necessarily keyboard clearance.
- Safe-area and host chrome interactions need checking in the actual embedding.
  Do not assume a child's meta viewport settings control the HA top-level page.
- `navigator.virtualKeyboard` is limited-availability and secure-context-only;
  taking over overlay behavior transfers layout responsibility to the app [B8].
  Do not require it or `keyboard-inset-*` for ordinary LAN HTTP operation.
- An optional VisualViewport enhancement must be feature-detected, cleaned up,
  and account for offsets/zoom; a height change alone is not a keyboard detector.
  Do not reach into or mutate HA parent-page layout to compensate.

WCAG 2.4.11 AA requires that a keyboard-focused component not be entirely hidden
by author-created content; its notes allow specified user-movable/user-opened
cases [W10]. Studio should aim higher: show the whole active control and its
context. This AA rule is not a promise that browser-created keyboards are tested.
Check keyboard use, browser chrome, and zoom independently.

## R6. Dialog lifecycle and reduced motion

**Reuse native `<dialog>` for actual editor modals.** Open with `showModal()`,
not just an `open` attribute; close through the dialog API rather than visually
hiding it. Native modal behavior supplies the top layer and makes the rest of
the containing document inert [B9], [B10], [H1]. A persistent inspector is not
inherently modal. Existing documented simulated preview sheets should remain
nonmodal relative to the editor; do not let a simulated sheet block Studio.

Follow the APG modal pattern [W11]:

- Give the dialog an accessible name, a visible touch-sized close/cancel button,
  and a sensible initial focus target. For a long structured dialog, focus a
  heading with `tabindex="-1"` rather than jumping to a field below its context.
  Do not put `tabindex` on `<dialog>` itself [B9].
- Tab/Shift+Tab stay within modal interaction; Escape closes the active dialog.
  Do not hide all exit paths, require a swipe, or assume a phone has a keyboard.
  Avoid auto-focusing a text field merely on opening a navigation/picker panel.
- Restore focus to the invoker when it still exists and is visible; otherwise
  choose the logical successor, such as the newly inserted item. Native dialog
  restoration helps [H1], but a responsive disappearing invoker needs explicit
  handling. Test nested overlays and Escape priority, especially during drag.
- Closing must not silently save, publish, or discard a draft. Preserve existing
  commit semantics. If dismissal requires a discard decision, provide a clear
  cancelable decision flow rather than trapping the user.

Keep React state synchronized with native `cancel`/`close` outcomes, and clean
up imperative effects/listeners across unmount and Strict Mode's extra
development setup/cleanup cycle [O2]. Do not let an exit animation leave an
invisible modal trapping focus. The current HTML algorithm returns early for
`showModal()` on an already-modal dialog but rejects incompatible states [H1];
some React tutorial prose describes repeated calls more broadly [O10]. Use the HTML
contract plus lifecycle cleanup, not exception swallowing.

An Ingress dialog blocks **only its containing document**, not the surrounding
HA page [B10]. This is a containment limit, not a reason to manipulate HA's
parent DOM. Newer `closedby`/declarative command features must not become an
unchecked baseline dependency just because basic dialog is widely available.
`method="dialog"` closes a form dialog; it is not Studio persistence [B9].

Use `MotionConfig reducedMotion="user"` through the installed `motion/react`
entry point [O7], [O8]. It disables Motion transform/layout animation while leaving
other values such as opacity eligible to animate. Therefore it is not a global
"all animation off" switch. Use `useReducedMotion` and CSS
`prefers-reduced-motion` for bespoke motion, smooth scrolling, and non-Motion
effects [B11]. For dnd-kit, its installed types permit `transition: null` on
`useSortable` and `dropAnimation={null}` on DragOverlay. Remove unnecessary
reorder/drop travel when reduced motion is requested while retaining immediate
position/selection feedback.

## R7. Fold information is optional enhancement

The baseline needs no fold API: it follows available host space and preserves
functionality. MDN marks Device Posture and Viewport Segments APIs experimental
and limited-availability [B12], [B13]. The W3C Device Posture draft declares the
JavaScript interface `[SecureContext]` [H2]; it is not a LAN HTTP prerequisite.

Do not confuse the user's word **folded** with the API value `folded`.
`continuous` can describe a fully open device, a closed device using an outer
screen, a nonfoldable screen, or a browser window that does not span a hinge.
`folded` describes the relevant partially folded spanning posture, not a model
name or "closed phone" detector [B12], [H2].

If a later implementation adds enhancement, feature-detect the actual exposed
API and tolerate no information. Segment geometry and CSS
`horizontal-viewport-segments`/`vertical-viewport-segments` plus
`env(viewport-segment-*, fallback)` can describe regions where supported
[B2], [B13]. Keep important controls out of a reported gap, but do not infer
geometry from posture alone, invent a hinge gap from width, or probe a native
reserved-region API from JavaScript. No unsupported API may prevent startup,
editing, ID generation, saving, or publishing.

This research does **not** establish Safari/iPhone Duo support for either API.
A responsive narrow/wide transition is not evidence of physical fold detection.
Hardware/browser verification is a separate future activity, not a reason to
block the responsive baseline.

## OSS reuse, version fidelity, and licensing

Installed package metadata and licenses were inspected; no package was added,
upgraded, or executed. Declaration inspection verifies API shape, not behavior.

| Primitive | Observed installation | Reuse decision |
| --- | --- | --- |
| React / React DOM | 19.3.1 / 19.3.1, MIT metadata | Keep existing state ownership and semantic HTML. No mobile framework fork or new state package [O1], [O2]. |
| `@dnd-kit/core` / `@dnd-kit/sortable` | 6.3.1 / 10.0.0, MIT license files | Reuse sensors, handles, sortable keyboard coordinates, and accessibility hooks. Add command alternatives at the application level [O3], [O4], [O5], [O6], [O9]. |
| Motion | 14.13.0, MIT `LICENSE.md` | Reuse selectively for continuity, with reduced-motion behavior. No Motion+ or separate animation/gesture system [O7], [O8]. |
| Native HTML dialog | Browser standard, no extra runtime dependency | Follow existing documented choice instead of adding a modal/sheet package [B9], [B10], [H1]. |

The observed peers accept React >=16.8 for core/sortable, core ^6.3.0 for sortable,
and React/React DOM ^18.0.0 or ^19.0.0 for Motion. This supports reuse intent,
not proof that all integrations pass on React 19.

**Documentation drift matters.** The dnd-kit site now redirects these packages'
documentation to `/legacy/`. Do not migrate to a newer package family to follow
an unrelated current example. Its accessibility prose mentions top-level
`announcements` and `screenReaderInstructions`; installed core 6.3.1 actually
places both inside `DndContext`'s **`accessibility`** prop, alongside `restoreFocus`
and `container`. The installed KeyboardSensor option is **`coordinateGetter`**.
Those declarations take precedence over stale examples. The installed
`motion/dist/react.d.ts` re-exports the relevant Framer Motion APIs, so use the
existing `motion/react` package entry rather than adding a second direct package.

Local declaration evidence:

- `node_modules/@dnd-kit/core/dist/components/DndContext/DndContext.d.ts`
- `node_modules/@dnd-kit/core/dist/sensors/keyboard/KeyboardSensor.d.ts`
- `node_modules/@dnd-kit/core/dist/components/DragOverlay/DragOverlay.d.ts`
- `node_modules/@dnd-kit/sortable/dist/hooks/useSortable.d.ts`
- `node_modules/motion/dist/react.d.ts`
- `node_modules/framer-motion/dist/index.d.ts`

Retain the existing MIT notices and license texts for reused software. Existing
Lucide attribution remains ISC; existing Konsta-derived material attribution
remains as recorded in `THIRD_PARTY_NOTICES.md`. This research introduces no
copied library implementation or Apple assets/fonts/SF Symbols. Native HTML is
a platform capability, not a license to copy third-party example applications.

**Follow:** documented React/Motion/native-dialog choices and relative Ingress
URLs; preserve data-only configuration and save/publish/conflict semantics.
**Deliberately adapt:** native HIG layout principles into CSS-space-driven web
behavior, choose 44 CSS px targets, and supplement drag with explicit commands.
**Do not rearchitect:** native clients, the Core integration, persistence,
protocol/schema, or the app into a mobile UI framework. Actual compatibility
with current Studio structure remains the parent's inventory responsibility.

## Evidence for M1/M2/M3/M4/M6 and verification handoff

The brief names **M1, M2, M3, M4, M6** without their canonical definitions.
This document supplies the evidence below for those acceptance items; it does
not redefine their IDs or mark any implementation criterion passed. The parent
must map these evidence areas to its acceptance matrix.

| Evidence area | Source-backed decision | Required implementation evidence, not performed here |
| --- | --- | --- |
| E1: responsive/full control | R1, A1-A3, W1, O1 | Parent capability inventory exercised in compact/intermediate/wide arrangements; draft, selection, and active task survive resizing. |
| E2: host/preview independence | R2, repository constraints | Cross-product of narrow/wide hosts and different manually selected preview targets; neither selection nor document changes on host resize. |
| E3: touch and non-drag access | R3-R4, W2-W4, W9, B5, O3-O6 | Effective 44px targets, native scrolling from ordinary rows, deliberate handle activation, move/add alternatives, cancellation, keyboard and announcement behavior. |
| E4: accessibility/keyboard/dialog | R3, R5-R6, W5-W8, W10-W11, B7-B10 | Zoom/reflow/spacing, short-height input visibility, dialog focus loop/Escape/restoration, reduced motion, actual touch keyboard and assistive-technology checks. |
| E5: compatibility and honest claims | R2, R7, OSS section | Ingress/LAN HTTP fallback without optional APIs, no new dependencies or real-device actions, existing document and persistence behavior preserved. |

Suggested **illustrative CSS viewport widths**, not physical device measurements
or required breakpoints: **320, 360, 390, 430, 600, 768, 820, 1024, 1280px**.
Include a short-height landscape case, continuous resize across each chosen
breakpoint, desktop 200%/400% zoom, text-spacing overrides, and both narrow and
wide Ingress container arrangements. A height-reduced viewport is a useful
stress test, **not** an on-screen keyboard simulation with proven fidelity.

For each layout class, use a representative document with long labels and enough
items/fields to scroll. Exercise every operation from the parent's inventory,
including invalid input, errors, dirty drafts, conflicts, and save/publish
separation. Resize while a field is edited, an overlay is open, and an item is
selected; cover safe cancellation during drag. Measure hit areas and actual
overflow, not only screenshot appearance.

Future automated verification should use the repository's `npm test`,
`npm run build`, and focused Playwright checks on port 4801 with isolated
`test-results/studio-data`, never the user's development data. Production
packaging changes require the documented container smoke path. Actual mobile
Safari/Ingress keyboard behavior, VoiceOver, browser chrome, and physical Duo
posture need distinct runtime evidence; desktop browser emulation cannot certify
them. No tests, servers, deployments, or device/HA mutations were run here.

**Confidence:** high in the quoted principles, WCAG distinctions, installed
API shapes/licenses, and the reuse recommendation; moderate in the proposed
interaction fit pending the parent's capability inventory; no runtime confidence
claim for browser/device behavior.

**Open issues, not blockers to the responsive baseline:** canonical acceptance
ID mapping; pane thresholds after content/zoom checks; touch activation tuning;
actual Ingress iframe keyboard/focus behavior; targeted Safari/iPadOS versions;
optional fold API availability and physical posture behavior. There is no
blocking research question requiring a user decision.

## Sources

Apple references are native-platform guidance. W3C Understanding documents
explain the linked normative [WCAG 2.2 Recommendation][W0]; APG is interaction
guidance. MDN and OSS docs are implementation references, not runtime proof.
Online documentation can change independently of installed package versions.

[A1]: https://developer.apple.com/design/human-interface-guidelines/layout.md
[A2]: https://developer.apple.com/design/human-interface-guidelines/split-views.md
[A3]: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo.md
[A4]: https://developer.apple.com/design/human-interface-guidelines/gestures.md
[A5]: https://developer.apple.com/design/human-interface-guidelines/accessibility.md
[W0]: https://www.w3.org/TR/WCAG22/
[W1]: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
[W2]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[W3]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
[W4]: https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html
[W5]: https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html
[W6]: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
[W7]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[W8]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[W9]: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
[W10]: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
[W11]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[B1]: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries
[B2]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env
[B3]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/any-pointer
[B4]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
[B5]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action
[B6]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length
[B7]: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
[B8]: https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API
[B9]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
[B10]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
[B11]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
[B12]: https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API
[B13]: https://developer.mozilla.org/en-US/docs/Web/API/Viewport_segments_API
[H1]: https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
[H2]: https://www.w3.org/TR/device-posture/
[O1]: https://react.dev/learn/preserving-and-resetting-state
[O2]: https://react.dev/reference/react/useEffect
[O3]: https://dndkit.com/legacy/api-documentation/sensors/pointer/
[O4]: https://dndkit.com/legacy/api-documentation/sensors/touch/
[O5]: https://dndkit.com/legacy/presets/sortable/overview/
[O6]: https://dndkit.com/legacy/presets/sortable/use-sortable/
[O7]: https://motion.dev/docs/react-accessibility
[O8]: https://motion.dev/docs/react
[O9]: https://dndkit.com/legacy/guides/accessibility/
[O10]: https://react.dev/learn/synchronizing-with-effects#controlling-non-react-widgets
