# Configuration Studio: product design and acceptance specification

## 1. Product intent and scope

Build a **visual authoring studio for a configurable Home Assistant companion interface**, not an administrative dashboard and not a native emulator. The central experience is a device-shaped, interactive rendering of the current configuration. A persistent project hierarchy, a searchable component palette, and a contextual inspector make the document understandable without manipulating raw JSON.

The studio should feel closer to a carefully made layout tool than to a collection of settings forms: quiet warm surfaces, a confident ink-colored project panel, generous working space, precise selection feedback, and one obvious publication action. The rendered app is the work; editor chrome should not compete with it.

This specification covers editor UX, component and configuration requirements, synthetic demonstration content, browser preview behavior, and acceptance criteria. Field names below are a **proposed design contract**, not a claim about an existing native-home import format. The integration/schema owners must map these requirements to their supported contract. Installation, authentication transport, HA orchestration, native implementation, and backend architecture are outside this document.

**Fidelity contract:** permanently label the canvas **“Interactive browser preview”**. Device details expose **“Layout approximation; not an iOS emulator.”** Fonts, glass, system chrome, media, sheet physics, Dynamic Island allocation, fold geometry, and 3D surfaces are approximations. A successful browser check does not establish native accessibility, physical-device behavior, ActivityKit delivery, or hardware fidelity.

No native-home code or iOS application is to be changed as part of this design deliverable.

## 2. Research basis: what to preserve, and what not to copy

UI research used public `SFenton/native-home` at commit `b6a02f0d13806b694ee4b34691b1db524f5e7e7b`, through the GitHub CLI. Only UI source, UI fixtures, and screenshots/mockups were inspected. Several older SwiftUI feature files now contain helpers; the corresponding `UIKitPort` UI implementations were inspected where necessary. Mockup reviews and comments are historical evidence, not independent proof of current behavior.

| Evidence | Observed mobile UX | Studio consequence |
|---|---|---|
| [Home UI][src-home], [Home layout helper][src-home-layout], [status rail][src-status] | A compositional overview: status chips, weather, conditional guest controls, and camera cards. Chip taps open details; camera taps open a viewer. Fold layouts assign sections to usable regions. | Model sections, order, region affinity, bindings, and destinations as configuration. Do not write a special renderer branch for “Home,” “Guests,” or named entities. |
| [Shell UI][src-shell], [page chrome][src-page] | Each section retains its navigation stack and scroll position. Compact tabs and wider navigation use different presentations. Quick Links and Profile are recurring shell actions; pane-specific actions retain their own group. | Navigation state belongs to stable tab/route IDs. Chrome descriptors need scope, grouping, priority, title, symbol, and action. Changing device presentation must not reset navigation. |
| [Settings UI][src-settings] | Grouped rows with icons, subtitles, headers/footers, toggles, sliders, links, conditional sections, account actions, and a wide list/detail presentation. Rows have explicit accessibility labels and hints. | Settings is composed from sections and typed rows, not a bespoke hardcoded screen. Provide detail-pane placeholder, compact push fallback, and readable opaque backing. |
| [UI action specification mapping][src-actions], [action/navigation tile proposal][mock-tiles] | Three distinct behaviors: perform an action, navigate, or display state. Action feedback is momentary, optimistic, or tracked; confirmation, selection, unavailable, and error states are explicit. The proposal distinguishes action discs, navigation chevrons, and flat read-only faces. | Preserve this taxonomy. Separate accessory controls from the navigation hit region. Do not render every card as a button. Proposal styling is inspiration, not a requirement to reproduce all historical tradeoffs. |
| [Carousel layout helper][src-carousel], [carousel mockup][mock-carousel] | Data-backed, paged recipe cards with width-dependent columns, different row counts, page controls, and larger accessibility-size cells. The source has application-specific five-page defaults. | Configure item templates, rows, columns, and paging. Derive page counts from data; five is a fixture choice, never renderer logic. |
| [Filter mockup][mock-filter], [sort mockup][mock-sort] | Filters and sort open local draft forms with Cancel, Apply, and Reset. Apply is unavailable until values differ. Filter counts represent narrowing constraints, not ranking weights. Large text replaces cramped segments with a named picker. | Bind chrome actions to a particular collection. Show draft versus applied state; Cancel must not mutate results. Keep view-specific controls on that view. |
| [Profile UI fixtures][src-profile], [Your Summary mockup][mock-profile] | A profile-led summary sheet with people/presence and configurable related sections; guest/empty/error variants; initials when no avatar exists. Related views can use sheet-local tabs or a larger-text menu. | Provide profile header, person rows, capability-aware actions, and a reusable tabbed modal. Identity and privileges come from data, never fixture names. |
| [Camera viewer UI helper][src-camera] | Snapshot operation has saving/saved/failed states; wide viewers can separate media and controls. | Show honest media and action states. A browser demo must not claim “Saved to Photos,” a working camera connection, or native playback unless it actually performs the equivalent supported operation. |
| [Island SwiftUI][src-island], [Lock Screen SwiftUI][src-lockscreen], [widget surface placement][src-widget] | One job can become a problem card. Compact uses a recognizable leading glyph/progress and brief trailing information; minimal stays recognizable; expanded keeps the camera center clear. Limited-width compact presentation omits trailing content. | One activity model drives all four requested variants, including limited-width behavior and a related-detail route. Surface differences are templates, not unrelated canned screenshots. |
| [Normal-size weather screenshot][shot-large], [AX2 weather screenshot][shot-ax2] | Both inspected image files are 368 x 800 pixels. The normal view has a large title, rounded dark module, dominant temperature, restrained separators, and forecast paging. The AX2 view wraps the long condition, grows vertically, and presents fewer forecast items at once. | Use a clear typographic hierarchy and adaptable modules. Preserve full text through reflow rather than shrinking it. These image dimensions are not device specifications. |
| [Home mockup][mock-home], [fold/iPad proposal][mock-fold] | Mockups cover offline, loading, long text, fold and larger-text states. Fold proposals identify the danger of treating all wide space as one uninterrupted rectangle. They also explicitly lack physical-device verification. | Test states and reserved regions, not just a beautiful default screenshot. Never promote proposal measurements to verified hardware dimensions. |

Important distinctions:

- The sampled shell deliberately draws dark over a dimmed house backdrop while sheets follow system appearance. **The warm studio is separate from the preview theme.** Offer a source-inspired dark demonstration theme and a light/system variant; do not make a permanently dark app a universal renderer rule.
- Native-home's “glass” terminology does not mean every content card uses Liquid Glass: the Home mockup describes flat tinted content fills and glass navigation. Keep this separation in the new design.
- Home helper behavior and some mockup prose disagree about fully-open single/two-column layout; the carousel mockup also contains conflicting old empty-state/header descriptions. Use the explicit policies in this document, not incidental mockup text as the contract.
- Known source constraints are not desirable defaults: dense unscaled grids can clip accessibility-size text; a ticker is not a substitute for readable text. This studio should expose and prevent those failures.
- Some source tile interactions allow immediate lock/door actions. This studio deliberately defaults safety-sensitive presets to explicit confirmation; simulation never operates a real device.
- Reference assets are linked only. Do not copy house photographs, avatars, screenshots, icons, source mockup assets, or other copyrighted artwork into the project. Make original neutral demo illustrations and use appropriately licensed icons. Apple fonts/SF Symbols must not be redistributed as web assets without appropriate rights.

## 3. HIG basis and product decisions

### Runtime comparison boundary (current correction round)

The preinstalled UIKit app was opened on the user's MacBook under its simulator
capacity reservation. Fourteen synthetic gallery surfaces were captured:
Home, weather card, Security System, Contact Sensors, camera viewer, Living Room,
Custom Lights, Climate, profile summary, profile tab launch, Settings, Food,
Media, and Chores. An existing native scroll diagnostic also drove the actual
Home scroll view and was recorded. No source, installation, account, permission,
or real Home Assistant service was changed. The reserved simulator was stopped
after observation.

These are **actual UIKit runtime fixtures**, not screenshots of authenticated
production data. The Mac source checkout was
`45c4cf70ad9f10872611bebe08313d8634cdc62a`; the installed binary's commit was
not established. The Mac Accessibility helper reported `trusted:false`, so
interactive touch/keyboard sequences and new Duo poses were not validated.
The scroll diagnostic proves programmatic native scrolling, not a touch gesture.

The renderer now separates production-like component content from Studio
diagnostics: data provenance and simulation notices belong to editor status and
feedback, not badges layered over every tile. Alarm panels, camera controls,
weather destinations, and sheet-local back/title chrome are data driven.
Large-title collapse is a browser scroll-progress approximation; Duo's observed
side-control presentation retains its inline title. Neither is a claim of
identical UIKit physics, fonts, or glass.

Guidance was routed using the exact task text with `apple-hig`, release **2026-09-27**, Apple source snapshot **2026-09-12**. All routed references were read; the audit is in section 14. The short quotations below are operative clauses from those distilled references. The right column is this product's application, not an additional Apple rule.

| Source clause | Application in this studio |
|---|---|
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): “Choose layout from size classes, not device type/idiom or orientation” | The renderer resolves available space, size class, text size, and reserved regions. A device name chooses a test profile, not a separate page implementation. |
| [Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo): “Preserve functionality, element state, hierarchy, and access across displays/poses.” | Fold/rotation keeps the active route, selection, tab stacks, form drafts, modal, and meaningful scroll anchor. |
| [Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo): “Arrangement views lay out content, not navigation; put navigation split views and tab views around them.” | Region layout may rearrange a page; it must not manufacture a navigation transition. |
| [Materials](https://developer.apple.com/design/human-interface-guidelines/materials): “Don’t use Liquid Glass in the content layer.” The reference explicitly excepts transient interactive controls such as an activated slider or toggle. | Use opaque/standard-material-like content surfaces; restrained translucency is for navigation and temporary controls. CSS blur is not native Liquid Glass. |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): “Make sure your layout adapts to all font sizes” | Grow rows, wrap titles, reduce columns, and turn cramped segmented choices into a labeled picker. Do not shrink body text to preserve a grid. |
| [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons): “Always give a custom button a press state” | Every editor and preview action has keyboard focus, pressed, disabled, and outcome states. |
| [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop): “Offer alternatives to drag and drop”; “Prefer letting people undo a drop.” | Every structural operation has a keyboard and menu equivalent and produces one undoable transaction. |
| [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars): “Use tabs for navigation, not current-view actions” | Filter, Sort, Add, and Publish are actions, never app tabs. Empty data does not delete a navigation destination. |
| [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets): “Display only one sheet at a time from the main interface.” | Push related details inside a modal's own stack or replace the sheet deliberately. Do not accumulate independent stacked sheets. |
| [Settings](https://developer.apple.com/design/human-interface-guidelines/settings): “Put view visibility, item order, and list filtering on the affected screens for discoverability and context.” | Editing layout/rules is contextual; runtime filters sit beside their collection, not in global Settings. |
| [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities): “The system picks presentations per location, so you must support compact, minimal, expanded and Lock Screen.” | The activity editor requires and previews all four surfaces; no-island devices get the appropriate Lock Screen/banner fallback. |
| [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities): “Offer Live Activities for tasks and events with a defined beginning and end”, ideally no longer than eight hours. | Use a bounded task such as a cleaning run, not a permanent household dashboard or presence monitor. |
| [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities): “Focus on simple, direct actions.” The source says to prefer a single interactive element. | Default expanded/Lock Screen templates expose one essential related action; additional controls require a deliberate, constrained layout. |

Relevant exact native reference values: a general button hit region is at least **44 x 44 pt**; default iOS/iPadOS Body is **17/22 pt** size/leading and Large Title is **34/41 pt**. Accessibility Body AX2 is **33/40 pt** and AX5 **53/62 pt**. Lock Screen activities use the standard **14 pt** margin; Live Activity animations last **at most 2 seconds**, with none on reduced-luminance Always-On displays. These are native reference values, not physical measurements of the browser frame.

The following sections define product CSS pixels and preview layout units explicitly. Desktop browser panels borrow selection/inspector principles from macOS guidance; they are not `NSPanel`, native windows, or native menu bars. Reading HomeKit, tvOS, games, Siri, and other related guidance does not introduce those integrations or platforms into scope.

## 4. Visual language

### 4.1 Editor tokens

These are **product-defined CSS values**, not Apple measurements.

| Role | Value and use |
|---|---|
| Workspace canvas | `#F7F5F0`; optional quiet dot grid `#DEDDD5`, 24 CSS px spacing, disabled in high-contrast mode |
| Panel/surface | `#FFFEFA`; restrained borders `#DADDD5`; no stack of generic bordered dashboard cards |
| Primary ink | `#252B3C`; main text and selected headings |
| Secondary ink | `#59625D`; descriptions, provenance, timestamps; never low-opacity text over images |
| Project navigation | `#252B3C` with `#F4F5EE` text; selected row `#3B4659`, pale teal selection marker `#B8DDD0` |
| Accent/action | `#2D6B60`; white label on primary Publish button; soft selection fill `#E5EFE9` |
| Focus | `#5950B8`; 2 CSS px ring with 2 CSS px offset on light surfaces; pale contrasting ring on dark navigation |
| Warning/error | `#876118` / `#AB363A`, accompanied by text and a symbol; never color alone |
| Type | System UI font stack; 14/20 CSS px editor body, 12/16 metadata, 18/24 section title, 24/30 project overview title; medium/semibold hierarchy |
| Spacing | 4, 8, 12, 16, 24, 32 CSS px; align form labels and controls to one grid |
| Shape | 8 CSS px fields/menus, 12 panels/popovers, 16 palette previews; capsules reserved for compact modes/status |
| Elevation | Hairline separation for stationary panels; soft low-opacity shadow only for floating menus and device frame |
| Motion | 120 ms hover/selection, 180 ms panel transition as product defaults; no elastic chrome; immediate under Reduce Motion where movement is unnecessary |

Reserve teal for active work and deliberate actions. Do not tint every card. A filled indigo/purple focus outline must be visually different from a teal selection outline. Selection uses an outline plus breadcrumb/name, not color alone.

Dark editor mode is a separate semantic token set, not an inversion of the document. Use dark neutral surfaces, light text, and verified focus/contrast. A light preview can sit in a dark editor, and vice versa. Preview appearance controls never override the user's editor accessibility preferences.

### 4.2 Rendered-app treatment

Give the app preview a strong title, calm modular content surfaces, compact status summaries, recognizable action affordances, and consistent page margins. Source-inspired dark modules can sit on an **original abstract backdrop**, not a copied house image. Provide opaque backing where content needs guaranteed contrast. A single functional accent and semantic state colors are enough.

Use semantic native text styles in configuration. At preview scale 100%, map their reference point sizes to browser layout units for approximation; system-font metrics will vary. Display the scale and font-fidelity caveat. Use the actual reference style tables for Dynamic Type scenarios, not a single transform that pretends to be Dynamic Type.

Content must grow vertically. Controls move below text at accessibility sizes; cards can span their region. A read-only sensor has no press shimmer or chevron. Navigation has a chevron and destination; an action has a verb and action affordance. Do not put an interactive HTML button inside another button.

## 5. Workspace composition

### 5.1 Desktop arrangement

At 1440 CSS px and wider, use a 56 CSS px top toolbar, a default **288 CSS px left panel**, a flexible center, and a **336 CSS px right inspector**. Panels resize within practical bounds (left 264-360; right 304-400) with keyboard-operable separators. The device canvas gets the remaining space; zoom-to-fit must not change its logical viewport.

```text
Project / draft status       Device + environment    Edit | Preview   Review & Publish
--------------------------------------------------------------------------------------
Project | Components        Home > Main > Camera     Camera card
                            Interactive browser     Style Data Actions Rules
Pages / tab order           preview                 -----------------------
  Home                      [ device frame ]        Title / data binding
    Status rail             [ actual app UI ]        Layout / responsive rule
    Weather                 [ selected node ]       Action / condition summary
    Cameras                                          Accessibility / states
Modals / templates          2D | 3D   Fit  100%       -----------------------
Live Activities             Safe areas  Test state  Contextual explanation
--------------------------------------------------------------------------------------
Draft saved locally / saved to server                 Issues (2)   Action log
```

This is a layout schematic, not literal application content. Labels such as Home and Camera come from the open document.

**Top toolbar:** left project name/breadcrumb, draft/publication state, and project menu; middle device selector and a concise environment summary; right Edit/Preview, Undo/Redo, and **Review & Publish**. Use logical groups and one prominent action. Overflow secondary tools before shrinking labels to unreadability. Publish is never hidden in an unlabeled icon.

**Left panel, Project tab:** a true outline with Pages and tab order, each page's sections/components, Modals, Reusable Templates, Action Presets, and Live Activities. Nodes show icon, author label, child count, rule indicator, and error badge where applicable. A muted eye indicator means conditionally hidden in the current scenario, not deleted. Search filters matches while retaining their ancestor path.

**Left panel, Components tab:** searchable families: Structure, Navigation, Status, Actions, Media, Collections, Forms & Settings, Profile, Live Activities. Each palette item has a small original example, a short label, and one-sentence behavior. Offer **Add to selected container** as well as dragging. Templates and data sources are not disguised as ordinary components.

**Center:** a warm, mostly empty work surface with a subtle optional grid, modest device bezel/shadow, and no giant fake hero heading. The document breadcrumb is above the frame; canvas controls are below it. A compact label identifies page, device, text-size scenario, and simulation status. The selected element receives a precise outline and a small label that never covers its primary control.

**Inspector:** selection name, type, readable path, and stable ID in a copyable disclosure. Four accessible tabs: **Style**, **Data**, **Actions**, **Rules**. Style includes layout, text, appearance, and accessibility; Data includes sources and collection controls; Actions includes affordance and presets; Rules includes visibility/availability. Show relevant properties only. A section/page/activity selection gets its own contextual form, not a sea of disabled controls. Include inherited values, override markers, and **Reset override**.

**Status strip:** truthful save location/state, a focused issue count opening the issue list, and a collapsible preview action log. No invented health metrics, unread notification counts, or analytics cards.

### 5.2 Responsive workspace

| Browser width | Editor behavior |
|---|---|
| 1440+ CSS px | All three columns; generous center gutters; resizable left/right panels |
| 1180-1439 | All three if the center retains 480 CSS px; otherwise collapse the right inspector to a labeled drawer; never silently scale the whole editor |
| 900-1179 | Left panel plus canvas; inspector opens as a right drawer. Its close button and opener retain focus. Device controls move to an environment popover. |
| 600-899 / tablet portrait | Canvas-first. Project/Components and Inspector are mutually exclusive drawers, each with a labeled opener; both remain fully usable. Toolbar wraps to two intentional rows. |
| Below 600 or heavy browser zoom | Single-column authoring: Project, Canvas, Inspector views with explicit switching. No desktop-width form squeezed into a phone. Preserve selection when changing view. |

Drawer modality follows presentation: an overlay drawer traps focus and makes the background inert; a docked panel does not. Pointer and touch users can reach every command without hover. Aim for 44 CSS px touch targets in editor controls; desktop compact controls may be visually smaller but retain a comfortably separated hit area.

Browser zoom/reflow and **preview** Dynamic Type are separate tests. At 200% browser zoom, all editor commands remain reachable, labels wrap, and no required action is clipped behind a panel.

## 6. Authoring interactions and state

### 6.1 Selection, insertion, and properties

In **Edit**, clicking rendered content selects its configuration node; it never runs the node's action. Clicking a child selects the deepest selectable node; breadcrumbs and the outline provide an unambiguous way to choose its parent. Non-content system chrome is identified as a device/environment surface, not editable app content. Selection in the tree, canvas, and inspector stays synchronized.

Adding a component inserts into the selected compatible container, otherwise asks for a destination. Show an insertion line and the future parent. Incompatible slots explain why, for example “A tab belongs in Navigation, not inside a camera card.” Palette additions create new IDs. Reparenting existing nodes preserves IDs. Duplication generates new internal IDs and remaps internal references while retaining intentional external destinations.

Property fields use text inputs, selects, segmented choices, switches, sliders with number entry, and entity/template pickers as appropriate. Edit values in a local field draft; validate before committing to the document. Invalid values remain visible with an inline explanation rather than silently reverting or coercing. Typing in one field becomes one undo step on commit; a slider drag is one transaction.

New components have semantic defaults, not plausible-looking invented live values. An unbound camera says **“Choose a camera”** in Edit and gets a clear unconfigured state in Preview. Defaults must never silently attach a real entity.

### 6.2 Pointer and keyboard drag and drop

Within the project document, dragging an existing node **moves**, including across containers; dragging from the palette **creates**. This deliberate web-authoring convention differs from the native general cross-container copy rule. Always show **Move**, **Copy**, or **Add** in the drag preview. Offer Duplicate/Copy explicitly; a documented Option/Alt modifier may copy only where it does not conflict with the host.

Every move must also work without dragging:

| Input in the focused outline | Result |
|---|---|
| Up/Down; Home/End | Move through visible nodes without changing their order |
| Right/Left | Expand/collapse; move to child/parent using standard tree behavior |
| Enter | Select and reveal the node in the canvas/inspector |
| Space on the explicit Move handle | Pick up the selected node; announce its name, parent, position, and instructions |
| Up/Down while picked up | Choose previous/next valid insertion position |
| Right/Left while picked up | Choose a compatible nested destination / parent-level destination; never create a cycle |
| Enter or Space while picked up | Commit the move as one transaction and keep the moved node selected |
| Escape while picked up | Cancel without changing configuration and return focus to its handle |
| Node menu: Move up, Move down, Move to... | Equivalent operations with a searchable destination picker; available to touch and assistive technology |

Use a live region for concise updates: “Weather moved before Cameras, 2 of 4.” Reject self/descendant drops and invalid parents visibly and audibly. Auto-scroll only the active destination near its edge. Restore focus after reparenting. Do not depend on deprecated ARIA drag attributes.

Structural deletion is undoable and reports incoming references before deletion. Removing a referenced destination requires replacement or removal of those references; do not leave a publishable broken route. Undo restores the subtree and affected references together.

### 6.3 Keyboard and focus

Provide a visible shortcut help menu and skip links to Project, Canvas, Inspector, and Issues. Toolbars use predictable keyboard navigation; fields keep standard editing shortcuts. Cmd/Ctrl+Z and redo apply to document history only outside an active native text-edit operation. Do not commandeer browser Back, Refresh, Find, or tab-navigation shortcuts.

In Preview, **Escape** first dismisses the active preview menu/modal (with draft protection where needed), then leaves focused preview interaction through a visible **Exit preview focus** control. It does not navigate away from the editor or discard the document. Focus restores to the opening control or nearest surviving ancestor.

All icon-only controls have names; labels are persistent rather than placeholder-only. Selection, keyboard focus, invalid state, current route, and disabled state are distinguishable without color. Announce results, not every intermediate slider pixel or timer tick.

### 6.4 Edit, Preview, and data safety

**Preview** runs the actual configuration renderer: tabs, push/pop, sheets, lists, carousels, filter/sort drafts, and actions work. A sticky **Simulation** badge identifies the action runner. Default actions mutate an isolated fixture state and log their intended target/payload/outcome. Neither Edit nor Preview calls live HA services. Real-house actuation is not part of this studio's acceptance scope.

Expose scenario controls for Ready, Loading, Empty, Unavailable, Offline with stale values, Permission denied, Action failure, Long text, and an event sequence. Show which data is synthetic versus connected read-only data. Changing a scenario is not a document edit and does not dirty the draft.

Preview navigation state is separate from editor selection and authored defaults. Switching back to Edit retains both. **Restart preview** resets only the simulation; **Reset demo project** is a distinct confirmed operation.

### 6.5 Saving and publication

Autosave is not publication. Display a precise progression: **Unsaved changes -> Saving... -> Draft saved [location/time]**, or **Could not save - Retry**. Do not show “saved” before persistence acknowledges the revision. A locally stored demo must say **Saved in this browser**, not Saved to Home Assistant.

Review & Publish opens a review surface with changed pages/templates/actions, target renderer compatibility, unresolved bindings, safety-sensitive actions, accessibility/layout issues, and the previous published revision. Structural/type errors and missing required references block publication; warnings have explicit consequences and can be acknowledged. Device assumptions are visible in the review, not implied certification.

On confirmation, publish the reviewed immutable revision. Concurrent changes require re-review rather than silent overwrite. A save/publish failure preserves the draft and explains retry/recovery; success shows the acknowledged revision and destination. In demo mode, publication creates a persistent local snapshot and reads **Published locally (demo)**. It must not imply a native app refreshed.

Offer a previous-revision comparison and restore-to-draft path; restoring a draft does not publish it automatically. After reload, recover persisted draft and published revision distinctly. If storage is unavailable or full, keep the current in-memory work visible, report the limitation, and offer configuration export.

## 7. Configuration-facing design contract

### 7.1 Document and object requirements

The integration/schema owners may rename fields, but the following capabilities and semantics are required.

| Object | Required design-facing information |
|---|---|
| Document | Schema version, stable document ID, title, theme reference/tokens, supported renderer version/capabilities, published/draft revision identity |
| App shell | Initial route, ordered tabs/destinations, compact/regular presentation policy, global chrome groups, badge bindings, optional sidebar groups |
| Page | Stable ID, title, content tree, layout policy, chrome actions, route parameter definitions, optional list/detail relationship |
| Modal | Stable ID, presentation kind (`sheet`, `fullScreen`, `popover`, `alert`), content/root route, dismissal policy, sizing intent, local navigation/section definitions |
| Node | Stable ID, registered type, author label, typed props, named child slots, bindings, layout, actions, visibility/availability rules, accessibility metadata |
| Reusable template | Stable ID, declared input types, reusable node tree, per-instance bindings; no hidden entity dependencies |
| Data source / binding | Source ID, entity or collection reference, typed field/path, item key, formatting/unit options, freshness and error behavior; no credentials |
| Action preset | Stable ID/version, parameter schema, compatible capabilities, action kind, confirmation policy, feedback behavior, success/failure outcome contract |
| Activity | Stable ID, bounded job binding, phase/progress/time fields, related-detail route, redaction policy, four variant templates, essential action reference |
| Editor-only state | Selection, panel widths, canvas zoom, test device/pose, scenario, preview navigation state; not executable app configuration |

Entity snapshots can resemble the inspected UI boundary: `entityId`, `state`, `attributes`, `lastChanged`. Collections use records with a stable item key. Keep labels separate from IDs; renaming “Home” must not break navigation, conditions, or actions.

Bindings are declarative selectors and typed formatters: entity state, entity attribute, collection item field, current profile, capability, explicit aggregate, or preview environment value. Show their origin, current value, timestamp, and fallback in the inspector. A fallback is explicit presentation copy, never fabricated state or silent zero.

No arbitrary JavaScript, `eval`, embedded secrets, hardcoded user names, or unvalidated HTML belongs in configuration. Unknown component versions show a named unsupported-component state in Edit, retain their configuration for recovery, and block incompatible publication; never silently omit them. Unsupported optional platform features show a documented fallback, not an invented success.

### 7.2 Navigation and modal semantics

Navigation is a graph of stable page/modal IDs and typed route parameters. The Flow view is a projection of that graph, not a second independent source of truth. It shows tab roots, push edges, modal edges, and back/close exits. Editing an edge updates the underlying action reference.

- A tab selects a section and retains that section's stack, filter/sort state, and scroll anchor.
- A push opens a related detail on the current stack. Back restores the previous route and context.
- List/detail uses the same route model: regular width can show both panes; compact width shows the selected detail with Back. Resizing does not create duplicate history entries.
- A modal has its own stack. Close returns to its presenter; Back traverses within the modal. Related forms push inside it or deliberately replace it.
- Viewing sheets have Close; editing sheets have Cancel and an explicit commit verb such as Apply/Save. Protect meaningful text edits from accidental dismissal. Small selection-only filter drafts may be discarded by Cancel/Escape without a second alert.
- Full-screen camera/video presentation has a persistent, discoverable exit. Browser fullscreen, if offered, requires user activation and is distinct from app-modal fullscreen.
- Invalid/missing destinations produce an actionable inline issue and block publication. If a data item disappears while its details are open, show “This item is no longer available” with Back, not an unrelated record.
- Top-level navigation remains accessible when content is empty/offline. Role-based authorization is enforced outside presentation rules; hiding a tab is not security.

### 7.3 Component matrix

All components inherit the common binding, accessibility, state, and layout contract. The palette uses these generic families; source-specific names exist only in fixture documents.

| Family | Configurable properties and binding | Interaction and required states |
|---|---|---|
| Page / section | Title/subtitle, spacing, surface, readable-width cap, child slots, region affinity, header action | Section heading semantics; empty section policy; never an action merely because it has a background |
| Grid / stack / split | Row/column policy, gaps, minimum item width, span, alignment, region strategy, responsive overrides | Content-driven height, valid insertion slots, no meaningful element across a reserved region |
| Button / action tile | Verb, state/secondary label, icon, semantic tone, action/preset, confirmation, feedback style | Pressed, in flight, successful, rejected, unavailable; no chevron unless it navigates |
| Navigation tile | Title/subtitle/icon, destination/parameters, optional independent accessory actions | Distinct navigation region and accessory buttons; body never also executes an unrelated service |
| Read-only status tile | Value, unit, icon, timestamp, semantic state mapping | Static semantic group, no fake press state; unknown/unavailable shown explicitly |
| Status chip / rail | Label, value/aggregate, semantic family, optional detail destination, compact-scroll/regular-wrap policy | Word/glyph plus color; configurable ordering; large-text wrap; distinguish clickable and static chips |
| Camera card / camera viewer | Camera reference, title, poster, fit mode, aspect ratio, overlay policy, viewer destination | Connecting, live only if true, snapshot with timestamp, paused, denied, failed; visible retry; labels below media at large text |
| Video / media controls | Media reference, poster, fit, playback capability, captions/transcript reference, control set | User-initiated play/audio; play/pause/mute/seek/fullscreen only when supported; no invented streaming support |
| List / collection | Source, stable key, item template, grouping, headers/footers, selection mode, filter/sort query | Loading, empty, stale, failed, item removed; independent row accessories; reorder only when source supports it |
| Carousel | Source, stable key, item template, rows/columns per region/text size, ordering, page controls | Data-derived page count; keyboard previous/next; bounded paging; loading/empty/error; retained anchor item |
| Settings section / row | Title/footer, icon, explanatory subtitle, value binding; row type link/toggle/slider/choice/action | Labels and units remain visible; local draft vs immediate action explicit; disabled reason; values not implied by row position |
| Profile header / person row | Name/avatar/initials binding, role/status labels, privacy mode, summary sections | Missing avatar fallback, guest/member/admin fixtures, redacted state; capability-aware account actions |
| Toolbar/chrome action | Scope, group, title, symbol, priority, badge, filter/sort target or action reference | Keyboard reachable; named overflow items; active count; task-critical Back/Close/Apply retained |
| Tabs / sidebar / modal sections | Ordered destination refs, labels/icons, badge data, initial selection | State persistence; compact/regular adaptation; selected indication; large-text menu fallback where segments no longer fit |
| Form / filter / sort sheet | Typed fields, draft defaults, validation, apply/reset semantics, target collection | Cancel discards; Apply commits valid changed draft; sort order is single-choice; filters show narrowing count |
| Summary / weather / progress module | Typed values, units, trend/forecast collection, time fields, drill-down route | Domain presentation is reusable; no baked-in entity IDs; accessible summary and details; long-text reflow |
| Live Activity variants | Shared activity model, per-surface slots, redaction, link, essential action | Lock Screen, compact, minimal, expanded; limited-width, ended, problem, stale, privacy variants |

Camera/video default to **fit** to preserve the scene; crop/fill is explicit and previewed. This is a product choice, not a claim that one Apple aspect-ratio threshold applies to all content. Camera posters and offline snapshots must not be labeled live. No autoplay audio and no real household footage in the demonstration.

### 7.4 Layout, rows, columns, and collection paging

Expose **Auto** versus explicit column count; row count controls rows per carousel page, not fixed card height. All counts are positive integers. A simple initial product limit is 1-12 columns and 1-8 carousel rows; these are editor limits, not iOS limits. Explain any lower effective count caused by width or text size.

Precedence is: base component policy -> compact/regular override -> accessibility-text override -> fit within each usable region. Explicit author counts are preferred counts, not permission to clip. If they cannot fit minimum widths, reduce effective columns and report **“Requested 4; fits 2 in this region.”** Never silently shrink fonts. A spanning item stops at its region boundary.

For a carousel:

1. Apply data selection, filters, and stable sort; break ties by stable key.
2. Resolve effective columns and rows for the current usable region. `pageCapacity = columns * rows`; `pageCount = ceil(itemCount / pageCapacity)`.
3. Keep the currently anchored item's key visible on resize or data refresh; if it disappears, retain the nearest surviving neighbor, otherwise return to the first page.
4. Loading is not a fictitious five-page data set. Use a quiet placeholder with no asserted result count. Empty is “No items match” plus Clear filters when applicable; an unfiltered empty source has its own explanation.
5. Show dots for 2-10 pages, a labeled “Page n of N” control for larger counts, and no paging control for zero/one page. Both previous/next buttons and keyboard activation work; no auto-advance.
6. Multirow items read in the configured row-major order. Off-page items are not duplicate tab stops. The whole carousel is not one giant button.

At large text, prefer one column and fewer rows rather than a fixed-height clipped card. Do not make a small panel scroll horizontally just to preserve a requested column count.

### 7.5 Action presets

The Actions inspector first asks **“What should this do?”**, with Navigate, Open modal, Change selection/query, and Run preset as recognizable choices. A supported preset then supplies compatible target pickers and typed parameters. Advanced raw payload inspection is read-only by default; validation is shared with the structured form.

| Preset category | Required inputs | Default feedback and safety |
|---|---|---|
| Navigate / open modal / switch tab | Valid destination and typed route params | Immediate local transition; no service dispatch |
| Entity toggle / on / off | Compatible target; optional explicit value | Optimistic only when the supported contract permits rollback; otherwise tracked |
| Set value | Target, numeric range/unit/step or allowed choice | Validate before dispatch; slider commits on release or explicit Apply, not an unbounded call stream |
| Scene / script | Supported reference and declared input fields | Tracked request; avoid duplicate activation while pending |
| Media transport / vacuum job control | Target, advertised capability, supported command | Show unavailable commands with a reason; momentary or tracked per command, not guessed from a label |
| Lock / door / alarm-sensitive operation | Target, supported command, confirmation copy | Explicit confirmation by default; no real operation in simulation |
| Account / app capability | Capability reference, e.g. sign out or open supported settings | Runtime-provided capability; a document cannot grant access or supply credentials |

An action's phase is distinct from the entity's state. **Momentary** acknowledges activation and still exposes later failure; **optimistic** shows a tentative value with rollback on rejection; **tracked** shows pending/progress until the result or expected-state confirmation arrives. A transport acceptance is not proof that a physical device changed state. Keep a failure visible with Retry/details; never paint success solely because a timeout elapsed.

A preset may use a bounded, typed conditional branch if supported, with its selected branch explained in simulation. No arbitrary scripts, infinite loops, hidden retries, or state-change-triggered action execution. Conditions on visibility are not automations.

Changing a shared preset displays its consumers and offers **Update all uses** or **Make a copy**. Preset parameters bind explicitly; a label like “Kitchen” never selects a target by name.

### 7.6 Conditional visibility: readable IF / THEN / ELSE

The Rules inspector presents a sentence builder:

**IF** all/any conditions match **THEN** show this section / enable this action **ELSE** hide / show unavailable / disable with explanation.

Supported operands: typed entity state/attribute, collection count, profile capability, explicit local selection/query, and preview layout environment where appropriate. Operators: equals/not-equals, numeric comparison/range, contains/in-set, exists, and explicit available/stale tests. Group with `all`, `any`, and `not`. Validate operand types and units. Do not offer arbitrary Jinja/JavaScript as an undocumented escape hatch.

Rules have three outcomes: **true, false, unknown**. Missing/unavailable values do not become false, zero, or an empty string. `all` is false if any operand is false, otherwise unknown if any is unknown; `any` is true if any is true, otherwise unknown if any is unknown; `not unknown` remains unknown.

Default unknown behavior is a non-sensitive unavailable placeholder for content and disabled-with-reason for actions. A rule can explicitly select another permitted fallback. Authorization denies on unknown and remains enforced independently; no condition may reveal restricted data.

Show **“Visible because...”**, **“Hidden because...”**, or **“Cannot evaluate...”** with the exact predicate values/source timestamps. **Reveal hidden nodes** shows ghosts only in Edit, with a dashed outline and rule label; it does not bypass permissions or alter Preview behavior.

Guard active interaction: when an ordinary data rule hides a focused item, move focus to its closest surviving container and announce the change. Keep an active top-level destination represented with an explanatory unavailable view until the user leaves it; then recompute eligible navigation. Permission revocation instead clears restricted content immediately and moves to an allowed route. Empty collection results alone must not remove tabs.

Rules re-evaluate on relevant data changes, not animation frames. Turning a condition true never executes an action, presents a modal without user intent, or publishes a configuration.

### 7.7 Illustrative configuration fragment

This intentionally partial JSON shows the desired composition and UI-boundary semantics, **not an implementation-ready native-home import document**. IDs, entity names, content, and counts are fixture/configuration values. Each reference must resolve in a complete project.

```json
{
  "id": "home.guests",
  "type": "section",
  "props": {
    "title": "Guests",
    "description": "Review guest controls before leaving."
  },
  "layout": {
    "region": "secondary",
    "columns": { "compact": 1, "regular": 2, "accessibility": 1 }
  },
  "visibility": {
    "if": {
      "op": "equals",
      "left": {
        "source": "house",
        "entityId": "input_boolean.demo_guest_mode",
        "field": "state"
      },
      "right": "on"
    },
    "then": "show",
    "else": "hide",
    "unknown": "placeholder"
  },
  "children": [
    {
      "id": "home.guests.room",
      "type": "actionTile",
      "props": { "title": "Guest room", "verb": "Toggle guest mode" },
      "bindings": {
        "state": {
          "source": "house",
          "entityId": "input_boolean.demo_guest_room",
          "field": "state"
        }
      },
      "actions": {
        "primary": {
          "preset": "entity.toggle",
          "parameters": { "entityId": "input_boolean.demo_guest_room" }
        }
      }
    }
  ]
}
```

The renderer must render the same structure correctly if its labels, IDs, target entities, location, and rule values are changed. Its registered `section` and `actionTile` implementations may know their component behavior, but not this household.

## 8. Device and environment preview

### 8.1 Profiles and provenance

The selector must offer **iPhone**, **iPhone Duo**, **iPad**, and **Custom viewport**. iPhone choices include standard Dynamic Island, the requested **“18 Pro - smaller-island study (unverified geometry)”**, and **notch/no Dynamic Island** variants. Do not title an unverified profile “accurate,” “official,” or “hardware matched.”

A profile records a display label, logical viewport, safe-area insets, cutout/reserved-region geometry, size-class assumptions, chrome policy, supported surfaces, and provenance for each measured value. Distinguish:

- **Reference layout class:** numbers explicitly present in the loaded HIG, linked to that source, not attributed to an unlisted model.
- **Illustrative test geometry:** product-selected values for testing; visible **Approximation** badge.
- **Measured profile:** only after a recorded measurement names the device/OS/source/date; no such hardware measurement was performed for this document.

The loaded HIG lists iPhone Live Activity layout classes **393 x 852 pt** and **430 x 932 pt**, but supplies no verified “18 Pro smaller island” dimensions. It is acceptable to use the 393 x 852 reference class as a generic test viewport while varying an explicitly illustrative cutout. Do not infer the requested model's screen size, pixel density, island reduction, or available text widths.

Duo outer/inner dimensions, hinge band, camera regions, and iPad test windows must likewise carry provenance. A convenient fixture window is not a claim about a device. Avoid copying numeric hinge measurements from the old mockup proposal into a supposedly official device registry.

Safe-area/cutout overlays are available on demand, with a labeled legend. The simulator must reserve those regions for layout and hit testing, not merely paint a black shape over hidden buttons. Preview viewport size is independent of browser window size, canvas zoom, and device-pixel ratio.

### 8.2 Environment controls

Keep the top-level summary concise; open **Device & Environment** for orientation, active display, fold pose/angle, cutout variant, safe-area overlay, light/dark appearance, Dynamic Type, RTL, reduced motion/transparency, increased contrast, camera active/inactive, and data scenario. Every slider has number entry and Reset.

Use **layout units** for browser geometry, explicitly labeled as a mapping used for native-layout approximation. Do not label CSS pixels “physical points.” At Fit zoom, apparent target size is not a native hit-target test. Offer 100% and a focused preview; on touch devices use scrolling/panning rather than making required interactive targets too small to operate comfortably.

An iPad preview must include a narrow/resizable-window case, not only a full-screen portrait/landscape drawing. Choose layout from available regions and size classes. Generic regular iPad navigation can adapt to top tabs/sidebar; the source-inspired demo may configure a flyout. Both use the same destination graph.

### 8.3 Fold and 3D semantics

Represent four separate concerns:

| Concern | Meaning |
|---|---|
| Logical display/posture | Outer closed; inner fully open; partially folded/book; surface-resting/tabletop; edge-standing |
| Layout orientation | Portrait/landscape and reserved-region axis in display coordinates; affects usable space and chrome |
| Fold angle | Illustrative opening angle: 0 degrees closed, 180 degrees flat, intermediate values partial; this is a studio convention, not a physical sensor calibration |
| 3D view orientation | Camera yaw/pitch/roll and zoom used to inspect the model; does not change app layout, route, or active display |

Pose buttons set a coherent state. The angle slider uses the exact endpoints above for closed/flat and intermediate angles for partial; it must not invent a hardware threshold such as “the inner screen activates at 35 degrees.” Keep a chosen tabletop/edge-standing pose while adjusting its intermediate angle. The default illustrative partial-fold band is a profile value, not a physics-derived measurement; show that fact beside the control.

For partial folds, partition the inner display into usable regions excluding the fold band. Use a configurable primary/secondary affinity and stable reading order. Even grid counts are preferred where dividing a grid across two regions; resolve counts within each region rather than placing an odd central tile over the hinge. A large unsplittable object occupies one usable region; it is not clipped by the band.

Fully open removes the partial-fold exclusion band. The configured regular-width layout may remain split or become a single readable column; this is content policy, not navigation. Closed uses the outer compact layout. Surface-resting and edge-standing reuse the same adaptive content model, rather than inventing unrelated screens.

Follow the loaded Duo guidance when illustrating chrome: outer controls on the hardware-relative trailing side with Island, status, toolbar, then tabs; inner landscape side controls, inner portrait horizontal controls. Hardware-relative placement stays fixed in RTL; text, logical leading/trailing content, and navigation semantics adapt. Local pane actions remain by their pane. Inner camera activation reserves its region and reflows nearby content; outer camera remains reserved.

**2D is the authoritative editing and accessible interaction surface.** 3D is an optional presentation view of those same rendered regions. Do not create a second renderer or copy canned screenshots into folded planes. In 3D, disable direct node dragging and show **“View only - switch to 2D to edit/interact.”** Device controls remain keyboard accessible outside the model. A flat preview is always one action away.

Reduce Motion removes automated orbit/hinge transitions; explicit angle adjustments can update immediately. Do not mimic native accelerometer behavior, haptics, screen handoff timing, or sensor readings. When 3D transforms are unavailable, retain the fully functional 2D preview with an explanation.

## 9. Live Activity editor and browser simulation

Selecting a Live Activity opens a **four-surface strip** beside/above the focused device: Lock Screen, Compact, Minimal, Expanded. Each is rendered from the same bound activity data; selecting a surface opens its allowed slots in the inspector. Keep a persistent **“Simulated Live Activity - no system delivery”** label outside the device.

| Surface | Required design | Interaction and variations |
|---|---|---|
| Lock Screen | Bounded job title/status, primary progress/time, essential related action, privacy-safe summary; grow to fit within the chosen profile's constraints | Related-detail link, readable light/dark and reduced-luminance study; use the native 14 pt margin as an explicitly mapped preview reference |
| Compact | Leading recognizable glyph/progress plus concise trailing value, visually one piece of information around the camera | Both parts open the same detail. Limited-width scenario can omit trailing content; do not shrink it to an unreadable token. |
| Minimal | Recognizable progress/glyph; no tiny dashboard | Include attached and detached examples when simulating multiple activities. A named Expand control is the keyboard/touch alternative to touch-and-hold. |
| Expanded | Preserve compact elements' relative meaning; use leading/trailing/bottom regions and keep camera area clear | Job title/value/progress and preferably one essential action, such as Pause. Support a problem state with an actionable explanation. |

Start with a synthetic cleaning run. States: queued, running, paused, problem, stale/disconnected, completed, ended, and redacted. A bound problem changes the same activity, not an unrelated modal. Progress, timers, job identity, labels, and available controls come from the activity fixture/schema.

Use a controllable simulation clock with pause, advance, and reset. Do not announce every second to a screen reader. A completion ends the island immediately in the simulation; a separately labeled Lock Screen retention scenario may show the ended summary. The HIG permits system retention up to four hours and suggests 15-30 minutes in most cases; do not claim the browser implements an OS retention guarantee.

On a notch/no-island profile, show Lock Screen and a banner study; mark island surfaces **Not available on this profile** rather than drawing a fake island. iPad uses its Lock Screen presentation and does not acquire an island merely because the activity template has one.

Island background is opaque black; custom background choices apply only to Lock Screen. Validate contrast, rounded-edge clipping, and reserved camera space. Long text must have a deliberate shortened display value with the full accessible label, not a blanket scale-to-fit.

Tap opens the related in-app route; touch-and-hold/Expand changes the simulated surface. Action buttons call the isolated simulation runner. There is no real ActivityKit start, push update, widget permission, notification sound, or Always-On rendering. Reduced-luminance appearance is a design study and still needs native/device verification later.

## 10. Demonstration document and fixtures

Ship a complete **editable example configuration** plus a separate synthetic fixture set. Every visible app title, page, tab, chip, camera card, row, modal, activity, and action reference must come from that document or its bound data. Renderer code may implement component types and supported action kinds; it must not dispatch on page title, entity-name suffix, person name, or fixture index.

| Configured area | Example composition and behavior |
|---|---|
| Overview tab | Status rail (Lights, Security, Climate, Occupancy), weather summary, conditionally visible guest section, camera collection. All labels and entities are fixture entries. |
| Rooms tab | Room collection -> room detail with a light action tile, media navigation tile with separate transport actions, and a read-only air-quality status. |
| Food tab | Data-backed suggested-item carousel, collection filter/sort actions, item details; examples of configurable rows and columns. |
| Tasks tab | Grouped list, completion action, selected-item detail/push fallback, empty and failed variants. |
| Settings tab | Grouped sections with a choice row, toggle, slider, navigation row, capability-provided account action, and a conditional admin section. |
| Profile modal | Bound identity with initials, people/status list, configurable related summary sections. No real household names or location data. |
| Camera modal | Original synthetic poster or licensed demo video, user-initiated playback, simulated connection states, fit/fill choice, close and retry. |
| Activity | Bounded cleaning-run model with four surfaces and one Pause/Resume action preset. |

These five example tabs are **configuration choices**, not mandatory destinations. The component palette must support a blank document and an unrelated three-page project just as well.

Include deterministic fixture scenarios: online mixed states; no entities/data; unavailable single entity; stale offline snapshot; guest versus member/admin capabilities; long localized labels; action rejected; camera denied; 0/1/13 collection records; activity running/problem/completed. Use a fixed test clock with explicit locale/time zone. Demonstration entities use a clearly synthetic namespace such as `light.demo_lounge`, never an automatically discovered real target.

A compact carousel fixture can request 2 columns x 2 rows with 13 items: four pages, with one item on the last page. A regular-width override requesting 3 columns x 2 rows yields three pages when it fits. AX5 can request 1 column x 1 row, yielding 13 pages and the textual page control. This is a concrete proof that rows, columns, data length, and page count are not hardcoded.

Include a blank-project path and export/import of the complete example configuration. Removing the Overview page, renaming every label, adding a new modal, and changing the initial route must work without renderer source edits. Import must validate before replacing the draft and offer recovery/export of current work.

## 11. Accessibility and quality requirements

The browser UI uses semantic DOM controls, not an inaccessible bitmap of a phone. Keep preview content in a scoped rendering environment so editor CSS does not accidentally change app type, spacing, or controls. One visible preview instance is interactive at a time; comparison thumbnails do not duplicate focusable controls.

Use at least **4.5:1** contrast for normal-size text and **3:1** for meaningful non-text controls/indicators as product acceptance targets. Check actual composited backgrounds, light/dark variants, error text, badges, and focus states. Decorative borders/grid dots may be quieter, but cannot be the only indication of an actionable boundary.

Respect keyboard-only operation, browser zoom, touch, RTL, reduced motion/transparency, and increased contrast. Native target sizes are checked in logical renderer coordinates at 100% with an explicit browser-approximation qualification; do not equate scaled-screen pixels with native points.

Errors must name the affected component and corrective action. Examples: **“Choose a destination for ‘Open room’.”**, **“This camera is unavailable. Showing the last snapshot from 14:32.”**, **“Draft not saved. Browser storage is full; export a copy before closing.”** Do not obscure an error behind a transient toast or report simulated success as a real service result.

## 12. Acceptance matrix

All rows below are release criteria for the described studio/preview, not claims that this design document has implemented or passed them. “Native follow-up” is deliberately separate from browser acceptance.

| ID | Scenario / procedure | Required observable outcome |
|---|---|---|
| E01 | Open the example at 1440 x 900 | Wide hierarchy/palette, central device, contextual inspector, and clear mode/publication toolbar; no generic KPI dashboard replacing the canvas |
| E02 | Resize through 1280, 1024, 768, and 600 CSS px | The specified panel/drawer transitions preserve selection and form drafts; every control remains reachable; no page-level horizontal overflow from editor chrome |
| E03 | Use 200% browser zoom | Editor labels wrap and panels reflow; Publish, drawer dismissal, validation errors, and inspector fields remain reachable |
| E04 | Select a deeply nested node from canvas, tree, and breadcrumb | All selection surfaces agree; inspector shows that node, not an unrelated parent; focus ring remains distinct from selection |
| E05 | Add, reorder, reparent, duplicate, delete, undo, redo using only keyboard/menu controls | Same valid structure as pointer DnD; no cycle or lost subtree; moved node remains selected; one coherent operation per undo step |
| E06 | Attempt a descendant drop or incompatible slot insertion | No mutation; visual and spoken reason; source remains available; Escape restores pre-drag state |
| E07 | Enter invalid columns, a bad destination, or a mistyped binding | Field error persists and can be corrected; no silent coercion or blank render; publication identifies the exact blockers |
| E08 | Click an action tile in Edit, then Preview | Edit only selects; Preview runs the fixture action and logs intended behavior; zero real HA service calls in both modes |
| E09 | Simulate save failure, storage-full, reload, and publication failure | No false Saved/Published message; draft remains recoverable; export/retry available; persisted drafts and published snapshots remain distinct |
| E10 | Publish a reviewed revision while a newer edit arrives | Either publish exactly the reviewed immutable revision with clear labeling, or require re-review; never silently publish unreviewed changes |
| E11 | Demo publication | Persistent local revision and explicit “Published locally (demo)”; no assertion that HA/native devices were updated |
| E12 | Start blank; import an unrelated configuration; rename all example titles | No hidden Home/Profile/recipe/entity-name renderer branch; only configured content appears; stable IDs preserve references |
| R01 | Visit detail in tab A, scroll, switch to B, return | Tab A retains its route, query state, selection, and meaningful scroll anchor |
| R02 | Open a list detail; change compact to regular and back | Detail becomes a pane or pushed page without duplicate navigation entries or lost state; Back returns to the same list context |
| R03 | Open a sheet, navigate inside, dismiss; attempt another modal | One main sheet at a time; proper internal Back versus Close; protected form drafts; focus returns to opener |
| R04 | Change filter/sort draft and Cancel; reopen, change and Apply | Cancel leaves results unchanged; Apply commits once; Reset restores configured defaults; active filter count excludes sort/ranking-only changes |
| R05 | Compare action, navigation, and read-only tiles using pointer and keyboard | Correct affordance and semantics; accessory action never triggers parent navigation; no nested button markup or duplicate single-action tab stops |
| R06 | Run momentary, optimistic, and tracked fixture actions; inject rejection | Feedback matches declared kind; optimistic rollback is visible; no timeout-generated success; unavailable controls give reasons |
| R07 | Change data to missing, unavailable, and stale | Labels/context remain intelligible; missing does not become zero/off; stale values are marked with freshness; retry/empty messages are actionable |
| R08 | Evaluate all/any/not with true, false, unknown | Matches section 7.6 truth rules; inspector explains evaluation; visibility never dispatches an action |
| R09 | Hide the selected/focused node and revoke access to an active page | Editor can reveal allowed hidden structure; runtime focus relocates safely; restricted content clears immediately and fallback route is allowed |
| R10 | Carousel: 13 items at 2x2, 3x2, and 1x1 effective layout | Exactly 4, 3, and 13 pages; last-page counts 1, 1, and 1; control switches from dots to text above ten pages |
| R11 | Carousel: 0/1 items; resize or remove current anchor item | No fake pages; useful empty state; no out-of-range index; nearest surviving item/first page retained; off-page controls not focusable |
| R12 | Set an impossible column count at large text | Effective count reduces with visible explanation; text is not shrunk or clipped; card height grows |
| R13 | Load camera/video fixture, deny access, switch to stale poster, change fit/fill | Accurate state label; poster never says Live; original aspect respected in fit; visible play/close/retry; no autoplay audio |
| R14 | Change profile fixture from member to guest; remove avatar | Name/role/sections update from data; initials fallback works; UI does not confer capabilities; sensitive data is redacted |
| D01 | Compare iPhone island, smaller-island study, and notch profiles | Each has clear provenance; unverified geometry labeled; cutouts affect usable space and hit testing; no fabricated model specifications |
| D02 | Change canvas Fit/100% and browser width without changing preview viewport | Document geometry and breakpoint result remain unchanged; only presentation scale changes |
| D03 | iPad full-size and narrow window, portrait/landscape | Same route graph and functionality; adaptive panes/chrome use available space, not device-name assumptions |
| D04 | Duo closed -> partial/book -> flat -> tabletop -> edge-standing | Required poses available; route, tab stacks, form values, modal, selected item, and scroll anchor retained; no reset to initial page |
| D05 | Sweep illustrative angle endpoints and intermediate values | Closed/flat/partial convention is explicit; reserved-region handling updates coherently; no claimed physical sensor thresholds |
| D06 | Partial fold with long labels, grids, sheets, and camera controls | Important text/controls do not intersect reserved band; grids fit within regions; no meaningful item hidden beneath a decorative hinge |
| D07 | Toggle inner camera active; switch RTL and orientation | Camera region respected; text/navigation adapt; hardware-relative Duo side chrome remains on the correct physical side; local pane actions stay local |
| D08 | Orbit/roll 3D view, toggle reduced motion, return to 2D | Camera transform does not mutate app layout/navigation; 3D editing is explicitly unavailable; all interaction remains available in 2D |
| L01 | Render one activity in all four variants | Shared data/identity/phase and related route; correct allowed slots and camera clearance; no four unrelated hardcoded pictures |
| L02 | Limited-width compact and multiple-activity minimal scenarios | Trailing content can be omitted without illegibility; attached/detached minimal previews; same-detail tap and keyboard Expand work |
| L03 | Switch activity to notch or iPad profile | Correct Lock Screen/banner support; no fabricated island; unsupported surface explicitly labeled |
| L04 | Running -> paused -> problem -> complete with controlled clock | Essential action updates fixture state; problem stays same job; ending removes island; any retained Lock Screen record labeled ended |
| L05 | Redacted, long-text, dark/light, reduced-luminance scenarios | No sensitive default content; readable contrast and full accessible labels; animations <=2 seconds and none in reduced-luminance mode |
| A01 | Keyboard-only complete project edit and preview journey | No drag/hover-only function, focus trap, inaccessible transformed canvas, or lost focus after dismissal |
| A02 | Screen reader through outline, inspector, preview, carousel, activity | Named controls/headings, useful state and position announcements, nonduplicated focus targets, no per-second timer announcement flood |
| A03 | Default text, xxxLarge, AX2, AX5, long localized labels, RTL | Readable reflow without title/value clipping or overlap; necessary actions reachable; count and unit formatting localized |
| A04 | Audit actual light/dark/selected/error backgrounds | Normal text >=4.5:1; meaningful non-text controls >=3:1; non-color state cues; focus visible on every surface |
| A05 | Reduce Transparency, Increase Contrast, Reduce Motion | Solid legible surfaces, discernible boundaries, no gratuitous animation, no loss of status/action feedback |
| P01 | Inspect exported configuration and demo assets | No credentials, real household footage/person data, executable code, or copied native-home assets; fixture refs resolve predictably |
| N01 | Later native renderer validation | Real-device/simulator typography, reserved regions, sheet/chrome behavior, accessibility, media and ActivityKit must be checked separately; browser pass is not certification |

## 13. Implementation handoff priorities

Build the coherent studio shell, structured document/selection model, generic component registry, and persistence distinctions first. Then complete one vertical journey: choose page -> add bound component -> configure rule/action -> reorder without dragging -> simulate -> review -> publish locally with a truthful result. The demo must use the same renderer as imported documents.

Next complete the component families and collection/navigation journeys; then device environments, fold adaptation, and activity surfaces. Keep 3D presentation last: a polished folded model cannot compensate for a nonfunctional inspector, canned pages, broken keyboard interaction, or false publication claims.

The UI research in section 2 is sufficient for the implementation owner to proceed without re-reading mobile UI source. Schema/integration owners still decide the actual supported import/export contract and runtime capability metadata. No decision here requires editing native-home or adding a native emulator.

## 14. Reference audit and immutable links

**Routing audit:** ordinary guidance mode; no enforce workflow and no native Duo migration. The exact-request helper selected 74 files: 16 foundations, 19 initial platform/component references, and 39 one-hop related references. No topics were excluded; iOS remained in scope because it was positively requested despite the prohibition on editing the native app. Related references were not recursively expanded.

- Foundations: accessibility, branding, color, dark-mode, design-principles, icons, images, inclusion, layout, materials, motion, privacy, right-to-left, sf-symbols, typography, writing.
- Initial: designing-for-ios, designing-for-ipados, designing-for-iphone-duo, designing-for-macos, buttons, collections, file-management, focus-and-selection, homekit, keyboards, labels, lists-and-tables, live-activities, modality, page-controls, playing-video, searching, settings, toolbars.
- Related: pull-down-buttons, pop-up-buttons, toggles, segmented-controls, image-views, gestures, multitasking, split-views, pointing-devices, tab-bars, designing-for-games, the-menu-bar, windows, icloud, drag-and-drop, undo-and-redo, remotes, designing-for-tvos, siri, app-shortcuts, text-fields, virtual-keyboards, entering-data, text-views, outline-views, notifications, widgets, sheets, alerts, action-sheets, popovers, activity-views, scroll-views, playing-audio, live-viewing-apps, going-full-screen, search-fields, sidebars, onboarding.
- Additional semantic references, read individually without expansion: panels, status-bars, menus, managing-accounts.

The explicit lists above are the audit record; incidental desktop/HomeKit/game/TV references supply applicable principles only and do not broaden product scope. Reference clauses and native values are from the supplied HIG snapshot, not an independent hardware measurement.

[src-home]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/UIKitPort/Features/Home/UKHomeViewController.swift
[src-home-layout]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/Home/HomeColumns.swift
[src-status]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/Home/StatusRail.swift
[src-shell]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/UIKitPort/App/Shell/UKShellViewController.swift
[src-page]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/UIKitPort/App/Page/UKPageViewController.swift
[src-settings]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/UIKitPort/Features/Settings/UKSettingsViewController.swift
[src-actions]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/TileActions/TileActionItem+Spec.swift
[src-carousel]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/Food/SuggestedRecipesCarousel.swift
[src-profile]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/Gallery/ProfileGallery.swift
[src-camera]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassUI/Features/Cameras/CameraViewer.swift
[src-island]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/FentonActivityViews/HomeActivityIslandViews.swift
[src-lockscreen]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/FentonActivityViews/HomeActivityLockScreenView.swift
[src-widget]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Apps/Widgets/HomeLiveActivity.swift
[mock-home]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/pages/home/home/home.html
[mock-profile]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/modals/shell/your-summary/your-summary.html
[mock-carousel]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/components/food/suggested-recipes-carousel/suggested-recipes-carousel.html
[mock-filter]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/modals/food/recipe-filter-sheet/recipe-filter-sheet.html
[mock-sort]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/modals/food/recipe-sort-sheet/recipe-sort-sheet.html
[mock-tiles]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/proposals/action-navigation-tiles/action-navigation-tiles.html
[mock-fold]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/proposals/duo-ipad-fold-layout/duo-ipad-fold-layout.html
[shot-large]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/proposals/weather-card-header/shipped/iPhone-header-large-long.png
[shot-ax2]: https://github.com/SFenton/native-home/blob/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/design/mockups/proposals/weather-card-header/shipped/iPhone-header-ax2-long.png
