# Configuration contract

The document remains bounded at 2,000 total components, 50 pages, and 64 modals.
The native destination expansion requires more than the former 1,000-component
limit; the modal bound also allows retaining older editable sheets during an
upgrade. Existing byte, depth, reference, and per-container limits still apply.

The original Native Home Studio workspace authors **schema version `1.0`**
documents. The separate **Native composition** workspace authors the strict
[2.0 native contract](native-composition.md) without migrating or replacing
1.0 saved work. The original workspace's exported
TypeScript contract is `src/shared/types.ts`. `src/shared/schema.ts` is the strict
Zod validator; `/api/schema` generates JSON Schema directly from it. Semantic
checks (references, uniqueness, safe URLs, nesting, and component count) also run
on the server; call `/api/validate` rather than treating JSON Schema alone as the
complete validator.

The editable example in `src/shared/sample.ts` owns all demonstration content:
Home, Food, Chores, Settings, suggested food categories, household profile,
support rows, camera and profile sheets, toolbar actions, variables, bindings,
and five Live Activity layouts. These are sample data, not a hardcoded renderer.
The catalog and declarative runtime are independently reusable shared modules.

## Document structure

`StudioDocument` has `schemaVersion`, `id`, `name`, `theme`, `navigation`,
`pages`, `modals`, `liveActivities`, `dataSources`, and `variables`.

- Pages contain component trees, layout settings, and configurable toolbar
  actions. Tabs reference page IDs; the initial page must exist.
- Modals have the same editable contents plus presentation and detent settings.
  Switching from Interact to Edit selects the currently displayed modal rather
  than closing it. The selected sheet tab and presenting page are preserved;
  dismissing the modal returns to that page.
- Live Activities contain `lockScreen`, `compactLeading`, `compactTrailing`,
  `minimal`, and `expanded` component trees. They describe layouts only: this
  server does not start ActivityKit activities or send APNs updates.
- Components accept only known types. Actions are declarative: navigation,
  modals, dismiss, variable set/toggle, service, URL, and support actions.
  JavaScript execution, arbitrary HTML, and arbitrary proxy endpoints are not
  supported.
- Only sections, tile grids, lists, and carousels can contain child components.
  Their actions apply to bound record taps; child components keep their own
  actions. Camera feeds use their configured camera controls, and spacers are passive:
  neither accepts a custom tap action. Use a camera button or action tile.
- Bindings reference named data sources with an optional dot path. The browser
  SDK resolves their sample data; `/api/data/:id` provides the server-resolved
  sample or live data. Paths cannot traverse prototypes.
- Resolved bindings override literal text/status/settings values. Profiles can
  bind a profile object instead of fixed display content. Editing a data source
  invalidates fetched preview data; late responses cannot replace a newer source
  definition. Changing saved initial variables resets session overrides.
- Visibility conditions compare variables or safe HA entity IDs. Numeric
  comparisons do not coerce strings. Missing values are not truthy.
- `theme.background` optionally holds `image`, `dim` (0-0.9), and `blur`
  (0-40 CSS pixels). The editor resizes uploads and embeds bounded JPEG data;
  safe HTTP(S) and root-relative URLs are also supported. Native initialization
  uses the authenticated `/api/native-wallpaper` marker, resolved relative to
  Studio's Ingress prefix, not an arbitrary HA proxy.

Unknown versions, fields, component types, and action types fail validation.
IDs are bounded and component IDs are unique across the document. At most 50
pages, 64 modals, 20 Live Activities, 100 data sources, 100 variables, and 2000
components are supported. Component nesting is limited to eight levels; JSON
recursion and the 1 MiB serialized document also have hard bounds. Draft-save
and validation request bodies allow an additional 64 KiB for the JSON envelope
and whitespace; this does not increase the document limit. Other request bodies
remain limited to 1 MiB. HTTP(S) and
root-relative action URLs are accepted; credential-bearing, protocol-relative,
script, file, and data URLs are rejected. Service targets are a single safe
entity ID; target overrides in service data are rejected.
Root-relative links resolve against the browser's current origin, not its
Ingress path, and do not create an HA API proxy.

Native `initialDestinationId` and `initialTabId` must name a child of a
navigation stack or tab group inside the action's target modal. These references
are validated and followed on repeat navigation, not just first mount.

Specialized destinations import editable source configuration and supported
entity controls. Chores use the explicit typed todo collection below.
Recipes/inventory, maps, household/vacation collections and other unimplemented
non-entity collections still need separately verified collection APIs.
Such nodes carry `requiredData` and render their configured unavailable state;
renaming a source cannot bypass that marker. Remove it only when wiring a
verified collection source. They never treat the complete entity feed as
collection records. People at Home
is derived from `person.*` state. Non-service native commands remain unavailable,
while mapped HA service controls are simulated in the browser. Profile identity
and forecasts are live runtime overlays and are not written into the document.
Resident-only tabs compare the authenticated ID with configured `haUserId`
values, not display names; all tabs stay editable even without a matching user.

Native numeric controls use projected `min`, `max`, and positive `step`;
humidifiers use `currentHumidity`, `targetHumidity`, `minHumidity`, and
`maxHumidity`. Missing capabilities disable the corresponding control.
Read-only state controls accept helper domains; configured `button` and
`input_button` press actions remain usable before their first press. Media
headings open configured remotes separately from playback controls. All
specialized controls honor component disabling, prerequisites, and Edit mode.

## Editor navigation and device studies

The [sidebar guide](sidebar.md) describes real tab/child links, context menus,
placement dialogs, and confirmed page removal. Runtime tabs retain the
originating tab through child pages; shared pages prefer the tab used to reach
them, rather than inventing a persistent parent relationship.

In Edit mode, drag a component's body or its handle. Text is not selected.
The highlighted edge is the exact before/after insertion point; a group's
separate "Drop inside" area nests content. Dropping on empty canvas appends.
Handles also support Space, arrow keys, Space to reorder and Escape to cancel.
The status-rail scrollbar remains scrollable; drag its chips or its explicit
group handle instead of the scrollbar.

The two rotation controls turn the viewport 90 degrees in either direction.
In 3D mode, dragging or focused arrow keys rotates the model around its center.
Dragging Duo's fold-angle slider enters 3D and animates the two display faces.
The faces use a local captured frame, not duplicate interactive apps. Existing
media is frozen from already-decoded pixels without reopening streams; no
captured frame is uploaded or saved. Capture errors retain the flat display and
show an explanation (cross-origin media can prevent browser capture).
Return to Flat to edit or interact. The single mounted app preserves state.
Reduced-motion preferences suppress animation. These remain illustrative
browser geometry and hinge studies, not native hardware verification.

## API

All paths below are relative to the Studio origin or its Ingress prefix. All
errors are JSON with `error`; validation failures additionally include
`errors: string[]`. Every write uses JSON and must be same-origin when a browser
sends origin/fetch metadata. Non-browser callers use bearer authentication in
production. Do not put credentials in URLs or configuration documents.

Native composition 2.0 has its own `/native/api/*` surface, including
`/native/api/ha/*` for publishing to Home Assistant; see
[native-composition.md](native-composition.md#publishing-to-home-assistant).

| Method and path | Request | Response |
| --- | --- | --- |
| `GET api/draft` | None | `DraftEnvelope` |
| `PUT api/draft` | `{document, expectedRevision}` | Updated `DraftEnvelope`; stale revision is `409` with `currentRevision` |
| `POST api/validate` | `{document}` | `{valid, errors: string[]}`; semantic invalidity is HTTP 200 with `valid:false` |
| `GET api/export?format=json\|yaml&source=draft` | Defaults: `json`, `draft` | Download of the document, not its revision envelope |
| `GET api/schema` | None | Draft-07 JSON Schema, plus a semantic-validation note |
| `GET api/health` | None | `{status,mode,haConnected,draftRevision,liveActionsEnabled,feedbackMode,schemaVersion}` |
| `GET api/data/:id` | Existing draft data-source ID; registered search sources accept `?q=` | `{data, mode:'sample'\|'live'}` |
| `GET api/read-endpoints` | Authenticated authoring session or verified Ingress | Safe registered endpoint metadata only: `id`, `name`, `kind`, `searchable` |
| `GET api/native-home` | Authenticated authoring session, bearer, or verified admin Ingress | `NativeSnapshot`: `{mode:'live',houseConfig:{schema:2,hash,config},states:NativeState[],currentUser?:NativeCurrentUser,warnings?:string[]}`; no sample fallback |
| `GET api/native-wallpaper` | Same authoring authentication, including in development | Fixed HA `/local/images/house.webp` image; bounded raster only |
| `GET api/cameras/:entityId/stream` | Authenticated same-origin read for a configured native camera | `{transport:'hls',streamId,url,idleSeconds}`; URL is Studio-relative, not HA's token-bearing URL |
| `GET api/cameras/:entityId/mjpeg` | Same camera authentication and configured-camera restriction | Local `transport:'mjpeg'` stream descriptor |
| `GET api/cameras/streams/:streamId/live.mjpeg` | Authenticated same-origin read | Continuous bounded JPEG frames with reconstructed multipart headers; no audio |
| `GET api/cameras/streams/:streamId/:file` | Authenticated same-origin read | Reconstructed HLS manifest or bounded MP4 initialization media |
| `GET api/cameras/streams/:streamId/segment/:file` | Authenticated same-origin read | Bounded completed HLS media segment |
| `DELETE api/cameras/streams/:streamId` | Authenticated same-origin JSON `{}` | `{released:boolean}`; aborts the local lease and frees its stream slot, idempotent after release |
| `POST api/actions/execute` | `{action, confirmed?:boolean}` | `{mode:'simulated',executed:false}` by default; non-service actions also include `actionType` |
| `POST api/feedback` | `{kind:'report-issue'\|'request-feature',title,description}` | HTTP 201 local durable record `{id,status:'queued',createdAt,kind,title,description}` |
| `POST api/auth` | `{token}` | `{authenticated:true}` and an eight-hour HttpOnly, SameSite=Strict session cookie |

`DraftEnvelope` is `{document,revision,updatedAt}`. Saving increments the revision.
These schema-1 endpoints edit a design-only preview: the native app reads no
schema-1 document, so they no longer publish. `POST api/publish`,
`GET api/published` and `GET api/events` were retired (they return 404), and a
`published.json` left in the data directory is neither read nor changed. Delivery
to the app is the schema-2 *Publish to Home Assistant* path.
Reload is serialized with save. If local edits occur while a reload is
pending, its response is discarded with a notice instead of erasing those edits
or their undo history.

Import JSON with `JSON.parse` or YAML with `yaml.parse`, call validation, then
send the parsed document through the normal revision-checked `PUT`. There is no
unchecked import endpoint and no automatic publish.

## Data and actions

Bound containers honor `props.columns` and `props.gap`. Carousels also accept
`props.rows` (1-8 rows per page); page count comes from the actual record count.
Previous/Next controls operate in Interact mode. Increased text scale reduces
the effective column count instead of shrinking text.

Collections can use `props.sortBy` and `props.sortDirection` (`asc`/`desc`).
`props.sortDirectionVariable` overrides the direction: `desc` or `true` sorts
descending; other values sort ascending. For filtering, `props.filterPath`
selects a record field and `props.filterVariable` supplies the exact matching
value; an empty string or null clears the filter. Toolbar, modal, and tile
set/toggle actions can drive these variables without special-case page logic.
Both sorting and filtering leave the source data unchanged.

`static` sources always return sample data. `ha-state` sources require
`entityId` and call only HA's fixed state endpoint. The live response is projected
to `entityId`, `state`, `name`, and `unit`, not arbitrary attributes. With no
server-side HA credentials, these sources return their sample with
`mode:'sample'`. An upstream error when configured returns an explicit `502`,
never a success-shaped sample fallback.

`endpoint` sources reference an administrator-registered server ID in `endpoint`,
not a URL. An optional `queryVariable` names a string variable (initial value at
most 500 characters). **Data sources** exposes endpoint-ID editing, authenticated
registry discovery, and query-variable selection. Changing the source kind
removes incompatible endpoint/entity/query fields.

Endpoint search requires explicit session consent even when native readings
are already live. Only the active, unobscured search in **Interact** mode sends
the current preview variable as an encoded `q` parameter to the saved source's
read route. Searches wait 300ms after typing; Enter submits immediately. Blank
queries make no request, and query sources never poll. Changing the query,
surface, mode, consent, or document cancels superseded requests; late replies
and earlier results for a repeated query cannot replace the current query.
A native identity change or failed native read revokes search consent.
Query changes do not discard unrelated native state/profile readings. Invalid
non-string or oversized preview queries produce an explicit error. Source
changes must be saved before fetching; live results never update saved samples
or initial variables. Offline samples remain editable. Endpoint registration,
authentication, projection and credential boundaries are described in
[read-endpoints.md](read-endpoints.md).

`native-home` sources use only verified named endpoints listed in
`src/shared/native-endpoints.ts`, never author-supplied URLs. An endpoint also
requires an explicit output adapter before it can expose live data. Existing
integration APIs and Studio configuration consumption are separate contracts;
this package does not claim that the current iOS application reads these
documents or listens to Studio SSE.

The initial name `push-config` calls only `GET /api/fenton_home/config` and
projects `available`, `bundleId`, and `criticalAlerts`. The integration's
`push_url` is deliberately not exposed. There is no house-layout REST endpoint:
the existing typed house configuration uses Core WebSocket commands, not this
Studio document protocol. No arbitrary WebSocket bridge is provided.

### Read-only native bootstrap

`GET api/native-home` reads the existing integration's one-shot
`fenton_home/house_config` Core WebSocket command and then `GET /api/states`.
The same authenticated WebSocket reads `auth/current_user` and, for referenced
configured Chores lists with `todo/item/list`, and, for referenced weather
entities advertising forecast support, the initial
`weather/subscribe_forecast` update for `daily` and/or `hourly`, followed by
`unsubscribe_events`. It never uses `call_service` or an author-supplied command.
Only the server authenticates to HA. This endpoint requires the same Studio
authoring authentication as production APIs even in the unauthenticated
development demo; Ingress still requires the actual verified peer, exact path,
sanitized identity, and admin group.

The envelope retains the upstream `schema:2`, SHA-256 `hash`, and `config`
unchanged. This is the existing native HouseConfig, **not** a Studio document.
The backend validates the transport envelope, required top-level schema-2
sections, and bounded JSON; it does not claim to implement the entire Swift
typed decoder. Browser mapping must explicitly validate the fields it consumes.
The result is a bootstrap snapshot, not an atomic HA transaction or a live
subscription. Fetching it never saves, publishes, reloads Core configuration,
or calls a service.

`states` contains current HA states whose safe entity ID appears as a
string value or object key in `houseConfig.config`, plus the five climate-room
IDs that Swift's `ClimateConfig.Room` derives from each configured room title:
virtual thermostat, temperature, occupancy, tracking, and critical protection.
The mapper and server share this derivation; these IDs count toward the same
1000-entity limit. An unsafe derivation is rejected, not repaired. Occupied-only
switches still require explicit configuration. Unreferenced entities and
missing entities are not fabricated. Each record has `entityId`, string `state`,
and `name` (HA `friendly_name`, otherwise the entity ID). Optional fields are
`unit`, `icon`, `deviceClass`, `brightness` (0-255), `temperature`,
`currentTemperature`, `hvacAction`, `percentage` (0-100), `currentPosition`
(0-100), `volumeLevel` (0-1), and `isVolumeMuted`. `supportedFeatures` is the
nonnegative HA capability bitmask. Further allowlisted, domain-specific fields
support simulated controls:

| Domain | Additional projected fields |
| --- | --- |
| Light | `supportedColorModes`, `colorMode`, `colorTempKelvin`, `minColorTempKelvin`, `maxColorTempKelvin`, `hsColor`, `rgbColor`, `xyColor`, `effect`, `effectList` |
| Climate | `minTemp`, `maxTemp`, `targetTempStep`, `targetTempHigh`, `targetTempLow`, `hvacModes`, `presetMode`, `presetModes`, `fanMode`, `fanModes`, `swingMode`, `swingModes`, `currentHumidity`, `targetHumidity` |
| Select / input select | `options` |
| Fan | `percentageStep`, `presetMode`, `presetModes`, `direction`, `oscillating` |
| Cover | `currentTiltPosition` |
| Media player | `mediaTitle`, `mediaArtist`, `mediaAlbumName`, `mediaContentType`, `mediaDuration`, `mediaPosition`, `mediaPositionUpdatedAt`, `source`, `sourceList`, `soundMode`, `soundModeList`, `repeat`, `shuffle` |
| Vacuum | `batteryLevel`, `fanSpeed`, `fanSpeedList`, `status` |
| Weather | `apparentTemperature`, `humidity`, `dewPoint`, `pressure`, `pressureUnit`, `windSpeed`, `windGustSpeed`, `windBearing`, `windSpeedUnit`, `precipitationUnit`, `visibility`, `visibilityUnit`, `cloudCoverage`, `uvIndex`, `dailyForecast`, `hourlyForecast` |
| Configured Chores todo | `todoList` (the explicit collection contract below, not a count or arbitrary attributes) |

These are flat projections of HA's corresponding snake-case attributes,
solely for status and simulated control rendering. Climate target humidity maps
HA's `humidity` attribute to `targetHumidity`; weather `unit` uses
`temperature_unit` when `unit_of_measurement` is absent. Lists have at most 100
entries (16 for supported color modes); color tuples and numeric ranges are
validated. Null optional attributes are omitted; `false` and `0` are preserved.
No arbitrary attributes, person pictures, media URLs, camera URLs, push URLs,
context, or tokens are forwarded.

Shared runtime wire types live in `src/shared/native-state.ts`. The optional
`currentUser` is `{id,name,isOwner,isAdmin,personEntityId?}`, obtained only from
HA's actual `auth/current_user` response. A person ID is included only if
exactly one valid `person.*` state has a matching `attributes.user_id`; names
and token contents are never used to infer identity. No credentials-provider
or MFA metadata is forwarded. This identifies the server's HA connection user,
not necessarily the Studio browser's authoring-session or Ingress user.
Missing or malformed identity produces an explicit sanitized `warnings` entry
and no invented profile. The verified named `house-profile` data-source adapter
returns `{mode:'live',data:NativeCurrentUser}` using the same snapshot reader,
or `502` if the authenticated identity is unavailable. With no HA connection,
named sources retain their normal editable sample behavior.

Forecast records require an ISO `datetime`; optional fields are `condition`,
`temperature`, `templow`, `precipitation`, `precipitationProbability`, `humidity`,
and `windSpeed`. Only supplied, valid values are included, in HA's original
order. Temperature uses the state's `unit`; precipitation and wind use
`precipitationUnit` and `windSpeedUnit`. The server reads at most eight distinct
referenced weather entities, with at most 32 daily and 192 hourly records per
entity. Unsupported, missing, malformed, oversized, or timed-out forecasts are
omitted with sanitized `warnings`; valid current state and other forecasts are
retained. Extra entities over the read cap are explicitly reported rather than
queried. Forecast arrays are not silently truncated. Profile and forecast data
are runtime-only: fetching never writes them into documents or samples.
`api/data/:id` retains its `{mode,data}` envelope; the `house-states` adapter
returns projected states, not snapshot-level identity or warnings.

### Chores collection and simulation

The backend reads only exact safe `todo.*` IDs in
`chores.pages[].lists[].entityId` or `chores.people[].summaryLists`.
Other referenced todo entity states do not grant collection access.
The existing `house-states` source carries each list's optional `todoList`:

```typescript
type NativeTodoItem = {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  description?: string;
  due?: string;
};
type NativeTodoRead =
  | { status: 'ready'; items: NativeTodoItem[] }
  | { status: 'error' | 'unavailable'; message: string };
```

HA's `due_datetime`, `due`, and `due_date` are projected to `due` in that
precedence order. Identity falls back from `uid` to `summary`, as in native.
Malformed/duplicate identities, unknown statuses, invalid dates, unsafe text,
or oversized lists reject that list; they never become an empty/sample list.
There are at most 64 distinct configured list reads, 1,000 items per list,
512 characters per identity, 2,000 per summary, and 16,384 per description.
Exceeding 64 lists reads none and reports a warning. Optional reads time out
after 1,200 ms within the existing overall snapshot deadline and byte bounds.
Missing states are not fabricated. One failed list does not discard other
valid lists. `ready: []`, loading, error, and unavailable remain distinct.

Only `todo-items` and `resident-todo-items` opt into this contract;
`requiredData` still blocks unimplemented domains from dumping entity states.
Root lists use their exact configured `currentUserIds` (empty means everyone).
Resident summaries match the authenticated connection user's ID to configured
`people[].haUserId`, never a display name. Overdue uses `summaryLists.overdue`;
Upcoming uses `dueToday` then `noDueDate`. Known zero counts and loaded empty
sections disappear, while recently completed Undo rows retain their section.
Quick-link counts use native positive integer entity-state counts, not a guess
at task ownership. Live records and the current user are runtime overlays,
never configuration content. Every native snapshot refresh updates states and
identity together, including refreshes initiated only by the states source.
Missing identity or a failed snapshot clears the prior user. Authored children
inside authorized Chores collections use the normal editable component renderer;
they are not replaced by the generated task rows.

Chores rows offer completion/reopening, five-second in-place Undo, leading
completion and trailing Edit/Delete swipes, full-swipe actions, and keyboard
menu alternatives. Task/Profile delete asks for confirmation; groceries delete
immediately; admin todo supports rename but not delete. Motion transitions are
browser approximations with reduced-motion support, not UIKit measurements.
All add/edit/delete/completion changes are shared **ephemeral simulations**,
visible across Chores and its Profile destinations, with a visible reset.
Identity changes clear them and dismiss open forms, delete confirmations and
swipe gestures; callbacks from the prior identity cannot restore stale edits.
No HA mutation request or draft save is issued.
The editor intentionally supports only name, description, due date/time and an
explicit simulated target list. Native DoneTick assignment, priority,
recurrence and attachments require its separate task-detail/form contract
(`donetick.get_task`, `create_task_form`, `update_task_form`), not todo items.
Studio neither invents that metadata nor invokes those mutation services.

#### Existing-draft compatibility and parent-owned upgrade

Existing `todo-items` / `resident-todo-items` lists do **not** need replacement
to consume typed records. Keep their `requiredData` values, IDs and
`binding.sourceId: native-states`. After the updated server loads, a successful
runtime refresh supplies `todoList` through that same binding; it does not
copy items into `dataSources[].sample` or change the saved document. Existing
`currentUserIds`, `people`, `profileSourceId` and `summaryListKeys` determine
authorization/identity. List-level `profileSourceId` still defaults to
`native-profile` when absent. A count-only response stays unavailable rather
than becoming sample tasks. Existing `nativeTodoPage: true` groups render the
native hierarchy without their old redundant group title. Page-level task
controls also support the existing first-list `addAction` / `hasTaskForm`.

The remaining configuration upgrade is a **props-only Chores-specific diff**,
not a full reimport. A fresh mapper result is reference configuration only;
its generated IDs must never replace existing IDs.

| Existing node | Explicit upgrade, where missing or confirmed to be an unchanged mapper default |
| --- | --- |
| `nativeTodoPage` group | Add page `addAction`, `hasTaskForm`, `vacationEntityId` and `vacationEmptyText` from the matched configured page/household. Preserve `resident`, `hiddenByVacation`, `hideListHeaders` and authored empty copy. An old generated group title equal to the native page title may be cleared; a custom title is not evidence that the whole group should be removed. |
| `todo-items` child | Keep the collection, `requiredData`, binding, exact `entityId`, `currentUserIds`, completion settings and order. Add missing `profileSourceId` / configured `people` for the explicit current contract. Do not delete other residents' configured lists or currently empty lists: native runtime visibility handles them. |
| Chores quick link | Follow its existing navigate action to the matched configured todo page. Add `choreLink` (that page's configuration only), configured `people`, `profileSourceId` and a `native-states` binding when absent. Preserve the component ID, navigation target, title/icon and layout. An existing custom binding requires review, not replacement. |
| Profile `resident-todo-items` | Match by exact `summaryListKeys`: `overdue` versus `dueToday, noDueDate`. Add missing `hideCompleted`, native empty title/copy and vacation props. Change the old generic `Nothing To Show` only when confirmed generated, not authored. Keep the collections, enclosing tab IDs, resident gates and all other Profile tabs unchanged. |

Parent integration must read the latest draft/revision and fresh native
snapshot; a previously observed revision/hash is not write authorization.
Match the main Studio `chores` page to configured page ID `chores`, and
unmodified `native-todo-<id>` destinations to configured page ID `<id>`.
Within that matched surface, match collections by exact configured `entityId`,
not display titles or global generated serials. Ambiguous matches, changed
list sets or edited identifiers require review; do not guess or silently
drop/recreate nodes. Do not flatten/reorder custom children or replace a tab
container just to update its Chores descendants.

Stage a patch inventory with node ID, property path, expected old value and
proposed value. Validate the candidate and verify unchanged non-Chores paths,
source IDs, navigation targets and the existing collection-ID set before
`PUT api/draft` with that freshly read `expectedRevision`. A `409` requires
a fresh read and explicit rebase; never overwrite local edits. Do not publish
automatically. This implementation does not write or migrate live drafts.

HouseConfig is rejected rather than redacted if it contains credential-shaped
keys (including token, secret, password, credential, push URL, API key, webhook,
authorization, or private-key names), credential-bearing HTTP URLs, templates,
or executable URL schemes. Known server credential values anywhere in the
outbound snapshot also cause rejection. This conservative policy can reject
otherwise native-readable custom fields; operators must remove those fields
from the HA layout file. No modified config is returned under the original
hash, and upstream error bodies are never exposed.

**Data sources → Initialize from Native Home** maps this snapshot into an
editable Studio document. The review dialog lists page/modal counts and
limitations. Confirmation replaces only the local editor document, supports
Undo, and does not save or publish. Existing saved drafts are never
automatically replaced. The source HouseConfig is not modified.

The mapper preserves configured Home chips, root tabs, room definitions, camera
references, quick links, and supported status content. The named `house-states`
adapter uses the same fixed one-shot snapshot reader and returns its projected
states as `{mode:'live',data:[...]}`. It requires authoring authentication even in
development. Components resolve states by entity ID, not array position.
Applying the reviewed native import enables live preview reads immediately,
without requiring a save. Connected, saved native documents also start with
live reads; ordinary example documents remain opt-in. The **Live data** button
and Data sources checkbox can stop all data and camera reads for the session.
Native state reads use the fixed bootstrap endpoint, while other data sources
must match their saved definitions. Unsaved layout edits do not pause readings;
changed non-native source definitions require saving first.

Enabling reads triggers an immediate fetch, then polls at the source interval.
Requests do not overlap and are aborted on source/document changes, opt-out, or
unmount. Late responses cannot repopulate another document or a disabled session.
Live values are not written into source samples or exports. A failed refresh
retains the last session preview with an explicit stale-data error; missing
states are not presented as zero or off.

The imported background requests only HA's fixed `/local/images/house.webp`.
It rejects redirects, responses larger than 2 MiB, non-PNG/JPEG/WebP MIME
types, invalid image signatures, and known credential content. Credentials and
upstream headers are not forwarded. A missing image is displayed as an explicit
background error; a custom uploaded image remains available instead.

This is a source-based browser approximation, **not 1:1 native emulation**.
The enriched read contract does not prove native control rendering, native
account behavior, or physical-device delivery. Todo editing and device actions
are not enabled by these reads. No mapping, navigation, or browser service
button operates real devices.

The complete snapshot fetch has an eight-second deadline; disconnecting the caller
or stopping Studio cancels it. Every WebSocket completion/error path closes its
socket. Optional identity/forecast commands have a 1.2-second per-command
deadline within the overall deadline; forecast unsubscription acknowledgments
are bounded as well. Config is limited to 256 KiB; WebSocket messages to 260 KiB,
the session to 128 messages and 4 MiB; raw state
HTTP responses to 4 MiB; referenced entities to 1000; and the final snapshot to
1 MiB. Shared JSON limits additionally bound depth (40), nodes (30000), strings
(16384), arrays (1000), and config object keys (100). Oversized, duplicate, or
invalid required state data fails the entire request, not a truncated success.
Optional read failures are explicit warnings as described above; whole-snapshot
cancellation and timeout still fail the request.
Errors return `401` for missing authoring authentication, `503` for missing HA
credentials/unconfigured house layout or cancellation, `504` for timeout, and
`502` for unsupported schema, absent command, upstream failures, or unsafe data.

Protocol sources:
[HA authenticated user command](https://github.com/home-assistant/core/blob/dev/homeassistant/components/auth/__init__.py),
[HA forecast subscription](https://github.com/home-assistant/core/blob/dev/homeassistant/components/weather/websocket_api.py),
and [forecast capability flags](https://github.com/home-assistant/core/blob/dev/homeassistant/components/weather/const.py).

### Live camera media

Native camera cards and viewers use the same live-data switch as state reads.
A `camera-button` with `props.presentation:"camera-card"` and `props.entityId`
shows a cropped live card. A `camera-feed` with `props.entityId`,
`props.viewer:true`, and `props.aspectRatio` uses an aspect-fit viewer.
`props.controls` contains `snapshot`, `sound`, and/or `record`; native import
includes Record only when the camera declares a recording script.

The server derives camera authorization from the current native house
configuration's camera list, not a hardcoded household or browser claims.
It requests Core's fixed `camera/stream` WebSocket command in HLS mode.
It keeps HA's token-bearing HLS path in a short-lived server lease and exposes
only an opaque local stream ID. Manifests are reconstructed from a restricted
Core HLS vocabulary, with relative references. There is no author-supplied
upstream URL, cross-origin camera access, redirect following, or unauthenticated
media route. Query parameters and range requests are rejected. Leases expire
after 60 idle seconds; HLS requests have 20-second deadlines, 64 KiB manifest
and 8 MiB media bounds, and concurrency/rate limits.

Playback uses native browser HLS or Apache-2.0 `hls.js`, with completed segments
rather than low-latency blocking requests. If HLS fails, a fixed authenticated
`camera_proxy_stream` read supplies continuous MJPEG. Multipart headers are
reconstructed, individual JPEG frames are bounded, and a 20-second frame gap
ends the upstream read. The browser labels this transport **Live MJPEG (no
audio)**, not HLS or a native RTC stream. If both transports fail, an explicit
error replaces playback; a standalone snapshot is never labeled live.
Offscreen, hidden-tab, disabled, and unmounted viewers abort loading, release
browser media resources, and relinquish their authenticated server leases.
Fallback also releases the failed HLS lease. Idle expiry remains a safety net
for an interrupted cleanup request. A camera
is labeled live only after playback starts; buffering, errors, unavailable
codecs, and reconnect controls remain visible. This does not reproduce the
native app's WebRTC transport or guarantee every browser/camera codec pairing.

Snapshot and Record controls show pending and simulated results; they never
save an image, record media, or call an HA service. Sound toggles actual browser
audio only when an audio track is detected, otherwise it is visibly unavailable.
Streams start muted. No real camera frames belong in automated test fixtures.

### Native presentation and Duo studies

The renderer uses source-derived UIKit row arrangements, capsule status rails,
dark page surfaces, appearance-specific sheets, and wallpaper treatment.
Loading preserves labels and last values, delays skeleton display by 150 ms,
and pulses values over 1.4 seconds. Navigation retains visited page state and
scroll within an Interact session, uses 300 ms full-width push/pop transitions,
and uses a 200 ms crossfade with reduced motion. Tab changes crossfade;
switching editor mode or documents starts a new preview navigation session.
Native cold-start spinner gates and every specialized animation are not
reproduced.

Normal-sized status chips stay on one horizontal rail, including Duo layouts,
with a visible scrollbar for desktop editing. Accessibility-sized text wraps
instead. Navigation tiles reserve title space and wrap without ellipsis.
Adaptive grids respect source-derived minimum widths, distribute spare tracks
in the last row, and leave camera grids unfilled.

Imported chip sheets use native-oriented security modes, air-quality room
cards, light/occupancy activity groups, and room subpages for lights, climate,
occupancy, and contacts. Subpages retain an in-sheet back path rather than
opening generic settings rows. Specialized actuator forms remain explicitly
unsupported or simulated; their presence is not proof of native parity.

Duo has no centered notch or island. Closed posture uses a cover viewport and
trailing controls; open/partial portrait keep continuous content. Partial
landscape splits only pages with `layout.foldAware:true`, using component
`props.foldRegion` values `leading`, `trailing`, or full-width `rail`.
Flat Home remains a single column. Component identity survives folding and
rotation. Viewport sizes are historical reference approximations; cover
rotation, posture thresholds, camera geometry, and CSS depth are not measured
hardware behavior.

### Actions and feedback

Service preview is simulated unless `ENABLE_LIVE_ACTIONS=true`. When enabled,
each call additionally requires `confirmed:true`; a missing confirmation
returns `428`, and missing HA configuration returns `503` without actuating.
Use a server-side HA token with the narrowest practical access; never put it in
the document or browser.

Support actions must open a form and submit to `api/feedback`. Records are
durably queued under `DATA_DIR/feedback`; they are **not submitted to GitHub**.
The bounded queue stops at 1000 records with HTTP 507. Operators can archive
reviewed records from the filesystem. No external issue-tracker integration is
configured by this app.

## Storage and recovery

`DATA_DIR` defaults to `./data` locally and `/data/studio` in the packaged app.
It contains `draft.json`, `published.json`, immutable
`revisions/<revision>.json`, `feedback/<id>.json`, and `.studio.lock`.
Writes use same-directory temporary files, file sync, atomic rename, and
directory sync. A process-local write queue and an exclusive directory lock
prevent conflicting writers. Revision conflicts never silently overwrite.

Back up this directory while the app is stopped. Invalid JSON, unsupported
schema versions, or inconsistent published snapshots fail startup without
replacing data. After an unclean process kill, inspect `.studio.lock` and
confirm its recorded process is no longer running before removing that one
lock file and restarting. Never remove a lock while another server is writing.
Normal SIGTERM/SIGINT stops event streams and releases it.
