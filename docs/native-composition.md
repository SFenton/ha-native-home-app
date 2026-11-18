# Native composition 2.0

The first-slice compiler lives in `src/shared/composition`. It describes one
editable tree with explicit shell, chrome, page, tile, binding, action, sheet and
downloaded-asset policies. It does not dispatch page names to feature screens.

`compileCompositionDocument` returns a typed document and its exact capability
closure. It rejects missing policies, unknown fields, unsupported capabilities,
invalid references and bindings, excessive input, and conflicting chrome.
`compositionDocumentSchema` also exposes the structural JSON Schema through
Zod; semantic compilation is still mandatory.

`server/composition.ts` validates publication metadata, canonical asset-manifest
SHA-256 and capability equality. Its byte decoder rejects duplicate decoded JSON
keys before ordinary JSON parsing. Hashing stays on the server, so authoring on
ordinary LAN HTTP does not require browser secure-context crypto.

The fixture shared with the native compiler is synthetic. Compiler acceptance
does not prove SF Symbol availability, downloaded image integrity, UIKit
rendering, motion or production parity.

Schema-2 catalogs are bounded to 256 pages, 256 modals and 1,000 sources, with a
2 MiB canonical document and 64 KiB of envelope overhead. The parser allows
100,000 JSON values, retaining its depth-40 and 1,000-entry container limits.
Component depth, total component count, per-surface controls and asset limits
remain unchanged. These budgets accommodate the combined production catalog,
not just independently valid page-group fragments. Swift decoding, transport and
durable-cache budgets agree with Studio. Schema-1 document limits are unchanged;
older readers reject larger publications and retain last-good content until
upgraded.

## Integrated runtime boundary

Sections, local tabs (including initially hidden panels), status rails and room
sections participate in the same recursive validation, navigation reachability
and pending-control retention as grids. Recursive container compilation is kept
separate from atomic control parsing so the supported 12-level nesting limit
does not exhaust a worker thread's stack.

Keyed view retention distinguishes every native control family. Reusing an ID
with a different component type replaces that primitive; unchanged children and
same-type updates retain their existing views.
Auto Layout climate and bedroom controls bridge their fitted height into the
width-driven composition layout; a successful binding alone does not establish
visible, nonoverlapping controls.

Negotiated compiler support is not a promise that a domain page is composed or
that its native provider is installed. Bedroom, remote, account and collection
providers must be injected before acceptance; missing providers reject explicitly.
Inventory-list rendering remains a separate collection-lane integration. Normal
sessions install account, remote and bedroom controllers from their existing HA
connection/configuration, with pending-controller identity guards. Read-only
live previews retain their rejecting service caller, even when a configured
control can draw from live entity values.

## Paired fixture evidence

Debug native builds accept `--gallery-fixture` for device tools that supply launch
arguments rather than environment variables. The app reads
`Application Support/GalleryFixture/bootstrap.json`, containing a scenario `id`
and `variables` with an existing `FENTON_GALLERY` page, `FENTON_GALLERY_*` settings
and optionally `FENTON_BACKDROP_FIXTURE`. Other keys, including credentials and
background-operation overrides, are rejected. The normal account is untouched;
push, location and Live Activity operations stay disabled. Malformed input shows
an explicit fixture error and removes any previous success receipt.

An optional `referenceTime` is a finite Unix timestamp from 0 through
253402300799. It pins date-dependent synthetic weather, security, chores, food,
room-device, bedroom and vacation inputs. Omitting it preserves the galleries'
wall-clock behavior. It does not freeze animations or live-domain display clocks;
those remain separate comparison prerequisites.

For still-frame comparisons, `pauseContinuousAnimations: true` uses the existing
native gallery pause policy for continuous decoration, including rain and snow.
It does not enable Reduce Motion or skip navigation transitions. Animated
journeys must separately run with the option omitted or false.

The local receipt records the input SHA-256 and optional reference time, not
fixture values or credentials, and reports whether continuous animation is paused.
It proves fixture preparation, not rendered parity. Baseline source revision,
test-entry overlays, binary hashes, actual Expo observations, data, pose and
appearance must still match each paired comparison. A source-built simulator
reference is not the signed production IPA.

## Negotiated shared shell primitives

The frozen first-slice fixture and capability list are unchanged. The additional
closed capabilities are `sh.section@1`, `sh.rows@1`, `sh.local-state@1`,
`sh.local-controls@1`, `sh.local-tabs@1`, `sh.primary-button@1` and
`sh.row-collection@1`. Each publication still declares exactly the capabilities
its tree uses, in sorted order.

| Wire node | Configurable values | Native primitive / limit |
|---|---|---|
| `section` | header, footer, plain/module-list style, thin/dense density, glyph hairlines, spacing, children | `UKColumnView`, `UKPageSectionHeaderView`, `UKModuleListView`; module-list children must be rows or local controls |
| `row` | typed primary/secondary/value slots, optional SF Symbol, accessory, phase copy, optional action | `UKRowView`/`UKRowButton`; no feature identity |
| `local-control` | stateId, kind, placeholder | canonical switch, integer stepper, menu choice, text field, or 2-4-option segmented choice |
| `local-tabs` | stateId, ordered id/label/children, canonical swap policy | canonical segmented/menu choice and retained panels in `UKSmoothContentSwapView`; 2-4 tabs |
| `primary-button` | title, optional icon, action, explicit empty props | `UKPrimaryButton`; local/navigation actions only |
| `row-collection` | providerId and loading/empty/unavailable/error/stale copy | injected `ServerUIRowCollection`, at most 100 unique read-only rows; no paging, filtering, row actions or virtualization |

`row` and `primary-button` reject domain actions. A domain-specific busy/failure
and confirmation adapter is required before such commands can be exposed there;
the existing action tile keeps its existing power semantics.

Optional top-level `localState` defines scene-only fields. It is not HA state,
persisted settings, a credential store, or a substitute for domain drafts:

```json
{
  "localState": [
    {"id":"enabled","type":"boolean","initial":false},
    {"id":"label","type":"string","initial":"Sample","maxLength":40},
    {"id":"count","type":"number","initial":2,"minimum":0,"maximum":10,"step":2},
    {"id":"panel","type":"choice","initial":"details","options":[
      {"id":"details","label":"Details"},{"id":"options","label":"Options"}
    ]}
  ]
}
```

These are fragments, not complete publications. A local action is
`{"type":"set-local","stateId":"enabled","value":{"type":"boolean","value":true}}`.
Scalar types are exact; values are not coerced or clamped. Numbers must be finite,
in range, and on the declared step. Local tabs must match their choice field's
option IDs, order and labels. Initial values are seeds, not publication resets.
Removing a changed field or narrowing a field to reject its live value blocks
native acceptance. The renderer also blocks updates while an editor has focus or
a local-tab transition is active.

The **Local state** workspace section and generated component inspector expose
all these fields. State references use selectors; local tab IDs select an
existing choice option and copy its label. Components can move between sections
and individual local tabs as well as surfaces/grids; moving outside a grid sets
span to 1. Referenced local fields cannot be deleted.

The native parent supplies `collections: [String: ServerUIRowCollection]` to both
`UKServerUIRenderer.preflight` and its initializer, before accepting a document
using that provider. A missing provider is an explicit `unavailable_source`
rejection, not an empty success state. A domain store updates that projection
on the main actor through the existing EntityStore/HassConnection path. `apply`
with nil rows retains last-good data for loading, stale, failed and unavailable
phases; a successful empty result is an explicit empty array in the ready phase.

`ServerUIDraft` is a native adapter boundary only: immutable owner/record identity,
typed values, dirty baseline, pinned save ticket, pending mutation/discard
protection, and failure retention. The adapter must supply its real save closure
and wire `UKDiscardGuard` to every exit and publication boundary. No form guard,
save toolbar, date field, pinned modal tab bar, image node or adaptive split is
advertised as publishable by this extension.

This reuses existing control/layout/motion designs, not new presentation policies.
HIG references: Lists and tables (row semantics), Segmented controls (short
choices and clear selection), Text fields (editable native text), Accessibility
and Typography (Dynamic Type), and Motion (the existing reduced-motion branch).
The module-list, primary-button, segmented-choice and page-section-header atlas
entries remain the design references; no device/visual certification is implied.

## Workspace and durable storage

The Studio has one workspace, the 2.0 workspace. Files an earlier Studio left
beside the composition namespace (`draft.json`, `published.json`, `revisions/`
and `feedback/` from the retired schema-1 workspace) are never read, validated,
migrated or removed, and a new data directory does not create them.

`StudioStore` holds the existing exclusive `DATA_DIR` lock and opens a
`native-v2/` namespace beneath that same directory:

- `state.json` atomically contains the draft and the selected published revision.
- `revisions/<revision>.json` contains immutable, server-validated 2.0 envelopes.
- `assets/<sha256>.png` or `.jpg` contains immutable image bytes the layout already references.

A new namespace starts with a minimal document containing no house data
and generated publisher/document identities. These identities persist across
saves and restarts. A save cannot change the document ID. A successful save
increments the draft revision; a publish snapshots that exact revision. Retrying
publication of the same revision returns the original snapshot, including its
timestamp. An interrupted publish may leave an unselected snapshot; retry checks
and reuses it instead of overwriting it.

Draft and publication writes use file sync, atomic rename/link and directory
sync. Saves and publishes are serialized with expected-revision checks.
Compiler, asset and conflict failures leave the last durable draft/publication
unchanged. Startup validates stored shapes, capability closure, manifest digest,
identities and referenced image files. Corruption fails startup rather than
resetting either workspace. The existing lock's unclean-shutdown recovery policy
still applies; never remove a live server's lock.

## Authenticated native API

The native app no longer reads this API. Production delivery goes through Home
Assistant (see [Publishing to Home Assistant](#publishing-to-home-assistant));
`GET /native/api/published` remains only for local inspection and the DEBUG
publication preview. Asset descriptors keep `source.path` as
`/api/assets/<sha256>.<png|jpg>`; do not insert `/native` into the document.

All `/native/api/*` reads and writes require the existing Studio bearer token,
session cookie or verified Supervisor Ingress identity, even in otherwise
anonymous development mode. Existing login, session lifetime, origin/CSRF
checks, rate limits and path rejection apply. `/native/api/auth` is an alias of
the existing JSON login; no anonymous publication or asset route exists.
No Home Assistant requests/actions are added by this workspace.

| Route | Contract |
|---|---|
| `GET /native/api/draft` | Draft metadata: `envelopeVersion`, `publisherId`, `revision`, `updatedAt`, exact `capabilities`, `assetManifestSha256`, `document` |
| `PUT /native/api/draft` | JSON `{document, expectedRevision}`; full compilation, server manifest hash and asset verification before persistence |
| `POST /native/api/validate` | JSON `{document}`; structural/semantic compilation only, not asset-byte or native preparation |
| `POST /native/api/publish` | JSON `{expectedRevision}`; revalidates draft/manifest/assets and selects immutable snapshot |
| `GET /native/api/published` | Exact 2.0 publication envelope, private ETag revalidation and 304 support. Debug preview only; Studio authentication required |
| `GET /native/api/ha/publication` | Home Assistant's current and history entries (`revision`, `publishedAt`, `publishedBy`, `envelopeSha256`, `capabilities`) and `storedAssets`; never an envelope |
| `POST /native/api/ha/publish` | JSON `{expectedRevision}`; freezes that draft as the local publication, then publishes it. Returns `{epoch, revision, envelopeSha256}` |
| `POST /native/api/ha/rollback` | JSON `{revision}` from the history; Home Assistant makes it current under a new revision. Returns `{epoch, revision, envelopeSha256}` |
| `GET /native/api/schema` | Generated closed structural JSON Schema, not a replacement for compilation |
| `GET /native/api/export?source=draft\|published` | Saved document JSON (not publisher metadata or embedded image bytes) |
| `GET /native/api/assets/<sha256>.<png\|jpg>` | Verified bytes, correct MIME, private immutable caching and ETag/304 |

JSON write bodies are bounded to 2 MiB plus 64 KiB of envelope space and scanned
for duplicate decoded keys and invalid UTF-8 before JSON parsing. The document
still has its independent 2 MiB, depth, node and semantic bounds. Unknown request
fields are rejected. Validation returns 422 with value-free `issues` and readable
pointer/code `errors`; stale revisions return 409 with `currentRevision`.

Stored images are 1 through 8,388,608 bytes, at most 8192 pixels per side and
16,000,000 total pixels. MIME/signature, bounded PNG chunks/CRCs, static PNG policy,
JPEG marker/frame headers and dimensions are inspected without allocating decoded
pixels. Native remains the final decoder and dimension/frame verifier.
Save/publish verify every descriptor against the actual file. External/file URLs,
traversal, missing bytes and descriptor/file mismatches are rejected.

The Studio accepts no image from a browser. The wallpaper panel shows the current
image read-only, with No Image, blur and scrim.

## Structured authoring and limits

The inspector is generated from the same closed schema, over one document tree.
Tabs, chrome groups/items, pages, modals, components, source paths and gradient
stops have ordered lists with add/delete and Up/Down controls. Page, modal, tab,
source and asset references use selectors. Components can move between pages,
modals and grids; self/descendant parenting is rejected. Moving to a surface
resets its span to the only supported value, 1.

Text, tile-grid, navigation-tile, action-tile, alarm-panel and door-tile variants expose their supported
Properties, native spacing/dimension policies, actions, confirmations, bindings,
symbol names and unavailable text. Sheets expose full height or canonical
content fitting following the root/top page, local navigation and close policies.
`sh.sheet-fit@1` uses `firstOpen: canonical@1`: the existing native host owns
measurement, motion and Duo height rules. It does not claim custom first-frame
premeasurement. Fit-memory scope belongs to the native session and geometry, not
an author-supplied global key. Grids can select `tile-dynamic-type@1`
(`sh.grid-dynamic-type@1`) for the production subheadline-scaled minimum.
Fixed native policy constants are visible but read-only.
New schema-supported fields appear without a second editor representation.
Climate sources use `model: climate@1` with explicit `inputs.entityId` and
`rangeCommitEntityIds`, plus optional `actionEntityId`, `sensorEntityId`,
`effectiveAway`, `homeAway`, `trackingGate` and tracking-room inputs.
`climate-control` has closed `kind` variants: dial, hub, notice, toggle, check,
explicit-switch, mode, fan, preset, options and status. Their generated fields
include bounds/step/units/size, labels/SF Symbols, ordered supported choices,
away copy, explicit command targets and unavailable/failure copy.
Each negotiates `sh.climate-source@1` plus its exact `sh.climate-<kind>@1`
capability (`explicit-switch` shares toggle). There is no Climate page-ID dispatch.
The source exposes typed tracking counts and enable flags when tracking inputs
exist; shell-owned value formatting/composition must consume those fields.
No local-tabs, conditional layout, room-row compound attachment or derived
predictive-bullet capability is implied. Such recipes remain nonpublishable
until the corresponding interfaces exist, not successful placeholder screens.
Compiler diagnostics stay visible; invalid local intermediates cannot be saved.
Optional fields have explicit Include controls; removing one omits it rather
than writing `null`. Navigation tiles expose standard/anchored-bottom layout,
0–2 title lines, standard or bounded RGB fill, body hints, and navigation-path
or no selection. These opt into `sh.tile-presentation@1`; solid RGB faces require
the neutral family and retain the canonical native white/filled ink.
An empty navigation subtitle (literal or read) renders without a subtitle line
or its spacing; nonempty text is preserved.

Stable IDs are read-only in structured controls. Variant changes preserve IDs
and common display/layout fields. Deleting a referenced definition is blocked
with the relationship pointers; reassign its consumers first. Advanced JSON is
an explicit escape hatch and is compiled before replacing local work.
Import/export operate on document JSON. Import is explicitly **content-only**:
it retains this workspace's publisher/document identity, and images are not
carried. Export includes unsaved
local edits and does not implicitly save or publish.

Save and publish are distinct buttons; publishing dirty work saves first.
Conflicts retain local edits, offer confirmed reload/discard, or explicit
keep-local replacement against a newly read revision. Undo/redo, failed import
and delayed save responses retain local work.

This slice supports up to five native tabs, grouped chrome, column pages
(`navigation-columns`, with `onDemand` and `standalone`), canonical fitted or
full-height local-stack sheets, sheets that open beside their list when there is
room (`adaptive`), full-screen sheets (which cannot also be adaptive), routes
with aliases, keywords, Siri suggestions and viewer rules,
text/grids/navigation/power tiles, typed HA-entity,
power/alarm/lock/garage/camera models, inventory and todo summaries, configured vacuum controls,
and same-publisher PNG/JPEG backdrops. Power toggles are
limited to `switch` and `input_boolean`. Content-image assets/nodes, forms,
arbitrary styling/fonts, other service
models and external asset URLs are
not supported. Navigation that is not supported yet: route arguments, assigning a
page to a pane (`content-panes`), per-section Duo sides (`section-sides`), more
than five tabs or flyout items (`sh.extended-tabs@1`) and a custom back target.
It adds no product-specific feature dispatcher.

## Publishing to Home Assistant

The Studio is the only writer of native compositions. It delivers them through
the `fenton_home` integration (1.4.0 or newer, `ui_publication`); the native app
follows that publication over its one Home Assistant websocket and fetches images
from `GET /api/fenton_home/ui_assets/<sha256>`. The Studio no longer issues
reader credentials: the former `POST /native/api/readers`, `shr_` credentials,
enrollment export and Bearer reader access to `/native/api/published` and assets
are removed. A leftover `native-v2/publication-readers.json` in an existing data
directory is tolerated and never read; delete it when convenient.

**Connection.** As a Home Assistant app the server uses its own `SUPERVISOR_TOKEN`
(`homeassistant_api: true`) against `ws://supervisor/core/websocket` and
`http://supervisor/core/api`, so no user token is stored. In development it uses
`HA_URL` and `HA_TOKEN`. The credential stays on the server: it is never
returned, logged, or included in an error.

**Publish to Home Assistant** (workspace header, needs a valid document):

1. Saves local edits, then freezes that draft revision as the local publication
   (the same step as **Publish native**; idempotent for an unchanged revision).
2. `fenton_home/ui_publication/publish {envelope}` stores the validated envelope as
   the next revision and notifies subscribed apps. The result is
   `{epoch, revision, envelopeSha256}`; the Studio shows the revision. A document
   that references an image Home Assistant does not hold is refused with
   `missing_asset`; the Studio sends no image.

Publishes and rollbacks are serialized.

**History and rollback.** The *Home Assistant* section lists the current revision
and Home Assistant's history (revision, time, publisher). *Roll back* asks for
confirmation, then makes that entry current as a new revision; the Studio draft
is not changed.

**Errors.** Integration reasons become fixed Studio messages and Home Assistant's
own text is never forwarded: `too_large`, `not_json`, `too_deep`,
`bad_capabilities`, `bad_asset_manifest_hash`, `bad_document_hash`, `bad_document`
and `bad_assets` (HTTP 422), `missing_asset` (409), unknown rollback revision
(404); an unknown
command (integration missing or older than 1.4.0), a non-administrator
credential, or an unreachable Home Assistant (502); Home Assistant not
configured (503).
The native app trusts Home Assistant's authenticated user, not a publisher
address. Before anything is published it uses only its compiled sign-in and
configuration-recovery boundary, never a compiled dashboard fallback.

`sh.activity-presentation@1` now has a production consumer: the existing widget
reads the accepted app-group copy and injects it into every `ActivityCard`.
`jobId` is the exact engine tag minus `job.`, distinct from the stable editor
`id`. The engine still owns controls, state, links, timers and update cadence.
The allowed tint families include `cooling` for the existing Hot Flash job;
`engine` preserves mode-dependent native colors such as vacuum mopping.

`sh.native-extensions@1` enables the optional document `extensions` field:

```json
{
  "type": "native-extensions@1",
  "watch": "stub@1",
  "routes": [{
    "id": "home-search", "path": "home", "pageId": "page-home", "tabId": "tab-home",
    "title": "Home", "summary": "Your house", "icon": "house.fill",
    "anchors": [{"fragment": "details", "modalId": "modal-details"}]
  }],
  "cameras": [{
    "entityId": "camera.demo_unit", "title": "Entry",
    "liveLabel": "Live", "unavailableLabel": "Stream unavailable"
  }]
}
```

Routes (at most 64) bind existing system paths/Spotlight to validated pages and,
optionally, tabs and room-anchor modals. Unknown destinations remain pending
with explicit recovery instead of opening a compiled feature. Cameras (at most
32) change notification copy only. The generated Extensions inspector exposes
all fields, relationship selectors and optional attachments. Duplicate jobs,
paths, IDs, camera targets and anchor fragments are rejected. Watch is exactly
the existing stub, and no new conventional widget is claimed.

The app-group payload omits routes, credentials, house state, commands and assets,
is bounded to 64 KiB, and is decoded independently in extension-safe native code.
It is atomically protected before promotion, fenced to the OAuth session and
removed at logout. Failed acceptance retains/rolls back last-good. Existing
activities render the copy on the next system update; publishing does not
manufacture ActivityKit content updates or broaden live-action permission.

Bootstrap setup entries may omit `explanation` to preserve the canonical,
state/device-specific permission copy. A provided explanation is supplemental;
the native permission state machine and system alert remain authoritative.

This is **not** a pixel-perfect browser/native preview or full production parity.
The parent must deploy matching server and client artifacts together, configure
the authenticated `/native` endpoint, extend typed native primitives for further
curations, and perform native preparation/device comparison. The production
server, live `dist/` and existing saved data must not be
changed by validation.

## Contract with the app

The app compiles whatever the Studio publishes, so the two must accept and reject the same documents. The shared
corpus in [`contract/corpus`](../contract/corpus/README.md) is copied byte for byte into the app; `tests/contract-corpus.test.ts`
runs every file through the Studio compiler and compares the first issue, and the app runs the same files through its own.
`contract/corpus/capabilities.json` is the app's capability list; the Studio test fails when either list changes alone.

Rules the corpus pins down:

- **Bedroom configuration** (`bedroom-config@1`) carries entity IDs only. `tonightScript`, `outsideScheduleScript`,
  `scheduleSetTopic`, `hotFlashBrokerScript` and `householdAwayScript` are rejected as unknown fields; the app resolves
  scripts and topics from the house document by role.
- **Remote commands** (`media-remote-config@1`) may call any domain, service or script. Only the shape is checked
  (`src/shared/composition/service-vocabulary.ts`, mirroring the app's `ServerUIServiceVocabulary.allows`): a target must
  start with the called domain and a `script` call has no target. The per-slot service tables and the publish-time
  house-script check are gone; Home Assistant enforces what each person may call.
- **Logic library** (Studio only, `src/shared/composition/logic-library.ts`). A draft may hold `logicLibrary`, up to 100 entries
  `{id, name, kind: 'operand' | 'condition', params[], body}` (up to 8 parameters of kind `source-id`, `text`, `number`,
  `operand` or `condition`, each with an optional `label`, `sample` and, for a number the editor draws as a time of day, `display: 'time'`, and for a text that holds a person's entity id, `display: 'person'`; both are editor hints only and change nothing a use or an expansion does), and uses `{type: 'logic-ref', logicId, args}` wherever an operand or a condition stands. The body
  marks each argument with `{type: 'hole', name}` and may itself use other entries (a departure from the design proposal, which kept bodies flat). Before anything else reads the draft, `expandLogic` works every use out
  (an entry may use another to depth 4; a cycle is refused), so capabilities, the budgets (8 deep, 64 nodes, 32 condition
  nodes) and the 100,000-value cap all see plain operands and conditions. Expansion has its own budget of 100,000 values, which also
  counts what each hole copies, so nested arguments cannot make a draft grow without bound; it reports `limit_exceeded`. Issues carry the `/document` prefix like every compile issue; those found in worked-out text are reported at the
  use's `args` pointer. A publication holds no library, `logic-ref` or `hole` (`assertNoLogic` refuses one), the capability list
  is unchanged by it, and native and the shared corpus never see it. The draft stays the master: `draftIsLive` and the open
  check compare the worked-out draft with what the app serves. A saved component whose binding fills an argument of a use in its
  body has the binding re-pointed to every field the argument lands in (also into a string inside an operand argument);
  a binding that points at no string in the argument is refused as `binding_type` at the binding. House import (`POST
  /native/api/import-house-config`) answers 409 for a draft that holds a library. A published copy of a use costs its worked-out size
  (a count phrase of one case and an otherwise: about 62 values and 790 bytes per use, node included).
- **Generic actions and rules** (`src/shared/composition/expression.ts`, native-home 7154723). `call-service` is an action
  (`sh.call-service@1`): any `domain.service`, a `target` of operands (`entity_id`, `device_id`, `area_id`, `floor_id`,
  `label_id`), `data` as an `object` operand, `optimistic[]` keyed by a declared `ha-entity` source, and an optional
  `confirmation` (`policy`, or `additional` with `exemptUserIds`). It runs only on a tap. `bound-control`
  (`sh.bound-control@1`) is a toggle (row or tile, `isOn`, `onAction`, `offAction`), stepper (`value`, `range`, `format`,
  `action`), slider (`value`, `action`; no range or format), choice (2 to 12 `options`, each with `selectedWhen` and an
  `action`) or button (`action`). Operands (`sh.operands@1`) are `literal`, `read`, `control` (only inside a bound control's
  own call), `viewer`, `format`, `map`, `math`, `object` and `list`; the published grammar has no template language (the Studio's draft has one, below). Predicates are `state`,
  `numeric`, `viewer`, `viewer-person`, `all`, `any` and `not`. Limits: depth 8, 64 nodes per expression (128 per call),
  texts 2,000 characters. `visibleWhen` (`sh.visible-when@1`) with `whenUnknown` (`show`, `hide`, `keep`, default `keep`) sits
  on nodes and navigation tabs, never on children of a module list, paged row, status rail or room section, and never on a
  room device control. `selectedWhen` (`sh.selected-when@1`) is on choice options and `local-tabs.props.automatic`. Reads in
  expressions name an `ha-entity` source with path `["state"]` or `["attributes", ...]`. `visibleWhen` is presentation, not
  access control: every signed-in person receives the whole publication, so no secret belongs in `data`.
- **Warnings**, never blocks (`src/shared/composition/lints.ts`): a `lock`, `alarm_control_panel` or `cover` call without an
  `additional` confirmation, and data fields named like secrets. They show in the validation panel and beside the call.
- **Object keys** that are equal after Unicode NFC normalisation are duplicates, in the streaming parser and in the bounds walk.
- **`collection.props.pullToRefresh`** is an optional boolean, off unless true, and adds no capability beyond `sh.collection@1`.
- **Home nodes** (status chip, room tile, weather panel, climate control) accept `present` actions with `ifPresented: "reject"` only.
- **State styles** (`sh.state-style@1`, `src/shared/composition/state-styles.ts`). A document may carry
  `stateStyles: { type: "state-styles@1", styles: [...] }` (at most 32) and a page may carry `state-tile` nodes. The capability is
  required when either is present. See [State styles](#state-styles-shstate-style1) below.
- **Data Flow** (`sh.pipeline@1`, `sh.pipeline-operands@1`, `src/shared/composition/pipeline/`). A data source `model: "pipeline@1"` asks
  Home Assistant for data, runs a closed pure list of steps on the answer and gives rows, a record or one value. See
  [Data Flow](#data-flow-shpipeline1) below. It is a publishing warning, not a gate, until the app can read it. It is shipped, operands included (native-ingest c1a42b32): see
  [Expressions, rules and app state](#expressions-rules-and-app-state).

## Additional capability notes

Schema-2 configured remotes accept the native `speakerdevice` argument as an
array of at most 16 entity IDs. Its use, including in a conditional command,
requires `sh.remote-speaker-targets@1`. Existing `sonosdevice` calls retain their
original capability requirements; unknown argument fields are still rejected.
The read-only `wake-summary` bedroom atom exposes canonical modal status copy,
typography and alerts through `sh.wake-summary@1`; it requires a wake-light provider.
`wake-hold.showsExplanation` opts into the integration-aware hold footnote through
`sh.wake-hold-explanation@1`. Text supports secondary-ink Dynamic Type subheadline
and footnote styles through `sh.supporting-text-styles@1`; original styles remain unchanged.
`section-title` text uses the native sheet's bold title3 font and accessibility
heading trait through `sh.section-title@1`, without changing existing page headers.
`wake-stop.episode` adds the canonical active-episode card through `sh.wake-episode@1`,
with editable heading, detail and pending label. Omission keeps the original button.
Alarm name/type fields expose optional `showsHeading` through
`sh.bedroom-field-headings@1`; weekday choices can pair abbreviated visible labels
with `accessibilityLabel` through `sh.weekday-accessibility-labels@1`.
Surface `titleSourceId` (`sh.surface-title-source@1`) must name an alarm draft
used on that surface. The native title stays tied to the opened alarm until reload.
`alarm-feedback` offers shared native `error` and `problems` slots through
`sh.alarm-feedback@1`; place the error slot at the top level to avoid repeating
provider feedback under individual fields. Draft state controls Reload, Delete,
creation-only bed targets and guarded Back without authoring a second save flow.
Wake `alarm-delete` questions offer `messageFormat: "wake-alarm"` through
`sh.wake-alarm-confirmation@1`. Edit the message normally, using `{time}` and
`{schedule}` for the opened alarm's details. Other placeholders, malformed braces
and non-wake draft sources are rejected. Omit the format for literal copy.

## Configured live adapters

### Atomic vacuums

`vacuum@1` is a model source with a closed `inputs` descriptor. Targets, scripts,
map ID/focus/rotation/scale, room membership/order, consumables, and report
names/reconciliation entities are editable structured fields. The synthetic
descriptor in the vacuum fixture module under `tests/fixtures` matches the native
`ServerUIVacuumDescriptorFixture.json`; no production configuration is supplied.

Each `vacuum-control` component has `props.sourceId` and an explicit
`props.primitive`. Its `kind` selects card, map, status, notices, settings,
command, choice, consumable, report, outcomes, target, clear-area or area-editor.
Order, title, command/target symbols, map heights/copy/overlay and navigation
attachments are authored. Settings have ordered role/title/hint entries.
Choices and consumables must belong to their source descriptor.

```json
{
  "id": "demo-map", "title": "Current Map", "type": "vacuum-control",
  "layout": { "span": 1 },
  "props": {
    "sourceId": "source-robot",
    "primitive": {
      "kind": "map", "overlay": "rooms", "height": 300, "runtimeHeight": 460,
      "label": "Demo map", "loadingText": "Reading map",
      "unavailableText": "Map unavailable", "locate": false
    }
  }
}
```

The source needs `sh.vacuum@1`; map needs `sh.vacuum-map@1`;
report/outcomes need `sh.vacuum-outcomes@1`; area-editor needs both
`sh.vacuum-area@1` and `sh.vacuum-map@1`; other primitives need
`sh.vacuum-controls@1`. Existing navigation/binding/shell capabilities still
come from the surrounding document. Unused or missing capabilities reject.

Card `commands` are ordered distinct `start_pause` and/or `dock`, preserving
the native page provider and optimistic rollback. A sheet command instead
selects a canonical `VacuumController.Action.Kind`; Clean coordinates the
committed room/area target. Card/report/target destinations must explicitly push
or present; area-editor Use/Discard must explicitly go back or dismiss. Native
target-switch confirmations cannot be removed by authoring and revalidate
before applying. Unsupported services disable commands.

These are atomic adapters, not a production vacuum-sheet recipe. Ordered
local tabs, status-rail styling, shared collections/rows, split layout,
route/draft/focus preservation and the native 130/170 ms content swap require
the owning shell/home interfaces. Such recipes remain non-publishable until
those capabilities exist; do not replace them with a vacuum page dispatch key.

These are additional negotiated capabilities, not additions to the frozen
`firstSliceCapabilities` or fixture. Both compilers derive the exact sorted
closure; declaring an unused capability or omitting a used one still rejects.
Every object below is closed. Source targets, labels, state lists, symbols,
bounded RGB channels and status copy are generated structured inspector fields,
not expressions or raw-JSON-only controls. Source variants retain `kind: model`;
the fixed `model` policy identifies the selected adapter.

### Alarm panels and door controls

`alarm-panel` adds `sh.alarm-panel@1` and binds `props.sourceId` to an
`alarm-mode@1` source. The generated inspector exposes the ordered `modes`
(state, label, hint, SF symbol, RGB fill), `states` and `fallback` appearances,
subtitle, since prefix/separator, loading/unavailable/hidden/error/pending copy,
triggered wash and confirmation copy. States/modes cannot repeat. Native policy
maps the four supported modes to explicit services; it is not editable. Disarm
always asks using a native alert, and Cancel always sends nothing.

An alarm panel is a primitive: compose it in a normal page or standalone modal,
or push its page from Quick Links into the current modal's local stack. The
renderer does not select a whole feature controller by page ID.

`door-tile` binds `props.sourceId` and `props.kind` to a `security-door@1`
source (`sh.security-door@1`). Inputs are a literal `entityId` and `kind: lock`
(`lock.*`) or `kind: garage` (`cover.*`). The inspector exposes state copy,
symbols, fills, active/error appearance, failure/sending copy and action labels.
Both body and disc use the same canonical command. Locks use explicit lock/unlock;
garages use the existing open/close/reverse controller and its feedback, lockout
and timeout rules, not a generic cover Stop or power-toggle adapter.

Immutable commands revalidate the target and live state at execution.
Publication cannot remove or retarget a pending source or control; feedback
timeout/live acknowledgement does not end the actual network lifetime.
`src/shared/composition/security-example.ts` shows the synthetic local-push and
standalone-sheet recipes. `tests/fixtures/security-nodes.json` is the same
synthetic wire fixture used by native Core and hosted tests.

These are atomic security controls, **not** a complete Security-page recipe.
Camera, contacts/status rail, split sections and conditional guest-presence
composition still require the owning camera/shell interfaces. No unsupported
surface is replaced with a successful placeholder.

### State styles (`sh.state-style@1`)

A style is a named state map the app resolves into the four layers of the state-styled tile: icon, text, indicator and colour.
The design rules are `.agents/design/state-styles.md` and `state-styled-tile.md` in the app repository. Capability name and shape
are identical in both repositories.

```json
"stateStyles": { "type": "state-styles@1", "styles": [{
  "id": "tidy-vacuum", "name": "Tidy vacuum", "base": "robot", "domain": "vacuum",
  "rules": [
    { "states": ["cleaning"], "class": "resting", "active": true, "icon": "fan", "text": "Tidying", "indicator": "breathe" },
    { "states": ["unavailable", "unknown"], "class": "unknown", "active": false }
  ],
  "fallback": { "class": "unknown", "active": false },
  "request": { "lockoutSeconds": 2, "ackTimeoutSeconds": 10, "settleTimeoutSeconds": 45, "errorHoldSeconds": 8, "onTimeout": "error" }
}] }
```

A tile applies a style by id:

```json
{ "id": "robot-tile", "title": "Vacuum", "type": "state-tile", "layout": { "span": 1 }, "icon": { "type": "sf-symbol", "name": "fan",
  "rendering": "canonical", "unavailable": "fallback" }, "props": {},
  "binding": { "entityId": "vacuum.demo_robot", "styleId": "tidy-vacuum", "builtIn": "robot",
               "overrides": [{ "state": "cleaning", "text": "Vacuuming", "indicator": "pulse" }] } }
```

- **Rules** are tried in order, first match wins; `fallback` is the rule for every other state. A rule gives `class`
  (`resting`, `in-progress`, `warning`, `error`, `unknown`), `active` (lit or unlit face) and optionally `icon` (SF Symbol name),
  `text`, `indicator` and `colour`. `unavailable` and `unknown` must be the `unknown` class.
- **Indicators** are the closed list `none`, `arc-spinner`, `pulse`, `breathe`, `bounce`, `wiggle`. `arc-spinner` is rejected
  (`invalid_combination` at the rule's `indicator`) on a rule that has an `action`, and on the `unknown` class: the arc stands in
  for the disc, so a state whose tap does something keeps its disc. The same check applies to a tile override, against the style
  the tile resolves to.
- **Fill and hidden words** are a separate id, shipped by the app: see [Fills and hidden words](#fills-and-hidden-words-shstate-style-fills1) below.
- **Colour** is `unlit` or `lit`, the face of a resting or in-progress state; never changes the class. A colour on a warning, error
  or unknown state (a rule, or a tile override resolved against its style) is `invalid_combination` at the `colour` pointer.
- **Action**: `verb`, `icon`, `service` on the style's `domain` (absent: nothing to send), `tappable` (default true),
  `confirmation`, and `requiresFeature` (a `supported_features` bit) with `otherwise` (the same action without it).
- **Request**: client timings in whole seconds, `onTimeout` (`error` or `revert`), `pendingWords` by service, `errorWords`, and an
  optional Home Assistant `script` with its `errorTimer` (a `script.*` and a `timer.*`, named together). The Studio installs
  neither; it checks they exist and warns when one is missing.
- **Tile binding**: a literal `entityId`; `styleId` (the library style) and `builtIn` (the tile's own built-in style) - at least
  one; `overrides` per state, one layer or more each, a state once. The entity is in the domain of the style it ends up with.
- **Fallbacks, never rejections**: a `styleId` the library does not define is accepted and the app uses `builtIn`; a device
  without the capability keeps the built-in style; a state no rule names resolves to `fallback`.
- **An unavailable or unknown entity** takes the style's first rule of the `unknown` class, whatever the authored `fallback` says.
  A style with none gets one made for it, as the app does: the node's own icon, the words "Unavailable", unlit, and an untappable
  copy of the style's first action. The preview (`ruleFor`, `unknownRuleFor`) draws the same.
- **Built-in styles** (`garage-door`, `lock`, `blind`, `alarm`, `robot`, `detector`, `notice`, `switch`) are data in
  `state-styles.ts` and in `contract/corpus/state-styles/built-in.json`. The app decodes that file and tests it equal to its own
  `StateStyle.builtIn`; the Studio tests it equal to `builtInStyles`. Regenerate with `scripts/generate-state-style-corpus.ts`.

#### Fills and hidden words (`sh.state-style-fills@1`)

A style may give each state its own solid fill and the words a redacted screen shows. This is what the retired `door-tile` set on every
state, so any `state-tile` can now be a door, a lock or anything else with authored colours. It is a **new** id beside `sh.state-style@1`
(that id has shipped, so it cannot change meaning); it shipped with the app (native-ingest c1a42b32), so it is in `contract/corpus/capabilities.json`. A document needs it when any rule, the fallback, or `hiddenWords` uses what it adds; it still needs `sh.state-style@1`.

```json
{ "id": "garage-look", "name": "Garage look", "base": "garage-door", "domain": "cover", "hiddenWords": "Hidden",
  "rules": [
    { "states": ["open"], "class": "resting", "active": true, "fill": { "type": "solid-rgb", "red": 67, "green": 160, "blue": 71 } },
    { "states": ["unavailable", "unknown"], "class": "unknown", "active": false, "text": "Unavailable", "fill": { "type": "solid-rgb", "red": 84, "green": 110, "blue": 122 } }
  ],
  "fallback": { "class": "unknown", "active": false, "text": "Unknown", "fill": { "type": "solid-rgb", "red": 84, "green": 110, "blue": 122 } } }
```

- **`fill`** is on a rule and on the fallback: exactly the document's `solid-rgb` (`type`, and `red`, `green`, `blue` as whole numbers 0 to 255; no
  alpha, no `standard`, no string). Absent means the face the class, `active` and `colour` pick, as before. A fill is a value, so it is allowed
  on every class, including warning and error, where a `colour` token is not. It is not a tile override layer: the fill belongs to the style.
- **`hiddenWords`** is on the style, 1 to 80 characters, not blank. Absent means the state's own words stay.
- **Which fill a tile draws** is the fill of the rule the tile's state resolves to, by the same lookup as the words: the first rule that names
  the state, else the fallback. `unavailable` and `unknown` take the style's unknown rule (`unknownRuleFor`). A tile that is loading, hidden or
  cannot be reached is the unknown class, so it draws the unknown rule's fill. A request in flight (Sending...) or a failed one changes the
  words and the indicator and **never the fill**: it stays the fill of the state the tile shows. A state that is itself pending (`opening`,
  `closing`, `locking`, `unlocking`) has its own rule and its own fill.
- **Where hidden words show.** While the screen is redacted (a screenshot or screen recording), the tile is the unknown class, draws the
  unknown rule's fill and icon, and its words are `hiddenWords` when the style has them, else the unknown rule's words.
- The Studio's inspector edits both: a Fill row on each state of a saved style (the color field) and Hidden words on the style. The simulator
  draws the fill; it has no redacted mode, so hidden words are not drawn.

**From a door tile.** `src/shared/composition/door-to-state-tile.ts` converts a `door-tile` to a `state-tile` (`convertDoorTile` for one,
`convertDoorTiles` for a document). The style starts as a copy of the built-in `lock` or `garage-door`, so the actions, request timings and
classes are the door's own, and the door's authored fields are written over it:

| Door field | State style |
| --- | --- |
| `states[]` `appearance.text`, `appearance.icon`, `appearance.fill`, `active` | one rule per state: `text`, `icon`, `fill`, `active` |
| `states[]` `error: true` | that rule's class is `error` |
| a built-in state the door does not list | the door's `fallback` look, unlit |
| `fallback.icon`, `fallback.fill` | the unknown rule (`unavailable`, `unknown`) and the fallback; `fallback.text` is the fallback's words |
| `unavailableText` | the unknown rule's words |
| `hiddenText` | `hiddenWords` |
| `errorText` | `request.errorWords` |
| `sendingOpenText`, `sendingCloseText` (garage) | `request.pendingWords` for `open_cover`, `close_cover` |
| `openLabel`, `closeLabel`, `reverseLabel` | the action verbs; `reverseLabel` is the verb of `opening` and `closing` |
| `loadingText` | `props.subtitle`: an `expr` that is the words while the `security-door@1` source's `phase` read equals `loading`, else blank |

Not mapped, and reported in `unmapped`: `sendingOpenText` and `sendingCloseText` on a lock (it never showed them); the stop command's words,
which keep the built-in "Stopping..." (the door had no field); a state no built-in rule names (it becomes a rule with no action). The door's
`security-door@1` source stays in `dataSources`, because the subtitle reads its `phase`. A non-blank subtitle takes the place of the state's
words, as the simulator draws it; the app must do the same for the first load to read as the door did.

**Authoring.** The 1.0 Styles section is gone with the 1.0 workspace, and the 2.0 editor for state styles has not landed. What
exists now: the contract and the corpus above (a style library, per-state rules, per-tile overrides), validation, and the 2.0
preview, which resolves a state the way the app does (`ruleFor`, `unknownRuleFor`) and draws a state tile. A state tile's style
and overrides are therefore edited only as raw rows under Advanced. Not ported to 2.0 yet:

1. The style library editor: built-ins listed read-only, Duplicate, Rename, Delete (blocked while a tile uses the style), the
   ordered state-map rules (class, icon, text, indicator and colour menus, "Colour follows the class", the arc only for a state
   with no action, the iOS 17 fallbacks), Save as New Style, the "used by" line, and the request-phase settings with a warning
   when a script or timer does not exist.
2. An entity picker that fills a state map from live states and translated names, flagging states seen only in history. Its
   server routes stay (below); nothing in 2.0 calls them.
3. The side-by-side style preview at iPhone, Duo and iPad tile widths, with the arc in the disc's place and the dimmed
   VoiceOver value.
4. The per-tile override editor (icon, text, indicator and colour layers, each with reset).
5. An Add picker entry that creates a state tile with the built-in style its device class suggests.

The picker reads Home Assistant through three read-only endpoints (`GET /native/api/ha/entities?domain=`,
`/native/api/ha/entity-states?entityId=`, `/native/api/ha/exists?id=`) in `server/ha-entities.ts`: the entity list, a domain's states
with their translated names plus the states of the last ten days of history, and whether a `script.*` or `timer.*` exists. Nothing
is written or installed.

### Todo counts (`sh.todo-counts@1`)

An authored `todo-counts@1` model sums the states of one to 64 distinct literal
`todo.*` entities. Mark each list `overdue` to include it in the overdue subtotal;
list order and all displayed copy are authored. Example:

```json
{
  "id": "chores-counts", "kind": "model", "model": "todo-counts@1",
  "inputs": { "lists": [
    { "entityId": { "type": "literal", "value": "todo.demo_late" }, "overdue": true },
    { "entityId": { "type": "literal", "value": "todo.demo_other" }, "overdue": false }
  ] },
  "labels": { "openSuffix": "open", "overdueSuffix": "overdue", "separator": " · ",
    "zeroText": "Nothing open", "loadingText": "Loading", "unavailableText": "Unavailable" }
}
```

Read `stateText` or `phase` as a string from the source in a text node or tile
subtitle. A missing, unavailable, malformed or unsafe count produces the
authored unavailable text; zero produces `zeroText`. This capability does not
provide lists, row mutations, forms, attachment pickers or a tab badge.

### Alarm navigation (`sh.alarm-mode@1`)

Add a source (the target is literal-only and must be `alarm_control_panel.*`):

```json
{
  "id": "panel-source",
  "kind": "model",
  "model": "alarm-mode@1",
  "inputs": {
    "entityId": { "type": "literal", "value": "alarm_control_panel.demo_panel" }
  }
}
```

An ordinary `navigation-tile` can add `props.alarm`. Its body `action` remains
an ordinary push/present/select-tab/dismiss-then-push navigation action. It must
use `family: neutral`, `selected: none`, and a literal empty `subtitle`, because
the binding supplies the state line. This also requires the existing
`sh.tile-presentation@1`. If `props.presentation` is included, its `fill` must be
`{ "type": "standard" }`; the alarm appearance owns the fill, avoiding ignored
competing RGB values. Layout, title lines and body hint remain editable there.

Every wire symbol is `{ "type": "sf-symbol", "name", "rendering": "canonical", "unavailable": "fallback" }`. `unavailable` says
what the app does when the device has no such symbol: it draws a fallback symbol (`questionmark.circle`) and never rejects the
document. The Studio emits only `"fallback"`. An older or imported document may carry `"reject"`; the validator accepts it as a
legacy alias and the compiler rewrites it to `"fallback"`, so a compiled document never holds it (`symbol-unavailable.ts`).

The app's rejection classes, copied word for word from the native repo's `.agents/platforms/apple/architecture.md` (Server-driven root):

- **Rejection classes.** Only an invalid document rejects (an unknown capability, a grammar error, a broken reference); the last good layout stays.
  - A device or runtime gap (a symbol or feature this OS lacks, a missing entity or copy entry) degrades one node and logs a diagnostic.
  - A launch fact (window geometry, the viewer, an open interaction) defers the candidate and retries.

`unavailable` belongs to the device or runtime gap.

Example `props.alarm`:

```json
{
  "sourceId": "panel-source",
  "projection": "alarm-navigation@1",
  "states": [
    {
      "state": "disarmed",
      "appearance": {
        "icon": { "type": "sf-symbol", "name": "shield.slash", "rendering": "canonical", "unavailable": "fallback" },
        "fill": { "type": "solid-rgb", "red": 67, "green": 160, "blue": 71 },
        "text": "Disarmed"
      }
    },
    {
      "state": "armed_home",
      "appearance": {
        "icon": { "type": "sf-symbol", "name": "shield.lefthalf.filled", "rendering": "canonical", "unavailable": "fallback" },
        "fill": { "type": "solid-rgb", "red": 30, "green": 136, "blue": 229 },
        "text": "Armed Home"
      }
    }
  ],
  "fallback": {
    "icon": { "type": "sf-symbol", "name": "shield", "rendering": "canonical", "unavailable": "fallback" },
    "fill": { "type": "solid-rgb", "red": 84, "green": 110, "blue": 122 },
    "text": "Security System"
  },
  "loadingText": "Loading",
  "unavailableText": "Unavailable",
  "errorText": "Didn't Respond",
  "hiddenText": "Hidden"
}
```

`states` accepts 0 through 10 unique entries from `disarmed`, `armed_home`,
`armed_away`, `armed_night`, `armed_vacation`, `armed_custom_bypass`, `triggered`,
`arming`, `pending`, `disarming`. Each appearance requires `icon`, `fill` and
nonblank `text` (240 UTF-16 units maximum); RGB channels are integers 0 through
255. Unmapped live states use `fallback`; missing/unknown/unavailable values
use the authored unavailable copy. All four status strings are required,
nonblank, and bounded to 240 UTF-16 units. Native preparation verifies every
authored SF Symbol, including unreachable mappings.

The canonical `AlarmModeActions(entityId:)` alone chooses Arm Home versus Disarm,
its services, disc symbols, tracked feedback and mandatory Disarm confirmation.
These safety semantics and existing provider confirmation copy cannot be
overridden. The native adapter reserves an immutable provider spec before the
question, revalidates it when answered, and pins it until the actual network
task ends (not merely until an optimistic overlay clears). Cancel sends nothing.
Live state changing Disarm to Arm Home invalidates the question explicitly.
Publication cannot replace a source or remove/alter its alarm tile while its
confirmation or call is pending. Rejected calls retain canonical failure
feedback and the authored error state line; no optimistic alarm success is
fabricated. The provider keeps Disarm ready during `arming`/`pending`; the disc
also shows in-flight feedback for an outstanding network call.

The body stays navigational and enabled even when the disc is unavailable or
busy. Without a caller, or under the existing screenshot privacy context, no
disc is drawn. Redaction uses the tile's ordinary `icon`, fallback fill and
`hiddenText`, suppressing mode-specific symbols and failures. This adapts the
production `UKQuickLinks` tile, not a feature/page/entity-name dispatcher, and
keeps its canonical accessibility controls. The relevant existing native design
authority is Apple HIG [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
(separate targets, progress feedback) and [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
(provider question, explicit confirmation and Cancel).

Alarm source reads expose only `path: ["phase"]`, `as: "string"`: `loading`,
`ready`, `inFlight`, or `unavailable`. They are not general service actions or
power sources; binding a power tile/action to one rejects.

### Inventory summary (`sh.inventory-summary@1`)

```json
{
  "id": "stock-source",
  "kind": "model",
  "model": "inventory-summary@1",
  "inputs": {
    "totalEntityId": { "type": "literal", "value": "sensor.demo_total" },
    "expiringEntityId": { "type": "literal", "value": "sensor.demo_expiry" },
    "spaceEntityIds": [
      { "type": "literal", "value": "sensor.demo_pantry" },
      { "type": "literal", "value": "sensor.demo_fridge" }
    ]
  },
  "labels": {
    "singular": "Item",
    "plural": "Items",
    "expiringSuffix": "Expiring Soon",
    "separator": " • ",
    "loadingText": "Loading",
    "unavailableText": "Inventory unavailable"
  }
}
```

All IDs are explicit literal `sensor.*` entity IDs (maximum 160 UTF-16 units).
`spaceEntityIds` has 1 through 64 entries. No HouseConfig-bound source name or
food page/component identity participates in evaluation. Singular, plural and
expiry labels are nonblank and bounded to 80 UTF-16 units; the separator may be
blank and is bounded to 80. Loading/unavailable copy is required, nonblank and
bounded to 240.

Use the summary anywhere a string read is supported, including a navigation
tile subtitle:

```json
{
  "type": "read",
  "from": { "type": "source", "sourceId": "stock-source", "path": ["stateText"] },
  "as": "string",
  "missing": "unavailable"
}
```

Evaluation follows production `QuickLinks.allFoodSubtitle` in
`HassCore/Rooms/RoomNavigation.swift`: a nonzero total wins; exactly zero selects
the sum of the configured spaces; expiry always comes from its explicit sensor.
The result is `<count> <singular-or-plural><separator><expiry> <expiringSuffix>`.
Decimal sensor strings truncate toward zero, matching the native count
semantics. Missing, negative, nonfinite, malformed, or out-of-safe-range counts
and sum overflow are unavailable, never manufactured zeros. The count/sum
ceiling is 9,007,199,254,740,991. A missing total does not silently select spaces.
Nonzero totals do not read or observe space boxes.

`stateText` returns the authored `loadingText` before the context's first state,
or `unavailableText` for invalid/missing selected reads. An additional string
read at `["phase"]` reports `loading`, `ready`, or `unavailable`. No other outputs,
entity-id outputs, executable expressions, second sockets or REST polling are
supported. All live reads use only the selected `EntityStore` boxes.

### Camera streams and controls

`camera-stream@1` is an explicit native attachment to the app's existing
`CameraStreamPool`, not Studio's browser media proxy. Its closed shape is:

```json
{
  "id": "entry-source", "kind": "model", "model": "camera-stream@1",
  "inputs": {
    "entityId": { "type": "literal", "value": "camera.demo_entry" },
    "snapshotEntityId": { "type": "literal", "value": "camera.demo_still" },
    "rtcStreamId": "demo_entry", "aspectRatio": 1.7777777777777777,
    "recording": {
      "type": "script",
      "stateEntityId": { "type": "literal", "value": "input_boolean.demo_recording" },
      "scriptEntityId": { "type": "literal", "value": "script.demo_recording" }
    }
  },
  "labels": {
    "loading": "Reading camera", "unavailable": "Camera unavailable",
    "hidden": "Private camera", "connecting": "Connecting", "live": "Live",
    "delayed": "Live, a few seconds behind", "snapshot": "Snapshot",
    "retry": "Retry Live Video", "recordFailed": "Could not change recording.",
    "photosTitle": "Allow Photos Access",
    "photosMessage": "Allow S+H to add snapshots to Photos in Settings.",
    "settings": "Open Settings", "cancel": "Cancel"
  }
}
```

Entity targets are literal-only, domain checked and bounded to 160 UTF-16 units.
The RTC ID matches `[A-Za-z0-9_][A-Za-z0-9_.-]*` (maximum 160), never a URL.
Aspect ratio is 0.25 through 8. Use `recording: { "type": "disabled" }` to omit
recording; a record control without script support rejects. Required label
strings are nonblank and bounded to 240 UTF-16 units. Duplicate camera entity
identities reject. During a native session a pooled entity cannot silently
attach to a different RTC stream ID; that candidate must remain last-good
until an explicit session reset.

The generated source/node inspector exposes all fields and ordered controls,
including reference selectors, disabled/script support and native symbol
policies; raw JSON is not required.

| Node | Required properties |
|---|---|
| `camera-tile` | `sourceId`, `openHint`; ordinary `present` action targeting a matching camera video/viewer modal |
| `camera-video` | `sourceId`; native shared video surface |
| `camera-controls` | `sourceId`, ordered `controls`; no independent stream lease |
| `camera-viewer` | `sourceId`, ordered `controls`; canonical stacked/split video and controls content, not a feature controller |

Every node also has ordinary `id`, `title` and `layout.span`. A control is:

```json
{
  "intent": "snapshot", "title": "Snapshot", "activeTitle": "Saved to Photos",
  "busyTitle": "Saving", "failureTitle": "Not Saved", "tint": "action",
  "icon": { "type": "sf-symbol", "name": "camera.fill", "rendering": "canonical", "unavailable": "fallback" },
  "activeIcon": { "type": "sf-symbol", "name": "checkmark.circle.fill", "rendering": "canonical", "unavailable": "fallback" },
  "failureIcon": { "type": "sf-symbol", "name": "exclamationmark.triangle.fill", "rendering": "canonical", "unavailable": "fallback" }
}
```

`controls` has 1–3 unique `snapshot`, `sound` or `record` intents; `tint` is
`action` or `danger`. Titles, state symbols, tint and ordering are explicit.
The native SF Symbol preparation gate checks even inactive/failure symbols.
Use existing `tile-grid` children for a grid of camera tiles. `camera-viewer`
contains its canonical internal margins; the surface can author zero padding
to avoid adding another margin.

Capabilities are `sh.camera-stream@1`, `sh.camera-tile@1`,
`sh.camera-video@1`, `sh.camera-controls@1`, `sh.camera-viewer@1`, plus the
ordinary bindings, symbols, navigation, grid and modal capabilities actually
used by the document. Viewer requires video and controls capabilities too.
Both compilers compute exact closure; none are added to the frozen first slice.
See matching synthetic fragments in `tests/fixtures/camera-composition.json`
and native `apple/Tests/HassCoreTests/ServerUICameraFixture.json`.

Camera video/viewer modals require page width, full height and dark appearance.
They use the normal native modal route with **no extra zoom**; the historical
atlas name `zoom-transition` is not a wire policy or a redesign. Source/control
attachments remain pinned through recording calls, saving and denied-Photos
recovery; publication cannot retarget, remove or reparent them in that interval.
The source exposes only a string `["phase"]` read (`loading`, `hidden`, `ready`,
`inFlight`, `unavailable`), not arbitrary service actions or stream URLs.

Native owns muted audio on viewer exit, the script toggle (`script.turn_on`),
optimistic confirmation/failure, visibility leases, retry/fallback and Photos
`.addOnly` authorization on snapshot intent. A denied save presents the native
alert using authored copy; it does not fabricate a saved result. Configured
privacy conceals the video, last frame and still, disables intents and releases
visible presence. This workspace does not open streams, record or request
Photos access merely by editing or validating the descriptor. Parent device
comparison, permissions and live-session integration remain separate evidence.

## Validation

The native debug preview can bind these sources to an isolated Home Assistant
`HassConnection`/`EntityStore` session instead of snapshot fixtures. Connection
metadata and one-time credentials are provisioned outside the composition
document; Studio never authors access tokens into a publication. Live design
receives state only: native service commands, presence, registration and Live
Activities are disabled. The preview receipt identifies `live-read-only` and
connection freshness. Successful command and transition comparisons still use
fixture callers, not the live house. Model choices in the structured source
inspector use their distinct `model` names, including `alarm-mode@1` and
`inventory-summary@1`.

Use isolated temporary data through the tests:

```sh
npx vitest run tests/composition.test.ts tests/composition-live-contract.test.tsx tests/composition-camera.test.tsx tests/composition-server.test.ts tests/composition-editor.test.tsx
npm test
npm run typecheck
npx vite build --outDir test-results/native-composition-dist
```

The alternate Vite output preserves the hosted server's live `dist/`.

### Data Flow (`sh.pipeline@1`)

The owner's name for an authored data pipeline: a request, parsing steps, a visible output shape, and a list, record or value a node
binds to. The contract id stays `sh.pipeline@1`; `sh.pipeline-operands@1` is required in addition when a flow uses an `item`, `param`,
`clock` or `date` operand. The pure core (shapes, inference, typing, the evaluator) is `src/shared/composition/pipeline/`; the app's
Swift evaluator is later work and must pass `contract/corpus/pipelines`.

```json
{ "id": "overdue", "kind": "model", "model": "pipeline@1", "inputs": {
  "title": "Overdue Chores", "parameters": [],
  "request": { "type": "ha-subscription", "kind": "todo-items", "entityId": { "type": "literal", "value": "todo.demo_chores" } },
  "steps": [
    { "id": "items", "op": "get", "path": ["items"] },
    { "id": "late", "op": "filter", "where": { "type": "compare", "op": "above",
      "left": { "type": "date", "op": "days-between", "from": { "type": "item", "path": ["due"] }, "to": { "type": "clock", "part": "today" } },
      "right": { "type": "literal", "value": 0 } } }
  ],
  "output": { "kind": "rows", "max": 50, "row": { "id": { "type": "item", "path": ["uid"] }, "title": { "type": "item", "path": ["summary"] } } },
  "schema": { "kind": "array", "of": { "kind": "object", "fields": { "uid": { "shape": { "kind": "string" } }, "summary": { "shape": { "kind": "string" } } } } } } }
```

- **Request** (never a URL, a header or a key; a request names a Home Assistant service and Home Assistant holds the secrets).
  `service-response`: `domain`, `service`, optional `target` and `data` operands, `timeoutSeconds` 1 to 30, and the authored
  `responseShape`. `entity-attribute`: a literal `entityId`, a `path` starting at the attribute, and `responseShape`.
  `ha-subscription`, a closed list of two kinds on the app's one connection: `todo-items` (`todo/item/subscribe`, an `entityId` in the
  `todo` domain, pushes `{items}`) and `weather-forecast` (`weather/subscribe_forecast`, a `weather` entity and a `forecastType` of `daily`,
  `hourly` or `twice_daily`, pushes `{type, forecast}`). The shape of each push is fixed by the kind (`sources.ts`).
- **Refresh** (`service-response` and `entity-attribute`, required): `on` is a non-repeating subset of `open`, `manual` and
  `entity-change`, with no timer. `entity-change` takes `entityIds` (1 to 8 literal entities) for a service and none for an attribute, which
  watches its own entity. `staleAfterSeconds` is 30 to 86,400. A live subscription takes no `refresh` (`invalid_combination`): its steps run on every push.
- **Parameters** (at most 8): `name`, `type` (`string`, `number`, `boolean`, `entity-id`) and a `value` operand. A parameter may build on
  another by `param`; a cycle is `invalid_combination` at the reference that closes it. Only a parameter may `read` another source (an entity
  or another flow's record), and cycles across sources are refused by the document's own check.
- **Steps** (at most 32, each with a unique `id`): `get`, `select-key`, `filter`, `sort`, `limit`, `map`, `group`, `count`, `sum`, `first`,
  `flatten`, `unique`, `default`. Each has a typing rule from the shape it receives to the shape it gives (`typing.ts`); a rule that cannot apply
  reports `binding_type` at the step's `op`, a name that does not exist `invalid_reference`.
- **Operands** inside a flow are the generic grammar's `literal`, `read`, `viewer`, `format`, `map`, `math`, `object` and `list` (no `control`),
  plus `item` (a field of the item a step is looking at), `param`, `clock` (`today`, `now`) and `date` (`days-between`). `read` stands only in a
  parameter, `viewer` only in a parameter or the request, `item` only in a step or a row.
- **Output**: `rows` (`row` with `id`, `title`, optional `subtitle` and `value` operands over each final item, `max` 1 to 100), `record` (the
  final value is one object, read by field name) or `scalar` (read at `["value"]`). `schema` is the authored shape of the final value: the compiler
  proves the steps produce it, and nodes' `read`s are checked against it. A list cannot be read (no index); a `row-collection` or a
  `collection` with the `rows` template shows a rows flow through its `providerId`, which must name a rows flow when it names a flow.
- **Limits**: 32 flows per document; operand depth 8 and 64 nodes; conditions 32 nodes and depth 6; shapes depth 6, 64 fields, 8 enum values.
- **Evaluation** is pure and total, and the step budget is 100,000 units (a step costs 1 plus its items; every operand and condition node
  costs 1; `all` and `any` evaluate every part). A run over budget gives no data and the app keeps what it last had. Where JavaScript and
  Swift disagree the contract decides: text equals under NFC and orders by scalar value, numbers print as Swift prints a `Double` (no `.0`
  below 1e15), a tie rounds away from zero, and dates are whole calendar days on the viewer's clock.


### Expressions, rules and app state

One operand grammar and one condition grammar (`src/shared/composition/expression.ts`) serve four consumers: a Data Flow's operands and `where`, a
node's `visibleWhen` and other predicates, rule-based values and authored strings. One evaluator
(`src/shared/composition/evaluator.ts`) gives them their meaning; a flow runs it in flow mode.

- **Operands.** `literal`, `read`, `control`, `viewer`, `format`, `map`, `math`, `object`, `list`, `raw-state` (`sh.raw-state@1`), `list-count` and `list-includes` (`sh.list-read@1`), the flow variants `item`, `param`, `clock` and
  `date` (`sh.pipeline-operands@1`; `item` and `param` stand only inside a flow, and `control` only on a bound control), and `choose`
  (`sh.rules@1`): `{ "type": "choose", "cases": [{ "when": <condition>, "then": <operand> }], "otherwise": <operand> }`, 1 to 16 cases, `otherwise`
  required, every branch of one kind (`binding_type` at the first that differs).
- **Conditions.** `state`, `numeric`, `viewer`, `viewer-person`, `all`, `any`, `not` stay valid forever as they are, plus `compare`
  (`eq`, `ne`, `above`, `below`, `before`, `after`), `in` (1 to 16 options) and `exists` (`sh.conditions@1` outside a flow; inside a flow they
  need only `sh.pipeline@1`). A condition inside a flow or a rule is at most 32 nodes and 6 deep; a document predicate keeps the shipped
  limits (64 nodes with its operands, depth 8). The four document leaves that name a source or the viewer are refused inside a flow.
- **Results.** yes, no or unknown (Kleene logic). `compare`, `in` and `exists` are unknown only when an operand is `loading` or `unavailable`;
  a value, null or of the wrong kind, gives no. A flow never has `loading` or `unavailable`: a gap is null and a condition is yes or no, and an
  `object` or `list` keeps a null part as null. `visibleWhen` keeps `whenUnknown`. A `choose` whose first undecided case is unknown is `loading`:
  a later case cannot stand in for it, and the slot keeps what it showed.
- **Read path.** An operand or a condition leaf can read any source that has read fields: `ha-entity`, `home-status@1`, `climate@1`, the other
  models with fields, a flow (a record by field name, a scalar at `["value"]`) and `app-state@1`. The table is `src/shared/composition/model-reads.ts`,
  shared with slot reads. Reading a model in an operand or a condition needs `sh.conditions@1`. `home-status@1` gains `count`, `total` and
  `unavailableCount` (`sh.home-status-counts@1`).
- **Strings and looks.** A text slot (`info-box` message, `status-pill` value and detail, `text` value, `row` primary, secondary and value,
  `navigation-tile` subtitle) takes `{ "type": "expr", "value": <operand> }` as well as a literal or a read (`sh.rules@1`); the operand gives
  text, a number or a boolean, never a list or an object. A status chip's `icon`, `glyph` and `fill` take
  `{ "type": "conditional", "cases": [{ "when", "then": <literal look> }], "otherwise": <literal look> }`, up to 16 cases; a case holds an exact
  literal, so the author's color is never clamped. The form editor does not author `expr` or `conditional` yet and leaves them out of its fields.
- **App state** (`sh.app-state@1`). `{ "id", "kind": "model", "model": "app-state@1", "inputs": { "topic": "window" | "clock" | "os" | "notifications" | "preferences" } }`,
  one source per topic and no other input. Window gives `widthClass`, `heightClass`, `width`, `height` and `orientation`; clock gives `hour`,
  `minute`, `weekday` (1 Monday to 7), `minuteOfDay` and `today`; os gives `major`, `supportsAlternateIcons`, `reduceMotion`,
  `reduceTransparency` and `canSendMail`; notifications gives `permission` and `timeSensitive`; preferences gives `showCountOnIcon` and
  `notificationBannerDismissed`. Every topic has `phase` (`ready`, `loading`). Layout follows window geometry: there is no topic for the kind of
  device (owner decision D2), and device-specific chrome stays in the renderers. The app updates a topic on a transition, never per frame.
- **Data Flow additions.** Two request kinds: `entities` (1 to 64 literal entity ids and up to 8 named attributes; rows are
  `{ entityId, state, ...attributes }`; no `refresh`, the flow runs when an observed entity changes) and `none` (no data; `value` is an operand over
  the parameters, the viewer and the clock). A document holds up to 128 flows.
- **Pending.** `sh.surface-orientation@1` and `sh.surface-controls@1` (see [vacuum-map-ctl](#map-orientation-and-corner-buttons-lane-vacuum-map-ctl)), the four style ids `sh.text-style@1`, `sh.stack@1`, `sh.symbol-part@1` and `sh.choice-icons@1` (see [WG-S1](#style-parts-text-style-stack-symbol-and-choice-icons-lane-wg-s1)), the two ids `sh.repeat@1` and `sh.flow-extras@1` (see [WG-S2](#repeat-and-the-extra-flow-steps-lane-wg-s2)), the two data ids `sh.chart@1` and `sh.linear-gauge@1` (see [WG-S3](#data-parts-chart-and-linear-gauge-lane-wg-s3)), and `sh.fold-sides@1` (see [fold sides](#sections-on-the-two-sides-of-the-fold-shfold-sides1-lane-l3-of-studio-duo-sim)), are in `contract/corpus/capabilities.pending.json`; every other id above is promoted: it shipped with the app (native-ingest L1a, L1b and c1a42b32), so it is in `capabilities.json`. An id is
  mutable until a publication that uses it has been served, so changes fold into `@1`; after that, a change of meaning is `@2` beside `@1`.

### Generic parts (lane TC3)

Five ids (shipped by the app with native-ingest ni-parts, so no longer pending) let the vacuum and climate atoms be rebuilt from generic parts with no visible change. Each is optional; absence behaves as before.
They are listed in `contract/corpus/capabilities.json`; the 60 `parts-*` cases (generator `scripts/generate-parts-corpus.ts`) cover them.
State fills are not repeated here: a robot tile fills by state through `sh.state-style-fills@1`.

| Id | Adds | Needs besides |
| --- | --- | --- |
| `sh.bound-options-read@1` | `props.optionsFrom` on a bound Choice: `{ from: source list, current: string operand, labels: "as-is" or "title-case", action: call-service }`. The options are the list's non-blank text items, each once, in order, at most 12, title-cased on request. Fewer than 2 usable (or not a list) means the authored `options` are used. In `action`, `control` is the chosen item. | `sh.list-read@1`, `sh.bindings@1` |
| `sh.tile-disc-rules@1` | A tile button's `icon` may be a rule/conditional slot, its `label` an `expr`/rule text, and `namesTile: true` reads the label followed by the tile's title. | |
| `sh.grid-min-columns@1` | `minimumColumns` (2 to 4, at most `maxColumns`) on a tile grid. A tile that widens to its content takes at most `floor(columns / minimumColumns)` tracks. | |
| `sh.bound-row-parts@1` | On a toggle row: `glyph`, `subtitle` (text value), `hint` (240), `metrics` (`form` or `module`), `failureText`. | |
| `sh.check-face@1` | `face: "check"` on a toggle row (a check circle in place of the switch) and `checkTint` (`action` or `success`). A check face keeps only hint and failure text among the row parts and refuses the node icon. | `sh.bound-row-parts@1` for a hint or failure text |

In the Studio the inspector draws them as: "Read Choices From an Entity…" under a Choice's list; "Say the tile's title too" and rule-following symbol and label on a tile button;
"Least columns" on a tile grid; "Hint", "Row size", "If it fails" and the glyph on a toggle row; "Toggle looks like" (Switch or Check Mark) and "Check color".
The preview draws the column floor always; it does not model the larger accessibility text sizes where the app drops to one column, and it shows the failure caption only in Edit while the row is selected.

### Conditions on controls, looks and actions (lane L-asks)

All ids below shipped with the app (native-ingest L1b and L3) and `sh.list-parts@1` (native-ingest c1a42b32). A
shipped id's cases are `accept/` files or plain `reject/` files; so is a case that declares `sh.list-parts@1`. Expected values of evaluation cases are hand-written
(`scripts/asks-corpus.ts`); the clamp numbers come from an independent port.

| Item | Where | Capability | Rules and codes |
|---|---|---|---|
| `enabledWhen { condition, whenUnknown }` | bound control, `primary-button`, `row` with an action, `state-tile` | `sh.enabled-when@1` | `whenUnknown` is `enabled`, `disabled` or `keep` (missing: `missing_required`); a row without an action: `invalid_combination` at `/enabledWhen`; `keep` repeats the last answer |
| `activeWhen`, `filledWhen`, `errorWhen` | `state-tile` | `sh.tile-look@1` | conditions over the document's sources (`invalid_reference` for a missing one); error beats lit; a request in flight or an unknown tile ignores them |
| `bound-color { value, fallback }` | chip fill and glyph, navigation tile fill, room card `stateColors[].fill` | `sh.rules@1` | `fallback` required (a glyph fallback is exact); value must be text (`binding_type` at `<path>/value`); the text goes through the tier 1 parser and the app's clamp (`color.ts`); text that is not a color draws the fallback |
| `conditional` fill | `navigation-tile.presentation.fill`, `room-card.stateColors[].fill` | `sh.rules@1` | cases hold literal fills, never clamped; a non-neutral navigation tile with a custom fill: `invalid_combination` at `/props/family` |
| `bound-symbol { value, fallback }` | status appearance icon only | `sh.rules@1` | value text is a symbol name the app draws, else the fallback; elsewhere `unknown_variant` |
| `fallback` on `expr` and `read` text | text slots | `sh.rules@1` | 1 to 16384 characters; drawn only when the value is unavailable, not while loading (loading keeps what was shown) |
| Badge `none` or `value` | status chip, navigation tile, state tile, overview tile, navigation tab, header button (drawn: `sh.badge-nodes@1`, see Profile Icon and badges) | `sh.badges@1` | value kind is string or number (`binding_type` at `/badge/value`); None, empty text and 0 draw nothing; the shipped header button `none` needs no new capability |
| `conditional` action | any action slot of a row, button, tile, header button, `rowAction` | `sh.action-rules@1` | 1 to 16 cases, `otherwise` an action or `none`, one level only; every case is checked like a plain action; a power action stays off a row or button, also inside a case |
| `confirmation.when` | `additional` confirmation of a service call or power action | `sh.confirm-when@1` | the question is asked unless the answer is `no`, so an unknown answer asks; `policy` takes no `when` (`unknown_field`) |
| `fallbackTabId` | `local-tabs` props | `sh.tab-fallback@1` | must name a tab of the container (`invalid_reference`); used when the stored choice names no tab |
| `rowAction`, `refreshable`, `emptyMessage` | `row-collection` props | `sh.list-parts@1` | `refreshable` needs a flow with `inputs.refresh.on` including `manual` (`invalid_combination` at `/props/refreshable`); `collection` has none of the three |
| `formats[name] = { date: { style } }` | `format` operand | `sh.pipeline-operands@1` | six closed styles (`short-date`, `long-date`, `weekday-date`, `time`, `date-time`, `relative`); the argument must be text (`binding_type`); never a pattern string |
| `formats[name] = { number: { maximumFractionDigits, minimumFractionDigits } }` | `format` operand | `sh.pipeline-operands@1` when `minimumFractionDigits` is there | 0 to 6, the minimum not above the maximum (`invalid_combination` at `/number/minimumFractionDigits`); zeros are trimmed down to the minimum, so 72 with 1 and 1 is "72.0"; a result that rounds to zero has no sign |
| `formats[name] = { text: { case: "title" } }` | `format` operand | `sh.pipeline-operands@1` | the argument must be text (`binding_type`); only `_` separates words, an ASCII first letter of a word is upper-cased, the rest stays, words join with one space |
| `formats[name] = { text: { case: "words" } }` | `format` operand | `sh.text-case-words@1` (not `sh.pipeline-operands@1`) | the argument must be text (`binding_type`); a space (U+0020) or an `_` ends a word, an ASCII first letter of a word is upper-cased, the rest stays, empty parts stay, parts join with one space: "Wheel stuck" is "Wheel Stuck" |
| `raw-state { sourceId }` | operand | `sh.raw-state@1` | an `ha-entity` source (`binding_type` for a model, `invalid_reference` for none); gives the state text with `unknown` and `unavailable` as values |
| `list-count { from }`, `list-includes { from, value }` | operand | `sh.list-read@1` | `from.path` is `["attributes", name]` (`invalid_reference` otherwise) on an `ha-entity` source (`binding_type`); `value` is one scalar (`binding_type` for a list or object) |

#### Grammar additions for climate (CT1)

Four generic additions to the one expression grammar. Each shipped with the app (native-ingest c1a42b32) and is in `contract/corpus/capabilities.json`; a case that declares one is an ordinary `accept/` or `reject/` case. Evaluation answers are hand-written in `scripts/grammar2-corpus.ts`.

- **N1, fixed fraction digits.** `minimumFractionDigits` beside `maximumFractionDigits` in a number format. The number is rounded to the maximum as
  before (C's `printf("%.Nf")`: an exact tie goes to the even digit); trailing zeros are then trimmed, but never below the minimum. A minimum of 0 is
  the old format. Without the field the document needs nothing new.
- **T1, title case.** `{ text: { case: "title" } }`. The rule of the web's `titleCaseState` and the app's `StateText.titleCase`: split at `_`, make a
  word's first character upper case, leave the rest, join with one space (`heat_cool` is "Heat Cool", `heat cool` is "Heat cool"). Only an ASCII
  `a` to `z` first character changes, so JavaScript and Swift cannot disagree on a case mapping; any other first character stays.
- **A1, list read.** `list-count` (a number) and `list-includes` (yes or no) over an attribute that holds an array, such as `hvac_modes` or `options`.
  The attribute must be an array: a missing attribute, text or a number is `unavailable`, and `loading` while it loads. `list-includes` compares the
  value with each scalar item by the grammar's own equality (NFC text, `"2"` equals `2`); an item that is a list, an object or null never matches, and a
  value that is null or not a scalar is `unavailable`. The host answers the attribute through the same read it already has (`Environment.read`), so the
  host must hand arrays through, not scalars only.
- **A2, raw state read.** `raw-state` gives an entity's state text exactly as Home Assistant reports it. `unknown` and `unavailable` are values, so a
  rule can tell them apart; it is `unavailable` only for a source that has no entity, and `loading` before the first states. The host answers it through a
  new `Environment.readRaw(sourceId)`; the plain `read` is unchanged (the app gives `unavailable` for an unknown or unavailable entity).
- **Never inside a flow.** `raw-state` and the list reads stand in a document only; a flow refuses them (`invalid_combination`) and evaluates them to null.
- **Capabilities.** N1 and T1 are format specs and fold into `sh.pipeline-operands@1`, beside the date styles, because an id that no app
  lists yet is mutable. They cannot go under a shipped id (`sh.operands@1`, `sh.rules@1`): the app's decoder is strict, so a published `minimumFractionDigits`
  would be refused as an unknown field, not as an unsupported capability. A1 is `sh.list-read@1` and A2 `sh.raw-state@1`, new ids, so native can take
  the four in stages (B needs N1 and T1, C needs A2, D needs A1) without shipping the flow operands' other variants with them.
- **Editors.** A text value's token settings gain "Keep trailing zeros" (a number with decimals) and the "Capital letters" choice (text; see TC4 below). A condition's Read
  pop-up gains "Raw State" and, for a list attribute, "Number of Items" and "Includes…".

#### Edge logic: last change, countdown, durations and truncation (lane `ne-operands`)

Four generic additions, each its own id so a phone without one refuses a document that uses it (`unsupported_capability`) and native can take them in any
order. Evaluation answers are hand-written in `scripts/neoperands-corpus.ts` from the production code they reproduce, and both sides run the same files.

| Shape | Where | Capability | Rule |
|---|---|---|---|
| `last-changed { sourceId }` | operand | `sh.entity-time@1` | an `ha-entity` source (`binding_type` for a model, `invalid_reference` for none); gives when the state last changed as `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC), `unavailable` while the entity is, `loading` before the first states; never inside a flow (`invalid_combination`). Draw it with the `time` and `short-date` styles; "Since 9:30 PM" is a `choose` on `date` `days-between` of it and the clock's today |
| `date { op: "seconds-between", from, to }` | operand | `sh.countdown@1` (and `sh.pipeline-operands@1`) | whole seconds from the moment `from` to the moment `to` on the clock's wall, signed; a date is midnight, a fraction of a second is dropped; `unavailable` when either is not a date or a date and time. Allowed inside a flow |
| `clock { part: "now-second" }` | operand | `sh.countdown@1` (and `sh.pipeline-operands@1`) | the wall time to the second. The app starts a 1 Hz tick on the first reader and stops it one tick after the last (a document with no reader costs no timer); the Studio's preview ticks once a second only while its document reads it. Never inside a flow (`invalid_combination`): a flow runs once on the minute clock it is given |
| `formats[name] = { duration: { style, unit? } }` | `format` operand | `sh.duration-format@1` | the argument must be a number (`binding_type`), a number of seconds (`unit` `minutes` on `compact` says minutes; `unit` on another style is `invalid_combination` at `/duration/unit`); a non-number argument, 1e13 or more, and a `compact` duration of 0 or less have no text, so the whole format is `unavailable` and a slot's `fallback` ("Off") draws |
| `math { op: "truncate", args }` | operand | `sh.math-truncate@1` | 1 or 2 arguments (`invalid_combination` otherwise): the number and the places, a whole number 0 to 6 (else `unavailable`), cut toward zero with `trunc(x * 10^places) / 10^places`; a result of -0 is 0 |

**Duration styles** (English, integer arithmetic; native `ServerUIDurationFormat`, the Studio's `duration-format.ts`):

| Style | Example | Rule (the shipped code it reproduces) |
|---|---|---|
| `compact` | `30m`, `1h`, `1h 30m` | minutes round to the nearest whole minute (a tie away from zero); seconds round **up** to whole minutes, at least 1 (`HumidifierController.formatMinutes`, `formatSeconds`); under 60 minutes `Nm`, else `Nh` or `Nh Mm` |
| `clock` | `05:00`, `01:00:00` | whole seconds rounded down, never below `00:00`; hours only from one hour; two digits each (`BathroomFanController.formatRemaining`) |
| `minutes-seconds` | `4:30`, `75:00` | seconds rounded **up**, never below `0:00`; minutes are unbounded (`BedFormat.countdown`) |
| `span` | `1 hour`, `3 days`, `3 weeks`, `2 months` | the size of the number, its sign ignored: under a day in hours, under 21 days in days, under 60 days in weeks, else months of 30 days; the amount is rounded (a tie away from zero), at least 1; plural unless 1 (`TodoItem.dueLabel`). A sign is a rule's business: "Due in {span}" and "{span} overdue" are two `format` strings under a `choose` |

**Departures from the shipped alarm panel.** `short-date` draws the year when it is not the clock's year ("Oct 14, 2025"); the panel never does. The panel also hides a
time more than 60 seconds in the future, which an author writes as `compare after` against the clock's `now`.

**Data.** The Studio's live proxy carries `lastChanged` on a state (`NativeState.lastChanged`): Home Assistant's `last_changed` from the REST snapshot or `lc` from the entity
stream, as `YYYY-MM-DDTHH:MM:SS.sssZ`. The demo house gives every entity `2026-11-15T21:30:00.000Z`. `last_updated` is deliberately not carried: it moves on every attribute change.

**Editors.** The value picker offers Now, to the second (outside a flow) and, above the entity list, a Read as choice: State, Last Changed, Seconds Until (from now, to the second, to a time the entity's state holds) and Seconds Since It Changed. A number token has As a length of time (Number, Short, Clock, Minutes and seconds, Words, with Counts in for Short) and Cut off, do not round (written as `truncate(value, n)` under a number format of the same `n`). A condition reads an entity's Last Changed, compared before or after a moment (never equal to a date). The time of last change is never an entity attribute: the Read pop-up lists no `last_changed`. A Last Changed or Now, to the second value starts drawn as a time and has the same Date Style choice as other moments. Seconds Until takes a Time attribute (a timer's `finishes_at`) or, left empty, the entity's state. The preview's clock is the browser's wall clock: a minute tick, and a second tick only while the document reads `now-second`.

#### Text case "words" and the light and dark colour pair (lane TC4, TC4c)

Two generic additions the native vacuum lowering needs to draw exactly what the old atom drew. Both shipped with the app (native-ingest c1a42b32; see `contract/corpus/capabilities.json`) and both
are optional: a document that uses neither needs nothing new.

- **TC4, `{ text: { case: "words" } }`.** A second case beside T1's `title`. The argument's text is split at every `_` and every space (U+0020 only: a tab or a
  newline stays inside its word), each part's first character is made upper case when it is an ASCII `a` to `z`, the rest stays, and the parts are joined by one
  space. Empty parts stay, as in `title` (`a  b` is `A  B`, `_x` is ` X`), and empty text is empty; a number or a boolean prints as `scalarText` prints it. So the
  vacuum's "Wheel stuck" reads "Wheel Stuck", where `title` would give "Wheel stuck". Swift reads it over `unicodeScalars`, never `capitalized` or
  `Character.uppercased()`, so a non-ASCII first letter is left alone on both sides (`élan vital` is `élan Vital`).
  **Id: new, `sh.text-case-words@1`**, not T1's `sh.pipeline-operands@1`. The contract allows either (T1's id is still pending, so it is mutable), but that id
  also gates the flow operands (`item`, `param`, `clock`, `date`) and the date styles, which native has not listed; folding `words` in would make the vacuum wait for all
  of them. `title` keeps its id and `words` has its own, so a document that uses only `words` declares only `sh.text-case-words@1`, and one that uses both declares both.
  A flow that uses `words` needs the same id.
- **TC4c, `solid-appearance { light, dark }`.** A colour for each appearance: `{ "type": "solid-appearance", "light": <solid-rgb>, "dark": <solid-rgb> }`, both
  members the document's own `solid-rgb` object (`red`, `green`, `blue`, whole numbers 0 to 255), both required, no other key. The device draws `light` in Light
  Mode and `dark` in Dark Mode. It is allowed wherever a slot takes an exact colour: a glyph and a fill slot (`status-chip`; the fill of a `room-overview-tile`,
  which takes no glyph; a `navigation-tile` presentation; a toggle row's `glyph`), a `room-card` state colour, every case and `otherwise` of a `conditional` of such a slot, the fallback of a
  `bound-color`, and a state style's `fill` (rule and fallback, which also need `sh.state-style-fills@1`). It is not allowed on a symbol, in a text value or where the
  contract takes a bare `solid-rgb` object (the alarm, door and navigation item fills). **There is no named-family token**: the Studio stays the author of both colours, so
  the cleaning glyph is `{ light: 0x9C6DC3, dark: 0xC88CFA }` as values. The two colours may be equal. **Id: new, `sh.solid-appearance@1`**, declared by any document that
  holds a pair (the compiler finds it anywhere in the document, skipping what a `literal` holds). Widening a slot's variants changes the first issue of two existing refusals, which stay plain rejects re-pinned to the new issue: `bound-color-glyph-standard-fallback` (was `missing_required` at `.../glyph/fallback/blue`, now `unknown_variant` at `.../glyph/fallback/type`) and `state-style-fills-fill-standard` (was `missing_required` at `.../rules/1/fill/blue`, now `unknown_variant` at `.../rules/1/fill/type`). Native moves its decoder to the new issue when it takes this id.
- **Preview.** A pair is drawn as `light-dark(rgb(...), rgb(...))`, which follows the `color-scheme` of the element it paints. The preview is dark, so it draws the
  Dark colour; a sheet, which follows the browser's appearance unless it asks for dark, draws the Light colour. The preview has no appearance state of its own.
- **Editors.** A text value's token settings: the "Capitalize each word" switch became the choice **Capital letters** with "As written", "Capitalize each word"
  (`words`) and "Capitalize after underscores" (`title`). A colour field that the contract lets be a pair gains the switch "<Field> differs in dark mode"; on, it becomes
  two of the existing colour fields, "<Field> in light mode" and "<Field> in dark mode", both starting at the colour it had; off keeps the Light colour. It is the same
  control in a look's Fixed value, a rule's Then, a bound colour's fallback and a state style's Fill.

#### Tile ink: icon color, button icon color and the ink of a fill (lane TC5)

Four optional additions that let a generic state tile draw what the native vacuum card draws, with no named colour family: the Studio stays the author of every colour.
All three are one id, **`sh.tile-ink@1`** (shipped with native-ingest c1a42b32): they are one idea (the colour of the ink a tile draws), they land on the same tile code in the app, and native takes them
in one lane. `sh.state-style-fills@1` has shipped, so `fillInk` cannot fold into it.

- **`glyphTint` (state tile).** An exact colour for the tile's icon: a `solid-rgb`, or a `solid-appearance` pair (which also declares `sh.solid-appearance@1`). Absent: the icon
  stays grey, as now. It applies on a face that is **neither filled, an error nor unavailable**; a filled face (`filledWhen` holds, or the state has a style `fill`), an error face and an unavailable face ignore it.
  An unavailable tile (disabled, not inert) draws the default muted grey at 50% opacity, never the tint (`UKGlassTileView` disables it, `TileFaceInk.glyphToken` returns the grey, `UKGlassTileFaceView` dims it).
- **`discGlyphTint` (state tile).** The same slot for the symbols of the tile's buttons (`props.discs`) on a dark face. Absent: white. A filled face keeps its black 18% button with
  a white symbol, whatever the tint.
- **`fillInk` (state style rule and fallback, beside `fill`).** `"white"` (white at 100%) or `"soft"` (white at 92%); absent is `"white"`. It is the ink of the state line on that
  state's `fill`. It needs a `fill` on the same rule or fallback (`invalid_combination` at `.../fillInk`); any other word is `unknown_variant` at `.../fillInk`.
  **Shape: a field beside `fill`, not inside it.** The `solid-rgb` and `solid-appearance` objects are shared by every colour slot and stay closed to extra keys; a tile-level field
  could not differ between the states of one style, and the old family fill chose its ink per fill. A two-word choice has nothing to mistake for a colour; a percentage would invite arbitrary ink.
- **`cellFit` (state tile).** `"fill"` (default, today's behaviour: the tile stretches to its grid cell) or `"natural"` (the tile keeps its own height, top-aligned, while the row stays
  as tall as its tallest cell). It matters in a grid with `equalRowHeights`; elsewhere it changes nothing. **Placement: the tile, not the grid.** The choice is per item (one robot tile
  natural beside a tile that fills), the grid has no per-child vocabulary, and `layout` is shared by every node and would need a meaning on all of them. Same id: the old robot tile's
  height rule is the same "draw like the old atom" gap as the inks.
- **Slot type.** `glyphTint` and `discGlyphTint` take `solid-rgb` or `solid-appearance` only. A `standard` fill, a `conditional`, a `bound-color`, a hex string, a nested pair or any extra
  key is refused with the same first issue the other exact-colour slots give (`unknown_variant` at `.../glyphTint/type`, `missing_required` at `.../glyphTint/blue`, `limit_exceeded`
  at `.../glyphTint/green`, `unknown_field` at `.../discGlyphTint/alpha`). On any other node the field is `unknown_field`.
- **Preview.** The icon colour is `--glyph` of the tile (a pair is `light-dark()`, so it follows the preview's appearance); an unavailable tile ignores the tint and draws the default grey icon at 50%; the
  buttons take `--disc-glyph`, a state tile in an equal-height grid stretches unless `natural` (`align-self: start`), and a filled face (or a style fill) draws them black 18% with white; the words on a fill are white or `rgba(255 255 255 / .92)`.
- **Editors.** The tile's inspector gains "In a taller cell" (Fill the cell, Keep its height), "Icon color" and "Button icon color" (an optional field: "Add Icon color"; the colour field with "differs in dark mode", starting at
  the system grey the icon already draws). A style state's page gains "Words on fill" (White, Soft White), disabled with a note while the state has no fill; clearing the fill clears the ink.

#### The tile contract ids and the ink gate (lanes TC6, TC7 and integ11)

`sh.tile-swipe@1`, `sh.state-words@1`, `sh.grid-state-groups@1` and `sh.tile-ink-default@1` are pending capabilities (`src/shared/composition/pending.ts`, `contract/corpus/capabilities.pending.json`).
The first three are declared only by a document that uses their field. `sh.tile-ink-default@1` has no field, so the compiler once declared it for every document, and the native app does not list it yet:
a publication that declares an id the app does not know is refused by every phone. It is therefore held behind one gate.

- **The gate.** `tileInkDefault` in `src/shared/composition/tile-ink-gate.ts`, a constant, `false`. While it is `false`: `compileCompositionDocument` adds no `sh.tile-ink-default@1` (a
  document cannot opt in; the id has no field, and a document that names it is refused as an unknown field); the simulator draws today's muted grey ink (`data-ink="muted"` on the preview root);
  and the whole corpus compiles to exactly its recorded manifests (1075 documents, 0 differences).
- **What the gate does not change.** `validateCompositionPublication` accepts a manifest with the id and one without it, whatever the gate says, because it compiles with the id
  on and accepts `legacyManifest` of that. A corpus case that records the id (`reject/pending-tile-ink-default-*`) stays valid.
- **Tests and overrides.** `compileCompositionDocument(document, { tileInkDefault })` overrides the gate for one call; `<Preview2 ink="primary" | "muted"/>` and the harness query `ink=primary|muted` override the simulator.
  `tests/tile-ink.test.ts` holds both states: gate off, no id and the recorded manifests; gate on, the id and the primary ink.
- **Turning it on.** When the native app ships `sh.tile-ink-default@1`: set `tileInkDefault` to `true`, move the id from `pending.ts` to the app's list (`supportedCompositionCapabilities`, `contract/corpus/capabilities.json`),
  and let the generators in `scripts/corpus-handshake.ts` move its cases. The orchestrator turns it on; a lane does not.

**Spacing.** The `section-header` spacing token is 10 points, as native `SpaceToken.sectionHeader` (`apple/Sources/HassCore/ServerUIComposition/ServerUICompositionDocument.swift:143`, native-home `fcbb4876`). The Studio
read 20 before integ11; no recorded corpus case used the token, so no evaluation case moved.

#### Map orientation and corner buttons (lane vacuum-map-ctl)

Two optional additions for any surface that draws a picture, a vacuum's map today and an image or camera surface later. Two pending ids, so native takes them one at a time: **`sh.surface-orientation@1`** and **`sh.surface-controls@1`**. Both are shared schemas (`surface-controls.ts`, `slots.ts`), not part of `vacuum.ts`. Design: `build/design/vacuum-map-ctl.md`.

- **`orientation` (the vacuum descriptor, beside `mapRotationDegrees`).** `{ "flipHorizontal": bool, "flipVertical": bool }`, both required when the object is present. Both on is "invert". Rotation first, then the flip, in screen space. It lives on the source, the one piece every map, area editor and report of that vacuum reads, so it is set once and never copied per map. Absent, or both false, draws the map as before. Writing the object at all declares `sh.surface-orientation@1`; the Studio removes it when both flips go off.
- **`controls` (the `map` primitive, optional).** Up to four groups, one per corner (`top-leading`, `top-trailing`, `bottom-leading`, `bottom-trailing`; leading and trailing, so a right-to-left language swaps sides). A group is `{ corner, axis: "row" | "column", buttons }` with 1 to 8 buttons. A row reads leading to trailing, a column top to bottom; the first button is the leading or top one. Declares `sh.surface-controls@1`.
- **A button.** `{ id, icon, label, hint?, action, visibleWhen?, whenUnknown?, enabledWhen? }`. `icon` is a symbol slot and `label` a plain text or a text slot, both as a tile button's (`sh.tile-disc-rules@1` is declared when either follows a rule or an entity). `label` is required and not blank (VoiceOver and Voice Control read it). Ids are unique across the whole surface.
- **`action`.** One of: `{ "type": "map", "command": "locate" }` (the surface's own action; the app hides it while the robot is unavailable); `{ "type": "source-command", "command": <a vacuum command> }` (the command enum the `command` primitive uses; it shares that tile's state rules: shown only when the command is offered, dimmed while blocked, the reason spoken as its VoiceOver value; declares `sh.vacuum-controls@1`; `cleanArea` needs `areaCleaning`); a plain `call-service`; or navigation (`push`, `select-tab`, `present` with `ifPresented: "reject"`, `dismiss-then-push`). `visibleWhen` and `enabledWhen` apply to a service call or navigation only: a map action and a source command have state rules of their own, so the fields are `invalid_combination` there.
- **`locate: boolean` stays, and is truthful.** With `controls` it must equal "a Locate button is authored" (`invalid_combination` at `.../locate`). With no `controls` the app derives one group, top leading, a column, holding the default Locate (`scope`, "Locate", "Asks the robot to play a sound.", id `locate`) when `locate` is true, and none when it is false. That group draws exactly today's map: 44 pt, 8 pt from the top and leading edges. The Studio writes `controls` back in canonical form: it drops them when they hold nothing or exactly the default.
- **Validation.** Two groups in one corner `duplicate_id` at `.../controls/<n>/corner`; a repeated button id `duplicate_id` at `.../id`; Locate twice, an unsupported command, a navigation the node does not take or a rule field on a map action or source command `invalid_combination`; an empty group, more than 8 buttons or more than 4 groups `limit_exceeded`; a missing label or symbol `missing_required`; a blank label `invalid_value`; a corner or axis outside the lists `unknown_variant`; a power toggle or local-state action `unknown_variant` at `.../action`. A Locate button on a map whose source is not a vacuum is `binding_type`.
- **Fit (a warning, never a refusal).** The app shows as many buttons as fit and puts the rest behind a "More Map Controls" button. `fitMapControls` (`surface-controls-fit.ts`) is the rule as a pure function (44 pt buttons, 8 pt insets, 12 pt between groups; a crossing neighbour takes one button, two groups on one edge each get at least half); the app's `MapControlFit` must give the same counts for the same inputs. The Studio runs it at each family (the smallest iPhone 375 pt wide through the largest 440, the folded Duo 466, the open Duo 669, the iPad 834, each less 32 pt of margin; the map's authored `height`) and adds a Checks suggestion such as "On the smallest iPhone, 2 buttons move into More (Top Trailing)."
- **Preview.** The simulator mirrors the live map and the schematic with the vacuum's flips (badges, markers and buttons never mirror), draws the groups with the app's numbers, the fit rule and More (a menu of the hidden buttons), dims a source command while the robot cannot take it, rings the button whose page the inspector has open (and opens its page when it is clicked in Edit), and moves the "Live map" or "Schematic" tag to the bottom centre when a bottom corner holds a group.
- **Inspector.** The map node's page gains **Orientation** (Flip Horizontally, Flip Vertically, the existing Rotation; edits the vacuum source, with a Linked tag naming it) and **Map Buttons** (four sections in screen order; Add, a Row and Column choice from two buttons, drag by the grip or Space, arrows and Space, More with Move Up, Move Down, Move to a corner and Remove Button; a button's page with Icon, Label, Hint, Action, Corner and Order). Dragging a row across sections is not built: Move to a corner in More and the page's Corner pop-up are the path.

#### Style parts: text style, stack, symbol and choice icons (lane WG-S1)

Four pending ids, all generic and none named for a card: **`sh.text-style@1`**, **`sh.stack@1`**, **`sh.symbol-part@1`** and **`sh.choice-icons@1`**. They let a card or a sheet be built from
parts that read as the app's own text, rows, columns and symbols, with no shipped card, kit or default. They are the first of the weather-gen parts (`build/research/weather-gen.md`, 3.3); the chart, gauge, dial,
arc, repeat and backdrop parts are later lanes. A document that uses none of the new fields compiles byte for byte as before (`tests/wgstyle.test.ts`). Demo ids only: `weather.demo_home`, `sun.demo_sun`.

- **`sh.text-style@1`: the `rgba` colour and the text parts.**
  - `rgba` is `{ type: "rgba", red, green, blue, alpha }`: channels 0 to 255, **alpha 0 to 1 and required** (an opaque colour is the `solid-rgb`). It is an **ink**: a slot that takes an ink takes a
    `solid-rgb`, an `rgba`, or a `solid-appearance` whose `light` and `dark` are each a `solid-rgb` or an `rgba` (a pair also declares `sh.solid-appearance@1`). **Only the slots this id adds take an ink**:
    a text's `ink`, a stack's `surface.fill`, `surface.border.ink` and `dividers.ink`, a shape's `fill` and a symbol's `tint`. Slots that existed before (a tile's icon colour, a status fill, a state style fill) keep
    `solid-rgb` and the old pair, and refuse an `rgba` with the same first issue as before. A document that holds an `rgba` anywhere declares `sh.text-style@1`.
  - `text.props.style` gains `large-title`, `title1`, `title2`, `title3` and `callout` and `caption2` (the system's eleven: with `headline`, `body`, `subheadline`, `footnote` and `caption1` as before; `section-title` stays beside them).
    A text that uses only the older styles and none of the fields below needs no new id.
  - `font` is `{ weight?, digits?, scale? }`: `weight` is `ultra-light`, `thin`, `light`, `regular`, `medium`, `semibold`, `bold`, `heavy` or `black`; `digits` is `proportional` or `monospaced` (digits of equal width, so a
    changing number does not shift what is beside it); `scale` is `{ points, relativeTo, maxPoints? }`, a size in points (8 to 160) that grows with Dynamic Type as the style `relativeTo` does, up to `maxPoints`
    (`maxPoints` below `points` is `invalid_value`). **Shape change from the research note:** `style` stays on `props` (one spelling for the base style) and `font` holds only the modifiers, so there are not two places that name a style.
  - `ink` (an ink), `lines` (0 to 12, 0 is as many as it needs), `align` (`start`, `center`, `end`; the edges mirror in a right-to-left language) and `overflow` (`wrap`, the default; `truncate`, an ellipsis; `ticker`, a constant-speed slide).
    A ticker slides one line, so `overflow: "ticker"` with `lines` absent or other than 1 is `invalid_combination` at `.../props/overflow`. The slide stops under Reduce Motion.
- **`sh.stack@1`: the `stack` and `shape` nodes.** A stack lays its children in a row (`axis: "horizontal"`) or a column, with `spacing` (a token or points, required), optional `padding`, `align` (across the axis, `start`, `center`, `end`),
  `distribution` (`natural`, or `spread` to put the first child at one end and the last at the other), `dividers` (a line between neighbours, with the stack's spacing on each side of it), a `surface` (`{ type: "module", density }`,
  the surface the app draws under a card, 26 pt corners, or `{ type: "fill", fill, border?, radius? }` with the tile radius or points), an optional `action` and `a11y`. It holds up to 100 children, counts in the 4,096 node and depth 12
  limits, and may sit wherever a node may, except in a list of settings rows or a rail. A `shape` is a `capsule`, `rect` or `circle` of a `width`, `height` (1 to 1024) and an ink `fill`; it is decoration and has no accessibility settings.
  Both declare `sh.text-style@1` too, since their colour slots are inks.
  - **Groups and the collapse (shape change from the research note).** The note's `collapse: { to: "vertical", when }` cannot draw the hand-laid weather card header, which does not just turn its row into a column: its glyph
    (in the left column) moves to the row of the numeral (the right column). So a stack may partition its children into `groups` (each `{ children: [ids], spacing?, distribution?, align?, grow? }`, a group laid along the stack's other
    axis, `grow` taking the room the others leave), and the `collapse` has its own `spacing` and `groups`. Every child is in exactly one group, in any order (`invalid_reference`, `duplicate_id`, `missing_required` at `.../groups`).
    The collapse is for a row (`invalid_combination` on a column) and names its triggers in `when` (`accessibility-size`, `overflow`, once each).
  - **The two arrangements are measured by one rule, pinned by the evaluation corpus** (`contract/corpus/evaluation/stack-reflow-*.json`, `src/shared/composition/stack-layout.ts`; the rule is `UKWeatherCard.layout` in the app). A stack collapses when the
    text size is an accessibility size, or when the groups, side by side, need more than the width plus half a point. Each group needs the widest of the children it counts, plus the stack's spacing between groups. `collapse.fits` names the children
    that must fit (a range text beside a numeral); in a group that names none, a child counts unless it is a text that can give room (`overflow` `truncate` or `ticker`). A collapsed stack is a column that uses the collapse's `spacing` and `groups`.
    The natural widths are measured with each child at its own size, independent of the arrangement chosen, so the choice cannot flip back and forth. The reason (`accessibility-size` first, then `overflow`) is part of the answer.
  - **Accessibility.** `a11y.element` is `group` (one element named by `label`, with `value`, `hint` and a `role` of `button`, `header` or `text`), `children` (as drawn) or `hidden` (the stack and its children are skipped). A stack with an `action` is one button: it needs
    `a11y` with `element: "group"` (`missing_required` at `.../a11y`, `invalid_combination` at `.../a11y/element`), takes no other role, and holds nothing that takes a tap of its own (`invalid_combination` at the child). `label`, `role`, `value` and `hint` need `group`.
- **`sh.symbol-part@1`: the `symbol` node.** One symbol: `name` (a symbol, a `conditional` of symbols, or a `bound-symbol` over an entity's text with a required `fallback`, so no state ever draws nothing), `size` (`{ points, relativeTo?, maxScale? }`, scaled like the style `relativeTo`
  up to `maxScale` times its size; `maxScale` needs `relativeTo`), `rendering` (`multicolor`, which draws the symbol's own colours, or `monochrome`, which takes a `tint` ink; a tint on a multicolor symbol is `invalid_combination`), `trim` (`leading`: the app measures the symbol's ink once for its name and
  size and removes the space at its leading edge, so it lines up with the text under it; `none` is the default) and `rotate` (an operand, a number of degrees clockwise; not a number is `binding_type`). `a11y` is required: `{ element: "hidden" }` or `{ element: "image", label }`.
  A symbol the device cannot draw uses the existing `unavailable` fallback and degrades that one node.
- **`sh.choice-icons@1`: a symbol and a hint on a choice's option.** An option of a local-state `choice` field is `{ id, label, symbol?, hint? }`. On a `segmented-choice` control a segment draws its symbol, the label is what VoiceOver says and the hint is what it says after. A segment is all symbols or all words (`invalid_combination` at the option without one);
  the other control kinds refuse a field that has symbols or hints (`invalid_combination` at the control's `stateId`), and a segmented control still holds at most four options.
- **Refusals** use the existing codes; each case in `contract/corpus` records its first issue by hand. The families are `text-style-`, `rgba-`, `stack-`, `shape-`, `symbol-part-` and `choice-icons-`, 188 publication cases and 17 stack evaluation cases, written by `scripts/wgstyle-corpus.ts`.
- **Preview.** A styled text draws its weight, same-width digits, scaled size (its points times the simulated text size, capped), ink, line limit, alignment, an ellipsis, or a ticker (it stops under Reduce Motion). A stack is a flex row or column; groups are flex columns or rows; its measuring uses `layoutStack`
  with natural widths read from the drawn children and the simulator's large text for the accessibility size. The preview draws the nearest glyph of its own set for a symbol (multicolor in the action colour, monochrome in the ink) and does not trim; the app uses its own measured glyphs. A shape is a capsule, rectangle or circle.
- **Editors.** Add offers **Stack**, **Symbol** and **Shape** (Layout and Content, no kit: each starts as the smallest useful part). A text's inspector gains Font, Color, Most lines, Alignment and When it does not fit; a stack's gains Direction, Spacing, Padding, Align across, Distribution, Surface, Lines between, the tap, Accessibility and
  Collapse to a column; a symbol's gains Symbol, Size, Colors, Color, Trim leading space and Turn. The colour rows have an Opacity beside the colour and the "differs in dark mode" switch. A local-state choice option gains Icon and Hint.

#### Repeat and the extra flow steps (lane WG-S2)

Two pending ids, both generic and none named for a card: **`sh.repeat@1`** and **`sh.flow-extras@1`**. They give the style parts a data path: a flow can give a list of records, a node can draw one
template for each record, and a flow can compute what a graph, a gauge or a rail needs (the smallest and largest of a list, a running total, a list-wide value written onto each item, the hour and weekday of a date, and how far
the clock is between two moments). A document that uses none of the new fields declares neither id and compiles byte for byte as before (checked over the 1007 documents of the earlier corpus and fixtures: their compile results are identical). Demo ids only: `weather.demo_home`, `sensor.demo_case`. The spec is `build/research/weather-gen.md`, 3.3 and 3.4.

- **`sh.repeat@1`: the `records` output, the `repeat` node, `item` and `index`.**
  - A flow's `output` may be `{ kind: "records", max }` (`max` 1 to 100). The final list must hold objects (`binding_type` at `output/kind`), and the authored `schema` must be an array of one kind of object (`invalid_combination` at `schema`).
    A records flow is read only through a `repeat`: a node `read` of it is `invalid_reference`, and a `row-collection` over it is `binding_type`.
  - `repeat` has `props: { providerId, axis, spacing, limit?, paging?, placeholder?, loadingText, emptyText, unavailableText, errorText, staleText }` and one or two `children`. `providerId` names a records flow of the
    document (missing: `invalid_reference`; not a flow or not a records flow: `binding_type`). `spacing` and the five words are always authored. `limit` is 1 to 100.
    **Shape change from the research note:** the template is `children[0]` and the placeholder is `children[1]`, not an `item` and `placeholder.item` field, so every node keeps its ordinary id, layout and selection.
    `placeholder` is `{ count }` (1 to 24); a second child needs it (`missing_required` at `children` when the count is there without the child, `invalid_combination` at `children/1` when the child is there without the count).
  - `paging` (a horizontal repeat only, else `invalid_combination` at `props/paging`) is `{ compact, regular, scaleByTextSize?, minimum?, indicator?, buttons?, label? }`: `compact` and `regular` are 1 to 12
    (`limit_exceeded`), `scaleByTextSize` is four factors above 0 and at most 1 that never grow, `minimum` is at most the smaller of the two counts, `buttons` is `never` or `regular-width`.
    A page holds `floor(count * factor)` cells for the text-size step, never below `minimum` and never above the count.
  - `item` (`{ type: "item", path }`) already read the item of a flow step; inside a repeat's cell it reads the record, checked against the flow's `schema` (a path that is not there is `invalid_reference` at `.../path`).
    `index` (`{ type: "index" }`) is the 0-based position of the item, in a flow step or in a cell. **How it is scoped:** the schema accepts both anywhere an operand goes; the compiler walks every slot and refuses them outside
    a repeat's cell or a flow step (`invalid_combination`), in the repeat's own rule too, and in the placeholder (which has `index` and no record). A repeat inside a repeat, and a saved-component reference inside a repeat, are `invalid_combination`.
  - **Template-owned flows (decision D2).** A saved component entry may carry `flows: [<pipeline source>]` (at most 8), the way it carries `sources`. A use gets its own copy, named `<reference id>~<flow id>`,
    and the repeat inside follows; a binding may fill `inputs/request/entityId/value` from a parameter. An entry with `flows` declares `sh.repeat@1`. The Studio's Save as Template takes along the records flows only the saved body reads.
- **`sh.flow-extras@1`: steps, date styles and `progress`.**
  - Steps `min` and `max` (`{ value }`) give the smallest and largest number over the list, or `null` (a null and a non-number are skipped; text is `binding_type`). Ported from `WeatherPrecipitationTimeline.peakChance`.
  - `running-sum` (`{ value, into, nullPropagates }`) writes the total so far into the field `into` of each object. With `nullPropagates` a gap makes every later total `null`, as the native scan does
    (`WeatherPrecipitationTimeline.points`); without it a gap adds nothing. **Shape change:** `nullPropagates` is required. A negative amount is written `max(0, value)` by the author.
  - `annotate` (`{ fields: { name: { aggregate: "min" | "max", value } } }`) writes a list-wide value onto every object, so a later `map` can place each day on the week's span (`WeatherRails.week`).
    **Shape change:** the research note's `min ... into` on each step became one `annotate` step with named fields.
  - The date styles `hour` (`7 PM`) and `weekday` (`Mon`), in the clock's zone, as `WeatherDates.hour` and `.weekday`. A `format` with a date spec now types its argument as a string in a flow too (it was typed as a number).
  - The `date` operand's operation `progress` (`from`, `to`): the clock's place between two moments, 0 to 1, clamped; `null` when either is not a date, the clock does not parse, or `to` is not after `from`
    (`WeatherPresentation.sun`).
- **Refusals** use the existing codes; each case in `contract/corpus` records its first issue by hand. The families are `repeat-`, `records-`, `flow-extras-` and `owned-flow-`, 129 publication cases, 37 operand evaluation cases and 28
  flow evaluation cases (`hour`, `weekday`, `progress`, `index`, `min`, `max`, `running-sum`, `annotate`, `records`), written by `scripts/wgflow-corpus.ts` through the two generators. The expected values are
  worked out by hand from the app's weather code under `apple/Sources/HassCore/Weather` and cited in each case's note.
- **Preview.** A repeat draws its first child for each record of its flow, run by the Studio over the flow's sample, its live Data run, or demo data (the Data tab's own answer); while a live run has not answered it draws the
  placeholder, then the five words for empty, error and unavailable, and a footnote for a later failure that kept the records. A horizontal repeat with `paging` scroll-snaps by page, with the page indicator and, at regular width,
  the previous and next buttons. In Edit every copy is drawn but only the first is selectable; the others are inert and carry no selection.
- **Editors.** Add offers **Repeat** (Layout), which reads the first records flow or starts one over an entity. The inspector shows **Repeat over** (records flows only, with New Data Flow and Edit Data Flow), Direction, Spacing, Most to draw,
  Paging, Placeholder and the five words, with Show State. In a cell, the value picker adds the record's fields and Position; a flow step's picker adds Position. The Data tab's Output offers **Records** when the list holds objects,
  and has pages for Smallest of, Largest of, Running Total and List-wide Fields.

#### Data parts: chart and linear gauge (lane WG-S3)

Two pending ids, both generic and neither named for a card: **`sh.chart@1`** (the `chart` node) and **`sh.linear-gauge@1`** (the `linear-gauge` node). They draw a series and a reading the document supplies, so a
card or a sheet can show a bar chart, a line, an area or a rail built from generic parts (`build/research/weather-gen.md`, 3.3; the dial, arc, repeat and backdrop are later lanes). A document that uses neither
node declares neither id and compiles byte for byte as before (`tests/wgchart.test.ts`). Colours are inks (WG-S1): a `solid-rgb`, an `rgba` or a light and dark pair, so a chart that holds one declares `sh.text-style@1` (or `sh.solid-appearance@1` for a pair) too.

- **`chart`.** `props`: `mark` (`bar`, `line` or `area`, one closed list, all drawn), `series`, `domain`, `tint` (an ink; the marks), `axis?`, `bar?`, `line?`, `height?` (40 to 320 points, default 76),
  `labels?` (`fit`, the default, `all` or `none`) and `emptyText` (what is drawn when no value is known or there are no points). `a11y` is required: `{ label, value?: "series" }`.
  - `series` is `{ type: "literal", points: [{ label, value }] }` (1 to 100 points, `value` a number or `null` for unknown), or `{ type: "source", providerId?, limit, x: { label }, y }`: the first `limit` records of a Data Flow, each with the text operand
    `x.label` and the number operand `y` read from the item (`item` operands), as the research sketch has it. A `source` series compiles against a **records flow** (`sh.repeat@1`, lane WG-S2); the seam is one file, `src/shared/composition/chart-source.ts`.
    - With a `providerId` the flow must give records: a `providerId` that names no source is `invalid_reference` and one that names an entity, or a flow whose output is not `records`, is `binding_type`, both at `.../props/series/providerId`. With no `providerId` the chart reads the list of the `repeat` whose cell it sits in (the repeat's own records, cut to the repeat's `limit`); outside a repeat, or in the repeat's placeholder (which has no list), that is `invalid_combination` at `.../props/series`.
    - `x.label` and `y` are walked with one record's shape in scope, as a repeat's cell is: an `item` path the flow's `schema` does not give is `invalid_reference` at that `path`, and an `item` operand of the wrong kind (`y` not a number, `x.label` not text) is `binding_type` at the operand. `index` is the record's 0-based position. A chart with item operands declares `sh.repeat@1`, as the records flow does. A gauge in a repeat's cell reads its `value` from the record the same way, and `item` outside a repeat is `invalid_combination`.
    - **Evaluation** (`chart-source-points-*`, subject `chart`, op `source-points`, answer `{ sourcePoints: [{ label, value }] }`): the first `limit` records, each with `item` set to the record and `index` to its position; the label is the text of `x.label` (a number is written as it is, anything else is empty), the value is the number `y` gives, or text that is one, else `null` (a stub in a bar chart, a break in a line). The shared function is `sourcePoints` in `chart-source.ts`.
    The page preview draws a source series from the records the host runs (the Studio runs the flow as it does for a repeat); until there are records, with no host, or for a flow that answers empty, it draws the chart's `emptyText`. Preview story: `/?preview2=1&fixture=wgchartflow&surface=page:page-wx-chart` (also `page-wx-gauge` and `page-wx-inside`).
  - `domain` is the value axis. `{ type: "ceiling", step, min, max }`: from 0 to the highest value rounded up to the next `step`, at least `min` and at most `max` (`min` above `max` is `invalid_value`). `{ type: "fixed", min, max }`: from `min` to `max`
    (`max` not above `min` is `invalid_value`). `{ type: "two-step", minimumStep, maximumFractionDigits?, factors? }`: two equal steps up to a "nice" top at least the highest value; `minimumStep` is an operand (a number; a literal not above 0 is `invalid_value`, text is `binding_type`) so
    a unit can pick it; `maximumFractionDigits` (0 to 6, default 3) is the most places a label may need; `factors` (2 to 16 numbers rising in (0, 10]) default to 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10. **Shape changes from the note:** `maximumFractionDigits` is new (the app's amount axis picks the step by it),
    and `tint` is one field of the chart, not of `bar`, since every mark uses it.
  - `axis` is `{ levels, label?: { pattern, digits? }, gridInk?, labelInk? }`: `levels` (2 to 6) lines and labels evenly from the top of the axis to its base, the top one first (3 levels of a 100 axis: 100, 50, 0). `pattern` holds `{value}` once and no other brace
    (`invalid_value`); `digits` is up to that many places and absent means the places the two-step axis chose, else 0. Without `gridInk` and `labelInk` the lines and labels use the ground's separator and secondary label inks.
  - `bar` (bar only) is `{ gap?, radius?, minimum?, unknownInk? }` (defaults 2, 2, 2 points): the space between bars, the corner radius, the least height of a bar above zero, which an unknown value also takes (a stub, never a bar of zero). `line` (line and area only) is `{ width?, dots? }`.
    A block for the wrong mark is `invalid_combination`.
  - **Labels are thinned to fit**: `fit` shows every n-th label, n being the count over how many labels of the widest one's width plus 6 points fit in the plot (a quarter of them when a width is not known). **The chart is one accessibility element**: a group named by `a11y.label` whose value is the series
    read out, `"Now 94%, 7 PM 40%"` (each label, then its value as an axis label; an unknown value says `emptyText`); the marks, axis and labels are hidden from assistive technologies.
- **`linear-gauge`.** A rail: `fill` (`scale`: the `stops` gradient colours the whole track; `span`: only the span), `stops` (2 to 8 `{ at: 0..1, ink }`, never falling back; fewer than 2 is `invalid_value` at `.../props/stops`, a fall is `invalid_value` at the stop's `at`), `track` (an ink), and optionally `value` with a `marker`
  (`{ size: 6..32, ink, border?: { ink, width } }`; they come together: a marker with no value is `missing_required`, a value with no marker `invalid_combination`), `span` (`{ start, size }`; a `span` fill needs it, a `scale` fill refuses it), `scale` (`unit`, the default: 0 to 1, or `percent`: 0 to 100),
  `height` (4 to 32 points, default 12) and `animates` (default yes; Reduce Motion always turns it off). The value, the start and the size are number operands (`binding_type` otherwise); no value hides the marker. `a11y` is `{ element: "hidden" }` or `{ element: "value", label, value? }`
  (one meter named by `label`, with `value` or the percent as its words). The shares a rail needs, such as a day's range inside a week's, are built from operands (`math` `scale` and `clamp`, and a rule for a flat range), not by a gauge field.
- **The rules are the app's, pinned by the evaluation corpus** (`contract/corpus/evaluation/chart-*.json`, 82 cases, and `gauge-*.json`, 34, hand-written from the app's own tests and cited line by line in each case). They are ported from the app's hand-drawn weather charts and rails:
  `WeatherPrecipitationTimeline.chanceDomain`, `amountAxis`, `scaledPercent`, `labelCadence` and `labelIndices` (`apple/Sources/HassCore/Weather/WeatherPrecipitationTimeline.swift:40-106`, tested at `apple/Tests/HassCoreTests/WeatherChartMathTests.swift:59-103`),
  the bar columns and stubs (`UKWeatherBarChartView.layoutSubviews`, `UKWeatherViews.swift:262-298`), the spoken series (`UKWeatherSheet.swift:622-657`) and the rail (`UKWeatherRailView.applyFrames`, `UKWeatherViews.swift:178-205`;
  `WeatherRails.week` and `.hero`, `apple/Sources/HassCore/Weather/WeatherRails.swift:7-38`, tested at `WeatherHighlightsTests.swift:146-170`). The arithmetic is `chart-math.ts` and `gauge-math.ts`, which the preview draws with and the app's views must agree with:
  - **ceiling**: the peak rounded up to the next step, at least `min`, at most `max`: 17 peaks from `WeatherChartMathTests.swift:70-76` (none, 0, 1, 5, 9, 10, 11 ... 94, 100) and the held edges.
  - **two-step**: the smallest `factor x 10^n` step at least half the total and the smallest step whose labels fit in the places: 15 totals of `:78-82` (inches take a smallest step of 0.01 and 3 places, millimetres 0.25 and 2), the unknown, negative and not finite totals of `:88-92`, and a document's own factors.
  - **label thinning**: capacity is `floor(plot / (widest + 6))`, cadence `ceil(count / capacity)`, indices every cadence-th from 0: `:59-68` (24 labels of 32 in 153 give every 6th, in 326 every 3rd; none give 1; no width shows a quarter) and the exact gap.
  - **rails**: a value is a share of the track, held between 0 and 100 (not a number is 0); the marker is `max(0, min(width - size, width x share - size / 2))`; the span is held inside the track and not drawn when empty; a right-to-left layout mirrors; the week rail's start 25, size 50 and marker 50 and the hero rail's 75 are
    computed from the forecast numbers with the grammar's own `math` operands in `gauge-rail-*` cases, including the flat range (0 below, 100 above, 50 on).
- **Corpus.** 145 publication cases written by `scripts/wgchart-corpus.ts` (`chart-` 91, `linear-gauge-` 54; 38 compile as `reject/pending-*`, the rest are refused) and 116 evaluation cases. Every refusal records its first issue by hand in `expect { code, pointer }`, and the generator fails when the compiler disagrees.
  Subject kinds `chart` (an `op`: `domain`, `two-step`, `share`, `labels`, `indices`, `levels`, `bars`, `points`, `spoken`) and `gauge` are answered in `tests/expression-corpus.test.ts`.
- **Preview.** A chart is SVG: bars in their columns with the corner radius, a line through the middle of equal slots that breaks at an unknown value, an area as the line closed on the base, dots, grid lines, the axis labels beside the plot and the thinned labels under it, measured from the drawn
  labels. A gauge is a track with an absolutely placed span (a CSS gradient of the stops) and marker, gliding unless Reduce Motion is on. Colours go through the ink slot (`rgb()`, `rgb(r g b / a)`, `light-dark()`).
- **Editors.** Add offers **Chart** and **Gauge** in Content, each as the smallest useful part in a neutral grey (a bar chart of five written points on a ceiling axis; a rail with a marker at half). The inspector is the schema's: a chart's Data, Chart type, Value scale (a scale picker with its own fields), Axis, Bars or Line, Height and
  Labels under the plot; a gauge's Value, Scale, Gradient covers, Span, Gradient (Add Stop), Marker. Every colour row has the Opacity and the "differs in dark mode" switch. Preview story: `/?preview2=1&fixture=wgchart&surface=page:page-wc-bars`.

**One rule for "cannot tell".** A `choose` or a rule of cases that meets an unknown answer above a true one is `loading`, not a later case
(`pickCase` in `evaluator.ts`, the only place this is decided). **Loading keeps what was shown;** unavailable uses the fallback.

**Open for the native side.** `rowAction` cannot read the tapped row, so an action that needs "this row" waits for `control` to yield the row id.
`bound-symbol` is limited to the status appearance icon. The date year rule (the year is drawn when it is not the clock's year) and en_US words
are the Studio's rendering; the app draws with its own formatters.

TODO(owner D1): linked components get author-chosen overridable fields and templates; not part of the expression model.
TODO(owner D5): the device building blocks are built in a later lane.

### Areas, the tab bar, overlays and tile parts (lane L-layout)

Four capabilities, shipped with the app (native-ingest L3), each with cases in `contract/corpus/accept/` and `contract/corpus/reject/` (a rejected case's `issue` is the Studio's first issue;
a case that declared a then-pending id was a `pending-*` reject until it shipped). Expected values are hand-written in `scripts/layout-corpus.ts`; run `scripts/generate-expression-corpus.ts`
first, then `scripts/generate-layout-corpus.ts`.

| Item | Where | Capability | Rules and codes |
|---|---|---|---|
| `blocks[]` `{ id, tabs: 'all' or tab ids, visibleWhen?, whenUnknown?, children }`; `visibleWhen` on a tab | `local-tabs` | `sh.tab-blocks@1` | needed only when a container holds a shared area, a second area on one tab, a multi-tab area, an area rule or an order the shipped shape cannot say. Tab `children` must be empty when `blocks` exists (`invalid_combination`); an unknown or repeated tab id is `invalid_reference`; a duplicate block id is `duplicate_id`; a form or pinned actions only in a block for one tab; a tab with no area is `invalid_combination` |
| `tabBar { placement: top or bottom, labels: by-size, icons, titles, icons-and-titles }` | `local-tabs` props | `sh.tab-bar@1` | bottom needs `pinned: true`; top must not be pinned; bottom or icon labels need an icon on every tab (`missing_required` at the tab icon) |
| `overlay` node: `props.anchors[{ childId, anchor, inset }]`, up to 5 children | any container | `sh.overlay@1` | the first child is the base and takes no anchor; every other child needs one (`missing_required`), naming a child after the first (`invalid_reference`); anchors are top-leading, top-trailing, bottom-leading, bottom-trailing, center; only a bound control, button, status pill or text sits on top; a nested overlay is refused |
| state tile `props.subtitle`, `props.progress`, `props.discs[]` (up to 2), `action` | `state-tile` | `sh.tile-parts@1` | progress must read a number (`binding_type`), drawn from the leading edge and clamped to 0 to 1; a disc carries an icon, an unseen label for VoiceOver, a rule-able action (a `domain` action is `invalid_combination`) and the usual visibility and enabled rules |
| status pill `tone` as a rule | `status-pill` | `sh.rules@1` | the cases hold tones (`neutral`, `success`, `warning`, `error`); an unknown tone is `unknown_variant` at `/props/tone` |

**Storage rule.** Areas are stored in the shipped shape (`tabs[i].children`) whenever they fit it; `blocks` is written only when they do not
(`areasToNode` in `src/shared/composition/layout-blocks.ts`). Top with Automatic labels writes nothing; Bottom with Automatic writes `pinned: true`; any other
labels also write `tabBar`. A container's choice field in `localState` must list the same tab ids, labels and order as `tabs`.

**`layout.span` is optional.** Unset means Automatic: the grid decides. A written span, 1 included, is the author's and wins. Old documents stay valid.

**Pictures.** `GET /api/live/picture/:entityId` serves only `image.*` and `camera.*` entities the draft names, with the server's token, no redirects, an 8 second
timeout, a byte cap, a magic-byte type check, at most 8 in flight and `no-store`. Pictures come only from Home Assistant entities.

### Gauge parts: dial and arc track (lane WG-S4)

Two pending ids, both generic and neither named for a card: **`sh.dial@1`** (the `dial` node) and **`sh.arc-track@1`** (the `arc-track` node). They draw a reading the document supplies, so a card or a sheet can show a circular gauge with a needle or a lit tick, or an arc with a marker that
moves, built from generic parts (`build/research/weather-gen.md`, 3.1 and 3.3). They are not in `capabilities.json` until the app ships them. A document that uses neither node declares neither id and compiles byte for byte as before (`tests/wgdial.test.ts`).
Colours are inks (WG-S1): a `solid-rgb`, an `rgba` or a light and dark pair, so a part that holds an `rgba` declares `sh.text-style@1` (or `sh.solid-appearance@1` for a pair) too. The value of each is a number operand: from 0 to 1, or from 0 to 100 by `scale`; no value hides the pointer or the marker.
A flow's date `progress` (WG-S2) is a number between 0 and 1 and so composes with `arc-track` as it is, once that branch is merged.

- **`dial`.** A ring of ticks along a sweep, letters round the rim, a flag, a pointer at a value, and up to three lines of text in the middle.
  - `sweep` `{ start, length }` is in degrees, clockwise from 3 o'clock (145 is lower left, 270 or -90 the top); `length` is 1 to 360 (more is `limit_exceeded`). `scale` is `unit` (the default), `percent` or `degrees` (0 to 360 over a full turn; it needs `length` 360, else `invalid_combination`).
    On a partial sweep a value outside it is held at the nearer end; on a full turn it wraps round (a bearing of -10 is 350). A value that is not a number gives no pointer.
  - `ticks?` `{ count 2..120, inner, outer, width, ink, alternate?: { inner }, skip?: [index] }`: `inner` and `outer` are shares of the radius, `outer` beyond `inner` (`invalid_value` otherwise); `alternate.inner` is the inner end of every second tick (long and short ticks); `skip` leaves out ticks a flag stands in for.
    On a partial sweep the ticks stand at `i / (count - 1)` with both ends drawn; on a full turn at `i / count`.
  - `pointer?` is `{ kind: "tick", value, inner, outer, width, ink }` (one lit tick across the ring) or `{ kind: "needle", value, ink, tailInk, dotInk, animates? }`. **The needle is one closed style**: a head, a tail and a dot, as the app draws its compass arrow, in three inks; it takes no width or ends. It turns to the value and, on a full turn, the short way round
    (350 to 10 is 20 degrees on), unless Reduce Motion is on or `animates` is false. `value` is a number operand (`binding_type` otherwise).
  - `labels?` `{ ink, items: [{ at, text, needsValue? }] }` (1 to 12 letters, `at` a place along the sweep from 0 to 1, a letter of at most 8 characters at 0.58 of the radius, in a font a fifth of the radius, never below 10 points); `needsValue` draws a letter only while the pointer has a value (the app's compass drops E and W with no wind
    direction); with no pointer it is `invalid_combination`. `flag?` `{ at, ink }` is a small triangle on the rim.
  - `center?` is 1 to 3 lines of text, each the props of a `text` (`value`, `style`, `unavailableText`, `font`, `ink`, `lines`, `align`, `overflow`, with the text rules: a ticker needs one line, a scaled font never grows to less than itself), centred on the dial and not read on their own.
  - Size: `size?` `{ points, relativeTo?, maxPoints? }` scales with the text size (the app's compass is 104 points scaled with footnote, at most 160), else the dial fills the room, up to `maxWidth?`; `aspect?` is width over height (0.5 to 2, default 1) and `centerY?` how far down the centre sits (default 0.5); the radius is half the width.
  - `mirrors?` flips the sweep about the vertical axis in a right-to-left layout. **Absent: it does not**; a dial is an instrument in space, and a compass keeps its places.
  - `a11y` is required: `{ element: "hidden" }` or `{ element: "value", label, value? }` (one meter named by `label`, spoken as `value` or the percent).
- **`arc-track`.** A quadratic curve in a box, an optional horizon, and a marker at progress: `curve` `{ from, control, to }` (points `[x, y]` in the box's own units; each must lie in the box, else `invalid_value` at that point), `box` `[width, height]` (its ratio is the arc's shape), `maxWidth?`, `ink`, `width`, `dash?` `[stroke, gap]`, `horizon?` `{ from, to, ink, width }`,
  `progress?` and `scale?` (`unit` or `percent`) and `marker?` `{ size, ink }`. The marker and the progress come together (a marker with no progress is `missing_required`, progress with no marker `invalid_combination`). The arc is as wide as the room allows up to `maxWidth` and as tall as the box says. Positions scale with the width; **line widths, dashes and the marker are
  points and do not**. Progress is held between 0 and 1. The marker stands at the Bezier point of the parameter: for the app's curve, `x = 8 + 84t`, `y = 40 - 72 t (1 - t)`. `mirrors?` (default **yes**) mirrors the arc in a right-to-left layout, so progress still runs from the reading start. `a11y` is as the dial's.
- **Rules are the app's, pinned by the evaluation corpus** (`contract/corpus/evaluation/dial-*.json`, 56 cases, and `arc-track-*.json`, 24, hand-written from the app's code and tests, each citing its source line): the barometer (`UKWeatherPressureGaugeView`, `apple/Sources/HassUI/UIKitPort/Features/Home/UKWeatherViews.swift:442-527`: 49 ticks over 250 degrees from 145, one lit, box 1.4 wide to 1 tall, centre 0.56 down),
  the compass (`UKWeatherCompassView`, `:306-440`: 48 ticks, the north one a flag, four letters, the needle `:310-340`), the bearing arithmetic (`WeatherPresentation.swift:13-22`, tested at `WeatherPresentationTests.swift:85-93`: `normalizeBearingDegrees`, `shortestBearingDelta`) and the daylight arc (`UKWeatherSunArcView`, `:536-590`, and `sunArcMarker`, `WeatherPresentation.swift:267-270`, tested at
  `WeatherPresentationTests.swift:148-153`). The arithmetic is `dial-math.ts` and `arc-track-math.ts`, which the preview draws with and the app's views must agree with.
  - **Native note for the pair gate.** The app's barometer centres its dial at 0.56 of its height with a radius of half its width, so its upper ticks reach above its own box (for a box 140 wide, the top tick runs from y 1.4 to -8.4). A `UIView` draws only inside its bounds, so the app probably clips them. The preview draws the whole dial (an SVG with visible overflow); whether the app's clip is wanted is for the pair gate to say.
- **Corpus.** 106 publication cases written by `scripts/wgdial-corpus.ts` (79 `dial-` and 27 `arc-track-` ones, 28 of them `pending-*` that compile and the rest refused) and 80 evaluation cases. Every refusal records its first issue by hand in `expect { code, pointer }`, and the generator fails when the compiler disagrees. Subject kinds `dial` and `arc` (an `op` of `layout` with a `pick` of the parts it pins,
  `share`, `normalize`, `delta`, `next`, `progress` or `point`) are answered by `tests/dial-corpus.ts`.
- **Preview.** SVG in points, from the measured width: the ticks as one path, the lit tick, the needle as a group turned by CSS (a 0.3 second glide, none under Reduce Motion), the letters as SVG text, the flag, the centre text as aria-hidden text over the centre; the arc as a curve, a horizon and a circle. All colours go through the ink slot.
- **Editors.** Add offers **Dial** and **Arc** in Content, each as the smallest useful part in neutral greys (a 25-tick dial over 250 degrees with a lit tick at half; a dashed arc with a marker at half). The inspector is the schema's: Sweep, Value scale, Pointer (Kind, Value, ends, width, color), Ticks, Letters, Flag, Text in the middle, Text place (Text centre down the height, Then down by; `sh.dial-text-place@1`), Size, Accessibility; Curve, Box, Progress, Line, Dashes, Horizon, Marker.
  Preview story: `/?preview2=1&fixture=wgdial&surface=page:page-wd-needle`.

### Profile Icon and badges (lane pb-contract)

Four pending ids. Each is declared only by a document that uses it, so a document that uses none compiles byte for byte as before
(`tests/profile-badges.test.ts` holds this over the whole corpus). They are not in `capabilities.json` until the app ships them.

| Id | What it adds | Rules and codes |
|---|---|---|
| `sh.shell-profile@1` | an optional `profile { look?, badge? }` on the `shell-header` item | `look` is `photo` (the default: the person's picture over the initials), `initials` or `symbol` (`unknown_variant` at `/profile/look`); `badge` is a badge (below); an empty block still needs the id; absent, the app draws what it draws today, the initials disc (the preview too; only `look: symbol` draws the person symbol) |
| `sh.avatar@1` | the `avatar` node, "Profile Icon" in the Studio | `props.person` is `{type: "viewer"}` or `{type: "person", entityId}` where the id is `person.*` (`invalid_value` at `/props/person/entityId`, `limit_exceeded` over 255 characters); `size` is `row` (36 pt) or `large` (84 pt); `look` is `photo` or `initials` (a node has no `symbol`: `unknown_variant`); `fill` is `standard` (the action blue, 0 0.40 0.80) or a `solid-rgb` that keeps white initials at 4.5 to 1 (`invalid_value` at `/props/fill`; a pair is `unknown_variant`); an optional navigation `action` makes it a button, which needs a non-blank `title` (`missing_required` at `/title`); `title` may be blank, which says there is none and hides the disc from VoiceOver |
| `sh.badge-spoken@1` | an optional `spoken` operand on a value badge | the words VoiceOver says after the element's name; must be text (`binding_type` at `/badge/spoken`); `none` takes none (`unknown_field`); empty or unavailable says the drawn text |
| `sh.badge-nodes@1` | a `badge` on `action-tile`, `door-tile`, `light-group-tile`, `room-card`, `room-chip`, `settings-link` and `avatar`, and a drawn badge on a header `button` | the field's presence needs the id on the added kinds (even `none`); on a `button` only a badge that is not `none` does (the shipped `none` needs no id). A badge on a kind of this id, a Profile badge or a header button holds a text of at most four characters (counted as Unicode scalars, `[...text].length`; Swift `unicodeScalars.count`): a literal, or any literal a `choose` can give (`limit_exceeded` at `/badge/value`) |

**One look.** A red capsule (0xD93025; white bold text is 4.77 to 1) in the top trailing corner, drawn when its value is a number other than 0 or a text that is not empty; `none`, 0, empty and unavailable draw nothing, and while loading it keeps its last text. The
Studio's Preview draws the capsule at the positions of the proposal (a tab, a tile and a chip: its shipped rules; a header button, the Profile disc and the Profile Icon: its centre on the 45 degree point of the circle, 18 pt tall, 24 by 18 for "9+") and never draws a photo: the
disc is the initials (the first letter of the first two words of the name, upper-cased; no letters or no name is the person symbol) in the standard fill.

**Studio-only settings, never published.** A value badge may carry, in the draft only, **Show at Most** `cap` (a whole number from 1 to 999) and **Spoken As** `spokenOne` ("For 1", optional) and `spokenOther` ("Otherwise", needed when `spokenOne` is there), each line holding the token `{Count}` for the whole,
uncapped number (any other brace is `invalid_value`). The compiler works them out before it derives capabilities (`profile-badges.ts`), so the published JSON, the corpus and the app see plain operands and the closed schema refuses the three keys in a publication (`unknown_field`):

```
cap N         value  = choose [ when compare(above, V, N) then "N+" ] otherwise format("{count}", count = V)     // both branches are text
spokenOne     spoken = choose [ when compare(eq, V, 1) then <For 1> ] otherwise <Otherwise>                      // sh.badge-spoken@1
spokenOther   spoken = format(<Otherwise with {Count} as {count}>, count = V)  (a literal when it has no token)  // sh.badge-spoken@1
```

The count `V` is the author's value, written once and copied into each place. A fault in it is reported once, at `<badge>/value/...`; a fault in what the setting wrote is reported at `cap`, `spokenOne` or `spokenOther`; a count too large for the expression budget (64 nodes) is a `limit_exceeded`.
A count that cannot be read draws nothing, capped or not: a badge whose rule stalls with no source loading is unavailable (`resolveBadge`), and one whose source is still loading keeps what it showed. `compileCompositionDocument` returns the document as authored, with the capabilities of the worked-out form; `publishedBadges` gives the form a publication holds.
The closed publication schema refuses a draft that holds the three keys.

**Corpus.** `scripts/profile-badges-corpus.ts` (through `generate-expression-corpus.ts`): `pending-profile-badges-*` accepts and `profile-badges-*` refusals, and the `badge-cap-*` and `badge-spoken-*` evaluation cases (a badge answers `spoken` only when it has `spoken`). The shipped `badge-chrome-button` case declared only `sh.badges@1`; with a drawn badge it now declares `sh.badge-nodes@1` and is `reject/pending-badge-chrome-button.json` until the app ships the id.

### Dial control and the dial's text place (lanes SD1, SD2)

Two pending ids. **`sh.dial-control@1`** is the `dial-control` node and the `stopper` field of the `control` operand inside it; **`sh.dial-text-place@1`** is the `textAt` field of the display `dial`. Neither is in
`capabilities.json` until the app ships it, and a document that uses neither declares neither (`tests/dial-control.test.ts`). The Studio has no editor or simulator dial for the control yet (lane SD3): the preview hides the node
(`hiddenNodeTypes`) and Add does not offer it. The thermostat's own kind (`climate-control` kind `dial`, `sh.climate-dial@1`) is unchanged and is not an alias of this node.

- **`dial-control`.** The thermostat dial's ring made a control. The ring is fixed: 270 degrees from 135 degrees (lower left, clockwise, open at the bottom); it is not authored, and a `sweep` field is `unknown_field`.
  - `range` `{ min, max, step }` (`max` above `min`, `step` at least 0.01, at most 2,000 steps: refused as `limit_exceeded` at `step` when `(max - min) / step > 2000 + 1e-9`, so an exact 2,000 passes even where floating point gives 2000.0000000000002, and 100.02 by 0.05, which is 2,000.4, is refused). Values live on the grid `min + k * step` up to the last one at or below `max`. `size` is `page`, `modal` or `compact` (the shipped 316, 300 and 250 points).
  - `stoppers` 1 or 2, each `{ id, value, label, spokenValue?, ink, trail?, trailInk?, limit?, action? }`. `value` is a number operand; missing or unreadable, the stopper is not drawn (with none drawn the dial is unavailable). `label` is the VoiceOver name,
    `spokenValue` the spoken value with an optional `{value}` token (any other token is `invalid_reference`, an unclosed brace `invalid_value`). `ink` and `trailInk` take a fixed ink or one chosen by rule (`sh.rules@1`); a `trailInk` needs a `trail` of `from-start` or `to-end`.
    `limit` is `{ min?, max? }`, each a number operand, at least one stated; literal ones must be in order. Ids are unique within the node and not `reading`.
  - `between` `{ rule: "free" | "stop", gap? }`: required with two stoppers, refused with one. `free`: two independent values. `stop`: the first stopper is the lower and the two stay `gap` apart (`gap` absent is 0, the thermostat's rule); `gap` is a number operand, only under `stop`, and a literal one is 0 or more and under `max - min`.
    A push rule is not part of `@1`.
  - **One call, or one per stopper.** The dial's own `action` sends on release, whichever stopper moved, and reads each stopper as `{ "type": "control", "stopper": "low" }`; every `control` in it must carry a `stopper` of this node (a bare one is `invalid_combination`, an unknown id `invalid_reference` at `.../stopper`).
    Or every stopper has its own `action`, sent when that stopper moved, where a bare `control` is its value and a `stopper` is `invalid_combination`. Exactly one form: both is `invalid_combination` at the stopper's `action`, a stopper without one `missing_required`, none at all `missing_required` at `/action`.
    A call that never reads `control` is `invalid_combination`. `control` with a `stopper` anywhere else is `invalid_combination`. An evaluator reads it from `Environment.controlValues[stopper]`; a bare `control` still reads `controlValue`, and a named one never falls back to it.
  - `reading?` `{ value, ink }` (the marker), `bands?` up to four `{ from, to, ink }` inside the range, `ticks?` `{ every }` (dots from `min`; at most 60: `limit_exceeded` at `every`), `center` `{ top?, value: { shows, fractionDigits 0..2, unit }, caption? }` (`shows` is `reading`, which needs a `reading`,
    or a stopper's id; `caption` is `stoppers` or text), `dimmedWhen?`, `enabledWhen?`, `unavailableText`, `failureText` (may hold `{value}`), `mirrors?` (absent: the ring does not flip, as the thermostat does not), and `a11y` `{ label, value? }` for the readout, which is one element, each drawn stopper being its own adjustable element.
  - **Rules of movement are `dial-control-math.ts`**, pinned by the evaluation corpus (`dialctl-*`): a move is held inside the stopper's bounds and the ring, then snapped to the nearest grid value (a half goes up); a bound that falls between grid values gives the grid value inside it; **always away, never forced** (values closer than the gap, or past a limit,
    are drawn as reported, nothing is sent, and a stopper may stay or move toward the allowed side, never further in); **a gap or a limit that cannot be read makes the whole dial read-only**; a **stop mark** shows at a bound only for a gap above 0 or a limit short of the ring's end; a tap moves the nearest stopper (a tie goes to the first, stacked stoppers and a tap above move the second); adjust moves one step.
- **`dial.textAt`** `{ share?, offset? }`. The centre of the block of `center` lines stands `share` of the dial's height down (absent: the ring's `centerY`), then `offset` points (absent: 0; plain points, not scaled by the text size). It states at least one (`invalid_value` otherwise) and needs `center` lines (`invalid_combination`). A dial that states neither
  draws as before. The barometer's place is `{ share: 0.5, offset: 4 }` (`.agents/decisions/2026-11-17-barometer-centre-text.md` in the native repository). `layoutDial` answers it as `textCenterY`; the preview positions the text there.
- **Corpus.** `scripts/dialctl-corpus.ts` writes the `dialctl-` and `dial-text-place-` cases (and their `pending-` twins) and their evaluation cases through the same generator; the family is `dialctl` so `dial-` does not claim its files. Evaluation subject `dialctl` (ops `state`, `bounds`, `move`, `adjust`, `nearest`, `snap`, `ticks`, `tick-count`, `angle`) is answered by `tests/dial-corpus.ts`, and operand cases may set `env.controlValue` and `env.controlValues`.

### Counting many entities (`sh.count@1`, lane SC1)

One pending id for one operand. A document that has no `count` declares nothing new and compiles byte for byte as before (`tests/count-operand.test.ts`). Native mirror lane: NC1.

**Why.** A count written with `math add` over `choose` costs about four nodes an entity and is written again at every use, so four or more entities pass the 64-node limit of an expression. `count` costs one node plus its tests, whatever
the number of entities, and a use of it is evaluated once.

| Shape | Where | Capability | Rule |
|---|---|---|---|
| `count { of: [{ test, viewer? }] }` | operand | `sh.count@1` | a number from 0 to the number of entries (`operandKind` is `number`). 1 to 32 entries (`limit_exceeded` at `of` for none or more, from the schema's size rule). Never inside a flow (`invalid_combination`): a flow reads no document source, and evaluated there it is a gap, `null` |

- **`test`** is a condition, the grammar that stands in `visibleWhen`: a `state`, `numeric`, `viewer` or `viewer-person` leaf, a `compare`, `in` or `exists` leaf (which add `sh.conditions@1`), and `all`, `any` and `not` over them. The entities it reads are its own sources, so the
  source rules are the conditions' (`invalid_reference` for a source that is not declared, at `.../test/sourceId`). Each test has the budget of a rule's case: 32 nodes and 6 levels (`limit_exceeded`). A test that is not a condition is `unknown_variant` at `.../test/type`.
- **`viewer?: { personEntityIds: [...] }`** puts the entry in play only while the viewer is one of the listed `person.*` entities (1 to 32; `invalid_value` for an id that is not `person.<name>`, `limit_exceeded` for none, `unknown_field` for anything else such as `userIds`).
  A filter stands on an entry, never on the count, so one list can give each person their own number ("Sam's chores" and "Alex's chores") and a third entry can count for everyone. It costs no node.
- **Cost.** `1 + the nodes of each test`: 32 `state` tests are 33 of the 64 (`MAX_EXPRESSION_NODES`). A test that holds an operand, such as `numeric` with `above`, costs 2, so 32 of them are 97 and refused (`limit_exceeded`), as the 64 limit has always done.
  Several counts in one expression add up (a sum of two counts is `1 + (1 + a) + (1 + b)`).
- **What it counts.** Each entry on its own, in order: a test that holds (`yes`) counts 1. A test that does not hold, or that sees a state other than the words it lists, counts 0 and is a value: the states `unavailable` and `unknown` are text to a `state` test, so
  `in: ["on"]` does not count them, and a test can ask for them (`in: ["unavailable"]`). Words compare exactly as written. The same entity in two entries counts twice.
- **What it cannot answer.** A test whose answer is `unknown` (the entity has no state at all, or is still loading, or a `numeric` test reads text) is **not counted**, and the count goes on with the rest. Only when **every entry in play** is unanswerable does the count have nothing to say:
  `loading` when any read of any kind was "not yet" (a plain read, `raw-state`, `last-changed`, the viewer's person state, or a viewer not known yet), else `unavailable`. Every read path reports it the same way. A badge (`resolveBadge`) tracks the same paths, so a person-filtered count keeps its last text until the viewer is known. So one dead sensor does not blank a count of twenty, and a house that has not reported yet does not read "0" (a `choose` over `loading` stalls and the slot keeps what it showed, as for any rule).
  A count whose entries are all filtered out by the viewer is the value 0 (the answer is known).
- **The viewer.** Before the connection knows the viewer (`env.viewer` absent) a count that has a filtered entry is `loading`; a count with no filters never waits. A viewer who has no `personEntityId`, or is not listed, is not in that entry. An entry the viewer is not in is never read.
  The viewer's own person entity is `viewer.personEntityId`, the same field the `viewer` operand reads.
- **Grammar boundary.** A `count` standing where a `compare` argument stands is a number (`above`, `below`, `eq` against a number; against text it is `binding_type`). It adds with `math add`, so an app icon's number is `math add` of counts, one for each kind of thing.
  The name is also the shell's profile `count` node (`sh.profile-count@1`): a record with `of` is the operand (a stray `id` on it is `unknown_field`), a record with an `id` and no `of` is the unsupported node. Corpus `count-operand-profile-node-is-not-the-operand` and `count-operand-stray-id` pin both.
- **Corpus.** `scripts/count-corpus.ts` writes the `count-operand-` publication cases (`pending-count-operand-*` compile; `count-operand-*` are refused, each with its hand-written first issue) and the `count-operand-` evaluation cases (subjects `operand` and `condition`),
  through `generate-expression-corpus.ts`. Evaluation env keys are the existing `reads` (`<source>/state` or `<source>/attributes/<name>`), `raw`, `changed`, `viewer` and `flow`, and `viewerPerson` (what the host's `viewerPersonState` gives; absent means none). Native mirror: `sh.count@1` joins `ServerUIIngestedCapabilities`, `capabilities.json` is regenerated and
  `sh.count@1` is dropped from `capabilities.pending.json`, the generators are rerun, and `ServerUIOperand` decodes `count` with `ServerUIPredicate` for each test, strictly (unknown fields refused), and evaluates as above.

### Linked components (`sh.component-ref@1`, lane L-linked)

A saved component is an entry of the document's `componentLibrary` (at most 100): `{ id, name, origin?, params?, sources?, bindings?, node }`. The `node` is the body,
one node with its own children. A place that uses it is a `component-ref` node: `{ id, type: "component-ref", componentId, layout: { span 1..4 }, args? }`. The id
`sh.component-ref@1` shipped with the app (native-ingest L2 and NT1), so it is in `contract/corpus/capabilities.json`. No case is refused by the app's list now that `sh.pipeline@1` has shipped. The corpus files starting `component-` are written by
`scripts/generate-component-corpus.ts`; do not edit them by hand.

The template extensions D1 to D6 (entity and state parameters, owned sources, labels and `origin`, larger limits, the `fieldKind` fix) are part of `@1`, not an
`@2`: no publication that uses the capability has been served, so it is still mutable (`build/decisions/templates.md`). They are additive: a document that
used none of them reads as before, except that a `text` parameter bound to a service target's `entity_id/value` is now `binding_type` (D6).

**Expansion.** A reference stands for its body. The shared function is `expandDocument` / `expandRef` / `expandSources` in `src/shared/composition/components.ts`.
The root of the expansion has the reference's id and width. Every inner node has the id `<ref id>~<inner id>` (`~` is outside the id alphabet, so it cannot clash).
Bindings are applied by node id and field path (`props/sourceId`), taking the place's value from `args`. A reference inside a body is refused
(`invalid_combination`), so expansion is one level and always ends. The expanded document is the library's removal plus these additions, in this order:
1. every key `sourceId`, `providerId` (or ending in either, except `copySourceId`) whose value is the id of a source the entry owns is rewritten to
   `<ref id>~<source id>`, and so is each string of a list under a key ending `SourceIds` or `ProviderIds`. This happens first, so an argument is never rewritten;
2. each bound node field takes the argument of its parameter;
3. node ids and the root's width are set as above;
4. each source the entry owns is appended to `dataSources` as a copy with the id `<ref id>~<source id>`, each bound source field taking its argument. The appended
   sources follow the document's own, in the order of the references in the document.

**Owned sources (D2).** `sources` holds at most 8 entries, each `{ id, kind: "ha-entity", entityId: { type: "literal", value } }`. A source is private to its
entry: the id is unique within the entry, and where it equals a document source's id the private one is meant inside the body (the document's source stays
reachable everywhere else). The body names it by its plain id (`state`); a reference that names an id no source of the entry or the document has is
`invalid_reference` at the library. The copies count toward the document's 1,000 sources (`limit_exceeded` at the reference's `componentId` that crosses it).

**Rules.**

| Item | Rule and code |
|---|---|
| capability | a library or a reference needs `sh.component-ref@1` (`unsupported_capability`) |
| `componentId` | must name an entry (`invalid_reference` at `<path>/componentId`) |
| placement | the expanded root must fit where the reference sits, by the rules of its type (`invalid_combination`); `layout.span` follows the grid rules |
| body | a body holds no `component-ref` (`invalid_combination`); ids in a body and in the pages stay unique after expansion (`duplicate_id`) |
| limits | 100 entries, 16 `params`, 128 `bindings`, 8 `sources`, 16 `args` (`limit_exceeded`); a document of expanded nodes counts against the 4096-node limit |
| `params` | `{ name, kind, label? }`, `kind` one of `source-id`, `page-id`, `modal-id`, `entity-id`, `state-id`, `text`, `symbol`; names are unique (`duplicate_id`); `label` is 1 to 80 characters with no control or format characters |
| `origin` | `{ id, version }`: an identifier and an integer from 1 to 9999; the app ignores it |
| `bindings` | `{ param, nodeId \| sourceId, field }`: the param exists (`invalid_reference`), exactly one of `nodeId` (`missing_required` at `nodeId` when neither, `invalid_combination` at `sourceId` when both) and `sourceId`; the node is in the body or the source is the entry's own (`invalid_reference`), the field exists (`invalid_reference`) and its kind (by `fieldKind`) is the param's kind (`binding_type`); a field of a node or source is bound once (`invalid_combination`) |
| `sources` | ids are unique in the entry (`duplicate_id`); the entity is a literal of the form `domain.object` (`invalid_value` at `sources/<n>/entityId/value`) |
| `args` | every param needs a value at `<ref>/args/<name>` (`missing_required`), a key that is not a param is `unknown_field`, an id kind that names nothing is `invalid_reference` (a source, a page, a sheet or a local state field), an `entity-id` that is not `domain.object` is `invalid_value`; a value a bound field's own rule refuses is reported at the argument with that rule's code |

**Field kinds.** `fieldKind` classifies a string field by its name and where it sits, first match wins: `pageId` is `page-id`, `modalId` is `modal-id`, `stateId` is
`state-id`, `entityId`, `copySourceId` and any key ending `EntityId` are `entity-id`, and so is the literal `value` under an `entityId` or `entity_id` key (D6: a service
target's `entity_id/value`); a key ending `sourceId` or `providerId` (not `copySourceId`) is `source-id`; `name` of an `sf-symbol` is `symbol`; `value` of any other `literal` and a
node's own `title` are `text`. No other field may be a parameter. The same table classifies a field of an owned source (`entityId/value`).

**Arguments are checked as the field they fill.** The compiler expands the document and compiles it, giving each derived id (`<ref>~<id>`) a plain stand-in for
that run. Each issue at a bound field is reported at the reference's `args/<name>` with the code the field's own rule gave. This is how a state argument that names
a field whose options are not the tab ids (`invalid_combination`) and an entity of the wrong domain (`invalid_combination`) are found.

**Native ingestion.** The app reads `componentLibrary` and the reference nodes, expands them with the same rules before it builds the page, and must give the
same answers on every `component-*` corpus file.

### Sections on the two sides of the fold (`sh.fold-sides@1`, lane L3 of `studio-duo-sim`)

One pending capability id (`src/shared/composition/pending.ts`, `contract/corpus/capabilities.pending.json`), declared only by a document that uses one of its two fields; a document with neither compiles byte-identical.
While the iPhone Duo is partly folded sideways a page can lay its sections out in the two sides of the fold (the app's `FoldColumns` computes the geometry); this id lets a document say that it does, and where each section sits.

| Field | Where | Values |
|---|---|---|
| `layout.foldSides` | a page | `auto`: the page lays its sections out in two sides. Absent: one column, as before. A sheet has none (`unknown_field`). |
| `layout.foldSide` | a page's top-level component, a `component-ref` among them | `span` (Across the Top), `leading` or `trailing`. Anything else is `unknown_variant`. |

**Placement.** Only a page's top-level components take a side. A nested component, a sheet's component and a saved component's own body are `invalid_combination` at `layout/foldSide`: a place says where it sits, the body does not.
A page lays out in two sides when `foldSides` is `auto` or a component says `leading` or `trailing`.

**The automatic rule (decision D1), one implementation in `src/shared/composition/fold-sides.ts`** that the compiler, the preview and the inspector all call, so there is no second reading of it:
1. Components are counted after static filtering (a `notification-permission-banner` is left out) and before any rule hides one; a `pinned-actions` bar takes no side and holds no slot. A section that a rule hides at run time keeps its slot.
2. The run of status strips (`status-rail`) at the top spans both sides, and so does any component in that run that says `span`.
3. The rest alternate by position in the rest: the first leads, the next trails, and so on. An explicit `foldSide` wins and still holds its position in the count.
4. A `span` has to come before the first section that takes a side; a later one is `invalid_combination` at `layout/foldSide` (`lateSpans`).

**When the sides apply (the app).** Only while the vertical band exists and the content is wider than tall (partly folded, sideways). Each side must be at least 360 pt (`FoldColumns.resolve`, `SplitPolicy.geometry` with `isHinge`); on the Duo that is 455.3 pt, the 40.4 pt band and 372.3 pt of the 868 pt after the rail. Every side keeps the page padding at both edges.
Any other pose is one column, whatever the fields say. Text is never scaled.

**Preview.** `planFoldSides` (`src/preview2/fold-sides-plan.ts`) reads the page and the component library (a place of a saved component takes its body's type) and gives each section a side and an order; `PageBody` keeps every section in one DOM, so the reflow into the two sides is the rig's existing FLIP on `fold-pose`
(offsets, never a scale) and nothing is re-created. The status strip spans the band; at the largest text size it heads the leading side and the trailing side starts at the top (`data-sides="head"`).

**Capability table.** `sh.fold-sides@1` is declared by a page with `foldSides` or a component with `foldSide`; absent from the manifest it is `capability_manifest_mismatch` at `/capabilities`.
A component that holds no slot (a pinned bar) compiles with a `foldSide` and the rule ignores it; the evaluation corpus pins that.

**Pending, and what that means for publishing.** The app refuses the whole publication at the first id it does not list (`unsupported_capability` at `/capabilities/<n>`), so a project that declares `sh.fold-sides@1` cannot be read by the shipped app until the app updates.
The Studio therefore never turns the id on by itself while it is pending (`src/shared/composition/pending.ts`): a new page carries no `foldSides`, and "Use Two Sides on Every Page" is not offered. An author can still choose Two Sides or a side;
the rows say "The app can’t show this yet. Publishing it waits for an app update.", Checks carries a suggestion, and the Publish dialog warns. When the id ships (it leaves the pending list) a new page starts on `foldSides: auto` and the offer appears.

**Corpus.** `scripts/generate-fold-sides-corpus.ts` writes 22 publication cases: nine accepted as `reject/pending-fold-sides-*`, the ordinary accept `accept/fold-sides-no-fields-needs-no-id.json` and twelve refused (`reject/fold-sides-*`),
and 12 evaluation cases (`evaluation/fold-sides-*`, subject `foldsides`, `scripts/fold-sides-evaluations.ts`). An evaluation case gives a page's top-level components (`id`, `type`, `bodyType` for a `component-ref`, `foldSide`, `hiddenByRule`), the page switch, the Duo's geometry
(455.3, 40.4 and 372.3 pt) and the page's side padding (16 pt), and records `{ active, sides: [{ id, side, width }] }`: the strip run and parity, an override holding its position, a hidden section keeping its slot, a `component-ref` read by its body, the notification banner and a pinned bar holding no slot, and a page that does not use the sides.
`tests/fold-sides.test.ts` pins the D1 table and some of these answers by hand.

**Native ingestion.** The app reads both fields and must give the same answers on every `fold-sides-*` publication case and every `evaluation/fold-sides-*` case. Home's Cameras and Guests are placed by authoring in the app today; by this rule (decision D1) Home must pin Cameras `trailing` ahead of Guests to match, which is a follow-up in the Home document, not in this contract.
