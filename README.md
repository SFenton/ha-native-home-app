<img src="assets/icon.svg" width="64" height="64" alt="">

# Native Home Studio

A Home Assistant app for designing, previewing, and publishing native app
experiences as versioned JSON or YAML. The editor and publication API live here;
the existing iOS app is not modified.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:4800`. The development server listens on all interfaces,
so another device can use `http://<this-machine-lan-or-tailscale-ip>:4800`.
Development mode is for a trusted network and sample data, not public internet
exposure. See [deployment and authentication](docs/deployment.md) before
connecting a real Home Assistant instance or enabling direct production access.

```sh
npm run build
npm start
```

Production requires `STUDIO_AUTH_TOKEN` (at least 24 characters) or verified
Supervisor Ingress. Configure authentication before running `npm start`.

Drafts, publications, and local feedback are stored in the `data/` directory
(or `DATA_DIR`). They are not committed to Git. Keep that directory or mount
persistent storage when running the app in a container.

## Design and publish

The studio document describes pages, tabs, navigation actions, modals, toolbar
actions, nested components, data bindings, conditional visibility, settings,
profile content, and Live Activity presentation variants. Example content is
editable configuration, not a special-case screen in the renderer.

Use **Edit** to compose the experience and **Interact** to exercise navigation,
modal presentation, and local state changes. Browser service actions are
simulated by default; previewing a button must not inadvertently control your
home.

On compact screens, **Project**, **Preview**, and **Inspect** switch between
mounted panes without discarding editor drafts. **Insert** opens the component
tray. Touch dragging requires a deliberate hold and cancels when a second finger
joins; menus and placement dialogs provide non-drag alternatives.
See the [mobile editor guide](docs/mobile-editor.md).

The inspector supports configurable floating buttons, local or registered-endpoint
search bars, and actions on either side of list rows, including optional
confirmation. Legacy Chores Add controls float outside the scrolling content.
Endpoint searches require explicit preview consent; administrators register HA
or external read endpoints and keep their credentials on the server.
See [interaction configuration](docs/interactions.md) and
[read endpoint registration](docs/read-endpoints.md).

In **Edit**, drag an existing component on the canvas or use its drag handle.
Clicking a library component inserts it immediately after the selected item, at
the same nesting level. Drag onto a group's **Drop inside** target to nest it.
Undo restores the previous arrangement.

**Navigation & theme** includes a background image, dimming, and blur. Upload a
JPEG, PNG, or WebP (under 10 MB), or supply an HTTP(S)/root-relative image URL.
Uploads are resized, stripped of metadata by JPEG re-encoding, and embedded in
the saved document and exports. Treat exports containing personal images as
private.

**Data sources → Initialize from Native Home** reads an authenticated schema-2
house configuration and offers an undoable, reviewed import of its tabs, chips,
room pages, and supported content. Applying the import immediately loads current
entity values; Save persists the layout, not the live readings. Connected saved
native documents resume readings automatically; **Live data: off** stops them.
This requires server-side HA credentials and Studio
authentication; the public sample workspace never silently loads private house
data. Device controls use projected capabilities and emit local simulation
intents, not HA writes. Missing data is reported through Studio's data status.
Profile identity comes from the HA token's authenticated user, not a configured
example name. See the [native bootstrap contract](docs/configuration.md#read-only-native-bootstrap).

Configured native cameras play live HLS, with a continuous MJPEG fallback,
through Studio's authenticated media proxy. Their viewers include Snapshot,
Sound, and configured Record controls.
Sound controls HLS browser audio when a track is available; MJPEG has no audio.
Snapshot and Record
remain explicitly simulated. Turning live data off, hiding a camera, or leaving
the browser tab stops its media requests. This is not the native WebRTC player.

**Save** persists a draft. **Publish** makes a validated revision available to
clients, separately from later draft changes. The publication endpoint and
revision event stream are a contract for a future native renderer; publishing
here does not make the unchanged iOS app understand this format.

Device frames and 3D/folding controls are browser previews, not iOS emulators.
The device dock's **Device theme** selector overrides the preview with Light,
Dark, System, or the document's App theme without editing that document. Main
pages retain the native app's dark backdrop; ordinary sheets follow appearance,
while camera and weather viewers retain their dark treatment.
Live Activity previews do not schedule ActivityKit activities or send APNs
notifications. Device-specific geometry is illustrative unless explicitly
documented otherwise.
The Duo study has no centered notch; it preserves component state through
folding/rotation and separates assigned content only in partial landscape.
Status chips form one horizontally scrollable rail with a desktop scrollbar;
accessibility-sized text can wrap. Native chip details include room overview
groups and in-sheet subpage navigation. Tiles use source-derived minimum sizes,
wrapping titles, and adaptive grid allocation. Pages use dark surfaces, and visited
pages retain local state and scroll during interaction. Motion and loading
studies honor reduced motion. These source-based improvements do not establish
complete native parity.
New native imports include source-informed thermostat descriptions, explicit
Guests setters, finite remote command branches, and mounted vacuum sheet tabs.
See [native fidelity and unsupported data](docs/native-fidelity.md). Existing
user documents are not silently reimported or published.

## Home Assistant installation

See [deployment](docs/deployment.md) for the installable app/container,
Ingress, persistent storage, and direct-access authentication.

See [architecture](docs/architecture.md) for the app/integration boundary and
[research](docs/research.md) for the evaluated open-source building blocks.
The [configuration contract](docs/configuration.md) documents validation,
data sources, actions, publishing, and native-client integration.
The [design specification](docs/design.md) includes future UX proposals beyond
the current contract; it is not a claim that every proposed capability ships.

## Development

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests start their own server on port 4801 with isolated storage; they
do not overwrite the interactive development studio on port 4800.

Container packaging can be checked without connecting to Home Assistant:

```sh
docker build --tag native-home-studio:check .
node scripts/smoke-container.mjs
```

The smoke check starts its own loopback-only container, verifies authentication
and save/publish persistence across a restart, and removes it afterward.

The shared TypeScript contract is in `src/shared/types.ts`. Keep the schema,
browser renderer, server validation, and consumer documentation consistent when
adding a capability.

The [eight-role orchestration](.agents/README.md) mirrors the native-home
workflow, with Copilot/OpenAI model and effort settings recorded explicitly.

Created in [T3 Code](https://t3.codes).
