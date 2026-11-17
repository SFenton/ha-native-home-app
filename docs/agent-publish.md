# Agent publish path

An agent may apply a finished change to the owner's Studio draft and publish it, through one command: `scripts/studio-publish.ts`,
run only in the exact form below (there is no npm script). Publish ships the whole draft and reaches every signed-in phone at once, so the command works only
through this Studio's own API on loopback and keeps the rest of this page's rules.

## Invocation

```
<checkout>/node_modules/.bin/tsx <checkout>/scripts/studio-publish.ts <command> [CHANGE] [options]
```

| Command | What it does |
|---|---|
| `status [--json]` | Draft and live revisions, `draftIsLive`, the `open-check` action, history revisions, the last logged change, every record that is not final (`openChanges`) and every one marked for the owner (`ownerAction`). No document, token or house value. |
| `check CHANGE` | Read only. Everything below, without a write. |
| `apply CHANGE --reason TEXT [--publish] [--rebase-identical]` | Records the prior draft, writes the candidate with `expectedRevision`, reads it back. `--publish` goes on to `publish`. |
| `publish CHANGE --reason TEXT` | Re-reads, `POST ha/publish` with `expectedRevision`, confirms the live revision, hash and `draftIsLive`. |
| `rollback CHANGE --reason TEXT [--live-only \| --draft-only]` | Puts the live publication and the draft back from the saved prior copy. |
| `resolve CHANGE --reason TEXT [--owner-action]` | Marks a stale record final once nothing of the change is left; `--owner-action` hands a stuck change to the owner. |

Exit codes: `0` done, `1` refused or failed (the output names the reason code), `3` stale base or owner edits (rebuild the change; never retry),
`2` bad arguments (an unknown command, a missing CHANGE or `--reason`). `--base URL` names another loopback Studio (default `http://127.0.0.1:4801`; ports 4800 and 4819 only when the bundle names
them), `--log PATH` the JSONL log (default `~/hass-agents/studio-publish.jsonl`).

## The change record

`CHANGE` is a directory under `STUDIO_PUBLISH_HOME` (default `~/hass-agents/studio-publish`), given as a path or a bare id. It lives outside
every repository because it holds the owner's draft; a `STUDIO_PUBLISH_HOME` inside a git repository is refused (`bad_root`). It contains `change.json` (`id`, `studio` {`base`, `publisherId`, `documentId`}, `base`
{`draftRevision`, `document`, `liveRevision`, `liveEnvelopeSha256`}, `document` (the full candidate), `scope`: JSON pointers the change may
differ in), `evidence.json` (`candidateSha256` = SHA-256 of the candidate's canonical text, `validation.result`, `screenshots.before` and
`.after` (paths; relative ones resolve against the directory), `checks`), and after `apply` `record.json` and `prior.json` (mode 600).

## What the command refuses

- **Owner's unpublished edits.** Publish ships the whole draft. `open-check` is read first, then `draftIsLive` must be `true`: the draft must equal what the app serves, else `owner_edits` (exit 3).
- **A stale base.** The draft must be at the revision and hold the document the change was built against, and the live revision must be the recorded one (`stale_base`, `ha_moved`). A 409 on the write or the publish stops the command; it is never retried.
- **More than declared.** The difference between `base.document` and `document` must lie inside `scope`; an empty scope or an empty path is refused.
- **Unproven candidates.** The Studio's own `compileCompositionDocument` and `POST /native/api/validate` must accept the candidate, and `evidence.json` must be bound to its hash, with before and after screenshots and every check passing.
- **Another Studio or a non-loopback base.** `publisherId` and the document id must match the bundle.

## Rollback

The Studio keeps no draft history and `ha/rollback` leaves the draft alone, so the command saves the prior document itself. `rollback`:

1. restores the live side with `ha/rollback` to the revision recorded before the publish, only while the live revision is still the one this command published (`live_moved` otherwise, so the owner's later publish is never undone); an unconfirmed publish counts only when the live revision is one past the recorded one and the draft equals it;
2. falls back to republishing the prior document when that history entry has aged out (404), confirmed by reading the publication back (a republish is a new envelope, so its hash differs);
3. restores the draft only while it sits at the revision the command left **and** holds the command's own write (the candidate, or the hash it read back); otherwise it reports `draft_moved` and leaves the owner's work alone.

A rollback that fails prints an `ALERT [rollback_failed]` line and logs it; `resolve --owner-action` marks a stuck change for the owner (alert, log, listed under `ownerAction` by `status`).

## Auth and secrets

The Studio at 4801 runs local-only without a token: the command sends no credential. If the Studio answers 401 and `STUDIO_AUTH_TOKEN` is set in
the environment, the command sends it as a Bearer header. It reads no credential file, and prints and logs no token or document (output and log pass
through a scrubber). The Home Assistant credential stays in the Studio server. The command never opens the Studio's data directory.

## Tests

`tests/studio-publish.test.ts` runs the command in process against the real Studio server on a scratch data directory under `test-results/`
and an ephemeral loopback port; only Home Assistant is faked (`tests/fake-ha-publication.ts`), and faults (a lost reply, a failed write) are
injected by wrapping `fetch`.
