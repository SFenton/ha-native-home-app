# Publishing Home Assistant releases

Source changes live on `master`. Home Assistant installs from the generated
`stable` branch, using this exact repository URL:

```text
https://github.com/SFenton/ha-native-home-app#stable
```

Do not edit `stable` manually. The pipeline publishes only app metadata and
documentation there, never development data, credentials, or source build trees.
The root `config.yaml` remains the source metadata and local Docker build context.

## One-time setup

- Enable GitHub Actions. Release jobs request `packages: write` and, for the
  final publication job only, `contents: write`. No personal token or HA
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
The workflow never force-pushes and never changes the source branch.

## Cut a release

1. Update `version` in `config.yaml`, then run
   `npm version <same-version> --no-git-tag-version` to synchronize the npm
   package and lockfile. Use stable `MAJOR.MINOR.PATCH` versions.
2. Add matching `## <version>` notes to `CHANGELOG.md`. Declare any breaking
   version in `config.yaml` and explain required migration/backup steps.
3. Run `npm run check:release`, `npm test`, and `npm run build`. Commit and push
   all intended source changes to `master`.
4. Tag that commit and push the tag, for example for the initial release:

   ```sh
   git tag -a v0.1.0 -m "Native Home Studio 0.1.0"
   git push origin v0.1.0
   ```

   **Publish Home Assistant app** runs on `v*` tags. It rejects a tag that does
   not match the manifest or whose commit is not on `master`. Manual runs must
   also select the matching tag, not a branch:

   ```sh
   gh workflow run release.yml --ref v0.1.0
   ```

5. Confirm the workflow succeeded and `stable/release.json` records the intended
   source commit and image digest. Then refresh Home Assistant's app store.

Ordinary pushes to `master` run checks, not releases. Never move an existing
release tag or reuse a version for changed code; bump the version instead.

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
