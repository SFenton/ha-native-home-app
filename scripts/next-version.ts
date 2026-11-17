import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** How far a release moves the version. */
export type Level = 'major' | 'minor' | 'patch';

/** One commit since the last release tag. */
export interface Commit {
  author: string;
  subject: string;
  body: string;
}

/** What the release workflow does for the commit it was started on. */
export type Plan =
  | { action: 'tag-as-is'; version: string; level: null; notes: string[] }
  | { action: 'bump'; version: string; level: Level; notes: string[] }
  | { action: 'resume'; version: string; level: null; notes: string[] };

export const botName = 'github-actions[bot]';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const quietNotes = /^(none|n\/a|not user visible)\.?$/i;

/** True for the commit the release workflow itself makes to record a version. */
export function isBumpCommit(commit: Pick<Commit, 'author' | 'subject'>): boolean {
  return commit.author === botName && /^Release \d+\.\d+\.\d+\b/.test(commit.subject);
}

function parts(version: string): [number, number, number] {
  assert.match(version, versionPattern, `Not a MAJOR.MINOR.PATCH version: ${version}`);
  return version.split('.').map(Number) as [number, number, number];
}

/** Orders two stable versions; negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The highest stable `v<version>` tag, as a bare version, or null. */
export function latestVersion(tags: readonly string[]): string | null {
  const versions = tags.filter(tag => /^v\d+\.\d+\.\d+$/.test(tag)).map(tag => tag.slice(1));
  return versions.sort(compareVersions).at(-1) ?? null;
}

function trailer(commit: Commit, name: string): string | null {
  const line = commit.body.split('\n').find(item => item.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

/** The size of one commit's change: `BREAKING CHANGE` or `type!:` is major, `feat:` minor, else patch. A `Release-Note: major|minor` trailer forces that level. */
export function commitLevel(commit: Commit): Level {
  const forced = trailer(commit, 'Release-Note')?.toLowerCase();
  if (forced === 'major' || forced === 'minor') return forced;
  if (/^[a-z]+(\([^)]*\))?!:/.test(commit.subject) || /^BREAKING[ -]CHANGE:/m.test(commit.body)) return 'major';
  if (/^feat(\([^)]*\))?:/.test(commit.subject)) return 'minor';
  return 'patch';
}

/** The largest level among the commits; patch when there are none. */
export function levelOf(commits: readonly Commit[]): Level {
  const levels = commits.map(commitLevel);
  return levels.includes('major') ? 'major' : levels.includes('minor') ? 'minor' : 'patch';
}

/** Adds one to the part the level names and zeroes the parts below it. */
export function bumpVersion(version: string, level: Level): string {
  const [major, minor, patch] = parts(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Changelog bullets: each commit's user-visible `Release-Note:` text, or the subject of a `feat:` or breaking commit. */
export function releaseNotes(commits: readonly Commit[]): string[] {
  const notes: string[] = [];
  for (const commit of commits) {
    if (isBumpCommit(commit) || /^Merge /.test(commit.subject)) continue;
    const text = trailer(commit, 'Release-Note');
    const level = commitLevel(commit);
    const note = text && !quietNotes.test(text) && !/^(major|minor|patch)$/i.test(text)
      ? text
      : level !== 'patch' ? commit.subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '') : null;
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

/** Puts a `## <version>` section above the newest one; leaves the file alone when the version already has notes. */
export function insertChangelog(changelog: string, version: string, notes: readonly string[]): string {
  if (changelog.includes(`## ${version}\n`)) return changelog;
  const lines = notes.length ? notes : ['Maintenance and internal changes.'];
  const section = `## ${version}\n\n${lines.map(line => `- ${line}`).join('\n')}\n\n`;
  const first = changelog.indexOf('\n## ');
  return first < 0 ? `${changelog.trimEnd()}\n\n${section.trimEnd()}\n` : `${changelog.slice(0, first + 1)}${section}${changelog.slice(first + 1)}`;
}

/**
 * Decides what a release run does. `stableVersion` is the version `stable` already advertises to Home Assistant (its
 * `release.json`); a release never goes at or below it or below any tag.
 *
 * - `tag-as-is`: `config.yaml` names a version above every tag and above stable, with no tag yet (a hand bump); tag it unchanged.
 * - `resume`: that version is the newest tag, nothing came after it and stable is not ahead; publish it again (an image push is idempotent).
 * - `bump`: otherwise take the next version past every tag, stable and `config.yaml`, by the commits since the last tag.
 */
export function planRelease(input: { configVersion: string; tags: readonly string[]; commits: readonly Commit[]; stableVersion?: string | null }): Plan {
  const { configVersion, tags } = input;
  const commits = input.commits.filter(commit => !isBumpCommit(commit));
  const notes = releaseNotes(commits);
  const latest = latestVersion(tags);
  const stable = input.stableVersion ?? null;
  const floor = [latest, stable].reduce<string | null>((top, item) => item && (!top || compareVersions(item, top) > 0) ? item : top, null);
  if (!tags.includes(`v${configVersion}`) && (!floor || compareVersions(configVersion, floor) > 0)) {
    return { action: 'tag-as-is', version: configVersion, level: null, notes };
  }
  if (commits.length === 0 && configVersion === latest && (!stable || compareVersions(stable, configVersion) <= 0)) {
    return { action: 'resume', version: configVersion, level: null, notes };
  }
  const level = levelOf(commits);
  const base = floor && compareVersions(floor, configVersion) > 0 ? floor : configVersion;
  const version = bumpVersion(base, level);
  assert.ok(!tags.includes(`v${version}`), `Tag v${version} already exists`);
  return { action: 'bump', version, level, notes };
}

/** Replaces the top-level `version:` line of `config.yaml`, keeping everything else byte for byte. */
export function setConfigVersion(config: string, version: string): string {
  assert.match(config, /^version: .*$/m, 'config.yaml has no version line');
  return config.replace(/^version: .*$/m, `version: "${version}"`);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** The version `stable` advertises, from its `release.json`; null when the branch or file is not there. */
export function readStableVersion(): string | null {
  try {
    const release = JSON.parse(git('show', 'origin/stable:release.json')) as { version?: unknown };
    return typeof release.version === 'string' && versionPattern.test(release.version) ? release.version : null;
  } catch {
    return null;
  }
}

/** Commits after the newest tag reachable from HEAD (all of history when there is none), oldest first. */
export function readCommits(): { tags: string[]; commits: Commit[] } {
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const reachable = git('tag', '--merged', 'HEAD', '--list', 'v*').split('\n').filter(Boolean);
  const last = latestVersion(reachable);
  const range = last ? [`v${last}..HEAD`] : ['HEAD'];
  const raw = git('log', '--reverse', '--format=%an%x1f%s%x1f%b%x1e', ...range);
  const commits = raw.split('\x1e').map(entry => entry.replace(/^\n/, '')).filter(Boolean).map(entry => {
    const [author = '', subject = '', body = ''] = entry.split('\x1f');
    return { author, subject, body };
  });
  return { tags, commits };
}

function configVersionOf(config: string): string {
  const match = /^version: "?([^"\n]+)"?\s*$/m.exec(config);
  assert.ok(match, 'config.yaml has no version line');
  return match[1];
}

function emit(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

function main() {
  const command = process.argv[2];
  const config = resolve('config.yaml');
  const plan = planRelease({ configVersion: configVersionOf(readFileSync(config, 'utf8')), ...readCommits(), stableVersion: readStableVersion() });
  if (command === 'plan') {
    emit({ action: plan.action, version: plan.version, level: plan.level ?? '' });
  } else if (command === 'apply') {
    assert.equal(plan.action, 'bump', `Nothing to write: the plan is ${plan.action}`);
    writeFileSync(config, setConfigVersion(readFileSync(config, 'utf8'), plan.version));
    execFileSync('npm', ['version', plan.version, '--no-git-tag-version', '--allow-same-version'], { stdio: 'inherit' });
    const changelog = resolve('CHANGELOG.md');
    writeFileSync(changelog, insertChangelog(readFileSync(changelog, 'utf8'), plan.version, plan.notes));
    emit({ version: plan.version });
  } else {
    throw new Error('Usage: tsx scripts/next-version.ts plan|apply');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
