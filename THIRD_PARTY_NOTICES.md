# Open-source dependencies

The resolved versions and dependency graph are recorded in `package-lock.json`.
License texts ship with the packages in `node_modules`; distribution must retain
the applicable notices. This inventory does not replace those license texts.

| Library | Purpose | License |
| --- | --- | --- |
| React / React DOM | Declarative workspace and preview renderer | MIT |
| Base UI 1.9.0 (`@base-ui/react`) | Accessible dialog, drawer, popover, menu and toast behaviour for the 2.0 workspace | MIT |
| dnd-kit core | Pointer and keyboard drag-and-drop | MIT |
| Lucide React | Studio and configurable preview icons | ISC |
| Express | HTTP application and publication API | MIT |
| Zod | Runtime document and request validation, JSON Schema | MIT |
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

## TanStack Virtual

The 2.0 workspace's long pickers (entities, icons, services) use
[@tanstack/react-virtual 3.14.24](https://github.com/TanStack/virtual) (MIT,
Copyright (c) 2021-present Tanner Linsley), installed from npm unmodified.
