# Changelog

## 0.3.25

- The Studio library lists a sheet's levels, moves pages and levels between Pages and Sheets, and groups the Goes to picker.

## 0.3.24

- The preview now shows sheet-to-page pushes, hidden tabs and buttons, the iPad's top tab bar, wide-window opening and the Duo rail's Back and Close as the app does.
- Pages can hide the tab bar and header buttons for themselves, and choose how they open in a wide window; the Tabs and header buttons panel shows where each is used.
- Hide on this page now treats the opening page of a document without tabs as its first page.

## 0.3.23

- Maintenance and internal changes.

## 0.3.22

- Maintenance and internal changes.

## 0.3.21

- Maintenance and internal changes.

## 0.3.20

- Maintenance and internal changes.

## 0.3.19

- Maintenance and internal changes.

## 0.3.18

- Maintenance and internal changes.

## 0.3.17

- Maintenance and internal changes.

## 0.3.16

- Maintenance and internal changes.

## 0.3.15

- Maintenance and internal changes.

## 0.3.14

- Maintenance and internal changes.

## 0.3.13

- Maintenance and internal changes.

## 0.3.12

- Maintenance and internal changes.

## 0.3.11

- Maintenance and internal changes.

## 0.3.10

- Studio can lay a page out in two sides for the iPhone Duo partly folded sideways, and its Duo preview reflows into them as the fold moves.
- The Duo simulator's side rail now matches the app, with a More menu, and a held tab bar shows its labels.

## 0.3.9

- Studio template places can be paired with an entity by choosing it in an Entity row.
- Studio templates open in an editor from their row, list their uses, find single repeated tiles, and keep every place when deleted.

## 0.3.8

- The Studio's dial editor offers Set Per Place inside a template, Checks flags an empty Otherwise text, and the Duo preview's keyboard reach no longer flips while tiles move.

## 0.3.7

- Maintenance and internal changes.

## 0.3.6

- Studio can save a value or condition as a Logic Template and use it in many places.

## 0.3.5

- Maintenance and internal changes.

## 0.3.4

- Maintenance and internal changes.

## 0.3.3

- The dial's inspector gains a Text place group that moves the text in the middle.

## 0.3.2

- Studio can show when an entity last changed, countdowns, durations and truncated numbers.
- The preview draws the Profile disc and badges on more elements, and a capped badge hides when its count is unavailable.

## 0.3.1

- Studio loads the draft again when opened through Home Assistant.

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
