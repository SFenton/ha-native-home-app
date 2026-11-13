# Research: Home Assistant SDUI studio

Verified from public source and official documentation on **2026-11-12**.
This is research, not a live-system test or an implementation report. No native
app, integration deployment, or live HA configuration was modified.
The recommendation is in [architecture.md](architecture.md).

## Web-native primitives follow-up

Source/license inspection compared Motion, Radix Dialog, Vaul, Konsta and
Framework7, plus five glass implementations. Studio adopts pinned
[`motion@14.13.0`](https://github.com/motiondivision/motion/tree/v14.13.0) for
sheet entrance springs and a small MIT-attributed
[Konsta 5.5.0 CSS glass adaptation](https://github.com/konstaui/konsta/blob/v5.5.0/src/styles/glass.css)
for navigation chrome. Existing native HTML editor dialogs already provide
browser modality/focus behavior, so the proposed Radix dependency was not needed.
Simulation sheets remain nonmodal relative to the editor.

Vaul's repository declares it unmaintained; Framework7/Konsta wholesale adoption
would introduce competing app/Tailwind conventions. Per-card Canvas/SVG/WebGL
refraction was rejected: additional cost, incomplete Safari/Firefox support,
and in some examples restrictive or missing licenses. The CSS adaptation has
no JavaScript idle/pointer loop, includes an explicit **Opaque chrome** switch,
and respects reduced-transparency/forced-colors. Spring constants are Studio
tuning, not Apple values; live reduced-motion changes disable travel.

The Motion integration increased the measured production JS gzip from about
416 KB to 466 KB before further splitting. This is a bundle measurement, not a
native-parity, frame-rate, Safari, physical-device, or compositor claim.
Licenses and deviations are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Executive findings

- An HA OS App is a good home for the editor, browser preview, draft storage, and
  publication history. Ingress supports streaming and WebSockets.
- Keep a Core integration boundary. The existing integration does much more than
  proxy API requests and depends on in-process Core/mobile_app behavior.
- Current Native Home accepts **typed HouseConfig schema 2**, not a generic SDUI
  tree. Old schema-1 comments/examples are stale; the decoder is authoritative.
- The App Core proxy grants administrator access. It must never become a generic
  browser proxy or leak its token to the editor/native client.
- Browser frames and 3D/folding previews are useful design aids, not native
  emulators. Live Activities require compiled native templates and ActivityKit/APNs.

## Source pins and inspection boundary

Public GitHub source was inspected using `gh api`, without cloning another
project or copying real household configuration into this repository.

| Repository | Inspected commit |
| --- | --- |
| `SFenton/native-home` | `b6a02f0d13806b694ee4b34691b1db524f5e7e7b` |
| `SFenton/ha-fenton-home` | `467aba24be9fe816b022ac3f1476ab7c175dfe22` |
| `home-assistant/core` | `fd864375b04b2b4ed1d6c383a4bd8b0293d6e809` for auth source |
| `home-assistant/supervisor` | `43ac3788d02cd8e77c786ecf698063a8e8b2a4ff` for Ingress source |

The HA source pins are development-branch observations, not proof that every
installed stable release has the same behavior. Official documentation was read
at the URLs below; it changes independently of these pins. This researcher
inspected orchestration, configuration transport/model/store, push client, and
server code, not the native screen designs assigned to the designer.

### Native Home source index

All paths below are in the pinned `SFenton/native-home` commit:

- [AGENTS.md](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/AGENTS.md)
- [.agents/README.md](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/README.md)
- [.agents/workflow/agent-roster.md](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/workflow/agent-roster.md)
- [.claude/agents/orchestrator.md](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.claude/agents/orchestrator.md)
- [HouseConfig.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfig.swift)
- [HouseConfigEnvelope.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfigEnvelope.swift)
- [HouseConfigTransport.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfigTransport.swift)
- [HouseConfigStore.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfigStore.swift)
- [HouseConfigSource.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfigSource.swift)
- [HouseConfigCoding.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Config/HouseConfigCoding.swift)
- [.agents/platforms/apple/push.md](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/.agents/platforms/apple/push.md)
- [apple/Sources/HassCore/Push/HomeAssistantPushClient.swift](https://raw.githubusercontent.com/SFenton/native-home/b6a02f0d13806b694ee4b34691b1db524f5e7e7b/apple/Sources/HassCore/Push/HomeAssistantPushClient.swift)

### Integration source index

The related integration repository is **`SFenton/ha-fenton-home`**, previously
named `ha-fenton-push`. Its domain is `fenton_home`.

- [docs/CONTRACT.md](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/docs/CONTRACT.md)
- [custom_components/fenton_home/house_config.py](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/custom_components/fenton_home/house_config.py)
- [custom_components/fenton_home/views.py](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/custom_components/fenton_home/views.py)
- [custom_components/fenton_home/__init__.py](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/custom_components/fenton_home/__init__.py)
- [custom_components/fenton_home/targets.py](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/custom_components/fenton_home/targets.py)
- [custom_components/fenton_home/recovery.py](https://raw.githubusercontent.com/SFenton/ha-fenton-home/467aba24be9fe816b022ac3f1476ab7c175dfe22/custom_components/fenton_home/recovery.py)

### Chores source and read-only verification

At native pin `b6a02f0d13806b694ee4b34691b1db524f5e7e7b`, these files
establish the implemented Chores behavior (all under `apple/Sources/`):

| Source | Finding |
| --- | --- |
| `HassCore/Todo/TodoServicing.swift`, `TodoItem.swift` | Fixed `todo/item/list` read, identity/due precedence, stable due order, relative due labels and battery-maintenance title |
| `HassCore/Config/ChoresConfig.swift`, `Resident.swift` | Exact list `userIds` visibility and authenticated `haUserId` resident matching |
| `HassCore/Profile/ProfileSummary.swift`, `HassUI/UIKitPort/Features/Household/UKSummaryTabs.swift` | Resident Overdue and Upcoming lists, dueToday then noDueDate, hidden empty sections, vacation copy |
| `HassUI/Features/Chores/TodoPageLayout.swift`, `HassCore/Todo/TodoListController.swift` | Zero/empty visibility and five-second in-place completion Undo |
| `HassCore/Todo/TodoRowActions.swift`, `HassUI/UIKitPort/Features/Chores/UKTodoListParts.swift`, `UKTodoItemRow.swift` | Leading Complete/Reopen; trailing Delete outermost then Edit; full-swipe first action; menu/accessibility alternatives |
| `HassUI/Features/Chores/TodoListSection+Delete.swift`, `HassUI/UIKitPort/Features/Chores/UKTodoPageViewController.swift` | Task/Profile delete confirmation, immediate grocery delete, admin rename/no delete |
| `HassUI/UIKitPort/Features/Chores/UKDonetickTaskViewController.swift`, `HassCore/Todo/DonetickTaskForm.swift` | Separate `donetick.get_task` detail read and create/update form services; list items alone do not provide assignment/priority/recurrence/attachments |

Two causes of missing/extraneous content were in Studio: `requiredData` blocked
all todo records, and configured user-restricted lists were rendered without
their native visibility semantics. Studio now has a bounded, configured-only
typed todo projection and dedicated data-only mapper/runtime support, without
changing the native app or Core integration. Native-style row interactions are
safe browser simulations, not service execution. Full DoneTick form metadata
remains explicitly unsupported rather than being fabricated.

Authorized live reads verified 28 configured lists ready, no list errors,
one authenticated resident match, seven authorized root lists and 14 open
root-list records (862 ms for the final snapshot). Earlier reads observed 15
records; these are changing runtime counts, not a persistent fixture.
No task names, household records or credentials were retained in source or
evidence. The browser fixtures use synthetic people and tasks.

Retained `studio-native-observation/chores.png` and `profile-todos.png` in the
prior session's artifacts are **gallery/demo captures**, not real household
record evidence. They corroborate layout only. The behavior table above is
source-derived. No fresh native/iOS interaction or physical-device evidence is
available: this host is Linux and iOS Simulators require macOS with Xcode.
Browser screenshots/traces cannot prove UIKit, hardware or ActivityKit parity.

## Existing orchestration structure

The reference has eight roles: orchestrator, researcher, designer, coder, verifier,
reviewer, steward, and menial. Model/effort assignments live in role frontmatter.
For this project, retain the structure but use the user's Copilot/OpenAI mapping:
Astra xhigh for orchestrator/researcher/designer, Sol 6.1 high coder, and Terra 6.1
medium menial. Do not transplant Claude model names or silently substitute a
different model when the requested one is unavailable.

The important contracts are:

| Contract | Reference behavior to retain/adapt |
| --- | --- |
| Dispatcher | Only orchestrator dispatches writing agents; researcher/designer return advice/spec requests |
| Brief | Objective, output, sources/tools, owned/excluded paths, acceptance check IDs, relevant device families |
| Ledger | `build/tasks/<id>.json`, reference helper `tools/tasks.py`; completion requires proved checks |
| Evidence | `build/evidence/<branch>/manifest.json`; screenshots/accessibility/test artifacts; classify real vs infrastructure vs known-flaky failures |
| Research note | Answer, sources, fit with patterns, follow/deviate/rearchitect recommendation, confidence, open questions |
| Status | JSON with `status` (`done`, `blocked`, `needs_research`, `needs_decision`), `task`, summary <=250 words, artifacts, per-check acceptance, and any blocking question |
| Independent review | Reviewer is not author and does not use orchestrator's model |
| Pipeline | Intake, research, design gate, ledger/spec, implementation, verification, design verdict, independent review, landing |

These paths describe the **reference repository**, not tooling already present in
this new studio. Native Home's one-EntityStore/one-Core-websocket, HA-owned
automation, and service-intent boundaries are useful product constraints; its
Apple simulator/hook machinery should not be copied indiscriminately.

## Existing house-configuration API

Transport is the ordinary authenticated Core WebSocket at `/api/websocket`.
The custom integration registers commands on that connection.

| Operation | Exact contract |
| --- | --- |
| Fetch | `{"id":N,"type":"fenton_home/house_config"}`; result is `{schema,hash,config}` or `{"configured":false}` |
| Subscribe | `{"id":N,"type":"fenton_home/house_config/subscribe"}`; successful result `null`, then initial event with current payload and events after successful reload |
| Unsubscribe | `{"id":M,"type":"unsubscribe_events","subscription":N}` |
| Reload | Admin-only service `fenton_home.reload_house_config`; rereads disk and notifies subscribers |
| Write/publish | **No remote write/publish command in this implementation** |

Read/subscribe accept any authenticated HA user; the integration does not project
the document per user. Standard Core authentication still applies.

The server reads `/config/fenton_home/house.yaml`, falling back to `house.json`;
YAML takes precedence when both exist. The file must fit within 256 KiB, decode
to a mapping, contain integer `schema >= 1` (not boolean), and have mapping/list
top-level sections other than schema. It rejects non-JSON-convertible data,
NaN/Infinity, recursion/read failures, and oversized input. Validation is shallow:
it does not validate the native model's section fields or required roles.

The schema is removed from `config` and carried beside it. The exact server hash
is SHA-256 of UTF-8:

```python
canonical = json.dumps(
    config, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
)
hash_input = f"{schema}:{canonical}"
```

This is the implementation's Python JSON serialization, not a declared RFC 8785
contract. Reloads serialize through an async lock. Invalid input raises the
`house_config_invalid` Repair and preserves the last good in-memory document.
Missing configuration produces `configured:false`; unloading emits that state.

### What the current native consumer actually understands

`HouseConfig.minimumSchema == 2` and `supportedSchema == 2`.
`HouseConfigEnvelope` reinserts the envelope's schema before calling the typed
decoder. Schema 1 is rejected; newer schemas are explicitly refused. Unknown
object keys are ignored, but missing required fields/roles and unknown tagged
enum variants can fail decoding.

The required top-level sections are:
`home`, `security`, `climate`, `customLights`, `food`, `chores`, `household`,
`media`, `roomDevices`, `sprinklers`, `vacation`, `vacuums`, `bedroom`, and `rooms`.
These populate existing native `*Config` facades. Behavior, service builders,
app-owned prose, and some titles/colors deliberately remain compiled code.

`HassHouseConfigTransport` subscribes using the app's existing `HassConnection`
and HAKit, with retries across reconnects; it does not open a second socket or
poll REST. `HouseConfigStore` loads a server-keyed last-good cache, validates off
the main thread, and applies hash changes in order. Missing integration,
unconfigured server, invalid/newer data, or connected-time timeout leave the
last-good layout intact while reporting status. `stop()` keeps it; `clear()`
on signout clears source/cache and guards against delayed writes resurrecting it.

**Compatibility implication:** sending a new studio schema down the existing
subscription will not create a native SDUI app. A schema-2 export adapter or
new compiled native renderer is separate work.

## Existing push, authentication, and lifecycle contracts

| Endpoint | Authentication and behavior |
| --- | --- |
| `GET /api/fenton_home/config` | Normal HA authenticated view. Returns `available`, `push_url`, `bundle_id`, `critical_alerts`; unavailable runtime yields false/null values |
| `GET /api/fenton_push/config` | Legacy alias. Native client falls back only after a 404 on the current path, not after arbitrary errors |
| `POST /api/mobile_app/registrations` | Core API, signed-in user's HA access token. Returns registration including secret webhook ID |
| `POST /api/webhook/<webhook_id>` | Core webhook credential in the URL; used for `update_registration`, action events, and activity token lifecycle |
| `POST /api/fenton_home/apns` | Deliberately no HA bearer requirement. Validates registration webhook ID, matching configured bundle/app ID, and nonempty push token against registered app_data using constant-time comparison |
| `POST /api/fenton_push/apns` | Legacy relay alias |
| `POST /api/fenton_home/devices/unregister` | Body `{webhook_id}`. Without bearer, webhook possession is proof; with a signed-in HA user, registration owner must match. Only this app's registrations are removable |

The relay's configured/default push URL is intended for Core to reach it, normally
using HA's internal URL; it is not a new internet endpoint for the browser.
The app's native push client fetches the integration config and registers through
Core; it does not replace HA's auth/session API.

Relay outcomes: `201` with `rateLimits` on accepted delivery; `429` for daily
limit; `400` malformed/payload; `403` registration mismatch; `503` unloaded;
APNs dead token `410`, other APNs/credential/network failures generally `502`.
Sandbox/production comes from registration app_data; BadDeviceToken can trigger
one alternate-environment attempt. Exact HTTP status handling is in `views.py`.

Unregister: `200 {"removed":true}`, `410 {"error":"unknown_webhook"}` for a
missing registration or one belonging to a different app, `400` invalid body,
`403` signed-in owner mismatch, `503` unavailable. Unauthenticated requests are
limited to 10/minute/address with `429` and `Retry-After: 60`.
Native client treats 404 as older-server unsupported and 410 as already gone.

Alert payloads combine standard `aps` with `fenton` metadata such as `v`, `tag`,
`group`, `url`, `actions`, `entity_id`, `ext`, and `extra`.
Non-URI notification actions use webhook `fire_event` with
`mobile_app_notification_action`; Core supplies the registration user context.
Background notifications use `aps.content-available` and `fenton.command`; the
existence of a server pass-through does not mean every command has a native handler.

### Existing Live Activity data plane

Core `mobile_app` stores `app_data.start_live_activity_token`; the phone supplies
per-activity tokens/dismissals through `live_activity_token` and
`live_activity_dismissed` webhooks. `data.live_update:true` plus a tag allows Core
to select start/update/end and forward `live_activity_token` and `data.event`.
Only relay requests with that token become APNs `liveactivity` pushes. A
`live_update` lacking it is deliberately dropped with 201 rather than becoming
an ordinary banner.

The compiled attributes type is `HomeActivityAttributes`; APNs topic is
`<bundle>.push-type.liveactivity`. Contract section 7's per-job content **v2**
supersedes the older aggregate-v1 section, with transitional v1 acceptance:

| Field | Current documented shape/limit |
| --- | --- |
| `v` / `phase` | `2`; running, paused, waiting, problem, or done |
| `headline`, `detail`, `short` | Optional strings: 32, 32, and 10 characters |
| `value` | Tagged countdown/countup/percent/text; text at most 16 characters |
| `progress` | Bounded 0..1 when relevant |
| `controls` | IDs/titles/role only; at most 2, or 3 for problem phase; titles at most 20 characters |
| `problem` | Structured problem details per contract, not executable service data |
| `url`, `notice` | URL at most 200 characters with no token; notice at most 60 |
| Times | Unix seconds; stale date is separate from the rendered state |

The relay caps the APNs payload under 4 KB and generates strictly increasing
timestamps per device/tag in memory. A control's service/target remains
server-side. Actions arrive as `fenton_live_activity_action` with
`{tag,job,control}`; dismissal uses `{tag}`, not a webhook credential in a recorded
event. APNs 410 recovery accesses Core's private
`mobile_app.live_activity.store.remove_live_activity_token`, guarded for Core
2026.7+ and expected function shape, and may retry update as start.

### Documentation/source discrepancies worth preserving

- `HouseConfigEnvelope`'s example still says schema 1; `HouseConfig.swift` requires
  schema 2. Server acceptance of a positive schema number is not native support.
- Older registration examples set `push_websocket_channel:true`; current native
  push guidance says the app does **not** subscribe to
  `mobile_app/push_notification_channel`, so that flag must not advertise delivery.
- Older signout wording says clear app_data. The newer unregister API/native
  flow removes the registration with retry and older-server fallback.
- The relay contract contains old aggregate Live Activity content followed by
  the newer per-job section; do not implement from the first example alone.

## Can an App absorb the integration?

| Responsibility | App suitability |
| --- | --- |
| Editor, validation, previews, snapshots/history | Direct fit; no in-process Core dependency |
| Core entity/service discovery | Use documented Core API; backend credential is powerful |
| Existing custom Core WS commands and HTTP routes | Need a Core integration to register them, or a separately authenticated/reachable replacement API and client migration |
| `mobile_app` registrations and notify targets | Core-owned config entries/platforms; not container-local files |
| Person fanout, jobs, presence, lifecycle callbacks | Current code accesses `hass.states`, `hass.bus`, `hass.services`, config entries and loaded runtime |
| Dead Live Activity token recovery | Current code uses private in-process Core APIs; no equivalent stable remote endpoint established by this research |
| APNs HTTP/2 delivery | Could be extracted as a worker, with new credential transport, restricted caller auth, retry/idempotency and outage handling |

`__init__.py` registers Core services/views, loads notify platform(s), starts the
job/presence engines, listens for Core lifecycle changes, and unloads them.
`targets.py` enumerates `hass.config_entries.async_entries("mobile_app")` and
person states. `recovery.py` imports Core's private token store. Those are concrete
reasons against a drop-in container replacement. Do not mount/edit `.storage` to
simulate these capabilities. Recommend an App plus retained/thin integration.

## Official HA App and Ingress findings

Current official terminology is **Apps**; older API names still include `addons`.
Official App documentation targets HA OS, where Supervisor manages containers,
updates, configuration, and backups. HA Container is not the same installation
path. A separate generic container distribution would need its own deployment and
authentication documentation.

| Subject | Verified contract / primary source |
| --- | --- |
| App model | <https://contributors.home-assistant.io/apps/> |
| Packaging | Root `repository.yaml`, per-App `config.yaml`/Dockerfile/docs: <https://contributors.home-assistant.io/apps/guides/repository/> |
| Required config | name/version/slug/description/arch; current supported arch aarch64/amd64: <https://contributors.home-assistant.io/apps/reference/configuration/> |
| Persistence | `/data` always RW; `homeassistant_config` would mount Core config at `/homeassistant`, but is unnecessary for studio storage |
| Publishing | Prebuilt multi-arch images; immutable tag matches config version; make GHCR package public: <https://contributors.home-assistant.io/apps/guides/publishing/> |
| Build tooling | Current composable actions in <https://github.com/home-assistant/builder>; example <https://github.com/home-assistant/apps-example>; old all-in-one builder and separate build.yaml are deprecated |
| Ingress | Dynamic `/api/hassio_ingress/<token>/`, HTTP/1.x, streaming response, WS, relative URLs: <https://contributors.home-assistant.io/apps/guides/ingress/> |
| Core communication | <https://contributors.home-assistant.io/apps/guides/communication/> |
| Security | Least privileges, AppArmor, separate Core/Supervisor roles: <https://contributors.home-assistant.io/apps/guides/security/> |
| Backups | `backup: cold` stops the App; hot backup hooks need consistent application data |

Ingress listeners must allow only Supervisor `172.30.32.2`, denying direct
requests from other apps on the shared internal network. Trust user headers only
after that source restriction. Official headers are `X-Remote-User-Id`,
`X-Remote-User-Name`, and `X-Remote-User-Display-Name`; they may be absent.
`X-Ingress-Path` supplies the dynamic prefix. The App's own Supervisor info
endpoint returns `ingress_url`/`ingress_entry`.

**Version nuance:** official config text describes `panel_admin` as sidebar
visibility. At the pinned Supervisor source, `APIIngress.handler` additionally
rejects non-admin users with 403 and `_init_header` injects sanitized
`X-Remote-User-Groups`. Source:
<https://raw.githubusercontent.com/home-assistant/supervisor/43ac3788d02cd8e77c786ecf698063a8e8b2a4ff/supervisor/api/ingress.py>.
The installed/minimum stable version was not tested. Do not claim either that
current enforcement is cosmetic or that every older release has it.

The backend can independently resolve a trusted ingress identity with
`config/auth/list`, checking active/owner/group membership. This is an admin-only
Core WS command and must not be exposed as a browser user-directory API:
<https://raw.githubusercontent.com/home-assistant/core/fd864375b04b2b4ed1d6c383a4bd8b0293d6e809/homeassistant/components/config/auth.py>.
Admin group ID `system-admin`:
<https://raw.githubusercontent.com/home-assistant/core/fd864375b04b2b4ed1d6c383a4bd8b0293d6e809/homeassistant/auth/const.py>.

### App-to-Core API and security

`homeassistant_api:true` grants access to:

```text
http://supervisor/core/api/...      REST
http://supervisor/core/api/stream   Core event stream
ws://supervisor/core/websocket     WebSocket
```

Send `Authorization: Bearer <SUPERVISOR_TOKEN>` for REST and
`{"type":"auth","access_token":"<SUPERVISOR_TOKEN>"}` for WebSocket auth.
The proxy blocks hassio REST and `supervisor/`/`hassio/` WebSocket commands.
Otherwise **the App acts as a Core administrator, including managing users and
credentials**. `hassio_role` limits a different API and does not reduce this.

Use a backend-only read allowlist for discovery, such as entity states, services,
and selected registry/area metadata. The Core WebSocket `subscribe_entities`
provides an initial state and compressed deltas; prefer the maintained protocol
library or a fully tested decoder over ad hoc REST polling. Keep physical action
calls absent from the preview provider. Core API reference:
<https://contributors.home-assistant.io/core/internals/websocket-api/>.

Basic self-info endpoints work without broad `hassio_api` access. Direct App ports
need their own auth; Supervisor's `auth_api` is a username/password verifier, not
OAuth or a ready-made session system. Its `/auth` endpoint requires the Supervisor
credential in `X-Supervisor-Token`, because `Authorization` there is interpreted
as the user's Basic credentials. Prefer Ingress for the studio.

### Mobile access

Ingress is a browser session/proxy route, not a stable App URL that automatically
accepts a mobile HA bearer token. A remote Core/HA Cloud URL does not expose a
separate App host port. Future native document access through a Core integration
preserves the existing auth and remote path. Direct access is possible, but needs
explicit TLS, token verification, ownership, discovery, and reachability design.

The current official Core auth API supports OAuth authorization at
`/auth/authorize`, token exchange/refresh at `/auth/token`, and revocation at
`/auth/revoke`. Native clients should use state validation and PKCE `S256`, store
refresh credentials securely, and refresh access tokens. The website/client-ID
redirect registration rules still apply. The official example access-token
lifetime is 1800 seconds; refresh tokens expire after 90 days unused. These are
Core facts, not an assertion that the existing native client implements every
newer auth feature. Source:
<https://contributors.home-assistant.io/core/internals/auth-api/>.

## SDUI, publication, and transport research

No inspected HA API provides a generic native SDUI schema or transactional studio
publication semantics. Those are product contracts to design, not existing HA
features. Avoid reusing Lovelace card JSON as a promise of native renderability:
web/custom cards can depend on JavaScript, DOM, browser layout, and resource code.

- JSON Schema Draft 2020-12 defines structural validation:
  <https://json-schema.org/draft/2020-12>.
- Ajv's default class targets draft-07; draft-2020-12 uses a separate class and
  cannot share that instance with older dialects:
  <https://ajv.js.org/json-schema.html>.
- HTTP strong `ETag`/`If-Match` support lost-update prevention; mismatch is 412:
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match>.
- SSE is a one-way UTF-8 `text/event-stream` with named events, IDs, reconnect,
  and `Last-Event-ID`:
  <https://html.spec.whatwg.org/multipage/server-sent-events.html>.
- Browser `EventSourceInit` exposes `withCredentials`, not arbitrary bearer
  headers. Same-origin Ingress is a good fit; native auth is a separate concern.
- SSE HTTP/1.x can encounter low browser per-origin connection limits. One
  stream per editor is appropriate, not one per entity:
  <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>.

Recommendation: constrained product-owned JSON, immutable snapshots, separate
schema version/revision/hash, optimistic concurrency, durable atomic publication,
idempotent retries, revision invalidation events followed by snapshot fetch, and
last-good rendering on rejected updates. WS is preferable for a future bridge
on the native client's existing Core socket. Neither SSE nor WS grants
background execution to suspended mobile apps.

## Preview and editor libraries

Maintenance observations below are GitHub `pushed_at` metadata read on the review
date, **not** guarantees of releases, security, maintainer responsiveness, or
runtime compatibility. Inspect the chosen release's package/license and preserve
notices before shipping. No package was installed for this research.

| Candidate | License / observed last push | Fit and limitation |
| --- | --- | --- |
| [Devices.css](https://github.com/picturepan2/devices.css) | MIT / 2023-12-29 | Pure CSS shells; includes iPhone 14/14 Pro, iPad, desktops, Watch. README lists landscape/responsive support as future work. Useful decoration; no current foldable/OS renderer |
| [react-device-frameset](https://github.com/zheeeng/react-device-frameset) | MIT / 2024-04-04 | Uses **Marvel** Devices.css, not picturepan2's similarly named project. Typed width/height/zoom/landscape; mostly older iPhone/iPad/Android frames |
| [React 19 frameset fork](https://github.com/vanjaoljaca/react-device-frameset) | MIT / 2026-07-21 | `@vanjaoljaca/react-device-frameset`; fork says source/CSS unchanged, adds React 19 compatibility. Does not add modern hardware fidelity |
| [Three.js](https://github.com/mrdoob/three.js) | MIT / 2026-11-12 | General 3D scene engine; requires separately sourced geometry/textures and interaction design |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | MIT / 2026-10-21 | Declarative Three renderer; v8 pairs React18, v9 React19; not UIKit or SwiftUI |
| [drei](https://github.com/pmndrs/drei) | MIT / 2026-10-21 | `Html` helper projects DOM into a scene; transform mode can blur text and needs input/layout care |
| [dnd-kit](https://github.com/clauderic/dnd-kit) | MIT / 2026-10-31 | Pointer/touch/keyboard sensors and accessible announcements; low-level primitives suit a constrained product-owned tree |
| [Puck](https://github.com/puckeditor/puck) | MIT / 2026-11-11 | Modular React visual editor, custom component config and owned data; current package `@puckeditor/core`. Strong higher-level alternative |
| [Craft.js](https://github.com/prevwong/craft.js) | MIT / 2025-02-14 | Serializable React editor nodes and custom editing UI; not an out-of-box editor; slower observed activity |
| [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) | MIT / 2026-11-10 | Responsive draggable/resizable grid, current source package 2.3.0; fits dashboards, not a complete semantic/native page tree |

Verified npm metadata:

- `react-device-frameset` **1.3.4** advertises React `^16.8 || ^17 || ^18`, not
  React19: <https://registry.npmjs.org/react-device-frameset/latest>.
- `@dnd-kit/react` **0.5.3** advertises React18/19:
  <https://registry.npmjs.org/@dnd-kit/react/latest>.
  Current dnd-kit documentation describes `@dnd-kit/abstract`, `@dnd-kit/dom`,
  and framework adapters. Do not mix this API with historical
  `@dnd-kit/core`/`@dnd-kit/sortable` examples without choosing a generation.
- drei's HTML behavior and blur caveat:
  <https://github.com/pmndrs/drei/blob/master/docs/misc/html.mdx>.

**Recommendation:** begin with dnd-kit plus a flat accessible renderer and a small
CSS frame. Use Puck only if its larger editor model pays for itself; translate at
the boundary rather than exposing framework-specific serialization as the native
protocol. Defer 3D unless it is explicitly a showcase feature.

Browser Device Posture and Viewport Segments APIs are experimental/limited
availability, not a cross-browser foundation:
<https://developer.mozilla.org/en-US/docs/Web/API/Device_Posture_API>,
<https://developer.mozilla.org/en-US/docs/Web/API/Window/viewport>.
Posture `continuous` includes nonfoldable, fully open, and fully closed states;
it is not an angle measurement. A generic hinge demo can be explicit CSS/geometry
state with synthetic viewport segments. It must not be presented as validation
on real folding hardware.

Apple's applicable drag guidance says **"Offer alternatives to drag and drop"**
and **"Prefer letting people undo a drop."** Apply that to keyboard/menu moves,
clear drop acceptance, undo, and visible errors:
<https://developer.apple.com/design/human-interface-guidelines/drag-and-drop>.
MIT licensing of a frame does not grant rights to Apple trademarks, SF Symbols,
SF fonts, or third-party 3D assets. Use appropriately licensed neutral assets;
native design inspiration is not permission to redistribute proprietary resources.

## Live Activity constraints

Primary official sources, read as Apple-provided Markdown:

- <https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities.md>
- <https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications.md>
- <https://developer.apple.com/design/human-interface-guidelines/live-activities>

| Constraint | Consequence for the studio |
| --- | --- |
| WidgetKit/SwiftUI extension defines ActivityAttributes/ContentState and layouts | Server supplies data for compiled templates, not downloadable SwiftUI/HTML |
| Combined static/dynamic data <=4 KB | Do not embed an entire UI document; check serialized payload and selected relay limits |
| Active up to 8 hours, up to 4 more hours on Lock Screen | Not an indefinitely persistent smart-home dashboard |
| Activity itself cannot access network/location | No SSE/WS client inside the Live Activity; app updates or APNs |
| Push-to-start requires iOS/iPadOS17.2+ | Older supported systems need app-started activity; platform capability matters |
| Activity token is distinct from ordinary push token and can rotate | Dedicated lifecycle handling and server updates required |
| APNs `liveactivity`, topic `<bundle>.push-type.liveactivity`, Unix timestamps | Exact compiled payload contract and credential setup required |
| System controls presentation and delivery | Browser previews cannot guarantee placement, dimensions, wakeups, or delivery timing |
| High-priority pushes have a system budget; may throttle | No guaranteed per-second dashboard updates; prefer lower priority when appropriate |

Apple documents priority5 updates as not counting toward the high-priority budget;
priority10/default updates do. Frequent-update support is declared in the native
app and can be disabled by the person. No universal numeric updates/hour promise
was established. Use `stale-date` and explicit ended states when updates stop.
APNs broadcast channels do not themselves start activities.

HIG says **"Offer Live Activities for tasks and events with a defined beginning
and end"**, **"ideally no longer than eight hours"**, and **"Update only when new
content is available."** These guide finite task templates rather than an
always-on arbitrary dashboard. The source also requires compact, minimal,
expanded, and Lock Screen presentation support. A simulated preview can help
design those presentations, but actual native implementation and device evidence
remain separate acceptance work.

## Confidence and remaining evidence

High confidence: existing endpoint names/auth boundaries, native schema-2
requirement, absence of a remote config-write API in inspected source, Core
coupling, current official App/Ingress contracts, and published library licenses.

Still to prove during implementation: chosen stable HA/Supervisor minimum
versions; actual admin/identity behavior on them; install/build for each supported
architecture; persistence under interruption; Ingress streaming through the user's
proxy; library touch/keyboard behavior; and native-renderer/ActivityKit parity.
None of these can be established solely by documentation or a browser frame.
