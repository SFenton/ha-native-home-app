<img src="assets/icon.svg" width="64" height="64" alt="">

# S+H Studio

A Home Assistant app for designing, previewing and publishing the native app's
composition. The preview is the workspace: select a tile to edit its properties,
add content from the picker, and publish to Home Assistant. The editor and the
publication API live here; the iOS app is not modified.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:4800`. The development server listens on all interfaces,
so another device can use `http://<this-machine-lan-or-tailscale-ip>:4800`.
Development accepts Tailscale `.ts.net` host names (for Tailscale Serve over https; HMR follows the page's host and port); set `STUDIO_ALLOWED_HOSTS=a.example,b.example` to allow other names.
Development mode is for a trusted network and sample data, not public internet
exposure. See [deployment and authentication](docs/deployment.md) before
connecting a real Home Assistant instance or enabling direct production access.

```sh
npm run build
npm start
```

Production requires `STUDIO_AUTH_TOKEN` (at least 24 characters) or verified
Supervisor Ingress. Configure authentication before running `npm start`.
Local development needs no token: `npm run dev` without `STUDIO_AUTH_TOKEN`
works without signing in.

The draft and its published revisions are stored in the `data/` directory (or
`DATA_DIR`), under `native-v2/`. They are not committed to Git. Keep that
directory or mount persistent storage when running the app in a container.

## Design and publish

The workspace autosaves the draft. **Publish** uploads the referenced images and
publishes the composition into the `fenton_home` integration (1.4.0 or newer),
which the native app follows live; **Project > Publish History** shows the
revisions and offers rollback. The app uses the app's own Supervisor token, or
`HA_URL`/`HA_TOKEN` in development. See
[Publishing to Home Assistant](docs/native-composition.md#publishing-to-home-assistant).

Service calls in the preview are simulated: previewing a button never controls
your home. Device frames are browser previews, not iOS emulators.
The [design notes](docs/design.md) record the workspace rules and the
[composition contract](docs/native-composition.md) the app and the Studio share.

## Home Assistant installation

After the first successful release, add this repository URL in **Settings >
Apps > Install app > Repositories**:

```text
https://github.com/SFenton/ha-native-home-app#stable
```

[![Add to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FSFenton%2Fha-native-home-app%23stable)

Install **S+H Studio**, start it, then select **Open Web UI**. Home
Assistant downloads prebuilt amd64/aarch64 images and offers subsequent
versioned updates. Requires Home Assistant OS or Supervisor; not HACS.

See [deployment](docs/deployment.md) for Ingress, persistent storage, and
direct-access authentication, and [releasing](docs/releasing.md) for the
image-first publishing pipeline and one-time public-access setup.

See [architecture](docs/architecture.md) for the app/integration boundary and
[research](docs/research.md) for the evaluated open-source building blocks.
The [configuration notes](docs/configuration.md) cover the API and storage.

## Development

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

Browser tests start their own server on port 4815 with isolated storage and a
test token (`STUDIO_E2E_PORT` and `STUDIO_E2E_DATA_DIR` override them); they do
not touch the interactive development studio on port 4800.

Container packaging can be checked without connecting to Home Assistant:

```sh
docker build --tag native-home-studio:check .
node scripts/smoke-container.mjs
```

The smoke check starts its own loopback-only container, verifies authentication
and save/publish persistence across restart and container replacement, and
removes the test container and volume afterward.

### Removal of the 1.0 workspace

The schema-1 ("1.0") workspace is gone: the editor, its `/api/draft`,
`/api/validate`, `/api/export`, `/api/schema`, `/api/data`, `/api/actions/execute`,
`/api/feedback`, `/api/cameras`, `/api/native-wallpaper` and `/api/read-endpoints`
routes, the `studio.workspace` preference and the `enable_live_actions` option's
effect. Data an earlier Studio wrote (`draft.json`, `published.json`, `revisions/`,
`feedback/`) stays on disk, unread. The composition (2.0) draft, publication and
Home Assistant routes are unchanged.

### House data stays out of the repository

This repository is public, so no entity id, room name, script name or card key of a real house is written in source, tests,
fixtures or the shared corpus; those use synthetic `demo_` ids. A maintenance script that must act on the real house
(`scripts/restore-theater-actions.ts`) reads its house-specific values at run time from a git-ignored local file:

- The file is `.local/<script name>.json` at the repository root (`.local/` is in `.gitignore`), or in the folder the
  `STUDIO_LOCAL_DIR` environment variable names.
- `scripts/examples/<script name>.example.json` is the shape with synthetic values. Copy it to the local folder and replace
  the values with your own: `mkdir -p .local && cp scripts/examples/restore-theater-actions.example.json .local/restore-theater-actions.json`.
- A missing file stops the script with a message that names the file and the example; no value is ever printed.
- `scripts/import-house-config.ts` carries no house values: the Studio server reads the live house configuration itself.

The composition contract is in `src/shared/composition/`. Keep the schema, the
preview renderer, server validation and the consumer documentation consistent when
adding a capability.

The [eight-role orchestration](.agents/README.md) mirrors the native-home
workflow, with Copilot/OpenAI model and effort settings recorded explicitly.

Created in [T3 Code](https://t3.codes).
