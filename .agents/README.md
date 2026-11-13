# Studio agent structure

Adapted from the role and handoff structure of `SFenton/native-home`; see the
pinned sources in [research](../docs/research.md). Native simulator hooks and
Apple build machinery are intentionally not copied into a web/HA App project.

The roles are **orchestrator, researcher, designer, coder, verifier, reviewer,
steward, and menial**. Copilot agent definitions live in `.github/agents/`;
runtime selections live in `workflow/models.json`.

## Pipeline

Intake and ownership -> evidence-based research -> design contract -> bounded
implementation -> behavioral verification -> independent review -> persistence
and handoff. Research/design may run concurrently on separate evidence; server
and UI coders may run concurrently after agreeing on the shared contract.

The orchestrator owns the task ledger and acceptance matrix. In this environment
use the session task database rather than committing transient plans. Evidence
is test output, retained Playwright traces, generated configuration, and observed
network behavior. Do not label a source inspection or a sample preview a live
integration test. A task is complete only when its required checks are proved;
an inaccessible platform is a stated limitation, not a passing check.

## Brief and result

Each delegated brief includes the objective, expected outputs, evidence sources,
owned/excluded paths, prerequisite contracts, acceptance check IDs, device
families if relevant, and a stop condition. Workers do not delegate further.

Use this result shape for machine-consumable handoffs:

```json
{
  "status": "done",
  "task": "configuration-publishing",
  "summary": "At most 250 words describing the actual outcome.",
  "artifacts": ["server/store.ts"],
  "acceptance": [
    { "id": "publish-survives-restart", "status": "passed", "evidence": "test command or artifact" }
  ],
  "blockingQuestion": null
}
```

Other statuses are `blocked`, `needs_research`, and `needs_decision`. Report real
failures separately from infrastructure limitations. Use Copilot Terra 6.1 with
medium effort for the menial role. Keep requested model availability explicit;
if a requested model is unavailable, report it rather than silently substituting.
