# W3 canvas design notes

Status: owner-review design, not implemented product behavior.
Artifact: [w3-mockups.html](w3-mockups.html), self-contained, designed at 1440 CSS
pixels, with labelled M1-M7 sections and a 390px browser-sheet variant in M2.
Only the mockup and this document are owned by this design task.

## Evidence and boundaries

The binding contract is [flows-canvas-feedback.md](../../flows-canvas-feedback.md),
with [flows-canvas.md section 1](../../flows-canvas.md#1-decisions-and-approved-references)
governing unchanged behavior. Source inspection covered the canvas README,
CanvasBlock, observations, FlowCanvas, canvas.css, PortGlyph, BlockIcon, theme,
and the LogicFields Preview aside / LensChooser.

The visual references are [the owner's HA window](feedback-w3-canvas.png) and
[the overflowing selected block](feedback-w3-overflow.png). The charcoal
surfaces, cyan selection, 16px dot grid, compact Lucide-style line icons, and
typed socket shapes are retained. The HTML uses locally drawn inline SVG icons;
it imports no fonts, images, libraries, or network assets. Production should
continue using the existing Lucide dependency, not copy these illustrative
paths over it. No third-party artwork or new dependency is bundled.

All grocery values are **illustrative host-observation fixtures**, not recovered
household data or evidence of a service call. The recognizable graph vocabulary
is `todo.demo_groceries`, Text, Service Response, Choose Entry, Go Into, This Item,
Rows, and Flow. The seven illustrative rows are Milk, Eggs, Bread, Apples, Rice,
Coffee, and Dish soap. Their subtitle and identifier fields stay consistent
between the peek, full comparison, and Raw disclosure. Office PC is the
requested separate Raw State / condition example, not a new block in the
grocery flow.

The M7 screenshot crops lower operands and part of the root. The drawing
retains the visible connection family and completes three illustrative
This Item operands for Row Id, Row Title, and Subtitle. Their `uid`, `summary`,
and `description` paths, and tangled starting positions, are **design
assumptions**, not recovered payloads or exact screenshot coordinates. M7
therefore demonstrates the desired arrangement, not the engine's output or
a measured crossing count.

No configuration, source code, user data, native app, or Core integration is
changed. No server, publishing action, credential, or device service is used.
The phone frame is browser geometry, not an iOS emulator or native validation.
No new ActivityKit, APNs, Live Activity, navigation, or nested-drag/drop
capability is implied.

## M1: annotations and selected block anatomy

| Part | Geometry and content |
| --- | --- |
| Card | Existing 190px width supported; 220px illustrated for a little more room. 11px corner radius; content-driven height. |
| Header | At least 48px; a 25px block-icon tile, flexible title column, and separate 32px peek button. No nested buttons. |
| Custom label | 12px semibold; one visual line with ellipsis. Use the complete value in the accessible name and inspector. |
| Generated name | 10px secondary line whenever there is a custom label. It remains visible and is not editable. |
| Root marker | Secondary metadata, not an unshrinkable item competing with the label and header controls. |
| Description | 11px / 16px line height, two-line clamp with long-word wrapping. No space when absent. Full text in the inspector. |
| Ports | Existing names and descriptor-driven socket glyphs. 32px illustrative rows; minimum 44px on coarse pointers. |
| Selected actions | Four equal grid cells: Move, Inspect, Rename or describe, Delete. Icons remain 16px. See M5 sizing. |

Use the same annotation editor from the selected block's pencil and from the
inspector. The inline variant expands **inside** the selected block, not over
its input sockets. It may temporarily make the card taller; measurements and
wire positions must follow. The inspector remains 292px wide.

Label and Description are optional fields. Trim on submit; an empty trimmed
value means remove that field, and both absent means no annotation object.
Enforce the contract's 60 / 280 character limits and reject control characters.
Do not silently cut a pasted value to fit. `maxlength` in the illustration is
not the complete validation strategy: the implementation must report rejected
paste/input and preserve editable text until corrected. The shared validator,
not the browser's UTF-16 counting rule alone, decides validity.

**Contract ambiguity to resolve in implementation:** the contract rejects
control characters, which includes CR/LF, even though a description visually
wraps. This design does not authorize multiline stored notes. Use soft wrapping;
reject pasted line breaks with "Use a single paragraph; line breaks are not
supported." The multiline-sized field is for viewing long text, not permission
to store newline controls.

Apply details submits label and note together as one `annotate` transaction.
Cancel or Escape discards only this editor's unsubmitted text. Neither action
saves the document or publishes. Invalid input stays visible with a field-linked
error, and Apply details is refused. Clear errors when the relevant input is
corrected. On success, return focus to the pencil or inspector origin and
announce "Block details updated." Undo restores both previous fields together.
Selection changes must not silently apply or lose an open annotation draft:
offer Apply / Discard / Stay if it contains unsubmitted changes.

Example accessible names: "Select Office PC, Raw State"; "Rename or describe
Office PC"; "Inspect Office PC"; "Show data peek for Office PC, Raw State".
The existing ordinal disambiguator remains available for duplicate names.
Editing annotations never changes lowering, simulation, source bindings, or
published native configuration.

## M2: one peek, at three content scales

Desktop peek anatomy: selected-block anchor, 8-12px visual gap, 320-380px
preferred width, 12px radius, title plus generated name, explicit Close, Inputs,
Result, and a footer containing truncation count / Compare in full. Place it
outside the scaled board layer so text and controls stay normal CSS size at
any canvas zoom. Prefer the side with space; flip and shift within the visible
canvas/session bounds. Do not cover the triggering header or open beneath
Preview. If neither side fits, place it above/below, not outside the viewport.
Limit body height to the available viewport space, preserving title and footer.

Clicking a block header selects it and opens its peek. This **deliberately
changes** today's coupling of selection and inspector: the inspector is still
available from Inspect and the toolbar, but is not forced open by every click.
Opening a peek does not close an already deliberately opened inspector.
Do not open a peek merely because keyboard arrows move selection.

At most one peek exists. Selecting a different block dismisses/replaces it.
Dismiss, Escape, or outside activation hides it without clearing selection.
The eye button remains on the header; the selected header or eye can reopen
it. Do not reopen on a live update, hover, pan, or focus-only selection change.
Dismissal is session UI state, not document metadata.

| Content | Compact presentation |
| --- | --- |
| Scalar | Complete short text, number, Yes / No, Empty text, or Null. No JSON quotes. A long string is at most two lines, with Compare in full for the complete text. |
| Record | Named fields as field/value pairs. At most four fields and two displayed nesting levels; deeper values become a type/count summary. Never substitute a synthesized value for an unanswered field. |
| List | Total observed count plus the first three items in source order. Prefer row title / primary field; otherwise use the shared formatter, not `[object Object]`. |
| Rows | Exactly the first three rows in a peek, each with a title and optional subtitle. `+N more rows` is total minus shown, never an approximate count. |
| Inputs | Same formatting and limits as Result. Name every port; large input lists also use three previews and Compare in full. |

The scalar Text example correctly says **No input ports**, rather than inventing
an entity input for a literal. The Rows example explicitly says **observed
item**: one host sample of Row Id / Row Title / Subtitle does not supply a
seven-item input execution history. A peek is not a new evaluator or trace.

Format all visible **and accessible** value text with `value-format.ts`,
including inline chips, tooltip descriptions, records, nested list summaries,
full-view cells, Outline descriptions, and accessible names. Raw serialization
is restricted to the explicit full-view Raw JSON disclosure.

Provenance is per observation. Uniform values may share an Inputs or Result
badge. If a section has mixed sources, put Live / Pinned / Scenario beside
each value; do not claim a uniform source. The pin and flask icons supplement
text, not replace it. A dashed purple block outline occurs only for
`scenarioPinned`, not all downstream values carrying scenario provenance.
The mockup's dashed Rows card is an explicit direct-pin fixture.

| State | Required distinction |
| --- | --- |
| Known | Show the formatted observed value and source, including false as No, zero as 0, an empty string as Empty text, and empty rows as 0 rows. |
| Unavailable | Show Unavailable, the source, and hatched treatment. Do not substitute No, zero, an empty collection, or configuration literals. |
| Can't tell | Show Can't tell for the unknown condition state, not No. Keep the source and hatched treatment. |
| Kept | Only for a host-supplied output with `kept: true`. Show the current unanswered state **and** Kept beside the retained value. Do not relabel it as a fresh known answer. |
| Absent observation | Show Not observed in the peek/full view. Keep the existing port's observation chip absent. No provenance badge can be invented. |

A *known* Raw State string `unavailable` is text, not the unavailable observation
state. Disambiguate with a Text label in the full presentation. In a check such
as state in `on`, that literal does not become Can't tell. Do not add Loading
or freshness claims unless the host contract explicitly supplies them.

**Desktop keyboard/focus:** preserve the existing roving header / port model.
Enter still enters the block controls; reach the eye by arrow traversal and
activate it with Space/Enter. Space on the header can use the normal button
activation to open the peek. Pointer selection must not steal focus into a
live-updating value. Keyboard activation of the eye transfers focus to the peek
heading or Close; use a nonmodal dialog, not a modal trap. Tab follows the peek's
controls and returns to the canvas navigation sequence. Escape closes only the
peek and restores the eye/header; pointer outside dismissal does not steal
focus back from the newly clicked control. Keep the selected anchor mounted
under canvas windowing. If it is removed, close and return focus to the nearest
remaining header or Add Block.

**Phone-width variant:** below 600px, replace the popover with the existing
Base UI modal bottom-sheet primitive. Width 100%; 18px top corners; 16px content
padding; 44px Close and comparison targets; safe-area bottom padding; at most
80% of the viewport's available height. Title/Close and footer stay visible;
the body scrolls. A visible drag handle is an orientation cue, not a required
dismiss gesture. Close, Escape, and a deliberate backdrop action dismiss.
Focus is trapped, the canvas beneath is inert, and final focus returns to
the triggering header eye. Do not mount Inspector and Peek sheets together.

## M3: comparison, not another editor

Use the existing Base UI Dialog. Target width 1120px, capped by the available
viewport minus 40px; at most the available viewport minus 40px tall. Inputs
are a 310px left column and Result takes the remaining width. On narrow screens,
stack Inputs above Result with clear section headings. Tables may scroll
horizontally inside their own region, never the entire modal.

The anatomy is title / generated name, Close, search and column filter, matching
count, formatted Inputs / Result, Raw JSON disclosure, and read-only footer.
Rows use semantic table headings Row Id, Row Title, Subtitle. Records use named
fields; scalars remain scalars, not one-cell tables. Preserve source order;
no sorting or row matching is silently inferred. Search/filter scopes itself
to **result rows**, counts matches against the actual captured total, and shows
"No matching rows" separately from a truly empty result.

The illustration shows the seven known rows in full. Production must not call
truncated host observations a full result: show "Host supplied N rows; total
unavailable" if that information is available, or explain the missing full data.
Do not synthesize missing rows or query HA from this view.

Capture the currently supplied observation when Compare opens so inputs and
result do not race while the user reads. Label it captured; do not claim a
shared evaluation/run identity that the DTO does not provide. It is a read-only
local copy, not a pin. Host withdrawal or invalidation of the graph closes or
clearly invalidates this captured comparison, never presents it as fresh Live.
This freshness/withdrawal policy is an integration decision to align with the
host, not a new observation DTO field added by the design.

Raw JSON is an explicit, initially closed disclosure/toggle with visible Off/On
state. JSON is selectable read-only text, never an editor. The raw areas show
observed inputs and result, not a document dump, credentials, internal scope
objects, or invented execution trace. The illustrative input raw panel is a
label-keyed projection of three supplied values, not the exact CanvasObservations
envelope; production may label it "Input values" to avoid implying port IDs.
Search changes the formatted rows, not the captured raw payload.

Initial modal focus goes to its heading (`tabIndex=-1`), then Tab reaches search.
Use semantic table reading/navigation, not a custom interactive grid. Escape
or Close returns focus to Compare in full in the originating peek. On phones,
replace the peek sheet with comparison instead of stacking dialogs; close
comparison restores the peek. If the origin no longer exists, restore the
nearest surviving canvas control. Announce filtering counts politely, not
every cell or live update. No Save, Publish, service execution, pin creation,
or hidden changes occur here.

## M4: port tooltip

Use a 240-320px tooltip with 12px padding, 10px radius, and collision-aware
placement. Include block / port name, static type, formatted compact value,
source, and kept/state qualifiers when supplied. The illustrated Choose Entry
record reads "Items: 7 items; Milk, Eggs, Bread; +4 more items", rather than
the current truncated serialized object.

Show on hover after a short delay (300ms proposed) or immediately on keyboard
focus. Keep it open while hovered over either trigger or tooltip. Escape hides
it; it stays dismissed until focus/hover leaves and returns. Connect it using
`aria-describedby`; do not rely on an HTML `title` attribute as the only
accessible tooltip. It contains no links or buttons and never traps focus.
Clicking a socket still opens connection authoring; it does not become a peek
action. On touch, the block eye is the accessible alternative.

Known static record sockets retain braces even if an observation happens to
contain a list. A true list descriptor keeps doubled lines plus the item-type
glyph; no runtime sample changes a port's compatibility. Text remains a T in a
square, entity a tag, number a hash in a circle, and a condition a check diamond.

## M5: fit at 190px and measured canvas edges

At 190px border-box width, the selected row has 188px internal width. Desktop
uses 6px padding on each side and three 4px gaps, leaving four **41px** cells.
Buttons are at least 32px high. At 220px, the same grid gives 48.5px cells.
No minimum-content text can force the grid wider. On coarse pointers, 5px side
padding and zero gap leave four 44.5px cells at 190px, with 44px target heights.
The icon-only controls must have accessible names and labelled hover/focus
tooltips. Delete keeps the existing affected-wire confirmation and Undo.

The header also uses `minmax(0, 1fr)` / `min-width: 0`. Its peek button cannot
push the label, generated name, or root marker outside the card. Do not solve
overflow with a hidden parent that clips socket glyphs or focus rings.

Measure actual card height, label/note height, port positions, and selected
chrome. Reserve at least 32px beyond the outer socket/focus bounds on all sides
of the scrollable board, and bottom clearance for the navigation bar (96px
proposed). Include the rightmost root and negative/moved positions in scroll
extents. Fit all uses the **current** viewport after palette/inspector/Preview
layout, not the original window width. Use both width and height in fit
calculations; retain scroll/pan and Fit selection for graphs too large to read.
Changing selection or annotating a block cannot make its root actions
unreachable. Keep viewport navigation overlays out of measured card interiors.

Existing Move remains a keyboard alternative to spatial dragging: arrows move
8px, Shift+arrows 32px, Enter commits, Escape cancels. Inspector coordinates,
Outline, and Tidy Up remain available. This design does not add nested
reparenting or change graph scopes/ports.

## M6: session Preview rail

Expanded width stays **310px**, matching `logic-fields.css`; collapsed width is
**44px**, reclaiming 266px. The toggle belongs to the CanvasSession layout
outside the selected block and outside the Inspector. Expanded it is named
"Collapse Preview"; collapsed it is named "Expand Preview" with a visible
Preview label and panel icon. Both expose `aria-expanded` and `aria-controls`.

The rail is present with no selection, and with palette, inspector, outline,
and value peeks. Collapsing changes only presentation: preserve lens, temporary
Try with settings, pins/scenarios, observation delivery, and selection. Do not
unmount the observation producer merely to hide its controls. Do not
automatically choose Stand-in, create a component, or make logic belong to a
tile. Lens choices continue to be document-driven.

Move keyboard focus to the corresponding rail/header toggle when its current
container collapses. Hidden controls are removed from the accessibility tree
and tab order. Remember the choice in browser localStorage with guarded
reads/writes; if unavailable, keep an in-memory preference and visibly explain
that it will not be remembered if the repository's notification pattern
requires it. Storage failure must never block canvas work.

**Important integration boundary:** the current Preview aside also contains
conflict and invalid-layout warnings. Collapsing it must not hide these notices
or the way to resolve them. Keep them in a persistent session-level status /
problems surface, and retain all local edits on conflict. This is tightly
coupled to collapse, not permission to redesign save/conflict behavior.

The host currently stacks Preview below the canvas below 700px, whereas canvas
sheets begin below 600px. Preserve the existing stacking breakpoint unless the
orchestrator approves a host change: a collapsed mobile Preview becomes a
44px **horizontal** rail with the same labelled control, not a 44px sidebar
that steals phone width. The 600-699px transitional layout must be checked.
The mockup's compact embedded session cards reflow for document viewing; the
390px M2 scene is the explicit product sheet illustration.

## M7: tidy semantics and feedback

The target drawing orders the request, Steps 0, Steps 1, and output lanes to
agree with their root sockets. Row Id, Row Title, and Subtitle sources follow
the destination's port order. Nodes remain 190px wide. Layer gaps leave space
for bends; rows use their measured height plus a minimum 32px vertical gap.
This is visual guidance for the contracted synchronous, deterministic
Sugiyama-style engine, not a second layout algorithm.

The before/after diagrams share the same ten illustrative node definitions and
nine edges. The three Rows wires are not swapped to reduce crossings; their
source block positions move. Tidy must change only `position`, preserve all IDs,
payloads, annotations and port assignments, and never raise `countCrossings`.
There is no claim that every valid graph can be drawn without crossings.

Keep selection and focus on Tidy Up after running it; announce a concise result
from actual measurements. If better, report the actual crossing change, not an
invented score. If a candidate is worse, keep the better layout and explain
that fact. If no improvement is possible, say so without claiming failure or
promising zero. One Undo restores the previous positions. Reduced motion skips
any position animation. Updating board extents and Fit all is separate from
rewriting node positions; do not reset user zoom without an explicit action.

## Token mapping and light/custom themes

The HTML puts all colors in root-level semantic variables and maps them to
`--w2-*`. Dark examples use the repository's `#111111` background, `#1c1c1c`
card, neutral secondary/field surfaces, `#e1e1e1` text, cyan focus, and existing
wire seed family. Slightly stronger muted text/borders are illustrative
readability choices, not a proposal to replace `deriveTheme` or `ensureContrast`.
The outer document remains transparent for embedding; only mock surfaces
provide a background.

In product, derive from the existing HA theme. Do not hard-code a new dark
popover/tooltip color into source. Use `--w2-card` / `--w2-field`, ink/muted,
line, selected, and `--w2-canvas-focus`; native light fallback ground/card are
`#fafafa` / `#ffffff`. Light wire seeds stay number `#1765b8`, text `#8a5300`,
condition `#26703c`, time/pin `#7650a5`, list `#006d77`, and entity/record
`#596273`, with existing contrast correction.

Verify text and socket glyphs at 4.5:1 and focus at 3:1 against canvas, card,
field, selected, and hover surfaces, including custom HA themes. Pins have text
and icons; unanswered values have text and hatching; selection has a ring.
Forced colors must preserve shape, borders, and text instead of relying on
color or shadows. At 200% text zoom, allow popover/modal bodies to grow/scroll,
keep Close and Compare reachable, and do not shrink typography to fit.

## Platform guidance versus Studio decisions

The requested Apple HIG skill was not available in the checkout or the
installed skill locations inspected; it was not silently replaced or claimed
as loaded. Official [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
guidance was read directly on 2026-11-20 instead.

Apple guidance supports a scoped contextual sheet, a clear way to dismiss it,
one sheet at a time, larger text, sufficient contrast, and redundant
non-color cues. It does **not** prescribe this Studio's 600px breakpoint,
190px blocks, 44px CSS targets, 310px Preview pane, observation schema,
keyboard graph navigation, or metadata persistence. Those are explicitly
Studio/web choices based on the existing implementation and this contract.
No physical Apple hardware, native sheet, or screen-reader run is claimed.

## Implementation acceptance handoff

These are acceptance criteria for the implementation owner, not passing runtime
claims from a mockup:

| ID | Observable requirement |
| --- | --- |
| W3-M1 | Label + generated name + two-line note render together. Pencil and Inspector edit the same annotation; clear/invalid/60-280 limits, control characters, Cancel, and one-step Undo preserve the contract. |
| W3-M2 | Click opens one anchored peek; dismissal preserves selection; eye reopens. Inputs and Result use observed values and correct source badges. No absent/unknown value is fabricated. A 7-row result shows exactly 3 rows and +4 more. |
| W3-M2-mobile | At 390px, modal bottom sheet has reachable Close and comparison action, 44px controls, body scrolling, safe-area padding, focus restoration, and no competing modal. |
| W3-M3 | Comparison shows formatted inputs left/result right, semantic headers and 7 rows. Search Milk gives 1 of 7; a nonmatch gives 0 of 7; clear gives 7 of 7. Raw is absent from visual/accessibility presentation until explicitly opened. |
| W3-M4 | Hover and keyboard-focus descriptions are formatted, source-aware, dismissible, and noninteractive. Socket activation still edits connections. Raw State literal text and unknown observation state stay distinct. |
| W3-M5 | At 190px and 220px, every selected action's rectangle is inside the card; coarse-pointer targets are at least 44px. Fit/reveal includes the complete root, sockets, focus ring, and bottom actions with Preview expanded or collapsed. |
| W3-M6 | With no selection, Preview can expand/collapse, reclaim 266px on desktop, retain producer/lens/state, restore focus, persist guarded preference, and expose conflicts/warnings even while collapsed. |
| W3-M7 | The illustrative topology can be laid out without crossings; real layout never increases measured crossings, changes only positions, respects actual block/port geometry, and can be undone. Nonplanar/no-improvement cases have truthful feedback. |

The HTML is a design sheet. Its local interactions demonstrate peek
close/reopen, result search/filter, Raw disclosure, and Preview collapse/expand.
Compare links navigate to M3, not to an implemented product dialog. Other
controls show proposed states. It deliberately writes no storage and runs no
service. Actual browser, keyboard, light/custom-theme, compiler, persistence,
and native-compatibility verification belongs to the implementation/verifier
lanes.
