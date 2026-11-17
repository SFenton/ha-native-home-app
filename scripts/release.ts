import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { z } from 'zod/v4';

const repository = 'SFenton/ha-native-home-app';
const repositoryUrl = `https://github.com/${repository}`;
const image = 'ghcr.io/sfenton/native-home-studio';
const versionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const releaseSchema = z.object({
  version: versionSchema,
  source: shaSchema,
  digest: digestSchema,
});
type Release = z.infer<typeof releaseSchema>;

export function readMetadata(root = '.') {
  const config = z.object({
    name: z.string(),
    version: versionSchema,
    slug: z.literal('native_home_studio'),
    image: z.literal(image),
    arch: z.array(z.enum(['amd64', 'aarch64'])),
  }).passthrough().parse(parse(readFileSync(resolve(root, 'config.yaml'), 'utf8')));
  assert.deepEqual([...config.arch].sort(), ['aarch64', 'amd64'], 'Both supported architectures must be declared');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, config.version, 'package.json and config.yaml versions must match');
  assert.equal(lock.version, config.version, 'package-lock.json and config.yaml versions must match');
  assert.equal(lock.packages[''].version, config.version, 'Lockfile root version must match');
  assert.ok(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').includes(`## ${config.version}\n`), 'Add changelog notes for the release');
  return config;
}

/** The ref being released: `RELEASE_TAG` when the release job tagged the commit itself (a tag pushed with GITHUB_TOKEN starts no run), else the ref that started the run. */
export function releaseRef(): string | undefined {
  return process.env.RELEASE_TAG ? `refs/tags/${process.env.RELEASE_TAG}` : process.env.GITHUB_REF;
}

export function assertTag(version: string, ref: string | undefined) {
  assert.equal(ref, `refs/tags/v${version}`, 'Publish from the matching v<version> tag, not a branch');
}

export function assertAdvance(next: Release, previous: Release | null) {
  if (!previous) return;
  const before = previous.version.split('.').map(BigInt);
  const after = next.version.split('.').map(BigInt);
  const changed = after.findIndex((part, index) => part !== before[index]);
  assert.ok(changed < 0 || after[changed] > before[changed], 'Refusing to downgrade the stable app version');
  if (changed < 0) assert.deepEqual(next, previous, 'A released version cannot change source or image; bump the version');
}

const manifestSchema = z.object({
  annotations: z.record(z.string(), z.string()),
  manifests: z.array(z.object({
    digest: digestSchema,
    platform: z.object({ os: z.string(), architecture: z.string() }),
  })),
});

export function assertManifest(value: unknown, source: string) {
  const manifest = manifestSchema.parse(value);
  assert.equal(manifest.annotations['org.opencontainers.image.revision'], source, 'Version already belongs to another source commit; bump the version');
  assert.deepEqual(manifest.manifests.map(item => `${item.platform.os}/${item.platform.architecture}`).sort(),
    ['linux/amd64', 'linux/arm64'], 'Release must contain exactly the two supported platforms');
}

async function registryManifest(version: string, authenticated: boolean) {
  const headers: Record<string, string> = {};
  if (authenticated) {
    assert.ok(process.env.GH_TOKEN && process.env.GITHUB_ACTOR, 'Registry access requires GH_TOKEN and GITHUB_ACTOR');
    headers.Authorization = `Basic ${Buffer.from(`${process.env.GITHUB_ACTOR}:${process.env.GH_TOKEN}`).toString('base64')}`;
  }
  const tokenResponse = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:sfenton/native-home-studio:pull`, {
    headers, signal: AbortSignal.timeout(30_000),
  });
  assert.ok(tokenResponse.ok, `Registry token request failed (${tokenResponse.status}). Anonymous access requires a public GHCR package.`);
  const { token } = z.object({ token: z.string().min(1) }).parse(await tokenResponse.json());
  const response = await fetch(`https://ghcr.io/v2/sfenton/native-home-studio/manifests/${version}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  assert.ok(response.ok, `Registry manifest request failed (${response.status}); stable was not updated`);
  return { manifest: await response.json(), digest: digestSchema.parse(response.headers.get('docker-content-digest')) };
}

function github(method: string, path: string, body?: unknown): unknown {
  const args = ['api', '--method', method, `repos/${repository}/${path}`];
  if (body !== undefined) args.push('--input', '-');
  const result = execFileSync('gh', args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result);
}

function stableHead(): string | null {
  // Listing matching refs distinguishes a missing branch from an authentication failure.
  const refs = z.array(z.object({
    ref: z.string(), object: z.object({ sha: shaSchema }),
  })).parse(github('GET', 'git/matching-refs/heads/stable'));
  return refs.find(ref => ref.ref === 'refs/heads/stable')?.object.sha ?? null;
}

export function distributionFiles(root: string, release: Release) {
  const config = readMetadata(root);
  assert.equal(config.version, release.version);
  return [
    { path: 'repository.yaml', content: readFileSync(resolve(root, 'repository.yaml'), 'utf8') },
    { path: 'README.md', content: `# Native Home Studio\n\nAdd \`${repositoryUrl}#stable\` in Home Assistant's app store repositories.\n\nSee [app documentation](native_home_studio/DOCS.md) and [release notes](native_home_studio/CHANGELOG.md).\n` },
    { path: 'native_home_studio/config.yaml', content: stringify(config) },
    { path: 'native_home_studio/README.md', content: '# Native Home Studio\n\nDesign, preview, validate, and publish Native Home configurations.\n\nRequires Home Assistant OS or Supervisor. See the Documentation tab for setup and limitations.\n' },
    { path: 'native_home_studio/DOCS.md', content: readFileSync(resolve(root, 'docs/deployment.md'), 'utf8').replaceAll('](configuration.md', `](${repositoryUrl}/blob/${release.source}/docs/configuration.md`).replaceAll('](releasing.md', `](${repositoryUrl}/blob/${release.source}/docs/releasing.md`) },
    { path: 'native_home_studio/CHANGELOG.md', content: readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8') },
    { path: 'release.json', content: `${JSON.stringify(release, null, 2)}\n` },
  ];
}

export async function publish(digestDirectory: string) {
  const metadata = readMetadata();
  assertTag(metadata.version, releaseRef());
  const source = shaSchema.parse(process.env.RELEASE_SHA ?? process.env.GITHUB_SHA);
  const head = stableHead();
  let previous: Release | null = null;
  if (head) {
    const file = z.object({ content: z.string(), encoding: z.literal('base64') })
      .parse(github('GET', `contents/release.json?ref=${head}`));
    previous = releaseSchema.parse(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
    assertAdvance({ version: metadata.version, source, digest: previous.digest }, previous);
  }
  let published = await registryManifest(metadata.version, true);
  if (!published) {
    const digests = metadata.arch.map(arch => readFileSync(resolve(digestDirectory, arch), 'utf8').trim());
    for (const digest of digests) {
      assert.ok(digest.startsWith(`${image}@`), 'Unexpected image repository in build artifact');
      digestSchema.parse(digest.slice(image.length + 1));
    }
    execFileSync('docker', ['buildx', 'imagetools', 'create',
      '--annotation', `index:org.opencontainers.image.revision=${source}`,
      '--annotation', `index:org.opencontainers.image.version=${metadata.version}`,
      '--tag', `${image}:${metadata.version}`, ...digests], { stdio: 'inherit' });
    published = await registryManifest(metadata.version, true);
  }
  assert.ok(published, 'Published image is missing');
  assertManifest(published.manifest, source);

  const anonymous = await registryManifest(metadata.version, false);
  assert.ok(anonymous, 'Image is not anonymously available; set the GHCR package visibility to Public, then rerun this tag');
  assert.equal(anonymous.digest, published.digest, 'Anonymous image digest differs from authenticated image');
  assertManifest(anonymous.manifest, source);
  const dockerConfig = mkdtempSync(resolve(tmpdir(), 'studio-anonymous-pull-'));
  try {
    for (const platform of ['linux/amd64', 'linux/arm64']) {
      execFileSync('docker', ['--config', dockerConfig, 'pull', '--platform', platform, `${image}:${metadata.version}`], { stdio: 'inherit' });
    }
  } finally {
    rmSync(dockerConfig, { recursive: true, force: true });
  }
  const publicRepo = await fetch(`https://api.github.com/repos/${repository}`, { signal: AbortSignal.timeout(30_000) });
  assert.ok(publicRepo.ok, 'The repository must be publicly readable by Supervisor. Stable was not updated.');
  z.object({ private: z.literal(false) }).parse(await publicRepo.json());
  const release = { version: metadata.version, source, digest: published.digest };
  assertAdvance(release, previous);
  if (previous?.version === release.version) {
    console.log(`Stable already publishes ${metadata.version} from ${source}`);
    return;
  }
  const tree = z.object({ sha: shaSchema }).parse(github('POST', 'git/trees', {
    tree: distributionFiles('.', release).map(file => ({ ...file, mode: '100644', type: 'blob' })),
  }));
  const commit = z.object({ sha: shaSchema }).parse(github('POST', 'git/commits', {
    message: `Publish Native Home Studio ${metadata.version}\n\nSource: ${source}\nImage: ${image}@${release.digest}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`,
    tree: tree.sha,
    parents: head ? [head] : [],
  }));
  if (head) github('PATCH', 'git/refs/heads/stable', { sha: commit.sha, force: false });
  else github('POST', 'git/refs', { ref: 'refs/heads/stable', sha: commit.sha });
  console.log(`Published ${image}:${metadata.version} (${release.digest}) to ${repositoryUrl}#stable`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'check' || command === 'metadata') {
    const metadata = readMetadata();
    if (command === 'metadata') {
      assertTag(metadata.version, releaseRef());
      assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${metadata.version}\nimage=${metadata.image}\n`);
    }
    console.log(`Release metadata valid: ${metadata.version}, ${metadata.arch.join(', ')}`);
  } else if (command === 'publish') {
    assert.ok(process.argv[3], 'Provide the tested image digest directory');
    await publish(process.argv[3]);
  } else {
    throw new Error('Usage: tsx scripts/release.ts check|metadata|publish <digest-directory>');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
