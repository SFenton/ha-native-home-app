# Open-source dependencies

The resolved versions and dependency graph are recorded in `package-lock.json`.
License texts ship with the packages in `node_modules`; distribution must retain
the applicable notices. This inventory does not replace those license texts.

| Library | Purpose | License |
| --- | --- | --- |
| React / React DOM | Declarative editor and preview renderer | MIT |
| Base UI 1.9.0 (`@base-ui/react`) | Accessible dialog, drawer, popover, menu and toast behaviour for the 2.0 workspace | MIT |
| dnd-kit core / sortable / utilities | Pointer and keyboard drag-and-drop | MIT |
| Lucide React | Studio and configurable preview icons | ISC |
| Devices.css | Available device-frame primitives | MIT |
| Express | HTTP application and publication API | MIT |
| hls.js | Authenticated browser HLS camera playback | Apache-2.0 |
| Motion 14.13.0 | Preview sheet spring transitions | MIT |
| modern-screenshot 4.7.0 | Local captured frame for non-interactive Duo hinge studies | MIT |
| Konsta 5.5.0 | Adapted navigation glass fill tokens | MIT |
| Zod | Runtime document and request validation, JSON Schema | MIT |
| YAML | JSON-compatible YAML interchange | ISC |
| tsx | TypeScript server runtime | MIT |
| Vite / React plugin | Development server and production asset build | MIT |
| TypeScript | Static checking | Apache-2.0 |
| Vitest / Testing Library | Automated behavior tests | MIT |
| Playwright | Browser interaction tests | Apache-2.0 |

Lucide icons are used for browser previews; they are not SF Symbols. No Apple
device assets, proprietary fonts, native renderer code, or iOS simulator runtime
are bundled with the studio. Browser device presentations are approximations,
not Apple-certified emulators.
The walking-person glyph is an original Studio drawing built with Lucide's SVG
primitive, not copied SF Symbols artwork.

## Konsta glass adaptation

The light/dark glass fill tokens in `src/NativeChrome.css` are adapted from
[Konsta 5.5.0](https://github.com/konstaui/konsta/blob/v5.5.0/src/styles/glass.css).
Studio uses its own reduced-transparency/opaque fallback and simplified static
rim/blur; no pointer tracking, framework, artwork, shader or content-card glass
is copied. This approximates a material, not Apple's compositor.

MIT License

Copyright (c) 2021 Vladimir Kharlampidi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## TanStack Virtual

The 2.0 workspace's long pickers (entities, icons, services) use
[@tanstack/react-virtual 3.14.24](https://github.com/TanStack/virtual) (MIT,
Copyright (c) 2021-present Tanner Linsley), installed from npm unmodified.
