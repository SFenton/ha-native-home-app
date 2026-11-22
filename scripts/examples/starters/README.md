# Compiler-proven configuration starters

These eight review files turn the [F7 research](../../../docs/flows-starters-research.md)
into configuration changes with a visible consumer and executable simulation
cases. They are data, not application examples, JavaScript, or publish bundles.
Their numbered files cover PC state, predictive PC heat, effective Away, window
severity, selected lights On, overdue tasks, groceries, and volume visibility.

**Every entity ID is a synthetic placeholder, not a verified house inventory.**
Use each `entities[].replaceWith` to map it to the owner's actual entity. Keep
the PC power helper separate from its text caption and predictive activity
sensor; keep the remote's volume entity separate from its control entity.
`demo_streamer_control` is explicitly invented for negative simulation only.
Local source, node, style, and template IDs also need collision checks.

`changes` uses `add`/`replace` operations with RFC 6901 pointers relative to a
**composition document**, not its publication envelope. The pointers address
named test fixtures, not the owner's draft. Each file's `notes` names its
fixture and any test-only destination preparation; the Windows case adds a
minimal tile only in its test copy. Preserve the owner's existing navigation,
actions, page IDs, providers, and full lights overview when adapting a recipe.
Append to existing style/template libraries rather than replacing them;
starters 3 and 4 deliberately share one identical `effective-away` template
and sources, which must be reused, not duplicated, when combined.

Run the local proof with:

```sh
npx vitest run tests/flows-starters.test.ts
```

The test copies existing fixtures, applies every operation, compiles each
candidate, and compares its **entire derived capability manifest** exactly
with `capabilities`. These manifests include the fixture's shell and existing
content; rederive them for an actual owner candidate. All 63 simulation cases
use real evaluators with a frozen `2026-11-16T12:00:00` clock, UTC offset -480.
Checklist cases render the real provider with synthetic items. An unanswered
subscription is Can't Tell, not an empty answered list; unknown state is never
relabelled Off, Closed, or zero. The lights list's qualified empty copy says
only that no selected light reports On, not that every light is Off.

No starter was removed. The compiler required one research correction: the
PC's `input_boolean` needs its own display-only state style because the
built-in `switch` style requires a `switch.*` entity.

**The loopback Studio is not running; nothing here was applied or published.**
Applying an adapted candidate to the owner's draft goes only through
[docs/agent-publish.md](../../../docs/agent-publish.md) once an authorized
loopback Studio is running: obtain the real base and entity mapping, build an
external `CHANGE` directory with the full candidate and hash-bound evidence,
then use its documented `check` and revision-guarded `apply` path. Save and
publish remain separate operations. Do not feed these recipe files directly
to `apply`, bypass checks with an import, or edit live data. These proofs do
not establish HA installation, real device actions, or native rendering.
