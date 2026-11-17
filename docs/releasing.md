# Publishing Home Assistant releases

Source changes live on `main`. Home Assistant installs from the generated
`stable` branch, using this exact repository URL:

```text
https://github.com/SFenton/ha-native-home-app#stable
```

Do not edit `stable` manually. The pipeline publishes only app metadata and
documentation there, never development data, credentials, or source build trees.
The root `config.yaml` remains the source metadata and local Docker build context.

## One-time setup

- Enable GitHub Actions. Release jobs request `packages: write`, and the
  prepare and publish jobs request `contents: write`. No personal token or HA
  credential is required in repository secrets.
- Supervisor must be able to clone the repository anonymously. If this source
  repository is private, an owner must explicitly approve making it public
  before using this distribution URL. The pipeline does not change repository
  visibility. To keep source private, use a separately designed public
  distribution repository instead; this pipeline does not assume that setup.
- The first GHCR push creates `sfenton/native-home-studio` as a private package,
  even if the source repository is public. After its first image push, open
  [package settings](https://github.com/users/SFenton/packages/container/native-home-studio/settings)
  and set package visibility to **Public**. Confirm that this repository has
  Actions write access to the package.
- If the first run stops at the anonymous-access gate, make the package public
  and rerun the failed workflow jobs. The published version is reused only if
  it belongs to the same source commit; it is never overwritten. Until the gate
  passes, no new version is advertised to Home Assistant.

Repository rules must allow this workflow to create and fast-forward `stable`.
The workflow never force-pushes. It changes the source branch only when the
prepare job pushes the bot release commit (`Release <version> [skip ci]`) and
its tag to `main`; repository rules must allow that push too.

## How a release happens

A release needs no manual step. Every push to `main` runs **Publish Home
Assistant app** (`.github/workflows/release.yml`):

1. **checks** runs the reusable Studio checks (`ci.yml`) on the pushed commit.
2. **prepare** reads the tags and the commits since the last tag with
   `scripts/next-version.ts`:
   - `config.yaml` names a version with no tag yet that is above every tag and
     above the version `stable` publishes (its `release.json`): tag that version
     as it is, writing nothing. This is how a hand-set version, such as the
     first 0.3.0, is released.
   - Otherwise (the version is tagged, or at or below a tag or `stable`) the
     next version, counted from the highest of config, tags and `stable`, is a patch bump, a minor bump when a commit
     subject starts `feat:` or `feat(scope):` or has a `Release-Note: minor`
     trailer, and a major bump for `type!:`, a `BREAKING CHANGE:` line or a
     `Release-Note: major` trailer.
   - It writes the version to `config.yaml`, `package.json` and
     `package-lock.json`, adds a `## <version>` section to `CHANGELOG.md` (the
     user-visible `Release-Note:` texts and `feat:` subjects), commits that as
     `github-actions[bot]` with `[skip ci]`, tags `v<version>` and pushes the
     commit and tag together.
3. **metadata**, **images** and **publish** validate the tag, build and smoke-test
   both architectures, and publish the image and `stable` as described below.

Everything runs in one workflow because a tag pushed with `GITHUB_TOKEN` starts
no other workflow. The bot's own version commit never starts a release (the
checks job skips a head commit authored by the bot whose message starts
`Release `). Runs share one concurrency group, so two merges cannot tag the same
version, and a run whose commit is no longer the head of `main` leaves the
release to the newer run. **Run workflow** on `main` (`workflow_dispatch`)
repeats a release whose publish failed: when nothing follows the newest tag, it
publishes that tag again.

Requirements: the repository's Actions workflow permissions allow the job to push
to `main`. If `main` is protected by a ruleset or branch protection, the bot's
push is refused; allow the GitHub Actions app to bypass it for this push (a
repository setting only the owner changes).

Do not move or reuse a release tag. Write a `Release-Note:` trailer on commits
whose change a user should read about in the changelog.

## Publication order and failure recovery

The release workflow validates metadata and runs the reusable Studio checks:
unit tests, TypeScript/Vite build, Playwright, and the production container smoke.
It then builds staging images on native Linux amd64 and arm64 runners, using
OCI media types so the final index can carry source/version annotations. Each
staging image is pulled by digest and must pass production authentication,
save/publish persistence across restart and container replacement, and
mounted-path browser routing checks before its digest is eligible for release.

The final job combines the tested image digests into
`ghcr.io/sfenton/native-home-studio:<version>`. Version tags are immutable:
an existing tag must match the source commit and both supported platforms.
Only after credential-free pulls of both platforms succeed does the job
fast-forward `stable`.
`release.json` records the version, source SHA, and image digest.

A failed build or access check leaves the previously advertised version intact.
Retry the same tag after correcting infrastructure or package visibility.
Code changes require a new version/tag. An older run cannot downgrade `stable`;
concurrent releases are serialized, and branch updates are non-forced.
Staging `build-<sha>-<arch>` tags are not installation channels. Keep versioned
images for existing installations and restores; do not delete released tags.

Local container verification uses:

```sh
docker build --tag native-home-studio:check .
node scripts/smoke-container.mjs
```

The smoke test uses an isolated, loopback-only container and removes it afterward.
It does not use the interactive Studio's data or HA credentials. Passing these
checks does not establish installation on HA or unchanged native-client support.

Upstream contracts:
[repository layout](https://contributors.home-assistant.io/apps/guides/repository/)
and [publishing/versioning](https://contributors.home-assistant.io/apps/guides/publishing/).
