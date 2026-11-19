# W2-S simulation acceptance

This is Studio browser/harness evidence, not HA installation or native-device
delivery. Fixtures reuse the existing first-slice composition and demo house;
HA credential environment variables were cleared. All browser work used port
4823 and `test-results/studio-data/w2-s`, never the user's development data.

## Acceptance evidence

| ID | Evidence |
| --- | --- |
| S-live | `live.test.tsx`: identical requests grouped onto one existing live-run owner; request/parameter races, failed refresh with retained stale answer, steps-only changes, cancelled simulation debounce, entity/version updates without a new connection. |
| S-pins | `engine.test.ts`: bedroom 25 -> Too Warm -> Live 21.9; immutable capture/AST; typed computed/step overrides; dependency-specific modes; explicit per-source Live restoration; stale target refusal. |
| S-scenarios | Unit and desktop/phone Playwright: explicit Passed/Failed/Incomplete; offline Run All; review/save/reload; reopen Live; midnight edge; actual saved keep seed; tolerance; denied/quota/oversized storage; stale pins/semantic changes/truncated capture refusal. |
| S-trace | Actual shared-evaluator observations: raw count tests/viewer exclusion, filter reasons, sort positions, map/group values, numeric reducer membership, original pointers and real step budgets. Eight input chores become six after Keep Where; the separate display flow cuts six to five. |
| Observer invariants | Permanent `observation.test.ts` compares all 925 files in `contract/corpus/pipelines` and `contract/corpus/evaluation`: origin/main and branch, both with/without observer, byte-identical serialized evaluation results, step traces, errors/budget results and spend counts. Throwing diagnostic callbacks cannot change answers. |
| Network boundary | Desktop and phone intercepted traffic: one initial grouped safe flow read; zero extra fetches for pins, clock, drawers, Run All, capture or save; no device-write endpoint. Reload/reopen/Return to Live are distinguished from simulation. JSON records contain method/URL only, no headers or credentials. |

Focused commands and the W2-I mounting/lifecycle contract are in the
[host README](../../../src/workspace2/logic-simulation/README.md).

## No-observer benchmark

[`benchmark.json`](benchmark.json) records the full measurements against
origin/main `427eaba6236804275de58d3759c467f4bfcf3798`, Node v26.3.0 on this
shared macOS host. The flow has 64 entities and seven filter/map/group/count
steps. After 3,000 warm-up runs per implementation, 15 samples alternate
before/after order; each sample evaluates 3,000 flows. Answers and visit counts
are checked before timing.

| Unobserved implementation | Median per 3,000 runs | Approx. per flow |
| --- | ---: | ---: |
| origin/main | 519.553 ms | 173.184 us |
| W2-S | 523.624 ms | 174.541 us |

The measured median difference is **+0.78% (+1.36 us per 64-entity flow)**,
not a claim of literally zero timing overhead or a statistically isolated
hardware result. No diagnostic event objects/copies or observer-only item
loops are allocated/executed without an observer. Timing is reported, not used
as a flaky CI assertion.

## Scope and limitations

The host is not yet integrated into the production workspace; W2-I owns that
integration. Existing connection freshness must be supplied by its owner.
Deactivation must render once before unmount to cancel the shared live-run
hook's existing timer. No changes were made to graph core, compiler forwarding,
schema, server, workspace shell, iOS or Core integration. Browser geometry and
the fake data are not evidence of physical hardware behavior.
