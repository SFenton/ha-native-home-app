# Architecture: S+H Studio

Source review: 2026-11-12. See [research and pinned sources](research.md) and the
[composition contract](native-composition.md).

## Decision

An installable Home Assistant **App** holds the Studio: one workspace, a validated
composition document, durable draft and revision storage, and a browser preview.
Home Assistant Core stays authoritative for entities, permissions, services,
automations and mobile registrations. The Studio publishes the composition into
the `fenton_home` integration, which the native app follows; the Studio's own
`/native/api/published` is only a debug preview. Publishing is never labelled
"deployed to iPhone" until a compatible native consumer has read it.

Keep `SFenton/ha-fenton-home` in place: its Core WebSocket commands, `mobile_app`
registration access, person-target fanout and Live Activity token-store recovery
cannot move into a separate container.

A runnable fixture-mode development server is a **different deployment mode**
from authenticated production Ingress. It must hold only synthetic data and no
Supervisor or Core credentials; LAN access does not justify exposing an
unauthenticated production editor.

## Ownership and deployment

```text
Browser
  -> HA authenticated Ingress -> App backend -> private /data composition store
                                      |
                                      +-> Supervisor Core proxy, read-only usage
                                           -> Core entities/registries/services
                                      +-> fenton_home integration (publish)

Native app
  -> existing HA OAuth + Core WebSocket -> fenton_home -> published composition
```

The App is a backend-for-frontend, not an unrestricted proxy. Serve its built web
assets and API from one origin. Keep HA credentials in the backend process only.
Bundle assets locally; loading a CDN must not be required for household control
or editing. No Core configuration mount is necessary for studio-owned data.

Suggested implementation units, not additional services:

- The shared composition contract, schema, compiler and fixtures (`src/shared/composition/`).
- The browser workspace and preview renderer; the editor mutates documents, not arbitrary DOM.
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
