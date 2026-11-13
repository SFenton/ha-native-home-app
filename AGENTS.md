# Native Home Studio

This repository owns the Home Assistant App's configuration editor, preview,
document contract, persistence, and publishing API. It does **not** own the iOS
app or the existing `fenton_home` Core integration. Do not edit or deploy those
projects as part of studio work.

## Orchestration

Follow the eight-role structure in [.agents/README.md](.agents/README.md).
Only the orchestrator dispatches implementation. Use GitHub Copilot and OpenAI
models exclusively; exact model/effort selections are recorded in
[models.json](.agents/workflow/models.json). Configure effort through the runtime,
not by assuming agent Markdown changes the model's reasoning setting.

Give each worker an objective, owned and excluded paths, contract dependencies,
acceptance criteria, and a stop condition. Parallel writers must have disjoint
ownership. No nested delegation. Missing requested models must be reported, not
silently replaced. Review is a new, read-only task, independent from its author.

## Product constraints

- Configuration is data, never remotely executable JavaScript, Jinja, or Swift.
- The shared types, schema, semantic checks, renderer, and protocol docs must
  agree. Reject invalid documents rather than repairing them silently.
- Save and publish are different operations. Preserve local edits on conflict.
- Browser previews do not operate real devices. Test services through simulation.
- Real HA credentials stay on the server and never appear in documents, source
  control, browser responses, logs, or test evidence.
- Keep all app-owned URLs relative so the production bundle works under Ingress.
- Development must work over ordinary LAN HTTP, including component IDs; do not
  rely on secure-context-only browser APIs.
- All example content belongs in configuration. Settings, profile content,
  navigation, and support components must remain editable.
- Browser device geometry and Live Activities are previews, not native hardware,
  ActivityKit, or APNs validation. Never claim the unchanged iOS app renders SDUI.
- Prefer existing OSS primitives; retain licenses and document deviations.

## Verification

Use `npm test`, `npm run build`, and focused Playwright tests. Browser tests own
port 4801 and isolated `test-results/studio-data`; the interactive studio owns
port 4800 and `data/`. Never reset the user's development data to run tests.

Use `node scripts/smoke-container.mjs` after building the image to test production
authentication, persistence, and mounted-path browser routing. Stop temporary
servers and containers. Leave a development server running only when requested.

Do not claim installation on HA, physical-device behavior, or native delivery
without corresponding evidence. Existing source research is not runtime proof.
