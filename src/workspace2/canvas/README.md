# Flows canvas interaction host

`FlowCanvas` is an isolated interaction surface. W2-I mounts it; this lane does
not modify workspace entry files. Pass a `CanvasHost`, an initial `LogicGraph`,
the existing `DerivedTheme`, a title, an `onClose` callback, and optionally the
element to restore focus to on close. Remount for a different anchor/snapshot.
`arrangeCanvas` supplies an initial readable layout without reordering node IDs.

The host provides sources, target capabilities, an immutable revision snapshot,
atomic Apply and separate Save. Apply uses the graph core's single lowering
result. Conflicts preserve canvas state and call `compareConflict`; the host
owns comparison/reconciliation and persistence. Neither Apply nor Save publishes.
Detached blocks and disconnected required inputs prevent Apply rather than
silently dropping or repairing user content.

## Editing

- Search the two-column palette, then use arrows and Enter to add. Disabled
  variants disclose their scope/capability or missing-host-setting requirement.
- Graph and Outline expose the same blocks, ports, actions and transactions.
  Headers use roving focus: arrows/Home/End select, Enter enters controls,
  arrows traverse ports/actions, Escape returns to the header, Tab exits the
  composite. Editable fields retain their normal text/number keyboard behavior.
- Activate either end of a wire to find the opposite port. Type/representation,
  scope and cycle checks use the graph core's port compatibility data. Occupied
  inputs require explicit Replace; replacement is one undoable transaction.
  Refusals are named and announced inside the dialog.
- Move uses 8 px arrow steps, Shift uses 32 px, Enter commits and Escape cancels.
  Inspector numeric coordinates, pan/zoom, fit and Auto Arrange are alternatives.
- Delete confirms affected wires. Undo/redo restore the graph, selection and
  originating port/header. Inspector rule moves preserve If/Then wiring and
  Otherwise; new rule inputs remain visibly disconnected until authored.
- And/Or always edit on canvas. The inspector supplies a noninteractive summary
  and **Edit in Canvas**, not nested condition cards.

Styling is scoped to the canvas and existing workspace/HA tokens. Type labels,
glyphs and named connection lists supplement wire colors. Wire glyphs retain
4.5:1 contrast and focus retains 3:1 on the tested light/dark/custom grounds.
Narrow layouts show one side panel at a time; the outline avoids spatial
navigation. Reduced-motion and forced-colors modes are supported.

Existing Base UI Dialog owns modal focus trapping and dismissal; Lucide supplies
icons; the existing theme and graph helpers supply tokens, shapes and LAN-safe
`getRandomValues` IDs. No graph-layout/editor dependency was added and no OSS
license/notices changed. SVG wires are decorative; native HTML controls and the
outline provide the full editing interface.

## Accounting dependency (pending)

`FragmentCompilation.accounting` is a typed, optional array of
`BudgetAccountingEvent`. `budgetFromCompilation` reduces those snapshots when
present; it never replays the checker or derives parallel AST counters.
`LimitsMeter` consumes only the resulting `GraphBudget`. Compact figures appear
strictly **above** 75%; null limits stay uncapped and every root has its own
details. Counts/depths include the first refused entry, not unvisited descendants.
Compiler acceptance and ordered diagnostics remain authoritative, including
both CHK-nested-choose-budget outcomes.

**Production observer forwarding is not connected yet.** W2-D owns the native
compiler entry points. Until that dependency merges and `graph/compile.ts`
captures/forwards its exact observer option in the single compile, production
expression, predicate and flow counts remain explicitly **unavailable**.
Expansion duplication/generated-flow totals also remain unavailable.

The test-only meter fixture calls the existing real checker observer and passes
its snapshots through the same budget adapter. Its threshold screenshot is
explicitly labelled as a fixture, not evidence that production counters work.

## Isolated acceptance harness

```sh
npm test -- --maxWorkers=2
npm run build
STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c \
  npx playwright test tests/e2e/workspace2-flows-canvas.spec.ts \
  --config tests/flows-canvas/canvas/playwright.config.ts
```

The dedicated config serves `tests/flows-canvas/canvas/harness.html` with Vite
only. This avoids changing the real shell/server, whose HTML fallback always
mounts the workspace. It starts no HA/persistence backend and uses no development
data. The config rejects other port/data settings and Playwright stops its
server. Curated screenshots and measured results live in `docs/evidence/w2-c/`.
Browser geometry is an interaction preview, not unchanged iOS SDUI or physical
device/runtime evidence.
