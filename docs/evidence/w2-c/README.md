# W2-C: isolated canvas interaction evidence

Rebased onto `427eaba` (0.3.15), retaining #24 and #25. No workspace shell,
native app, server, compiler entry point or evaluator edits.

## Reproduce

```sh
npm test -- --maxWorkers=2
npm run build
STUDIO_E2E_PORT=4822 STUDIO_E2E_DATA_DIR=./test-results/studio-data/w2-c \
  npx playwright test tests/e2e/workspace2-flows-canvas.spec.ts \
  --config tests/flows-canvas/canvas/playwright.config.ts
npx vitest run tests/flows-canvas/graph/canvas-performance.test.ts \
  --maxWorkers=2 --reporter=verbose --silent=false
```

The standalone Vite CanvasHost harness needs no persistence backend or HA
credentials. Browser tests use only 4822 and stop their temporary server. No
test resets the user's data. Screenshots are from Chromium desktop
1440 x 900 and touch-enabled phone viewport 390 x 844 (not a native-device test).

Final validation on the rebased branch:

- `npm test -- --maxWorkers=2`: 270 files passed; 12,210 tests passed and one
  pre-existing skip.
- `npm run build`: passed (TypeScript plus Vite).
- Canvas-focused units: 49 passed.
- Isolated Playwright: 10 passed, five desktop and five phone.
- Temporary browser/server resources stopped; port 4822 has no listener.

## Acceptance evidence

| ID | Evidence |
| --- | --- |
| C-palette | Two-column searchable, named chips; scope/capability refusal descriptions. `*-{light,dark,custom}-palette.png`. |
| C-wire | Keyboard output-to-input confirmation, occupied-input Replace, named wire list, live cycle/type refusals inside Base UI dialogs; unit tests also cover representation mismatches. |
| C-keyboard | Real Tab/arrows/Enter/Delete/Undo/Redo sequences add/connect/replace/move/delete in graph and outline; no pointer input or programmatic focus in those scenarios. DOM unit tests assert restored port/header focus and selection. |
| C-themes | Light, dark and custom HA tokens; narrow view without document horizontal overflow; wire glyph >=4.5:1 and focus >=3:1 unit assertions. `*-{light,dark,custom}-canvas.png` and `*-{light,dark,custom}-summary.png`. |
| C-meter | Exact expression 48/49, shared call 96/97, predicate 24/25, expression-depth 6/7, predicate-depth 4/5, case 12/13 and step 24/25 thresholds. Snapshots come from the real checker observer. `*-meter.png` is explicitly a test fixture. |

G-limits: 16 comparisons in All Of yield 49 combined AST entries and 17
predicates. The actual checker accepts Choose (52 expression entries), Count
(50), and flow filtering (17 predicates with 32 independent single-entry operand
scopes). The flow case never becomes a fictitious 49/32 or 49/64 counter.

CHK-nested-choose-budget remains unchanged. Tests retain the early refusal at
`/of/1/of/15`, the initial uncapped/null-limit predicate scope, the refusal of an
unmodified base inside Choose, and later outer-Choose acceptance at 43 expression
entries/depth 6. The early-reset cases also retain visibleWhen, conditional-look
when, activeWhen, filledWhen and errorWhen pointers. Meter acceptance and exact
compiler diagnostics agree; no checker reconciliation is included.

## Performance and dependency

The dedicated performance test changes a literal in the existing **2,341-node,
32-step** fixture, warms up five times, then measures `validateGraph + lower`
15 times. It also spies on the native source entry point: exactly one call per
iteration, including budgets. The final rebased run measured **37.00 ms median**,
34.42 ms minimum, 39.73 ms maximum (required median <=50 ms). An earlier run
measured 32.51 ms median.

**Pending:** W2-D's observer-forwarding PR #28 must merge before production counter
capture can be wired into `graph/compile.ts`. Production meters currently say
accounting is unavailable. The reducer/UI/fixtures do not pretend those counters
are live. Performance with that future capture must be remeasured after wiring.

Base UI, Lucide, the existing theme primitives and graph helpers are reused;
no dependency/license changes. SVG wires are visual, with semantic HTML
ports/actions and the full outline alternative. Save and Apply stay distinct;
conflict tests retain edited values and call the host comparison hook.
