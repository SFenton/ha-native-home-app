# Flows canvas: owner feedback iteration (W3)

Orchestrator-owned contract for the November 2026 owner feedback on the Flows
canvas. [flows-canvas.md](flows-canvas.md) still governs everything not changed
here. Nothing in this document changes the published native grammar.

## Feedback → work packages

| # | Owner feedback | Package |
| --- | --- | --- |
| F1 | Blocks can't be renamed, so their purpose is unclear | W3-A data, W3-B UI |
| F2 | Preview pane should collapse regardless of selection (HA window is narrow) | W3-B |
| F3 | Clicking a block shows a dismissible peek of formatted inputs and result; reopen from the block; large inputs truncate with a full comparison view | W3-D mockups, W3-B |
| F3a | Hover shows raw JSON | W3-B |
| F4 | Blocks carry an editable description shown on the block | W3-A data, W3-B UI |
| F5 | Block chrome overflows (action row clipped, root block clipped at canvas edge) | W3-B |
| F6 | Tidy Up should rearrange blocks to avoid wire crossings | W3-C engine, W3-B wiring |
| F7 | Saved flows have no visible purpose; build real starter flows and show/hide rules from the previous native app (e.g. Office PC on/off) | W3-R research, W3-E content |

## Block annotations (F1, F4)

An annotation is Studio presentation metadata, exactly like a block position.
It is stored in the document's `studioCanvas` metadata, is removed by
`prepareStudioDocument` before publish/validation like positions are, and never
changes lowering, compilation, simulation or the native document.

- In-memory: `GraphNode.annotation?: { readonly label?: string; readonly note?: string }`
  (`src/shared/composition/graph/types.ts`). Absent when both are empty.
- Limits: `label` 1..60 characters, `note` 1..280 characters, after trimming.
  Control characters are refused. Empty after trimming means "remove".
- Stored: each `studioCanvasMetadataSchema` canvas node gains optional
  `label` and `note` with the same limits. The schema version stays `2`
  (additive optional fields). Unknown/invalid annotation values make the saved
  layout unusable exactly as invalid positions do today; they are never repaired.
- Handoff: `CanvasLayoutHandoff` gains
  `annotations: Readonly<Record<string, { readonly label?: string; readonly note?: string }>>`
  keyed by canvas node ID (same keys as `positions`). `saveCanvasLayout`
  encodes them onto the stored nodes; `readStudioCanvas` + `lift({metadata})`
  restore them onto `GraphNode.annotation`, following the same origin
  association used for positions (including rebase on structural edits).
- Edit command (canvas `edit.ts`): `{ type: 'annotate', nodeId, label?: string, note?: string }`,
  one undoable transaction, marks the canvas dirty like `move`.
- Display: the block header shows `label` when present, otherwise the generated
  name; when a label is present the generated name stays visible as a small
  secondary line (so "Office PC" still reads as a `Raw State` block). The
  accessible name includes both. `note` renders under the header, clamped to
  two lines, full text in the inspector.

## Value presentation (F3, F3a)

All visible and accessible value text goes through one formatter
(`src/workspace2/canvas/value-format.ts`): scalars as words/numbers, yes/no as
Yes/No, records as `field: value` pairs, lists as a count plus the first items
(rows show their title/primary field), never `JSON.stringify` in UI text.
Raw JSON is available only behind an explicit "Raw" toggle in the full view.
Values still come only from host observations; no fallback values are invented.

Dates and words (W5 follow-up): a value that is a date or date-time — by its
declared type, or for an untyped string a strict full ISO-8601 match — shows
readably in the house time zone against the simulation clock ("Today, 9:30 AM",
"Yesterday, 8:00 PM", "Nov 21, 9:30 AM", "Today" for a date equal to today; the
year only when it differs). Home Assistant snake_case tokens (`needs_action`,
`armed_home`) show as words ("Needs action"); single words such as `on` keep
their presentation. Literal Text blocks show exactly what the owner typed, and
strings that merely contain a date (IDs) are left alone. The exact raw value is
never lost: it stays in the accessible description and behind Raw in the full
comparison.

## Tidy Up (F6)

`src/workspace2/canvas/tidy.ts` exports

```ts
export interface TidyMeasure { readonly width: number; readonly height: number;
  readonly ports: Readonly<Record<string, { readonly direction: 'input' | 'output'; readonly y: number }>> }
export function tidyCanvas(graph: LogicGraph, measure?: (nodeId: string) => TidyMeasure | undefined): LogicGraph
export function countCrossings(graph: LogicGraph, measure?: ...): number
```

Layered (Sugiyama-style) left-to-right layout: layers from longest path to the
root, port-order-aware crossing minimisation (barycenter/median sweeps with
transpose), then vertical compaction that respects measured heights. It is
deterministic (ties broken by node array order), synchronous, adds no runtime
dependency unless the engine author documents why, keeps every node ID and
payload, and changes only `position`. `arrangeCanvas` delegates to it so the
initial layout benefits too. Tidy Up must never increase `countCrossings`
relative to the current positions; if the computed layout would, it keeps the
better one and says so.

## Collapsible preview (F2)

The canvas session's Preview aside collapses to a narrow rail with a labelled
toggle, available whether or not a block is selected. The choice persists per
browser (`localStorage`, wrapped in try/catch) and the canvas reclaims the width.

## Starter content (F7)

Starter flows and show/hide rules are configuration, never code. They are
delivered as a change against the owner's document via the agent publish path
([agent-publish.md](agent-publish.md)) only when a loopback Studio is available;
otherwise as a validated, reviewable change file plus a corpus test proving the
compiler accepts them. No device actions, no credentials, no publish without
the documented checks.
