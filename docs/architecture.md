# Architecture: Native Home configuration studio

Status: research recommendation, not an assertion that these features are implemented.
Source review: 2026-11-12. See [research and pinned sources](research.md).

## Decision

Build an installable Home Assistant **App** containing a configuration editor,
validated server-driven UI documents, durable revision storage, and a browser
preview. Keep Home Assistant Core authoritative for entities, permissions,
services, automations, mobile registrations, and notification delivery.

Keep `SFenton/ha-fenton-home` in place. Its Core WebSocket commands, `mobile_app`
registration access, person-target fanout, and private Live Activity token-store
recovery cannot simply move into a separate container. The App can own the editor
and document store immediately. A later thin Core integration can expose published
documents through the same authenticated Core connection used by native clients.
Extracting an APNs worker is possible later, but is a migration with explicit
protocol, credential, retry, and lifecycle work, not an MVP prerequisite.

**Existing Native Home is not a generic SDUI renderer.** At the inspected commit it
accepts a fixed, typed `HouseConfig` **schema 2**, including role validation. It does
not accept arbitrary page/component JSON, HTML, new component kinds, or this
studio's proposed schema. Publishing in the studio must never be labelled
"deployed to iPhone" until a compatible native consumer actually exists.

## Bounded MVP

| Implement now | Explicitly outside the MVP |
| --- | --- |
| A React/TypeScript editor with a component palette, hierarchy, property inspector, constrained reorder/move, and undo/redo | Changes to the existing native app or its compiled rendering behavior |
| An explicit synthetic demo provider; optional read-only HA entity/service discovery | Writing live HA configuration, issuing physical device commands from previews |
| Server-persisted draft, validation, immutable published revisions, export, and rollback | Automatic installation/removal of the existing integration |
| One shared browser renderer used by canvas and preview | Native pixel parity, actual simulator/device behavior, APNs delivery validation |
| Responsive phone/tablet/desktop viewports, appearance controls, and a clearly simulated fold/hinge option | Device Posture APIs as a required cross-browser dependency |
| Fixed-template Live Activity content previews with payload limits and stale/ended states | Arbitrary remotely supplied SwiftUI, background SSE in Live Activities |
| HA OS App packaging and Ingress-compatible paths | Claiming HA Container has Supervisor App installation |
| Revision notifications with reconnect recovery | Collaborative CRDT editing, plugin execution, remote JavaScript or Jinja evaluation |

A runnable fixture-mode development server is useful for LAN design review, but
is a **different deployment mode** from authenticated production Ingress. It must
contain only synthetic data and no Supervisor/Core credentials. LAN access does
not justify exposing an unauthenticated production editor.

## Ownership and deployment

```text
Browser
  -> HA authenticated Ingress -> App backend -> private /data document store
                                      |
                                      +-> Supervisor Core proxy, read-only usage
                                           -> Core entities/registries/services

Future native client
  -> existing HA OAuth + Core WebSocket
       -> future Core document bridge -> App published snapshot
```

The App is a backend-for-frontend, not an unrestricted proxy. Serve its built web
assets and API from one origin. Keep HA credentials in the backend process only.
Bundle assets locally; loading a CDN must not be required for household control
or editing. No Core configuration mount is necessary for studio-owned data.

Suggested implementation units, not additional services:

- Shared document types, bundled JSON Schema, semantic validation, and fixtures.
- Browser editor and renderer; the editor mutates documents, not arbitrary DOM.
- Backend persistence, publish transactions, revision stream, and authorization.
- A provider boundary with explicit `demo`, `connected`, `disconnected`, and
  `unsupported` states. Never silently replace a failed real connection with demo
  entities.

One process and one persistent store are enough. SQLite transactions are suitable;
a bounded single-writer atomic JSON store is also acceptable for the first
release if it meets the persistence guarantees below. Do not introduce a broker,
Redis, cloud account, or second configuration authority for this scope.

## HA App packaging

The installable repository needs a root `repository.yaml` and an App directory
containing `config.yaml`, Dockerfile, and user documentation. Preserve the existing
README/icon while adding packaging in the implementation phase. Use a public
multi-architecture image for `aarch64` and `amd64`, with immutable version tags.
The current official builder uses composable actions rather than its deprecated
all-in-one action; details and exact URLs are in [research.md](research.md).

Production configuration should start with:

```yaml
ingress: true
ingress_port: 8099
panel_admin: true
startup: application
boot: auto
backup: cold
```

These are recommended fields, **not a complete installable config**. Add the
required identity/version/architecture fields. Set `init: false` when using a
Home Assistant S6 base image; otherwise follow the chosen image's process model.
Do not request host networking, host ports, Docker access, privileged capabilities,
or a mount of the Core configuration directory.

Use `/data` for the store and migrations. `backup: cold` is the simplest correct
initial backup strategy; hot backup requires a tested consistent snapshot,
especially with SQLite/WAL. Start without `hassio_api` or `auth_api`. Enable
`homeassistant_api` only when implementing Core discovery/authorization: it grants
**administrator-level Core access**, even if the application voluntarily performs
only reads. A Supervisor role does not narrow that Core authority.

Use relative paths for assets, navigation, HTTP, and SSE under
`/api/hassio_ingress/<token>/`. Do not hardcode this prefix or persist it as a
native client endpoint. `ingress_stream` controls uploaded request-body streaming;
it is not needed merely to stream an SSE response.

## Authentication and authorization

Ingress production mode must reject non-Supervisor peers before accepting identity
headers. The official address is `172.30.32.2`; check the actual socket peer, not
an attacker-supplied `X-Forwarded-For`. If a local reverse proxy terminates that
connection, it must enforce this restriction and be the only route to the backend.

The Supervisor supplies sanitized `X-Remote-User-Id` and optional name headers.
Missing identity is an authorization failure, not an anonymous/default editor.
Current Supervisor source also enforces `panel_admin` and sends sanitized group
information; official configuration prose describes the setting only as sidebar
visibility. Do not assume those newer behaviors exist on every deployed version.

For a version-independent admin-only studio, resolve the trusted user ID
server-side using Core `config/auth/list`, which requires the backend's admin
connection. Authorize only an active owner or active member of `system-admin`.
Never return the user directory to the browser. Revalidate privileged writes;
fail closed when authorization cannot be established. Alternatively, rely on
Supervisor's enforced admin/group contract only after establishing and testing
a minimum supported Supervisor release. Header presence alone is not admin proof.

Apply authorization to reads, writes, exports, revision history, and event
subscriptions, not just page navigation. Add same-origin/Origin checks and CSRF
protection for mutations, strict JSON content types, request/body limits, and
rate limits. Do not allow arbitrary CORS. Treat Ingress URLs, webhook IDs,
refresh tokens, and APNs tokens as credentials and redact them from logs.

The minimum data provider exposes selected entity identifiers, display names,
domains, states, and a bounded allowlist of useful attributes. No unrestricted
Core URL, arbitrary WebSocket type, arbitrary service executor, user-management
endpoint, camera stream proxy, or secret-bearing configuration endpoint belongs
in the browser API.

## Proposed SDUI document contract

Use a distinct `documentType` and `schemaVersion`. This version is unrelated to
Native Home's `HouseConfig.schema`, the App release version, the JSON Schema
specification version, and the publication revision.

An illustrative document, not a document supported by current Native Home:

```json
{
  "documentType": "native-home-studio.ui",
  "schemaVersion": 1,
  "id": "main",
  "title": "Demo home",
  "requiredCapabilities": [
    "layout.stack.v1",
    "component.heading.v1",
    "component.entityTile.v1"
  ],
  "theme": { "mode": "system", "accent": "teal" },
  "pages": [
    {
      "id": "home",
      "title": "Home",
      "root": {
        "id": "home-stack",
        "type": "stack",
        "gap": "md",
        "children": [
          { "id": "welcome", "type": "heading", "text": "Welcome home" },
          {
            "id": "demo-light",
            "type": "entityTile",
            "entityId": "light.demo_living_room",
            "label": "Living room"
          }
        ]
      }
    }
  ]
}
```

Start with a closed set: stack, grid, heading, text, entity tile, action button,
and divider. Define each as a discriminated union. Use ordered children and stable
node/page IDs; avoid global pixel positioning. Theme, spacing, spans, and icons
come from bounded semantic token sets, not unrestricted CSS or SF Symbols files.
The native adapter can later map semantic tokens to native controls.

Action buttons may hold validated intent descriptors for export, but preview
interaction records a simulated intent rather than calling HA. Future service
descriptors need explicit domain/service/target/data shapes and runtime user
permission checks. A visibility condition is presentation logic, never an access
control boundary. Avoid templates, expressions, executable strings, and arbitrary
URLs; restrict initial navigation to validated page IDs.

Use bundled JSON Schema Draft 2020-12 plus semantic validation. With Ajv, use its
2020-12 class explicitly; the default class uses draft-07. Never compile schemas
supplied by users or fetch external `$ref` URLs. Reject unknown component kinds,
unknown properties, duplicate IDs, dangling page references, illegal nesting,
cycles, excessive depth/count/bytes, invalid finite numeric values, and
unsupported required capabilities. Report a JSON Pointer and reason for each
failure. Entity absence/unavailability is a distinct, visible binding diagnostic,
not a reason to erase user-authored layout.

Suggested initial product limits: 256 KiB serialized document, 20 pages, 500 total
nodes, nesting depth 8, and bounded per-field strings. These are studio design
choices, **not HA or Apple limits**; make them identical in client/server validation.
Structural bounds alone do not prove compatibility with the native typed model.

## Draft, publication, and recovery

Separate a mutable draft from immutable revisions and the active publication
pointer. A document hash identifies content; a monotonically increasing revision
identifies an accepted publication event. A rollback creates a new revision with
old validated content, preserving history instead of decrementing the revision.

Each publish transaction must:

1. Authenticate and authorize; compare the supplied draft version and expected
   active revision with current persisted values.
2. Validate the exact candidate document and target capabilities; return errors
   without modifying the draft, history, or active pointer.
3. Store the immutable snapshot, its content hash, actor, time, source draft
   version, and idempotency key; advance the active pointer atomically.
4. Commit durably before returning success or emitting a revision event.

For SQLite, perform the snapshot/pointer/idempotency changes in one transaction
with appropriate durability settings. For a single-file store, serialize
read-modify-write operations, write a temporary file in the same directory,
flush/fsync, rename atomically, and fsync the directory. All authoritative
publication state must be in the same atomic record; separately replacing a
snapshot and pointer without recovery is not sufficient. A corrupt store must
produce a repairable error, never silently reset to an empty successful project.

Persist idempotency results. A repeated request ID with the same request returns
the original result; reuse with different content fails. This prevents duplicate
publication after a lost response. Define a history/byte retention limit before
deployment and never prune the active revision; make truncation explicit.

Hash the exact immutable UTF-8 snapshot bytes once on the server and serve those
same bytes for content verification. Clients need not reproduce a language's
JSON canonicalization. If independently reproducible hashes become necessary,
adopt a specified canonicalization algorithm with cross-language test vectors.
Do not call the existing integration's Python JSON hash "RFC 8785".

## Proposed browser API and push transport

These paths are **new recommendations**, relative to the App's Ingress base.
They are not existing HA or Native Home endpoints.

| Method and relative path | Contract |
| --- | --- |
| `GET api/v1/session` | Authorized identity summary, mode, capability/schema versions; no credentials |
| `GET api/v1/catalog` | Bounded component palette and permitted entity/service metadata; explicit provider status |
| `GET api/v1/projects/current/draft` | Draft document and version; stable strong `ETag` |
| `PUT api/v1/projects/current/draft` | Full replacement with `If-Match`; atomic save; no automatic publication |
| `POST api/v1/projects/current/validate` | Validate a supplied candidate or exact saved draft version; return structured diagnostics |
| `POST api/v1/projects/current/publish` | `{draftVersion, expectedPublishedRevision, requestId}`; transactional publication |
| `GET api/v1/projects/current/revisions` | Paginated history metadata |
| `GET api/v1/projects/current/revisions/:revision/document` | Exact immutable UTF-8 snapshot bytes as JSON, with content hash/ETag |
| `POST api/v1/projects/current/rollback` | `{targetRevision, expectedPublishedRevision, requestId}`; new revision |
| `GET api/v1/projects/current/published` | Active `{revision, hash, documentUrl}` metadata; relative same-origin document URL; conditional `If-None-Match` |
| `GET api/v1/events` | Authenticated revision-change stream; no draft or token contents |

Use `412` for stale `If-Match`, `428` for a missing required write precondition,
`409` for publication-pointer/idempotency conflicts, `422` for invalid documents,
and `413` for size limits. Use clear `401`/`403` authorization failures and `503`
when required authorization/provider infrastructure is unavailable. Do not report
a successful HA connection when only the studio process is healthy.

SSE is sufficient for one-way revision notification; writes remain ordinary HTTP.
One stream per editor tab, not per card:

```text
id: 42
event: revision
data: {"projectId":"main","revision":42,"hash":"sha256:..."}

```

Use `text/event-stream`, no response buffering, and periodic comment heartbeats.
The event is an invalidation hint: fetch the publication metadata and referenced
snapshot, validate it, and replace the rendered document atomically. Ignore
responses older than the applied revision. Establish the stream before the initial
fetch, or send an initial current-revision event, to close the subscribe/read race.
On reconnect, compare the current revision even if no replay is needed.
If `Last-Event-ID` cannot be replayed, send an explicit reset/current-revision
event. A crash after commit but before notification must still recover by fetch.
SSE does not provide exactly-once delivery or execution acknowledgements.

Browser `EventSource` accepts a URL and `withCredentials`, not arbitrary
Authorization headers. Same-origin Ingress session authentication fits this
case; never solve native access by placing bearer tokens in query strings.
If live HA state is later multiplexed onto the stream, give it separate event
types and resnapshot on reconnect; publication IDs are not HA state versions.

## Preview and interaction choices

Prefer a resizable HTML viewport with a lightweight CSS frame and the same
renderer as the editor. Device chrome is decoration. Use actual viewport width
for responsive layout; scaling a fixed-width screenshot changes appearance,
not layout. Support text enlargement, light/dark appearance, long labels,
empty/error/unavailable states, keyboard navigation, and reduced motion.

Use dnd-kit for constrained moves rather than adopting an entire HTML website
builder. Current packages and older tutorials differ; select and pin one API
generation. Puck is the strongest higher-level alternative if a larger page
editor is desired, but translate its editor data to the product-owned schema.
Craft.js and grid libraries are options, not a reason to expose their internal
serialized state as the native wire protocol.

Devices.css is a viable optional shell; `react-device-frameset` has older device
coverage and its upstream peer dependency excludes React 19. Neither renders
UIKit or SwiftUI. An optional CSS perspective/hinge demo can depict a foldable
without requiring a browser posture API. Keep authoritative editing in a flat,
accessible view. Three.js/React Three Fiber/drei can support a later 3D showcase,
but add geometry/assets, GPU cost, input coordination, and licensing work without
improving native layout fidelity.

Apple's relevant design clause is: **"Offer alternatives to drag and drop"**.
Apply it here through Move Up/Down, Move To, add/delete controls, visible focus,
keyboard operation, and undoable structural changes. This is a project
application of the [drag-and-drop guidance](research.md#preview-and-editor-libraries),
not a claim that the web editor implements UIKit drag APIs.

Live Activity preview should expose compact, minimal, expanded, and Lock Screen
templates, not a freely editable remote view tree. Apple says: **"Offer Live
Activities for tasks and events with a defined beginning and end"**, with the
qualifier **"ideally no longer than eight hours."** Use finite demo jobs,
stale/ended states, and visible "simulated" labelling. Validate actual payload
bytes against the selected contract; a full studio document is not a Live
Activity payload.

## Future compatibility work

Two separate adapters are possible:

1. **Existing typed config adapter:** export a complete, field-valid native
   `HouseConfig` schema 2 document. Preserve all required sections and roles.
   The integration currently reads a file and has an admin reload service,
   not a remote write endpoint. A generic component tree cannot be losslessly
   converted without explicit mappings and declared unsupported constructs.
2. **Future SDUI native adapter:** implement an allowlisted native component
   registry, capability negotiation, safe decoding, native accessibility, and
   same-user last-known-good caching. Prefer proposed Core WS commands such as
   `native_home_studio/layout/get` and `/subscribe` through a thin integration.
   Those names are placeholders, not available APIs. Reuse the native Core
   connection rather than adding an App connection for entity traffic.

The future bridge must define per-user document visibility, authenticate its
App-side connection, validate snapshots before publishing to Core clients, and
handle App outages without losing the last accepted layout. Do not forward the
Supervisor token or use a client's stored publication as authorization to actuate
devices. Logout/server/account changes must invalidate the appropriate cache.

Direct native access to an App port is possible only with a separate supported
TLS/authentication/reachability design. Ingress and an HA Cloud URL do not
automatically provide that port with mobile bearer-token access. A foreground
native subscription also cannot keep a suspended iOS app or Live Activity alive.

## Orchestration structure to retain

Retain the Native Home roles and gates, not its Claude model assignments or
Apple simulator hooks. The requested Copilot/OpenAI mapping is:

| Role | Model policy |
| --- | --- |
| Orchestrator, researcher, designer | Astra, xhigh |
| Coder | Sol 6.1, high |
| Menial | Terra 6.1, medium |
| Verifier, reviewer, steward | Keep separate responsibilities; coordinator must explicitly assign available OpenAI models rather than inventing user choices |

Only the orchestrator dispatches writing roles; this research task dispatches no
children. Researcher/designer advise through bounded source-backed briefs and
implementation specs. Preserve acceptance IDs, owned/excluded files, evidence
paths, a verifier separate from the coder, and independent review separate from
author and orchestrator model. Adapt the reference task ledger, evidence manifest,
and status block protocol to this repository; do not imply its scripts already
exist here.

## Acceptance evidence before a production claim

Demonstrate a clean install/restart and persistence on supported HA OS
architectures; Ingress-prefixed assets/API/SSE; peer/header rejection; non-admin
denial; missing-identity and Core-unavailable fail-closed behavior; credential
redaction; concurrent edit/publish conflicts; interrupted writes; corrupt-store
errors; idempotent retry; rollback; unknown schema/capabilities; and reconnect
after a missed publication. Exercise keyboard-only builder operation and narrow
viewports. These are release criteria, not results from this research.

Actual native adoption and Live Activity delivery require later native/device
evidence. Browser screenshots, valid JSON, an installable Dockerfile, and an APNs
HTTP success response are each insufficient to claim those outcomes.
