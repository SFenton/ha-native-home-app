import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { assertAdvance, assertManifest, assertTag, distributionFiles, publish, readMetadata, releaseRef } from '../scripts/release';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: run }));

const source = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const current = { version: '1.2.3', source, digest };
const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function publicationFixture({ privatePackage = false, existingSource = '', previousVersion = '' } = {}) {
  const metadata = readMetadata();
  vi.stubEnv('GITHUB_REF', `refs/tags/v${metadata.version}`);
  vi.stubEnv('GITHUB_SHA', source);
  vi.stubEnv('GITHUB_ACTOR', 'release-fixture');
  vi.stubEnv('GH_TOKEN', 'synthetic-test-token');
  const directory = mkdtempSync(join(tmpdir(), 'studio-digests-'));
  directories.push(directory);
  for (const arch of metadata.arch) writeFileSync(join(directory, arch), `${metadata.image}@${digest}\n`);
  const events: string[] = [];
  let imageSource = existingSource;
  run.mockImplementation((command: string, arguments_: string[]) => {
    if (command === 'docker') {
      if (arguments_.includes('create')) { events.push('image-published'); imageSource = source; }
      if (arguments_.includes('pull')) events.push(`anonymous-pull:${arguments_[4]}`);
      return '';
    }
    const [, , method, path] = arguments_;
    events.push(`${method}:${path}`);
    if (path.endsWith('git/matching-refs/heads/stable')) {
      return JSON.stringify(previousVersion ? [{ ref: 'refs/heads/stable', object: { sha: source } }] : []);
    }
    if (path.includes('contents/release.json')) {
      return JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify({
        version: previousVersion, source, digest,
      })).toString('base64') });
    }
    return JSON.stringify({ sha: source });
  });
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    if (input.includes('/token?')) {
      const anonymous = !new Headers(options?.headers).has('Authorization');
      if (anonymous) events.push('anonymous-access');
      return Response.json({ token: 'registry-fixture' }, { status: anonymous && privatePackage ? 403 : 200 });
    }
    if (input.includes('/manifests/')) {
      if (!imageSource) return new Response(null, { status: 404 });
      return Response.json({
        annotations: { 'org.opencontainers.image.revision': imageSource },
        manifests: ['amd64', 'arm64'].map(architecture => ({ digest, platform: { os: 'linux', architecture } })),
      }, { headers: { 'docker-content-digest': digest } });
    }
    events.push('public-repository');
    return Response.json({ private: false });
  }));
  return { directory, events };
}

describe('Home Assistant release publication', () => {
  it('permits forward updates and identical retries but rejects downgrades and version reuse', () => {
    expect(() => assertAdvance(current, null)).not.toThrow();
    expect(() => assertAdvance(current, current)).not.toThrow();
    expect(() => assertAdvance({ ...current, version: '1.10.0' }, current)).not.toThrow();
    expect(() => assertAdvance({ ...current, version: '1.2.2' }, current)).toThrow(/downgrade/);
    expect(() => assertAdvance({ ...current, source: 'c'.repeat(40) }, current)).toThrow(/cannot change/);
    expect(() => assertAdvance({ ...current, digest: `sha256:${'c'.repeat(64)}` }, current)).toThrow(/cannot change/);
  });

  it('rejects mismatched tags, missing platforms, and images built from a different commit', () => {
    expect(() => assertTag('1.2.3', 'refs/tags/v1.2.3')).not.toThrow();
    expect(() => assertTag('1.2.3', 'refs/heads/master')).toThrow(/matching/);
    expect(() => assertTag('1.2.3', 'refs/tags/v1.2.4')).toThrow(/matching/);
    expect(() => assertTag('1.2.3', 'refs/heads/main')).toThrow(/matching/);
    const manifest = {
      annotations: { 'org.opencontainers.image.revision': source },
      manifests: ['amd64', 'arm64'].map(architecture => ({ digest, platform: { os: 'linux', architecture } })),
    };
    expect(() => assertManifest(manifest, source)).not.toThrow();
    expect(() => assertManifest({ ...manifest, manifests: manifest.manifests.slice(0, 1) }, source)).toThrow(/two supported/);
    expect(() => assertManifest(manifest, 'c'.repeat(40))).toThrow(/another source/);
  });

  it('generates only discoverable app metadata and docs, never source or local data', () => {
    const metadata = readMetadata();
    const files = distributionFiles('.', { ...current, version: metadata.version });
    expect(files.map(file => file.path).sort()).toEqual([
      'README.md', 'native_home_studio/CHANGELOG.md', 'native_home_studio/DOCS.md',
      'native_home_studio/README.md', 'native_home_studio/config.yaml', 'release.json', 'repository.yaml',
    ]);
    const config = parse(files.find(file => file.path === 'native_home_studio/config.yaml')!.content);
    expect(config).toEqual(metadata);
    expect(config.image).toBe('ghcr.io/sfenton/native-home-studio');
    expect(config.ports['4800/tcp']).toBeNull();
    expect(config.options.auth_token).toBe('');
  });

  it('rejects drift between the app version, npm package and lockfile', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-release-'));
    directories.push(root);
    mkdirSync(join(root, 'docs'));
    for (const file of ['config.yaml', 'package.json', 'package-lock.json', 'CHANGELOG.md']) {
      writeFileSync(join(root, file), readFileSync(file));
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version: '99.0.0' }));
    expect(() => readMetadata(root)).toThrow(/versions must match/);
  });

  it('advertises a version only after publishing and anonymously pulling both architecture images', async () => {
    const { directory, events } = publicationFixture();
    await publish(directory);
    const update = events.indexOf('POST:repos/SFenton/ha-native-home-app/git/refs');
    expect(update).toBeGreaterThan(events.indexOf('image-published'));
    expect(update).toBeGreaterThan(events.indexOf('anonymous-access'));
    expect(events).toContain('anonymous-pull:linux/amd64');
    expect(events).toContain('anonymous-pull:linux/arm64');
    expect(update).toBeGreaterThan(events.indexOf('anonymous-pull:linux/arm64'));
    expect(update).toBeGreaterThan(events.indexOf('public-repository'));
  });

  it('leaves stable unchanged when the package cannot be pulled anonymously', async () => {
    const { directory, events } = publicationFixture({ privatePackage: true });
    await expect(publish(directory)).rejects.toThrow(/public GHCR package/);
    expect(events).toContain('image-published');
    expect(events.some(event => event.startsWith('POST:') || event.startsWith('PATCH:'))).toBe(false);
  });

  it('refuses to overwrite a version from another source or publish an older version', async () => {
    const conflict = publicationFixture({ existingSource: 'c'.repeat(40) });
    await expect(publish(conflict.directory)).rejects.toThrow(/another source/);
    expect(conflict.events).not.toContain('image-published');
    expect(conflict.events.some(event => event.startsWith('POST:') || event.startsWith('PATCH:'))).toBe(false);
    const downgrade = publicationFixture({ previousVersion: '99.0.0' });
    await expect(publish(downgrade.directory)).rejects.toThrow(/downgrade/);
    expect(downgrade.events).not.toContain('image-published');
  });

  it('retries a completed version without overwriting its image or stable commit', async () => {
    const { directory, events } = publicationFixture({ existingSource: source, previousVersion: readMetadata().version });
    await publish(directory);
    expect(events).not.toContain('image-published');
    expect(events).toContain('anonymous-pull:linux/arm64');
    expect(events.some(event => event.startsWith('POST:') || event.startsWith('PATCH:'))).toBe(false);
  });
});

describe('release ref', () => {
  it('prefers the tag the release job made over the ref that started the run', () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    expect(releaseRef()).toBe('refs/heads/main');
    vi.stubEnv('RELEASE_TAG', 'v1.2.3');
    expect(releaseRef()).toBe('refs/tags/v1.2.3');
  });
});
