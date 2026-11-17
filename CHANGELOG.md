# Changelog

## 0.3.0

- Add the 2.0 workspace as the only Studio: structured editing of Native
  compositions with a live device preview, navigation authoring, rules and
  actions, an entity picker, data flows and Checks that name what to fix.
- Publish the native app's server-driven layout into Home Assistant, with
  generic actions and state styles, and refuse unsafe Host headers in local
  development.
- Release automatically: every push to `main` runs the checks, picks the next
  version from the commits since the last tag, tags it and publishes the image.

## 0.2.1

- First published Native UIKit workspace release, including the schema-2
  configuration and asset support described below.
- Wait for explicit test-container removal before deleting its volume, avoiding
  an asynchronous Docker cleanup race found on the arm64 release runner.

## 0.2.0

- Add a separate experimental schema-2 Native composition workspace with
  structured editing, strict capability compilation, local undo/redo, and
  explicit conflict recovery. Existing schema-1 documents and APIs are retained
  without automatic conversion.
- Add authenticated `/native/api/*` draft, validation, immutable publishing,
  export, image asset, and scoped publication-reader APIs, backed by durable
  `native-v2/` storage under the existing data-directory lock.
- Include synthetic composition fixtures and regression coverage for native
  shell and domain contracts. Schema-1 document and request-envelope limits
  remain unchanged.
- Retain the image-first amd64/aarch64 release pipeline. Native consumption
  requires a matching schema-2 client and providers; this release does not
  install or modify the native app or Core integration, migrate a production
  configuration, or certify browser/native parity.

## 0.1.0

- Initial experimental Native Home Studio release for Home Assistant OS and
  Supervisor-managed installations.
- Configuration editing, browser previews, separate draft saving and publishing,
  authenticated Ingress, and persistent app storage.
- Prebuilt amd64 and aarch64 images, with an image-first stable app repository.

This release does not install or modify the native iOS app or the `fenton_home`
Core integration. Browser previews are not evidence of native-device delivery.
