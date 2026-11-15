# Deploy Native Home Studio

This repository contains buildable Home Assistant app packaging, not evidence
that an app has been installed on your Home Assistant. The existing native-home
integration and iOS app are not modified or replaced.

## Local development

Use Node.js 22+, install with `npm ci`, then run `npm run dev`. The Express
server listens on **0.0.0.0:4800**, exposes the configuration APIs, and serves the
Vite editor with middleware HMR. `DATA_DIR` defaults to `./data`. With no HA
credentials and no Studio authoring token, development is a sample-mode LAN
demo. Anyone who can reach that demo can author its configuration. Do not expose
it to the public internet.

`npm run build` checks TypeScript and creates `dist` with relative asset paths.
For production, set `STUDIO_AUTH_TOKEN` privately before running `npm start`.
Production refuses to start without that token or verified Supervisor Ingress.
Local development needs no token: with no `STUDIO_AUTH_TOKEN`, no Ingress and
not production, every route works without signing in. Setting
`STUDIO_AUTH_TOKEN` in development turns sign-in on. Because that server has no
sign-in, with HA credentials (`HA_TOKEN`) or registered read endpoints it
refuses to start unless `HOST` is a loopback address such as `127.0.0.1`; set
`STUDIO_AUTH_TOKEN` to bind elsewhere.
The bearer token must be at least 24 characters. The sign-in page exchanges it
for an HttpOnly authoring session; API clients can instead use an Authorization
bearer header. Never place tokens in query strings, screenshots, saved
documents, shell history, or source control. Use HTTPS at a trusted reverse proxy
for direct remote access.

## Install as a Home Assistant app

Requires Home Assistant OS or a Supervisor-managed installation that supports
apps (formerly add-ons). This is not a custom integration installed under
`custom_components`, and Home Assistant Container alone does not provide the
Supervisor app store.

1. Copy the complete repository checkout, excluding local dependencies, local
   data, and secrets, into a dedicated local app directory such as
   `/addons/native_home_studio` on the HA host. `config.yaml`, `Dockerfile`,
   `package.json`, and source folders must all be in that directory.
2. Reload the app store's local app list. Select **Native Home Studio**, install
   it (the Supervisor builds locally), and start it.
3. Use **Open Web UI** / the Native Home Studio sidebar entry. Ingress provides
   authenticated HA access. The direct host port is disabled by default.

This checkout is an **individual app build context**, not yet a published app
store repository. Adding its URL to the store is not an installation path.
For store distribution, a separate repository must contain `repository.yaml`
at its root and this app's build context in a child folder. The supplied
`repository.yaml` is metadata for that future distribution layout.

The package declares `amd64` and `aarch64`, uses a multi-architecture Node 22
Alpine image, and stores app state in persistent `/data/studio`. `/data` is
provided by the Supervisor without an extra host configuration mount. The
container needs neither host networking nor privileged mode nor host filesystem
access. It requests `homeassistant_api` for live state reads, publishing native compositions to the `fenton_home` integration, and opt-in service
calls; the resulting Supervisor token is an administrator credential and stays
server-side.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `auth_token` | Empty | Private Studio authoring token, required for optional direct-port access; minimum 24 characters |
| `enable_live_actions` | `false` | Allow explicitly confirmed service calls; previews otherwise simulate |

Ingress authenticates only when the TCP peer matches the Supervisor's resolved
internal address **and** `X-Ingress-Path` matches the path fetched from the
Supervisor's authenticated self-info endpoint at startup. It additionally requires
the sanitized `X-Remote-User-Id` and `system-admin` membership in the Supervisor's
`X-Remote-User-Groups`. Older Supervisor releases without sanitized group headers
must use the separate authoring token; missing identity never implies an editor.
Forwarded addresses
or ingress-looking headers from arbitrary clients are not authentication. If
Supervisor metadata discovery fails, startup fails closed rather than trusting
those headers. The app does not expose a caller-controlled proxy target.

To enable direct LAN authoring, first configure `auth_token`, then enable the
optional `4800/tcp` host mapping in the app's network settings and restart.
Requests on that mapping must authenticate even if they forge Ingress headers.
Only route it over trusted LAN/Tailscale or HTTPS; do not forward the plain HTTP
port to the public internet. The app does not log or export tokens.

## Standalone Docker

Build the repository with `docker build -t native-home-studio .`. Run the image
with port 4800 mapped, a persistent volume mounted at `/data`, and
`STUDIO_AUTH_TOKEN` delivered through your private environment/secret mechanism.
No token value should be embedded in the image. `run.sh` starts the production
server; `/data/options.json` is read when supplied by the Supervisor.

Server environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address outside the container wrapper |
| `PORT` | `4800` | Bind port outside the container wrapper |
| `DATA_DIR` | `./data` locally; `/data/studio` in the image | Persistent configuration and feedback |
| `NODE_ENV` | Development unless production | Production serves `dist`; development mounts Vite |
| `STUDIO_AUTH_TOKEN` | Unset | Private authoring credential |
| `HA_URL` | Unset | Administrator-configured HTTP(S) HA origin; never a document-supplied URL |
| `HA_TOKEN` | Unset | Private direct-HA credential; requires `HA_URL` |
| `SUPERVISOR_TOKEN` | Supplied by Supervisor only | App metadata and HA proxy access |
| `ENABLE_LIVE_ACTIONS` | `false` | Explicit opt-in; each execution still requires confirmation |

When Supervisor credentials are present, the app uses the fixed
`http://supervisor/core` proxy by default. Direct HA connections use `HA_URL` and
`HA_TOKEN`; redirects are not followed. Tokens are never returned by health,
data, schema, export, or event endpoints.

### Native layout bootstrap

Authenticated `GET api/native-home` additionally requires the existing
`fenton_home` Core integration with a configured schema-2 house layout. Direct
connections use the fixed `HA_URL` origin's `/api/websocket` and `/api/states`;
Supervisor connections use `ws://supervisor/core/websocket` and
`http://supervisor/core/api/states`. Server-only credentials authenticate both
reads. No browser-supplied upstream URL, house-config write command, or service
actuation is added. Keep `ENABLE_LIVE_ACTIONS=false` for read-only preview.

This endpoint has no unauthenticated sample-demo mode and never replaces an
unavailable live bootstrap with samples. The eight-second, bounded snapshot
preserves the integration envelope and returns only safe state fields for
referenced entities; see [the API contract](configuration.md#read-only-native-bootstrap)
for limits and rejection rules. Credential-bearing layout data is rejected,
not silently redacted. Provision credentials privately, restart the Studio
process, and sign in through the existing authoring-token or verified admin
Ingress flow. Bootstrapping does not modify `DATA_DIR`, deploy the Core
integration, or establish that the iOS app renders Studio documents.

Then open **Data sources → Initialize from Native Home**, review the mapping
warnings, and confirm replacement of the local editor document. Live readings
begin immediately; Save persists only the layout when ready. Saved native
documents resume readings when connected. Use **Live data: off** to stop data
and camera requests and return to samples. Current values
remain session-only; imports and exports contain configured entity references,
not captured live state. The default native wallpaper is read through the
authenticated fixed image endpoint. Until private HA and Studio credentials are
provisioned, a standalone demo remains in sample mode; knowing the HA URL alone
does not establish a connection.

### Camera playback

Live previews use HA camera streaming with a browser-compatible HLS codec or
continuous MJPEG fallback. Studio uses server-authenticated `camera/stream`,
the fixed `camera_proxy_stream` route, and bounded media
reads; no HA token, HLS access token, or upstream media URL is sent to the
browser. All browser media URLs remain under Studio's own origin/Ingress mount.
Playback needs no live-service opt-in: leave `ENABLE_LIVE_ACTIONS=false`.
Snapshot and Record buttons are simulations, not recording endpoints.

Camera loading stops when live data is off, the viewer is offscreen, or the tab
is hidden. Sound is available only when the browser detects an HLS audio track;
MJPEG is explicitly video-only.
Stream failures are explicit and offer reconnection; Studio never labels a
static image as live video. See the [media contract](configuration.md#live-camera-media)
for limits and supported transport.

## Operations and limits

The configuration protocol is documented in [configuration.md](configuration.md).
`api/health` is authenticated in production; `haConnected` is a real probe result,
not inferred from a configured credential. A published document is separate
from the mutable draft and starts absent. Keep backups of `/data/studio` before
upgrading. A future schema migration must be explicit; unknown versions fail
closed.

SIGTERM closes HTTP/SSE resources, development hot-reload sockets, and the storage
lock. Allow at least 10 seconds for graceful shutdown. After an unclean kill, follow the lock recovery procedure
in the configuration guide; do not start a second writer on the same volume.
The app declares cold backups so the Supervisor stops it before capturing data.
No installation, real HA service actuation, iOS document ingestion, or device
ActivityKit behavior is implied by a successful local build.

Upstream packaging references:
[app configuration](https://contributors.home-assistant.io/apps/reference/configuration/),
[communication and permissions](https://contributors.home-assistant.io/apps/guides/communication/),
and [Ingress](https://contributors.home-assistant.io/apps/guides/ingress/).
