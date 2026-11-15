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

## Separate workspace and durable storage

The header's **Native composition** button opens a separate 2.0 authoring
workspace. The 1.0 workspace and `/api/*` APIs remain available, including
unsaved local edits when switching between workspaces. There is no automatic
conversion or import of schema-1 documents.

`StudioStore` holds the existing exclusive `DATA_DIR` lock and opens a
`native-v2/` namespace beneath that same directory:

- `state.json` atomically contains the draft and the selected published revision.
- `revisions/<revision>.json` contains immutable, server-validated 2.0 envelopes.
- `assets/<sha256>.png` or `.jpg` contains immutable uploaded bytes.

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
| `POST /native/api/ha/publish` | JSON `{expectedRevision}`; freezes that draft as the local publication, uploads the images Home Assistant lacks, then publishes. Returns `{epoch, revision, envelopeSha256, uploadedAssets, skippedAssets}` |
| `POST /native/api/ha/rollback` | JSON `{revision}` from the history; Home Assistant makes it current under a new revision. Returns `{epoch, revision, envelopeSha256}` |
| `GET /native/api/schema` | Generated closed structural JSON Schema, not a replacement for compilation |
| `GET /native/api/export?source=draft\|published` | Saved document JSON (not publisher metadata or embedded image bytes) |
| `GET /native/api/assets` | Uploaded immutable image descriptors, without document-specific ID/role |
| `POST /native/api/assets` | Raw `image/png` or `image/jpeg` bytes; returns server-computed descriptor without ID/role |
| `GET /native/api/assets/<sha256>.<png\|jpg>` | Verified bytes, correct MIME, private immutable caching and ETag/304 |

JSON write bodies are bounded to 2 MiB plus 64 KiB of envelope space and scanned
for duplicate decoded keys and invalid UTF-8 before JSON parsing. The document
still has its independent 2 MiB, depth, node and semantic bounds. Unknown request
fields are rejected. Validation returns 422 with value-free `issues` and readable
pointer/code `errors`; stale revisions return 409 with `currentRevision`.

Uploads accept 1 through 8,388,608 bytes, at most 8192 pixels per side and
16,000,000 total pixels. MIME/signature, bounded PNG chunks/CRCs, static PNG policy,
JPEG marker/frame headers and dimensions are inspected without allocating decoded
pixels. Native remains the final decoder and dimension/frame verifier.
Hash, length and dimensions are never accepted from upload clients.
Save/publish verify every descriptor against the actual file. External/file URLs,
traversal, missing bytes and descriptor/file mismatches are rejected.

Uploaded assets are reusable from the image library. Selecting another wallpaper
or publishing another revision never deletes earlier bytes. There is no automatic
garbage collection; the namespace allows at most 1000 uploaded files and 512 MiB.
Quota failures are explicit (507), not eviction of published assets.

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
it retains this workspace's publisher/document identity, and referenced images
must be uploaded to the current publisher separately. Export includes unsaved
local edits and does not implicitly save or publish.

Save and publish are distinct buttons; publishing dirty work saves first.
Conflicts retain local edits, offer confirmed reload/discard, or explicit
keep-local replacement against a newly read revision. Undo/redo, failed import
and delayed save responses retain local work.

This slice supports up to five native tabs, grouped chrome, column pages,
canonical fitted/full-height local-stack sheets, text/grids/navigation/power tiles, typed HA-entity,
power/alarm/lock/garage/camera models, inventory and todo summaries, configured vacuum controls,
and same-publisher PNG/JPEG backdrops. Power toggles are
limited to `switch` and `input_boolean`. Content-image assets/nodes, forms/local
variables, route arguments, extended tabs, arbitrary styling/fonts, other service
models, external asset URLs and full-screen modals are
not supported. It adds no product-specific feature dispatcher.

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
2. `fenton_home/ui_publication/get` lists the images Home Assistant already holds.
3. Each image in `document.assets[]` that is not listed is sent with
   `POST /api/fenton_home/ui_assets/<sha256>` and its content type. Uploads run
   immediately before the publish, because Home Assistant prunes stored images
   that no publication references.
4. `fenton_home/ui_publication/publish {envelope}` stores the validated envelope as
   the next revision and notifies subscribed apps. The result is
   `{epoch, revision, envelopeSha256}`; the Studio shows the revision.

Publishes and rollbacks are serialized, so an upload is never separated from its
publish by another Studio request.

**History and rollback.** The *Home Assistant* section lists the current revision
and Home Assistant's history (revision, time, publisher). *Roll back* asks for
confirmation, then makes that entry current as a new revision; the Studio draft
is not changed.

**Errors.** Integration reasons become fixed Studio messages and Home Assistant's
own text is never forwarded: `too_large`, `not_json`, `too_deep`,
`bad_capabilities`, `bad_asset_manifest_hash`, `bad_document_hash`, `bad_document`
and `bad_assets` (HTTP 422), `missing_asset` (409), unknown rollback revision
(404); asset upload failures `hash_mismatch`, `bad_hash`, `empty` (422),
`too_large` (413), `unsupported_type` (415) and `store_full` (507); an unknown
command (integration missing or older than 1.4.0), a non-administrator
credential, or an unreachable Home Assistant (502); Home Assistant not
configured (503). Assets are limited to JPEG, PNG, HEIC and WebP (the Studio
produces PNG and JPEG), 15 MiB each and 64 MiB in total on the integration.

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
server, live `dist/`, existing saved 1.0 data and `ENABLE_LIVE_ACTIONS` must not be
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
- **Generic actions and rules** (`src/shared/composition/expression.ts`, native-home 7154723). `call-service` is an action
  (`sh.call-service@1`): any `domain.service`, a `target` of operands (`entity_id`, `device_id`, `area_id`, `floor_id`,
  `label_id`), `data` as an `object` operand, `optimistic[]` keyed by a declared `ha-entity` source, and an optional
  `confirmation` (`policy`, or `additional` with `exemptUserIds`). It runs only on a tap. `bound-control`
  (`sh.bound-control@1`) is a toggle (row or tile, `isOn`, `onAction`, `offAction`), stepper (`value`, `range`, `format`,
  `action`), slider (`value`, `action`; no range or format), choice (2 to 12 `options`, each with `selectedWhen` and an
  `action`) or button (`action`). Operands (`sh.operands@1`) are `literal`, `read`, `control` (only inside a bound control's
  own call), `viewer`, `format`, `map`, `math`, `object` and `list`; there is no template language. Predicates are `state`,
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

The schema-1 workspace is a design-only preview: it publishes to no reader, and its publish endpoints were retired.

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

**Authoring** (the Styles section, `src/StateStyles.tsx`). The library lists the built-ins read-only; Duplicate makes a saved
style, Rename and Delete apply to saved styles, and Delete is blocked while a tile uses the style ("Used by N tiles"; editing a
used style warns how many tiles change). The state-map editor offers the arc spinner only for a state with no action ("No arc while
this state has an action") and names the iOS 17 fallbacks beside Breathe (Pulse) and Wiggle (Bounce). A tile's per-state overrides
are one layer each, with reset, and Save as New Style folds them into a saved style. The picker lists live entities and fills a
state map from Home Assistant's own states and translated names; states seen only in history are listed as unclassified, and the
map always ends in a fallback. The preview (`state-style-preview.ts`) resolves a state the way the app does and draws it at iPhone,
Duo and iPad widths, with the 0.2 s disc and arc cross-fade and the VoiceOver value ("dimmed" while the arc shows).

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

The app's three rejection classes, for reference: validation rejects a document, a source that is still pending defers its node, and a
device gap (an absent symbol, an unsupported capability on a device) degrades to a fallback. `unavailable` belongs to the third.

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
