# Studio design notes

The Studio has one workspace: **direction A, Preview first**. The spec is
`build/design/studio-ux/spec.md`; these are the rules that outlast it.

- **Preview first.** The canvas is the page. Properties appear for the selection only: a full-height inspector column on the trailing edge from 600 px wide (320 px, 288 under 744, 344 from 1280), a bottom sheet on a phone (snap points 88 px, half, full; opens at half; a swipe down from the header alone closes it).
- **Tiers.** One pure function (`layout.ts`) decides from the Studio's own viewport, never the simulated device: `phone` (under 600 wide, or 500 tall or less), `flyout` (600 to 870) and `docked` (871 and wider).
- **The library.** A 64 px rail of six categories (Tabs, Pages, Sheets, Modals, Components, Controls) and its panel. A Modal is a `modals[]` entry with `presentation.fullScreen` on; every other entry is a Sheet. Docked, the 272 px panel and the rail are **one surface**: one background, no line between them, one hairline against the canvas; it is open by default from 1200 px. As a flyout (600 to 870 px, iPad and Duo unfolded upright) the 300 px panel slides out **over** the rail from the leading edge, with no scrim, and the canvas re-fits the device once and glides it to its new box. The panel and the inspector are exclusive under 1100 px and in the flyout, so the canvas never drops under 248 px. A press on the active rail button closes its panel; open or closed is remembered per tier (`sh-studio.library`). Where the canvas is under 420 px the simulator rail turns horizontal and sits under the device; under 560 px the Checks pill hides.
- **Motion.** The panel and the inspector slide on `transform` (200 ms, flyout 250 ms, the sheet's `cubic-bezier(.32,.72,0,1)`); the device glides from its old box to its new one on `transform`; nothing animates `width`. With Reduce Motion nothing slides or scales: a 120 ms fade, and the device takes its place at once. HIG, Motion and Accessibility.
- **The Duo preview is a 3D rig** (`src/preview2/DuoRig.tsx`, numbers in `rig-geometry.ts`, motion in `fold-motion.ts`). Rules:
  - The pose is two values, `{turn, fold}` (`duo-pose.ts`): turn 0, 90, 180, 270 clockwise from the closed portrait; fold closed, partly or open. iPhone Duo opens flat and sideways. Rotate Left and Right turn it, every pose is enabled from every other, and fold and unfold keep the turn.
  - Partly folded is one display bent at the fold: two clipped live copies of the same screen, the second continuing exactly where the first ends, each tilted 18 degrees under a 1800 px perspective. No line, gap, seam or strip is drawn on the hinge. The crease is a light falloff, a gradient with no stroke, and the second half's shade starts at nothing on the hinge. Content may cross the fold and is drawn across both halves as one piece.
  - Closed, the cover half swings 180 degrees about the hinge and its back face carries the outer display. A closed Duo turns four ways with its rail on the camera's edge; the status items stack on the rail under the camera.
  - Content moves by FLIP (`reflow.ts`): a tile that changes frame is translated from where it was, and resized only when it has no child node, so text is never scaled. A new screen is drawn from its second frame so a grid never shows its first guess.
  - **Motion.** `fold-pose` (open, partly folded, a turn) is the native 0.3 s spring as a CSS `linear()` over 450 ms; `fold-swing` is the same spring over 0.5 s. Under Reduce Motion nothing tilts, swings or travels: the new pose fades in over the old in 200 ms.
  - **Glass.** Backdrop blur stays live through every fold, swing and turn. Nothing is snapshotted or cross-faded to save it.
  - In Edit the rig keeps its tilt and flattens (200 ms) only while a drag runs, so every drop target can be hit-tested.
  - **Reach.** Where a control is drawn in both copies, the keyboard and a screen reader reach the copy whose half shows it; the other is `aria-hidden` and out of the tab order (`copy-access.ts`). The Edit handle belongs to the copy that draws it.
- **Phone rule.** `(max-width: 599px), (max-height: 500px)`. Targets are 44 px on coarse pointers. One sheet at a time; deeper pages push inside it.
- **Control budget.** Wide: 9 controls on the top bar. Phone (`phone/PhoneBars.tsx`): five fixed top slots and three bottom ones, and a slot never moves and nothing sits over another; a control that cannot be used is dimmed where it stands. Top, 52 px plus the top safe area: the page button (page name over the status line, "Saved", "Saving…", "Not Saved" or "2 Problems", at least 96 px, opens Pages), Undo, Redo (gone under 360 wide, kept in the Project sheet), Publish and More, 44 px each. The status line is a status, not a button: with problems or a failed save More carries an 8 px error dot and the Project sheet's first row reads "Checks · 2 Problems". Bottom, 52 px plus the safe area (8 px at least): Edit and Use, This Page (a glyph alone under 360 wide; from 360 up it is the first to give way when a wide font leaves too little room, its name ending in an ellipsis, never under its 44 px glyph) and Add, disabled in Use.
- **This Page on a phone.** A bottom sheet (half height, full on drag) that shows one level at a time (`phone/LevelSheet.tsx`, the model in `levels.ts`): the title is the level, the subtitle is the path to it as buttons (`Crumbs.tsx`; the middle folds into a "…" menu when the room runs out), Back and Done lead and trail. A container row goes in, a leaf selects it and hands over to its properties sheet, the grip reorders within the level (the canvas's drag layer, so one move is one undo step), More is the node menu with Move To…. Add Here adds at the end of the level and offers only what it can hold; the footer's second button selects the level itself. The phone's Pages sheet has a four-part segment (Tabs, Pages, Sheets, Modals) under its search and lists what the rail items list.
- **The library's tree.** Tabs, Pages, Sheets and Modals list top-level rows (tab, page, sheet, modal). A click on one shows its surface and opens it in place to its first-level children only; a click on a child container goes into its level (header: Back, the level's name, the path as the subtitle; a path crumb or Back steps out) and selects it, so the inspector shows it where it can sit beside the panel, and in the flyout the panel stays open. A triangle opens a row in place without selecting it; Right and Left Arrow open, close and go to the parent. Rows read, left to right: disclosure, icon, title, tags, count, More, handle (the grips share one column at the trailing edge). On a coarse pointer the title keeps at least 64 px whatever the font or scrollbar: tags shrink first (ending in an ellipsis), the gaps beside the title and count are 2 px, and the tree's scrollbar is the thin one (a classic scrollbar takes 15 px on Linux; touch devices overlay theirs). The handle drags (press-and-pull on touch), and a 700 ms hold over a closed container or Back moves the drag on. Right-click opens the page, tab or element menu.
- **The Data tab.** The library's seventh category (`src/workspace2/data/`; on a phone Project > Data). It lists Data Flows, the entities the pages read, the app's own topics and the models. A Data Flow (`sh.pipeline@1`) opens in the inspector as Request, Steps and Output; the run bar says where the data came from (Live, Sample, Demo Data). The Studio holds no Home Assistant subscription and has no Run route, so a service flow draws a pasted sample or demo data, and a live list draws demo data. A sample lives in this browser beside the draft (`samples.ts`), never in the document, the publication or an export. A List (`row-collection`, and the older `collection`) has one inspector: Rows from, Row tapped, Pull to refresh, Only show when and the States. The five state texts are plain strings; Show state draws one in the simulator.
- **Use keeps a library selection (the Use marker).** Switching to Use keeps the selection, and a row clicked in Use selects and opens the inspector; the simulator still belongs to the app, so a tap in it never selects. The inspector's fields change in Use and the simulator shows it; Add, Duplicate, Move, Delete and the handle wait for Edit. The selected element is marked in the simulator with four open corner marks and a name tag (`src/preview2/use-marker.ts`, the one hook inside the simulator), where Edit has a closed ring and the handle: shape, not color, tells them apart. It leaves with the selection, and an element a rule hides has none.
- **Row icons are the Studio's own.** A row's icon is the one the person chose (Change List Icon… in its More menu, in Edit and in Use), else the thing's own, else its type's glyph; a chosen one carries a small dot. The choice lives in `native-v2/studio-notes.json` beside the draft (`GET` and `PUT /native/api/studio-notes`), never in the document, so Publish, Export and the app do not see it.
- **Opening starts from published.** When the Studio opens, `GET /native/api/ha/open-check` says what to do: a draft with no unpublished edits starts from the published layout silently (the old draft is kept as a backup, so Restore Previous Draft still works); a draft with unpublished edits asks, with Start from Published as the default and Keep My Draft; with no Home Assistant, nothing published, or a draft that already is the published layout, the draft stays and nothing is said.
- **Fields.** Properties reuse the field generator with a label map (`src/workspace2/labels.ts`); fixed single-value fields are hidden; unmapped fields go to Advanced with a mechanical label. Advanced is a fold at the foot of the body (`AdvancedFold.tsx`), closed by default and remembered per node type: the ID with Copy, the advanced fields, then one line, "Set by the app: ...", built from the node's single-value fields. A free color (`solid-rgb`) is one `ColorField` (presets, Saved Colors kept in the browser, the system picker), never Red, Green and Blue rows. A tap that asks first has its own Ask First page; the alert shows in the simulator while a field of that page has focus and when a Use-mode tap asks. Editors (When tapped, Visible when) push a page inside the inspector instead of opening a dialog.
- **No generated lists.** In the workspace the field generator draws rows only: a part is a titled group, a list item is a disclosure row (`src/workspace2/Disclosure.tsx`), never a fieldset or a `<details>`. The Project dialogs (`src/workspace2/dialogs/`) are authored rows; a list row pushes a page of its own fields. The one place the document shows as it is stored is Edit as JSON. `tests/workspace2-no-generated-lists.test.tsx` fails when either markup returns.
- **Words.** Title Case for buttons and menu commands, sentence case elsewhere; the only product name is "S+H Studio".
- **Theme.** The chrome reads Home Assistant's variables from the parent frame when it is same-origin, follows `prefers-color-scheme` otherwise, corrects derived text colors to 4.5:1, and gives the preview `--studio-selection`. The preview never takes chrome colours.
- **State styles.** A state tile's look has two homes. On the tile, the States group (`src/workspace2/styles/StatesGroup.tsx`) picks the style and overrides the icon, words, indicator and color of one state; "Show state" only chooses what the simulator draws and writes nothing. For every tile that uses a style, Project, State Styles (`StylesPanel.tsx`, `StylePage.tsx`, `RulePage.tsx`, `RequestPage.tsx`) edits the style: saved styles are editable, built-in styles are read-only until duplicated. The simulator draws a state tile through `previewTile` in `src/shared/composition/state-style-preview.ts` and never a second copy of the rules; the tile's tap plays in Use for 1 s and reaches nothing. Warning and error inks are the class's and are never a color choice.
- **Saving.** Autosave after 1.5 s with a visible status tag. One Publish; a conflict asks which version to keep.
- **Drag and drop.** A drop target shows the exact insertion point. Handles also take Space, arrow keys and Escape. Touch dragging needs a deliberate hold and cancels when a second finger joins; the properties menu offers a non-drag move.
- **Safety.** Service calls in the preview are simulated; previewing a button never controls the house. Device frames are browser previews, not iOS emulators. The one place that says so is Project > Help.
- **Copy.** Every surface's visible text is a snapshot in `tests/snapshots/copy/` and is held to the voice rules by `tests/support/copy.ts` (Title Case buttons, sentence case labels, no dashes, AI-isms or reassurance). A copy change updates the snapshot in the same commit (`vitest -u`) and is read in the diff.

- **Areas and tabs.** A tab container's children live in areas: the tree and the simulator draw them in document order, a Shared Area ("Shared · All Tabs") stays mounted while the tab changes, and an area for some tabs shows only on them. The Tabs list, the Tab Bar group (Placement Top or Bottom, Labels Automatic, Icons, Titles, Icons and Titles) and Add Shared Area or Add Tab Area are in the container's inspector (`src/workspace2/layout/LayoutEditors.tsx`); an area opens its own inspector (Shows On, Only show when). The bottom bar is a glass capsule; at the largest text size it becomes a menu. Tab edits keep the container's choice field in step (`syncTabState`).
- **Overlay and tile parts.** An overlay holds a base first child and up to four controls on top, each anchored to a corner or the center. A state tile can carry a subtitle, a progress fill and up to two round buttons.
- **Width.** Automatic, Half or Full: Automatic writes no span.

The preview (`src/preview2/`) renders the composition from `src/shared/composition/`
and the house states from `/api/native-home`; the workspace chrome is
`src/workspace2/`.

## Tile contract

Four capability ids, all pending in the shipped app (`contract/corpus/capabilities.pending.json`); each is generic and absent means today's tile, byte-identical.

- **Swipe to Adjust** (`sh.tile-swipe@1`, `props.swipe` on a state tile or a light group tile). Off by default. A row after Tap opens a page: the switch, Adjusts (Brightness, Cover Position, Fan Speed, Temperature, Volume or Custom), the range, Tick Every, Haptic Ticks, Level Band, Value Text and Name. The preview tracks the finger absolutely (band, bubble, a 1.03 lift, no scale with Reduce Motion) and sends one call on release; the tile is a slider for VoiceOver and the arrow keys. A tile in a row that scrolls sideways takes no swipe.
- **State Words** (`sh.state-words@1`, `props.words` on a light group tile, a Custom Lights brightness tile and a room overview tile). A closed State Words fold after Tap: one text row for each word the tile draws, the app's word as the placeholder, an empty field stores nothing. Count Text needs `{count}`, Level Text `{value}`.
- **Tile ink** (`sh.tile-ink-default@1`, no field). Every compiled document declares it: an idle tile's icon with no colour of its own and its state line draw the primary ink; lit, filled, unavailable and tinted faces keep theirs. A publication made before it lists no such id and stays valid (`legacyManifest`). `?ink=muted` on the harness draws the old grey for evidence.
- **Group by State** (`sh.grid-state-groups@1`, `props.groups` on a tile grid). A row in the grid's Look group opens a page: a switch (preset: On, then Off holding Off and Unavailable), a card for each group with Title, three boxes (On, Off, Unavailable), Move Up, Move Down, Remove Group, and Add Group. A state is in one group; one to three groups; an empty group is not drawn. The preview groups by the face each tile draws, in one grid with full-row headings; a regroup slides at 0.35 s only after the person's action, a house change moves with no animation, and Reduce Motion fades the moved tile.

## Profile Icon and badges

Four capability ids, all pending in the shipped app (`contract/corpus/capabilities.pending.json`); each is declared only by a document that uses it, and a document that uses none compiles byte-identical. The contract is in `docs/native-composition.md` ("Profile Icon and badges").

- **Profile Icon.** The header's Profile button (`sh.shell-profile@1`, `profile { look, badge }` on the `shell-header` item) and the `avatar` node (`sh.avatar@1`). The preview draws the initials disc in the standard blue, never a photo: the first letter of the first two words of the person's name, upper-cased; no name, or `look: symbol`, draws the person symbol. A header with no `profile` block draws the disc too, as the app does; the block only chooses the look and adds a badge. The disc is 44 pt in the header, 36 pt (Row) or 84 pt (Large) as a node.
- **Badges.** One look everywhere: a red capsule (0xD93025, white bold text, 4.77 to 1) at the top trailing corner, drawn for a number other than 0 or a text that is not empty, at most four characters. None, 0, empty and unavailable draw nothing; while a source loads it keeps its last text. A capsule on a circle (a header button, the Profile disc, a Profile Icon) sits with its centre on the 45 degree point of the edge, so its offset is worked out from the circle's size.
- **Spoken words.** `spoken` (`sh.badge-spoken@1`) is what VoiceOver says after the element's name: a tab reads "Chores, 12 overdue", a header button "Profile, 12 overdue". Empty or unavailable says the drawn text.
- **Show at Most and Spoken As.** Studio-only settings that compile to the plain operands above, never published (no id). Show at Most N draws "N+" above N; Spoken As has a line for 1 and an Otherwise line, each holding `{Count}` for the whole number.

## Dial control and the dial's text place

Two pending ids (`sh.dial-control@1`, `sh.dial-text-place@1`; `contract/corpus/capabilities.pending.json`). Absent means today's dial, byte-identical.

- **Words.** A person authoring a dial control sees **stopper** (never "operand", "predicate" or "handle id"), **Can Pass Each Other**, **Stop at Each Other** and **Stay Apart** (with a **Gap**), and **Lowest** and **Highest** for a stopper's limits.
- **The inspector** (`src/workspace2/dial/DialControlInspector.tsx`), top to bottom: **Start From** (Blank, One Value, Range, Thermostat); **Range** (Lowest, Highest, Step, Size); **Stoppers** (one disclosure row each, with its ink swatch and value; it opens to Value, Name for VoiceOver, Spoken As, Color, Trail, Lowest, Highest and, for per-stopper calls, When Released; Add Stopper until there are two); **Between Stoppers** (two only: Rule, and Gap with Use a Value… for Stay Apart); **When Released** (One Call for the Dial or One Call per Stopper, then the built call editor, whose data rows read "This Dial" and pick a stopper); **Reading, Bands, Ticks**; **Middle** (Top Line, Large Value, Unit, Decimals, Caption); **States** (Dimmed When, Enabled When, Unavailable Text, Failure Text). Leaves reuse the Studio's own fields (text token line, rules over colors, condition fields); a number is typed or picked with the value picker and read as a number.
- **Rules of the rows.** Stay Apart starts at one step; Stop at Each Other and Can Pass Each Other drop the gap. Add Stopper makes the first a trail from the start and the second a trail to the end, and a one-call dial reads the new stopper in its call; Remove Stopper drops the rule between and every read of it. Switching the form of the call carries the call over: per stopper to one call keeps the first stopper's, and one call to per stopper gives each a copy that reads its own value.
- **The simulator's dial** (`src/preview2/nodes/dial-control.tsx`) draws the app's geometry (page 316, sheet 300, compact 250). In Use a stopper drags, a tap on the ring moves the nearest one, and an arrow key on a focused stopper moves it one step (Page Up and Down ten, Home and End to its bounds); the arithmetic is `dial-control-math.ts`, never a copy. Stay Apart and limits hold in every route. A stop mark shows while a stopper is held at a gap above 0 or a limit short of the ring's end. An identical release inside 400 ms is dropped, and an edit stays until the stopper's own read changes. In Edit the dial is drawn and inert. Each stopper is a `slider` named by its label with its value and spoken value; the readout is one element.
- **Checks.** Problems the compiler refuses (a mixed call form, a literal gap past the range, over 60 dots) stay the compiler's. Notes: a stopper with no value; Stop at Each Other with the first stopper above the second; a gap with no room for both; the first-above-second note reads fixed values only (the Checks list has no Try With house, so a stopper that reads an entity is not tested there; the simulator still holds the order); a rim or trail under 3 to 1 against the track in either appearance (the track is the label color at 43%, so mid grey; new stoppers start as light and dark pairs that hold it); a speaker's volume (HIG, sliders: not for volume).
- **The Thermostat preset is a view.** A `climate-control` kind `dial` opens as a Dial Control (the tree and the header name it so) whose Start From is Thermostat. Only `props.dial` (Lowest, Highest, Step, Unit, Size) and the thermostat's entity are editable; the rows the `climate@1` model owns say "Set by the thermostat". Nothing about what it publishes changes: reading the view and writing it back is the same document, and it declares no dial-control id.
- **Thermostat never binds silently.** Choosing Thermostat on a Dial Control gives back the thermostat that node was a moment ago (the Studio remembers it for the session: its source, icon, texts, unit and range); a node with none asks "Choose a Thermostat" and reads a `climate@1` source for exactly that entity (an existing one for it, or a new one). Choosing Range, One Value or Blank on a thermostat makes that start with the thermostat's range, size and unit. Changing the thermostat's entity changes this node's binding only: a source nothing else names has its `entityId` (and that id inside `rangeCommitEntityIds` and `actionEntityId`) moved and the rest of the list kept; a source another node reads is forked for this node.
- **Read-only and not enabled** draw the readout only: no stoppers, trails or slider elements, as in the app. Tick dots are the label color on bare track and white on a trail or a band.
- **Text place** (`textAt` on the display dial). A "Text place" group in the dial's Look group with two rows, "Text centre down the height" (a share, 0 to 1) and "Then down by" (points, which do not scale with the text size). A dial that states neither is drawn as before; the preview draws the middle text at the stated place.
  The barometer's place is half the height and 4 points, production's own.
- **Offered by Add** as Dial Control (Content), starting as One Value. It still publishes only once a shipped build declares `sh.dial-control@1`.

## How Many Are…

One pending id (`sh.count@1`; `contract/corpus/capabilities.pending.json`); a document that does not use it compiles byte-identical. The Studio's word for the `count` operand is **How Many Are…**, never "count operand", "predicate" or "test". The contract and evaluator are lane SC1's; the editor and the Logic Templates starter are PR #12's (decision: `studio-logic`, "Studio PR #12 round 1: counting many entities").

- **The sentence.** "How many of these are *on*?" over a list of entities, each with its own words to match, such as "On" for a door sensor or "below 20" for a battery. It answers a number, so "None open", "1 open" and "4 open" are a rule over it, and a node can hide at zero.
- **Many things, one place.** Up to 32 entities in one How Many Are…, and a use of it costs one piece rather than four for each entity. A person never counts nodes; the limit is shown as "up to 32".
- **What counts.** An entity counts when its words match. One that is unavailable, unknown or has no state yet does not count and does not stop the others. Only when none of them can be told does the answer say it is not known yet, so a line keeps what it showed instead of saying "None open".
- **Per person.** An entity can be marked "Only for…" with one or more people (their person entities). The number then follows who is looking; an entity with no one marked counts for everyone.
- **Adding up.** A few How Many Are… values add into one number, one for each kind of thing, which is how a total such as an app icon's number is written.
- **Until it lands.** "Add Cases for a Count…" and "How Many Are…" in the Logic Templates starter write three rules, is 0, is 1 and is more than 1, over the existing `math add` of `choose` (`sh.conditions@1`, `sh.operands@1`, `sh.rules@1`; no new capability id). It covers up to three entities (`COUNT_MAX_ENTITIES`): the count is written four times and each entity costs four nodes, so a fourth passes the 64-node operand limit. The starter says so ("Counts up to three entities.") and ticks no more than three; two counts added together would be written four times each and pass the limit too. When the one-node count operand (`sh.count@1`) lands, `howManyAre` in `logicModel.ts` is the one place that changes.

## Templates

People see **Template**. The contract keeps its names (`componentLibrary`, `component-ref`, `sh.component-ref@1`) and so do the test ids. A template is linked: every
place that uses it shows the same body, and a small round link badge on the place's root says so (the badge is also on the library row). No template ships
built in: people save their own, and the owner's reusable ones are built for the owner as templates in the owner's own library.

**The library.** The Templates group of the Components palette lists them: one 48 px row for each (glyph, name, "Used in 12 places" or "Not used yet") with
Rename, Show Uses and Delete in its More menu. With none it says "No templates yet. Choose Save as Template from a component’s More menu." A click or Enter
adds a place after the selection; a drag adds it at the drop cue; in Use the rows are disabled under the palette's notice. After the list is a slot for the
Find Repeated Pieces row. On a phone the Add sheet has a third segment, Tiles, Templates, Entities, which lists the same rows (each with a 44 px More) and
a tap adds a place at the sheet's destination; its search says "Search tiles, templates and entities". Save as Template… and Unlink From Template are in an
element's More menu.

**The edit question.** A change to a template that two or more places use is held and asks "Update “name” everywhere?" with Update Template, Save as New
Template… and Cancel. None is the default, so a Return meant for a field does nothing. Update Template opens a session for that place: later changes there go
through without asking, until the selection leaves the place or the surface changes. Save as New Template… asks for a name, points this place at the copy and
leaves the others as they were. A template used in one place asks nothing. Undo and redo never ask.

**A placed template's form (settings first).** Selecting a place shows its own settings first, as any element's fields, with no heading and each under its label;
then Width; then one closed row, the template row ("Light Button" over "Template · Used in 12 places"), then Advanced. The row opens in place to a line ("A change
here asks first."), the template root's fields, and Each place sets (the list of settings) with Choose Fields…; open or closed is remembered per template for the session, and a template
with no settings opens it. A setting is the place's own and never asks; a change inside the template row does. A node inside a template, selected on the
canvas, shows its own fields under the banner "Linked to Light Button".

**Settings.** The author marks a field as a setting; up to 16 per template. Each setting has a label (`params[].label`, 1 to 80 characters; the name in words
when there is none). The kinds:
- *Entity*: the Studio's entity row (name over id) and its picker page. The chip of the template default's domain is pressed on, not restricted, so a person can
  widen it. A template that reads its entity through a source owns a copy of it (`sources`), one for each place.
- *State*: a choice row, "This Place’s Own" (the default: a new place gets its own copy of the template's local state field) or "Shared: <state>". State settings
  come last.
- *Data source* whose default source reads one entity (a light, a switch, a door; not a camera): the pairing step. The place's form shows an **Entity** row
  ("Entity", or "<label> Entity" when the template has more than one), limited to the domains the source's model accepts. Choosing an entity finds the
  document's source of that model for it, or makes one (a copy of the default source with the entity swapped, with no group members), and writes its id as
  the setting, all in one step. A second place for the same entity shares the first's source. A source that reads several entities, or none, stays a choice among
  the document's sources (`add/sources.ts`, `pairingOf` and `pairSource`).
- Page, sheet, text and symbol: the pickers those fields already have.

**Converting tiles in bulk.** `scripts/convert-tiles.ts DOCUMENT SPEC OUT` makes tile templates from a copy of a document without the dialog. A spec lists, for each template,
its name, the tile type, an id pattern and field filter that pick the tiles, and the label of each setting by a field it fills; `also` adds a setting the places
do not yet differ in (a name or icon they share today) so a new place can set it. It builds on Find Repeated Pieces and Save as Template (`repeats/convertTiles.ts`),
so each place keeps its tile's id and the worked-out document stays equal; it refuses when a tile would have to stay as it is. It touches no Studio.

**Set Per Place.** Under each entity and state field of a template, in Edit, a worded line: "Set Per Place". With no setting of that kind it creates one (named by
`suggestName`, labelled with the field's label). With one it opens a menu, "Use Light" for each and "New Setting"; Use fills this field from that setting too,
so one entity fills many fields. Once set the line reads "Set per place as Light." with "Same Everywhere", which takes the field back; the setting goes with its
last field, and each place's value for it. Setting a field per place is a change to the template, so with two or more places it asks. "Per place", not "per use".
The two buttons are named with the field after their visible words, "Set Per Place: Entity" and "Same Everywhere: Entity", so the name starts with what a person
reads (WCAG 2.5.3).

**Any field per place (`sh.component-values@1`).** A place can set any field of the template, not only an entity, a state, text or a symbol. Choose Fields… (Edit,
inside a template) shows a box on every row of the selected node and a bar pinned to the top of the panel ("Select the fields each place sets." and Done; Escape
ends it, unless a question or a menu is open and keeps its own Escape). A ticked row is set per place and keeps the line "Set per place as Title."; unticking is
Same Everywhere. A row that could share an existing setting (same schema, same optionality) opens a menu, "Use Subtitle" for each and "New Setting". Each tick is a
change to the template, so it asks once for two or more places. The boxes are named "Set Title per place" in a group named "Fields each place sets"; ticking,
unticking and Reset are spoken in the polite line. A template holds 16 settings and 128 fields set per place. The list reads "Each place sets (n)" with Remove Setting.
A place shows each such setting as the field's own editor (the color picker, the rule page, the symbol picker), with "Differs from the template." and Reset ("Use the
template’s Icon color") once it has its own; a place's value never asks, and it can be changed in Use.

The contract: a parameter of kind `value` and a `values` key on a `component-ref` (name to JSON, 16 entries, 8192 canonical bytes each), both behind the new id
`sh.component-values@1`; a document that uses neither is unchanged and declares no new id. A place with no entry takes the template's value; `null` removes an
optional field; a value may create a field the body lacks when the object holding it exists. Expansion renames private sources, then applies `args`, then `values`.
A binding may not fill a node's id, type or child lists, a field of a source, or an item of a list; two bindings on one node may not overlap. The record is
`SFenton/native-home:.agents/decisions/2026-11-16-studio-template-any-field.md` (PR SFenton/native-home#134, merged; Gate: app_wide=no).

**Repeated pieces.** "Find Repeated Pieces" sits under the templates in the Templates group, with the count once the walk has run. It opens a level of the library
panel (a phone: Project > Repeated Pieces, a half-height sheet that leaves the page showing). The walk (`src/shared/composition/repeats.ts`) reduces each node to
`type:kind:control:family`, takes the pieces of 3 or more nodes whose shape appears at least twice, outermost only, and never one that holds a template place.
It runs while the level is open, once the edits pause and a surface at a time with the main thread given back between slices (`useRepeats`), so no keystroke
waits on it. A row marks the first place on the canvas (a dashed outline and "1 of 14") and opens the proposal in the inspector: a name, "Each place sets" (one
checked row for each group of fields that differ and always change together, with an editable label), the places, and the foot with Save as Template. Unchecking a
row, or a field no parameter can fill (a number, a switch), never changes what a place draws: the places that differ there are left out and the foot says so. Save
as Template is one undo step: the entry, and each kept place replaced by a reference with its own values.

**The preview** draws what the app draws: the sources a template owns are read for each place under `<place id>~<source id>`.

## Logic Templates

People see **Logic Template**. The contract keeps its names (`logicLibrary`, `logic-ref`, `hole`) and they are never shown: no "operand", "predicate", "hole",
"parameter" or "expression" in any copy. A Logic Template is one value or one condition, written once and used in many fields; a use is linked, so a change to the
template shows in every use. The Data panel's Logic Templates group (a phone: Project > Data) lists them first, one 48 px row each: name over "Value · Used by 3" or
"Condition · Used by 3". Its More menu has Rename, Show Uses, Duplicate and Delete, on a phone too. With none the group says "No logic templates yet. Choose Save as
Logic Template from a value’s or a condition’s More menu."

**The editor** is one level: Name; "Each use sets (n)" with one row for each setting (label, kind, "tried with" value) and Add Setting…; the body in the same
value or condition editor every field has; the worked-out result with each setting's Try With value; "Used by" with the first two uses and "Show n More"; Delete
Template. Setting kinds are Entity, Person, Text, Number, Time, Value and Condition. A kind changes only while the body does not use the setting. A template holds
up to 8 settings (`MAX_LOGIC_PARAMS`) and a document 100 templates.

**Person** is a text setting that holds a person's entity id (`display: 'person'`, a hint for the Studio only), drawn as a choice among the people Home Assistant
has. An Entity setting gives a data source id, which cannot say who is using the app, so a template that asks "is this the person using the app" uses a Person
setting: the picker offers "Is Sam" for it and the body compares the person using the app (`viewer personEntityId`) with the setting. It expands before compile, so
it needs no capability id. (`viewer-person` is not that test: it compares the state of the signed-in person's entity, "home" or "not_home".) A saved component can
set a Person setting per place (`sh.component-values@1`): the value lands in the use's argument and the binding is re-pointed through the logic.

**Using one.** A value or condition field's More menu has Save as Logic Template…, which lifts the logic out and asks for a name and what each use sets (the
entities, people, texts and numbers it reads; entities and people are ticked). The value picker lists "Logic Templates" first (inside a template, "Settings" first,
then the rest); a condition's rules have "+ Template", and a comparison's Compare With a Value lists them. A use shows its template as one row ("Count or All ·
Logic Template") with a field for each setting, Open Template (with "Back to Lights" at the top of the editor), Unlink From Template ("Unlinked from Count or All.")
and the remove command. Unlinking turns the use back into its own logic and leaves the editor open for Done.

**Delete** asks only when the template is used, and counts every use, including those in the bodies of other templates (listed as "Door Words · Logic Template", a press
opens that template): "It is used by 3. Each use keeps its logic, unlinked." A use inside another template is unlinked with its template's own settings kept. An unused
template goes at once, with an undo toast.

**The preview** and every value editor work a use out with its template's body (`expandLogic`) before they compile, by the library as it is now, so an edit to a
template shows in every use at once; publication refuses a leftover setting or a missing template. The Logic Gallery sample (`src/preview2/fixtures/logic-gallery.json`:
Count or All, Yours or Theirs, Night Hours, `demo_` entities only) shows three templates used three times each.
